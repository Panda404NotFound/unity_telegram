const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const aiTranslationService = require('./ai-translation-service');
const audioProcessor = require('./audio-processor');

// Класс для управления сервером сигнализации WebRTC с поддержкой перевода речи через OpenAI
class SignalingServer {
  constructor() {
    this.wss = null; // WebSocket сервер
    this.clients = new Map(); // Клиенты: id -> WebSocket
    this.userIds = new Map(); // WebSocket -> id пользователя
    this.rooms = new Map(); // Комнаты для звонков: roomId -> набор id пользователей
    this.userRooms = new Map(); // Пользователь в комнате: userId -> roomId
    
    // Новые свойства для работы с переводом речи
    this.translationEnabled = false; // Глобальный флаг включения перевода
    this.userTranslationSettings = new Map(); // Настройки перевода: userId -> { enabled, sourceLanguage, targetLanguage, voice }
    this.roomTranslationState = new Map(); // Состояние перевода в комнате: roomId -> { enabled, participants: Map(userId -> isTranslating) }
  }

  // Инициализация WebSocket сервера и сервиса AI-Translation
  init(server) {
    // Создаем WebSocket сервер на базе существующего HTTP сервера
    this.wss = new WebSocket.Server({ server });
    
    // Инициализируем сервис AI-Translation если есть API ключ OpenAI
    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (openaiApiKey) {
      const success = aiTranslationService.init(openaiApiKey);
      if (success) {
        this.translationEnabled = true;
        console.log('✅ Сервис AI-Translation успешно инициализирован');
      } else {
        console.error('❌ Не удалось инициализировать сервис AI-Translation');
      }
    } else {
      console.warn('⚠️ API ключ OpenAI не найден в переменных окружения. Перевод речи будет недоступен.');
    }

    // Обработка подключения нового клиента
    this.wss.on('connection', (ws) => {
      console.log('Новое WebSocket подключение');

      // Добавляем поддержку бинарных данных для аудио
      ws.binaryType = 'arraybuffer';

      // Обработка сообщений от клиента
      ws.on('message', (message) => {
        try {
          // Проверяем, это текстовое сообщение или бинарные данные
          if (typeof message === 'string' || message instanceof Buffer) {
            // Текстовое сообщение - JSON
            const data = JSON.parse(message.toString());
            this.handleMessage(ws, data);
          } else if (message instanceof ArrayBuffer || ArrayBuffer.isView(message)) {
            // Бинарные данные - аудио
            this.handleAudioData(ws, message);
          }
        } catch (error) {
          console.error('Ошибка при обработке сообщения от клиента:', error);
          this.sendError(ws, 'Некорректный формат сообщения');
        }
      });

      // Обработка отключения клиента
      ws.on('close', () => {
        this.handleDisconnect(ws);
      });

      // Обработка ошибок
      ws.on('error', (error) => {
        console.error('WebSocket ошибка:', error);
      });
    });

    console.log('Сервер сигнализации WebRTC запущен');
  }

  // Обработка сообщений от клиента
  handleMessage(ws, data) {
    const { type, payload } = data;

    switch (type) {
      case 'register':
        this.handleRegister(ws, payload);
        break;
      case 'call':
        this.handleCall(ws, payload);
        break;
      case 'answer':
        this.handleAnswer(ws, payload);
        break;
      case 'ice-candidate':
        this.handleIceCandidate(ws, payload);
        break;
      case 'hangup':
        this.handleHangup(ws, payload);
        break;
      case 'translation-settings':
        this.handleTranslationSettings(ws, payload);
        break;
      case 'toggle-translation':
        this.handleToggleTranslation(ws, payload);
        break;
      default:
        console.warn('Неизвестный тип сообщения:', type);
        this.sendError(ws, 'Неизвестный тип сообщения');
    }
  }

