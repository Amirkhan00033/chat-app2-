import os
from flask import Flask, render_template, request, redirect, session, jsonify, flash
from flask_sqlalchemy import SQLAlchemy
from flask_socketio import SocketIO, emit, join_room
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime

app = Flask(__name__)
app.config['SECRET_KEY'] = 'super-secret-key-12345'

# ⭐ НАСТРОЙКА БАЗЫ ДАННЫХ ДЛЯ RENDER ⭐
if os.environ.get('RENDER'):
    # На Render - используем PostgreSQL
    database_url = os.environ.get('DATABASE_URL')
    if database_url and database_url.startswith("postgres://"):
        database_url = database_url.replace("postgres://", "postgresql://", 1)
    app.config['SQLALCHEMY_DATABASE_URI'] = database_url
else:
    # Локально - используем SQLite
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///database.db'

app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# ⭐ ДОБАВЬ ЭТИ СТРОКИ ДЛЯ УСКОРЕНИЯ ⭐
app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {
    'pool_recycle': 300,
    'pool_pre_ping': True
}
# ⭐ КОНЕЦ ДОБАВЛЕНИЯ ⭐

db = SQLAlchemy(app)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='eventlet')

# ----------------- Модели -----------------
class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(120), unique=True, nullable=False)
    username = db.Column(db.String(50), unique=True, nullable=False)
    password = db.Column(db.String(200), nullable=False)

class Friend(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, nullable=False)
    friend_id = db.Column(db.Integer, nullable=False)
    status = db.Column(db.String(20), default='pending')

class Message(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    sender_id = db.Column(db.Integer, nullable=False)
    receiver_id = db.Column(db.Integer, nullable=False)
    content = db.Column(db.Text, nullable=False)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)

# ----------------- Создание базы -----------------
with app.app_context():
    db.create_all()
    print("✅ База данных готова")

# ----------------- Маршруты -----------------
@app.route('/')
def index():
    return redirect('/login')

@app.route('/register', methods=['GET','POST'])
def register():
    if request.method == 'POST':
        email = request.form.get('email')
        username = request.form.get('username')
        password = request.form.get('password')
        
        if User.query.filter_by(email=email).first():
            flash('Пользователь с таким email уже существует')
            return render_template('register.html')
        if User.query.filter_by(username=username).first():
            flash('Пользователь с таким именем уже существует')
            return render_template('register.html')
        
        user = User(email=email, username=username, password=generate_password_hash(password))
        db.session.add(user)
        db.session.commit()
        flash('Регистрация успешна! Теперь войдите в аккаунт.')
        return redirect('/login')
    
    return render_template('register.html')

@app.route('/login', methods=['GET','POST'])
def login():
    if request.method == 'POST':
        email = request.form.get('email')
        password = request.form.get('password')
        
        user = User.query.filter_by(email=email).first()
        if user and check_password_hash(user.password, password):
            session['user_id'] = user.id
            session['username'] = user.username
            return redirect('/chat')
        else:
            flash('Неверный email или пароль')
    
    return render_template('login.html')

@app.route('/logout')
def logout():
    session.clear()
    return redirect('/login')

@app.route('/chat')
def chat():
    if 'user_id' not in session:
        return redirect('/login')
    
    user_id = session['user_id']
    username = session['username']
    
    # Получаем друзей (упрощенный запрос)
    friends = User.query.join(
        Friend, 
        ((Friend.friend_id == User.id) & (Friend.user_id == user_id)) | 
        ((Friend.user_id == User.id) & (Friend.friend_id == user_id))
    ).filter(Friend.status == 'accepted').all()
    
    # Получаем заявки в друзья
    incoming_requests = db.session.query(User, Friend).join(
        Friend, Friend.user_id == User.id
    ).filter(
        Friend.friend_id == user_id, 
        Friend.status == 'pending'
    ).all()
    
    return render_template('chat.html', 
                         username=username, 
                         user_id=user_id, 
                         friends=friends,
                         incoming_requests=incoming_requests)

@app.route('/search_friend', methods=['POST'])
def search_friend():
    if 'user_id' not in session:
        return jsonify({'error': 'Не авторизован'}), 401
    
    user_id = session['user_id']
    search_term = request.form.get('search_term', '').strip()
    
    if not search_term:
        return jsonify({'error': 'Введите email или имя пользователя'})
    
    user = User.query.filter(
        (User.email == search_term) | (User.username == search_term)
    ).first()
    
    if not user:
        return jsonify({'error': 'Пользователь не найден'})
    
    if user.id == user_id:
        return jsonify({'error': 'Нельзя добавить самого себя'})
    
    # Проверяем существующую заявку
    existing = Friend.query.filter(
        ((Friend.user_id == user_id) & (Friend.friend_id == user.id)) |
        ((Friend.user_id == user.id) & (Friend.friend_id == user_id))
    ).first()
    
    if existing:
        if existing.status == 'pending':
            return jsonify({'error': 'Заявка уже отправлена'})
        else:
            return jsonify({'error': 'Пользователь уже в друзьях'})
    
    # Создаем заявку
    new_request = Friend(user_id=user_id, friend_id=user.id, status='pending')
    db.session.add(new_request)
    db.session.commit()
    
    return jsonify({'success': f'Заявка отправлена {user.username}'})

