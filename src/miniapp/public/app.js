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

// Элементы поиска и вкладок
const tabButtons = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');
const friendsTab = document.getElementById('friendsTab');
const searchTab = document.getElementById('searchTab');
const searchInput = document.getElementById('searchInput');
const searchButton = document.getElementById('searchButton');
const searchResults = document.getElementById('searchResults');

// Элементы модального окна
const userInfoModal = document.getElementById('userInfoModal');
const modalUserAvatar = document.getElementById('modalUserAvatar');
const modalUserName = document.getElementById('modalUserName');
const modalUsername = document.getElementById('modalUsername');
const addFriendBtn = document.getElementById('addFriendBtn');
const removeFriendBtn = document.getElementById('removeFriendBtn');
const startChatBtn = document.getElementById('startChatBtn');
const closeModal = document.querySelector('.close-modal');

// Переменные состояния
let currentUser = null;
let selectedContact = null;
let contacts = [];
let selectedUserForModal = null;

// Переменные для WebRTC
let localStream = null;
let peerConnection = null;
let callInProgress = false;
let callType = null; // 'audio' или 'video'

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
    
    // Загружаем контакты (друзей)
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
      if (tg.MainButton.show) {
        tg.MainButton.show();
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
  
  // Регистрируем пользователя на сервере
  await registerUser(currentUser);
}

// Регистрация пользователя на сервере
async function registerUser(user) {
  try {
    const response = await fetch('/api/users/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(user)
    });
    
    if (!response.ok) {
      throw new Error('Ошибка при регистрации пользователя');
    }
    
    console.log('Пользователь успешно зарегистрирован на сервере');
  } catch (error) {
    console.error('Ошибка при регистрации пользователя:', error);
    // Продолжаем работу даже при ошибке регистрации
  }
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
    // Сначала пробуем загрузить друзей пользователя
    try {
      if (currentUser && currentUser.id) {
        const response = await fetch(`/api/users/${currentUser.id}/friends`);
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.friends) {
            contacts = data.friends.map(friend => ({
              id: friend.id,
              name: `${friend.firstName} ${friend.lastName}`.trim(),
              username: friend.username || '',
              avatar: friend.photoUrl ? null : friend.firstName.charAt(0),
              photoUrl: friend.photoUrl
            }));
            renderContacts();
            return;
          }
        }
      }
      throw new Error('Не удалось загрузить друзей');
    } catch (e) {
      console.warn("Не удалось загрузить друзей, пробуем запасной API:", e);
      
      // Пробуем загрузить общий список пользователей
      const response = await fetch('/api/users');
      if (response.ok) {
        contacts = await response.json();
        renderContacts();
        return;
      } else {
        throw new Error('Не удалось загрузить контакты');
      }
    }
  } catch (error) {
    console.error('Ошибка при загрузке контактов:', error);
    // Используем локальные данные как запасной вариант
    contacts = [
      { id: 1, name: 'Алиса', username: 'alice', avatar: 'A' },
      { id: 2, name: 'Борис', username: 'boris', avatar: 'B' },
      { id: 3, name: 'Виктор', username: 'victor', avatar: 'V' },
      { id: 4, name: 'Галина', username: 'galina', avatar: 'G' },
      { id: 5, name: 'Дмитрий', username: 'dmitry', avatar: 'D' }
    ];
    renderContacts();
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

// Обработчики для вкладок
if (tabButtons) {
  tabButtons.forEach(button => {
    button.addEventListener('click', function() {
      const tabName = this.dataset.tab;
      
      // Убираем активный класс у всех кнопок и содержимого вкладок
      tabButtons.forEach(btn => btn.classList.remove('active'));
      tabContents.forEach(content => content.classList.remove('active'));
      
      // Активируем выбранную вкладку
      this.classList.add('active');
      document.getElementById(`${tabName}Tab`).classList.add('active');
    });
  });
}

// Обработчик поиска
if (searchButton) {
  searchButton.addEventListener('click', () => {
    if (searchInput) {
      searchUsers(searchInput.value.trim());
    }
  });
}

// Поиск при нажатии Enter
if (searchInput) {
  searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      searchUsers(searchInput.value.trim());
    }
  });
}

// Закрытие модального окна при клике на крестик
if (closeModal) {
  closeModal.addEventListener('click', hideUserModal);
}

// Закрытие модального окна при клике вне его содержимого
window.addEventListener('click', (e) => {
  if (userInfoModal && e.target === userInfoModal) {
    hideUserModal();
  }
});