  // Регистрация пользователя в системе сигнализации
  handleRegister(ws, payload) {
    const { userId } = payload;

    if (!userId) {
      return this.sendError(ws, 'Отсутствует ID пользователя');
    }

    // Преобразуем ID в строку
    const userIdStr = String(userId);

    // Если пользователь уже зарегистрирован, обновляем его соединение
    if (this.clients.has(userIdStr)) {
      const oldWs = this.clients.get(userIdStr);
      this.userIds.delete(oldWs);
      
      // Закрываем старое соединение если оно еще открыто
      if (oldWs.readyState === WebSocket.OPEN) {
        oldWs.close();
      }
    }

    // Регистрируем пользователя
    this.clients.set(userIdStr, ws);
    this.userIds.set(ws, userIdStr);

    console.log(`Пользователь ${userIdStr} зарегистрирован в системе сигнализации`);
    
    // Отправляем подтверждение регистрации
    ws.send(JSON.stringify({
      type: 'register',
      success: true,
      message: 'Регистрация успешна'
    }));
  }

  // Инициирование звонка
  handleCall(ws, payload) {
    const { targetUserId, callType, offer } = payload;
    const callerId = this.userIds.get(ws);

    if (!callerId) {
      return this.sendError(ws, 'Вы не зарегистрированы');
    }

    if (!targetUserId) {
      return this.sendError(ws, 'Не указан ID целевого пользователя');
    }

    // Преобразуем ID в строки для корректного сравнения
    const targetUserIdStr = String(targetUserId);
    const callerIdStr = String(callerId);

    // Выводим дополнительную информацию для диагностики
    console.log(`Попытка звонка от ${callerIdStr} к ${targetUserIdStr}`);
    console.log(`Активные пользователи: ${Array.from(this.clients.keys()).join(', ')}`);

    // Проверяем, доступен ли целевой пользователь
    if (!this.clients.has(targetUserIdStr)) {
      console.log(`Ошибка: Пользователь ${targetUserIdStr} не найден в списке клиентов`);
      return this.sendError(ws, 'Пользователь не в сети');
    }

    // Создаем идентификатор комнаты для звонка
    const roomId = uuidv4();
    
    // Создаем комнату и добавляем пользователей
    this.rooms.set(roomId, new Set([callerIdStr, targetUserIdStr]));
    this.userRooms.set(callerIdStr, roomId);
    this.userRooms.set(targetUserIdStr, roomId);

    // Инициализируем настройки перевода для комнаты
    if (this.translationEnabled) {
      this.roomTranslationState.set(roomId, {
        enabled: true,
        participants: new Map([
          [callerIdStr, false], // По умолчанию перевод выключен
          [targetUserIdStr, false]
        ])
      });
      
      // Создаем ассистентов для обоих пользователей, если еще не созданы
      // Используем заготовленные настройки или настройки по умолчанию
      const callerSettings = this.userTranslationSettings.get(callerIdStr) || {
        sourceLanguage: 'ru',
        targetLanguage: 'en',
        voice: 'alloy'
      };
      
      const targetSettings = this.userTranslationSettings.get(targetUserIdStr) || {
        sourceLanguage: 'en',
        targetLanguage: 'ru',
        voice: 'alloy'
      };
      
      // Создаем ассистентов асинхронно
      aiTranslationService.createAssistant(callerIdStr, callerSettings)
        .then(success => {
          if (success) {
            this.log(`Создан ассистент перевода для инициатора звонка ${callerIdStr}`, 'info');
          }
        });
      
      aiTranslationService.createAssistant(targetUserIdStr, targetSettings)
        .then(success => {
          if (success) {
            this.log(`Создан ассистент перевода для получателя звонка ${targetUserIdStr}`, 'info');
          }
        });
    }
    
    console.log(`Создана комната ${roomId} для звонка между ${callerIdStr} и ${targetUserIdStr}`);

    // Отправляем сообщение о входящем звонке целевому пользователю
    const targetWs = this.clients.get(targetUserIdStr);
    targetWs.send(JSON.stringify({
      type: 'incoming-call',
      payload: {
        callerId: callerIdStr,
        roomId,
        callType: callType || 'audio',
        offer // Передаем SDP-предложение
      }
    }));

    // Отправляем подтверждение инициатору звонка
    ws.send(JSON.stringify({
      type: 'call-initiated',
      payload: {
        targetUserId: targetUserIdStr,
        roomId,
        callType: callType || 'audio'
      }
    }));
  }

