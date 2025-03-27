// Отлавливаем все ошибки в Telegram WebApp для предотвращения красных экранов ошибок
window.onerror = function(msg, url, line, col, error) {
  console.error("Ошибка перехвачена:", msg, "в", url, "строка:", line);
  return true; // Предотвращает стандартную обработку ошибок
};

// Инициализация Telegram WebApp
const tg = window.Telegram.WebApp || {};

// DOM элементы
const loadingScreen = document.getElementById('loadingScreen');
const appContainer = document.getElementById('appContainer');
const userAvatar = document.getElementById('userAvatar');
const userName = document.getElementById('userName');
const contactsList = document.getElementById('contactsList');
const chatTitle = document.getElementById('chatTitle');
const callControls = document.getElementById('callControls');
const messagesContainer = document.getElementById('messagesContainer');
const messageInputContainer = document.getElementById('messageInputContainer');
const messageInput = document.getElementById('messageInput');
const sendMessageBtn = document.getElementById('sendMessageBtn');
const audioCallBtn = document.getElementById('audioCallBtn');
const videoCallBtn = document.getElementById('videoCallBtn');

// Переменные состояния
let currentUser = null;
let selectedContact = null;
let contacts = [];

// Инициализация приложения
document.addEventListener('DOMContentLoaded', initApp);

async function initApp() {
  try {
    console.log("Инициализация приложения...");
    
    // Расширяем приложение на весь экран если доступен Telegram API
    if (tg.expand) {
      tg.expand();
    }
    
    // Применяем тему Telegram
    applyTelegramTheme();
    
    // Задержка для обеспечения правильной инициализации
    await new Promise(resolve => setTimeout(resolve, 500));
    
    try {
      // Получаем данные пользователя из Telegram
      await initUserFromTelegram();
    } catch (e) {
      console.warn("Не удалось получить данные пользователя из Telegram:", e);
      // Создаем тестового пользователя если не в Telegram
      createTestUser();
    }
    
    // Загружаем контакты
    await loadContacts();
    
    // Показываем приложение
    if (loadingScreen) loadingScreen.style.display = 'none';
    if (appContainer) appContainer.style.display = 'flex';
    
    // Устанавливаем кнопку "Закрыть" в Telegram WebApp если доступно
    if (tg.MainButton && tg.MainButton.setText) {
      tg.MainButton.setText('Закрыть');
      if (tg.MainButton.onClick) {
        tg.MainButton.onClick(() => {
          if (tg.close) tg.close();
        });
      }
    }
    
    // Показываем, что приложение готово
    if (tg.ready) tg.ready();
    
    console.log("Приложение инициализировано успешно!");
  } catch (error) {
    console.error('Ошибка при инициализации приложения:', error);
    showErrorScreen('Ошибка при загрузке приложения. Пожалуйста, обновите страницу или попробуйте позже.');
  }
}

// Создаем тестового пользователя если не в Telegram
function createTestUser() {
  currentUser = {
    id: 'test123',
    firstName: 'Тестовый',
    lastName: 'Пользователь',
    username: 'test_user',
    languageCode: 'ru',
    photoUrl: null
  };
  
  // Отображаем данные пользователя
  updateUserInfo();
}

// Применяем тему Telegram
function applyTelegramTheme() {
  // Устанавливаем CSS переменные из параметров темы Telegram
  const themeParams = tg.themeParams || {};
  document.documentElement.style.setProperty('--tg-theme-bg-color', themeParams.bg_color || '#f0f2f5');
  document.documentElement.style.setProperty('--tg-theme-text-color', themeParams.text_color || '#000000');
  document.documentElement.style.setProperty('--tg-theme-hint-color', themeParams.hint_color || '#999999');
  document.documentElement.style.setProperty('--tg-theme-link-color', themeParams.link_color || '#2481cc');
  document.documentElement.style.setProperty('--tg-theme-button-color', themeParams.button_color || '#3498db');
  document.documentElement.style.setProperty('--tg-theme-button-text-color', themeParams.button_text_color || '#ffffff');
  document.documentElement.style.setProperty('--tg-theme-secondary-bg-color', themeParams.secondary_bg_color || '#f8f9fa');
}

// Инициализация пользователя из Telegram
async function initUserFromTelegram() {
  // Проверяем доступность объекта initDataUnsafe в Telegram WebApp
  if (!tg.initDataUnsafe || !tg.initDataUnsafe.user) {
    throw new Error('Не удалось получить данные пользователя из Telegram');
  }
  
  // Получаем данные пользователя из Telegram
  const user = tg.initDataUnsafe.user;
  currentUser = {
    id: user.id,
    firstName: user.first_name,
    lastName: user.last_name || '',
    username: user.username || '',
    languageCode: user.language_code || 'ru',
    photoUrl: user.photo_url || null
  };
  
  // Отображаем данные пользователя
  updateUserInfo();
}

