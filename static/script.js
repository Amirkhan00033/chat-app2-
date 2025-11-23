     // static/chat.js - Оптимизированная версия для телефона
class ChatApp {
    constructor() {
        this.socket = io();
        this.currentReceiverId = null;
        this.currentReceiverName = null;
        this.userId = parseInt(document.body.dataset.userId, 10) || null;
        this.messageQueue = new Set(); // Для предотвращения дубликатов
        
        this.init();
    }

    init() {
        this.bindEvents();
        this.joinUserRoom();
        console.log('✅ Чат инициализирован');
    }

    bindEvents() {
        // Выбор друга
        document.addEventListener('click', (e) => {
            const friendEl = e.target.closest('.friend');
            if (friendEl) this.selectFriend(friendEl);
            
            const requestBtn = e.target.closest('.request-action');
            if (requestBtn) this.handleRequestAction(requestBtn);
        });

        // Отправка сообщения
        document.getElementById('send-btn').addEventListener('click', () => this.sendMessage());
        
        // Поиск друга
        document.getElementById('search-btn').addEventListener('click', () => this.searchFriend());

        // Обработчики клавиатуры
        this.setupKeyboardHandlers();
        
        // Socket events
        this.socket.on('receive_message', (data) => this.handleReceivedMessage(data));
        this.socket.on('connect', () => console.log('✅ Socket подключен'));
        this.socket.on('disconnect', () => console.log('❌ Socket отключен'));
    }

