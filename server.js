const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET','POST'] } });

app.set('trust proxy', 1);
app.use(express.static('public'));
app.use('/tasks', express.static('tasks'));

app.get('/room', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'room.html'));
});

const TASKS = ['task1.html', 'task2.html', 'task3.html', 'task4.html', 'task5.html', 'task6.html', 'task7.html', 'task8.html'];

const rooms = {};
const socketToRoom = new Map();

const RATING_FILE = './rating.json';
let ratings = {};
function loadRatings() {
  try {
    if (fs.existsSync(RATING_FILE)) {
      ratings = JSON.parse(fs.readFileSync(RATING_FILE, 'utf8'));
    }
  } catch(e) { console.error(e); }
}
function saveRatings() {
  fs.writeFileSync(RATING_FILE, JSON.stringify(ratings, null, 2));
}
function getRank(score) {
  if (score >= 3000) return 'Master';
  if (score >= 2000) return 'Diamond';
  if (score >= 1500) return 'Platinum';
  if (score >= 1000) return 'Gold';
  if (score >= 500) return 'Silver';
  return 'Bronze';
}
function updateRating(winnerId, loserId, winnerToken, loserToken) {
  const winnerRating = ratings[winnerToken] || { score: 0, name: winnerId };
  const loserRating = ratings[loserToken] || { score: 0, name: loserId };
  let winnerGain = 50;
  let loserGain = 10;
  winnerRating.score += winnerGain;
  loserRating.score += loserGain;
  ratings[winnerToken] = winnerRating;
  ratings[loserToken] = loserRating;
  saveRatings();
  return { winnerGain, loserGain };
}
loadRatings();

function cleanName(name) { return String(name || '').trim().slice(0,30) || 'Игрок'; }
function cleanToken(token) { return typeof token === 'string' && token.length && token.length <= 128 ? token : null; }

function buildRoomState(room) {
  let remainingTime = null;
  if (room.started && !room.finished && room.startTime) {
    const elapsed = Math.floor((Date.now() - room.startTime) / 1000);
    remainingTime = Math.max(0, room.timeLimit - elapsed);
  }
  return {
    roomCode: room.code,
    players: room.players.map(p => ({ id: p.id, name: p.name })),
    started: room.started,
    finished: room.finished,
    winner: room.winner || null,
    winnerName: room.winnerName || null,
    timeLimit: room.timeLimit,
    currentTask: room.currentTask || null,
    progress: room.progress || {},
    remainingTime: remainingTime
  };
}
function emitRoomState(room) { io.to(room.code).emit('roomState', buildRoomState(room)); }

function pruneDeadPlayers(room) {
  const active = room.players.filter(p => io.sockets.sockets.get(p.id)?.connected);
  if (active.length !== room.players.length) room.players = active;
  return room.players.length;
}

function removeSocketFromRoom(socketId, room, notify) {
  const old = io.sockets.sockets.get(socketId);
  if (old) { old.leave(room.code); socketToRoom.delete(socketId); }
  room.players = room.players.filter(p => p.id !== socketId);
  if (room.players.length === 0) delete rooms[room.code];
  else if (notify && room.started && !room.finished) io.to(room.code).emit('playerLeft');
  emitRoomState(room);
}

function detachSocket(socket, notify) {
  const code = socketToRoom.get(socket.id);
  if (!code) return;
  const room = rooms[code];
  if (room) removeSocketFromRoom(socket.id, room, notify);
  else socketToRoom.delete(socket.id);
}

function startGame(room) {
  if (room.started || room.finished || room.players.length !== 2) return;
  const randomTask = TASKS[Math.floor(Math.random() * TASKS.length)];
  room.currentTask = randomTask;
  room.started = true;
  room.startTime = Date.now();
  room.progress = {};
  io.to(room.code).emit('gameStart', {
    roomCode: room.code,
    task: randomTask,
    taskUrl: `/tasks/${randomTask}`,
    timeLimit: room.timeLimit,
    players: room.players.map(p => ({ id: p.id, name: p.name }))
  });
  emitRoomState(room);
  console.log(`[${room.code}] Игра началась. Задание: ${randomTask}`);
}

function replacePlayerSocket(room, oldId, newSocket) {
  const old = io.sockets.sockets.get(oldId);
  if (old) { old.leave(room.code); socketToRoom.delete(oldId); }
  const p = room.players.find(p => p.id === oldId);
  if (p) p.id = newSocket.id;
  newSocket.join(room.code);
  socketToRoom.set(newSocket.id, room.code);
}

function joinWaitingRoom(socket, code, name, token, callback) {
  let room = rooms[code];
  if (!room) return callback({ success: false, message: 'Комната не найдена' });
  pruneDeadPlayers(room);
  if (room.players.length === 0) { delete rooms[code]; return callback({ success: false, message: 'Комната удалена' }); }
  if (room.started) return callback({ success: false, message: 'Игра уже идёт' });
  if (room.finished) return callback({ success: false, message: 'Игра завершена' });
  detachSocket(socket, true);
  if (room.players.some(p => p.id === socket.id)) {
    const p = room.players.find(p => p.id === socket.id);
    p.name = cleanName(name);
    if (token) p.token = token;
    socket.join(code); socketToRoom.set(socket.id, code);
    callback({ success: true, roomCode: code, state: buildRoomState(room) });
    emitRoomState(room);
    return;
  }
  const sameIdx = token ? room.players.findIndex(p => p.token === token) : -1;
  if (sameIdx !== -1) {
    replacePlayerSocket(room, room.players[sameIdx].id, socket);
    room.players[sameIdx].name = cleanName(name);
    callback({ success: true, roomCode: code, state: buildRoomState(room) });
    emitRoomState(room);
    return;
  }
  if (room.players.length >= 2) return callback({ success: false, message: 'Комната заполнена' });
  room.players.push({ id: socket.id, name: cleanName(name), token });
  socket.join(code); socketToRoom.set(socket.id, code);
  callback({ success: true, roomCode: code, state: buildRoomState(room) });
  if (room.players.length === 2) startGame(room);
  else emitRoomState(room);
}

