const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Разрешаем подключения с любых адресов (для Render)
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Доверяем прокси (нужно для Render)
app.set('trust proxy', 1);

// Статика
app.use(express.static('public'));
app.use('/tasks', express.static('tasks'));

// Обязательный маршрут для страницы комнаты
app.get('/room', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'room.html'));
});

// // Блокировка телефонов
// app.use((req, res, next) => {
//   const ua = req.headers['user-agent'] || '';
//   if (/Mobile|Android|iPhone|iPad|iPod/i.test(ua)) {
//     return res.status(403).send('Сайт доступен только с ПК или ноутбука.');
//   }
//   next();
// });

const rooms = {};

function generateRoomCode() {
  return Math.floor(10000 + Math.random() * 90000).toString();
}

io.on('connection', (socket) => {
  console.log('Подключился:', socket.id);

  socket.on('createRoom', ({ name }, callback) => {
    let code;
    do { code = generateRoomCode(); } while (rooms[code]);
    rooms[code] = {
      players: [{ id: socket.id, name }],
      started: false,
      finished: false
    };
    socket.join(code);
    callback({ success: true, roomCode: code });
  });

  socket.on('joinRoom', ({ code, name }, callback) => {
    const room = rooms[code];
    if (!room) return callback({ success: false, message: 'Комната не найдена' });
    if (room.players.length >= 2) return callback({ success: false, message: 'Комната заполнена' });
    if (room.started) return callback({ success: false, message: 'Игра уже идёт' });

    room.players.push({ id: socket.id, name });
    socket.join(code);

    if (room.players.length === 2) {
      room.started = true;
      io.to(code).emit('gameStart', {
        task: 'task1',
        players: room.players.map(p => ({ id: p.id, name: p.name }))
      });
    }
    callback({ success: true });
  });

  socket.on('submit', (data) => {
    const { roomCode, similarity } = data;
    const room = rooms[roomCode];
    if (!room || !room.started || room.finished) return;

    if (similarity >= 80) {
      room.finished = true;
      const winner = room.players.find(p => p.id === socket.id);
      const loser = room.players.find(p => p.id !== socket.id);
      io.to(roomCode).emit('gameOver', {
        winner: socket.id,
        winnerName: winner.name,
        loserName: loser.name,
        message: `${winner.name} выиграл!`
      });
    } else {
      socket.emit('submitResult', {
        success: false,
        similarity,
        message: `Схожесть ${similarity}%. Нужно не менее 80%. Попробуйте ещё.`
      });
    }
  });

  socket.on('disconnect', () => {
    for (const [code, room] of Object.entries(rooms)) {
      if (room.players.some(p => p.id === socket.id)) {
        io.to(code).emit('playerLeft');
        delete rooms[code];
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Сервер запущен на порту ${PORT}`));