// Обработчик добавления в друзья
if (addFriendBtn) {
  addFriendBtn.addEventListener('click', async () => {
    if (selectedUserForModal) {
      const success = await addFriend(selectedUserForModal.id);
      if (success) {
        addFriendBtn.style.display = 'none';
        removeFriendBtn.style.display = 'block';
        if (tg.showPopup) {
          tg.showPopup({
            title: 'Успешно',
            message: 'Пользователь добавлен в друзья',
            buttons: [{ type: 'ok' }]
          });
        } else {
          alert('Пользователь добавлен в друзья');
        }
      }
    }
  });
}

// Обработчик удаления из друзей
if (removeFriendBtn) {
  removeFriendBtn.addEventListener('click', async () => {
    if (selectedUserForModal) {
      if (tg.showConfirm) {
        tg.showConfirm('Вы уверены, что хотите удалить пользователя из друзей?', async (confirmed) => {
          if (confirmed) {
            const success = await removeFriend(selectedUserForModal.id);
            if (success) {
              addFriendBtn.style.display = 'block';
              removeFriendBtn.style.display = 'none';
              hideUserModal();
            }
          }
        });
      } else {
        const confirmed = confirm('Вы уверены, что хотите удалить пользователя из друзей?');
        if (confirmed) {
          const success = await removeFriend(selectedUserForModal.id);
          if (success) {
            addFriendBtn.style.display = 'block';
            removeFriendBtn.style.display = 'none';
            hideUserModal();
          }
        }
      }
    }
  });
}

// Обработчик начала чата в модальном окне
if (startChatBtn) {
  startChatBtn.addEventListener('click', () => {
    if (selectedUserForModal) {
      // Создаем объект контакта из данных пользователя
      const contact = {
        id: selectedUserForModal.id,
        name: `${selectedUserForModal.firstName} ${selectedUserForModal.lastName || ''}`.trim(),
        username: selectedUserForModal.username || '',
        avatar: selectedUserForModal.photoUrl ? null : selectedUserForModal.firstName.charAt(0),
        photoUrl: selectedUserForModal.photoUrl
      };
      
      // Выбираем контакт и закрываем модальное окно
      selectContact(contact);
      hideUserModal();
    }
  });
}

// Обработчик аудиозвонка
if (audioCallBtn) {
  audioCallBtn.addEventListener('click', () => {
    if (selectedContact) {
      startAudioCall(selectedContact.id);
    }
  });
}

// Обработчик видеозвонка
if (videoCallBtn) {
  videoCallBtn.addEventListener('click', () => {
    if (selectedContact) {
      startVideoCall(selectedContact.id);
    }
  });
}

// Функция поиска пользователей
async function searchUsers(query) {
  if (!query || query.trim() === '') {
    searchResults.innerHTML = '<div class="no-results">Введите имя пользователя или @username для поиска</div>';
    return;
  }
  
  try {
    searchResults.innerHTML = '<div class="loading-results">Поиск пользователей...</div>';
    
    const response = await fetch(`/api/users/search?query=${encodeURIComponent(query)}`);
    
    if (!response.ok) {
      throw new Error('Ошибка при поиске пользователей');
    }
    
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || 'Ошибка при поиске пользователей');
    }
    
    renderSearchResults(data.results);
  } catch (error) {
    console.error('Ошибка при поиске пользователей:', error);
    searchResults.innerHTML = '<div class="error-message">Ошибка при поиске пользователей</div>';
  }
}

// Рендеринг результатов поиска
function renderSearchResults(results) {
  if (!results || results.length === 0) {
    searchResults.innerHTML = '<div class="no-results">Пользователи не найдены</div>';
    return;
  }
  
  searchResults.innerHTML = '';
  
  results.forEach(user => {
    const userItem = document.createElement('div');
    userItem.className = 'user-item';
    userItem.dataset.userId = user.id;
    
    const userAvatar = document.createElement('div');
    userAvatar.className = 'user-avatar';
    
    // Если есть фото, используем его, иначе первую букву имени
    if (user.photoUrl) {
      userAvatar.innerHTML = `<img src="${user.photoUrl}" alt="${user.firstName}">`;
    } else {
      userAvatar.textContent = user.firstName.charAt(0);
    }
    
    const userInfo = document.createElement('div');
    userInfo.className = 'user-info';
    
    const userFullName = document.createElement('div');
    userFullName.className = 'user-full-name';
    userFullName.textContent = `${user.firstName} ${user.lastName || ''}`.trim();
    
    const userUsername = document.createElement('div');
    userUsername.className = 'user-username';
    userUsername.textContent = user.username ? `@${user.username}` : '';
    
    userInfo.appendChild(userFullName);
    if (user.username) userInfo.appendChild(userUsername);
    
    userItem.appendChild(userAvatar);
    userItem.appendChild(userInfo);
    
    // Добавляем обработчик для открытия модального окна с информацией о пользователе
    userItem.addEventListener('click', () => showUserModal(user));
    
    searchResults.appendChild(userItem);
  });
}

