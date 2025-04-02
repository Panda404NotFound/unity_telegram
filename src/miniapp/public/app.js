// Отлавливаем все ошибки в Telegram WebApp для предотвращения красных экранов ошибок
window.onerror = function(msg, url, line, col, error) {
  console.error("Ошибка перехвачена:", msg, "в", url, "строка:", line);
  return true; // Предотвращает стандартную обработку ошибок
};

// Инициализация Telegram WebApp
const tg = window.Telegram.WebApp || {};

// DOM элементы
const loadingScreen = document.getElementById('loadingScreen');
const appContainer = document.getElementById('appContainer');
const userAvatar = document.getElementById('userAvatar');
const userName = document.getElementById('userName');
const contactsList = document.getElementById('contactsList');
const chatTitle = document.getElementById('chatTitle');
const callControls = document.getElementById('callControls');
const messagesContainer = document.getElementById('messagesContainer');
const messageInputContainer = document.getElementById('messageInputContainer');
const messageInput = document.getElementById('messageInput');
const sendMessageBtn = document.getElementById('sendMessageBtn');
const audioCallBtn = document.getElementById('audioCallBtn');
const videoCallBtn = document.getElementById('videoCallBtn');

// Элементы поиска и вкладок
const tabButtons = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');
const friendsTab = document.getElementById('friendsTab');
const searchTab = document.getElementById('searchTab');
const settingsTab = document.getElementById('settingsTab');
const searchInput = document.getElementById('searchInput');
const searchButton = document.getElementById('searchButton');
const searchResults = document.getElementById('searchResults');

// Элементы настроек
const sourceLanguageInputs = document.querySelectorAll('input[name="sourceLanguage"]');
const translationVoiceSelect = document.getElementById('translationVoice');
const muteOriginalCheckbox = document.getElementById('muteOriginalCheckbox');
const useVADCheckbox = document.getElementById('useVADCheckbox');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');

// Элементы модального окна пользователя
const userInfoModal = document.getElementById('userInfoModal');
const modalUserAvatar = document.getElementById('modalUserAvatar');
const modalUserName = document.getElementById('modalUserName');
const modalUsername = document.getElementById('modalUsername');
const addFriendBtn = document.getElementById('addFriendBtn');
const removeFriendBtn = document.getElementById('removeFriendBtn');
const startChatBtn = document.getElementById('startChatBtn');
const closeUserModal = userInfoModal.querySelector('.close-modal');

// Элементы модального окна настроек перевода
const translationSettingsModal = document.getElementById('translationSettingsModal');
const closeSettingsModal = translationSettingsModal.querySelector('.close-modal');

// Переменные состояния
let currentUser = null;
let selectedContact = null;
let contacts = [];
let selectedUserForModal = null;

// Переменные для WebRTC
let localStream = null;
let peerConnection = null;
let callInProgress = false;
let callType = null; // 'audio' или 'video'
let webrtcManager = null; // Менеджер WebRTC

// Переменные для перевода
let translateService = null; // Сервис перевода
let translationSettings = {
  sourceLanguage: 'ru',
  voice: 'alloy',
  muteOriginal: true,
  useVAD: true
};

