/**
 * Модуль настроек для системы перевода речи в реальном времени с OpenAI Realtime API
 * Позволяет управлять языковыми настройками, моделями и предпочтениями пользователя
 */

class TranslationSettings {
  constructor() {
    // Доступные языки для перевода
    this.availableLanguages = [
      { code: 'ru', name: 'Русский', instructions: this._getRussianInstructions() },
      { code: 'en', name: 'Английский', instructions: this._getEnglishInstructions() }
    ];
    
    // Доступные модели OpenAI Realtime API
    this.availableModels = [
      { id: 'gpt-4o-mini-realtime-preview', name: 'GPT-4o mini Realtime' },
      { id: 'gpt-4o-realtime-preview', name: 'GPT-4o Realtime' }
    ];
    
    // Доступные голоса для TTS
    this.availableVoices = [
      { id: 'alloy', name: 'Alloy' },
      { id: 'echo', name: 'Echo' },
      { id: 'fable', name: 'Fable' },
      { id: 'onyx', name: 'Onyx' },
      { id: 'nova', name: 'Nova' },
      { id: 'shimmer', name: 'Shimmer' }
    ];
    
    // Загружаем сохраненные настройки из localStorage или используем значения по умолчанию
    this.loadSettings();
    
    // Инициализация обработчиков событий для настроек
    this.eventListeners = {
      'language-change': [],
      'model-change': [],
      'voice-change': []
    };
  }
  
  /**
   * Загружает настройки пользователя из localStorage
   */
  loadSettings() {
    try {
      const savedSettings = localStorage.getItem('translation_settings');
      const settings = savedSettings ? JSON.parse(savedSettings) : null;
      
      // Загружаем настройки или устанавливаем значения по умолчанию
      this.targetLanguage = settings?.targetLanguage || 'ru'; // Язык, на который переводим
      this.model = settings?.model || 'gpt-4o-mini-realtime-preview'; // Модель по умолчанию
      this.voice = settings?.voice || 'alloy'; // Голос по умолчанию
      this.useVAD = settings?.useVAD !== undefined ? settings.useVAD : true; // Использовать VAD (Voice Activity Detection)
      this.muteOriginal = settings?.muteOriginal !== undefined ? settings.muteOriginal : false; // По умолчанию не заглушаем оригинальный звук
      
      console.log(`[TranslationSettings] Настройки загружены: целевой язык = ${this.targetLanguage}, модель = ${this.model}, голос = ${this.voice}, звук оригинала ${this.muteOriginal ? 'заглушен' : 'воспроизводится'}`);
    } catch (error) {
      console.error('[TranslationSettings] Ошибка при загрузке настроек:', error);
      this.targetLanguage = 'ru'; // Значение по умолчанию при ошибке
      this.model = 'gpt-4o-mini-realtime-preview';
      this.voice = 'alloy';
      this.useVAD = true;
      this.muteOriginal = false; // По умолчанию не заглушаем оригинальный звук
    }
  }
  
  /**
   * Сохраняет настройки пользователя в localStorage
   */
  saveSettings() {
    try {
      const settings = {
        targetLanguage: this.targetLanguage,
        model: this.model,
        voice: this.voice,
        useVAD: this.useVAD,
        muteOriginal: this.muteOriginal
      };
      
      localStorage.setItem('translation_settings', JSON.stringify(settings));
      console.log('[TranslationSettings] Настройки сохранены');
      
      // Сигнал внешним модулям о том, что настройки были обновлены
      this.triggerEvent('settings-updated', settings);
    } catch (error) {
      console.error('[TranslationSettings] Ошибка при сохранении настроек:', error);
    }
  }
  
  /**
   * Устанавливает целевой язык перевода
   * @param {string} languageCode - Код языка (ru, en)
   */
  setTargetLanguage(languageCode) {
    if (!this.isValidLanguage(languageCode)) {
      console.error(`[TranslationSettings] Неподдерживаемый язык: ${languageCode}`);
      return false;
    }
    
    const prevLanguage = this.targetLanguage;
    this.targetLanguage = languageCode;
    this.saveSettings();
    
    // Запускаем событие изменения языка
    if (prevLanguage !== languageCode) {
      this.triggerEvent('language-change', { 
        prevLanguage, 
        newLanguage: languageCode,
        instructions: this.getCurrentLanguageInstructions()
      });
    }
    
    console.log(`[TranslationSettings] Установлен целевой язык: ${languageCode}`);
    return true;
  }
  
