/**
 * TranslateService - централизованный сервис для работы с OpenAI WebRTC API
 * Реализует функциональность для перевода речи в реальном времени
 */
class TranslateService {
  constructor() {
    // Состояние сервиса
    this.initialized = false;
    this.connected = false;
    this.translating = false;
    
    // WebRTC компоненты
    this.peerConnection = null;
    this.dataChannel = null;
    this.localStream = null;
    this.remoteStream = null;
    
    // Аудио компоненты
    this.audioContext = null;
    this.microphoneNode = null;
    this.remoteAudioNode = null;
    this.audioDestination = null;
    
    // Настройки по умолчанию
    this.settings = {
      apiKey: localStorage.getItem('openai_api_key') || '',
      sourceLanguage: 'ru',
      targetLanguage: 'en',
      model: 'gpt-4o-mini-realtime-preview',
      voice: 'alloy',
      muteOriginal: true,
      useVAD: true
    };
    
    // Обработчики событий
    this.eventHandlers = {
      'connected': [],
      'disconnected': [],
      'translation-started': [],
      'translation-stopped': [],
      'error': [],
      'transcript': [],
      'translation': []
    };
    
    // OpenAI WebRTC URL
    this.realtimeWebSocketURL = 'wss://api.openai.com/v1/audio/realtime';
    
    // STUN сервера для WebRTC
    this.iceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ];
    