// Класс для управления WebRTC соединениями
class WebRTCManager {
  constructor() {
    this.socket = null;
    this.peerConnection = null;
    this.localStream = null;
    this.remoteStream = null;
    this.roomId = null;
    this.currentUserId = null;
    this.targetUserId = null;
    this.connected = false;
    this.callType = null;
    this.isInitiator = false;
    this.remoteOffer = null; // SDP-предложение от звонящего
    this.iceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' },
      // Добавляем общедоступные STUN-серверы для повышения вероятности успешного соединения
      { urls: 'stun:stun.stunprotocol.org:3478' },
      { urls: 'stun:stun.voip.blackberry.com:3478' },
      { urls: 'stun:stun.voipbuster.com:3478' },
      { urls: 'stun:stun.sipgate.net:3478' }
      // Примечание: для реального проекта рекомендуется добавить TURN-серверы
      // для обхода симметричных NAT. Например:
      // { urls: 'turn:turn.example.com:3478', username: 'user', credential: 'pass' }
    ];
    this.onIncomingCall = null;
    this.onCallAccepted = null;
    this.onCallRejected = null;
    this.onCallInitiated = null;
    this.onCallEnded = null;
    this.onError = null;
    this.onLocalStreamAvailable = null;
    this.onRemoteStreamAvailable = null;
    this.onDataChannelMessage = null;
    this.dataChannel = null;
    this.pendingCandidates = null;
  }

  // Инициализация WebSocket соединения
  init(userId) {
    // Убедимся, что ID пользователя хранится как строка
    this.currentUserId = String(userId);

    // Создаем WebSocket соединение
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    this.socket = new WebSocket(wsUrl);

    // Обработчики WebSocket
    this.socket.onopen = () => {
      console.log('WebSocket соединение установлено');
      this.register();
    };

    this.socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handleSignalMessage(data);
      } catch (error) {
        console.error('Ошибка при обработке сообщения от сервера сигнализации:', error);
      }
    };

    this.socket.onerror = (error) => {
      console.error('WebSocket ошибка:', error);
      if (this.onError) {
        this.onError('Ошибка сетевого соединения');
      }
    };

    this.socket.onclose = () => {
      console.log('WebSocket соединение закрыто');
      if (this.connected) {
        this.cleanupCall();
        if (this.onError) {
          this.onError('Соединение с сервером потеряно');
        }
      }
    };
  }

  // Регистрация пользователя на сервере сигнализации
  register() {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;

    console.log(`Регистрация пользователя ${this.currentUserId} на сервере сигнализации`);
    
    this.socket.send(JSON.stringify({
      type: 'register',
      payload: {
        userId: this.currentUserId // Уже в формате строки
      }
    }));
  }

  // Обработка сообщений от сервера сигнализации
  handleSignalMessage(data) {
    const { type, payload } = data;

    switch (type) {
      case 'register':
        console.log('Регистрация на сервере сигнализации успешна');
        break;
      case 'incoming-call':
        this.handleIncomingCall(payload);
        break;
      case 'call-initiated':
        this.handleCallInitiated(payload);
        break;
      case 'call-accepted':
        this.handleCallAccepted(payload);
        break;
      case 'call-rejected':
        this.handleCallRejected(payload);
        break;
      case 'ice-candidate':
        this.handleIceCandidate(payload);
        break;
      case 'hangup':
        this.handleHangup(payload);
        break;
      case 'user-disconnected':
        this.handleUserDisconnected(payload);
        break;
      case 'error':
        console.error('Ошибка от сервера сигнализации:', data.message);
        if (this.onError) {
          this.onError(data.message);
        }
        break;
      default:
        console.warn('Неизвестный тип сообщения от сервера сигнализации:', type);
    }
  }

  // Инициирование звонка
  async startCall(targetUserId, callType = 'audio') {
    // Преобразуем ID пользователя в строку для корректного сравнения
    this.targetUserId = String(targetUserId);
    this.callType = callType;
    this.isInitiator = true;

    try {
      console.log(`Начинаем ${callType} звонок с пользователем ${this.targetUserId}`);
      
      // Получаем доступ к медиа-устройствам
      console.log('Запрашиваем доступ к медиа-устройствам');
      await this.getUserMedia();
      
      // Создаем peer connection
      console.log('Создаем RTCPeerConnection');
      this.createPeerConnection();
      
      // Создаем SDP-предложение
      console.log('Создаем SDP-предложение');
      const offer = await this.peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: callType === 'video'
      });
      
      console.log('Устанавливаем локальное SDP-описание (предложение)');
      await this.peerConnection.setLocalDescription(offer);
      
      // Ждем некоторое время, чтобы собрать начальные ICE-кандидаты
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      console.log('Отправляем запрос на звонок с SDP-предложением');
      this.socket.send(JSON.stringify({
        type: 'call',
        payload: {
          targetUserId: this.targetUserId,
          callType,
          offer: this.peerConnection.localDescription
        }
      }));

      console.log(`Инициируется ${callType} звонок с пользователем ${this.targetUserId}`);
      
      const callStatus = document.getElementById('callStatus');
      if (callStatus) {
        callStatus.textContent = 'Вызов...';
      }
    } catch (error) {
      console.error('Ошибка при инициировании звонка:', error);
      if (this.onError) {
        this.onError('Не удалось получить доступ к микрофону/камере: ' + error.message);
      }
      this.cleanupCall();
    }
  }

  // Получение доступа к медиа-устройствам (микрофон/камера)
  async getUserMedia() {
    try {
      // Запрашиваем доступ к медиа-устройствам
      const constraints = {
        audio: true,
        video: this.callType === 'video'
      };

      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);

      if (this.onLocalStreamAvailable) {
        this.onLocalStreamAvailable(this.localStream);
      }

      console.log('Доступ к медиа-устройствам получен');
      return this.localStream;
    } catch (error) {
      console.error('Ошибка при получении доступа к медиа-устройствам:', error);
      throw error;
    }
  }

  // Создание и настройка peer connection
  createPeerConnection() {
    try {
      const configuration = {
        iceServers: this.iceServers
      };

      this.peerConnection = new RTCPeerConnection(configuration);

      // Добавляем медиа-треки в peer connection
      if (this.localStream) {
        this.localStream.getTracks().forEach(track => {
          this.peerConnection.addTrack(track, this.localStream);
        });
      }

      // Обработчик ICE-кандидатов
      this.peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          console.log('ICE-кандидат сгенерирован:', event.candidate.candidate.substring(0, 50) + '...');
          this.sendIceCandidate(event.candidate);
        } else {
          console.log('Генерация ICE-кандидатов завершена');
        }
      };

      // Обработчик изменения состояния ICE
      this.peerConnection.oniceconnectionstatechange = () => {
        const state = this.peerConnection.iceConnectionState;
        console.log('ICE состояние изменилось:', state);
        
        const callStatus = document.getElementById('callStatus');
        if (callStatus) {
          switch (state) {
            case 'checking':
              callStatus.textContent = 'Установка соединения...';
              break;
            case 'connected':
            case 'completed':
              callStatus.textContent = 'Соединение установлено';
              this.connected = true;
              break;
            case 'failed':
              callStatus.textContent = 'Не удалось установить соединение';
              console.error('ICE соединение не удалось установить');
              this.endCall();
              break;
            case 'disconnected':
              callStatus.textContent = 'Соединение прервано';
              break;
            case 'closed':
              callStatus.textContent = 'Соединение закрыто';
              break;
          }
        }
      };

      // Обработчик получения ремоут-трека
      this.peerConnection.ontrack = (event) => {
        console.log('Получен удаленный трек:', event.track.kind);
        if (!this.remoteStream) {
          this.remoteStream = new MediaStream();
          if (this.onRemoteStreamAvailable) {
            this.onRemoteStreamAvailable(this.remoteStream);
          }
        }
        event.streams[0].getTracks().forEach(track => {
          this.remoteStream.addTrack(track);
        });
      };

      // Создаем data channel для передачи текстовых сообщений
      if (this.isInitiator) {
        this.dataChannel = this.peerConnection.createDataChannel('chat');
        this.setupDataChannel();
      } else {
        this.peerConnection.ondatachannel = (event) => {
          this.dataChannel = event.channel;
          this.setupDataChannel();
        };
      }

      console.log('PeerConnection создан');
      return this.peerConnection;
    } catch (error) {
      console.error('Ошибка при создании PeerConnection:', error);
      throw error;
    }
  }

  // Настройка Data Channel
  setupDataChannel() {
    if (!this.dataChannel) return;

    this.dataChannel.onopen = () => {
      console.log('Data channel открыт');
    };

    this.dataChannel.onclose = () => {
      console.log('Data channel закрыт');
    };

    this.dataChannel.onmessage = (event) => {
      if (this.onDataChannelMessage) {
        this.onDataChannelMessage(event.data);
      }
    };
  }

  // Отправка сообщения через Data Channel
  sendMessage(message) {
    if (this.dataChannel && this.dataChannel.readyState === 'open') {
      this.dataChannel.send(message);
      return true;
    }
    return false;
  }

  // Обработка входящего звонка
  handleIncomingCall(payload) {
    const { callerId, roomId, callType, offer } = payload;
    this.callType = callType;
    this.roomId = roomId;
    this.targetUserId = String(callerId); // Преобразуем в строку
    this.isInitiator = false;
    this.remoteOffer = offer; // Сохраняем SDP-предложение

    console.log(`Входящий ${callType} звонок от пользователя ${this.targetUserId}, ID комнаты: ${roomId}`);

    if (this.onIncomingCall) {
      this.onIncomingCall(this.targetUserId, roomId, callType);
    }
  }

  // Обработка инициации звонка
  handleCallInitiated(payload) {
    const { targetUserId, roomId, callType } = payload;
    this.roomId = roomId;
    console.log(`Звонок инициирован, ID комнаты: ${roomId}`);

    if (this.onCallInitiated) {
      this.onCallInitiated(targetUserId, roomId, callType);
    }
  }

  // Ответ на входящий звонок
  async answerCall(accepted) {
    if (!this.roomId) return;

    if (!accepted) {
      // Отклоняем звонок
      this.socket.send(JSON.stringify({
        type: 'answer',
        payload: {
          roomId: this.roomId,
          accepted: false
        }
      }));
      
      this.cleanupCall();
      return;
    }

    try {
      // Получаем доступ к медиа-устройствам
      await this.getUserMedia();

      // Создаем peer connection
      this.createPeerConnection();
      
      // Если есть SDP-предложение, устанавливаем его как удаленное описание
      if (this.remoteOffer) {
        console.log('Устанавливаем удаленное SDP-предложение');
        await this.peerConnection.setRemoteDescription(new RTCSessionDescription(this.remoteOffer));
      } else {
        throw new Error('Отсутствует SDP-предложение от звонящего');
      }

      // Создаем и отправляем SDP-ответ
      console.log('Создаем SDP-ответ');
      const answer = await this.peerConnection.createAnswer();
      console.log('Устанавливаем локальное SDP-описание (ответ)');
      await this.peerConnection.setLocalDescription(answer);

      console.log('Отправляем SDP-ответ на сервер');
      this.socket.send(JSON.stringify({
        type: 'answer',
        payload: {
          roomId: this.roomId,
          answer: this.peerConnection.localDescription,
          accepted: true
        }
      }));

      // Добавляем отложенные ICE-кандидаты, если они есть
      if (this.pendingCandidates && this.pendingCandidates.length > 0) {
        console.log(`Добавляем ${this.pendingCandidates.length} отложенных ICE-кандидатов`);
        for (const candidate of this.pendingCandidates) {
          try {
            await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (e) {
            console.error('Ошибка при добавлении отложенного ICE-кандидата:', e);
          }
        }
        this.pendingCandidates = [];
      }

      this.connected = true;
      console.log('Звонок принят, SDP-ответ отправлен');
    } catch (error) {
      console.error('Ошибка при ответе на звонок:', error);
      
      // Уведомляем звонящего об ошибке
      this.socket.send(JSON.stringify({
        type: 'answer',
        payload: {
          roomId: this.roomId,
          accepted: false
        }
      }));
      
      if (this.onError) {
        this.onError('Не удалось ответить на звонок: ' + error.message);
      }
      
      this.cleanupCall();
    }
  }

  // Обработка ответа на звонок
  async handleCallAccepted(payload) {
    const { roomId, answer } = payload;
    
    if (this.roomId !== roomId || !this.peerConnection) {
      console.error('Неверный ID комнаты или отсутствует peerConnection');
      return;
    }
    
    try {
      console.log('Звонок принят, устанавливаем удаленное SDP-описание');
      
      if (!answer) {
        throw new Error('Отсутствует SDP-ответ');
      }
      
      const remoteDesc = new RTCSessionDescription(answer);
      await this.peerConnection.setRemoteDescription(remoteDesc);
      
      // Добавляем отложенные ICE-кандидаты, если они есть
      if (this.pendingCandidates && this.pendingCandidates.length > 0) {
        console.log(`Добавляем ${this.pendingCandidates.length} отложенных ICE-кандидатов`);
        for (const candidate of this.pendingCandidates) {
          try {
            await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (e) {
            console.error('Ошибка при добавлении отложенного ICE-кандидата:', e);
          }
        }
        this.pendingCandidates = [];
      }
      
      this.connected = true;
      console.log('Звонок принят, удаленное SDP-описание успешно установлено');
      
      if (this.onCallAccepted) {
        this.onCallAccepted();
      }
    } catch (error) {
      console.error('Ошибка при обработке принятия звонка:', error);
      if (this.onError) {
        this.onError('Ошибка при установке соединения: ' + error.message);
      }
      this.endCall();
    }
  }

  // Обработка отказа от звонка
  handleCallRejected(payload) {
    const { roomId } = payload;
    
    if (this.roomId !== roomId) return;
    
    console.log('Звонок отклонен');
    
    if (this.onCallRejected) {
      this.onCallRejected();
    }
    
    this.cleanupCall();
  }

  // Отправка ICE-кандидата
  sendIceCandidate(candidate) {
    if (!this.socket || !this.roomId) return;
    
    console.log('Отправка ICE-кандидата на сервер');
    
    this.socket.send(JSON.stringify({
      type: 'ice-candidate',
      payload: {
        roomId: this.roomId,
        candidate
      }
    }));
  }

  // Обработка ICE-кандидата
  async handleIceCandidate(payload) {
    const { roomId, candidate } = payload;
    
    if (this.roomId !== roomId || !this.peerConnection) {
      console.warn('Получен ICE-кандидат для неверной комнаты или без peerConnection');
      return;
    }
    
    try {
      console.log('Получен ICE-кандидат от удаленного пира:', candidate.candidate.substring(0, 50) + '...');
      
      // Убедимся, что peerConnection находится в правильном состоянии
      if (this.peerConnection.remoteDescription && this.peerConnection.localDescription) {
        await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        console.log('ICE-кандидат успешно добавлен');
      } else {
        console.warn('Не удалось добавить ICE-кандидат: peerConnection не готов');
        // Сохраняем кандидатов для добавления после установки описаний
        if (!this.pendingCandidates) {
          this.pendingCandidates = [];
        }
        this.pendingCandidates.push(candidate);
        console.log('ICE-кандидат добавлен в очередь ожидания');
      }
    } catch (error) {
      console.error('Ошибка при добавлении ICE-кандидата:', error);
    }
  }

  // Завершение звонка
  endCall() {
    if (!this.socket || !this.roomId) return;
    
    // Отправляем сообщение о завершении звонка
    this.socket.send(JSON.stringify({
      type: 'hangup',
      payload: {
        roomId: this.roomId
      }
    }));
    
    this.cleanupCall();
    
    console.log('Звонок завершен');
    
    if (this.onCallEnded) {
      this.onCallEnded();
    }
  }

  // Обработка завершения звонка
  handleHangup(payload) {
    const { roomId } = payload;
    
    if (this.roomId !== roomId) return;
    
    console.log('Собеседник завершил звонок');
    
    this.cleanupCall();
    
    if (this.onCallEnded) {
      this.onCallEnded();
    }
  }

  // Обработка отключения пользователя
  handleUserDisconnected(payload) {
    const { roomId, userId } = payload;
    
    if (this.roomId !== roomId) return;
    
    console.log(`Пользователь ${userId} отключился`);
    
    this.cleanupCall();
    
    if (this.onCallEnded) {
      this.onCallEnded('Собеседник отключился');
    }
  }

  // Очистка ресурсов звонка
  cleanupCall() {
    // Закрываем peer connection
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
    
    // Останавливаем все медиа-треки
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }
    
    this.remoteStream = null;
    this.roomId = null;
    this.targetUserId = null;
    this.connected = false;
    this.callType = null;
    this.isInitiator = false;
    this.dataChannel = null;
    this.remoteOffer = null;
    this.pendingCandidates = null;
  }

  // Закрытие соединения
  close() {
    this.cleanupCall();
    
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }
}

