const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const { OpenAI } = require('openai');

// Загрузка переменных окружения из .env файла
require('dotenv').config();

// Создаем экземпляр клиента OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// URL для получения ключа сессии
const REALTIME_SESSION_URL = 'https://api.openai.com/v1/realtime/sessions';

// Функция для получения системного промпта
function getSystemPrompt() {
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

// Создаем HTTP сервер для обслуживания статических файлов
const server = http.createServer((req, res) => {
  // Обслуживаем только корневой путь и index.html
  if (req.url === '/' || req.url === '/index.html') {
    fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end('Ошибка при чтении index.html');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
  } else {
    res.writeHead(404);
    res.end('Страница не найдена');
  }
});

// Создаем WebSocket сервер
const wss = new WebSocket.Server({ server });

// Функция для получения токена сессии от OpenAI для WebRTC соединения
async function getSessionToken() {
  try {
    // Используем встроенный в Node.js fetch для REST API запроса
    const response = await fetch(REALTIME_SESSION_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'realtime=v1'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini-realtime-preview',
        voice: 'alloy',
        instructions: getSystemPrompt()
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ошибка API: ${response.status} ${errorText}`);
    }
    
    const data = await response.json();
    console.log('Получен URL для WebSocket соединения');
    return data;
  } catch (error) {
    console.error('Ошибка получения токена сессии OpenAI:', error);
    throw error;
  }
}

// Обработка подключений WebSocket
wss.on('connection', async (ws) => {
  console.log('Клиент подключился');
  
  let openaiWs = null;
  let sessionInfo = null;
  
  // Создаём функцию для отправки логов клиенту
  const sendLog = (level, message) => {
    console.log(`[${level}] ${message}`);
    ws.send(JSON.stringify({
      type: 'log',
      level: level,
      message: message,
      timestamp: new Date().toISOString()
    }));
  };
  
  // Обработка сообщений от клиента
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      
      if (data.type === 'get_session') {
        try {
          // Получаем токен сессии
          sessionInfo = await getSessionToken();
          sendLog('info', 'Получен токен сессии');

          // Отправляем данные сессии клиенту
          ws.send(JSON.stringify({
            type: 'session_info', 
            data: {
              url: sessionInfo.url,
              model: 'gpt-4o-mini-realtime-preview',
              client_secret: sessionInfo.client_secret
            }
          }));
        } catch (error) {
          sendLog('error', `Ошибка получения токена: ${error.message}`);
          ws.send(JSON.stringify({
            type: 'error',
            message: `Ошибка получения токена: ${error.message}`
          }));
        }
      }
      else if (data.type === 'status_update') {
        // Получаем обновления статуса от клиента
        sendLog('info', `Статус: ${data.status}`);
        
        // Отправляем обновление статуса всем клиентам
        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
              type: 'status_broadcast',
              status: data.status,
              message: data.message || ''
            }));
          }
        });
      }
      else if (data.type === 'log') {
        // Перенаправляем логи от клиента в консоль и другим клиентам
        console.log(`[Клиент][${data.level}] ${data.message}`);
        
        // Отправляем другим клиентам
        wss.clients.forEach((client) => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
              type: 'log',
              level: data.level,
              message: data.message,
              timestamp: new Date().toISOString()
            }));
          }
        });
      }
    } catch (error) {
      console.error('Ошибка обработки сообщения:', error);
      ws.send(JSON.stringify({ 
        type: 'error',
        message: 'Ошибка обработки сообщения: ' + error.message
      }));
    }
  });
  
  // Обработка закрытия соединения
  ws.on('close', () => {
    console.log('Клиент отключился');
  });

  // Обработка ошибок соединения
  ws.on('error', (error) => {
    console.error('Ошибка WebSocket:', error);
  });
  
  // Отправляем приветственное сообщение
  ws.send(JSON.stringify({
    type: 'welcome',
    message: 'Подключение к серверу успешно. Используется модель: gpt-4o-mini-realtime-preview',
    timestamp: new Date().toISOString()
  }));
});

// Запускаем сервер
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`========================================`);  
  console.log(`Сервер запущен на порту ${PORT}`);
  console.log(`Откройте http://localhost:${PORT} в браузере`);
  console.log(`Модель: gpt-4o-mini-realtime-preview`);  
  console.log(`Управление микрофоном через браузерный интерфейс`);  
  console.log(`Для выхода: Ctrl+C`);  
  console.log(`========================================`);
});

// Обработка завершения работы приложения
process.on('SIGINT', () => {
  console.log('Завершение работы сервера...');
  
  // Отправляем уведомление всем клиентам о завершении работы
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        type: 'server_shutdown',
        message: 'Сервер завершает работу.'
      }));
    }
  });
  
  // Даем время на отправку сообщений
  setTimeout(() => {
    server.close(() => {
      console.log('Сервер остановлен.');
      process.exit(0);
    });
  }, 1000);
});
