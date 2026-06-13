const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.set('trust proxy', 1);
app.use(express.static('public'));
app.use('/tasks', express.static('tasks'));

app.get('/room', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'room.html'));
});

const rooms = {};
const socketToRoom = new Map();

function cleanName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').slice(0, 30) || 'Игрок';
}

function cleanToken(token) {
  return typeof token === 'string' && token.length > 0 && token.length <= 128 ? token : null;
}

function buildRoomState(room) {
  return {
    roomCode: room.code,
    players: room.players.map(p => ({ id: p.id, name: p.name })),
    started: room.started,
    finished: room.finished,
    winner: room.winner || null,
    winnerName: room.winnerName || null
  };
}

function emitRoomState(room) {
  io.to(room.code).emit('roomState', buildRoomState(room));
}

function pruneDeadPlayers(room) {
  const active = room.players.filter(p => {
    const sock = io.sockets.sockets.get(p.id);
    return sock && sock.connected;
  });
  if (active.length !== room.players.length) {
    room.players = active;
    return true;
  }
  return false;
}

function removeSocketFromRoom(socketId, room, notify) {
  const old = io.sockets.sockets.get(socketId);
  if (old) {
    old.leave(room.code);
    socketToRoom.delete(socketId);
  }
  const idx = room.players.findIndex(p => p.id === socketId);
  if (idx !== -1) room.players.splice(idx, 1);
  if (room.players.length === 0) {
    delete rooms[room.code];
    return;
  }
  if (notify && room.started && !room.finished) io.to(room.code).emit('playerLeft');
  emitRoomState(room);
}

function detachSocket(socket, notify = true) {
  const code = socketToRoom.get(socket.id);
  if (!code) return;
  const room = rooms[code];
  if (!room) {
    socketToRoom.delete(socket.id);
    return;
  }
  removeSocketFromRoom(socket.id, room, notify);
}

function startGame(room) {
  if (room.started || room.finished || room.players.length !== 2) return;
  room.started = true;
  io.to(room.code).emit('gameStart', {
    roomCode: room.code,
    task: 'task1',
    players: room.players.map(p => ({ id: p.id, name: p.name }))
  });
  emitRoomState(room);
}

function replacePlayerSocket(room, oldId, newSocket) {
  const old = io.sockets.sockets.get(oldId);
  if (old) {
    old.leave(room.code);
    socketToRoom.delete(oldId);
  }
  const player = room.players.find(p => p.id === oldId);
  if (player) player.id = newSocket.id;
  newSocket.join(room.code);
  socketToRoom.set(newSocket.id, room.code);
}

