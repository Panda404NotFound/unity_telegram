require('dotenv').config();
const { Bot, InlineKeyboard, BotError, GrammyError, HttpError } = require('grammy');
const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const http = require('http');
const signalingServer = require('./signaling-server');

// TODO: Временное хранилище пользователей (в реальном приложении - БД)
const users = new Map();
const friendships = new Map(); // Карта для связей дружбы: userId -> Set(friendIds)

// Initialize bot with token from environment variables
const bot = new Bot(process.env.BOT_TOKEN);

// Установка команд бота - будут видны в меню
bot.api.setMyCommands([
  { command: 'start', description: 'Запустить бота' },
  { command: 'launch_app', description: 'Открыть приложение' },
  { command: 'help', description: 'Получить справку' }
]);

// Set up commands
bot.command('start', async (ctx) => {
  await ctx.reply('Добро пожаловать в Telega TG! Используйте /launch_app чтобы открыть приложение.');
});

bot.command('help', async (ctx) => {
  await ctx.reply('Telega TG - приложение для аудио и видео звонков с переводом речи. Используйте /launch_app чтобы открыть приложение.');
});

bot.command('launch_app', async (ctx) => {
  try {
    // Инициализация мини-приложения через BotFather:
    // 1. Отправьте /newapp команду в BotFather
    // 2. Выберите вашего бота
    // 3. Укажите имя для мини-приложения
    // 4. Укажите URL вашего мини-приложения (локальный или хостинг с HTTPS)
    // 5. Загрузите иконку

    // Проверяем наличие продакшн URL в конфигурации
    if (process.env.WEBAPP_URL && process.env.WEBAPP_URL.trim() !== '') {
      const appUrl = process.env.WEBAPP_URL;
      
      // Создаем клавиатуру с кнопкой WebApp для продакшн
      const keyboard = new InlineKeyboard().webApp('Открыть Telega TG', appUrl);
      await ctx.reply('Нажмите на кнопку ниже чтобы открыть приложение:', { reply_markup: keyboard });
    } else {
      // Для тестирования просто отправляем инструкции без кнопки URL
      // (Telegram не разрешает localhost URL в кнопках)
      const localUrl = `http://localhost:${process.env.PORT || 3000}/miniapp`;
      await ctx.reply(`⚠️ Режим разработки активен\n\nДля тестирования откройте в браузере:\n${localUrl}\n\nДля продакшн-версии укажите WEBAPP_URL в .env файле`);
    }
  } catch (error) {
    console.error('Ошибка при отправке кнопки WebApp:', error);
    await ctx.reply('Извините, возникла ошибка при открытии приложения. Пожалуйста, попробуйте позже.');
  }
});

// Обработчик ошибок
bot.catch((err) => {
  const ctx = err.ctx;
  console.error(`Ошибка при обработке обновления ${ctx.update.update_id}:`);
  const e = err.error;
  if (e instanceof GrammyError) {
    console.error("Ошибка в запросе к Telegram API:", e.description);
  } else if (e instanceof HttpError) {
    console.error("Ошибка с HTTP:", e);
  } else {
    console.error("Неизвестная ошибка:", e);
  }
});

// Создаем HTTP сервер с Express
const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// Инициализируем сервер сигнализации WebRTC
signalingServer.init(server);

// Разбор JSON и URL-encoded данных
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Обработка CORS для разработки
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Обработка предупреждения ngrok
app.use((req, res, next) => {
  res.header('ngrok-skip-browser-warning', 'true');
  next();
});

// Serve mini-app static files
app.use('/miniapp', express.static(path.join(__dirname, '../miniapp/public')));

// TODO: API для получения пользователей (заглушка)
app.get('/api/users', (req, res) => {
  // В реальном приложении здесь бы был запрос к базе данных
  const users = [
    { id: 1, name: 'Алиса', username: 'alice', avatar: 'A' },
    { id: 2, name: 'Борис', username: 'boris', avatar: 'B' },
    { id: 3, name: 'Виктор', username: 'victor', avatar: 'V' },
    { id: 4, name: 'Галина', username: 'galina', avatar: 'G' },
    { id: 5, name: 'Дмитрий', username: 'dmitry', avatar: 'D' }
  ];
  res.json(users);
});