// Инициализация приложения
document.addEventListener('DOMContentLoaded', initApp);

async function initApp() {
  try {
    console.log("Инициализация приложения...");
    
    // Расширяем приложение на весь экран если доступен Telegram API
    if (tg.expand) {
      tg.expand();
    }
    
    // Применяем тему Telegram
    applyTelegramTheme();
    
    // Задержка для обеспечения правильной инициализации
    await new Promise(resolve => setTimeout(resolve, 500));
    
    try {
      // Получаем данные пользователя из Telegram
      await initUserFromTelegram();
    } catch (e) {
      console.warn("Не удалось получить данные пользователя из Telegram:", e);
      // Создаем тестового пользователя если не в Telegram
      createTestUser();
    }
    
    // Инициализируем WebRTC менеджер
    initWebRTC();
    
    // Инициализируем модуль перевода
    initTranslation();
    
    // Загружаем контакты (друзей)
    await loadContacts();
    
    // Показываем приложение
    if (loadingScreen) loadingScreen.style.display = 'none';
    if (appContainer) appContainer.style.display = 'flex';
    
    // Устанавливаем кнопку "Закрыть" в Telegram WebApp если доступно
    if (tg.MainButton && tg.MainButton.setText) {
      tg.MainButton.setText('Закрыть');
      if (tg.MainButton.onClick) {
        tg.MainButton.onClick(() => {
          if (tg.close) tg.close();
        });
      }
      if (tg.MainButton.show) {
        tg.MainButton.show();
      }
    }
    
    // Показываем, что приложение готово
    if (tg.ready) tg.ready();
    
    console.log("Приложение инициализировано успешно!");
  } catch (error) {
    console.error('Ошибка при инициализации приложения:', error);
    showErrorScreen('Ошибка при загрузке приложения. Пожалуйста, обновите страницу или попробуйте позже.');
  }
}

// Создаем тестового пользователя если не в Telegram
function createTestUser() {
  currentUser = {
    id: 'test123',
    firstName: 'Тестовый',
    lastName: 'Пользователь',
    username: 'test_user',
    languageCode: 'ru',
    photoUrl: null
  };
  
  // Отображаем данные пользователя
  updateUserInfo();
}

// Применяем тему Telegram
function applyTelegramTheme() {
  // Устанавливаем CSS переменные из параметров темы Telegram
  const themeParams = tg.themeParams || {};
  document.documentElement.style.setProperty('--tg-theme-bg-color', themeParams.bg_color || '#f0f2f5');
  document.documentElement.style.setProperty('--tg-theme-text-color', themeParams.text_color || '#000000');
  document.documentElement.style.setProperty('--tg-theme-hint-color', themeParams.hint_color || '#999999');
  document.documentElement.style.setProperty('--tg-theme-link-color', themeParams.link_color || '#2481cc');
  document.documentElement.style.setProperty('--tg-theme-button-color', themeParams.button_color || '#3498db');
  document.documentElement.style.setProperty('--tg-theme-button-text-color', themeParams.button_text_color || '#ffffff');
  document.documentElement.style.setProperty('--tg-theme-secondary-bg-color', themeParams.secondary_bg_color || '#f8f9fa');
}

// Инициализация пользователя из Telegram
async function initUserFromTelegram() {
  // Проверяем доступность объекта initDataUnsafe в Telegram WebApp
  if (!tg.initDataUnsafe || !tg.initDataUnsafe.user) {
    throw new Error('Не удалось получить данные пользователя из Telegram');
  }
  
  // Получаем данные пользователя из Telegram
  const user = tg.initDataUnsafe.user;
  currentUser = {
    id: user.id,
    firstName: user.first_name,
    lastName: user.last_name || '',
    username: user.username || '',
    languageCode: user.language_code || 'ru',
    photoUrl: user.photo_url || null
  };
  
  // Отображаем данные пользователя
  updateUserInfo();
  
  // Регистрируем пользователя на сервере
  await registerUser(currentUser);
}

// Регистрация пользователя на сервере
async function registerUser(user) {
  try {
    const response = await fetch('/api/users/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(user)
    });
    
    if (!response.ok) {
      throw new Error('Ошибка при регистрации пользователя');
    }
    
    console.log('Пользователь успешно зарегистрирован на сервере');
  } catch (error) {
    console.error('Ошибка при регистрации пользователя:', error);
    // Продолжаем работу даже при ошибке регистрации
  }
}

// Обновление информации о пользователе в интерфейсе
function updateUserInfo() {
  if (!currentUser || !userAvatar || !userName) return;
  
  // Устанавливаем аватар пользователя
  if (currentUser.photoUrl) {
    userAvatar.innerHTML = `<img src="${currentUser.photoUrl}" alt="${currentUser.firstName}">`;
  } else {
    userAvatar.textContent = currentUser.firstName.charAt(0);
  }
  
  // Устанавливаем имя пользователя
  let displayName = currentUser.firstName;
  if (currentUser.lastName) {
    displayName += ' ' + currentUser.lastName;
  }
  userName.textContent = displayName;
}

