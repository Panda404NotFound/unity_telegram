/**
 * Модуль интеграции с OpenAI WebRTC для перевода речи в реальном времени
 * Реализует подключение к OpenAI через WebSocket и WebRTC для Realtime API
 */

class OpenAIWebRTC {
  constructor() {
    this.webSocket = null;
    this.peerConnection = null;
    this.localStream = null;
    this.remoteStream = null;
    this.connectionState = 'disconnected';
    this.apiKey = null;
    this.targetLanguage = 'ru'; // Язык перевода по умолчанию
    this.instructions = null; // Инструкции для модели
    
    // OpenAI WebRTC конфигурация
    this.iceServers = [
      { urls: 'stun:stun.l.google.com:19302' }
    ];
    
    // WebSocket URL для OpenAI Realtime API
    this.realtimeWebSocketURL = 'wss://api.openai.com/v1/audio/realtime';
    
    // Обработчики событий
    this.eventListeners = {
      'connected': [],
      'disconnected': [],
      'translation-started': [],
      'translation-stopped': [],
      'error': [],
      'translation-result': [],
      'transcript': []
    };
    
    // Настройки модели перевода
    this.model = 'gpt-4o-mini-realtime-preview';
    this.voice = 'alloy';
    this.useVAD = true; // Voice Activity Detection
    
    // Буфер для удаления собственного голоса
    this.audioContext = null;
    this.microphoneNode = null;
    this.remoteAudioNode = null;
    this.mixerNode = null;
    
    this.loggingEnabled = true;
  }
  
  /**
   * Устанавливает API ключ OpenAI
   * @param {string} apiKey - API ключ OpenAI
   * @returns {boolean} - Успешно ли установлен ключ
   */
  setApiKey(apiKey) {
    if (!apiKey || apiKey.trim() === '') {
      this.log('Пустой API ключ OpenAI. Проверьте настройки.', 'warn');
      return false;
    }
    
    this.apiKey = apiKey.trim();
    this.log('API ключ OpenAI установлен');
    return true;
  }
  