// API для регистрации/обновления пользователя
app.post('/api/users/register', (req, res) => {
  try {
    const userData = req.body;
    
    if (!userData || !userData.id) {
      return res.status(400).json({ 
        success: false, 
        error: 'Требуются данные пользователя' 
      });
    }
    
    // Преобразуем ID в строку для единообразия и корректного хранения
    const userId = String(userData.id);
    
    // Сохраняем или обновляем пользователя
    users.set(userId, {
      id: userId,
      firstName: userData.firstName || '',
      lastName: userData.lastName || '',
      username: userData.username || '',
      photoUrl: userData.photoUrl || null,
      languageCode: userData.languageCode || 'ru',
      lastActive: new Date().toISOString()
    });
    
    // Инициализируем список друзей, если он еще не создан
    if (!friendships.has(userId)) {
      friendships.set(userId, new Set());
    }
    
    console.log(`Пользователь зарегистрирован/обновлен: ${userId} (${userData.username || 'без имени пользователя'})`);
    
    res.json({ 
      success: true, 
      message: 'Пользователь успешно зарегистрирован' 
    });
  } catch (error) {
    console.error('Ошибка при регистрации пользователя:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Внутренняя ошибка сервера' 
    });
  }
});

// API для поиска пользователей по имени пользователя (username)
app.get('/api/users/search', (req, res) => {
  try {
    const { query } = req.query;
    
    if (!query) {
      return res.status(400).json({ 
        success: false, 
        error: 'Требуется параметр query' 
      });
    }
    
    // Поиск пользователей по частичному совпадению имени пользователя
    const searchQuery = query.toLowerCase().replace('@', '');
    const results = Array.from(users.values())
      .filter(user => {
        // Ищем совпадения в username, firstName или lastName
        return (user.username && user.username.toLowerCase().includes(searchQuery)) ||
               (user.firstName && user.firstName.toLowerCase().includes(searchQuery)) ||
               (user.lastName && user.lastName.toLowerCase().includes(searchQuery));
      })
      .map(user => ({
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username,
        photoUrl: user.photoUrl
      }));
    
    res.json({ 
      success: true, 
      results
    });
  } catch (error) {
    console.error('Ошибка при поиске пользователей:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Внутренняя ошибка сервера' 
    });
  }
});

// API для получения списка друзей пользователя
app.get('/api/users/:userId/friends', (req, res) => {
  try {
    const userId = req.params.userId;
    
    if (!userId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Требуется ID пользователя' 
      });
    }
    
    // Проверяем, существует ли пользователь
    if (!users.has(userId)) {
      return res.status(404).json({ 
        success: false, 
        error: 'Пользователь не найден' 
      });
    }
    
    // Получаем список друзей
    const userFriends = friendships.get(userId) || new Set();
    
    // Преобразуем ID друзей в объекты пользователей
    const friendsList = Array.from(userFriends)
      .map(friendId => {
        const friend = users.get(friendId);
        if (friend) {
          return {
            id: friend.id,
            firstName: friend.firstName,
            lastName: friend.lastName,
            username: friend.username,
            photoUrl: friend.photoUrl
          };
        }
        return null;
      })
      .filter(Boolean); // Фильтруем null значения
    
    res.json({ 
      success: true, 
      friends: friendsList
    });
  } catch (error) {
    console.error('Ошибка при получении списка друзей:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Внутренняя ошибка сервера' 
    });
  }
});

// API для добавления друга
app.post('/api/users/:userId/friends/:friendId', (req, res) => {
  try {
    let { userId, friendId } = req.params;
    
    // Преобразуем ID в строки для единообразия
    userId = String(userId);
    friendId = String(friendId);
    
    // Проверяем, существуют ли оба пользователя
    if (!users.has(userId)) {
      return res.status(404).json({ 
        success: false, 
        error: 'Пользователь не найден' 
      });
    }
    
    if (!users.has(friendId)) {
      return res.status(404).json({ 
        success: false, 
        error: 'Пользователь для добавления в друзья не найден' 
      });
    }
    
    // Проверяем, не пытается ли пользователь добавить сам себя
    if (userId === friendId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Нельзя добавить себя в список друзей' 
      });
    }
    
    // Инициализируем список друзей, если он еще не создан
    if (!friendships.has(userId)) {
      friendships.set(userId, new Set());
    }
    
    if (!friendships.has(friendId)) {
      friendships.set(friendId, new Set());
    }
    
    // Добавляем пользователей в списки друзей друг друга (двунаправленная связь)
    friendships.get(userId).add(friendId);
    friendships.get(friendId).add(userId);
    
    console.log(`Добавлена связь дружбы: ${userId} <-> ${friendId}`);
    
    res.json({ 
      success: true, 
      message: 'Друг успешно добавлен' 
    });
  } catch (error) {
    console.error('Ошибка при добавлении друга:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Внутренняя ошибка сервера' 
    });
  }
});

