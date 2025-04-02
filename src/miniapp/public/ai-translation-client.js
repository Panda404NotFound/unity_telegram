/**
 * Клиентский модуль для управления ИИ переводом в звонках
 * Интегрируется с сигнальным сервером и аудио потоками WebRTC
 */

class AITranslationClient {
  constructor() {
    // Состояние перевода
    this.enabled = false;
    this.active = false;
    this.ready = false;
    this.processingAudio = false;
    
    // Настройки перевода
    this.settings = {
      sourceLanguage: 'ru',
      targetLanguage: 'en',
      voice: 'alloy',
      autoStart: false,
      muteOriginal: true
    };
    
    // Ссылки на WebRTC компоненты
    this.websocket = null;
    this.peerConnection = null;
    this.localStream = null;
    this.remoteStream = null;
    this.audioProcessor = null;
    this.audioContext = null;
    
    // Текущая комната и собеседник
    this.roomId = null;
    this.peerId = null;
    
    // Обработчики событий
    this.eventHandlers = {
      'enabled': [],
      'disabled': [],
      'translation-started': [],
      'translation-stopped': [],
      'transcript': [],
      'translation': [],
      'error': []
    };
    
    // Инициализируем при создании
    this.init();
  }
  
  /**
   * Инициализирует клиент перевода
   */
  init() {
    try {
      // Загружаем сохраненные настройки
      this.loadSettings();
      
      // Проверяем поддержку необходимых API
      if (!navigator.mediaDevices || !window.AudioContext) {
        this.log('Браузер не поддерживает необходимые API для перевода речи', 'error');
        this.ready = false;
        return;
      }
      
      this.ready = true;
      this.log('Клиент перевода инициализирован', 'info');
    } catch (error) {
      this.log(`Ошибка при инициализации клиента перевода: ${error.message}`, 'error');
      this.ready = false;
    }
  }
  
  /**
   * Подключается к сигнальному серверу
   * @param {WebSocket} websocket - Экземпляр WebSocket соединения
   */
  connectToSignalingServer(websocket) {
    if (!websocket || !(websocket instanceof WebSocket)) {
      this.log('Некорректное WebSocket соединение', 'error');
      return;
    }
    
    this.websocket = websocket;
    
    // Добавляем слушатели для обработки сообщений от сервера
    this.addWebSocketListeners();
    
    this.log('Подключен к сигнальному серверу', 'info');
  }
  
  /**
   * Добавляет обработчики событий WebSocket
   */
  addWebSocketListeners() {
    if (!this.websocket) return;
    
    // Используем прокси для перехвата сообщений от сервера
    const originalOnMessage = this.websocket.onmessage;
    
    this.websocket.onmessage = (event) => {
      // Сначала вызываем оригинальный обработчик
      if (originalOnMessage) {
        originalOnMessage(event);
      }
      
      // Затем обрабатываем сообщение в нашем клиенте
      try {
        if (typeof event.data === 'string') {
          const data = JSON.parse(event.data);
          this.handleSignalingMessage(data);
        }
      } catch (error) {
        this.log(`Ошибка при обработке сообщения: ${error.message}`, 'error');
      }
    };
  }
  
  /**
   * Обрабатывает сообщения от сигнального сервера
   * @param {Object} data - Данные сообщения
   */
  handleSignalingMessage(data) {
    const { type, payload } = data;
    
    switch (type) {
      case 'translation-settings-updated':
        this.handleTranslationSettingsUpdated(payload);
        break;
      case 'translation-toggled':
        this.handleTranslationToggled(payload);
        break;
      case 'translation-state-changed':
        this.handleTranslationStateChanged(payload);
        break;
      case 'translation-result':
        this.handleTranslationResult(payload);
        break;
    }
  }
  
  /**
   * Обрабатывает обновление настроек перевода
   * @param {Object} payload - Данные обновления
   */
  handleTranslationSettingsUpdated(payload) {
    if (payload.success && payload.settings) {
      this.log('Настройки перевода обновлены', 'info');
      // Обновляем локальные настройки
      this.settings = {
        ...this.settings,
        ...payload.settings
      };
      this.saveSettings();
    }
  }
  
