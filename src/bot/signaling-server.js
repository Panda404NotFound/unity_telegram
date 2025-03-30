const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

// Класс для управления сервером сигнализации WebRTC
class SignalingServer {
  constructor() {
    this.wss = null; // WebSocket сервер
    this.clients = new Map(); // Клиенты: id -> WebSocket
    this.userIds = new Map(); // WebSocket -> id пользователя
    this.rooms = new Map(); // Комнаты для звонков: roomId -> набор id пользователей
    this.userRooms = new Map(); // Пользователь в комнате: userId -> roomId
  }

  // Инициализация WebSocket сервера
  init(server) {
    // Создаем WebSocket сервер на базе существующего HTTP сервера
    this.wss = new WebSocket.Server({ server });

    // Обработка подключения нового клиента
    this.wss.on('connection', (ws) => {
      console.log('Новое WebSocket подключение');

      // Обработка сообщений от клиента
      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message);
          this.handleMessage(ws, data);
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
    
    console.log(`Комната ${roomId} удалена`);
  }
}

// Создаем и экспортируем экземпляр сервера сигнализации
const signalingServer = new SignalingServer();
module.exports = signalingServer; 