// API для удаления друга
app.delete('/api/users/:userId/friends/:friendId', (req, res) => {
  try {
    let { userId, friendId } = req.params;
    
    // Преобразуем ID в строки для единообразия
    userId = String(userId);
    friendId = String(friendId);
    
    // Проверяем, существуют ли оба пользователя и связь дружбы
    if (!friendships.has(userId) || !friendships.has(friendId)) {
      return res.status(404).json({ 
        success: false, 
        error: 'Пользователь или связь не найдены' 
      });
    }
    
    // Удаляем пользователей из списков друзей друг друга
    friendships.get(userId).delete(friendId);
    friendships.get(friendId).delete(userId);
    
    console.log(`Удалена связь дружбы: ${userId} <-> ${friendId}`);
    
    res.json({ 
      success: true, 
      message: 'Друг успешно удален' 
    });
  } catch (error) {
    console.error('Ошибка при удалении друга:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Внутренняя ошибка сервера' 
    });
  }
});

// API для получения списка онлайн пользователей (заглушка)
app.get('/api/users/online', (req, res) => {
  try {
    // В реальном приложении здесь был бы запрос к БД
    // Для демо возвращаем всех пользователей, кто был активен в последние 10 минут
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    
    const onlineUsers = Array.from(users.values())
      .filter(user => user.lastActive > tenMinutesAgo)
      .map(user => ({
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username,
        photoUrl: user.photoUrl
      }));
    
    res.json({ 
      success: true, 
      users: onlineUsers
    });
  } catch (error) {
    console.error('Ошибка при получении списка онлайн пользователей:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Внутренняя ошибка сервера' 
    });
  }
});

// API для получения информации о пользователе (заглушка)
app.get('/api/users/:userId', (req, res) => {
  try {
    const userId = req.params.userId;
    
    if (!userId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Требуется ID пользователя' 
      });
    }
    
    const user = users.get(userId);
    
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        error: 'Пользователь не найден' 
      });
    }
    
    // Не возвращаем некоторые приватные поля
    const userData = {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      username: user.username,
      photoUrl: user.photoUrl
    };
    
    res.json({ 
      success: true, 
      user: userData
    });
  } catch (error) {
    console.error('Ошибка при получении информации о пользователе:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Внутренняя ошибка сервера' 
    });
  }
});

// API для проверки аккаунта
app.get('/api/account/check', (req, res) => {
  try {
    const { telegramId } = req.query;
    
    if (!telegramId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Требуется параметр telegramId' 
      });
    }
    
    const userExists = users.has(telegramId);
    
    res.json({ 
      success: true, 
      exists: userExists
    });
  } catch (error) {
    console.error('Ошибка при проверке аккаунта:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Внутренняя ошибка сервера' 
    });
  }
});

// API для истории сообщений (заглушка)
app.get('/api/messages/:userId', (req, res) => {
  const userId = req.params.userId;
  // Заглушка истории сообщений
  const messages = [
    { id: 1, text: 'Привет! Как дела?', sender: userId, timestamp: Date.now() - 86400000 },
    { id: 2, text: 'Отлично! А у тебя?', sender: 'me', timestamp: Date.now() - 86300000 },
    { id: 3, text: 'Всё хорошо, спасибо!', sender: userId, timestamp: Date.now() - 86200000 }
  ];
  res.json(messages);
});

// Корневой маршрут теперь перенаправляет в мини-приложение
app.get('/', (req, res) => {
  res.redirect('/miniapp');
});

// Start the server
server.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
  console.log(`API доступно по адресу: http://localhost:${PORT}/api/`);
  console.log(`Мини-приложение доступно по адресу: http://localhost:${PORT}/miniapp/`);
  console.log(`Сервер сигнализации WebRTC активен`);
});

// Start the bot
bot.start();
console.log('Бот успешно запущен!'); 