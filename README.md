# Telega TG

Приложение для Telegram (mini-app) для аудио/видео звонков с функцией перевода речи в реальном времени.

## Структура проекта

```
telega_tg/
├── .env                    # Переменные окружения
├── package.json            # Конфигурация Node.js пакетов
├── src/
│   ├── bot/                # Код Telegram бота
│   │   └── index.js        # Точка входа бота
│   └── miniapp/            # Код мини-приложения
│       └── public/         # Статические файлы мини-приложения
│           ├── index.html  # HTML мини-приложения
│           ├── styles.css  # Стили мини-приложения
│           └── app.js      # JavaScript мини-приложения
```

## Настройка

1. Создайте Telegram бота с помощью [BotFather](https://t.me/BotFather) и получите токен бота
2. Клонируйте этот репозиторий
3. Установите зависимости с помощью `npm install`
4. Создайте файл `.env` со следующими переменными:
   ```
   BOT_TOKEN=ваш_токен_бота
   PORT=3000
   ```
5. Для полноценной работы WebApp в Telegram нужен HTTPS URL. Варианты:
   - Для разработки используйте [ngrok](https://ngrok.com/) для создания временного HTTPS туннеля
   - Для продакшн разверните на сервере с HTTPS (Vercel, Netlify, Heroku и т.д.)
   - После получения HTTPS URL добавьте его в .env:
   ```
   WEBHOOK_URL=https://your-domain.com
   ```
6. Запустите бота с помощью `npm start`

## Что такое WEBHOOK_URL?

WEBHOOK_URL - это публичный HTTPS URL, который указывает на ваш сервер, где размещено мини-приложение. 
Telegram требует, чтобы все WebApp URL были доступны по HTTPS для безопасности.

### Как получить WEBHOOK_URL:

1. **Для разработки**:
   - Установите [ngrok](https://ngrok.com/)
   - Запустите `ngrok http 3000`
   - Используйте полученный HTTPS URL (например, https://1234-your-ngrok.io)

2. **Для продакшена**:
   - Разверните приложение на Vercel, Netlify, Heroku и т.д.
   - Используйте URL вашего проекта (например, https://your-app.vercel.app)

## Функциональность

- Telegram бот с командами `/start`, `/launch_app` и `/help`
- Мини-приложение со списком контактов и интерфейсом чата
- Кнопки аудио и видео звонков
- Функционал текстовых сообщений

## Использование

1. Начните чат с вашим ботом в Telegram
2. Отправьте `/start` для получения приветственного сообщения
3. Отправьте `/launch_app` для открытия мини-приложения
4. Выберите контакт из списка чтобы начать чат
5. Используйте кнопки аудио/видео звонка
6. Отправляйте текстовые сообщения в интерфейсе чата

## Лицензия

ISC 