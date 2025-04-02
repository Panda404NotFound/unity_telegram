/**
 * Сервис для работы с OpenAI Realtime API для перевода голоса в звонках
 * Интеграция с сигнальным сервером WebRTC для обработки голоса участников
 */

const { OpenAI } = require('openai');
const WebSocket = require('ws');

// URL для получения ключа сессии OpenAI Realtime API
const REALTIME_SESSION_URL = 'https://api.openai.com/v1/realtime/sessions';

class AITranslationService {
  constructor() {
    // Клиент OpenAI
    this.openai = null;
    
    // Хранилище ассистентов для пользователей
    // userId -> { wsConnection, sessionInfo, model, voice, language, connectionState }
    this.assistants = new Map();
    
    // Список поддерживаемых языков для перевода
    this.supportedLanguages = ['ru', 'en'];
    
    // Логирование активно по умолчанию
    this.loggingEnabled = true;
  }

  /**
   * Инициализация сервиса с API ключом OpenAI
   * @param {string} apiKey - API ключ OpenAI
   */
  init(apiKey) {
    if (!apiKey) {
      this.log('ОШИБКА: API ключ OpenAI не указан. Перевод будет недоступен.', 'error');
      return false;
    }

    try {
      this.openai = new OpenAI({
        apiKey: apiKey
      });
      
      this.log('AI Translation Service успешно инициализирован', 'info');
      return true;
    } catch (error) {
      this.log(`ОШИБКА при инициализации OpenAI клиента: ${error.message}`, 'error');
      return false;
    }
  }

  /**
   * Создаёт системный промпт для модели в зависимости от языка
   * @param {string} sourceLanguage - Исходный язык говорящего
   * @param {string} targetLanguage - Целевой язык перевода
   * @returns {string} - Системный промпт для модели
   */
  getSystemPrompt(sourceLanguage, targetLanguage) {
    // Определяем названия языков для лучшего понимания
    const languageNames = {
      'ru': 'русский',
      'en': 'английский'
    };
    
    const sourceLangName = languageNames[sourceLanguage] || sourceLanguage;
    const targetLangName = languageNames[targetLanguage] || targetLanguage;

    if (targetLanguage === 'ru') {
      return `Вы - ассистент для перевода речи. Ваша задача переводить всё, что вы слышите, с ${sourceLangName} на ${targetLangName}.

Важные инструкции:
1. Переводите каждое предложение дословно, но грамматически правильно на ${targetLangName} язык
2. Сохраняйте смысл и тон говорящего
3. НЕ добавляйте свои комментарии или объяснения
4. НЕ отвечайте на вопросы, просто переводите их
5. Используйте соответствующие эмоции и интонации при переводе
6. Кратко, без лишних слов и вводных конструкций

Примеры:
Если человек спрашивает: "How are you doing today?"
Вы переводите: "Как у тебя дела сегодня?"

Если человек говорит: "I'm feeling a bit under the weather."
Вы переводите: "Я чувствую себя немного неважно."`;
    } else {
      return `You are a speech translation assistant. Your task is to translate everything you hear from ${sourceLangName} to ${targetLangName}.

Important instructions:
1. Translate each sentence literally but grammatically correct to ${targetLangName}
2. Preserve the meaning and tone of the speaker
3. DO NOT add any of your own comments or explanations
4. DO NOT answer questions, just translate them
5. Use appropriate emotions and intonations when translating
6. Be concise, without unnecessary words or introductory phrases

Examples:
If the person asks: "Как у тебя дела сегодня?"
You translate: "How are you today?"

If the person says: "Я чувствую себя немного неважно."
You translate: "I'm feeling a bit under the weather."`;
    }
  }

  /**
   * Получает токен сессии от OpenAI для WebRTC соединения
   * @param {string} sourceLanguage - Исходный язык говорящего
   * @param {string} targetLanguage - Целевой язык перевода
   * @param {string} voice - Голос для синтеза речи
   * @returns {Promise<Object>} - Данные сессии
   */
  async getSessionToken(sourceLanguage, targetLanguage, voice = 'alloy') {
    try {
      if (!this.openai) {
        throw new Error('OpenAI клиент не инициализирован');
      }

      const instructions = this.getSystemPrompt(sourceLanguage, targetLanguage);
      
      this.log(`Получение токена сессии для ${sourceLanguage} -> ${targetLanguage}`, 'info');
      
      // Используем fetch для REST API запроса
      const response = await fetch(REALTIME_SESSION_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.openai.apiKey}`,
          'Content-Type': 'application/json',
          'OpenAI-Beta': 'realtime=v1'
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini-realtime-preview',
          voice: voice,
          instructions: instructions
        })
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ошибка API: ${response.status} ${errorText}`);
      }
      