function syncRoom(socket, code, name, token, callback) {
  let room = rooms[code];
  if (!room) return callback({ success: false, message: 'Комната не найдена' });
  pruneDeadPlayers(room);
  if (room.players.length === 0) { delete rooms[code]; return callback({ success: false, message: 'Комната не найдена' }); }
  const cleanNameVal = cleanName(name);
  const cleanTokenVal = cleanToken(token);
  const curCode = socketToRoom.get(socket.id);
  if (curCode && curCode !== code) detachSocket(socket, true);
  if (room.started || room.finished) {
    const exist = room.players.findIndex(p => p.id === socket.id);
    if (exist !== -1) {
      room.players[exist].name = cleanNameVal;
      if (cleanTokenVal) room.players[exist].token = cleanTokenVal;
      socket.join(code); socketToRoom.set(socket.id, code);
      return callback({ success: true, roomCode: code, state: buildRoomState(room) });
    }
    const same = cleanTokenVal ? room.players.findIndex(p => p.token === cleanTokenVal) : -1;
    if (same !== -1) {
      replacePlayerSocket(room, room.players[same].id, socket);
      room.players[same].name = cleanNameVal;
      return callback({ success: true, roomCode: code, state: buildRoomState(room) });
    }
    return callback({ success: false, message: room.finished ? 'Игра завершена' : 'Игра уже идёт' });
  }
  if (room.players.some(p => p.id === socket.id)) {
    const p = room.players.find(p => p.id === socket.id);
    p.name = cleanNameVal;
    if (cleanTokenVal) p.token = cleanTokenVal;
    socket.join(code); socketToRoom.set(socket.id, code);
    callback({ success: true, roomCode: code, state: buildRoomState(room) });
    emitRoomState(room);
    return;
  }
  const sameIdx = cleanTokenVal ? room.players.findIndex(p => p.token === cleanTokenVal) : -1;
  if (sameIdx !== -1) {
    replacePlayerSocket(room, room.players[sameIdx].id, socket);
    room.players[sameIdx].name = cleanNameVal;
    callback({ success: true, roomCode: code, state: buildRoomState(room) });
    emitRoomState(room);
    return;
  }
  if (room.players.length >= 2) return callback({ success: false, message: 'Комната заполнена' });
  room.players.push({ id: socket.id, name: cleanNameVal, token: cleanTokenVal });
  socket.join(code); socketToRoom.set(socket.id, code);
  callback({ success: true, roomCode: code, state: buildRoomState(room) });
  if (room.players.length === 2) startGame(room);
  else emitRoomState(room);
}

function generateRoomCode() { let c; do { c = Math.floor(10000+Math.random()*90000).toString(); } while(rooms[c]); return c; }

io.on('connection', (socket) => {
  socket.on('createRoom', ({ name, token, timeLimit }, cb) => {
    detachSocket(socket, true);
    const code = generateRoomCode();
    rooms[code] = {
      code,
      players: [{ id: socket.id, name: cleanName(name), token: cleanToken(token) }],
      started: false, finished: false, createdAt: Date.now(),
      timeLimit: timeLimit || 600, progress: {}, currentTask: null
    };
    socket.join(code); socketToRoom.set(socket.id, code);
    cb({ success: true, roomCode: code, state: buildRoomState(rooms[code]) });
  });
  socket.on('joinRoom', ({ code, name, token }, cb) => joinWaitingRoom(socket, String(code).trim(), name, token, cb));
  socket.on('syncRoom', ({ code, name, token }, cb) => syncRoom(socket, String(code).trim(), name, token, cb));
  socket.on('chatMessage', ({ roomCode, text }) => {
    const room = rooms[roomCode];
    if (!room) return;
    const sender = room.players.find(p => p.id === socket.id)?.name || 'Аноним';
    io.to(roomCode).emit('chatMessage', { sender, text });
  });
  socket.on('submit', ({ roomCode, similarity }) => {
    const room = rooms[roomCode];
    if (!room || !room.started || room.finished || room.players.length !== 2) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    const score = Number(similarity);
    if (isNaN(score)) return;
    room.progress[player.id] = Math.min(100, Math.max(0, score));
    io.to(roomCode).emit('progressUpdate', { roomCode, progress: room.progress, players: room.players });
    
    // ИЗМЕНЕНО: порог 85%
    if (score >= 85) {
      room.finished = true;
      room.winner = socket.id;
      room.winnerName = player.name;
      const loser = room.players.find(p => p.id !== socket.id);
      const { winnerGain, loserGain } = updateRating(player.name, loser.name, player.token, loser.token);
      io.to(roomCode).emit('gameOver', {
        roomCode, winner: socket.id, winnerName: player.name,
        loserName: loser.name, ratingGain: winnerGain, message: `${player.name} выиграл!`
      });
      emitRoomState(room);
    } else {
      socket.emit('submitResult', { 
        success: false, 
        similarity: Math.round(score), 
        message: `Схожесть ${Math.round(score)}% (нужно ≥85%)` 
      });
    }
  });
  socket.on('disconnect', () => detachSocket(socket, true));
});

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of Object.entries(rooms)) {
    if (!room.started && now - room.createdAt > 30*60*1000) delete rooms[code];
  }
}, 60000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Сервер на ${PORT}`));