  /**
   * Устанавливает модель для перевода
   * @param {string} modelId - ID модели
   */
  setModel(modelId) {
    if (!this.isValidModel(modelId)) {
      console.error(`[TranslationSettings] Неподдерживаемая модель: ${modelId}`);
      return false;
    }
    
    const prevModel = this.model;
    this.model = modelId;
    this.saveSettings();
    
    // Запускаем событие изменения модели
    if (prevModel !== modelId) {
      this.triggerEvent('model-change', { 
        prevModel, 
        newModel: modelId 
      });
    }
    
    console.log(`[TranslationSettings] Установлена модель: ${modelId}`);
    return true;
  }
  
  /**
   * Устанавливает голос для синтеза речи
   * @param {string} voiceId - ID голоса
   */
  setVoice(voiceId) {
    if (!this.isValidVoice(voiceId)) {
      console.error(`[TranslationSettings] Неподдерживаемый голос: ${voiceId}`);
      return false;
    }
    
    const prevVoice = this.voice;
    this.voice = voiceId;
    this.saveSettings();
    
    // Запускаем событие изменения голоса
    if (prevVoice !== voiceId) {
      this.triggerEvent('voice-change', { 
        prevVoice, 
        newVoice: voiceId 
      });
    }
    
    console.log(`[TranslationSettings] Установлен голос: ${voiceId}`);
    return true;
  }
  
  /**
   * Устанавливает режим использования VAD
   * @param {boolean} useVAD - Использовать VAD
   */
  setUseVAD(useVAD) {
    this.useVAD = useVAD;
    this.saveSettings();
    console.log(`[TranslationSettings] Режим VAD: ${useVAD ? 'включен' : 'выключен'}`);
    return true;
  }
  
  /**
   * Устанавливает режим заглушения оригинального звука
   * @param {boolean} muteOriginal - Заглушать оригинальный звук
   */
  setMuteOriginal(muteOriginal) {
    // Если значение уже установлено, не делаем ничего
    if (this.muteOriginal === muteOriginal) {
      return true;
    }
    
    this.muteOriginal = muteOriginal;
    this.saveSettings();
    console.log(`[TranslationSettings] Оригинальный звук ${muteOriginal ? 'заглушен' : 'воспроизводится'}`);
    
    // Запускаем событие изменения настройки заглушения
    this.triggerEvent('mute-original-change', { muteOriginal });
    
    return true;
  }
  
  /**
   * Получает текущий целевой язык перевода
   * @returns {string} Код языка
   */
  getTargetLanguage() {
    return this.targetLanguage;
  }
  
  /**
   * Получает инструкции для текущего языка перевода
   * @returns {string} Инструкции для модели
   */
  getCurrentLanguageInstructions() {
    const language = this.availableLanguages.find(lang => lang.code === this.targetLanguage);
    return language ? language.instructions : this._getDefaultInstructions();
  }
  
  /**
   * Получает текущую модель
   * @returns {string} ID модели
   */
  getModel() {
    return this.model;
  }
  
  /**
   * Получает текущий голос
   * @returns {string} ID голоса
   */
  getVoice() {
    return this.voice;
  }
  
  /**
   * Получает статус использования VAD
   * @returns {boolean} Использовать ли VAD
   */
  getUseVAD() {
    return this.useVAD;
  }
  
  /**
   * Получает статус заглушения оригинального звука
   * @returns {boolean} Заглушать ли оригинальный звук
   */
  getMuteOriginal() {
    return this.muteOriginal;
  }
  
  /**
   * Получает список доступных языков
   * @returns {Array} Список доступных языков
   */
  getAvailableLanguages() {
    return [...this.availableLanguages];
  }
  
  /**
   * Получает список доступных моделей
   * @returns {Array} Список доступных моделей
   */
  getAvailableModels() {
    return [...this.availableModels];
  }
  