function joinWaitingRoom(socket, code, name, token, callback) {
  const room = rooms[code];
  if (!room) return callback({ success: false, message: 'Комната не найдена' });
  pruneDeadPlayers(room);
  if (room.players.length === 0) {
    delete rooms[code];
    return callback({ success: false, message: 'Комната не найдена' });
  }
  if (room.started) return callback({ success: false, message: 'Игра уже идёт' });
  if (room.finished) return callback({ success: false, message: 'Игра завершена' });
  detachSocket(socket, true);
  if (room.players.some(p => p.id === socket.id)) {
    const p = room.players.find(p => p.id === socket.id);
    p.name = cleanName(name);
    if (token) p.token = token;
    socket.join(code);
    socketToRoom.set(socket.id, code);
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
  if (room.players.length >= 2) {
    return callback({ success: false, message: 'Комната заполнена' });
  }
  room.players.push({ id: socket.id, name: cleanName(name), token });
  socket.join(code);
  socketToRoom.set(socket.id, code);
  callback({ success: true, roomCode: code, state: buildRoomState(room) });
  if (room.players.length === 2) startGame(room);
  else emitRoomState(room);
}

function syncRoom(socket, code, name, token, callback) {
  const room = rooms[code];
  if (!room) return callback({ success: false, message: 'Комната не найдена' });
  pruneDeadPlayers(room);
  if (room.players.length === 0) {
    delete rooms[code];
    return callback({ success: false, message: 'Комната не найдена' });
  }
  const cleanNameVal = cleanName(name);
  const cleanTokenVal = cleanToken(token);
  const curCode = socketToRoom.get(socket.id);
  if (curCode && curCode !== code) detachSocket(socket, true);
  if (room.started || room.finished) {
    const exist = room.players.findIndex(p => p.id === socket.id);
    if (exist !== -1) {
      room.players[exist].name = cleanNameVal;
      if (cleanTokenVal) room.players[exist].token = cleanTokenVal;
      socket.join(code);
      socketToRoom.set(socket.id, code);
      callback({ success: true, roomCode: code, state: buildRoomState(room) });
      return;
    }
    const same = cleanTokenVal ? room.players.findIndex(p => p.token === cleanTokenVal) : -1;
    if (same !== -1) {
      replacePlayerSocket(room, room.players[same].id, socket);
      room.players[same].name = cleanNameVal;
      callback({ success: true, roomCode: code, state: buildRoomState(room) });
      emitRoomState(room);
      return;
    }
    return callback({ success: false, message: room.finished ? 'Игра завершена' : 'Игра уже идёт' });
  }
  if (room.players.some(p => p.id === socket.id)) {
    const p = room.players.find(p => p.id === socket.id);
    p.name = cleanNameVal;
    if (cleanTokenVal) p.token = cleanTokenVal;
    socket.join(code);
    socketToRoom.set(socket.id, code);
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
  if (room.players.length >= 2) {
    return callback({ success: false, message: 'Комната заполнена' });
  }
  room.players.push({ id: socket.id, name: cleanNameVal, token: cleanTokenVal });
  socket.join(code);
  socketToRoom.set(socket.id, code);
  callback({ success: true, roomCode: code, state: buildRoomState(room) });
  if (room.players.length === 2) startGame(room);
  else emitRoomState(room);
}

function generateRoomCode() {
  let code;
  do { code = Math.floor(10000 + Math.random() * 90000).toString(); } while (rooms[code]);
  return code;
}

io.on('connection', (socket) => {
  socket.on('createRoom', ({ name, token }, cb) => {
    detachSocket(socket, true);
    const code = generateRoomCode();
    rooms[code] = {
      code,
      players: [{ id: socket.id, name: cleanName(name), token: cleanToken(token) }],
      started: false,
      finished: false,
      createdAt: Date.now()
    };
    socket.join(code);
    socketToRoom.set(socket.id, code);
    cb({ success: true, roomCode: code, state: buildRoomState(rooms[code]) });
  });
  socket.on('joinRoom', ({ code, name, token }, cb) => {
    joinWaitingRoom(socket, String(code || '').trim(), name, token, cb);
  });
  socket.on('syncRoom', ({ code, name, token }, cb) => {
    syncRoom(socket, String(code || '').trim(), name, token, cb);
  });
  socket.on('submit', ({ roomCode, similarity }) => {
    const room = rooms[roomCode];
    if (!room || !room.started || room.finished || room.players.length < 2) return;
    if (!room.players.some(p => p.id === socket.id)) return;
    const score = Number(similarity);
    if (!Number.isFinite(score)) return;
    if (score >= 80) {
      room.finished = true;
      room.winner = socket.id;
      room.winnerName = room.players.find(p => p.id === socket.id).name;
      io.to(roomCode).emit('gameOver', {
        roomCode,
        winner: socket.id,
        winnerName: room.winnerName,
        loserName: room.players.find(p => p.id !== socket.id).name,
        message: `${room.winnerName} выиграл!`
      });
      emitRoomState(room);
    } else {
      socket.emit('submitResult', {
        success: false,
        similarity: Math.round(score),
        message: `Схожесть ${Math.round(score)}%. Нужно не менее 80%. Попробуйте ещё.`
      });
    }
  });
  socket.on('disconnect', () => detachSocket(socket, true));
});

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of Object.entries(rooms)) {
    if (!room.started && now - room.createdAt > 30 * 60 * 1000) delete rooms[code];
  }
}, 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Сервер запущен на порту ${PORT}`));