    setupKeyboardHandlers() {
        const chatInput = document.getElementById('chat-input');
        const searchInput = document.getElementById('search-input');

        // Enter для отправки сообщения
        chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        // Enter для поиска
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.searchFriend();
            }
        });

        // Авто-высота textarea
        chatInput.addEventListener('input', () => {
            chatInput.style.height = 'auto';
            chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
        });
    }

    joinUserRoom() {
        if (this.userId) {
            this.socket.emit('join', { room: this.userId });
        }
    }

    selectFriend(friendEl) {
        // Сбрасываем выделение
        document.querySelectorAll('.friend').forEach(f => f.classList.remove('active'));
        friendEl.classList.add('active');
        
        this.currentReceiverId = parseInt(friendEl.dataset.id, 10);
        this.currentReceiverName = friendEl.dataset.username;
        
        this.updateChatHeader();
        this.enableInput();
        this.loadMessages(this.currentReceiverId);
    }

    updateChatHeader() {
        document.getElementById('current-friend-name').textContent = this.currentReceiverName;
        document.getElementById('current-friend-avatar').textContent = this.currentReceiverName[0].toUpperCase();
        document.getElementById('current-friend-status').textContent = 'В сети';
    }

    enableInput() {
        const input = document.getElementById('chat-input');
        const button = document.getElementById('send-btn');
        
        input.disabled = false;
        button.disabled = false;
        input.focus();
    }

    sendMessage() {
        const input = document.getElementById('chat-input');
        const message = input.value.trim();
        
        if (!message || !this.currentReceiverId) return;

        // Создаем уникальный ID для сообщения
        const messageId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // Добавляем в очередь для предотвращения дубликатов
        this.messageQueue.add(messageId);

        // Показываем сообщение сразу
        this.displayMessage({
            message: message,
            timestamp: new Date().toLocaleTimeString('ru-RU', {hour: '2-digit', minute:'2-digit'}),
            tempId: messageId
        }, 'sent', true);

        // Отправляем на сервер
        this.socket.emit('send_message', {
            message: message,
            receiver_id: this.currentReceiverId,
            sender_id: this.userId,
            tempId: messageId
        });

        // Очищаем поле ввода
        input.value = '';
        input.style.height = 'auto';
    }

    handleReceivedMessage(data) {
        // Проверяем, относится ли сообщение к текущему чату
        if (!this.currentReceiverId) return;
        if (this.currentReceiverId !== data.sender_id && this.currentReceiverId !== data.receiver_id) return;

        const type = data.sender_id === this.userId ? 'sent' : 'received';
        
        // Если это наше сообщение с временным ID, заменяем его
        if (type === 'sent' && data.tempId) {
            this.replaceTempMessage(data.tempId, data);
            this.messageQueue.delete(data.tempId);
        } else {
            this.displayMessage(data, type, false);
        }
    }

    replaceTempMessage(tempId, realMessage) {
        const tempElement = document.querySelector(`[data-temp-id="${tempId}"]`);
        if (tempElement) {
            tempElement.remove();
        }
        this.displayMessage(realMessage, 'sent', false);
    }

    displayMessage(data, type, isTemporary = false) {
        const messagesDiv = document.getElementById('messages');
        
        // Убираем состояние "пусто"
        const emptyState = messagesDiv.querySelector('.empty-state');
        if (emptyState) emptyState.remove();

        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}`;
        
        if (isTemporary) {
            messageDiv.setAttribute('data-temp-id', data.tempId);
            messageDiv.style.opacity = '0.7';
        }

        const time = data.timestamp || new Date().toLocaleTimeString('ru-RU', {
            hour: '2-digit', 
            minute: '2-digit'
        });

        messageDiv.innerHTML = `
            <div class="message-bubble">
                <div class="message-text">${this.escapeHtml(data.message)}</div>
                <div class="message-time">${time} ${isTemporary ? '⏳' : ''}</div>
            </div>
        `;

        messagesDiv.appendChild(messageDiv);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    async loadMessages(friendId) {
        const messagesDiv = document.getElementById('messages');
        messagesDiv.innerHTML = '<div class="empty-state"><div>💬</div><p>Загрузка сообщений...</p></div>';

        try {
            const response = await fetch(`/messages/${friendId}`);
            if (!response.ok) throw new Error('Ошибка загрузки');
            
            const data = await response.json();
            
            if (data.error) {
                messagesDiv.innerHTML = `<div class="empty-state"><div>⚠️</div><p>${data.error}</p></div>`;
                return;
            }

            messagesDiv.innerHTML = '';
            
            if (data.length === 0) {
                messagesDiv.innerHTML = `
                    <div class="empty-state">
                        <div>💬</div>
                        <p>Нет сообщений</p>
                        <small>Начните общение первым!</small>
                    </div>
                `;
                return;
            }

            data.forEach(msg => {
                const type = msg.sender_id === this.userId ? 'sent' : 'received';
                this.displayMessage(msg, type, false);
            });

        } catch (error) {
            console.error('❌ Ошибка загрузки сообщений:', error);
            messagesDiv.innerHTML = `
                <div class="empty-state">
                    <div>⚠️</div>
                    <p>Ошибка загрузки сообщений</p>
                </div>
            `;
        }
    }

    async searchFriend() {
        const searchInput = document.getElementById('search-input');
        const searchTerm = searchInput.value.trim();
        const resultDiv = document.getElementById('search-result');

        if (!searchTerm) {
            resultDiv.innerHTML = '<p class="error">Введите email или имя пользователя</p>';
            return;
        }

        try {
            const response = await fetch('/search_friend', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: `search_term=${encodeURIComponent(searchTerm)}`
            });

            const data = await response.json();
            
            if (data.error) {
                resultDiv.innerHTML = `<p class="error">${data.error}</p>`;
            } else {
                resultDiv.innerHTML = `<p class="success">${data.success}</p>`;
                searchInput.value = '';
                setTimeout(() => location.reload(), 1000);
            }
        } catch (error) {
            resultDiv.innerHTML = '<p class="error">Ошибка при поиске</p>';
        }
    }

    handleRequestAction(button) {
        const requestId = parseInt(button.dataset.requestId, 10);
        const action = button.dataset.action;
        
        if (!requestId || !action) return;
        
        this.processFriendRequest(requestId, action);
    }

    async processFriendRequest(requestId, action) {
        try {
            const response = await fetch('/handle_friend_request', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: `request_id=${requestId}&action=${action}`
            });

            const data = await response.json();
            
            if (data.error) {
                alert(data.error);
            } else {
                alert(data.success);
                location.reload();
            }
        } catch (error) {
            alert('Ошибка обработки заявки');
        }
    }
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    new ChatApp();
});
const socket = io();
const userId = { user_id };
let currentReceiverId = null;
let currentReceiverName = null;

// Присоединяемся к комнате
socket.emit('join', { room: userId.toString() });

// Выбор друга
document.querySelectorAll('.friend').forEach(friend => {
    friend.addEventListener('click', function() {
        // Убираем выделение
        document.querySelectorAll('.friend').forEach(f => f.classList.remove('active'));
        this.classList.add('active');
        
        currentReceiverId = this.dataset.id;
        currentReceiverName = this.dataset.username;
        
        // Обновляем шапку
        document.getElementById('current-friend-name').textContent = currentReceiverName;
        document.getElementById('current-friend-avatar').textContent = currentReceiverName[0].toUpperCase();
        
        // Включаем ввод
        document.getElementById('chat-input').disabled = false;
        document.getElementById('send-btn').disabled = false;
        document.getElementById('chat-input').focus();
        
        // Загружаем сообщения
        loadMessages(currentReceiverId);
    });
});

// Отправка сообщения
function sendMessage() {
    const input = document.getElementById('chat-input');
    const message = input.value.trim();
    
    if (message && currentReceiverId) {
        socket.emit('send_message', {
            message: message,
            receiver_id: parseInt(currentReceiverId),
            sender_id: userId
        });
        
        // Показываем сразу
        displayMessage({
            message: message,
            timestamp: new Date().toLocaleTimeString('ru-RU', {hour: '2-digit', minute:'2-digit'})
        }, 'sent');
        
        input.value = '';
        input.style.height = 'auto';
    }
}

document.getElementById('send-btn').addEventListener('click', sendMessage);

// Enter для отправки
document.getElementById('chat-input').addEventListener('keypress', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

// Поиск друзей
document.getElementById('search-btn').addEventListener('click', function() {
    const input = document.getElementById('search-input');
    const searchTerm = input.value.trim();
    const resultDiv = document.getElementById('search-result');

    if (!searchTerm) {
        resultDiv.innerHTML = '<p class="error">Введите email или имя</p>';
        return;
    }

    fetch('/search_friend', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'search_term=' + encodeURIComponent(searchTerm)
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) {
            resultDiv.innerHTML = '<p class="error">' + data.error + '</p>';
        } else {
            resultDiv.innerHTML = '<p class="success">' + data.success + '</p>';
            input.value = '';
            setTimeout(() => location.reload(), 1000);
        }
    });
});

// Enter для поиска
document.getElementById('search-input').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        document.getElementById('search-btn').click();
    }
});

// Обработка заявок
document.addEventListener('click', function(e) {
    if (e.target.classList.contains('request-action')) {
        const requestId = e.target.dataset.requestId;
        const action = e.target.dataset.action;
        
        fetch('/handle_friend_request', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: 'request_id=' + requestId + '&action=' + action
        })
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                alert(data.error);
            } else {
                alert(data.success);
                location.reload();
            }
        });
    }
});

// Получение сообщений
socket.on('receive_message', function(data) {
    if (currentReceiverId && (currentReceiverId == data.sender_id || currentReceiverId == data.receiver_id)) {
        displayMessage(data, data.sender_id == userId ? 'sent' : 'received');
    }
});

// Отображение сообщения
function displayMessage(data, type) {
    const messagesDiv = document.getElementById('messages');
    
    // Убираем "пустое состояние"
    const emptyState = messagesDiv.querySelector('.empty-state');
    if (emptyState) emptyState.remove();

    const messageDiv = document.createElement('div');
    messageDiv.className = 'message ' + type;
    
    messageDiv.innerHTML = `
        <div class="message-bubble">
            <div class="message-text">${data.message}</div>
            <div class="message-time">${data.timestamp}</div>
        </div>
    `;
    
    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// Загрузка истории
function loadMessages(friendId) {
    const messagesDiv = document.getElementById('messages');
    messagesDiv.innerHTML = '<div class="empty-state"><div>💬</div><p>Загрузка...</p></div>';

    fetch('/messages/' + friendId)
    .then(response => response.json())
    .then(data => {
        messagesDiv.innerHTML = '';
        
        if (data.error) {
            messagesDiv.innerHTML = '<div class="empty-state"><div>⚠️</div><p>' + data.error + '</p></div>';
            return;
        }
        
        if (data.length === 0) {
            messagesDiv.innerHTML = '<div class="empty-state"><div>💬</div><p>Нет сообщений</p></div>';
            return;
        }
        
        data.forEach(msg => {
            displayMessage(msg, msg.sender_id == userId ? 'sent' : 'received');
        });
    });
}

// Автовысота textarea
document.getElementById('chat-input').addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 120) + 'px';
});

// Предотвращение zoom на iOS
document.getElementById('chat-input').addEventListener('touchstart', function() {
    this.style.fontSize = '16px';
});

console.log('Чат загружен для мобильных');