// Загрузка контактов
async function loadContacts() {
  if (!contactsList) return;
  
  try {
    // Сначала пробуем загрузить друзей пользователя
    try {
      if (currentUser && currentUser.id) {
        const response = await fetch(`/api/users/${currentUser.id}/friends`);
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.friends) {
            contacts = data.friends.map(friend => ({
              id: friend.id,
              name: `${friend.firstName} ${friend.lastName}`.trim(),
              username: friend.username || '',
              avatar: friend.photoUrl ? null : friend.firstName.charAt(0),
              photoUrl: friend.photoUrl
            }));
            renderContacts();
            return;
          }
        }
      }
      throw new Error('Не удалось загрузить друзей');
    } catch (e) {
      console.warn("Не удалось загрузить друзей, пробуем запасной API:", e);
      
      // Пробуем загрузить общий список пользователей
      const response = await fetch('/api/users');
      if (response.ok) {
        contacts = await response.json();
        renderContacts();
        return;
      } else {
        throw new Error('Не удалось загрузить контакты');
      }
    }
  } catch (error) {
    console.error('Ошибка при загрузке контактов:', error);
    // Используем локальные данные как запасной вариант
    contacts = [
      { id: 1, name: 'Алиса', username: 'alice', avatar: 'A' },
      { id: 2, name: 'Борис', username: 'boris', avatar: 'B' },
      { id: 3, name: 'Виктор', username: 'victor', avatar: 'V' },
      { id: 4, name: 'Галина', username: 'galina', avatar: 'G' },
      { id: 5, name: 'Дмитрий', username: 'dmitry', avatar: 'D' }
    ];
    renderContacts();
  }
}

// Рендеринг списка контактов
function renderContacts() {
  if (!contacts || contacts.length === 0 || !contactsList) {
    if (contactsList) contactsList.innerHTML = '<div class="no-contacts">Контакты не найдены</div>';
    return;
  }
  
  // Очищаем список контактов
  contactsList.innerHTML = '';
  
  // Добавляем контакты
  contacts.forEach(contact => {
    const contactItem = document.createElement('div');
    contactItem.className = 'contact-item';
    contactItem.dataset.userId = contact.id;
    
    const contactAvatar = document.createElement('div');
    contactAvatar.className = 'contact-avatar';
    contactAvatar.textContent = contact.avatar || contact.name.charAt(0);
    
    const contactName = document.createElement('div');
    contactName.className = 'contact-name';
    contactName.textContent = contact.name;
    
    contactItem.appendChild(contactAvatar);
    contactItem.appendChild(contactName);
    
    // Добавляем обработчик клика для выбора контакта
    contactItem.addEventListener('click', () => selectContact(contact));
    
    contactsList.appendChild(contactItem);
  });
}

// Выбор контакта для чата
async function selectContact(contact) {
  if (!messagesContainer || !chatTitle || !callControls || !messageInputContainer) return;
  
  // Убираем активный класс у всех контактов
  document.querySelectorAll('.contact-item').forEach(item => {
    item.classList.remove('active');
  });
  
  // Добавляем активный класс выбранному контакту
  const activeContact = document.querySelector(`.contact-item[data-user-id="${contact.id}"]`);
  if (activeContact) activeContact.classList.add('active');
  
  // Устанавливаем выбранный контакт
  selectedContact = contact;
  
  // Обновляем заголовок чата
  chatTitle.textContent = contact.name;
  
  // Показываем элементы управления звонками
  callControls.style.display = 'flex';
  
  // Показываем поле ввода сообщения
  messageInputContainer.style.display = 'flex';
  
  // Загружаем историю сообщений
  await loadMessages(contact.id);
}

// Загрузка истории сообщений
async function loadMessages(userId) {
  if (!messagesContainer) return;
  
  try {
    // Показываем индикатор загрузки
    messagesContainer.innerHTML = '<div class="loading-messages">Загрузка сообщений...</div>';
    
    let messages = [];
    
    // Пробуем загрузить с сервера
    try {
      const response = await fetch(`/api/messages/${userId}`);
      if (response.ok) {
        messages = await response.json();
      } else {
        throw new Error('Не удалось загрузить сообщения');
      }
    } catch (e) {
      console.warn("Не удалось загрузить сообщения с сервера, используем локальные данные:", e);
      // Если не удалось загрузить с сервера, используем локальные данные
      messages = [
        { id: 1, text: 'Привет! Как дела?', sender: userId, timestamp: Date.now() - 86400000 },
        { id: 2, text: 'Отлично! А у тебя?', sender: 'me', timestamp: Date.now() - 86300000 },
        { id: 3, text: 'Всё хорошо, спасибо!', sender: userId, timestamp: Date.now() - 86200000 }
      ];
    }
    
    renderMessages(messages);
  } catch (error) {
    console.error('Ошибка при загрузке сообщений:', error);
    if (messagesContainer) {
      messagesContainer.innerHTML = '<div class="loading-error">Ошибка загрузки сообщений</div>';
    }
  }
}

// Рендеринг сообщений
function renderMessages(messages) {
  if (!messagesContainer) return;
  
  if (!messages || messages.length === 0) {
    messagesContainer.innerHTML = '<div class="no-messages">Нет сообщений</div>';
    return;
  }
  
  // Очищаем контейнер сообщений
  messagesContainer.innerHTML = '';
  
  // Добавляем сообщения
  messages.forEach(message => {
    const messageEl = document.createElement('div');
    messageEl.className = `message message-${message.sender === 'me' ? 'sent' : 'received'}`;
    
    const messageText = document.createElement('div');
    messageText.className = 'message-text';
    messageText.textContent = message.text;
    
    const messageTime = document.createElement('div');
    messageTime.className = 'message-time';
    messageTime.textContent = formatTimestamp(message.timestamp);
    
    messageEl.appendChild(messageText);
    messageEl.appendChild(messageTime);
    
    messagesContainer.appendChild(messageEl);
  });
  
  // Прокручиваем к последнему сообщению
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Форматирование временной метки
function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Отправка сообщения
function sendMessage() {
  if (!selectedContact || !messageInput || !messagesContainer) return;
  
  if (!selectedContact) {
    if (tg.showAlert) {
      tg.showAlert('Пожалуйста, выберите контакт для отправки сообщения');
    } else {
      alert('Пожалуйста, выберите контакт для отправки сообщения');
    }
    return;
  }
  
  const text = messageInput.value.trim();
  if (!text) return;
  
  // Создаем новое сообщение
  const newMessage = {
    id: Date.now(),
    text: text,
    sender: 'me',
    timestamp: Date.now()
  };
  
  // Очищаем поле ввода
  messageInput.value = '';
  
  // Добавляем сообщение в чат
  addMessageToChat(newMessage);
  
  // Эмулируем ответ от собеседника
  setTimeout(() => {
    const reply = {
      id: Date.now() + 1,
      text: `Это автоматический ответ от ${selectedContact.name}`,
      sender: selectedContact.id,
      timestamp: Date.now()
    };
    addMessageToChat(reply);
  }, 1000);
}

// Добавление сообщения в чат
function addMessageToChat(message) {
  if (!messagesContainer) return;
  
  const messageEl = document.createElement('div');
  messageEl.className = `message message-${message.sender === 'me' ? 'sent' : 'received'}`;
  
  const messageText = document.createElement('div');
  messageText.className = 'message-text';
  messageText.textContent = message.text;
  
  const messageTime = document.createElement('div');
  messageTime.className = 'message-time';
  messageTime.textContent = formatTimestamp(message.timestamp);
  
  messageEl.appendChild(messageText);
  messageEl.appendChild(messageTime);
  
  messagesContainer.appendChild(messageEl);
  
  // Прокручиваем к последнему сообщению
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Показ экрана с ошибкой
function showErrorScreen(message) {
  if (!loadingScreen) return;
  
  loadingScreen.innerHTML = `
    <div class="error-icon">❌</div>
    <p class="error-message">${message}</p>
    <button id="retryButton" class="retry-button">Повторить</button>
  `;
  
  const retryButton = document.getElementById('retryButton');
  if (retryButton) {
    retryButton.addEventListener('click', () => {
      location.reload();
    });
  }
}

// Обработчики событий

// Отправка сообщения по клику на кнопку
if (sendMessageBtn) {
  sendMessageBtn.addEventListener('click', sendMessage);
}

// Отправка сообщения по нажатию Enter
if (messageInput) {
  messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      sendMessage();
    }
  });
}

// Обработчики для вкладок
if (tabButtons) {
  tabButtons.forEach(button => {
    button.addEventListener('click', function() {
      const tabName = this.dataset.tab;
      
      // Убираем активный класс у всех кнопок и содержимого вкладок
      tabButtons.forEach(btn => btn.classList.remove('active'));
      tabContents.forEach(content => content.classList.remove('active'));
      
      // Активируем выбранную вкладку
      this.classList.add('active');
      document.getElementById(`${tabName}Tab`).classList.add('active');
    });
  });
}

// Обработчик поиска
if (searchButton) {
  searchButton.addEventListener('click', () => {
    if (searchInput) {
      searchUsers(searchInput.value.trim());
    }
  });
}