  /**
   * Получает API ключ OpenAI из разных источников
   * @returns {Promise<string|null>} - Промис с API ключом или null если не найден
   */
  async getApiKey() {
    // Если ключ уже установлен, вернём его
    if (this.apiKey) {
      return this.apiKey;
    }
    
    try {
      // Пытаемся получить ключ с сервера (централизованный метод)
      try {
        const response = await fetch('/api/openai-auth', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ type: 'webrtc' })
        });
        
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.data && data.data.api_key) {
            this.setApiKey(data.data.api_key);
            this.log('Получен API ключ OpenAI с сервера');
            return this.apiKey;
          }
        } else {
          this.log('Не удалось получить API ключ с сервера', 'warn');
        }
      } catch (serverError) {
        this.log(`Ошибка при запросе API ключа с сервера: ${serverError.message}`, 'warn');
        // Продолжаем с другими источниками, если сервер недоступен
      }
      
      // Запасной вариант: проверяем локальное хранилище
      const savedApiKey = localStorage.getItem('openai_api_key');
      if (savedApiKey && savedApiKey.trim() !== '') {
        this.setApiKey(savedApiKey);
        this.log('Получен API ключ OpenAI из локального хранилища', 'warn');
        return this.apiKey;
      }
      
      this.log('Не удалось найти API ключ OpenAI. Настройте .env файл на сервере.', 'error');
      return null;
      
    } catch (error) {
      this.log(`Ошибка при получении API ключа: ${error.message}`, 'error');
      return null;
    }
  }
  
  /**
   * Устанавливает целевой язык перевода
   * @param {string} languageCode - Код языка (ru, en)
   * @param {string} instructions - Инструкции для модели на выбранном языке
   */
  setTargetLanguage(languageCode, instructions = null) {
    this.targetLanguage = languageCode;
    if (instructions) {
      this.instructions = instructions;
    }
    this.log(`Установлен целевой язык перевода: ${languageCode}`);
    
    // Если соединение уже установлено, нужно переподключиться с новым языком
    if (this.connectionState === 'connected') {
      this.log('Переподключение для изменения языка перевода...');
      this.disconnect().then(() => {
        this.connect();
      });
    }
  }
  
  /**
   * Устанавливает модель для перевода
   * @param {string} modelId - ID модели
   */
  setModel(modelId) {
    this.model = modelId;
    this.log(`Установлена модель: ${modelId}`);
    
    // Если соединение уже установлено, возможно потребуется переподключение
    if (this.connectionState === 'connected') {
      this.log('Переподключение для изменения модели...');
      this.disconnect().then(() => {
        this.connect();
      });
    }
  }
  
  /**
   * Устанавливает голос для синтеза речи
   * @param {string} voiceId - ID голоса
   */
  setVoice(voiceId) {
    this.voice = voiceId;
    this.log(`Установлен голос: ${voiceId}`);
    
    // Отправляем новые настройки если соединение активно
    if (this.connectionState === 'connected' && this.webSocket && this.webSocket.readyState === WebSocket.OPEN) {
      const message = {
        type: 'update_session',
        data: {
          voice: this.voice
        }
      };
      this.webSocket.send(JSON.stringify(message));
      this.log('Отправлено обновление голоса');
    }
  }
  
  /**
   * Устанавливает режим VAD (Voice Activity Detection)
   * @param {boolean} useVAD - Использовать VAD
   */
  setUseVAD(useVAD) {
    this.useVAD = useVAD;
    this.log(`Режим VAD: ${useVAD ? 'включен' : 'выключен'}`);
  }
  
  /**
   * Установка соединения с OpenAI WebRTC
   * @returns {Promise} Промис, разрешающийся при успешном подключении
   */
  async connect() {
    if (this.connectionState === 'connected' || this.connectionState === 'connecting') {
      this.log('Соединение уже активно или устанавливается');
      return Promise.resolve();
    }
    
    try {
      // Пытаемся получить API ключ из разных источников
      const apiKey = await this.getApiKey();
      
      if (!apiKey) {
        const error = 'Не удалось получить API ключ OpenAI. Необходимо добавить ключ в .env файл на сервере.';
        this.log(error, 'error');
        this.triggerEvent('error', { message: error });
        return Promise.reject(new Error(error));
      }
    
      this.connectionState = 'connecting';
      this.log('Установка соединения с OpenAI Realtime API...');
      
      // Инициализируем WebSocket соединение с OpenAI Realtime API
      await this.setupWebSocket();
      
      // Инициализируем WebRTC соединение
      await this.setupWebRTC();
      
      this.connectionState = 'connected';
      this.triggerEvent('connected');
      this.log('Соединение успешно установлено');
      
      return Promise.resolve();
    } catch (error) {
      this.connectionState = 'disconnected';
      this.log(`Ошибка при установке соединения: ${error.message}`, 'error');
      this.triggerEvent('error', { message: error.message });
      
      // Очищаем ресурсы при ошибке
      await this.cleanupResources();
      
      return Promise.reject(error);
    }
  }
  
  /**
   * Настраивает WebSocket соединение с OpenAI Realtime API
   * @returns {Promise} Промис, разрешающийся при успешной инициализации WebSocket
   */
  setupWebSocket() {
    return new Promise((resolve, reject) => {
      try {
        // Формируем URL с параметрами
        const params = new URLSearchParams({
          model: this.model,
          voice: this.voice
        });
        
        if (this.useVAD) {
          params.append('vad', 'true');
        }
        
        const wsUrl = `${this.realtimeWebSocketURL}?${params.toString()}`;
        this.log(`Инициализация WebSocket: ${wsUrl}`);
        
        // Создаем WebSocket соединение
        this.webSocket = new WebSocket(wsUrl);
        
        // Добавляем заголовок авторизации
        this.webSocket.addEventListener('open', async () => {
          try {
            // Проверяем, есть ли у нас API ключ
            if (!this.apiKey) {
              // Пытаемся получить ключ еще раз в случае, если он не был получен ранее
              await this.getApiKey();
              
              if (!this.apiKey) {
                const error = 'Не удалось получить API ключ OpenAI для авторизации';
                this.log(error, 'error');
                throw new Error(error);
              }
            }
            
            // Отправляем заголовок с API ключом
            const authMessage = {
              type: 'auth',
              data: {
                api_key: this.apiKey
              }
            };
            this.webSocket.send(JSON.stringify(authMessage));
            
            // Отправляем инструкции для перевода
            const configMessage = {
              type: 'config',
              data: {
                translationLanguage: this.targetLanguage,
                instructions: this.instructions || `Переводи все что говорит пользователь на ${this.targetLanguage === 'ru' ? 'русский' : 'English'} язык дословно и точно.`
              }
            };
            this.webSocket.send(JSON.stringify(configMessage));
            
            this.log('WebSocket соединение установлено');
            resolve();
          } catch (error) {
            this.log(`Ошибка при установке WebSocket соединения: ${error.message}`, 'error');
            reject(error);
          }
        });
        
        // Обработчик сообщений от WebSocket
        this.webSocket.addEventListener('message', (event) => {
          try {
            const message = JSON.parse(event.data);
            this.log(`Получено сообщение: ${message.type}`);  
            
            switch (message.type) {
              case 'connection_successful':
                this.log('Соединение с OpenAI Realtime API успешно установлено');
                break;
                
              case 'sdp_answer':
                // Получен SDP ответ от сервера - обрабатываем его
                this.log('Получен SDP ответ');
                this.handleSdpAnswer(message.data.sdp);
                break;
                
              case 'ice_candidate':
                // Получен ICE кандидат от сервера
                this.log('Получен ICE кандидат от сервера');
                this.handleIceCandidate(message.data.candidate);
                break;
                
              case 'translation':
                // Получено сообщение с переводом
                this.triggerEvent('translation-result', message.data);
                break;
                
              case 'transcript':
                // Получена исходная расшифровка речи
                this.triggerEvent('transcript', message.data);
                break;
                
              case 'error':
                const errorMsg = message.data?.message || 'Неизвестная ошибка OpenAI API';
                this.log(`Ошибка OpenAI API: ${errorMsg}`, 'error');
                this.triggerEvent('error', { message: errorMsg });
                break;
                
              default:
                this.log(`Получен неизвестный тип сообщения: ${message.type}`);
            }
          } catch (error) {
            this.log(`Ошибка обработки сообщения WebSocket: ${error.message}`, 'error');
          }
        });
        
        // Обработчик ошибок WebSocket
        this.webSocket.addEventListener('error', (error) => {
          this.log(`Ошибка WebSocket: ${error}`, 'error');
          this.triggerEvent('error', { message: 'Ошибка WebSocket соединения' });
          reject(error);
        });
        
        // Обработчик закрытия соединения
        this.webSocket.addEventListener('close', (event) => {
          this.log(`WebSocket соединение закрыто: код ${event.code}, причина: ${event.reason || 'неизвестна'}`);
          this.connectionState = 'disconnected';
          this.triggerEvent('disconnected');
        });
        
      } catch (error) {
        this.log(`Ошибка при инициализации WebSocket: ${error.message}`, 'error');
        this.triggerEvent('error', { message: error.message });
        reject(error);
      }
    });
  }
  
  /**
   * Настраивает WebRTC соединение для передачи аудио
   * @returns {Promise} Промис, разрешающийся при успешной инициализации WebRTC
   */
  async setupWebRTC() {
    return new Promise(async (resolve, reject) => {
      try {
        this.log('Начало настройки WebRTC соединения...');
        
        // Создаем RTCPeerConnection с STUN серверами для NAT traversal
        const config = {
          iceServers: this.iceServers
        };
        
        this.peerConnection = new RTCPeerConnection(config);
        
        // Получаем доступ к микрофону пользователя
        this.localStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false
        });
        
        this.log('Доступ к микрофону получен');
        
        // Добавляем аудиотреки в peer connection
        this.localStream.getTracks().forEach(track => {
          this.peerConnection.addTrack(track, this.localStream);
        });
        
        // Создаем remote stream для получения аудио от OpenAI
        this.remoteStream = new MediaStream();
        
        // Обрабатываем получение удаленных треков и добавляем их в удаленный поток
        this.peerConnection.ontrack = (event) => {
          this.log('Получен удаленный аудиотрек');
          event.streams[0].getTracks().forEach(track => {
            this.remoteStream.addTrack(track);
          });
          this.triggerEvent('remote-stream-ready', { stream: this.remoteStream });
        };
        
        // Обработчик ICE кандидатов - отправляем их на сервер OpenAI через WebSocket
        this.peerConnection.onicecandidate = (event) => {
          if (event.candidate) {
            const message = {
              type: 'ice_candidate',
              data: {
                candidate: event.candidate
              }
            };
            
            if (this.webSocket && this.webSocket.readyState === WebSocket.OPEN) {
              this.webSocket.send(JSON.stringify(message));
              this.log('Отправлен ICE кандидат на сервер');
            }
          }
        };
        
        // Обработчик изменения состояния соединения
        this.peerConnection.oniceconnectionstatechange = () => {
          this.log(`Состояние ICE соединения: ${this.peerConnection.iceConnectionState}`);
          
          if (this.peerConnection.iceConnectionState === 'connected' || 
              this.peerConnection.iceConnectionState === 'completed') {
            this.log('WebRTC соединение установлено');
          } else if (this.peerConnection.iceConnectionState === 'failed' || 
                    this.peerConnection.iceConnectionState === 'disconnected' || 
                    this.peerConnection.iceConnectionState === 'closed') {
            const error = `WebRTC соединение потеряно: ${this.peerConnection.iceConnectionState}`;
            this.log(error, 'error');
            this.triggerEvent('error', { message: error });
          }
        };
        
        // Создаем и отправляем предложение (offer)
        const offer = await this.peerConnection.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: false
        });
        
        await this.peerConnection.setLocalDescription(offer);
        
        // Отправляем предложение на сервер OpenAI через WebSocket
        const message = {
          type: 'sdp_offer',
          data: {
            sdp: offer
          }
        };
        
        if (this.webSocket && this.webSocket.readyState === WebSocket.OPEN) {
          this.webSocket.send(JSON.stringify(message));
          this.log('Отправлено SDP предложение на сервер');
          resolve();
        } else {
          const error = 'WebSocket соединение не установлено или закрыто';
          this.log(error, 'error');
          reject(new Error(error));
        }
      } catch (error) {
        this.log(`Ошибка при настройке WebRTC: ${error.message}`, 'error');
        this.triggerEvent('error', { message: error.message });
        reject(error);
      }
    });
  }
  
  /**
   * Обрабатывает SDP ответ от сервера OpenAI
   * @param {RTCSessionDescriptionInit} sdp - SDP описание ответа
   */
  async handleSdpAnswer(sdp) {
    try {
      if (!this.peerConnection) {
        this.log('Невозможно обработать SDP ответ: нет активного WebRTC соединения', 'error');
        return;
      }
      
      // Создаем RTCSessionDescription из полученного SDP
      const remoteDesc = new RTCSessionDescription(sdp);
      
      // Устанавливаем удаленное описание сессии
      await this.peerConnection.setRemoteDescription(remoteDesc);
      this.log('SDP ответ успешно обработан');
    } catch (error) {
      this.log(`Ошибка при обработке SDP ответа: ${error.message}`, 'error');
      this.triggerEvent('error', { message: error.message });
    }
  }
  
  /**
   * Обрабатывает ICE кандидат от сервера OpenAI
   * @param {RTCIceCandidate} candidate - ICE кандидат
   */
  async handleIceCandidate(candidate) {
    try {
      if (!this.peerConnection) {
        this.log('Невозможно обработать ICE кандидат: нет активного WebRTC соединения', 'error');
        return;
      }
      
      // Добавляем полученный ICE кандидат
      await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      this.log('ICE кандидат успешно добавлен');
    } catch (error) {
      this.log(`Ошибка при обработке ICE кандидата: ${error.message}`, 'error');
      this.triggerEvent('error', { message: error.message });
    }
  }
  
  /**
   * Инициализация WebSocket соединения с OpenAI
   * @returns {Promise} Промис, разрешающийся при успешном подключении WebSocket
   */
  /**
   * Создает аудио контекст для управления аудио-потоками
   * @returns {Promise} Промис, разрешающийся при успешной инициализации аудио контекста
   */
  async setupAudioContext() {
    try {
      // Если уже есть аудио контекст, используем его
      if (this.audioContext) {
        return Promise.resolve();
      }
      
      this.log('Создание аудио контекста...');
      
      // Создаем аудио контекст
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      
      // Создаем микшер для управления входящими аудио-потоками
      this.mixerNode = this.audioContext.createGain();
      this.mixerNode.gain.value = 1.0; // Стандартное усиление
      this.mixerNode.connect(this.audioContext.destination);
      
      // Если есть удаленный поток, подключаем его к аудио контексту
      if (this.remoteStream) {
        await this.connectRemoteStreamToAudio();
      }
      
      this.log('Аудио контекст успешно создан');
      return Promise.resolve();
    } catch (error) {
      this.log(`Ошибка при создании аудио контекста: ${error.message}`, 'error');
      return Promise.reject(error);
    }
  }
  
  /**
   * Подключает удаленный аудиопоток к аудио контексту
   * @returns {Promise} Промис, разрешающийся при успешном подключении
   */
  async connectRemoteStreamToAudio() {
    try {
      if (!this.audioContext) {
        await this.setupAudioContext();
      }
      
      if (!this.remoteStream) {
        this.log('Нет удаленного аудиопотока для подключения', 'error');
        return Promise.reject(new Error('Нет удаленного аудиопотока'));
      }
      
      // Создаем аудионоду для удаленного потока
      this.remoteAudioNode = this.audioContext.createMediaStreamSource(this.remoteStream);
      
      // Создаем гейн ноду для контроля громкости оригинального голоса
      this.originalVolumeNode = this.audioContext.createGain();
      // Заглушаем оригинальный голос (0 означает полное заглушение)
      this.originalVolumeNode.gain.value = 0.0;
      
      // Подключаем удаленный поток к гейн ноде для заглушения
      this.remoteAudioNode.connect(this.originalVolumeNode);
      // Затем подключаем к микшеру
      this.originalVolumeNode.connect(this.mixerNode);
      
      this.log('Удаленный аудиопоток подключен к выводу с заглушением оригинального голоса');
      return Promise.resolve();
    } catch (error) {
      this.log(`Ошибка при подключении удаленного аудиопотока: ${error.message}`, 'error');
      return Promise.reject(error);
    }
  }
  
  /**
   * Подключает переведенный аудиопоток к выводу
   * @param {MediaStream} translatedStream - Поток с переведенным аудио
   * @returns {Promise} Промис, разрешающийся при успешном подключении
   */
  async connectTranslatedAudioToOutput(translatedStream) {
    try {
      if (!this.audioContext) {
        await this.setupAudioContext();
      }
      
      if (!translatedStream) {
        this.log('Нет переведенного аудиопотока для подключения', 'error');
        return Promise.reject(new Error('Нет переведенного аудиопотока'));
      }
      
      // Сохраняем ссылку на поток перевода
      this.translatedStream = translatedStream;
      
      // Создаем аудионоду для переведенного аудио
      this.translatedAudioNode = this.audioContext.createMediaStreamSource(translatedStream);
      
      // Создаем гейн ноду для контроля громкости перевода
      this.translatedVolumeNode = this.audioContext.createGain();
      this.translatedVolumeNode.gain.value = 1.0; // Полная громкость для перевода
      
      // Подключаем переведенный поток к гейн ноде
      this.translatedAudioNode.connect(this.translatedVolumeNode);
      // Затем подключаем к микшеру
      this.translatedVolumeNode.connect(this.mixerNode);
      
      this.log('Переведенный аудиопоток подключен к выводу');
      return Promise.resolve();
    } catch (error) {
      this.log(`Ошибка при подключении переведенного аудиопотока: ${error.message}`, 'error');
      return Promise.reject(error);
    }
  }
  
  /**
   * Очищает все ресурсы WebRTC и WebSocket
   * @returns {Promise} Промис, разрешающийся при успешной очистке ресурсов
   */
  async cleanupResources() {
    try {
      this.log('Очистка ресурсов...');
      
      // Закрываем WebSocket соединение, если оно открыто
      if (this.webSocket && this.webSocket.readyState !== WebSocket.CLOSED) {
        this.webSocket.close();
        this.webSocket = null;
      }
      
      // Останавливаем все треки в локальном потоке
      if (this.localStream) {
        this.localStream.getTracks().forEach(track => {
          track.stop();
        });
        this.localStream = null;
      }
      
      // Отключаем аудионоды, если они существуют
      if (this.remoteAudioNode) {
        this.remoteAudioNode.disconnect();
        this.remoteAudioNode = null;
      }
      
      if (this.microphoneNode) {
        this.microphoneNode.disconnect();
        this.microphoneNode = null;
      }
      
      // Очищаем новые аудио-компоненты для перевода
      if (this.originalVolumeNode) {
        this.originalVolumeNode.disconnect();
        this.originalVolumeNode = null;
      }
      
      if (this.translatedAudioNode) {
        this.translatedAudioNode.disconnect();
        this.translatedAudioNode = null;
      }
      
      if (this.translatedVolumeNode) {
        this.translatedVolumeNode.disconnect();
        this.translatedVolumeNode = null;
      }
      
      // Останавливаем треки в потоке перевода, если он есть
      if (this.translatedStream) {
        this.translatedStream.getTracks().forEach(track => {
          track.stop();
        });
        this.translatedStream = null;
      }
      
      if (this.mixerNode) {
        this.mixerNode.disconnect();
        this.mixerNode = null;
      }
      
      // Закрываем peer connection
      if (this.peerConnection) {
        this.peerConnection.close();
        this.peerConnection = null;
      }
      
      // Закрываем аудио контекст
      if (this.audioContext && this.audioContext.state !== 'closed') {
        await this.audioContext.close();
        this.audioContext = null;
      }
      
      this.connectionState = 'disconnected';
      this.log('Все ресурсы успешно очищены');
      return Promise.resolve();
    } catch (error) {
      this.log(`Ошибка при очистке ресурсов: ${error.message}`, 'error');
      return Promise.reject(error);
    }
  }
  
  /**
   * Отключается от OpenAI Realtime API и освобождает ресурсы
   * @returns {Promise} Промис, разрешающийся при успешном отключении
   */
  async disconnect() {
    if (this.connectionState === 'disconnected') {
      this.log('Соединение уже отключено');
      return Promise.resolve();
    }
    
    this.log('Отключение от OpenAI Realtime API...');
    this.connectionState = 'disconnecting';
    
    try {
      // Очищаем все ресурсы
      await this.cleanupResources();
      
      this.triggerEvent('disconnected');
      this.log('Успешно отключено от OpenAI Realtime API');
      return Promise.resolve();
    } catch (error) {
      this.log(`Ошибка при отключении: ${error.message}`, 'error');
      this.connectionState = 'disconnected';
      this.triggerEvent('error', { message: error.message });
      return Promise.reject(error);
    }
  }
    
  /**
   * Инициализация WebSocket соединения с OpenAI
   * @returns {Promise} Промис, разрешающийся при успешном подключении WebSocket
   */
  /**
   * Выводит в консоль логи работы модуля
   * @param {string} message - Сообщение для лога
   * @param {string} level - Уровень лога (log, error, warn)
   */
  log(message, level = 'log') {
    if (!this.loggingEnabled) return;
    
    const logPrefix = '[OpenAIWebRTC]';
    
    switch (level) {
      case 'error':
        console.error(`${logPrefix} ${message}`);
        break;
      case 'warn':
        console.warn(`${logPrefix} ${message}`);
        break;
      default:
        console.log(`${logPrefix} ${message}`);
    }
  }
  
  /**
   * Добавляет обработчик события
   * @param {string} eventName - Название события
   * @param {Function} callback - Функция-обработчик
   */
  addEventListener(eventName, callback) {
    if (!this.eventListeners[eventName]) {
      this.eventListeners[eventName] = [];
    }
    
    this.eventListeners[eventName].push(callback);
    this.log(`Добавлен обработчик события: ${eventName}`);
  }
  
  /**
   * Удаляет обработчик события
   * @param {string} eventName - Название события
   * @param {Function} callback - Функция-обработчик для удаления
   */
  removeEventListener(eventName, callback) {
    if (!this.eventListeners[eventName]) return;
    
    this.eventListeners[eventName] = this.eventListeners[eventName].filter(
      listener => listener !== callback
    );
    
    this.log(`Удален обработчик события: ${eventName}`);
  }
  
  /**
   * Запускает событие и вызывает все зарегистрированные обработчики
   * @param {string} eventName - Название события
   * @param {Object} data - Данные для передачи в обработчик
   */
  triggerEvent(eventName, data = {}) {
    if (!this.eventListeners[eventName]) return;
    
    this.log(`Запущено событие: ${eventName}`);
    this.eventListeners[eventName].forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        this.log(`Ошибка в обработчике события ${eventName}: ${error.message}`, 'error');
      }
    });
  }
  
  /**
   * Инициализация WebSocket соединения с OpenAI
   * @returns {Promise} Промис, разрешающийся при успешном подключении WebSocket
   */
  async initWebSocket() {
    return new Promise((resolve, reject) => {
      try {
        // Закрываем существующее соединение, если есть
        if (this.webSocket && this.webSocket.readyState !== WebSocket.CLOSED) {
          this.webSocket.close();
        }
        
        this.log(`Подключение к WebSocket: ${this.openAIWebSocketURL}`);
        
        // Создаем новое WebSocket соединение
        this.webSocket = new WebSocket(this.openAIWebSocketURL);
        
        // Настраиваем обработчики событий WebSocket
        this.webSocket.onopen = () => {
          this.log('WebSocket соединение установлено');
          
          // Отправляем сообщение с настройками для OpenAI
          const message = {
            model: this.model,
            target_language: this.targetLanguage,
            voice: "alloy", // Голос для перевода
            response_format: "aac" // Формат аудио
          };
          
          this.webSocket.send(JSON.stringify(message));
          this.log('Отправлены настройки перевода');
          
          resolve();
        };
        
        this.webSocket.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            this.log(`Получено сообщение от WebSocket: ${JSON.stringify(data)}`);
            
            // Обрабатываем сообщения от сервера
            if (data.type === 'transcription') {
              // Исходная расшифровка речи
              this.triggerEvent('transcript', data);
            } else if (data.type === 'translation' || data.type === 'translation_result') {
              // Результат перевода
              this.triggerEvent('translation-result', data.result || data);
              this.log(`Получен результат перевода: ${JSON.stringify(data.result || data)}`);
            } else if (data.type === 'error') {
              // Ошибка от сервера
              const errorMessage = data.error || data.message || 'Неизвестная ошибка';
              this.log(`Ошибка от OpenAI API: ${errorMessage}`, 'error');
              this.triggerEvent('error', { message: errorMessage });
            } else if (data.type === 'sdp_answer' || data.type === 'answer') {
              // SDP ответ для WebRTC
              this.handleSdpAnswer(data.sdp);
            } else if (data.type === 'ice_candidate') {
              // ICE кандидат
              this.handleIceCandidate(data.candidate);
            } else if (data.type === 'offer') {
              // WebRTC offer
              this.handleWebRTCOffer(data.sdp);
            } 
          } catch (error) {
            this.log(`Ошибка при обработке сообщения WebSocket: ${error.message}`, 'error');
            this.triggerEvent('error', { message: error.message });
          }
        };
        
        this.webSocket.onerror = (error) => {
          this.log(`Ошибка WebSocket: ${error.message || 'Неизвестная ошибка'}`, 'error');
          this.triggerEvent('error', { message: 'Ошибка WebSocket соединения' });
          reject(error);
        };
        
        this.webSocket.onclose = () => {
          this.log('WebSocket соединение закрыто');
          this.connectionState = 'disconnected';
          this.triggerEvent('disconnected', { reason: 'WebSocket соединение закрыто' });
        };
        
      } catch (error) {
        this.log(`Ошибка инициализации WebSocket: ${error.message}`, 'error');
        reject(error);
      }
    });
  }
  
  /**
   * Инициализация WebRTC соединения
   * @returns {Promise} Промис, разрешающийся при успешной инициализации WebRTC
   */
  async initWebRTC() {
    return new Promise(async (resolve, reject) => {
      try {
        // Создаем RTCPeerConnection
        this.peerConnection = new RTCPeerConnection({
          iceServers: this.iceServers
        });
        
        // Настраиваем обработчики событий для ICE
        this.peerConnection.onicecandidate = (event) => {
          if (event.candidate) {
            // Отправляем ICE-кандидата на сервер OpenAI
            if (this.webSocket && this.webSocket.readyState === WebSocket.OPEN) {
              const message = {
                type: 'ice_candidate',
                candidate: event.candidate
              };
              this.webSocket.send(JSON.stringify(message));
              this.log('ICE кандидат отправлен');
            }
          }
        };
        
        // Обработчик изменения состояния соединения
        this.peerConnection.onconnectionstatechange = () => {
          this.log(`Состояние WebRTC соединения изменилось: ${this.peerConnection.connectionState}`);
          
          if (this.peerConnection.connectionState === 'connected') {
            this.connectionState = 'connected';
            this.triggerEvent('connected', { message: 'WebRTC соединение установлено' });
            resolve();
          } else if (this.peerConnection.connectionState === 'disconnected' || 
                     this.peerConnection.connectionState === 'failed' ||
                     this.peerConnection.connectionState === 'closed') {
            this.connectionState = 'disconnected';
            this.triggerEvent('disconnected', { 
              reason: `WebRTC соединение: ${this.peerConnection.connectionState}` 
            });
          }
        };
        
        // Обработчик для получения удаленного аудио-потока от OpenAI
        this.peerConnection.ontrack = (event) => {
          this.log('Получен удаленный аудио-поток от OpenAI');
          this.remoteStream = event.streams[0];
          this.triggerEvent('translation-started', { stream: this.remoteStream });
        };
        
        // Получаем локальный аудио-поток (микрофон пользователя)
        try {
          this.localStream = await navigator.mediaDevices.getUserMedia({ 
            audio: true, 
            video: false 
          });
          
          this.log('Получен доступ к микрофону');
          
          // Добавляем аудио-треки в peer connection
          this.localStream.getAudioTracks().forEach(track => {
            this.peerConnection.addTrack(track, this.localStream);
            this.log('Аудио-трек добавлен в peer connection');
          });
          
          // Создаем и отправляем SDP-оффер
          const offer = await this.peerConnection.createOffer();
          await this.peerConnection.setLocalDescription(offer);
          
          if (this.webSocket && this.webSocket.readyState === WebSocket.OPEN) {
            const message = {
              type: 'offer',
              sdp: offer.sdp
            };
            this.webSocket.send(JSON.stringify(message));
            this.log('SDP-оффер отправлен');
          }
          
        } catch (mediaError) {
          this.log(`Ошибка доступа к медиа-устройствам: ${mediaError.message}`, 'error');
          this.triggerEvent('error', { 
            message: 'Нет доступа к микрофону. Проверьте разрешения браузера.' 
          });
          reject(mediaError);
        }
        
      } catch (error) {
        this.log(`Ошибка инициализации WebRTC: ${error.message}`, 'error');
        reject(error);
      }
    });
  }
  
  /**
   * Обработка WebRTC оффера от OpenAI
   * @param {string} sdp - Session Description Protocol данные
   */
  async handleWebRTCOffer(sdp) {
    try {
      if (!this.peerConnection) {
        throw new Error('Peer Connection не инициализирован');
      }
      
      // Устанавливаем удаленное описание сессии
      await this.peerConnection.setRemoteDescription({
        type: 'offer',
        sdp: sdp
      });
      
      this.log('Установлено удаленное описание сессии');
      
      // Создаем и отправляем ответ
      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);
      
      if (this.webSocket && this.webSocket.readyState === WebSocket.OPEN) {
        const message = {
          type: 'answer',
          sdp: answer.sdp
        };
        this.webSocket.send(JSON.stringify(message));
        this.log('SDP-ответ отправлен');
      }
      
    } catch (error) {
      this.log(`Ошибка обработки WebRTC оффера: ${error.message}`, 'error');
      this.triggerEvent('error', { message: error.message });
    }
  }
  
  /**
   * Добавление ICE кандидата
   * @param {RTCIceCandidate} candidate - ICE кандидат
   */
  async addIceCandidate(candidate) {
    try {
      if (!this.peerConnection) {
        throw new Error('Peer Connection не инициализирован');
      }
      
      await this.peerConnection.addIceCandidate(candidate);
      this.log('ICE кандидат добавлен');
      
    } catch (error) {
      this.log(`Ошибка добавления ICE кандидата: ${error.message}`, 'error');
      this.triggerEvent('error', { message: error.message });
    }
  }
  
  /**
   * Разрыв соединения
   * @returns {Promise} Промис, разрешающийся при успешном отключении
   */
  async disconnect() {
    try {
      this.log('Отключение...');
      
      // Останавливаем локальный аудио-поток
      if (this.localStream) {
        this.localStream.getTracks().forEach(track => track.stop());
        this.localStream = null;
        this.log('Локальный аудио-поток остановлен');
      }
      
      // Закрываем WebRTC соединение
      if (this.peerConnection) {
        this.peerConnection.close();
        this.peerConnection = null;
        this.log('WebRTC соединение закрыто');
      }
      
      // Закрываем WebSocket соединение
      if (this.webSocket && this.webSocket.readyState !== WebSocket.CLOSED) {
        this.webSocket.close();
        this.webSocket = null;
        this.log('WebSocket соединение закрыто');
      }
      
      this.connectionState = 'disconnected';
      this.triggerEvent('disconnected', { reason: 'Инициировано пользователем' });
      
      return Promise.resolve();
    } catch (error) {
      this.log(`Ошибка отключения: ${error.message}`, 'error');
      return Promise.reject(error);
    }
  }
  
  /**
   * Добавляет обработчик события
   * @param {string} eventName - Название события
   * @param {Function} callback - Функция-обработчик
   */
  addEventListener(eventName, callback) {
    if (!this.eventListeners[eventName]) {
      this.eventListeners[eventName] = [];
    }
    
    this.eventListeners[eventName].push(callback);
  }
  
  /**
   * Удаляет обработчик события
   * @param {string} eventName - Название события
   * @param {Function} callback - Функция-обработчик для удаления
   */
  removeEventListener(eventName, callback) {
    if (!this.eventListeners[eventName]) return;
    
    this.eventListeners[eventName] = this.eventListeners[eventName]
      .filter(listener => listener !== callback);
  }
  
  /**
   * Запускает событие
   * @param {string} eventName - Название события
   * @param {Object} data - Данные для передачи обработчикам
   */
  triggerEvent(eventName, data) {
    if (!this.eventListeners[eventName]) return;
    
    this.eventListeners[eventName].forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        this.log(`Ошибка в обработчике события ${eventName}: ${error.message}`, 'error');
      }
    });
  }
  
  /**
   * Функция для логирования
   * @param {string} message - Сообщение для логирования
   * @param {string} level - Уровень логирования (log, error, warn, info)
   */
  log(message, level = 'log') {
    if (!this.loggingEnabled) return;
    
    const prefix = '[OpenAI WebRTC]';
    
    switch (level) {
      case 'error':
        console.error(`${prefix} ${message}`);
        break;
      case 'warn':
        console.warn(`${prefix} ${message}`);
        break;
      case 'info':
        console.info(`${prefix} ${message}`);
        break;
      default:
        console.log(`${prefix} ${message}`);
    }
  }
  
  /**
   * Включает/выключает логирование
   * @param {boolean} enabled - Флаг включения логирования
   */
  setLogging(enabled) {
    this.loggingEnabled = enabled;
  }
}

// Экспортируем синглтон-экземпляр класса
const openAIWebRTC = new OpenAIWebRTC();
export default openAIWebRTC;