  // Ответ на звонок
  handleAnswer(ws, payload) {
    const { roomId, answer, accepted } = payload;
    const userId = this.userIds.get(ws);

    if (!userId) {
      return this.sendError(ws, 'Вы не зарегистрированы');
    }

    // Преобразуем ID в строку для единообразия
    const userIdStr = String(userId);

    if (!roomId) {
      return this.sendError(ws, 'Не указан ID комнаты');
    }

    // Проверяем, существует ли комната
    if (!this.rooms.has(roomId)) {
      return this.sendError(ws, 'Комната не существует');
    }

    // Проверяем, находится ли пользователь в этой комнате
    const room = this.rooms.get(roomId);
    if (!room.has(userIdStr)) {
      return this.sendError(ws, 'Вы не являетесь участником этой комнаты');
    }

    // Если звонок отклонен
    if (!accepted) {
      // Находим другого участника комнаты
      const otherUserId = [...room].find(id => id !== userIdStr);
      if (otherUserId && this.clients.has(otherUserId)) {
        const otherWs = this.clients.get(otherUserId);
        otherWs.send(JSON.stringify({
          type: 'call-rejected',
          payload: { roomId }
        }));
      }

      // Удаляем комнату
      this.cleanupRoom(roomId);
      
      console.log(`Звонок в комнате ${roomId} отклонен пользователем ${userIdStr}`);
      return;
    }

    // Если звонок принят, передаем SDP ответ другому участнику
    // Находим другого участника комнаты
    const otherUserId = [...room].find(id => id !== userIdStr);
    
    if (otherUserId && this.clients.has(otherUserId)) {
      const otherWs = this.clients.get(otherUserId);
      
      // Проверяем наличие SDP-ответа
      if (!answer) {
        console.error(`Отсутствует SDP-ответ от пользователя ${userIdStr}`);
        this.sendError(ws, 'Отсутствует SDP-ответ');
        return;
      }
      
      console.log(`Пересылка SDP-ответа от ${userIdStr} к ${otherUserId} в комнате ${roomId}`);
      
      otherWs.send(JSON.stringify({
        type: 'call-accepted',
        payload: {
          roomId,
          answer
        }
      }));
      
      console.log(`Звонок в комнате ${roomId} принят пользователем ${userIdStr}`);
    } else {
      console.error(`Не удалось переслать SDP-ответ: получатель ${otherUserId} не найден или не в сети`);
      this.sendError(ws, 'Другой участник не найден или не в сети');
      this.cleanupRoom(roomId);
    }
  }

  // Обработка ICE-кандидатов
  handleIceCandidate(ws, payload) {
    const { roomId, candidate } = payload;
    const userId = this.userIds.get(ws);

    if (!userId || !roomId || !candidate) {
      return this.sendError(ws, 'Некорректные данные ICE-кандидата');
    }

    // Преобразуем ID в строку для единообразия
    const userIdStr = String(userId);

    // Проверяем существование комнаты
    if (!this.rooms.has(roomId)) {
      return this.sendError(ws, 'Комната не существует');
    }

    // Находим другого участника комнаты
    const room = this.rooms.get(roomId);
    if (!room.has(userIdStr)) {
      return this.sendError(ws, 'Вы не являетесь участником этой комнаты');
    }

    const otherUserId = [...room].find(id => id !== userIdStr);
    
    if (otherUserId && this.clients.has(otherUserId)) {
      const otherWs = this.clients.get(otherUserId);
      
      // Выводим информацию о пересылке ICE-кандидата
      console.log(`Пересылка ICE-кандидата от ${userIdStr} к ${otherUserId} в комнате ${roomId}`);
      console.log(`Тип ICE-кандидата: ${candidate.candidate.split(' ')[7]}`);
      
      otherWs.send(JSON.stringify({
        type: 'ice-candidate',
        payload: {
          roomId,
          candidate
        }
      }));
    } else {
      console.warn(`Не удалось переслать ICE-кандидат: получатель ${otherUserId} не найден или не в сети`);
    }
  }

