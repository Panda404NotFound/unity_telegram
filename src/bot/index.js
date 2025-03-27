require('dotenv').config();
const { Bot, InlineKeyboard, BotError, GrammyError, HttpError } = require('grammy');
const express = require('express');
const path = require('path');

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

// Set up express server for the mini-app
const app = express();
const PORT = process.env.PORT || 3000;

// Обработка CORS для разработки
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
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

// TODO: API для истории сообщений (заглушка)
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
app.listen(PORT, () => {
  console.log(`Mini-app сервер запущен на порту ${PORT}`);
  console.log(`API доступно по адресу: http://localhost:${PORT}/api/`);
  console.log(`Мини-приложение доступно по адресу: http://localhost:${PORT}/miniapp/`);
});

// Start the bot
bot.start();
console.log('Бот успешно запущен!'); 