// Показать модальное окно с информацией о пользователе
function showUserModal(user) {
  if (!userInfoModal) return;
  
  selectedUserForModal = user;
  
  // Заполняем информацию
  if (modalUserAvatar) {
    if (user.photoUrl) {
      modalUserAvatar.innerHTML = `<img src="${user.photoUrl}" alt="${user.firstName}">`;
    } else {
      modalUserAvatar.textContent = user.firstName.charAt(0);
    }
  }
  
  if (modalUserName) {
    modalUserName.textContent = `${user.firstName} ${user.lastName || ''}`.trim();
  }
  
  if (modalUsername) {
    modalUsername.textContent = user.username ? `@${user.username}` : '';
  }
  
  // Проверяем, является ли пользователь другом
  const isFriend = contacts.some(contact => contact.id === user.id.toString());
  
  if (addFriendBtn) addFriendBtn.style.display = isFriend ? 'none' : 'block';
  if (removeFriendBtn) removeFriendBtn.style.display = isFriend ? 'block' : 'none';
  
  // Показываем модальное окно
  userInfoModal.style.display = 'flex';
}

// Скрыть модальное окно
function hideUserModal() {
  if (userInfoModal) userInfoModal.style.display = 'none';
  selectedUserForModal = null;
}

// Добавление пользователя в друзья
async function addFriend(userId) {
  if (!currentUser || !currentUser.id) {
    showError('Необходимо войти в систему');
    return false;
  }
  
  try {
    const response = await fetch(`/api/users/${currentUser.id}/friends/${userId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error('Ошибка при добавлении друга');
    }
    
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || 'Ошибка при добавлении друга');
    }
    
    // Обновляем список друзей
    await loadContacts();
    return true;
  } catch (error) {
    console.error('Ошибка при добавлении друга:', error);
    showError('Не удалось добавить пользователя в друзья');
    return false;
  }
}

// Удаление пользователя из друзей
async function removeFriend(userId) {
  if (!currentUser || !currentUser.id) {
    showError('Необходимо войти в систему');
    return false;
  }
  
  try {
    const response = await fetch(`/api/users/${currentUser.id}/friends/${userId}`, {
      method: 'DELETE'
    });
    
    if (!response.ok) {
      throw new Error('Ошибка при удалении друга');
    }
    
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || 'Ошибка при удалении друга');
    }
    
    // Обновляем список друзей
    await loadContacts();
    return true;
  } catch (error) {
    console.error('Ошибка при удалении друга:', error);
    showError('Не удалось удалить пользователя из друзей');
    return false;
  }
}

// Показать сообщение об ошибке
function showError(message) {
  if (tg.showAlert) {
    tg.showAlert(message);
  } else {
    alert(message);
  }
}

// Сообщаем в консоль о завершении загрузки скрипта
console.log("Скрипт приложения загружен успешно");

// Инициализация видеозвонка
async function initVideoCall() {
  try {
    // Запрашиваем доступ к камере и микрофону
    localStream = await navigator.mediaDevices.getUserMedia({ 
      video: true, 
      audio: true 
    });
    
    // Здесь должна быть инициализация RTCPeerConnection и настройка сигнализации
    // через WebSocket для установки соединения с другим пользователем
    
    return true;
  } catch (error) {
    console.error('Ошибка при инициализации видеозвонка:', error);
    showError('Не удалось получить доступ к камере и микрофону. Проверьте разрешения браузера.');
    return false;
  }
}

// Инициализация аудиозвонка
async function initAudioCall() {
  try {
    // Запрашиваем доступ только к микрофону
    localStream = await navigator.mediaDevices.getUserMedia({ 
      video: false, 
      audio: true 
    });
    
    // Здесь должна быть инициализация RTCPeerConnection и настройка сигнализации
    // через WebSocket для установки соединения с другим пользователем
    
    return true;
  } catch (error) {
    console.error('Ошибка при инициализации аудиозвонка:', error);
    showError('Не удалось получить доступ к микрофону. Проверьте разрешения браузера.');
    return false;
  }
}

// Начать видеозвонок
async function startVideoCall(contactId) {
  if (callInProgress) {
    showError('У вас уже идет звонок. Пожалуйста, завершите текущий звонок перед началом нового.');
    return;
  }
  
  callType = 'video';
  
  if (await initVideoCall()) {
    // Создаем интерфейс видеозвонка
    showCallInterface();
    
    // Инициализируем соединение с контактом
    // Код для установления соединения через сервер сигнализации WebRTC
    
    callInProgress = true;
  }
}

// Начать аудиозвонок
async function startAudioCall(contactId) {
  if (callInProgress) {
    showError('У вас уже идет звонок. Пожалуйста, завершите текущий звонок перед началом нового.');
    return;
  }
  
  callType = 'audio';
  
  if (await initAudioCall()) {
    // Создаем интерфейс аудиозвонка
    showCallInterface();
    
    // Инициализируем соединение с контактом
    // Код для установления соединения через сервер сигнализации WebRTC
    
    callInProgress = true;
  }
}

// Показать интерфейс звонка
function showCallInterface() {
  // Создаем модальное окно для звонка
  const callModal = document.createElement('div');
  callModal.className = 'call-modal';
  callModal.id = 'callModal';
  
  const callContent = document.createElement('div');
  callContent.className = 'call-content';
  
  // Информация о контакте
  const callContactInfo = document.createElement('div');
  callContactInfo.className = 'call-contact-info';
  callContactInfo.innerHTML = `
    <div class="call-avatar">${selectedContact.avatar || selectedContact.name.charAt(0)}</div>
    <div class="call-name">${selectedContact.name}</div>
    <div class="call-status">Соединение...</div>
  `;
  
  // Контейнеры для видео
  const videoContainer = document.createElement('div');
  videoContainer.className = 'video-container';
  videoContainer.style.display = callType === 'video' ? 'flex' : 'none';
  
  const localVideoContainer = document.createElement('div');
  localVideoContainer.className = 'local-video-container';
  
  const localVideo = document.createElement('video');
  localVideo.id = 'localVideo';
  localVideo.autoplay = true;
  localVideo.muted = true;
  localVideo.playsInline = true;
  
  // Подключаем локальный видеопоток
  if (localStream) {
    localVideo.srcObject = localStream;
  }
  
  const remoteVideoContainer = document.createElement('div');
  remoteVideoContainer.className = 'remote-video-container';
  
  const remoteVideo = document.createElement('video');
  remoteVideo.id = 'remoteVideo';
  remoteVideo.autoplay = true;
  remoteVideo.playsInline = true;
  
  localVideoContainer.appendChild(localVideo);
  remoteVideoContainer.appendChild(remoteVideo);
  videoContainer.appendChild(localVideoContainer);
  videoContainer.appendChild(remoteVideoContainer);
  
  // Кнопки управления звонком
  const callControls = document.createElement('div');
  callControls.className = 'call-controls';
  
  const muteBtn = document.createElement('button');
  muteBtn.className = 'call-control-btn';
  muteBtn.innerHTML = '🔇';
  muteBtn.title = 'Выключить микрофон';
  
  const videoBtn = document.createElement('button');
  videoBtn.className = 'call-control-btn';
  videoBtn.innerHTML = '📷';
  videoBtn.title = 'Выключить камеру';
  videoBtn.style.display = callType === 'video' ? 'block' : 'none';
  
  const endCallBtn = document.createElement('button');
  endCallBtn.className = 'call-control-btn end-call';
  endCallBtn.innerHTML = '❌';
  endCallBtn.title = 'Завершить звонок';
  
  callControls.appendChild(muteBtn);
  callControls.appendChild(videoBtn);
  callControls.appendChild(endCallBtn);
  
  // Собираем интерфейс
  callContent.appendChild(callContactInfo);
  callContent.appendChild(videoContainer);
  callContent.appendChild(callControls);
  callModal.appendChild(callContent);
  
  // Добавляем интерфейс в документ
  document.body.appendChild(callModal);
  
  // Обработчики событий для кнопок
  muteBtn.addEventListener('click', toggleMute);
  videoBtn.addEventListener('click', toggleVideo);
  endCallBtn.addEventListener('click', endCall);
}

// Переключение микрофона
function toggleMute() {
  if (localStream) {
    const audioTracks = localStream.getAudioTracks();
    if (audioTracks.length > 0) {
      const enabled = !audioTracks[0].enabled;
      audioTracks[0].enabled = enabled;
      
      const muteBtn = document.querySelector('.call-control-btn');
      if (muteBtn) {
        muteBtn.innerHTML = enabled ? '🔇' : '🔈';
        muteBtn.title = enabled ? 'Выключить микрофон' : 'Включить микрофон';
      }
    }
  }
}

// Переключение камеры
function toggleVideo() {
  if (localStream) {
    const videoTracks = localStream.getVideoTracks();
    if (videoTracks.length > 0) {
      const enabled = !videoTracks[0].enabled;
      videoTracks[0].enabled = enabled;
      
      const videoBtn = document.querySelectorAll('.call-control-btn')[1];
      if (videoBtn) {
        videoBtn.innerHTML = enabled ? '📷' : '📷❌';
        videoBtn.title = enabled ? 'Выключить камеру' : 'Включить камеру';
      }
    }
  }
}

// Завершение звонка
function endCall() {
  // Остановка стримов
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  
  // Закрытие соединения
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  
  // Удаление интерфейса звонка
  const callModal = document.getElementById('callModal');
  if (callModal) {
    callModal.remove();
  }
  
  callInProgress = false;
  callType = null;
} 