  // Обработка завершения звонка
  handleHangup(ws, payload) {
    const { roomId } = payload;
    const userId = this.userIds.get(ws);

    if (!userId || !roomId) {
      return this.sendError(ws, 'Неверные данные для завершения звонка');
    }

    // Проверяем существование комнаты
    if (!this.rooms.has(roomId)) {
      return this.sendError(ws, 'Комната не существует');
    }

    // Находим другого участника комнаты
    const room = this.rooms.get(roomId);
    if (!room.has(userId)) {
      return this.sendError(ws, 'Вы не являетесь участником этой комнаты');
    }

    const otherUserId = [...room].find(id => id !== userId);
    
    if (otherUserId && this.clients.has(otherUserId)) {
      const otherWs = this.clients.get(otherUserId);
      otherWs.send(JSON.stringify({
        type: 'hangup',
        payload: { roomId }
      }));
    }

    // Очищаем данные о комнате
    this.cleanupRoom(roomId);
    
    console.log(`Звонок в комнате ${roomId} завершен пользователем ${userId}`);
  }

  // Обработка отключения клиента
  handleDisconnect(ws) {
    const userId = this.userIds.get(ws);
    
    if (userId) {
      console.log(`Пользователь ${userId} отключился`);
      
      // Если пользователь был в комнате, уведомляем собеседника
      if (this.userRooms.has(userId)) {
        const roomId = this.userRooms.get(userId);
        
        if (this.rooms.has(roomId)) {
          const room = this.rooms.get(roomId);
          const otherUserId = [...room].find(id => id !== userId);
          
          if (otherUserId && this.clients.has(otherUserId)) {
            const otherWs = this.clients.get(otherUserId);
            otherWs.send(JSON.stringify({
              type: 'user-disconnected',
              payload: { roomId, userId }
            }));
          }
          
          // Очищаем данные о комнате
          this.cleanupRoom(roomId);
        }
      }
      
      // Удаляем данные о пользователе
      this.clients.delete(userId);
      this.userRooms.delete(userId);
    }
    
    this.userIds.delete(ws);
  }

