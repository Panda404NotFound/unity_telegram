/**
 * TranslationManager - класс для управления переводом речи через OpenAI Realtime API
 * Использует WebRTC для передачи и получения аудио в реальном времени
 */
class TranslationManager {
  constructor() {
    this.peerConnection = null;
    this.dataChannel = null;
    this.localStream = null;
    this.remoteStream = null;
    this.token = null;
    this.isConnected = false;
    this.isTranslating = false;
    this.mediaRecorder = null;
    this.audioContext = null;
    this.sourceNode = null;
    this.settings = this.loadSettings();
    
    // Ссылки на обработчики событий
    this.onConnected = null;
    this.onDisconnected = null;
    this.onError = null;
    this.onTranscription = null;
    this.onTranslation = null;
  }
  
  /**
   * Загрузка сохраненных настроек
   */
  loadSettings() {
    try {
      const savedSettings = localStorage.getItem('translationSettings');
      if (savedSettings) {
        return JSON.parse(savedSettings);
      }
    } catch (error) {
      console.error('Ошибка при загрузке настроек:', error);
    }
    
    // Настройки по умолчанию
    return {
      sourceLanguage: 'ru',
      targetLanguage: 'en',
      translateVoice: 'nova',
      muteOriginal: true
    };
  }
  
  /**
   * Обновление настроек перевода
   */
  updateSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
    