      const data = await response.json();
      this.log('Получен URL для WebSocket соединения', 'info');
      return data;
    } catch (error) {
      this.log(`Ошибка получения токена сессии OpenAI: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * Создает или обновляет ИИ-ассистента для пользователя
   * @param {string} userId - ID пользователя
   * @param {Object} settings - Настройки ассистента
   * @returns {Promise<boolean>} - Успешность операции
   */
  async createAssistant(userId, settings = {}) {
    try {
      // Значения по умолчанию
      const sourceLanguage = settings.sourceLanguage || 'ru';
      const targetLanguage = settings.targetLanguage || 'en';
      const voice = settings.voice || 'alloy';
      const model = settings.model || 'gpt-4o-mini-realtime-preview';
      
      // Проверяем, существует ли ассистент
      const existingAssistant = this.assistants.get(userId);
      
      // Если ассистент существует и настройки не изменились, не пересоздаем его
      if (existingAssistant && 
          existingAssistant.settings && 
          existingAssistant.settings.sourceLanguage === sourceLanguage &&
          existingAssistant.settings.targetLanguage === targetLanguage &&
          existingAssistant.settings.voice === voice &&
          existingAssistant.settings.model === model) {
        
        this.log(`Используем существующего ассистента для пользователя ${userId}`, 'info');
        return true;
      }
      
      // Получаем токен сессии от OpenAI
      const sessionInfo = await this.getSessionToken(sourceLanguage, targetLanguage, voice);
      
      // Сохраняем информацию об ассистенте
      this.assistants.set(userId, {
        sessionInfo: sessionInfo,
        settings: {
          sourceLanguage,
          targetLanguage,
          voice,
          model
        },
        active: false,
        connectionState: 'ready',
        createdAt: new Date().toISOString()
      });
      
      this.log(`Создан новый ассистент для пользователя ${userId} (${sourceLanguage} -> ${targetLanguage})`, 'info');
      return true;
    } catch (error) {
      this.log(`Ошибка при создании ассистента для пользователя ${userId}: ${error.message}`, 'error');
      return false;
    }
  }

  /**
   * Активирует ассистента для звонка
   * @param {string} userId - ID пользователя
   * @param {string} callId - ID звонка
   * @returns {Promise<boolean>} - Успешность операции
   */
  async activateAssistant(userId, callId) {
    try {
      const assistant = this.assistants.get(userId);
      
      if (!assistant) {
        this.log(`Ассистент для пользователя ${userId} не найден`, 'error');
        return false;
      }
      
      if (assistant.active) {
        this.log(`Ассистент для пользователя ${userId} уже активен`, 'warn');
        return true;
      }
      
      // Обновляем статус ассистента
      assistant.active = true;
      assistant.callId = callId;
      assistant.connectionState = 'connecting';
      this.assistants.set(userId, assistant);
      
      this.log(`Ассистент для пользователя ${userId} активирован (звонок: ${callId})`, 'info');
      return true;
    } catch (error) {
      this.log(`Ошибка при активации ассистента для пользователя ${userId}: ${error.message}`, 'error');
      return false;
    }
  }

  /**
   * Деактивирует ассистента после звонка
   * @param {string} userId - ID пользователя
   * @returns {Promise<boolean>} - Успешность операции
   */
  async deactivateAssistant(userId) {
    try {
      const assistant = this.assistants.get(userId);
      
      if (!assistant) {
        this.log(`Ассистент для пользователя ${userId} не найден`, 'warn');
        return false;
      }
      
      if (!assistant.active) {
        this.log(`Ассистент для пользователя ${userId} уже деактивирован`, 'warn');
        return true;
      }
      
      // Если есть активное WebSocket соединение, закрываем его
      if (assistant.wsConnection && assistant.wsConnection.readyState === WebSocket.OPEN) {
        assistant.wsConnection.close();
        assistant.wsConnection = null;
      }
      
      // Обновляем статус ассистента
      assistant.active = false;
      assistant.callId = null;
      assistant.connectionState = 'ready';
      this.assistants.set(userId, assistant);
      
      this.log(`Ассистент для пользователя ${userId} деактивирован`, 'info');
      return true;
    } catch (error) {
      this.log(`Ошибка при деактивации ассистента для пользователя ${userId}: ${error.message}`, 'error');
      return false;
    }
  }

  /**
   * Обработка аудио от пользователя и отправка перевода
   * @param {string} userId - ID пользователя
   * @param {ArrayBuffer} audioData - Аудио данные
   * @param {Function} translationCallback - Колбэк для получения перевода
   */
  async processAudio(userId, audioData, translationCallback) {
    try {
      const assistant = this.assistants.get(userId);
      
      if (!assistant || !assistant.active) {
        this.log(`Невозможно обработать аудио: ассистент не активен для пользователя ${userId}`, 'warn');
        return;
      }
      
      // Если соединение не установлено, устанавливаем его
      if (!assistant.wsConnection || assistant.wsConnection.readyState !== WebSocket.OPEN) {
        await this.setupWebSocketConnection(userId, translationCallback);
      }
      
      // Отправляем аудио данные через WebSocket
      if (assistant.wsConnection && assistant.wsConnection.readyState === WebSocket.OPEN) {
        assistant.wsConnection.send(audioData);
      }
    } catch (error) {
      this.log(`Ошибка при обработке аудио для пользователя ${userId}: ${error.message}`, 'error');
    }
  }

  /**
   * Настраивает WebSocket соединение для пользователя
   * @param {string} userId - ID пользователя
   * @param {Function} translationCallback - Колбэк для получения перевода
   * @returns {Promise<boolean>} - Успешность операции
   */
  async setupWebSocketConnection(userId, translationCallback) {
    try {
      const assistant = this.assistants.get(userId);
      
      if (!assistant) {
        this.log(`Ассистент для пользователя ${userId} не найден`, 'error');
        return false;
      }
      
      if (!assistant.sessionInfo || !assistant.sessionInfo.url) {
        this.log(`Отсутствует информация о сессии для пользователя ${userId}`, 'error');
        return false;
      }
      
      // Если соединение уже установлено, закрываем его
      if (assistant.wsConnection && assistant.wsConnection.readyState === WebSocket.OPEN) {
        assistant.wsConnection.close();
      }
      
      // Создаем новое WebSocket соединение
      const ws = new WebSocket(assistant.sessionInfo.url);
      
      ws.binaryType = 'arraybuffer';
      
      // Обработка открытия соединения
      ws.addEventListener('open', () => {
        this.log(`WebSocket соединение установлено для пользователя ${userId}`, 'info');
        
        // Аутентификация с клиентским секретом
        const authMessage = {
          type: 'auth',
          client_secret: assistant.sessionInfo.client_secret
        };
        
        ws.send(JSON.stringify(authMessage));
        
        // Отправляем инициализационное сообщение
        const initMessage = {
          type: 'init',
          model: assistant.settings.model,
          voice: assistant.settings.voice,
          use_vad: true
        };
        
        ws.send(JSON.stringify(initMessage));
        
        // Обновляем состояние ассистента
        assistant.connectionState = 'connected';
        assistant.lastConnectionTime = new Date().toISOString();
        this.assistants.set(userId, assistant);
      });
      
      // Обработка сообщений
      ws.addEventListener('message', (event) => {
        try {
          // Для текстовых сообщений
          if (typeof event.data === 'string') {
            const data = JSON.parse(event.data);
            
            if (data.type === 'speech') {
              // Получен перевод в виде текста
              this.log(`Получен перевод для пользователя ${userId}: ${data.text}`, 'info');
              
              // Вызываем колбэк с результатом перевода
              if (translationCallback && typeof translationCallback === 'function') {
                translationCallback(userId, {
                  type: 'translation',
                  text: data.text,
                  final: data.final || false
                });
              }
            } 
            else if (data.type === 'transcript') {
              // Получена расшифровка исходной речи
              this.log(`Получена расшифровка для пользователя ${userId}: ${data.text}`, 'debug');
              
              // Вызываем колбэк с результатом расшифровки
              if (translationCallback && typeof translationCallback === 'function') {
                translationCallback(userId, {
                  type: 'transcript',
                  text: data.text,
                  final: data.final || false
                });
              }
            }
            else if (data.type === 'error') {
              this.log(`Ошибка OpenAI WebSocket для пользователя ${userId}: ${data.message}`, 'error');
              
              // Вызываем колбэк с ошибкой
              if (translationCallback && typeof translationCallback === 'function') {
                translationCallback(userId, {
                  type: 'error',
                  message: data.message
                });
              }
            }
          }
          // Для бинарных аудио данных (синтезированная речь)
          else if (event.data instanceof ArrayBuffer) {
            // Вызываем колбэк с аудио данными
            if (translationCallback && typeof translationCallback === 'function') {
              translationCallback(userId, {
                type: 'audio',
                data: event.data
              });
            }
          }
        } catch (error) {
          this.log(`Ошибка при обработке сообщения от OpenAI для пользователя ${userId}: ${error.message}`, 'error');
        }
      });
      
      // Обработка ошибок
      ws.addEventListener('error', (error) => {
        this.log(`Ошибка WebSocket для пользователя ${userId}: ${error.message}`, 'error');
        
        // Обновляем состояние ассистента
        assistant.connectionState = 'error';
        assistant.lastError = error.message;
        this.assistants.set(userId, assistant);
        
        // Вызываем колбэк с ошибкой
        if (translationCallback && typeof translationCallback === 'function') {
          translationCallback(userId, {
            type: 'error',
            message: error.message
          });
        }
      });
      
      // Обработка закрытия соединения
      ws.addEventListener('close', (event) => {
        this.log(`WebSocket соединение закрыто для пользователя ${userId} (код: ${event.code})`, 'info');
        
        // Обновляем состояние ассистента
        assistant.connectionState = 'disconnected';
        this.assistants.set(userId, assistant);
        
        // Вызываем колбэк с уведомлением о закрытии
        if (translationCallback && typeof translationCallback === 'function') {
          translationCallback(userId, {
            type: 'disconnected',
            code: event.code
          });
        }
      });
      
      // Сохраняем соединение в ассистенте
      assistant.wsConnection = ws;
      this.assistants.set(userId, assistant);
      
      return true;
    } catch (error) {
      this.log(`Ошибка при настройке WebSocket соединения для пользователя ${userId}: ${error.message}`, 'error');
      return false;
    }
  }

  /**
   * Получает список всех ассистентов
   * @returns {Array} - Массив объектов с информацией об ассистентах
   */
  getAssistantsList() {
    const list = [];
    
    for (const [userId, assistant] of this.assistants.entries()) {
      list.push({
        userId,
        active: assistant.active,
        connectionState: assistant.connectionState,
        settings: assistant.settings,
        createdAt: assistant.createdAt,
        callId: assistant.callId || null
      });
    }
    
    return list;
  }

  /**
   * Получает ассистента по ID пользователя
   * @param {string} userId - ID пользователя
   * @returns {Object|null} - Объект ассистента или null
   */
  getAssistant(userId) {
    const assistant = this.assistants.get(userId);
    
    if (!assistant) {
      return null;
    }
    
    return {
      userId,
      active: assistant.active,
      connectionState: assistant.connectionState,
      settings: assistant.settings,
      createdAt: assistant.createdAt,
      callId: assistant.callId || null
    };
  }

  /**
   * Удаляет ассистента для пользователя
   * @param {string} userId - ID пользователя
   * @returns {boolean} - Успешность операции
   */
  removeAssistant(userId) {
    try {
      const assistant = this.assistants.get(userId);
      
      if (!assistant) {
        this.log(`Ассистент для пользователя ${userId} не найден`, 'warn');
        return false;
      }
      
      // Если ассистент активен, деактивируем его
      if (assistant.active) {
        this.deactivateAssistant(userId);
      }
      
      // Удаляем ассистента из хранилища
      this.assistants.delete(userId);
      
      this.log(`Ассистент для пользователя ${userId} удален`, 'info');
      return true;
    } catch (error) {
      this.log(`Ошибка при удалении ассистента для пользователя ${userId}: ${error.message}`, 'error');
      return false;
    }
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
        console.debug(`[${timestamp}] [AI-Translation] 🔍 DEBUG: ${message}`);
        break;
      case 'info':
        console.info(`[${timestamp}] [AI-Translation] ℹ️ INFO: ${message}`);
        break;
      case 'warn':
        console.warn(`[${timestamp}] [AI-Translation] ⚠️ WARN: ${message}`);
        break;
      case 'error':
        console.error(`[${timestamp}] [AI-Translation] ❌ ERROR: ${message}`);
        break;
      default:
        console.log(`[${timestamp}] [AI-Translation] ${message}`);
    }
  }
}

// Экспортируем синглтон-экземпляр сервиса
const aiTranslationService = new AITranslationService();
module.exports = aiTranslationService;
