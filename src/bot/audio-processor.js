/**
 * Модуль для обработки аудио данных и их передачи между участниками звонка
 * Интегрируется с AI Translation Service для перевода речи в реальном времени
 */

const aiTranslationService = require('./ai-translation-service');

class AudioProcessor {
  constructor() {
    // Настройки обработки аудио
    this.sampleRate = 16000; // Стандартная частота дискретизации для OpenAI API
    this.channels = 1; // Моно
    this.bitDepth = 16; // 16 бит
    
    // Колбеки для разных типов обработчиков
    this.translationCallbacks = new Map(); // roomId -> callback
    
    // Флаг логирования
    this.loggingEnabled = true;
  }
  
  /**
   * Обрабатывает аудио данные от пользователя
   * @param {string} userId - ID пользователя, от которого получено аудио
   * @param {string} roomId - ID комнаты звонка
   * @param {ArrayBuffer} audioData - Сырые аудио данные
   * @param {Array<string>} recipients - Список ID пользователей, которым нужно отправить данные
   * @param {boolean} translate - Флаг необходимости перевода
   * @returns {Promise<Object>} - Результат обработки
   */
  async processAudio(userId, roomId, audioData, recipients, translate = false) {
    try {
      // Если перевод включен, отправляем аудио в сервис AI-Translation
      if (translate) {
        // Получаем callback для этой комнаты
        const callback = this.getTranslationCallback(roomId);
        
        // Отправляем аудио в сервис перевода для обработки
        await aiTranslationService.processAudio(userId, audioData, callback);
      }
      
      // Возвращаем информацию об обработке
      return {
        success: true,
        userId: userId,
        roomId: roomId,
        processed: translate,
        recipients: recipients.length
      };
    } catch (error) {
      this.log(`Ошибка при обработке аудио от пользователя ${userId}: ${error.message}`, 'error');
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Получает или создает callback для обработки результатов перевода
   * @param {string} roomId - ID комнаты звонка
   * @returns {Function} - Callback функция
   */
  getTranslationCallback(roomId) {
    if (this.translationCallbacks.has(roomId)) {
      return this.translationCallbacks.get(roomId);
    }
    
    // Создаем новый callback для этой комнаты
    const callback = (userId, result) => {
      this.handleTranslationResult(roomId, userId, result);
    };
    
    this.translationCallbacks.set(roomId, callback);
    return callback;
  }
  
  /**
   * Обрабатывает результаты перевода от сервиса AI-Translation
   * @param {string} roomId - ID комнаты звонка
   * @param {string} userId - ID пользователя, речь которого переведена
   * @param {Object} result - Результат перевода
   */
  handleTranslationResult(roomId, userId, result) {
    // Логируем результат
    if (result.type === 'translation' || result.type === 'transcript') {
      this.log(`[Комната ${roomId}] [Пользователь ${userId}] ${result.type}: ${result.text}`, 'info');
    } else if (result.type === 'audio') {
      this.log(`[Комната ${roomId}] [Пользователь ${userId}] Получены аудио данные перевода`, 'debug');
    } else if (result.type === 'error') {
      this.log(`[Комната ${roomId}] [Пользователь ${userId}] Ошибка перевода: ${result.message}`, 'error');
    }
    
    // Здесь должен быть код для отправки результатов другим участникам звонка
    // Будет реализован через сигнальный сервер
  }
  
  /**
   * Функция логирования с уровнями важности
   * @param {string} message - Сообщение для логирования
   * @param {string} level - Уровень важности (debug, info, warn, error)
   */
  log(message, level = 'info') {
    if (!this.loggingEnabled) return;
    
    const timestamp = new Date().toISOString();
    
    switch (level.toLowerCase()) {
      case 'debug':
        console.debug(`[${timestamp}] [AudioProcessor] 🔍 DEBUG: ${message}`);
        break;
      case 'info':
        console.info(`[${timestamp}] [AudioProcessor] ℹ️ INFO: ${message}`);
        break;
      case 'warn':
        console.warn(`[${timestamp}] [AudioProcessor] ⚠️ WARN: ${message}`);
        break;
      case 'error':
        console.error(`[${timestamp}] [AudioProcessor] ❌ ERROR: ${message}`);
        break;
      default:
        console.log(`[${timestamp}] [AudioProcessor] ${message}`);
    }
  }
}

// Экспортируем синглтон-экземпляр класса
const audioProcessor = new AudioProcessor();
module.exports = audioProcessor;
