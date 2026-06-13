// server.js – добавлена более агрессивная чистка мёртвых игроков
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
    players: room.players.map(player => ({ id: player.id, name: player.name })),
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
  const activePlayers = room.players.filter(p => {
    const sock = io.sockets.sockets.get(p.id);
    return sock && sock.connected;
  });
  if (activePlayers.length !== room.players.length) {
    console.log(`[${room.code}] Удалены мёртвые игроки: было ${room.players.length}, стало ${activePlayers.length}`);
    room.players = activePlayers;
    return true;
  }
  return false;
}

function removeSocketFromRoom(socketId, room, notify) {
  const oldSocket = io.sockets.sockets.get(socketId);
  if (oldSocket) {
    oldSocket.leave(room.code);
    socketToRoom.delete(socketId);
  }

  const playerIndex = room.players.findIndex(player => player.id === socketId);
  if (playerIndex !== -1) {
    room.players.splice(playerIndex, 1);
  }

  if (room.players.length === 0) {
    delete rooms[room.code];
    console.log(`[${room.code}] Комната удалена (пуста)`);
    return;
  }

  if (notify && room.started && !room.finished) {
    io.to(room.code).emit('playerLeft');
  }

  emitRoomState(room);
}

function detachSocket(socket, notify = true) {
  const roomCode = socketToRoom.get(socket.id);
  if (!roomCode) return;

  const room = rooms[roomCode];
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
    players: room.players.map(player => ({ id: player.id, name: player.name }))
  });
  emitRoomState(room);
  console.log(`[${room.code}] Игра началась между ${room.players.map(p => p.name).join(' и ')}`);
}

function replacePlayerSocket(room, oldPlayerId, newSocket) {
  const oldSocket = io.sockets.sockets.get(oldPlayerId);
  if (oldSocket) {
    oldSocket.leave(room.code);
    socketToRoom.delete(oldPlayerId);
  }

  const player = room.players.find(item => item.id === oldPlayerId);
  if (player) {
    player.id = newSocket.id;
  }

  newSocket.join(room.code);
  socketToRoom.set(newSocket.id, room.code);
}

