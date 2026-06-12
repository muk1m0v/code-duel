// client.js — добавлено отображение кода комнаты на странице битвы
const socket = io();

let currentRoomCode = null;
let mySocketId = null;
let gameActive = false;

socket.on('connect', () => {
  mySocketId = socket.id;
  if (document.getElementById('codeEditor')) {
    requestRoomSync();
  }
});

function getPlayerToken() {
  let token = sessionStorage.getItem('playerToken');
  if (!token) {
    token = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    sessionStorage.setItem('playerToken', token);
  }
  return token;
}

// --- ЛОГИКА ГЛАВНОЙ СТРАНИЦЫ ---
if (document.getElementById('createRoomBtn')) {
  const nameInput = document.getElementById('playerName');
  const nameError = document.getElementById('nameError');
  const playerToken = getPlayerToken();

  function isValidName(name) {
    return name.trim().length > 0 && name.trim().length <= 15 && /^[a-zA-Zа-яА-ЯЁё0-9\s_-]+$/i.test(name.trim());
  }

  nameInput.addEventListener('input', () => {
    const val = nameInput.value;
    if (val && !isValidName(val)) {
      nameError.style.display = 'block';
      nameInput.style.borderColor = '#e74c3c';
    } else {
      nameError.style.display = 'none';
      nameInput.style.borderColor = '#555';
    }
  });

  document.getElementById('createRoomBtn').onclick = () => {
    const name = nameInput.value.trim();
    if (!isValidName(name)) {
      nameError.style.display = 'block';
      nameInput.style.borderColor = '#e74c3c';
      nameInput.focus();
      return;
    }

    sessionStorage.setItem('playerName', name);
    socket.emit('createRoom', { name, token: playerToken }, (res) => {
      if (res && res.success) {
        currentRoomCode = res.roomCode;
        sessionStorage.setItem('roomCode', currentRoomCode);
        window.location.href = '/room';
      } else {
        document.getElementById('errorMsg').textContent = res ? res.message : 'Ошибка создания комнаты';
      }
    });
  };

  document.getElementById('joinRoomBtn').onclick = () => {
    const code = document.getElementById('joinCodeInput').value.trim();
    const name = nameInput.value.trim();
    if (!code) {
      document.getElementById('errorMsg').textContent = 'Введите код комнаты';
      return;
    }
    if (!isValidName(name)) {
      nameError.style.display = 'block';
      nameInput.style.borderColor = '#e74c3c';
      nameInput.focus();
      return;
    }

    sessionStorage.setItem('playerName', name);
    socket.emit('joinRoom', { code, name, token: playerToken }, (res) => {
      if (res && res.success) {
        currentRoomCode = code;
        sessionStorage.setItem('roomCode', code);
        window.location.href = '/room';
      } else {
        document.getElementById('errorMsg').textContent = res ? res.message : 'Ошибка подключения';
      }
    });
  };
}

