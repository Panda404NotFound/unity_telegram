/**
 * Основной менеджер системы перевода речи в реальном времени
 * Координирует работу модулей настроек и OpenAI WebRTC, управляет аудио-потоками
 */

import translationSettings from './settings.js';
import openAIWebRTC from './openai_webrtc.js';

class TranslationManager {
  constructor() {
    this.isTranslating = false;
    this.currentCallId = null;
    this.remoteAudioElement = null;
    this.localAudioElement = null;
    this.apiKey = null;
    
    // Состояние менеджера
    this.state = {
      connectionStatus: 'disconnected', // disconnected, connecting, connected
      translationActive: false,
      errorMessage: null
    };
    
    // Инициализация обработчиков событий
    this.eventListeners = {
      'state-changed': [],
      'translation-result': [],
      'error': []
    };
    
    // Подписываемся на события изменения настроек
    this._setupSettingsListeners();
    
    // Подписываемся на события от модуля OpenAI WebRTC
    this._setupWebRTCListeners();
    
    console.log('[TranslationManager] Инициализирован');
  }
  
  /**
   * Устанавливает API ключ OpenAI
   * @param {string} apiKey - API ключ
   */
  setApiKey(apiKey) {
    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim() === '') {
      console.error('[TranslationManager] Недопустимый API ключ');
      this._triggerError('Необходимо указать действительный API ключ OpenAI');
      return false;
    }
    
    this.apiKey = apiKey;
    openAIWebRTC.setApiKey(apiKey);
    console.log('[TranslationManager] API ключ OpenAI установлен');
    