  /**
   * Обрабатывает включение/выключение перевода
   * @param {Object} payload - Данные о состоянии перевода
   */
  handleTranslationToggled(payload) {
    if (payload.success) {
      this.active = payload.enabled;
      
      if (this.active) {
        this.log('Перевод активирован', 'info');
        this.triggerEvent('translation-started', { roomId: payload.roomId });
      } else {
        this.log('Перевод деактивирован', 'info');
        this.triggerEvent('translation-stopped', { roomId: payload.roomId });
      }
    }
  }
  
  /**
   * Обрабатывает изменение состояния перевода у собеседника
   * @param {Object} payload - Данные о состоянии перевода
   */
  handleTranslationStateChanged(payload) {
    const { userId, translating, roomId } = payload;
    
    if (userId === this.peerId) {
      this.log(`Собеседник ${translating ? 'включил' : 'выключил'} перевод`, 'info');
      
      // Здесь можно добавить логику для обработки состояния перевода у собеседника
      // Например, показать уведомление в интерфейсе
    }
  }
  
  /**
   * Обрабатывает результаты перевода
   * @param {Object} payload - Результаты перевода
   */
  handleTranslationResult(payload) {
    const { type, text, final } = payload;
    
    if (type === 'transcript') {
      this.triggerEvent('transcript', { text, final });
    } else if (type === 'translation') {
      this.triggerEvent('translation', { text, final });
    }
  }
  
  /**
   * Настраивает аудио поток для перевода
   * @param {MediaStream} localStream - Локальный медиа поток
   * @param {MediaStream} remoteStream - Удаленный медиа поток
   * @param {RTCPeerConnection} peerConnection - Соединение WebRTC
   */
  setupAudioForTranslation(localStream, remoteStream, peerConnection) {
    this.localStream = localStream;
    this.remoteStream = remoteStream;
    this.peerConnection = peerConnection;
    
    // Создаем AudioContext для обработки аудио
    this.setupAudioProcessing();
  }
  
  /**
   * Настраивает обработку аудио для перевода
   */
  setupAudioProcessing() {
    try {
      if (!this.localStream) {
        this.log('Нет доступа к локальному аудио потоку', 'error');
        return;
      }
      
      this.log('Начало настройки обработки аудио...', 'info');
      
      // Создаем AudioContext
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      this.log(`AudioContext создан, частота дискретизации: ${this.audioContext.sampleRate}Hz`, 'info');
      
      // Получаем аудио трек
      const audioTrack = this.localStream.getAudioTracks()[0];
      if (!audioTrack) {
        this.log('Аудио трек не найден', 'error');
        return;
      }
      
      // Показываем информацию о треке
      this.log(`Аудио трек найден: ID=${audioTrack.id}, enabled=${audioTrack.enabled}, muted=${audioTrack.muted}`, 'info');
      
      // Создаем источник из медиа потока
      const source = this.audioContext.createMediaStreamSource(this.localStream);
      this.log('Создан источник MediaStreamSource', 'info');
      
      // Размер буфера для обработки
      const bufferSize = 4096;
      
      // Создаем процессор для обработки аудио
      this.audioProcessor = this.audioContext.createScriptProcessor
        ? this.audioContext.createScriptProcessor(bufferSize, 1, 1)
        : this.audioContext.createJavaScriptNode(bufferSize, 1, 1);
      
      this.log(`Создан аудио процессор с размером буфера ${bufferSize}`, 'info');
      
      // Подключаем процессор
      source.connect(this.audioProcessor);
      this.audioProcessor.connect(this.audioContext.destination);
      this.log('Аудио процессор подключен к источнику и конечной точке', 'info');
      
      // Счетчик отправленных аудио пакетов
      let packetCounter = 0;
      const logInterval = 10; // Логировать каждые 10 пакетов
      
      // Обработка аудио данных
      this.audioProcessor.onaudioprocess = (e) => {
        // Только если перевод активен
        if (this.active && this.websocket && this.websocket.readyState === WebSocket.OPEN) {
          // Получаем данные из буфера
          const inputBuffer = e.inputBuffer;
          const inputData = inputBuffer.getChannelData(0);
          
          // Проверяем уровень конроля голоса (простая реализация)
          let hasSound = false;
          let maxVolume = 0;
          
          // Проверяем амплитуду звука
          for (let i = 0; i < inputData.length; i++) {
            const absValue = Math.abs(inputData[i]);
            if (absValue > maxVolume) {
              maxVolume = absValue;
            }
          }
          
          // Порог для определения наличия звука
          const threshold = 0.01;
          hasSound = maxVolume > threshold;
          
          // Если есть звук или VAD выключен, отправляем данные
          if (hasSound || !this.settings.useVAD) {
            // Конвертируем Float32Array в Int16Array для отправки
            const pcmData = this.convertFloat32ToInt16(inputData);
            
            // Отправляем аудио данные на сервер
            this.websocket.send(pcmData.buffer);
            
            // Увеличиваем счетчик пакетов
            packetCounter++;
            
            // Логируем периодически
            if (packetCounter % logInterval === 0) {
              this.log(`Отправлено ${packetCounter} аудио пакетов, текущий уровень громкости: ${Math.round(maxVolume * 100)}%`, 'debug');
            }
          }
        }
      };
      
      this.log('Обработка аудио настроена', 'info');
    } catch (error) {
      this.log(`Ошибка при настройке обработки аудио: ${error.message}`, 'error');
    }
  }
  