  /**
   * Получает список доступных голосов
   * @returns {Array} Список доступных голосов
   */
  getAvailableVoices() {
    return [...this.availableVoices];
  }
  
  /**
   * Проверяет, поддерживается ли указанный язык
   * @param {string} languageCode - Код языка
   * @returns {boolean} Результат проверки
   */
  isValidLanguage(languageCode) {
    return this.availableLanguages.some(lang => lang.code === languageCode);
  }
  
  /**
   * Проверяет, поддерживается ли указанная модель
   * @param {string} modelId - ID модели
   * @returns {boolean} Результат проверки
   */
  isValidModel(modelId) {
    return this.availableModels.some(model => model.id === modelId);
  }
  
  /**
   * Проверяет, поддерживается ли указанный голос
   * @param {string} voiceId - ID голоса
   * @returns {boolean} Результат проверки
   */
  isValidVoice(voiceId) {
    return this.availableVoices.some(voice => voice.id === voiceId);
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
        console.error(`[TranslationSettings] Ошибка в обработчике события ${eventName}:`, error);
      }
    });
  }
  
  /**
   * Создает и добавляет элементы UI для настроек перевода
   * @param {HTMLElement} container - Элемент-контейнер для добавления UI
   */
  renderSettingsUI(container) {
    if (!container) {
      console.error('[TranslationSettings] Контейнер для UI настроек не указан');
      return;
    }
    
    // Создаем основной контейнер настроек
    const settingsContainer = document.createElement('div');
    settingsContainer.className = 'translation-settings';
    
    // Заголовок
    const heading = document.createElement('h3');
    heading.textContent = 'Настройки перевода';
    settingsContainer.appendChild(heading);
    
    // 1. Селектор языка
    const languageGroup = document.createElement('div');
    languageGroup.className = 'settings-group';
    
    const languageLabel = document.createElement('label');
    languageLabel.textContent = 'Язык перевода:';
    languageLabel.setAttribute('for', 'target-language-select');
    languageGroup.appendChild(languageLabel);
    
    const languageSelect = document.createElement('select');
    languageSelect.id = 'target-language-select';
    languageSelect.className = 'settings-select';
    
    this.availableLanguages.forEach(lang => {
      const option = document.createElement('option');
      option.value = lang.code;
      option.textContent = lang.name;
      option.selected = lang.code === this.targetLanguage;
      languageSelect.appendChild(option);
    });
    
    // Обработчик изменения языка
    languageSelect.addEventListener('change', (e) => {
      this.setTargetLanguage(e.target.value);
    });
    
    languageGroup.appendChild(languageSelect);
    settingsContainer.appendChild(languageGroup);
    
    // 2. Селектор модели
    const modelGroup = document.createElement('div');
    modelGroup.className = 'settings-group';
    
    const modelLabel = document.createElement('label');
    modelLabel.textContent = 'Модель OpenAI:';
    modelLabel.setAttribute('for', 'model-select');
    modelGroup.appendChild(modelLabel);
    
    const modelSelect = document.createElement('select');
    modelSelect.id = 'model-select';
    modelSelect.className = 'settings-select';
    
    this.availableModels.forEach(model => {
      const option = document.createElement('option');
      option.value = model.id;
      option.textContent = model.name;
      option.selected = model.id === this.model;
      modelSelect.appendChild(option);
    });
    
    // Обработчик изменения модели
    modelSelect.addEventListener('change', (e) => {
      this.setModel(e.target.value);
    });
    
    modelGroup.appendChild(modelSelect);
    settingsContainer.appendChild(modelGroup);
    
    // 3. Селектор голоса
    const voiceGroup = document.createElement('div');
    voiceGroup.className = 'settings-group';
    
    const voiceLabel = document.createElement('label');
    voiceLabel.textContent = 'Голос синтеза речи:';
    voiceLabel.setAttribute('for', 'voice-select');
    voiceGroup.appendChild(voiceLabel);
    
    const voiceSelect = document.createElement('select');
    voiceSelect.id = 'voice-select';
    voiceSelect.className = 'settings-select';
    
    this.availableVoices.forEach(voice => {
      const option = document.createElement('option');
      option.value = voice.id;
      option.textContent = voice.name;
      option.selected = voice.id === this.voice;
      voiceSelect.appendChild(option);
    });
    
    // Обработчик изменения голоса
    voiceSelect.addEventListener('change', (e) => {
      this.setVoice(e.target.value);
    });
    
    voiceGroup.appendChild(voiceSelect);
    settingsContainer.appendChild(voiceGroup);
    
    // 4. Переключатель VAD
    const vadGroup = document.createElement('div');
    vadGroup.className = 'settings-group';
    
    const vadCheck = document.createElement('input');
    vadCheck.type = 'checkbox';
    vadCheck.id = 'vad-checkbox';
    vadCheck.checked = this.useVAD;
    
    const vadLabel = document.createElement('label');
    vadLabel.textContent = 'Использовать автоматическое определение голоса (VAD)';
    vadLabel.setAttribute('for', 'vad-checkbox');
    
    // Обработчик изменения VAD
    vadCheck.addEventListener('change', (e) => {
      this.setUseVAD(e.target.checked);
    });
    
    vadGroup.appendChild(vadCheck);
    vadGroup.appendChild(vadLabel);
    settingsContainer.appendChild(vadGroup);
    
    // 5. Переключатель заглушения оригинального звука
    const muteOriginalGroup = document.createElement('div');
    muteOriginalGroup.className = 'settings-group';
    
    const muteOriginalCheck = document.createElement('input');
    muteOriginalCheck.type = 'checkbox';
    muteOriginalCheck.id = 'mute-original-checkbox';
    muteOriginalCheck.checked = this.muteOriginal;
    
    const muteOriginalLabel = document.createElement('label');
    muteOriginalLabel.textContent = 'Заглушать оригинальный звук';
    muteOriginalLabel.setAttribute('for', 'mute-original-checkbox');
    
    // Обработчик изменения заглушения оригинального звука
    muteOriginalCheck.addEventListener('change', (e) => {
      this.setMuteOriginal(e.target.checked);
    });
    
    muteOriginalGroup.appendChild(muteOriginalCheck);
    muteOriginalGroup.appendChild(muteOriginalLabel);
    settingsContainer.appendChild(muteOriginalGroup);
    
    // Добавляем контейнер настроек в указанный контейнер
    container.appendChild(settingsContainer);
    
    console.log('[TranslationSettings] UI настроек отрендерен');
  }

  /**
   * Генерирует инструкции для русского языка
   * @returns {string} Инструкции для модели
   * @private
   */
  _getRussianInstructions() {
    return `Ты помощник для перевода речи. Твоя задача - переводить всё, что услышишь, на русский язык.

Важные инструкции:
1. Переводи каждое предложение дословно, но грамматически правильно на русский язык
2. Сохраняй смысл и тон говорящего
3. НЕ добавляй никаких своих комментариев или разъяснений
4. НЕ отвечай на вопросы, а только переводи их
5. Используй соответствующие эмоции и интонации при переводе

Примеры:
Если собеседник спрашивает: "How are you today?"
Ты переводишь: "Как дела у тебя сегодня?"

Если собеседник говорит: "I'm feeling a bit under the weather."
Ты переводишь: "Я чувствую себя немного неважно."`;
  }
  
  /**
   * Генерирует инструкции для английского языка
   * @returns {string} Инструкции для модели
   * @private
   */
  _getEnglishInstructions() {
    return `You are a speech translation assistant. Your task is to translate everything you hear into English.

Important instructions:
1. Translate each sentence literally but grammatically correct to English
2. Preserve the meaning and tone of the speaker
3. DO NOT add any of your own comments or explanations
4. DO NOT answer questions, just translate them
5. Use appropriate emotions and intonations when translating

Examples:
If the person asks: "Как у тебя дела сегодня?"
You translate: "How are you today?"

If the person says: "Я чувствую себя немного неважно."
You translate: "I'm feeling a bit under the weather."`;
  }
  
  /**
   * Генерирует инструкции по умолчанию
   * @returns {string} Инструкции для модели
   * @private
   */
  _getDefaultInstructions() {
    return this._getRussianInstructions();
  }
}


// Экспортируем синглтон-экземпляр класса настроек
const translationSettings = new TranslationSettings();
export default translationSettings;