    return true;
  }
  
  /**
   * Инициализирует DOM элементы для аудио
   * @param {string} remoteAudioId - ID элемента для воспроизведения перевода
   * @param {string} localAudioId - ID элемента для воспроизведения локального звука (опционально)
   */
  initAudioElements(remoteAudioId, localAudioId = null) {
    // Инициализация элемента для воспроизведения перевода
    this.remoteAudioElement = document.getElementById(remoteAudioId);
    if (!this.remoteAudioElement) {
      console.error(`[TranslationManager] Элемент с ID "${remoteAudioId}" не найден`);
      this._triggerError(`Элемент аудио для перевода не найден: ${remoteAudioId}`);
      return false;
    }
    
    // Опционально инициализируем элемент для локального звука
    if (localAudioId) {
      this.localAudioElement = document.getElementById(localAudioId);
      if (!this.localAudioElement) {
        console.warn(`[TranslationManager] Элемент с ID "${localAudioId}" не найден`);
      }
    }
    
    console.log('[TranslationManager] Аудио элементы инициализированы');
    return true;
  }
  
  /**
   * Настраивает обработчики событий от модуля WebRTC
   * @private
   */
  _setupWebRTCListeners() {
    // Обработчик установления соединения
    openAIWebRTC.addEventListener('connected', (data) => {
      console.log('[TranslationManager] WebRTC соединение установлено');
      this.state.connectionStatus = 'connected';
      this._triggerStateChanged();
    });
    
    // Обработчик разрыва соединения
    openAIWebRTC.addEventListener('disconnected', (data) => {
      console.log(`[TranslationManager] WebRTC соединение разорвано: ${data.reason || 'Неизвестная причина'}`);
      this.state.connectionStatus = 'disconnected';
      this.state.translationActive = false;
      this._triggerStateChanged();
    });
    
    // Обработчик ошибок
    openAIWebRTC.addEventListener('error', (data) => {
      console.error(`[TranslationManager] Ошибка WebRTC: ${data.message}`);
      this._triggerError(data.message);
    });
    
    // Обработчик результатов перевода
    openAIWebRTC.addEventListener('translation-result', (data) => {
      console.log(`[TranslationManager] Получен результат перевода: ${JSON.stringify(data)}`);
      this._triggerEvent('translation-result', data);
    });
    
    // Обработчик исходной речи
    openAIWebRTC.addEventListener('transcript', (data) => {
      console.log(`[TranslationManager] Получена расшифровка речи: ${JSON.stringify(data)}`);
    });
  }
  
  /**
   * Запускает процесс перевода
   * @param {string} callId - Идентификатор текущего звонка
   * @returns {Promise} Промис, разрешающийся при успешном запуске перевода
   */
  async startTranslation(callId) {
    if (this.isTranslating) {
      console.warn('[TranslationManager] Перевод уже активен');
      return Promise.resolve();
    }
    
    if (!this.apiKey) {
      const error = 'API ключ OpenAI не установлен';
      console.error(`[TranslationManager] ${error}`);
      this._triggerError(error);
      return Promise.reject(new Error(error));
    }
    
    // Сохраняем ID вызова
    this.currentCallId = callId;
    
    // Получаем текущие настройки перевода
    const language = translationSettings.targetLanguage;
    const instructions = translationSettings.getInstructionsForLanguage(language);
    const model = translationSettings.model;
    const voice = translationSettings.voice;
    const useVAD = translationSettings.useVAD;
    
    try {
      // Обновляем состояние
      this.state.connectionStatus = 'connecting';
      this._triggerStateChanged();
      
      // Настраиваем WebRTC и начинаем перевод
      openAIWebRTC.setTargetLanguage(language, instructions);
      openAIWebRTC.setModel(model);
      openAIWebRTC.setVoice(voice);
      openAIWebRTC.setUseVAD(useVAD);
      
      console.log(`[TranslationManager] Начинаем перевод. Язык: ${language}, Модель: ${model}`);
      
      // Если есть аудио элементы, настраиваем их
      if (this.remoteAudioElement) {
        // Подготавливаем аудио элемент для воспроизведения
        this.remoteAudioElement.autoplay = true;
        this.remoteAudioElement.volume = 1.0;
      } else {
        const error = 'Аудио элементы не инициализированы';
        console.warn(`[TranslationManager] ${error}`);
      }
      
      // Запускаем WebRTC соединение
      await openAIWebRTC.connect();
      
      // Если мы дошли до этой точки, значит перевод успешно запущен
      this.isTranslating = true;
      this.state.translationActive = true;
      this._triggerStateChanged();
      
      return Promise.resolve();
    } catch (error) {
      console.error(`[TranslationManager] Ошибка при запуске перевода: ${error.message}`);
      this.state.connectionStatus = 'disconnected';
      this.state.errorMessage = error.message;
      this._triggerStateChanged();
      this._triggerError(error.message);
      
      return Promise.reject(error);
    }
    
    try {
      // Обновляем состояние
      this._updateState({
        connectionStatus: 'connecting',
        errorMessage: null
      });
      
      // Сохраняем ID звонка
      this.currentCallId = callId;
      
      // Получаем текущий целевой язык из настроек
      const targetLanguage = translationSettings.getTargetLanguage();
      openAIWebRTC.setTargetLanguage(targetLanguage);
      
      // Запускаем соединение WebRTC с OpenAI
      await openAIWebRTC.connect();
      
      console.log('[TranslationManager] Перевод запущен');
      this.isTranslating = true;
      
      // Обновляем состояние
      this._updateState({
        translationActive: true
      });
      
      return Promise.resolve();
    } catch (error) {
      console.error(`[TranslationManager] Ошибка запуска перевода: ${error.message}`);
      this._triggerError(`Ошибка запуска перевода: ${error.message}`);
      this._updateState({
        connectionStatus: 'disconnected',
        translationActive: false
      });
      return Promise.reject(error);
    }
  }
  
  /**
   * Останавливает процесс перевода
   * @returns {Promise} Промис, разрешающийся при успешной остановке перевода
   */
  async stopTranslation() {
    if (!this.isTranslating) {
      console.warn('[TranslationManager] Перевод не активен');
      return Promise.resolve();
    }
    
    try {
      // Отключаем WebRTC соединение с OpenAI
      await openAIWebRTC.disconnect();
      
      // Очищаем аудио элементы
      if (this.remoteAudioElement && this.remoteAudioElement.srcObject) {
        this.remoteAudioElement.srcObject = null;
      }
      
      if (this.localAudioElement && this.localAudioElement.srcObject) {
        this.localAudioElement.srcObject = null;
      }
      
      this.isTranslating = false;
      this.currentCallId = null;
      
      console.log('[TranslationManager] Перевод остановлен');
      
      // Обновляем состояние
      this._updateState({
        connectionStatus: 'disconnected',
        translationActive: false,
        errorMessage: null
      });
      
      return Promise.resolve();
    } catch (error) {
      console.error(`[TranslationManager] Ошибка остановки перевода: ${error.message}`);
      this._triggerError(`Ошибка остановки перевода: ${error.message}`);
      
      // Даже при ошибке считаем, что перевод остановлен
      this.isTranslating = false;
      this._updateState({
        connectionStatus: 'disconnected',
        translationActive: false
      });
      
      return Promise.reject(error);
    }
  }
  
  /**
   * Возвращает текущее состояние менеджера
   * @returns {Object} Объект с текущим состоянием
   */
  getState() {
    return { ...this.state };
  }
  
  /**
   * Создает и добавляет UI элементы управления переводом
   * @param {HTMLElement} container - Контейнер для добавления UI
   */
  renderTranslationUI(container) {
    if (!container) {
      console.error('[TranslationManager] Контейнер для UI не указан');
      return;
    }
    
    // Создаем основной контейнер перевода
    const translationContainer = document.createElement('div');
    translationContainer.className = 'translation-controls';
    
    // Заголовок
    const heading = document.createElement('h3');
    heading.textContent = 'Управление переводом';
    translationContainer.appendChild(heading);
    
    // Статус соединения
    const statusElement = document.createElement('div');
    statusElement.className = 'translation-status';
    statusElement.textContent = 'Статус: Не подключено';
    translationContainer.appendChild(statusElement);
    
    // Элемент для отображения ошибок
    const errorElement = document.createElement('div');
    errorElement.className = 'translation-error';
    errorElement.style.color = 'red';
    errorElement.style.display = 'none';
    translationContainer.appendChild(errorElement);
    
    // Кнопка запуска/остановки перевода
    const toggleButton = document.createElement('button');
    toggleButton.className = 'translation-toggle-btn';
    toggleButton.textContent = 'Запустить перевод';
    toggleButton.disabled = true; // Изначально отключена
    
    // Обработчик нажатия на кнопку
    toggleButton.addEventListener('click', async () => {
      if (this.isTranslating) {
        toggleButton.disabled = true;
        toggleButton.textContent = 'Останавливаем...';
        try {
          await this.stopTranslation();
          toggleButton.textContent = 'Запустить перевод';
        } catch (error) {
          console.error(`[TranslationManager] Ошибка: ${error.message}`);
        } finally {
          toggleButton.disabled = false;
        }
      } else {
        toggleButton.disabled = true;
        toggleButton.textContent = 'Запускаем...';
        try {
          // Генерируем временный ID звонка для демонстрации
          const tempCallId = `call_${Date.now()}`;
          await this.startTranslation(tempCallId);
          toggleButton.textContent = 'Остановить перевод';
        } catch (error) {
          console.error(`[TranslationManager] Ошибка: ${error.message}`);
        } finally {
          toggleButton.disabled = false;
        }
      }
    });
    
    translationContainer.appendChild(toggleButton);
    
    // Поле для ввода API ключа
    const apiKeyContainer = document.createElement('div');
    apiKeyContainer.className = 'translation-api-key';
    apiKeyContainer.style.marginTop = '15px';
    
    const apiKeyLabel = document.createElement('label');
    apiKeyLabel.textContent = 'API ключ OpenAI:';
    apiKeyLabel.setAttribute('for', 'openai-api-key');
    
    const apiKeyInput = document.createElement('input');
    apiKeyInput.type = 'password';
    apiKeyInput.id = 'openai-api-key';
    apiKeyInput.placeholder = 'Введите API ключ OpenAI';
    apiKeyInput.style.width = '100%';
    apiKeyInput.value = this.apiKey || '';
    
    const apiKeyButton = document.createElement('button');
    apiKeyButton.textContent = 'Сохранить API ключ';
    apiKeyButton.style.marginTop = '5px';
    
    apiKeyButton.addEventListener('click', () => {
      const apiKey = apiKeyInput.value.trim();
      if (apiKey) {
        if (this.setApiKey(apiKey)) {
          apiKeyButton.textContent = 'API ключ сохранен';
          toggleButton.disabled = false;
          setTimeout(() => {
            apiKeyButton.textContent = 'Сохранить API ключ';
          }, 2000);
        }
      } else {
        this._triggerError('Необходимо указать API ключ OpenAI');
      }
    });
    
    apiKeyContainer.appendChild(apiKeyLabel);
    apiKeyContainer.appendChild(apiKeyInput);
    apiKeyContainer.appendChild(apiKeyButton);
    
    translationContainer.appendChild(apiKeyContainer);
    
    // Аудио элементы для прослушивания перевода
    const audioContainer = document.createElement('div');
    audioContainer.className = 'translation-audio';
    audioContainer.style.marginTop = '15px';
    
    // Аудио для перевода
    const remoteAudioElement = document.createElement('audio');
    remoteAudioElement.id = 'translation-audio-output';
    remoteAudioElement.controls = true;
    remoteAudioElement.autoplay = true;
    remoteAudioElement.style.width = '100%';
    remoteAudioElement.style.display = 'none'; // Изначально скрыт
    
    audioContainer.appendChild(remoteAudioElement);
    translationContainer.appendChild(audioContainer);
    
    // Добавляем контейнер на страницу
    container.appendChild(translationContainer);
    
    // Инициализируем аудио элементы
    this.initAudioElements('translation-audio-output');
    
    // Обновляем UI при изменении состояния
    this.addEventListener('state-changed', (state) => {
      // Обновляем статус
      switch (state.connectionStatus) {
        case 'connected':
          statusElement.textContent = 'Статус: Подключено';
          statusElement.style.color = 'green';
          break;
        case 'connecting':
          statusElement.textContent = 'Статус: Подключение...';
          statusElement.style.color = 'orange';
          break;
        default:
          statusElement.textContent = 'Статус: Не подключено';
          statusElement.style.color = 'initial';
      }
      
      // Обновляем кнопку
      if (state.translationActive) {
        toggleButton.textContent = 'Остановить перевод';
      } else {
        toggleButton.textContent = 'Запустить перевод';
      }
      
      // Разблокируем кнопку при наличии API ключа
      toggleButton.disabled = !this.apiKey || state.connectionStatus === 'connecting';
      
      // Показываем/скрываем сообщение об ошибке
      if (state.errorMessage) {
        errorElement.textContent = state.errorMessage;
        errorElement.style.display = 'block';
      } else {
        errorElement.style.display = 'none';
      }
      
      // Показываем/скрываем аудио элемент
      remoteAudioElement.style.display = state.translationActive ? 'block' : 'none';
    });
    
    console.log('[TranslationManager] UI перевода отрендерен');
  }
  
  /**
   * Настраивает обработчики событий для настроек
   * @private
   */
  _setupSettingsListeners() {
    translationSettings.addEventListener('language-change', (data) => {
      console.log(`[TranslationManager] Изменен язык перевода: ${data.newLanguage}`);
      
      // Если перевод активен, обновляем язык в OpenAI WebRTC
      if (this.isTranslating) {
        openAIWebRTC.setTargetLanguage(data.newLanguage);
      }
    });
  }
  
  /**
   * Настраивает обработчики событий для OpenAI WebRTC
   * @private
   */
  _setupWebRTCListeners() {
    // Обработка подключения
    openAIWebRTC.addEventListener('connected', (data) => {
      console.log('[TranslationManager] WebRTC соединение установлено');
      this._updateState({
        connectionStatus: 'connected'
      });
    });
    
    // Обработка отключения
    openAIWebRTC.addEventListener('disconnected', (data) => {
      console.log(`[TranslationManager] WebRTC соединение разорвано: ${data.reason}`);
      this._updateState({
        connectionStatus: 'disconnected',
        translationActive: false
      });
      this.isTranslating = false;
    });
    
    // Обработка ошибок
    openAIWebRTC.addEventListener('error', (data) => {
      console.error(`[TranslationManager] Ошибка WebRTC: ${data.message}`);
      this._triggerError(data.message);
    });
    
    // Начало перевода (получен поток перевода)
    openAIWebRTC.addEventListener('translation-started', (data) => {
      console.log('[TranslationManager] Начат перевод речи');
      
      // Привязываем поток с переводом к аудио-элементу
      if (this.remoteAudioElement && data.stream) {
        this.remoteAudioElement.srcObject = data.stream;
        this.remoteAudioElement.play().catch(error => {
          console.error(`[TranslationManager] Ошибка воспроизведения аудио: ${error.message}`);
        });
      }
    });
    
    // Результаты перевода (текстовые)
    openAIWebRTC.addEventListener('translation-result', (data) => {
      console.log(`[TranslationManager] Получен текст перевода: ${JSON.stringify(data)}`);
      this.triggerEvent('translation-result', data);
    });
  }
  
  /**
   * Обновляет состояние менеджера и уведомляет подписчиков
   * @param {Object} newState - Объект с обновляемыми свойствами
   * @private
   */
  _updateState(newState) {
    const prevState = { ...this.state };
    this.state = { ...this.state, ...newState };
    
    // Проверяем, изменилось ли состояние
    const hasChanged = Object.keys(newState).some(key => prevState[key] !== this.state[key]);
    
    if (hasChanged) {
      this.triggerEvent('state-changed', this.state);
    }
  }
  
  /**
   * Активирует событие ошибки
   * @param {string} message - Сообщение об ошибке
   * @private
   */
  _triggerError(message) {
    this._updateState({
      errorMessage: message
    });
    
    this.triggerEvent('error', { message });
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
        console.error(`[TranslationManager] Ошибка в обработчике события ${eventName}: ${error.message}`);
      }
    });
  }
}

// Экспортируем синглтон-экземпляр класса
const translationManager = new TranslationManager();
export default translationManager;
