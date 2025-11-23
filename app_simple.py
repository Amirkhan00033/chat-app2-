import os
from flask import Flask, render_template, request, redirect, session, jsonify, flash
from flask_socketio import SocketIO, emit, join_room
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime

app = Flask(__name__)
app.config['SECRET_KEY'] = 'simple-secret-key-12345'
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='eventlet', logger=False, engineio_logger=False)

# 🔥 УПРОЩЕННАЯ БАЗА В ПАМЯТИ (для экономии ресурсов)
users = {}
friends = {}
messages = []
user_counter = 1

@app.route('/')
def index():
    return redirect('/login')

@app.route('/register', methods=['GET','POST'])
def register():
    if request.method == 'POST':
        email = request.form.get('email')
        username = request.form.get('username')
        password = request.form.get('password')
        
        if email in users:
            flash('Пользователь с таким email уже существует')
            return render_template('register.html')
        
        global user_counter
        users[email] = {
            'id': user_counter,
            'username': username,
            'password': generate_password_hash(password)
        }
        user_counter += 1
        
        flash('Регистрация успешна! Теперь войдите в аккаунт.')
        return redirect('/login')
    
    return render_template('register.html')

@app.route('/login', methods=['GET','POST'])
def login():
    if request.method == 'POST':
        email = request.form.get('email')
        password = request.form.get('password')
        
        user = users.get(email)
        if user and check_password_hash(user['password'], password):
            session['user_id'] = user['id']
            session['username'] = user['username']
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
    
    # Простой список пользователей (кроме себя)
    user_list = [{'id': data['id'], 'username': data['username']} 
                for data in users.values() 
                if data['id'] != user_id]
    
    return render_template('chat.html', 
                         username=username, 
                         user_id=user_id, 
                         friends=user_list)

@app.route('/search_friend', methods=['POST'])
def search_friend():
    if 'user_id' not in session:
        return jsonify({'error': 'Не авторизован'}), 401
    
    search_term = request.form.get('search_term', '').strip()
    
    if not search_term:
        return jsonify({'error': 'Введите email или имя пользователя'})
    
    # Ищем пользователя
    user = None
    for email, data in users.items():
        if email == search_term or data['username'] == search_term:
            user = data
            break
    
    if not user:
        return jsonify({'error': 'Пользователь не найден'})
    
    if user['id'] == session['user_id']:
        return jsonify({'error': 'Нельзя добавить самого себя'})
    
    return jsonify({'success': f'Пользователь найден: {user["username"]}'})

# ----------------- SocketIO (упрощенный) -----------------
@socketio.on('connect')
def handle_connect():
    print('✅ Клиент подключен')

@socketio.on('send_message')
def handle_send_message(data):
    sender_id = session.get('user_id')
    if not sender_id:
        return
    
    receiver_id = int(data.get('receiver_id'))
    message_content = data.get('message')
    
    if not all([receiver_id, message_content]):
        return
    
    # Сохраняем сообщение
    message_data = {
        'sender_id': sender_id,
        'receiver_id': receiver_id,
        'message': message_content,
        'timestamp': datetime.now().strftime('%H:%M')
    }
    
    messages.append(message_data)
    
    # Отправляем получателю и отправителю
    emit('receive_message', message_data, room=str(receiver_id))
    emit('receive_message', message_data, room=str(sender_id))

@socketio.on('join')
def handle_join(data):
    join_room(str(data.get('room')))

# Health check для Render
@app.route('/health')
def health():
    return jsonify({'status': 'healthy'}), 200

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    print("🚀 Упрощенный мессенджер запущен!")
    print("📍 Оптимизирован для Render")
    socketio.run(app, host='0.0.0.0', port=port, debug=False, allow_unsafe_werkzeug=True)