// Обновление информации о пользователе в интерфейсе
function updateUserInfo() {
  if (!currentUser || !userAvatar || !userName) return;
  
  // Устанавливаем аватар пользователя
  if (currentUser.photoUrl) {
    userAvatar.innerHTML = `<img src="${currentUser.photoUrl}" alt="${currentUser.firstName}">`;
  } else {
    userAvatar.textContent = currentUser.firstName.charAt(0);
  }
  
  // Устанавливаем имя пользователя
  let displayName = currentUser.firstName;
  if (currentUser.lastName) {
    displayName += ' ' + currentUser.lastName;
  }
  userName.textContent = displayName;
}

// Загрузка контактов
async function loadContacts() {
  if (!contactsList) return;
  
  try {
    // Сначала пробуем загрузить с сервера
    try {
      const response = await fetch('/api/users');
      if (response.ok) {
        contacts = await response.json();
      } else {
        throw new Error('Не удалось загрузить контакты');
      }
    } catch (e) {
      console.warn("Не удалось загрузить контакты с сервера, используем локальные данные:", e);
      // Если не удалось загрузить с сервера, используем локальные данные
      contacts = [
        { id: 1, name: 'Алиса', username: 'alice', avatar: 'A' },
        { id: 2, name: 'Борис', username: 'boris', avatar: 'B' },
        { id: 3, name: 'Виктор', username: 'victor', avatar: 'V' },
        { id: 4, name: 'Галина', username: 'galina', avatar: 'G' },
        { id: 5, name: 'Дмитрий', username: 'dmitry', avatar: 'D' }
      ];
    }
    
    renderContacts();
  } catch (error) {
    console.error('Ошибка при загрузке контактов:', error);
    contactsList.innerHTML = '<div class="loading-error">Ошибка загрузки контактов</div>';
  }
}

// Рендеринг списка контактов
function renderContacts() {
  if (!contacts || contacts.length === 0 || !contactsList) {
    if (contactsList) contactsList.innerHTML = '<div class="no-contacts">Контакты не найдены</div>';
    return;
  }
  
  // Очищаем список контактов
  contactsList.innerHTML = '';
  
  // Добавляем контакты
  contacts.forEach(contact => {
    const contactItem = document.createElement('div');
    contactItem.className = 'contact-item';
    contactItem.dataset.userId = contact.id;
    
    const contactAvatar = document.createElement('div');
    contactAvatar.className = 'contact-avatar';
    contactAvatar.textContent = contact.avatar || contact.name.charAt(0);
    
    const contactName = document.createElement('div');
    contactName.className = 'contact-name';
    contactName.textContent = contact.name;
    
    contactItem.appendChild(contactAvatar);
    contactItem.appendChild(contactName);
    
    // Добавляем обработчик клика для выбора контакта
    contactItem.addEventListener('click', () => selectContact(contact));
    
    contactsList.appendChild(contactItem);
  });
}

// Выбор контакта для чата
async function selectContact(contact) {
  if (!messagesContainer || !chatTitle || !callControls || !messageInputContainer) return;
  
  // Убираем активный класс у всех контактов
  document.querySelectorAll('.contact-item').forEach(item => {
    item.classList.remove('active');
  });
  
  // Добавляем активный класс выбранному контакту
  const activeContact = document.querySelector(`.contact-item[data-user-id="${contact.id}"]`);
  if (activeContact) activeContact.classList.add('active');
  
  // Устанавливаем выбранный контакт
  selectedContact = contact;
  
  // Обновляем заголовок чата
  chatTitle.textContent = contact.name;
  
  // Показываем элементы управления звонками
  callControls.style.display = 'flex';
  
  // Показываем поле ввода сообщения
  messageInputContainer.style.display = 'flex';
  
  // Загружаем историю сообщений
  await loadMessages(contact.id);
}

// Загрузка истории сообщений
async function loadMessages(userId) {
  if (!messagesContainer) return;
  
  try {
    // Показываем индикатор загрузки
    messagesContainer.innerHTML = '<div class="loading-messages">Загрузка сообщений...</div>';
    
    let messages = [];
    
    // Пробуем загрузить с сервера
    try {
      const response = await fetch(`/api/messages/${userId}`);
      if (response.ok) {
        messages = await response.json();
      } else {
        throw new Error('Не удалось загрузить сообщения');
      }
    } catch (e) {
      console.warn("Не удалось загрузить сообщения с сервера, используем локальные данные:", e);
      // Если не удалось загрузить с сервера, используем локальные данные
      messages = [
        { id: 1, text: 'Привет! Как дела?', sender: userId, timestamp: Date.now() - 86400000 },
        { id: 2, text: 'Отлично! А у тебя?', sender: 'me', timestamp: Date.now() - 86300000 },
        { id: 3, text: 'Всё хорошо, спасибо!', sender: userId, timestamp: Date.now() - 86200000 }
      ];
    }
    
    renderMessages(messages);
  } catch (error) {
    console.error('Ошибка при загрузке сообщений:', error);
    if (messagesContainer) {
      messagesContainer.innerHTML = '<div class="loading-error">Ошибка загрузки сообщений</div>';
    }
  }
}