  /**
   * Преобразует аудио данные из Float32Array в Int16Array
   * @param {Float32Array} float32Array - Входные аудио данные
   * @returns {Int16Array} - Преобразованные аудио данные
   */
  convertFloat32ToInt16(float32Array) {
    const len = float32Array.length;
    const int16Array = new Int16Array(len);
    
    for (let i = 0; i < len; i++) {
      // Преобразуем значения из диапазона [-1.0, 1.0] в [-32768, 32767]
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    
    return int16Array;
  }
  
  /**
   * Устанавливает текущую комнату и собеседника
   * @param {string} roomId - ID комнаты звонка
   * @param {string} peerId - ID собеседника
   */
  setCallInfo(roomId, peerId) {
    this.roomId = roomId;
    this.peerId = peerId;
    
    this.log(`Установлена информация о звонке: комната ${roomId}, собеседник ${peerId}`, 'info');
    
    // Если настроено автоматическое включение и перевод разрешен
    if (this.settings.autoStart && this.enabled) {
      this.startTranslation();
    }
  }
  
  /**
   * Включает перевод речи в текущем звонке
   */
  startTranslation() {
    this.log('Попытка запустить перевод речи...', 'info');
    
    if (!this.ready) {
      this.log('Клиент перевода не готов', 'error');
      return;
    }
    
    if (!this.roomId) {
      this.log('Не установлена комната для звонка', 'error');
      return;
    }
    
    if (!this.websocket) {
      this.log('Нет WebSocket соединения', 'error');
      return;
    }
    
    if (this.websocket.readyState !== WebSocket.OPEN) {
      this.log(`WebSocket соединение не открыто, текущее состояние: ${this.websocket.readyState}`, 'error');
      return;
    }
    
    this.log(`Отправляем запрос на включение перевода в комнате ${this.roomId}`, 'info');
    
    // Автоматически активируем себя локально для начала отправки аудио
    this.active = true;
    
    // Отправляем настройки перевода на сервер
    this.websocket.send(JSON.stringify({
      type: 'translation-settings',
      payload: {
        sourceLanguage: this.settings.sourceLanguage,
        targetLanguage: this.settings.targetLanguage,
        voice: this.settings.voice
      }
    }));
    
    this.log('Отправлены настройки перевода на сервер', 'info');
    
    // Затем отправляем запрос на включение перевода
    setTimeout(() => {
      if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
        this.websocket.send(JSON.stringify({
          type: 'toggle-translation',
          payload: {
            enabled: true,
            roomId: this.roomId
          }
        }));
        
        this.log('Отправлен запрос на включение перевода', 'info');
        this.triggerEvent('translation-started', { roomId: this.roomId });
      } else {
        this.log('Не удалось отправить запрос на включение перевода, WebSocket закрыт', 'error');
        this.active = false;
      }
    }, 500); // Даем небольшую задержку, чтобы настройки были применены
  }
  
  /**
   * Выключает перевод речи в текущем звонке
   */
  stopTranslation() {
    if (!this.roomId || !this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
      return;
    }
    
    // Отправляем запрос на выключение перевода
    this.websocket.send(JSON.stringify({
      type: 'toggle-translation',
      payload: {
        enabled: false,
        roomId: this.roomId
      }
    }));
    
    this.log('Отправлен запрос на выключение перевода', 'info');
  }
  