  // Отправка сообщения об ошибке клиенту
  sendError(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'error',
        message
      }));
    }
  }

  // Очистка данных о комнате
  cleanupRoom(roomId) {
    if (!this.rooms.has(roomId)) return;
    
    const room = this.rooms.get(roomId);
    
    // Удаляем информацию о комнате у всех пользователей
    for (const userId of room) {
      this.userRooms.delete(userId);
    }
    
    // Удаляем саму комнату
    this.rooms.delete(roomId);
    
    // Удаляем настройки перевода для комнаты
    this.roomTranslationState.delete(roomId);
    
    console.log(`Комната ${roomId} удалена`);
  }
  
  /**
   * Обрабатывает бинарные аудио данные от клиента
   * @param {WebSocket} ws - WebSocket соединение клиента
   * @param {ArrayBuffer} audioData - Аудио данные для обработки
   */
  async handleAudioData(ws, audioData) {
    try {
      // Получаем ID пользователя по WebSocket соединению
      const userId = this.userIds.get(ws);
      
      if (!userId) {
        this.log('Получены аудио данные от незарегистрированного клиента', 'warn');
        return;
      }
      
      // Проверяем, находится ли пользователь в комнате
      const roomId = this.userRooms.get(userId);
      if (!roomId) {
        this.log(`Пользователь ${userId} не находится в комнате`, 'warn');
        return;
      }
      
      // Проверяем, включен ли перевод для этой комнаты
      const roomTranslation = this.roomTranslationState.get(roomId);
      const translationEnabled = roomTranslation && roomTranslation.enabled;
      
      // Если перевод отключен, просто игнорируем аудио данные
      if (!translationEnabled) {
        return;
      }
      
      // Получаем других участников комнаты
      const room = this.rooms.get(roomId);
      if (!room) {
        this.log(`Комната ${roomId} не найдена`, 'warn');
        return;
      }
      
      // Получаем список получателей (все кроме отправителя)
      const recipients = Array.from(room).filter(id => id !== userId);
      
      // Проверяем, включен ли перевод для этого пользователя
      const isTranslatingUser = roomTranslation && 
                                roomTranslation.participants && 
                                roomTranslation.participants.get(userId);
      
      if (!isTranslatingUser) {
        return;
      }
      
      // Обрабатываем аудио через аудио-процессор
      await audioProcessor.processAudio(userId, roomId, audioData, recipients, true);
      
    } catch (error) {
      this.log(`Ошибка при обработке аудио данных: ${error.message}`, 'error');
    }
  }
  
  /**
   * Обрабатывает настройки перевода от клиента
   * @param {WebSocket} ws - WebSocket соединение клиента
   * @param {Object} payload - Данные настроек перевода
   */
  handleTranslationSettings(ws, payload) {
    try {
      const userId = this.userIds.get(ws);
      
      if (!userId) {
        this.sendError(ws, 'Вы не зарегистрированы');
        return;
      }
      
      const { sourceLanguage, targetLanguage, voice } = payload;
      
      // Сохраняем настройки перевода
      this.userTranslationSettings.set(userId, {
        enabled: true,
        sourceLanguage: sourceLanguage || 'ru',
        targetLanguage: targetLanguage || 'en',
        voice: voice || 'alloy'
      });
      
      // Создаем или обновляем ассистента для пользователя
      if (this.translationEnabled) {
        aiTranslationService.createAssistant(userId, {
          sourceLanguage: sourceLanguage || 'ru',
          targetLanguage: targetLanguage || 'en',
          voice: voice || 'alloy'
        }).then(success => {
          if (success) {
            ws.send(JSON.stringify({
              type: 'translation-settings-updated',
              payload: {
                success: true,
                settings: this.userTranslationSettings.get(userId)
              }
            }));
            this.log(`Настройки перевода обновлены для пользователя ${userId}`, 'info');
          } else {
            this.sendError(ws, 'Не удалось создать ассистента для перевода');
          }
        });
      } else {
        this.sendError(ws, 'Перевод отключен на сервере. Проверьте настройки API ключа.');
      }
      
    } catch (error) {
      this.log(`Ошибка при обновлении настроек перевода: ${error.message}`, 'error');
      this.sendError(ws, 'Ошибка при обновлении настроек перевода');
    }
  }
  
  /**
   * Обрабатывает включение/выключение перевода в звонке
   * @param {WebSocket} ws - WebSocket соединение клиента
   * @param {Object} payload - Данные о включении/выключении перевода
   */
  handleToggleTranslation(ws, payload) {
    try {
      const userId = this.userIds.get(ws);
      
      if (!userId) {
        this.sendError(ws, 'Вы не зарегистрированы');
        return;
      }
      
      // Проверяем, находится ли пользователь в комнате
      const roomId = this.userRooms.get(userId);
      if (!roomId) {
        this.sendError(ws, 'Вы не находитесь в звонке');
        return;
      }
      
      const { enabled } = payload;
      
      // Проверяем, существуют ли настройки перевода для комнаты
      if (!this.roomTranslationState.has(roomId)) {
        this.roomTranslationState.set(roomId, {
          enabled: true,
          participants: new Map()
        });
      }
      
      const roomTranslation = this.roomTranslationState.get(roomId);
      
      // Если нет карты участников, создаем её
      if (!roomTranslation.participants) {
        roomTranslation.participants = new Map();
      }
      
      // Обновляем состояние перевода для пользователя
      roomTranslation.participants.set(userId, enabled !== false);
      
      // Если перевод включен, активируем ассистента
      if (enabled !== false && this.translationEnabled) {
        aiTranslationService.activateAssistant(userId, roomId).then(success => {
          if (success) {
            ws.send(JSON.stringify({
              type: 'translation-toggled',
              payload: {
                success: true,
                enabled: true,
                roomId
              }
            }));
            
            // Уведомляем других участников о включении перевода
            this.notifyRoomParticipants(roomId, userId, {
              type: 'translation-state-changed',
              payload: {
                userId,
                translating: true,
                roomId
              }
            });
            
            this.log(`Перевод включен для пользователя ${userId} в комнате ${roomId}`, 'info');
          } else {
            this.sendError(ws, 'Не удалось активировать ассистента перевода');
            roomTranslation.participants.set(userId, false);
          }
        });
      } else {
        // Если перевод выключен, деактивируем ассистента
        if (this.translationEnabled) {
          aiTranslationService.deactivateAssistant(userId).then(() => {
            ws.send(JSON.stringify({
              type: 'translation-toggled',
              payload: {
                success: true,
                enabled: false,
                roomId
              }
            }));
            
            // Уведомляем других участников о выключении перевода
            this.notifyRoomParticipants(roomId, userId, {
              type: 'translation-state-changed',
              payload: {
                userId,
                translating: false,
                roomId
              }
            });
            
            this.log(`Перевод выключен для пользователя ${userId} в комнате ${roomId}`, 'info');
          });
        } else {
          this.sendError(ws, 'Перевод отключен на сервере');
        }
      }
      
    } catch (error) {
      this.log(`Ошибка при включении/выключении перевода: ${error.message}`, 'error');
      this.sendError(ws, 'Ошибка при включении/выключении перевода');
    }
  }
  
  /**
   * Отправляет уведомление всем участникам комнаты, кроме указанного пользователя
   * @param {string} roomId - ID комнаты звонка
   * @param {string} exceptUserId - ID пользователя, которому не нужно отправлять уведомление
   * @param {Object} message - Сообщение для отправки
   */
  notifyRoomParticipants(roomId, exceptUserId, message) {
    if (!this.rooms.has(roomId)) return;
    
    const room = this.rooms.get(roomId);
    
    for (const userId of room) {
      if (userId !== exceptUserId && this.clients.has(userId)) {
        const ws = this.clients.get(userId);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(message));
        }
      }
    }
  }
  
  /**
   * Функция логирования с уровнями важности
   * @param {string} message - Сообщение для логирования
   * @param {string} level - Уровень важности (debug, info, warn, error)
   */
  log(message, level = 'info') {
    const timestamp = new Date().toISOString();
    
    switch (level.toLowerCase()) {
      case 'debug':
        console.debug(`[${timestamp}] [SignalingServer] 🔍 DEBUG: ${message}`);
        break;
      case 'info':
        console.info(`[${timestamp}] [SignalingServer] ℹ️ INFO: ${message}`);
        break;
      case 'warn':
        console.warn(`[${timestamp}] [SignalingServer] ⚠️ WARN: ${message}`);
        break;
      case 'error':
        console.error(`[${timestamp}] [SignalingServer] ❌ ERROR: ${message}`);
        break;
      default:
        console.log(`[${timestamp}] [SignalingServer] ${message}`);
    }
  }
}

// Создаем и экспортируем экземпляр сервера сигнализации
const signalingServer = new SignalingServer();
module.exports = signalingServer; 