// --- ЛОГИКА СТРАНИЦЫ КОМНАТЫ ---
if (document.getElementById('codeEditor')) {
  const roomCode = sessionStorage.getItem('roomCode');
  const myName = sessionStorage.getItem('playerName') || 'Я';
  const playerToken = getPlayerToken();

  if (roomCode) {
    currentRoomCode = roomCode;

    // Показываем код комнаты рядом с кнопкой
    const roomCodeSpan = document.getElementById('roomCodeValue');
    if (roomCodeSpan) {
      roomCodeSpan.textContent = roomCode;
    }

    const editor = document.getElementById('codeEditor');
    const previewFrame = document.getElementById('previewFrame');
    const taskFrame = document.getElementById('taskFrame');
    const submitBtn = document.getElementById('submitBtn');
    const overlay = document.getElementById('overlay');
    const overlayMsg = document.getElementById('overlayMsg');
    const myNameSpan = document.getElementById('myName');
    const opponentNameSpan = document.getElementById('opponentName');

    myNameSpan.textContent = myName;
    gameActive = false;
    submitBtn.disabled = true;

    let previewTimeout = null;

    editor.addEventListener('input', () => {
      clearTimeout(previewTimeout);
      previewTimeout = setTimeout(() => {
        updatePreview();
      }, 300);
    });

    editor.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = editor.selectionStart;
        const end = editor.selectionEnd;
        editor.value = editor.value.substring(0, start) + '  ' + editor.value.substring(end);
        editor.selectionStart = editor.selectionEnd = start + 2;
        updatePreview();
      }
    });

    function updatePreview() {
      previewFrame.srcdoc = editor.value;
    }

    function startGame() {
      if (gameActive) return;
      gameActive = true;
      taskFrame.src = '/tasks/task1.html';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Готово';
      editor.focus();
      updatePreview();
    }

    function applyRoomState(state) {
      if (!state) return;

      const opponent = mySocketId
        ? state.players.find(player => player.id !== mySocketId)
        : null;

      opponentNameSpan.textContent = opponent
        ? opponent.name
        : (state.players.length > 1 ? 'Противник' : 'Ожидание...');

      if (state.started && !state.finished && state.players.length === 2) {
        startGame();
      }

      if (state.finished) {
        gameActive = false;
        submitBtn.disabled = true;
      }
    }

    let roomSyncRequested = false;
    function requestRoomSync() {
      if (roomSyncRequested) return;
      roomSyncRequested = true;

      socket.emit('syncRoom', { code: currentRoomCode, name: myName, token: playerToken }, (res) => {
        if (res && res.success) {
          currentRoomCode = res.roomCode || currentRoomCode;
          applyRoomState(res.state);
        } else {
          showNotification(res ? res.message : 'Не удалось подключиться к комнате');
          submitBtn.disabled = true;
        }
        roomSyncRequested = false;
      });
    }

    if (socket.connected) {
      requestRoomSync();
    }

    socket.on('roomState', (state) => {
      if (state.roomCode !== currentRoomCode) return;
      applyRoomState(state);
    });

    socket.on('gameStart', (data) => {
      if (data.roomCode && data.roomCode !== currentRoomCode) return;
      const opponent = data.players.find(player => player.id !== mySocketId);
      opponentNameSpan.textContent = opponent ? opponent.name : 'Противник';
      startGame();
    });

    socket.on('submitResult', (res) => {
      if (!res.success) {
        showNotification(res.message);
        submitBtn.disabled = false;
      }
    });

    socket.on('gameOver', (data) => {
      if (data.roomCode && data.roomCode !== currentRoomCode) return;

      gameActive = false;
      overlay.style.display = 'flex';
      const isWinner = data.winner === mySocketId;
      overlayMsg.innerHTML = isWinner
        ? '<div style="font-size:3rem;">🎉</div><div>Вы выиграли!</div>'
        : `<div style="font-size:3rem;">😔</div><div>Победил: <span style="color:#888;">${data.winnerName}</span></div>`;
      submitBtn.disabled = true;
    });

    socket.on('playerLeft', () => {
      gameActive = false;
      overlay.style.display = 'flex';
      overlayMsg.innerHTML = '<div style="font-size:3rem;">👋</div><div>Соперник покинул игру</div>';
      submitBtn.disabled = true;
    });

    submitBtn.addEventListener('click', async () => {
      if (!gameActive) return;
      submitBtn.disabled = true;
      submitBtn.textContent = 'Проверка...';

      try {
        const similarity = await comparePreviews();
        socket.emit('submit', { roomCode: currentRoomCode, similarity: Math.round(similarity) });
      } catch (err) {
        showNotification('Ошибка сравнения. Попробуйте ещё раз.');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Готово';
      }
    });

    document.getElementById('okBtn').addEventListener('click', () => {
      window.location.href = '/';
    });

    function showNotification(msg) {
      const notif = document.createElement('div');
      notif.style.cssText = `
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: #333;
        color: #fff;
        padding: 12px 24px;
        border-radius: 6px;
        font-size: 14px;
        z-index: 1000;
        border: 1px solid #555;
        animation: fadeIn 0.3s ease;
      `;
      notif.textContent = msg;
      document.body.appendChild(notif);
      setTimeout(() => notif.remove(), 3000);
    }

    async function comparePreviews() {
      const taskFrameEl = document.getElementById('taskFrame');
      const previewFrameEl = document.getElementById('previewFrame');

      await new Promise(resolve => setTimeout(resolve, 100));

      if (!window.html2canvas) {
        throw new Error('html2canvas is not loaded');
      }

      const [taskCanvas, previewCanvas] = await Promise.all([
        html2canvas(taskFrameEl.contentDocument ? taskFrameEl.contentDocument.body : taskFrameEl, {
          useCORS: true,
          scale: 1,
          backgroundColor: '#ffffff'
        }),
        html2canvas(previewFrameEl.contentDocument ? previewFrameEl.contentDocument.body : previewFrameEl, {
          useCORS: true,
          scale: 1,
          backgroundColor: '#ffffff'
        })
      ]);

      const width = Math.min(taskCanvas.width, previewCanvas.width);
      const height = Math.min(taskCanvas.height, previewCanvas.height);

      if (width <= 0 || height <= 0) {
        throw new Error('empty preview');
      }

      const taskCtx = taskCanvas.getContext('2d');
      const previewCtx = previewCanvas.getContext('2d');
      const taskData = taskCtx.getImageData(0, 0, width, height).data;
      const previewData = previewCtx.getImageData(0, 0, width, height).data;

      let matched = 0;
      const totalPixels = width * height;
      const threshold = 35;

      for (let i = 0; i < taskData.length; i += 4) {
        const dr = Math.abs(taskData[i] - previewData[i]);
        const dg = Math.abs(taskData[i + 1] - previewData[i + 1]);
        const db = Math.abs(taskData[i + 2] - previewData[i + 2]);
        if (dr + dg + db < threshold * 3) {
          matched++;
        }
      }

      return (matched / totalPixels) * 100;
    }

    updatePreview();
  }
}