  /**
   * Обновляет настройки перевода
   * @param {Object} newSettings - Новые настройки
   */
  updateSettings(newSettings) {
    const prevSettings = { ...this.settings };
    this.settings = { ...this.settings, ...newSettings };
    
    // Сохраняем настройки
    this.saveSettings();
    
    // Если настройки изменились и есть подключение, отправляем их на сервер
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      this.websocket.send(JSON.stringify({
        type: 'translation-settings',
        payload: {
          sourceLanguage: this.settings.sourceLanguage,
          targetLanguage: this.settings.targetLanguage,
          voice: this.settings.voice
        }
      }));
      
      this.log('Настройки перевода отправлены на сервер', 'info');
    }
  }
  
  /**
   * Включает/выключает перевод глобально
   * @param {boolean} state - Состояние перевода
   */
  setEnabled(state) {
    this.enabled = state;
    
    if (state) {
      this.triggerEvent('enabled', {});
      this.log('Перевод глобально включен', 'info');
      
      // Если уже в звонке и установлено автоматическое включение
      if (this.roomId && this.settings.autoStart) {
        this.startTranslation();
      }
    } else {
      // Если перевод был активен, останавливаем его
      if (this.active) {
        this.stopTranslation();
      }
      
      this.triggerEvent('disabled', {});
      this.log('Перевод глобально выключен', 'info');
    }
    
    // Сохраняем состояние
    localStorage.setItem('translation_enabled', state ? 'true' : 'false');
  }
  
  /**
   * Подписывается на события
   * @param {string} eventName - Название события
   * @param {Function} callback - Обработчик события
   */
  on(eventName, callback) {
    if (this.eventHandlers[eventName]) {
      this.eventHandlers[eventName].push(callback);
    }
  }
  
  /**
   * Отписывается от события
   * @param {string} eventName - Название события
   * @param {Function} callback - Обработчик события
   */
  off(eventName, callback) {
    if (this.eventHandlers[eventName]) {
      this.eventHandlers[eventName] = this.eventHandlers[eventName].filter(
        handler => handler !== callback
      );
    }
  }
  
  /**
   * Вызывает обработчики события
   * @param {string} eventName - Название события
   * @param {Object} data - Данные события
   */
  triggerEvent(eventName, data) {
    if (this.eventHandlers[eventName]) {
      this.eventHandlers[eventName].forEach(handler => {
        try {
          handler(data);
        } catch (error) {
          this.log(`Ошибка в обработчике события ${eventName}: ${error.message}`, 'error');
        }
      });
    }
  }
  
  /**
   * Загружает настройки из localStorage
   */
  loadSettings() {
    try {
      // Загружаем настройки перевода
      const savedSettings = localStorage.getItem('translation_settings');
      if (savedSettings) {
        this.settings = { ...this.settings, ...JSON.parse(savedSettings) };
      }
      
      // Загружаем состояние перевода
      const enabled = localStorage.getItem('translation_enabled');
      this.enabled = enabled === 'true';
      
      this.log('Настройки перевода загружены', 'info');
    } catch (error) {
      this.log(`Ошибка при загрузке настроек перевода: ${error.message}`, 'error');
    }
  }
  
  /**
   * Сохраняет настройки в localStorage
   */
  saveSettings() {
    try {
      localStorage.setItem('translation_settings', JSON.stringify(this.settings));
      this.log('Настройки перевода сохранены', 'info');
    } catch (error) {
      this.log(`Ошибка при сохранении настроек перевода: ${error.message}`, 'error');
    }
  }
  
  /**
   * Функция логирования
   * @param {string} message - Сообщение для логирования
   * @param {string} level - Уровень важности (debug, info, warn, error)
   */
  log(message, level = 'info') {
    const timestamp = new Date().toISOString();
    const prefix = `[AITranslation] ${timestamp}`;
    
    switch (level) {
      case 'debug':
        console.debug(`${prefix} 🔍 DEBUG: ${message}`);
        break;
      case 'info':
        console.info(`${prefix} ℹ️ INFO: ${message}`);
        break;
      case 'warn':
        console.warn(`${prefix} ⚠️ WARN: ${message}`);
        break;
      case 'error':
        console.error(`${prefix} ❌ ERROR: ${message}`);
        break;
      default:
        console.log(`${prefix} ${message}`);
    }
  }
}

// Создаем глобальный экземпляр
window.aiTranslationClient = new AITranslationClient();