function joinWaitingRoom(socket, code, name, token, callback) {
  const room = rooms[code];
  if (!room) return callback({ success: false, message: 'Комната не найдена' });
  
  // Жёсткая чистка перед проверкой
  pruneDeadPlayers(room);
  if (room.players.length === 0) {
    delete rooms[code];
    return callback({ success: false, message: 'Комната не найдена' });
  }
  
  if (room.started) return callback({ success: false, message: 'Игра уже идёт' });
  if (room.finished) return callback({ success: false, message: 'Игра завершена' });

  detachSocket(socket, true);

  // игрок уже есть по сокету
  if (room.players.some(player => player.id === socket.id)) {
    const player = room.players.find(item => item.id === socket.id);
    player.name = cleanName(name);
    if (token) player.token = token;
    socket.join(code);
    socketToRoom.set(socket.id, code);
    callback({ success: true, roomCode: code, state: buildRoomState(room) });
    emitRoomState(room);
    return;
  }

  // повторное подключение по токену
  const samePlayerIndex = token
    ? room.players.findIndex(player => player.token === token)
    : -1;

  if (samePlayerIndex !== -1) {
    replacePlayerSocket(room, room.players[samePlayerIndex].id, socket);
    room.players[samePlayerIndex].name = cleanName(name);
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
  console.log(`[${room.code}] Игрок ${name} присоединился. Всего: ${room.players.length}`);

  if (room.players.length === 2) {
    startGame(room);
  } else {
    emitRoomState(room);
  }
}

function syncRoom(socket, code, name, token, callback) {
  const room = rooms[code];
  if (!room) return callback({ success: false, message: 'Комната не найдена' });

  pruneDeadPlayers(room);
  if (room.players.length === 0) {
    delete rooms[code];
    return callback({ success: false, message: 'Комната не найдена' });
  }

  const cleanPlayerName = cleanName(name);
  const cleanPlayerToken = cleanToken(token);
  const currentRoomCode = socketToRoom.get(socket.id);

  if (currentRoomCode && currentRoomCode !== code) {
    detachSocket(socket, true);
  }

  if (room.started || room.finished) {
    const existingIndex = room.players.findIndex(player => player.id === socket.id);
    if (existingIndex !== -1) {
      room.players[existingIndex].name = cleanPlayerName;
      if (cleanPlayerToken) room.players[existingIndex].token = cleanPlayerToken;
      socket.join(code);
      socketToRoom.set(socket.id, code);
      callback({ success: true, roomCode: code, state: buildRoomState(room) });
      return;
    }

    const samePlayerIndex = cleanPlayerToken
      ? room.players.findIndex(player => player.token === cleanPlayerToken)
      : -1;

    if (samePlayerIndex !== -1) {
      replacePlayerSocket(room, room.players[samePlayerIndex].id, socket);
      room.players[samePlayerIndex].name = cleanPlayerName;
      callback({ success: true, roomCode: code, state: buildRoomState(room) });
      emitRoomState(room);
      return;
    }

    return callback({
      success: false,
      message: room.finished ? 'Игра завершена' : 'Игра уже идёт'
    });
  }

  if (room.players.some(player => player.id === socket.id)) {
    const player = room.players.find(item => item.id === socket.id);
    player.name = cleanPlayerName;
    if (cleanPlayerToken) player.token = cleanPlayerToken;
    socket.join(code);
    socketToRoom.set(socket.id, code);
    callback({ success: true, roomCode: code, state: buildRoomState(room) });
    emitRoomState(room);
    return;
  }

  const samePlayerIndex = cleanPlayerToken
    ? room.players.findIndex(player => player.token === cleanPlayerToken)
    : -1;

  if (samePlayerIndex !== -1) {
    replacePlayerSocket(room, room.players[samePlayerIndex].id, socket);
    room.players[samePlayerIndex].name = cleanPlayerName;
    callback({ success: true, roomCode: code, state: buildRoomState(room) });
    emitRoomState(room);
    return;
  }

  if (room.players.length >= 2) {
    return callback({ success: false, message: 'Комната заполнена' });
  }

  room.players.push({ id: socket.id, name: cleanPlayerName, token: cleanPlayerToken });
  socket.join(code);
  socketToRoom.set(socket.id, code);

  callback({ success: true, roomCode: code, state: buildRoomState(room) });

  if (room.players.length === 2) {
    startGame(room);
  } else {
    emitRoomState(room);
  }
}

function generateRoomCode() {
  let code;
  do {
    code = Math.floor(10000 + Math.random() * 90000).toString();
  } while (rooms[code]);
  return code;
}

io.on('connection', (socket) => {
  console.log(`Подключился: ${socket.id}`);

  socket.on('createRoom', ({ name, token }, callback) => {
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

    console.log(`[${code}] Создана комната, игрок: ${name}`);
    callback({ success: true, roomCode: code, state: buildRoomState(rooms[code]) });
  });

  socket.on('joinRoom', ({ code, name, token }, callback) => {
    const roomCode = String(code || '').trim();
    console.log(`joinRoom: ${roomCode}, name: ${name}`);
    joinWaitingRoom(socket, roomCode, name, token, callback);
  });

  socket.on('syncRoom', ({ code, name, token }, callback) => {
    const roomCode = String(code || '').trim();
    console.log(`syncRoom: ${roomCode}, name: ${name}`);
    syncRoom(socket, roomCode, name, token, callback);
  });

  socket.on('submit', (data) => {
    const { roomCode, similarity } = data || {};
    const room = rooms[roomCode];
    if (!room || !room.started || room.finished || room.players.length < 2) return;
    if (!room.players.some(player => player.id === socket.id)) return;

    const score = Number(similarity);
    if (!Number.isFinite(score)) return;

    console.log(`[${roomCode}] Результат от ${socket.id}: ${score}%`);

    if (score >= 80) {
      room.finished = true;
      room.winner = socket.id;
      room.winnerName = room.players.find(player => player.id === socket.id).name;

      io.to(roomCode).emit('gameOver', {
        roomCode,
        winner: socket.id,
        winnerName: room.winnerName,
        loserName: room.players.find(player => player.id !== socket.id).name,
        message: `${room.winnerName} выиграл!`
      });
      emitRoomState(room);
      console.log(`[${roomCode}] Победитель: ${room.winnerName}`);
    } else {
      socket.emit('submitResult', {
        success: false,
        similarity: Math.round(score),
        message: `Схожесть ${Math.round(score)}%. Нужно не менее 80%. Попробуйте ещё.`
      });
    }
  });

  socket.on('disconnect', () => {
    console.log(`Отключился: ${socket.id}`);
    detachSocket(socket, true);
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of Object.entries(rooms)) {
    if (!room.started && now - room.createdAt > 30 * 60 * 1000) {
      delete rooms[code];
      console.log(`[${code}] Удалена по таймауту`);
    }
  }
}, 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Сервер запущен на порту ${PORT}`));