    // Если соединение активно, обновляем настройки
    if (this.isConnected && this.dataChannel && this.dataChannel.readyState === 'open') {
      try {
        this.dataChannel.send(JSON.stringify({
          type: 'config',
          data: {
            source_language: this.settings.sourceLanguage,
            target_language: this.settings.targetLanguage,
            voice: this.settings.translateVoice
          }
        }));
      } catch (error) {
        console.error('Ошибка при обновлении настроек через data channel:', error);
      }
    }
  }
  
  /**
   * Инициализация WebRTC соединения с OpenAI
   */
  async init() {
    try {
      // Проверяем наличие API ключа и получаем токен
      const token = await this.getEphemeralToken();
      if (!token) {
        throw new Error('Не удалось получить токен для подключения к OpenAI API');
      }
      
      this.token = token;
      
      // Создаем WebRTC соединение
      this.createPeerConnection();
      
      return true;
    } catch (error) {
      console.error('Ошибка при инициализации TranslationManager:', error);
      if (this.onError) this.onError(error);
      return false;
    }
  }
  
  /**
   * Получение эфемерного токена с сервера
   */
  async getEphemeralToken() {
    try {
      const response = await fetch('/api/openai/token');
      const data = await response.json();
      
      if (data.success && data.token) {
        return data.token;
      }
      
      throw new Error(data.error || 'Не удалось получить токен');
    } catch (error) {
      console.error('Ошибка при получении токена:', error);
      if (this.onError) this.onError(error);
      return null;
    }
  }
  
  /**
   * Создание WebRTC соединения
   */
  createPeerConnection() {
    try {
      // Создаем новое соединение
      this.peerConnection = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      });
      
      // Настраиваем обработчики событий
      this.peerConnection.onicecandidate = this.handleIceCandidate.bind(this);
      this.peerConnection.oniceconnectionstatechange = this.handleConnectionStateChange.bind(this);
      this.peerConnection.ontrack = this.handleRemoteTrack.bind(this);
      
      // Создаем Data Channel для конфигурации
      this.dataChannel = this.peerConnection.createDataChannel('config');
      this.dataChannel.onopen = this.handleDataChannelOpen.bind(this);
      this.dataChannel.onclose = this.handleDataChannelClose.bind(this);
      this.dataChannel.onmessage = this.handleDataChannelMessage.bind(this);
      
      // Начинаем соединение
      this.connect();
    } catch (error) {
      console.error('Ошибка при создании WebRTC соединения:', error);
      if (this.onError) this.onError(error);
    }
  }
  
  /**
   * Установка соединения с OpenAI Realtime API
   */
  async connect() {
    try {
      // Получаем доступ к микрофону
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Добавляем треки в peer connection
      this.localStream.getAudioTracks().forEach(track => {
        this.peerConnection.addTrack(track, this.localStream);
      });
      
      // Создаем SDP предложение
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);
      
      // Отправляем предложение на сервер OpenAI
      const response = await fetch('https://api.openai.com/v1/audio/realtime', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4o-realtime-preview',
          sdp: offer.sdp
        })
      });
      
      if (!response.ok) {
        throw new Error(`Ошибка при подключении к OpenAI: ${response.status} ${response.statusText}`);
      }
      
      // Получаем и устанавливаем ответное SDP
      const data = await response.json();
      await this.peerConnection.setRemoteDescription({
        type: 'answer',
        sdp: data.sdp
      });
      
      console.log('Соединение с OpenAI Realtime API успешно установлено');
      
    } catch (error) {
      console.error('Ошибка при установке соединения с OpenAI:', error);
      if (this.onError) this.onError(error);
    }
  }
  
  /**
   * Обработчик ICE-кандидатов
   */
  handleIceCandidate(event) {
    if (event.candidate) {
      console.log('Получен ICE-кандидат:', event.candidate);
    }
  }
  
  /**
   * Обработчик изменения состояния соединения
   */
  handleConnectionStateChange() {
    console.log('Состояние ICE соединения:', this.peerConnection.iceConnectionState);
    
    switch(this.peerConnection.iceConnectionState) {
      case 'connected':
      case 'completed':
        this.isConnected = true;
        if (this.onConnected) this.onConnected();
        break;
      case 'failed':
      case 'disconnected':
      case 'closed':
        this.isConnected = false;
        if (this.onDisconnected) this.onDisconnected();
        break;
    }
  }
  
  /**
   * Обработчик для получения удаленного трека
   */
  handleRemoteTrack(event) {
    console.log('Получен удаленный трек:', event.track);
    
    if (!this.remoteStream) {
      this.remoteStream = new MediaStream();
    }
    
    this.remoteStream.addTrack(event.track);
    
    // Создаем аудио элемент для воспроизведения, если его еще нет
    if (!this.audioElement) {
      this.audioElement = document.createElement('audio');
      this.audioElement.autoplay = true;
      this.audioElement.id = 'translateAudio';
      this.audioElement.style.display = 'none';
      document.body.appendChild(this.audioElement);
    }
    
    this.audioElement.srcObject = this.remoteStream;
  }
  
  /**
   * Обработчик открытия data channel
   */
  handleDataChannelOpen() {
    console.log('Data Channel открыт');
    
    // Отправляем конфигурацию
    this.dataChannel.send(JSON.stringify({
      type: 'config',
      data: {
        source_language: this.settings.sourceLanguage,
        target_language: this.settings.targetLanguage,
        voice: this.settings.translateVoice,
        use_vad: true
      }
    }));
  }
  
  /**
   * Обработчик закрытия data channel
   */
  handleDataChannelClose() {
    console.log('Data Channel закрыт');
  }
  
  /**
   * Обработчик сообщений в data channel
   */
  handleDataChannelMessage(event) {
    try {
      const message = JSON.parse(event.data);
      
      // Обработка разных типов сообщений
      switch (message.type) {
        case 'transcription':
          if (this.onTranscription) this.onTranscription(message.data);
          break;
        case 'translation':
          if (this.onTranslation) this.onTranslation(message.data);
          break;
        case 'error':
          console.error('Ошибка от OpenAI:', message.data);
          if (this.onError) this.onError(new Error(message.data.message));
          break;
      }
    } catch (error) {
      console.error('Ошибка при обработке сообщения Data Channel:', error);
    }
  }
  
  /**
   * Начало перевода речи
   */
  startTranslation() {
    if (!this.isConnected) {
      console.error('Невозможно начать перевод: нет соединения');
      return false;
    }
    
    if (this.isTranslating) {
      return true; // Уже переводим
    }
    
    try {
      // Включаем микрофон если он был выключен
      if (this.localStream) {
        this.localStream.getAudioTracks().forEach(track => {
          track.enabled = true;
        });
      }
      
      this.isTranslating = true;
      return true;
    } catch (error) {
      console.error('Ошибка при запуске перевода:', error);
      if (this.onError) this.onError(error);
      return false;
    }
  }
  
  /**
   * Остановка перевода речи
   */
  stopTranslation() {
    try {
      // Выключаем микрофон
      if (this.localStream) {
        this.localStream.getAudioTracks().forEach(track => {
          track.enabled = false;
        });
      }
      
      this.isTranslating = false;
      return true;
    } catch (error) {
      console.error('Ошибка при остановке перевода:', error);
      if (this.onError) this.onError(error);
      return false;
    }
  }
  
  /**
   * Закрытие соединения и очистка ресурсов
   */
  close() {
    try {
      this.stopTranslation();
      
      // Закрываем data channel
      if (this.dataChannel) {
        this.dataChannel.close();
        this.dataChannel = null;
      }
      
      // Закрываем соединение
      if (this.peerConnection) {
        this.peerConnection.close();
        this.peerConnection = null;
      }
      
      // Останавливаем все треки
      if (this.localStream) {
        this.localStream.getTracks().forEach(track => track.stop());
        this.localStream = null;
      }
      
      // Удаляем аудио элемент
      if (this.audioElement) {
        this.audioElement.remove();
        this.audioElement = null;
      }
      
      this.isConnected = false;
      this.isTranslating = false;
      
      console.log('TranslationManager закрыт');
      return true;
    } catch (error) {
      console.error('Ошибка при закрытии TranslationManager:', error);
      if (this.onError) this.onError(error);
      return false;
    }
  }
}

// Делаем класс доступным глобально
window.TranslationManager = TranslationManager;