// Поиск при нажатии Enter
if (searchInput) {
  searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      searchUsers(searchInput.value.trim());
    }
  });
}

// Закрытие модального окна при клике на крестик
if (closeUserModal) {
  closeUserModal.addEventListener('click', hideUserModal);
  console.log('Настроен обработчик закрытия модального окна');
}

// Закрытие модального окна при клике вне его содержимого
window.addEventListener('click', (e) => {
  if (userInfoModal && e.target === userInfoModal) {
    hideUserModal();
  }
});

// Обработчик добавления в друзья
if (addFriendBtn) {
  addFriendBtn.addEventListener('click', async () => {
    if (selectedUserForModal) {
      const success = await addFriend(selectedUserForModal.id);
      if (success) {
        addFriendBtn.style.display = 'none';
        removeFriendBtn.style.display = 'block';
        if (tg.showPopup) {
          tg.showPopup({
            title: 'Успешно',
            message: 'Пользователь добавлен в друзья',
            buttons: [{ type: 'ok' }]
          });
        } else {
          alert('Пользователь добавлен в друзья');
        }
      }
    }
  });
}

// Обработчик удаления из друзей
if (removeFriendBtn) {
  removeFriendBtn.addEventListener('click', async () => {
    if (selectedUserForModal) {
      if (tg.showConfirm) {
        tg.showConfirm('Вы уверены, что хотите удалить пользователя из друзей?', async (confirmed) => {
          if (confirmed) {
            const success = await removeFriend(selectedUserForModal.id);
            if (success) {
              addFriendBtn.style.display = 'block';
              removeFriendBtn.style.display = 'none';
              hideUserModal();
            }
          }
        });
      } else {
        const confirmed = confirm('Вы уверены, что хотите удалить пользователя из друзей?');
        if (confirmed) {
          const success = await removeFriend(selectedUserForModal.id);
          if (success) {
            addFriendBtn.style.display = 'block';
            removeFriendBtn.style.display = 'none';
            hideUserModal();
          }
        }
      }
    }
  });
}

// Обработчик начала чата в модальном окне
if (startChatBtn) {
  startChatBtn.addEventListener('click', () => {
    if (selectedUserForModal) {
      // Создаем объект контакта из данных пользователя
      const contact = {
        id: selectedUserForModal.id,
        name: `${selectedUserForModal.firstName} ${selectedUserForModal.lastName || ''}`.trim(),
        username: selectedUserForModal.username || '',
        avatar: selectedUserForModal.photoUrl ? null : selectedUserForModal.firstName.charAt(0),
        photoUrl: selectedUserForModal.photoUrl
      };
      
      // Выбираем контакт и закрываем модальное окно
      selectContact(contact);
      hideUserModal();
    }
  });
}

// Обработчик аудиозвонка
if (audioCallBtn) {
  audioCallBtn.addEventListener('click', () => {
    if (selectedContact) {
      startAudioCall(selectedContact.id);
    }
  });
}

// Обработчик видеозвонка
if (videoCallBtn) {
  videoCallBtn.addEventListener('click', () => {
    if (selectedContact) {
      startVideoCall(selectedContact.id);
    }
  });
}

// Функция поиска пользователей
async function searchUsers(query) {
  if (!query || query.trim() === '') {
    searchResults.innerHTML = '<div class="no-results">Введите имя пользователя или @username для поиска</div>';
    return;
  }
  
  try {
    searchResults.innerHTML = '<div class="loading-results">Поиск пользователей...</div>';
    
    const response = await fetch(`/api/users/search?query=${encodeURIComponent(query)}`);
    
    if (!response.ok) {
      throw new Error('Ошибка при поиске пользователей');
    }
    
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || 'Ошибка при поиске пользователей');
    }
    
    renderSearchResults(data.results);
  } catch (error) {
    console.error('Ошибка при поиске пользователей:', error);
    searchResults.innerHTML = '<div class="error-message">Ошибка при поиске пользователей</div>';
  }
}

// Рендеринг результатов поиска
function renderSearchResults(results) {
  if (!results || results.length === 0) {
    searchResults.innerHTML = '<div class="no-results">Пользователи не найдены</div>';
    return;
  }
  
  searchResults.innerHTML = '';
  
  results.forEach(user => {
    const userItem = document.createElement('div');
    userItem.className = 'user-item';
    userItem.dataset.userId = user.id;
    
    const userAvatar = document.createElement('div');
    userAvatar.className = 'user-avatar';
    
    // Если есть фото, используем его, иначе первую букву имени
    if (user.photoUrl) {
      userAvatar.innerHTML = `<img src="${user.photoUrl}" alt="${user.firstName}">`;
    } else {
      userAvatar.textContent = user.firstName.charAt(0);
    }
    
    const userInfo = document.createElement('div');
    userInfo.className = 'user-info';
    
    const userFullName = document.createElement('div');
    userFullName.className = 'user-full-name';
    userFullName.textContent = `${user.firstName} ${user.lastName || ''}`.trim();
    
    const userUsername = document.createElement('div');
    userUsername.className = 'user-username';
    userUsername.textContent = user.username ? `@${user.username}` : '';
    
    userInfo.appendChild(userFullName);
    if (user.username) userInfo.appendChild(userUsername);
    
    userItem.appendChild(userAvatar);
    userItem.appendChild(userInfo);
    
    // Добавляем обработчик для открытия модального окна с информацией о пользователе
    userItem.addEventListener('click', () => showUserModal(user));
    
    searchResults.appendChild(userItem);
  });
}

// Показать модальное окно с информацией о пользователе
function showUserModal(user) {
  if (!userInfoModal) return;
  
  selectedUserForModal = user;
  
  // Заполняем информацию
  if (modalUserAvatar) {
    if (user.photoUrl) {
      modalUserAvatar.innerHTML = `<img src="${user.photoUrl}" alt="${user.firstName}">`;
    } else {
      modalUserAvatar.textContent = user.firstName.charAt(0);
    }
  }
  
  if (modalUserName) {
    modalUserName.textContent = `${user.firstName} ${user.lastName || ''}`.trim();
  }
  
  if (modalUsername) {
    modalUsername.textContent = user.username ? `@${user.username}` : '';
  }
  
  // Проверяем, является ли пользователь другом
  const isFriend = contacts.some(contact => contact.id === user.id.toString());
  
  if (addFriendBtn) addFriendBtn.style.display = isFriend ? 'none' : 'block';
  if (removeFriendBtn) removeFriendBtn.style.display = isFriend ? 'block' : 'none';
  
  // Показываем модальное окно
  userInfoModal.style.display = 'flex';
}

// Скрыть модальное окно
function hideUserModal() {
  if (userInfoModal) userInfoModal.style.display = 'none';
  selectedUserForModal = null;
}