    // Флаг логирования для отладки
    this.debug = true;
  }
  
  /**
   * Инициализирует сервис перевода
   * @returns {Promise<boolean>} Успешность инициализации
   */
  async init() {
    this.log('Инициализация сервиса перевода...');
    
    if (this.initialized) {
      this.log('Сервис перевода уже инициализирован');
      return true;
    }
    
    try {
      // Загружаем сохраненные настройки
      this.loadSettings();
      
      this.initialized = true;
      this.log('Сервис перевода успешно инициализирован');
      return true;
    } catch (error) {
      this.logError('Ошибка при инициализации сервиса перевода:', error);
      this.triggerEvent('error', { message: 'Ошибка при инициализации сервиса перевода', error });
      return false;
    }
  }
  
  /**
   * Загружает настройки из localStorage
   */
  loadSettings() {
    try {
      const savedSettings = localStorage.getItem('translation_settings');
      if (savedSettings) {
        const parsedSettings = JSON.parse(savedSettings);
        this.settings = { ...this.settings, ...parsedSettings };
        this.log('Настройки перевода загружены из localStorage');
      }
    } catch (error) {
      this.logError('Ошибка при загрузке настроек перевода:', error);
    }
  }
  
  /**
   * Сохраняет настройки в localStorage
   */
  saveSettings() {
    try {
      localStorage.setItem('translation_settings', JSON.stringify(this.settings));
      localStorage.setItem('openai_api_key', this.settings.apiKey);
      this.log('Настройки перевода сохранены в localStorage');
    } catch (error) {
      this.logError('Ошибка при сохранении настроек перевода:', error);
    }
  }
  
  /**
   * Устанавливает обработчик события
   * @param {string} eventName - Название события
   * @param {Function} handler - Обработчик события
   */
  on(eventName, handler) {
    if (this.eventHandlers[eventName]) {
      this.eventHandlers[eventName].push(handler);
    }
  }
  
  /**
   * Удаляет обработчик события
   * @param {string} eventName - Название события
   * @param {Function} handler - Обработчик события
   */
  off(eventName, handler) {
    if (this.eventHandlers[eventName]) {
      this.eventHandlers[eventName] = this.eventHandlers[eventName].filter(h => h !== handler);
    }
  }
  
  /**
   * Вызывает событие с передачей данных
   * @param {string} eventName - Название события
   * @param {Object} data - Данные события
   */
  triggerEvent(eventName, data) {
    if (this.eventHandlers[eventName]) {
      this.eventHandlers[eventName].forEach(handler => {
        try {
          handler(data);
        } catch (error) {
          this.logError(`Ошибка в обработчике события ${eventName}:`, error);
        }
      });
    }
  }
  
  /**
   * Обновляет настройки перевода
   * @param {Object} newSettings - Новые настройки
   */
  updateSettings(newSettings) {
    const previousSettings = { ...this.settings };
    this.settings = { ...this.settings, ...newSettings };
    this.saveSettings();
    
    this.log('Настройки перевода обновлены:', this.settings);
    
    // Если изменился API ключ, нужно переподключиться
    if (previousSettings.apiKey !== this.settings.apiKey && this.connected) {
      this.log('API ключ изменился, переподключение...');
      this.disconnect().then(() => {
        this.connect();
      });
    }
    
    // Если изменился язык перевода и уже подключены, отправляем обновление
    if ((previousSettings.targetLanguage !== this.settings.targetLanguage || 
         previousSettings.voice !== this.settings.voice) && 
        this.connected && this.dataChannel && this.dataChannel.readyState === 'open') {
      
      this.updateTranslationConfig();
    }
  }
  
  /**
   * Проверяет валидность API ключа OpenAI
   */
  async checkApiKey() {
    if (!this.settings.apiKey) {
      this.log('API ключ OpenAI не задан');
      return false;
    }
    
    try {
      this.log('Проверка API ключа OpenAI...');
      
      // Отправляем запрос на сервер для проверки API ключа
      const response = await fetch('/api/openai-auth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          apiKey: this.settings.apiKey
        })
      });
      
      this.log(`Получен ответ от сервера, статус: ${response.status}`);
      
      // Получаем и парсим данные ответа
      const data = await response.json();
      this.log('Данные ответа сервера:', data);
      
      if (response.ok && data.success && data.valid) {
        this.log('API ключ OpenAI прошел проверку');
        return true;
      } else {
        const errorMessage = data.error || 'Недействительный ключ API';
        this.logError('Ошибка при проверке API ключа OpenAI:', errorMessage);
        this.triggerEvent('error', { 
          message: 'Ошибка при проверке API ключа OpenAI', 
          status: response.status,
          error: errorMessage
        });
        return false;
      }
    } catch (error) {
      this.logError('Ошибка при проверке API ключа OpenAI:', error);
      this.triggerEvent('error', { 
        message: 'Ошибка при проверке API ключа OpenAI', 
        error: error.message || 'Неизвестная ошибка'
      });
      return false;
    }
  }
  
  /**
   * Устанавливает соединение с OpenAI WebRTC API
   * @returns {Promise<boolean>} Успешность подключения
   */
  async connect() {
    if (this.connected) {
      this.log('Уже подключено к OpenAI WebRTC API');
      return true;
    }
    
    if (!this.initialized) {
      const initialized = await this.init();
      if (!initialized) {
        return false;
      }
    }
    
    try {
      // Проверяем API ключ
      const apiKeyValid = await this.checkApiKey();
      if (!apiKeyValid) {
        throw new Error('Недействительный API ключ OpenAI');
      }
      
      // Создаем WebRTC соединение
      this.createPeerConnection();
      
      return true;
    } catch (error) {
      this.logError('Ошибка при подключении к OpenAI WebRTC API:', error);
      this.triggerEvent('error', { message: 'Ошибка при подключении к OpenAI WebRTC API', error });
      return false;
    }
  }
  
  /**
   * Создает WebRTC соединение с OpenAI
   */
  async createPeerConnection() {
    try {
      this.log('Создание WebRTC соединения...');
      
      // Создаем новое RTCPeerConnection с улучшенными настройками
      const rtcConfig = {
        iceServers: this.iceServers,
        iceCandidatePoolSize: 10,
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require',
        // Добавляем параметры для повышения стабильности соединения
        iceTransportPolicy: 'all',
        sdpSemantics: 'unified-plan'
      };
      
      this.log('Конфигурация RTCPeerConnection:', rtcConfig);
      this.peerConnection = new RTCPeerConnection(rtcConfig);
      
      // Настраиваем обработчики событий WebRTC
      this.peerConnection.onicecandidate = this.handleIceCandidate.bind(this);
      this.peerConnection.oniceconnectionstatechange = this.handleIceConnectionStateChange.bind(this);
      this.peerConnection.ontrack = this.handleTrack.bind(this);
      
      // Создаем data channel для отправки команд конфигурации
      this.dataChannel = this.peerConnection.createDataChannel('config', {
        ordered: true, // Гарантированная доставка в правильном порядке
        maxRetransmits: 3 // Максимальное число повторных отправок
      });
      
      this.dataChannel.onopen = this.handleDataChannelOpen.bind(this);
      this.dataChannel.onclose = this.handleDataChannelClose.bind(this);
      this.dataChannel.onmessage = this.handleDataChannelMessage.bind(this);
      
      // Получаем аудио с микрофона с оптимизированными параметрами
      const audioConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 48000, // Оптимально для OpenAI API
        sampleSize: 16,
        channelCount: 1 // Моно аудио
      };
      
      this.log('Запрос доступа к микрофону с параметрами:', audioConstraints);
      try {
        this.localStream = await navigator.mediaDevices.getUserMedia({ 
          audio: audioConstraints,
          video: false
        });
        
        this.log('Доступ к микрофону успешно получен. Доступные треки:', 
          this.localStream.getTracks().map(t => `${t.kind}:${t.label}`).join(', '));
      } catch (mediaError) {
        this.logError('Ошибка при получении доступа к микрофону:', mediaError);
        throw new Error(`Не удалось получить доступ к микрофону: ${mediaError.message}`);
      }
      
      // Добавляем аудио треки в peer connection
      this.localStream.getAudioTracks().forEach(track => {
        this.log('Добавление аудио трека в соединение:', track.label);
        this.peerConnection.addTrack(track, this.localStream);
      });
      
      // Создаем оптимизированный SDP offer
      const offerOptions = {
        offerToReceiveAudio: true,
        offerToReceiveVideo: false,
        voiceActivityDetection: true
      };
      
      this.log('Создание SDP offer с параметрами:', offerOptions);
      const offer = await this.peerConnection.createOffer(offerOptions);
      
      // Оптимизируем SDP для лучшей работы с OpenAI API
      let modifiedSdp = offer.sdp;
      modifiedSdp = this.preferOpus(modifiedSdp);
      
      const modifiedOffer = {
        type: offer.type,
        sdp: modifiedSdp
      };
      
      this.log('Установка локального SDP описания');
      await this.peerConnection.setLocalDescription(modifiedOffer);
      
      this.log('Отправка SDP offer на OpenAI API');
      // Используем современный метод fetch с обработкой ошибок
      try {
        const response = await fetch('https://api.openai.com/v1/audio/realtime', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY || ''}`, // Используем глобальный API ключ
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: this.settings.model,
            voice: this.settings.voice,
            use_vad: this.settings.useVAD,
            sdp: this.peerConnection.localDescription.sdp
          })
        });
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'Не удалось прочитать ответ от API' }));
          this.logError(`OpenAI API вернул ошибку (${response.status}):`, errorData);
          throw new Error(`Ошибка при подключении к OpenAI API: ${response.status} - ${errorData.error?.message || 'Неизвестная ошибка'}`);
        }
        
        // Успешный ответ от OpenAI API
        this.log('Получен ответ от OpenAI API');
        const data = await response.json();
        
        if (!data.sdp) {
          throw new Error('Ответ от OpenAI API не содержит SDP');
        }
        
        // Устанавливаем SDP ответ как удаленное описание
        this.log('Установка удаленного SDP описания');
        await this.peerConnection.setRemoteDescription({
          type: 'answer',
          sdp: data.sdp
        });
        
        this.log('WebRTC соединение с OpenAI успешно установлено');
        this.connected = true;
        this.triggerEvent('connected', { timestamp: new Date() });
      } catch (apiError) {
        this.logError('Ошибка при взаимодействии с OpenAI API:', apiError);
        throw new Error(`Ошибка при соединении с OpenAI API: ${apiError.message}`);
      }
    } catch (error) {
      this.logError('Ошибка при создании WebRTC соединения:', error);
      this.triggerEvent('error', { 
        message: 'Ошибка при создании WebRTC соединения', 
        error: error.message || 'Неизвестная ошибка' 
      });
      
      this.cleanupConnection();
      throw error; // Пробрасываем ошибку выше для правильной обработки
    }
  }
  
  /**
   * Модифицирует SDP, чтобы предпочитать кодек Opus для лучшей совместимости с OpenAI
   * @param {string} sdp - SDP описание
   * @returns {string} Модифицированный SDP
   */
  preferOpus(sdp) {
    let sdpLines = sdp.split('\r\n');
    let mLineIndex = -1;
    
    // Находим m-line для аудио
    for (let i = 0; i < sdpLines.length; i++) {
      if (sdpLines[i].startsWith('m=audio')) {
        mLineIndex = i;
        break;
      }
    }
    
    if (mLineIndex === -1) {
      this.log('Не найдена m-line для аудио в SDP');
      return sdp;
    }
    
    // Находим payload type для Opus
    let opusPayload = null;
    
    for (let i = 0; i < sdpLines.length; i++) {
      if (sdpLines[i].startsWith('a=rtpmap:') && sdpLines[i].includes('opus/48000/2')) {
        const parts = sdpLines[i].split(' ');
        const payloadStr = parts[0].split(':')[1];
        opusPayload = parseInt(payloadStr);
        break;
      }
    }
    
    if (opusPayload === null) {
      this.log('Кодек Opus не найден в SDP');
      return sdp;
    }
    
    // Находим a=fmtp строку для Opus и устанавливаем предпочтительные параметры
    for (let i = 0; i < sdpLines.length; i++) {
      if (sdpLines[i].startsWith(`a=fmtp:${opusPayload} `)) {
        const parts = sdpLines[i].split(' ');
        const params = parts[1].split(';');
        
        // Добавляем предпочтительные параметры для Opus
        if (!sdpLines[i].includes('stereo=')) params.push('stereo=0');
        if (!sdpLines[i].includes('sprop-stereo=')) params.push('sprop-stereo=0');
        if (!sdpLines[i].includes('maxplaybackrate=')) params.push('maxplaybackrate=48000');
        if (!sdpLines[i].includes('maxaveragebitrate=')) params.push('maxaveragebitrate=32000');
        if (!sdpLines[i].includes('useinbandfec=')) params.push('useinbandfec=1');
        if (!sdpLines[i].includes('minptime=')) params.push('minptime=10');
        
        sdpLines[i] = `a=fmtp:${opusPayload} ${params.join(';')}`;
        break;
      }
    }
    
    // Реорганизуем payload типы, перемещая Opus вперед
    const mLine = sdpLines[mLineIndex].split(' ');
    const payloadTypes = [];
    
    // Добавляем сначала Opus
    payloadTypes.push(opusPayload);
    
    // Затем добавляем остальные кодеки
    for (let i = 3; i < mLine.length; i++) {
      const pt = parseInt(mLine[i]);
      if (pt !== opusPayload) {
        payloadTypes.push(pt);
      }
    }
    
    // Обновляем m-line
    mLine.splice(3, mLine.length - 3, ...payloadTypes);
    sdpLines[mLineIndex] = mLine.join(' ');
    
    return sdpLines.join('\r\n');
  }
  
  /**
   * Отправляет обновленные настройки перевода через data channel
   */
  updateTranslationConfig() {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      this.log('Data channel не готов для отправки конфигурации');
      return;
    }
    
    try {
      const config = {
        type: 'config',
        data: {
          source_language: this.settings.sourceLanguage,
          target_language: this.settings.targetLanguage,
          voice: this.settings.voice
        }
      };
      
      this.dataChannel.send(JSON.stringify(config));
      this.log('Конфигурация перевода отправлена через data channel:', config);
    } catch (error) {
      this.logError('Ошибка при отправке конфигурации перевода:', error);
    }
  }
  
  /**
   * Отключается от OpenAI WebRTC API
   */
  async disconnect() {
    if (!this.connected) {
      this.log('Сервис перевода не подключен');
      return;
    }
    
    this.log('Отключение от OpenAI WebRTC API...');
    
    this.stopTranslation();
    this.cleanupConnection();
    
    this.connected = false;
    this.triggerEvent('disconnected', { timestamp: new Date() });
    
    this.log('Отключение от OpenAI WebRTC API завершено');
  }
  
  /**
   * Очищает ресурсы соединения
   */
  cleanupConnection() {
    // Остановка и освобождение аудио стримов
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }
    
    // Закрытие data channel
    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }
    
    // Закрытие peer connection
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
    
    // Очистка аудио контекста
    if (this.audioContext) {
      this.audioContext.close().catch(error => {
        this.logError('Ошибка при закрытии AudioContext:', error);
      });
      this.audioContext = null;
      this.microphoneNode = null;
      this.remoteAudioNode = null;
      this.audioDestination = null;
    }
  }
  
  /**
   * Запускает перевод речи
   */
  startTranslation() {
    if (this.translating) {
      this.log('Перевод речи уже активен');
      return;
    }
    
    if (!this.connected) {
      this.log('Необходимо подключиться перед началом перевода');
      this.connect().then(connected => {
        if (connected) {
          this.startTranslation();
        }
      });
      return;
    }
    
    this.log('Запуск перевода речи...');
    
    // Настраиваем аудио микширование, если оригинальный голос должен быть приглушен
    if (this.settings.muteOriginal) {
      this.setupAudioMixing();
    }
    
    this.translating = true;
    this.triggerEvent('translation-started', { timestamp: new Date() });
    
    this.log('Перевод речи активирован');
  }
  
  /**
   * Останавливает перевод речи
   */
  stopTranslation() {
    if (!this.translating) {
      this.log('Перевод речи не активен');
      return;
    }
    
    this.log('Остановка перевода речи...');
    
    this.translating = false;
    this.triggerEvent('translation-stopped', { timestamp: new Date() });
    
    // Освобождаем ресурсы аудио микширования
    if (this.audioContext) {
      this.audioContext.close().catch(error => {
        this.logError('Ошибка при закрытии AudioContext:', error);
      });
      this.audioContext = null;
      this.microphoneNode = null;
      this.remoteAudioNode = null;
      this.audioDestination = null;
    }
    
    this.log('Перевод речи остановлен');
  }
  
  /**
   * Настраивает микширование аудио для отключения оригинального голоса
   */
  setupAudioMixing() {
    try {
      this.log('Применение настройки заглушения оригинального голоса:', this.settings.muteOriginal);
      
      // Создаем аудио контекст если не существует
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }
      
      // Получаем все аудио элементы на странице
      const allAudioElements = document.querySelectorAll('audio');
      this.log(`Найдено ${allAudioElements.length} аудио элементов`);
      
      // Находим элемент для воспроизведения ремоут-стрима
      let remoteAudioElement = document.getElementById('remoteVideo') || document.getElementById('remoteAudio');
      
      if (remoteAudioElement) {
        this.log(`Найден ремоут аудио элемент: ${remoteAudioElement.id}`);
        
        // Устанавливаем громкость в зависимости от настройки muteOriginal
        remoteAudioElement.volume = this.settings.muteOriginal ? 0 : 1;
        this.log(`Громкость оригинального голоса установлена на: ${remoteAudioElement.volume}`);
      } else {
        this.log('Не найден аудио элемент для ремоут-стрима. Проверяем все аудио элементы');
        
        // Если не нашли по ID, пробуем установить громкость всем аудио элементам
        allAudioElements.forEach((audioEl, index) => {
          if (audioEl.srcObject && audioEl.srcObject.getAudioTracks().length > 0) {
            audioEl.volume = this.settings.muteOriginal ? 0 : 1;
            this.log(`Установлена громкость ${audioEl.volume} для аудио элемента #${index}`);
          }
        });
      }
      
      // Дополнительно пробуем отключить воспроизведение звука на уровне WebRTC
      if (this.remoteStream && this.settings.muteOriginal) {
        // Отключаем воспроизведение звука на уровне аудио контекста
        this.remoteAudioNode = this.audioContext.createMediaStreamSource(this.remoteStream);
        this.remoteGainNode = this.audioContext.createGain();
        this.remoteGainNode.gain.value = 0; // Полное заглушение
        
        // Подключаем узлы для обработки звука
        this.remoteAudioNode.connect(this.remoteGainNode);
        this.remoteGainNode.connect(this.audioContext.destination);
        
        this.log('Аудиопоток полностью заглушен через AudioContext');
      }

      this.log('Настройка заглушения звука завершена');
    } catch (error) {
      this.logError('Ошибка при настройке микширования аудио:', error);
    }
  }
  
  /* Обработчики событий WebRTC */
  
  /**
   * Обрабатывает ICE кандидаты
   */
  handleIceCandidate(event) {
    if (event.candidate) {
      this.log('Обнаружен ICE кандидат:', event.candidate.candidate);
    }
  }
  
  /**
   * Обрабатывает изменения состояния ICE соединения
   */
  handleIceConnectionStateChange() {
    this.log('Изменение ICE состояния:', this.peerConnection.iceConnectionState);
    
    if (this.peerConnection.iceConnectionState === 'disconnected' || 
        this.peerConnection.iceConnectionState === 'failed' ||
        this.peerConnection.iceConnectionState === 'closed') {
      
      this.log('ICE соединение разорвано или закрыто');
      if (this.connected) {
        this.connected = false;
        this.translating = false;
        this.triggerEvent('disconnected', { 
          reason: 'ice-connection', 
          state: this.peerConnection.iceConnectionState 
        });
      }
    }
  }
  
  /**
   * Обрабатывает входящие треки медиа
   */
  handleTrack(event) {
    this.log('Получен удаленный трек:', event.track.kind);
    
    if (event.track.kind === 'audio') {
      this.remoteStream = event.streams[0];
      
      // Если не нужно заглушать оригинальный голос, просто воспроизводим
      if (!this.settings.muteOriginal) {
        const audioElement = new Audio();
        audioElement.srcObject = this.remoteStream;
        audioElement.play().catch(error => {
          this.logError('Ошибка при воспроизведении аудио:', error);
        });
      } else if (this.translating) {
        // Если перевод уже активен, настраиваем микширование
        this.setupAudioMixing();
      }
    }
  }
  
  /**
   * Обрабатывает открытие data channel
   */
  handleDataChannelOpen() {
    this.log('Data channel открыт');
    
    // Отправляем начальную конфигурацию перевода
    this.updateTranslationConfig();
  }
  
  /**
   * Обрабатывает закрытие data channel
   */
  handleDataChannelClose() {
    this.log('Data channel закрыт');
  }
  
  /**
   * Обрабатывает сообщения из data channel
   */
  handleDataChannelMessage(event) {
    try {
      const message = JSON.parse(event.data);
      
      if (message.type === 'transcript') {
        // Оригинальный текст распознанной речи
        this.triggerEvent('transcript', message.data);
      } else if (message.type === 'translation') {
        // Переведенный текст
        this.triggerEvent('translation', message.data);
      } else if (message.type === 'error') {
        // Ошибка от OpenAI API
        this.logError('Ошибка от OpenAI API:', message.data);
        this.triggerEvent('error', { message: 'Ошибка от OpenAI API', data: message.data });
      }
    } catch (error) {
      this.logError('Ошибка при обработке сообщения из data channel:', error);
    }
  }
  
  /* Утилиты логирования */
  
  /**
   * Выводит сообщение в консоль если включен режим отладки
   */
  log(message, ...args) {
    if (this.debug) {
      console.log(`[TranslateService] ${message}`, ...args);
    }
  }
  
  /**
   * Выводит сообщение об ошибке в консоль
   */
  logError(message, error) {
    console.error(`[TranslateService] ${message}`, error);
  }
}

// Создаем глобальный экземпляр сервиса перевода
window.translateService = new TranslateService();