// Рендеринг сообщений
function renderMessages(messages) {
  if (!messagesContainer) return;
  
  if (!messages || messages.length === 0) {
    messagesContainer.innerHTML = '<div class="no-messages">Нет сообщений</div>';
    return;
  }
  
  // Очищаем контейнер сообщений
  messagesContainer.innerHTML = '';
  
  // Добавляем сообщения
  messages.forEach(message => {
    const messageEl = document.createElement('div');
    messageEl.className = `message message-${message.sender === 'me' ? 'sent' : 'received'}`;
    
    const messageText = document.createElement('div');
    messageText.className = 'message-text';
    messageText.textContent = message.text;
    
    const messageTime = document.createElement('div');
    messageTime.className = 'message-time';
    messageTime.textContent = formatTimestamp(message.timestamp);
    
    messageEl.appendChild(messageText);
    messageEl.appendChild(messageTime);
    
    messagesContainer.appendChild(messageEl);
  });
  
  // Прокручиваем к последнему сообщению
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Форматирование временной метки
function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Отправка сообщения
function sendMessage() {
  if (!selectedContact || !messageInput || !messagesContainer) return;
  
  if (!selectedContact) {
    if (tg.showAlert) {
      tg.showAlert('Пожалуйста, выберите контакт для отправки сообщения');
    } else {
      alert('Пожалуйста, выберите контакт для отправки сообщения');
    }
    return;
  }
  
  const text = messageInput.value.trim();
  if (!text) return;
  
  // Создаем новое сообщение
  const newMessage = {
    id: Date.now(),
    text: text,
    sender: 'me',
    timestamp: Date.now()
  };
  
  // Очищаем поле ввода
  messageInput.value = '';
  
  // Добавляем сообщение в чат
  addMessageToChat(newMessage);
  
  // Эмулируем ответ от собеседника
  setTimeout(() => {
    const reply = {
      id: Date.now() + 1,
      text: `Это автоматический ответ от ${selectedContact.name}`,
      sender: selectedContact.id,
      timestamp: Date.now()
    };
    addMessageToChat(reply);
  }, 1000);
}

// Добавление сообщения в чат
function addMessageToChat(message) {
  if (!messagesContainer) return;
  
  const messageEl = document.createElement('div');
  messageEl.className = `message message-${message.sender === 'me' ? 'sent' : 'received'}`;
  
  const messageText = document.createElement('div');
  messageText.className = 'message-text';
  messageText.textContent = message.text;
  
  const messageTime = document.createElement('div');
  messageTime.className = 'message-time';
  messageTime.textContent = formatTimestamp(message.timestamp);
  
  messageEl.appendChild(messageText);
  messageEl.appendChild(messageTime);
  
  messagesContainer.appendChild(messageEl);
  
  // Прокручиваем к последнему сообщению
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Показ экрана с ошибкой
function showErrorScreen(message) {
  if (!loadingScreen) return;
  
  loadingScreen.innerHTML = `
    <div class="error-icon">❌</div>
    <p class="error-message">${message}</p>
    <button id="retryButton" class="retry-button">Повторить</button>
  `;
  
  const retryButton = document.getElementById('retryButton');
  if (retryButton) {
    retryButton.addEventListener('click', () => {
      location.reload();
    });
  }
}

// Обработчики событий

// Отправка сообщения по клику на кнопку
if (sendMessageBtn) {
  sendMessageBtn.addEventListener('click', sendMessage);
}

// Отправка сообщения по нажатию Enter
if (messageInput) {
  messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      sendMessage();
    }
  });
}

// Обработчик аудиозвонка
if (audioCallBtn) {
  audioCallBtn.addEventListener('click', () => {
    if (selectedContact) {
      if (tg.showAlert) {
        tg.showAlert(`Аудиозвонок с ${selectedContact.name}. В демо-версии звонки недоступны.`);
      } else {
        alert(`Аудиозвонок с ${selectedContact.name}. В демо-версии звонки недоступны.`);
      }
    }
  });
}

// Обработчик видеозвонка
if (videoCallBtn) {
  videoCallBtn.addEventListener('click', () => {
    if (selectedContact) {
      if (tg.showAlert) {
        tg.showAlert(`Видеозвонок с ${selectedContact.name}. В демо-версии звонки недоступны.`);
      } else {
        alert(`Видеозвонок с ${selectedContact.name}. В демо-версии звонки недоступны.`);
      }
    }
  });
}

// Сообщаем в консоль о завершении загрузки скрипта
console.log("Скрипт приложения загружен успешно"); 