// Добавление пользователя в друзья
async function addFriend(userId) {
  if (!currentUser || !currentUser.id) {
    showError('Необходимо войти в систему');
    return false;
  }
  
  try {
    const response = await fetch(`/api/users/${currentUser.id}/friends/${userId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error('Ошибка при добавлении друга');
    }
    
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || 'Ошибка при добавлении друга');
    }
    
    // Обновляем список друзей
    await loadContacts();
    return true;
  } catch (error) {
    console.error('Ошибка при добавлении друга:', error);
    showError('Не удалось добавить пользователя в друзья');
    return false;
  }
}

// Удаление пользователя из друзей
async function removeFriend(userId) {
  if (!currentUser || !currentUser.id) {
    showError('Необходимо войти в систему');
    return false;
  }
  
  try {
    const response = await fetch(`/api/users/${currentUser.id}/friends/${userId}`, {
      method: 'DELETE'
    });
    
    if (!response.ok) {
      throw new Error('Ошибка при удалении друга');
    }
    
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || 'Ошибка при удалении друга');
    }
    
    // Обновляем список друзей
    await loadContacts();
    return true;
  } catch (error) {
    console.error('Ошибка при удалении друга:', error);
    showError('Не удалось удалить пользователя из друзей');
    return false;
  }
}

// Показать сообщение об ошибке
function showError(message) {
  if (tg.showAlert) {
    tg.showAlert(message);
  } else {
    alert(message);
  }
}

// Функции для работы с настройками перевода

/**
 * Показывает модальное окно настроек перевода
 */
function showTranslationSettings() {
  try {
    // Загружаем текущие настройки из модуля settings.js
    const settings = TranslationSettings.getInstance();
    
    // Устанавливаем текущий язык
    const targetLanguage = settings.getTargetLanguage();
    targetLanguageInputs.forEach(input => {
      input.checked = input.value === targetLanguage;
    });
    
    // Устанавливаем текущую модель
    translationModelSelect.value = settings.getModel() || 'gpt-4o-mini-realtime-preview';
    
    // Устанавливаем текущий голос
    translationVoiceSelect.value = settings.getVoice() || 'alloy';
    
    // Устанавливаем настройку VAD
    useVADCheckbox.checked = settings.getUseVAD() !== false;
    
    // Загружаем API ключ, если он есть в локальном хранилище
    const savedApiKey = localStorage.getItem('openai_api_key');
    if (savedApiKey) {
      apiKeyInput.value = savedApiKey;
    }
    
    // Показываем модальное окно
    translationSettingsModal.style.display = 'block';
    
  } catch (error) {
    console.error('Ошибка при открытии настроек перевода:', error);
    showError('Не удалось загрузить настройки перевода');
  }
}

/**
 * Скрывает модальное окно настроек перевода
 */
function hideTranslationSettings() {
  translationSettingsModal.style.display = 'none';
}

/**
 * Сохраняет настройки перевода
 */
function saveTranslationSettings() {
  try {
    const settings = TranslationSettings.getInstance();
    
    // Получаем выбранный язык
    let selectedLanguage = 'ru';
    targetLanguageInputs.forEach(input => {
      if (input.checked) {
        selectedLanguage = input.value;
      }
    });
    
    // Сохраняем настройки
    settings.setTargetLanguage(selectedLanguage);
    settings.setModel(translationModelSelect.value);
    settings.setVoice(translationVoiceSelect.value);
    settings.setUseVAD(useVADCheckbox.checked);
    settings.setMuteOriginal(muteOriginalCheckbox.checked);
    settings.saveSettings();
    
    // Сохраняем API ключ в локальном хранилище
    if (apiKeyInput.value.trim() !== '') {
      localStorage.setItem('openai_api_key', apiKeyInput.value.trim());
    }
    
    // Сообщаем об успешном сохранении
    showError('Настройки успешно сохранены');
    
    // Скрываем модальное окно
    hideTranslationSettings();
    
    // Обновляем настройки в менеджере перевода, если он существует
    if (window.translationManager) {
      window.translationManager.updateSettings();
    }
    
  } catch (error) {
    console.error('Ошибка при сохранении настроек перевода:', error);
    showError('Не удалось сохранить настройки перевода');
  }
}

/**
 * Инициализация модуля перевода
 */
function initTranslation() {
  try {
    // Загружаем настройки перевода
    const settings = TranslationSettings.getInstance();
    settings.loadSettings();
    
    // Инициализируем менеджер перевода
    window.translationManager = new TranslationManager();
    
    // Добавляем кнопку настроек перевода в интерфейс
    const appHeader = document.querySelector('.app-container');
    if (appHeader) {
      const settingsButton = document.createElement('button');
      settingsButton.id = 'translationSettingsBtn';
      settingsButton.className = 'settings-btn';
      settingsButton.innerHTML = '↻ Настройки перевода';
      settingsButton.addEventListener('click', showTranslationSettings);
      
      // Добавляем кнопку в начало контейнера
      appHeader.insertBefore(settingsButton, appHeader.firstChild);
    }
    
    // Добавляем обработчики событий для модального окна настроек
    closeSettingsModal.addEventListener('click', hideTranslationSettings);
    saveSettingsBtn.addEventListener('click', saveTranslationSettings);
    
    // Закрытие модального окна при клике вне его
    window.addEventListener('click', (event) => {
      if (event.target === translationSettingsModal) {
        hideTranslationSettings();
      }
    });
    
    console.log('Модуль перевода успешно инициализирован');
    
  } catch (error) {
    console.error('Ошибка при инициализации модуля перевода:', error);
  }
}

// Сообщаем в консоль о завершении загрузки скрипта
console.log("Скрипт приложения загружен успешно");

// Инициализация видеозвонка
async function initVideoCall() {
  callType = 'video';
  return true;
}

// Инициализация аудиозвонка
async function initAudioCall() {
  callType = 'audio';
  return true;
}

// Инициировать видеозвонок с контактом
async function startVideoCall(contactId) {
  if (callInProgress) {
    showError('У вас уже идет звонок');
    return;
  }
  
  if (!webrtcManager) {
    initWebRTC();
  }
  
  // Преобразуем ID в строку для корректного сравнения
  const contactIdStr = String(contactId);
  
  // Находим контакт
  const contact = contacts.find(c => String(c.id) === contactIdStr);
  if (!contact) {
    showError('Контакт не найден');
    return;
  }
  
  callInProgress = true;
  callType = 'video';
  
  // Показываем интерфейс звонка
  showCallInterface();
  
  // Начинаем звонок
  await webrtcManager.startCall(contactIdStr, 'video');
}

// Инициировать аудиозвонок с контактом
async function startAudioCall(contactId) {
  if (callInProgress) {
    showError('У вас уже идет звонок');
    return;
  }
  
  if (!webrtcManager) {
    initWebRTC();
  }
  
  // Преобразуем ID в строку для корректного сравнения
  const contactIdStr = String(contactId);
  
  // Находим контакт
  const contact = contacts.find(c => String(c.id) === contactIdStr);
  if (!contact) {
    showError('Контакт не найден');
    return;
  }
  
  callInProgress = true;
  callType = 'audio';
  
  // Показываем интерфейс звонка
  showCallInterface();
  
  // Начинаем звонок
  await webrtcManager.startCall(contactIdStr, 'audio');
}

// Показать интерфейс звонка
function showCallInterface(customContact = null) {
  // Создаем модальное окно для звонка
  const callModal = document.createElement('div');
  callModal.className = 'call-modal';
  callModal.id = 'callModal';
  
  const callContent = document.createElement('div');
  callContent.className = 'call-content';
  
  // Используем либо customContact (для входящих звонков), 
  // либо selectedContact (для исходящих), либо дефолтные значения
  const contactToShow = customContact || selectedContact || {
    name: 'Собеседник',
    avatar: null
  };
  
  // Информация о контакте
  const callContactInfo = document.createElement('div');
  callContactInfo.className = 'call-contact-info';
  callContactInfo.innerHTML = `
    <div class="call-avatar">${contactToShow.avatar || contactToShow.name.charAt(0)}</div>
    <div class="call-name">${contactToShow.name}</div>
    <div class="call-status" id="callStatus">Соединение...</div>
  `;
  
  // Контейнеры для видео
  const videoContainer = document.createElement('div');
  videoContainer.className = 'video-container';
  videoContainer.style.display = callType === 'video' ? 'flex' : 'none';
  
  const localVideoContainer = document.createElement('div');
  localVideoContainer.className = 'local-video-container';
  
  const localVideo = document.createElement('video');
  localVideo.id = 'localVideo';
  localVideo.autoplay = true;
  localVideo.muted = true;
  localVideo.playsInline = true;
  
  const remoteVideoContainer = document.createElement('div');
  remoteVideoContainer.className = 'remote-video-container';
  
  const remoteVideo = document.createElement('video');
  remoteVideo.id = 'remoteVideo';
  remoteVideo.autoplay = true;
  remoteVideo.playsInline = true;
  
  localVideoContainer.appendChild(localVideo);
  remoteVideoContainer.appendChild(remoteVideo);
  videoContainer.appendChild(remoteVideoContainer);
  videoContainer.appendChild(localVideoContainer);
  
  // Кнопки управления звонком
  const callControls = document.createElement('div');
  callControls.className = 'call-controls';
  
  const muteBtn = document.createElement('button');
  muteBtn.className = 'call-control-btn';
  muteBtn.id = 'muteBtn';
  muteBtn.innerHTML = '🔇';
  muteBtn.title = 'Выключить микрофон';
  
  const videoBtn = document.createElement('button');
  videoBtn.className = 'call-control-btn';
  videoBtn.id = 'videoBtn';
  videoBtn.innerHTML = '📷';
  videoBtn.title = 'Выключить камеру';
  videoBtn.style.display = callType === 'video' ? 'block' : 'none';
  
  const endCallBtn = document.createElement('button');
  endCallBtn.className = 'call-control-btn end-call';
  endCallBtn.innerHTML = '❌';
  endCallBtn.title = 'Завершить звонок';
  
  callControls.appendChild(muteBtn);
  callControls.appendChild(videoBtn);
  callControls.appendChild(endCallBtn);
  
  // Собираем интерфейс
  callContent.appendChild(callContactInfo);
  callContent.appendChild(videoContainer);
  callContent.appendChild(callControls);
  callModal.appendChild(callContent);
  
  // Добавляем интерфейс в документ
  document.body.appendChild(callModal);
  
  // Обработчики событий для кнопок
  muteBtn.addEventListener('click', toggleMute);
  videoBtn.addEventListener('click', toggleVideo);
  endCallBtn.addEventListener('click', endCall);
  
  // Автоматически инициализируем перевод для звонков
  if (webrtcManager && webrtcManager.localStream) {
    console.log('Автоматическая инициализация AI-перевода в звонке');
    
    // Проверяем наличие клиента AI-перевода
    if (window.aiTranslationClient && window.aiTranslationClient.ready) {
      // Подключаем клиент к сигнальному серверу
      if (webrtcManager.socket) {
        window.aiTranslationClient.connectToSignalingServer(webrtcManager.socket);
        console.log('AI-переводчик подключен к сигнальному серверу');
      }
      
      // Устанавливаем информацию о звонке
      window.aiTranslationClient.setCallInfo(
        webrtcManager.roomId, 
        webrtcManager.targetUserId
      );
      console.log(`Установлена информация о звонке: комната ${webrtcManager.roomId}, собеседник ${webrtcManager.targetUserId}`);
      
      // Настраиваем аудио для перевода
      window.aiTranslationClient.setupAudioForTranslation(
        webrtcManager.localStream, 
        webrtcManager.remoteStream, 
        webrtcManager.peerConnection
      );
      console.log('AI-переводчик настроен для обработки аудио');
      
      // Включаем перевод глобально
      window.aiTranslationClient.setEnabled(true);
      console.log('AI-перевод глобально включен');
      
      // Автоматически запускаем перевод через 2 секунды
      setTimeout(() => {
        window.aiTranslationClient.startTranslation();
        console.log('AI-перевод автоматически запущен');
      }, 2000);
    } else {
      console.error('Клиент AI-перевода недоступен или не готов');
    }
  }
}

// Переключение микрофона
function toggleMute() {
  if (webrtcManager && webrtcManager.localStream) {
    const audioTracks = webrtcManager.localStream.getAudioTracks();
    if (audioTracks.length > 0) {
      const enabled = !audioTracks[0].enabled;
      audioTracks[0].enabled = enabled;
      
      const muteBtn = document.getElementById('muteBtn');
      if (muteBtn) {
        muteBtn.innerHTML = enabled ? '🔇' : '🔈';
        muteBtn.title = enabled ? 'Выключить микрофон' : 'Включить микрофон';
      }
    }
  }
}

// Переключение камеры
function toggleVideo() {
  if (webrtcManager && webrtcManager.localStream) {
    const videoTracks = webrtcManager.localStream.getVideoTracks();
    if (videoTracks.length > 0) {
      const enabled = !videoTracks[0].enabled;
      videoTracks[0].enabled = enabled;
      
      const videoBtn = document.getElementById('videoBtn');
      if (videoBtn) {
        videoBtn.innerHTML = enabled ? '📷' : '📷❌';
        videoBtn.title = enabled ? 'Выключить камеру' : 'Включить камеру';
      }
    }
  }
}

// Завершение звонка
function endCall() {
  if (webrtcManager) {
    webrtcManager.endCall();
  }
  
  resetCallUI();
}

// Очистка UI после звонка
function resetCallUI() {
  const callModal = document.getElementById('callModal');
  if (callModal) {
    callModal.remove();
  }
  
  const incomingCallDialog = document.getElementById('incomingCallDialog');
  if (incomingCallDialog) {
    incomingCallDialog.remove();
  }
  
  callInProgress = false;
  callType = null;
} 

// Функция для инициализации перевода речи в WebRTC звонке
function initTranslationInCall(stream, isOutgoingCall) {
  console.log('Инициализация AI перевода речи в звонке...');
  
  // Проверяем инициализацию клиента AI-перевода
  if (!window.aiTranslationClient || !window.aiTranslationClient.ready) {
    console.error('AI клиент перевода не инициализирован');
    return;
  }
  
  // Определяем направление перевода на основе типа звонка
  // Для исходящего звонка: переводим нашу речь на язык собеседника
  // Для входящего звонка: переводим речь собеседника на наш язык
  const sourceLanguage = isOutgoingCall ? translationSettings.sourceLanguage : 
                         (translationSettings.sourceLanguage === 'ru' ? 'en' : 'ru');
  const targetLanguage = isOutgoingCall ? 
                         (translationSettings.sourceLanguage === 'ru' ? 'en' : 'ru') : 
                         translationSettings.sourceLanguage;
  
  console.log(`Настройка AI перевода для ${isOutgoingCall ? 'исходящего' : 'входящего'} звонка`);
  console.log(`Язык источника: ${sourceLanguage}, Язык перевода: ${targetLanguage}`);
  
  // Получаем ID собеседника и комнаты из WebRTC менеджера
  const peerId = webrtcManager.targetUserId;
  const roomId = webrtcManager.roomId;
  
  // Обновляем настройки в клиенте AI-перевода
  window.aiTranslationClient.updateSettings({
    sourceLanguage: sourceLanguage,
    targetLanguage: targetLanguage,
    voice: translationSettings.voice,
    muteOriginal: translationSettings.muteOriginal,
    autoStart: true
  });
  
  // Подключаем клиент к сигнальному серверу
  window.aiTranslationClient.connectToSignalingServer(webrtcManager.socket);
  
  // Устанавливаем информацию о звонке
  window.aiTranslationClient.setCallInfo(roomId, peerId);
  
  // Настраиваем аудио для перевода
  window.aiTranslationClient.setupAudioForTranslation(
    stream, 
    webrtcManager.remoteStream, 
    webrtcManager.peerConnection
  );
  
  // Активируем клиент перевода
  window.aiTranslationClient.setEnabled(true);
  
  // Добавляем обработчики событий перевода
  window.aiTranslationClient.on('translation', (data) => {
    // Отображаем перевод в интерфейсе
    if (data.final) {
      showNotification(`Перевод: ${data.text}`);
    }
  });
  
  window.aiTranslationClient.on('error', (data) => {
    console.error('AI ошибка перевода:', data.message);
    showNotification(`Ошибка перевода: ${data.message}`, 'error');
  });
  
  console.log('AI перевод речи настроен');
}

// Обработчики событий для вкладок
tabButtons.forEach(button => {
  button.addEventListener('click', () => {
    // Скрываем все вкладки
    tabContents.forEach(tab => tab.classList.remove('active'));
    tabButtons.forEach(btn => btn.classList.remove('active'));
    
    // Показываем выбранную вкладку
    const tabName = button.getAttribute('data-tab');
    button.classList.add('active');
    
    if (tabName === 'friends') {
      friendsTab.classList.add('active');
    } else if (tabName === 'search') {
      searchTab.classList.add('active');
    } else if (tabName === 'settings') {
      settingsTab.classList.add('active');
      // Загружаем настройки при переходе на вкладку настроек
      loadTranslationSettings();
    }
  });
});

// Обработчик сохранения настроек
if (saveSettingsBtn) {
  saveSettingsBtn.addEventListener('click', saveTranslationSettings);
}

// Обработчики звонков с учетом перевода
if (audioCallBtn) {
  audioCallBtn.addEventListener('click', () => {
    if (selectedContact) {
      startAudioCall(selectedContact.id);
    }
  });
}

if (videoCallBtn) {
  videoCallBtn.addEventListener('click', () => {
    if (selectedContact) {
      startVideoCall(selectedContact.id);
    }
  });
}

// Функция для загрузки настроек перевода из localStorage
function loadTranslationSettings() {
  try {
    const savedSettings = localStorage.getItem('translation_settings');
    if (savedSettings) {
      translationSettings = JSON.parse(savedSettings);
      console.log('Настройки перевода загружены:', translationSettings);
    }
    
    // Заполняем форму настроек сохраненными значениями
    sourceLanguageInputs.forEach(input => {
      if(input.value === translationSettings.sourceLanguage) {
        input.checked = true;
      }
    });
    
    if(translationVoiceSelect) {
      translationVoiceSelect.value = translationSettings.voice;
    }
    
    if(muteOriginalCheckbox) {
      muteOriginalCheckbox.checked = translationSettings.muteOriginal;
    }
    
    if(useVADCheckbox) {
      useVADCheckbox.checked = translationSettings.useVAD;
    }
  } catch (error) {
    console.error('Ошибка при загрузке настроек перевода:', error);
  }
}

// Функция для сохранения настроек перевода в localStorage
function saveTranslationSettings() {
  try {
    // Получаем значения из формы
    sourceLanguageInputs.forEach(input => {
      if(input.checked) {
        translationSettings.sourceLanguage = input.value;
      }
    });
    
    if(translationVoiceSelect) {
      translationSettings.voice = translationVoiceSelect.value;
    }
    
    if(muteOriginalCheckbox) {
      translationSettings.muteOriginal = muteOriginalCheckbox.checked;
    }
    
    if(useVADCheckbox) {
      translationSettings.useVAD = useVADCheckbox.checked;
    }
    
    // Автоматически устанавливаем targetLanguage как противоположный sourceLanguage
    translationSettings.targetLanguage = translationSettings.sourceLanguage === 'ru' ? 'en' : 'ru';
    
    // Сохраняем настройки в localStorage
    localStorage.setItem('translation_settings', JSON.stringify(translationSettings));
    console.log('Настройки перевода сохранены:', translationSettings);
    
    // Обновляем настройки в сервисе перевода, если он инициализирован
    if(window.translateService && window.translateService.initialized) {
      window.translateService.updateSettings(translationSettings);
    }
    
    // Показываем сообщение об успешном сохранении
    showNotification('Настройки перевода сохранены');
  } catch (error) {
    console.error('Ошибка при сохранении настроек перевода:', error);
    showError('Не удалось сохранить настройки');
  }
}

// Показывает уведомление
function showNotification(message) {
  const notification = document.createElement('div');
  notification.className = 'notification';
  notification.textContent = message;
  document.body.appendChild(notification);
  
  // Удаляем уведомление через 3 секунды
  setTimeout(() => {
    notification.classList.add('hide');
    setTimeout(() => {
      document.body.removeChild(notification);
    }, 300);
  }, 3000);
}

// Инициализация WebRTC
function initWebRTC() {
  if (webrtcManager) return;
  
  webrtcManager = new WebRTCManager();
  
  if (currentUser && currentUser.id) {
    webrtcManager.init(currentUser.id);
    
    // Устанавливаем обработчики событий
    webrtcManager.onIncomingCall = (callerId, roomId, callType) => {
      // Находим информацию о звонящем
      // Преобразуем ID звонящего и ID контактов в строки для корректного сравнения
      const callerIdStr = String(callerId);
      const callerContact = contacts.find(c => String(c.id) === callerIdStr);
      let callerName = 'Неизвестный';
      
      if (callerContact) {
        callerName = callerContact.firstName || callerContact.name || 'Контакт';
      }
      
      console.log(`Входящий звонок от ${callerName} (ID: ${callerIdStr}), доступные контакты:`, 
                  contacts.map(c => `${c.firstName || c.name} (ID: ${c.id})`).join(', '));
      
      showIncomingCallDialog(callerName, callerIdStr, callType);
    };
    
    webrtcManager.onCallAccepted = () => {
      console.log('Звонок принят, соединение установлено');
    };
    
    webrtcManager.onCallRejected = () => {
      showError('Звонок отклонен');
      resetCallUI();
    };
    
    webrtcManager.onCallEnded = (reason) => {
      let message = 'Звонок завершен';
      if (reason) {
        message = reason;
      }
      console.log(message);
      resetCallUI();
    };
    
    webrtcManager.onLocalStreamAvailable = (stream) => {
      const localVideo = document.getElementById('localVideo');
      if (localVideo) {
        localVideo.srcObject = stream;
      }
    };
    
    webrtcManager.onRemoteStreamAvailable = (stream) => {
      const remoteVideo = document.getElementById('remoteVideo');
      if (remoteVideo) {
        remoteVideo.srcObject = stream;
      }
    };
    
    webrtcManager.onError = (message) => {
      showError(message);
      resetCallUI();
    };
    
    console.log('WebRTC менеджер инициализирован');
  } else {
    console.warn('Невозможно инициализировать WebRTC: отсутствует ID пользователя');
  }
}

// Показать диалог входящего звонка
function showIncomingCallDialog(callerName, callerId, callType) {
  try {
    // Проверяем, нет ли уже диалога звонка
    const existingDialog = document.getElementById('incomingCallDialog');
    if (existingDialog) {
      console.log('Диалог входящего звонка уже отображается, удаляем старый');
      existingDialog.remove();
    }
    
    const callDialog = document.createElement('div');
    callDialog.className = 'incoming-call-dialog';
    callDialog.id = 'incomingCallDialog';
    
    callDialog.innerHTML = `
      <div class="incoming-call-content">
        <div class="incoming-call-header">Входящий ${callType === 'video' ? 'видео' : 'аудио'}звонок</div>
        <div class="incoming-call-name">${callerName}</div>
        <div class="incoming-call-controls">
          <button id="acceptCallBtn" class="accept-call-btn">Принять</button>
          <button id="rejectCallBtn" class="reject-call-btn">Отклонить</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(callDialog);
    
    // Обработчики кнопок
    const acceptBtn = document.getElementById('acceptCallBtn');
    const rejectBtn = document.getElementById('rejectCallBtn');
    
    if (acceptBtn) {
      acceptBtn.addEventListener('click', () => {
        acceptIncomingCall(callType);
        callDialog.remove();
      });
    }
    
    if (rejectBtn) {
      rejectBtn.addEventListener('click', () => {
        rejectIncomingCall();
        callDialog.remove();
      });
    }
    
    console.log(`Отображен диалог входящего ${callType} звонка от ${callerName} (${callerId})`);
  } catch (error) {
    console.error('Ошибка при отображении диалога входящего звонка:', error);
    showError('Ошибка при обработке входящего звонка');
  }
}

// Принять входящий звонок
async function acceptIncomingCall(callType) {
  try {
    if (callInProgress) {
      showError('У вас уже идет звонок. Невозможно принять входящий звонок.');
      return;
    }
    
    callInProgress = true;
    console.log(`Принятие ${callType} звонка...`);
    
    // Проверяем, инициализирован ли WebRTC
    if (!webrtcManager) {
      console.log('WebRTC менеджер не инициализирован, создаем новый');
      initWebRTC();
    }
    
    // Проверяем, действительно ли WebRTC менеджер инициализирован
    if (!webrtcManager) {
      throw new Error('Не удалось инициализировать WebRTC менеджер');
    }
    
    // Проверяем, существует ли roomId
    if (!webrtcManager.roomId) {
      throw new Error('Отсутствует ID комнаты для звонка');
    }
    
    // Получаем информацию о звонящем
    const callerId = webrtcManager.targetUserId;
    
    // Создаем временный контакт для отображения в интерфейсе звонка
    const tempContact = {
      name: 'Собеседник',
      avatar: null
    };
    
    // Если звонящий - это один из наших контактов, используем его данные
    const caller = contacts.find(c => c.id === callerId);
    if (caller) {
      tempContact.name = caller.name;
      tempContact.avatar = caller.avatar;
    }
    
    // Создаем интерфейс звонка
    showCallInterface(tempContact);
    
    // Отвечаем на звонок
    await webrtcManager.answerCall(true);
  } catch (error) {
    console.error('Ошибка при принятии входящего звонка:', error);
    showError(`Не удалось ответить на звонок: ${error.message}`);
    resetCallUI();
    callInProgress = false;
  }
}

// Отклонить входящий звонок
function rejectIncomingCall() {
  if (webrtcManager) {
    webrtcManager.answerCall(false);
  }
}

// Остановка перевода речи
function stopTranslation() {
  console.log('Остановка AI перевода речи...');
  
  // Проверяем новый AI-переводчик
  if (window.aiTranslationClient) {
    // Выключаем перевод в текущем звонке
    window.aiTranslationClient.stopTranslation();
    
    // Удаляем все обработчики событий
    window.aiTranslationClient.off('translation', null);
    window.aiTranslationClient.off('error', null);
    window.aiTranslationClient.off('transcript', null);
    
    console.log('AI перевод остановлен');
  }
  
  // Проверяем старый механизм перевода (для обратной совместимости)
  if (window.translateService && window.translateService.translating) {
    window.translateService.stopTranslation();
    console.log('Перевод речи остановлен');
  }
}

// Завершение звонка
function endCall() {
  console.log('Завершение звонка и остановка AI-перевода...');
  
  if (webrtcManager) {
    webrtcManager.endCall();
  }
  
  // Останавливаем традиционный перевод речи (старый механизм)
  stopTranslation();
  
  // Останавливаем AI-перевод
  if (window.aiTranslationClient) {
    window.aiTranslationClient.stopTranslation();
    window.aiTranslationClient.setEnabled(false);
    console.log('AI-перевод остановлен');
  }
  
  // Останавливаем все треки локального потока
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  
  // Возвращаем интерфейс в исходное состояние
  resetCallUI();
  callInProgress = false;
}