@app.route('/handle_friend_request', methods=['POST'])
def handle_friend_request():
    if 'user_id' not in session:
        return jsonify({'error': 'Не авторизован'}), 401
    
    user_id = session['user_id']
    request_id = request.form.get('request_id')
    action = request.form.get('action')
    
    friend_request = Friend.query.filter_by(id=request_id, friend_id=user_id).first()
    
    if not friend_request:
        return jsonify({'error': 'Заявка не найдена'})
    
    if action == 'accept':
        friend_request.status = 'accepted'
        db.session.commit()
        return jsonify({'success': 'Заявка принята'})
    elif action == 'decline':
        db.session.delete(friend_request)
        db.session.commit()
        return jsonify({'success': 'Заявка отклонена'})
    
    return jsonify({'error': 'Неизвестное действие'})

@app.route('/messages/<int:friend_id>')
def get_messages(friend_id):
    if 'user_id' not in session:
        return jsonify({'error': 'Не авторизован'}), 401
    
    user_id = session['user_id']
    
    # Упрощенная проверка дружбы
    friendship = Friend.query.filter(
        ((Friend.user_id == user_id) & (Friend.friend_id == friend_id)) |
        ((Friend.user_id == friend_id) & (Friend.friend_id == user_id)),
        Friend.status == 'accepted'
    ).first()
    
    if not friendship:
        return jsonify({'error': 'Пользователь не в друзьях'}), 403
    
    # Получаем сообщения
    messages = Message.query.filter(
        ((Message.sender_id == user_id) & (Message.receiver_id == friend_id)) |
        ((Message.sender_id == friend_id) & (Message.receiver_id == user_id))
    ).order_by(Message.timestamp.asc()).all()
    
    result = []
    for msg in messages:
        result.append({
            'sender_id': msg.sender_id,
            'receiver_id': msg.receiver_id,
            'message': msg.content,
            'timestamp': msg.timestamp.strftime('%H:%M')
        })
    
    return jsonify(result)

# ----------------- SocketIO -----------------
@socketio.on('connect')
def handle_connect():
    print('✅ Клиент подключен:', session.get('username'))

@socketio.on('disconnect')
def handle_disconnect():
    print('❌ Клиент отключен:', session.get('username'))

@socketio.on('join')
def handle_join(data):
    room = str(data.get('room'))
    join_room(room)
    print(f'📍 Пользователь {session.get("username")} присоединился к комнате {room}')

@socketio.on('send_message')
def handle_send_message(data):
    sender_id = session.get('user_id')
    if not sender_id:
        print('❌ Нет sender_id в сессии')
        return
    
    receiver_id = int(data.get('receiver_id'))
    message_content = data.get('message')
    
    print(f'📨 Сообщение от {sender_id} к {receiver_id}: {message_content}')
    
    if not all([receiver_id, message_content]):
        print('❌ Не хватает данных')
        return
    
    # Создаем сообщение
    message = Message(
        sender_id=sender_id,
        receiver_id=receiver_id,
        content=message_content
    )
    
    db.session.add(message)
    db.session.commit()
    
    print(f'💾 Сообщение сохранено в БД, ID: {message.id}')
    
    # ИСПРАВЛЕННОЕ ВРЕМЯ - используем текущее время вместо времени из БД
    current_time = datetime.now().strftime('%H:%M')
    
    # Отправляем получателю
    emit('receive_message', {
        'sender_id': sender_id,
        'receiver_id': receiver_id,
        'message': message_content,
        'timestamp': current_time  # Текущее время
    }, room=str(receiver_id))
    
    # Отправляем отправителю
    emit('receive_message', {
        'sender_id': sender_id,
        'receiver_id': receiver_id,
        'message': message_content,
        'timestamp': current_time  # Текущее время
    }, room=str(sender_id))
    
    print(f'📤 Сообщение отправлено в комнаты {receiver_id} и {sender_id}')

# ----------------- Запуск -----------------
if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    print("🚀 Запуск мессенджера...")
    print(f"📍 Порт: {port}")
    socketio.run(app, host='0.0.0.0', port=port, debug=False, allow_unsafe_werkzeug=True)