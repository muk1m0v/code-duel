const socket = io();

let currentRoomCode = null;
let mySocketId = null;
let gameActive = false;
let currentLang = 'html'; // 'html' или 'css'
let htmlCode = '', cssCode = '';
let timerInterval = null;
let myProgress = 0;
let opponentProgress = 0;
let totalTimeSeconds = 0; // выбранное время в секундах

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

// --- ГЛАВНАЯ СТРАНИЦА ---
if (document.getElementById('createRoomBtn')) {
  const nameInput = document.getElementById('playerName');
  const nameError = document.getElementById('nameError');
  const timeSelect = document.getElementById('timeSelect');
  const playerToken = getPlayerToken();

  function isValidName(name) {
    return name.trim().length > 0 && name.trim().length <= 15 && /^[a-zA-Zа-яА-ЯЁё0-9\s_-]+$/i.test(name.trim());
  }

  nameInput.addEventListener('input', () => {
    const val = nameInput.value;
    if (val && !isValidName(val)) {
      nameError.style.display = 'block';
      nameInput.style.outlineColor = '#e74c3c';
    } else {
      nameError.style.display = 'none';
      nameInput.style.outlineColor = 'white';
    }
  });

  document.getElementById('createRoomBtn').onclick = () => {
    const name = nameInput.value.trim();
    if (!isValidName(name)) {
      nameError.style.display = 'block';
      nameInput.focus();
      return;
    }
    const timeMinutes = parseInt(timeSelect.value, 10);
    sessionStorage.setItem('playerName', name);
    sessionStorage.setItem('battleTime', timeMinutes);
    socket.emit('createRoom', { name, token: playerToken, timeLimit: timeMinutes * 60 }, (res) => {
      if (res && res.success) {
        currentRoomCode = res.roomCode;
        sessionStorage.setItem('roomCode', currentRoomCode);
        window.location.href = '/room';
      } else {
        document.getElementById('errorMsg').textContent = res ? res.message : 'Ошибка';
      }
    });
  };

  document.getElementById('joinRoomBtn').onclick = () => {
    const code = document.getElementById('joinCodeInput').value.trim();
    const name = nameInput.value.trim();
    if (!code) { document.getElementById('errorMsg').textContent = 'Введите код'; return; }
    if (!isValidName(name)) {
      nameError.style.display = 'block';
      nameInput.focus();
      return;
    }
    sessionStorage.setItem('playerName', name);
    socket.emit('joinRoom', { code, name, token: playerToken }, (res) => {
      if (res && res.success) {
        sessionStorage.setItem('roomCode', code);
        window.location.href = '/room';
      } else {
        document.getElementById('errorMsg').textContent = res ? res.message : 'Ошибка';
      }
    });
  };
}

// --- СТРАНИЦА КОМНАТЫ ---
if (document.getElementById('codeEditor')) {
  const roomCode = sessionStorage.getItem('roomCode');
  const myName = sessionStorage.getItem('playerName') || 'Я';
  const playerToken = getPlayerToken();

  if (roomCode) {
    currentRoomCode = roomCode;
    document.getElementById('roomCodeValue').textContent = roomCode;

    const editor = document.getElementById('codeEditor');
    const previewFrame = document.getElementById('previewFrame');
    const taskFrame = document.getElementById('taskFrame');
    const targetFrame = document.getElementById('targetFrame'); // эталон
    const submitBtn = document.getElementById('submitBtn');
    const overlay = document.getElementById('overlay');
    const overlayMsg = document.getElementById('overlayMsg');
    const myNameSpan = document.getElementById('myName');
    const opponentNameSpan = document.getElementById('opponentName');
    const timerDisplay = document.getElementById('timerDisplay');
    const myProgressFill = document.getElementById('myProgressFill');
    const opponentProgressFill = document.getElementById('opponentProgressFill');
    const myProgressLabel = document.getElementById('myProgressLabel');
    const opponentProgressLabel = document.getElementById('opponentProgressLabel');
    const chatBtn = document.getElementById('chatBtn');
    const chatModal = document.getElementById('chatModal');
    const closeChatBtn = document.getElementById('closeChatBtn');
    const sendChatBtn = document.getElementById('sendChatBtn');
    const chatInput = document.getElementById('chatInput');
    const chatMessages = document.getElementById('chatMessages');

    myNameSpan.textContent = myName;
    gameActive = false;
    submitBtn.disabled = true;

    // Переключение HTML/CSS
    const htmlTab = document.querySelector('.editor-tab[data-lang="html"]');
    const cssTab = document.querySelector('.editor-tab[data-lang="css"]');
    if (htmlTab && cssTab) {
      htmlTab.addEventListener('click', () => {
        currentLang = 'html';
        htmlTab.classList.add('active');
        cssTab.classList.remove('active');
        editor.value = htmlCode;
        updatePreview();
      });
      cssTab.addEventListener('click', () => {
        currentLang = 'css';
        cssTab.classList.add('active');
        htmlTab.classList.remove('active');
        editor.value = cssCode;
        updatePreview();
      });
    }

    // Переключение предпросмотра (Задание / Моё решение)
    const taskPreviewTab = document.querySelector('.preview-tab[data-preview="task"]');
    const myPreviewTab = document.querySelector('.preview-tab[data-preview="my"]');
    if (taskPreviewTab && myPreviewTab) {
      taskPreviewTab.addEventListener('click', () => {
        taskPreviewTab.classList.add('active');
        myPreviewTab.classList.remove('active');
        taskFrame.src = '/tasks/task1_desc.html';
      });
      myPreviewTab.addEventListener('click', () => {
        myPreviewTab.classList.add('active');
        taskPreviewTab.classList.remove('active');
        taskFrame.src = 'about:blank';
        setTimeout(() => {
          taskFrame.srcdoc = generateFullHTML(htmlCode, cssCode);
        }, 50);
      });
    }

    function generateFullHTML(html, css) {
      return `<!DOCTYPE html><html><head><style>${css}</style></head><body>${html}</body></html>`;
    }

    function updatePreview() {
      const full = generateFullHTML(htmlCode, cssCode);
      previewFrame.srcdoc = full;
      if (myPreviewTab && myPreviewTab.classList.contains('active')) {
        taskFrame.srcdoc = full;
      }
    }

    editor.addEventListener('input', () => {
      const val = editor.value;
      if (currentLang === 'html') htmlCode = val;
      else cssCode = val;
      updatePreview();
    });

    function startGame() {
      if (gameActive) return;
      gameActive = true;
      submitBtn.disabled = false;
      editor.focus();
      updatePreview();
      // Запуск таймера
      if (timerInterval) clearInterval(timerInterval);
      let remaining = totalTimeSeconds;
      updateTimerDisplay(remaining);
      timerInterval = setInterval(() => {
        if (!gameActive) return;
        remaining--;
        updateTimerDisplay(remaining);
        if (remaining <= 0) {
          clearInterval(timerInterval);
          gameActive = false;
          submitBtn.disabled = true;
          overlay.style.display = 'flex';
          overlayMsg.innerHTML = '<div>Время вышло! Ничья.</div>';
        }
      }, 1000);
    }

    function updateTimerDisplay(sec) {
      const mins = Math.floor(sec / 60);
      const secs = sec % 60;
      timerDisplay.textContent = `${mins.toString().padStart(2,'0')}:${secs.toString().padStart(2,'0')}`;
    }

    function applyRoomState(state) {
      if (!state) return;
      const opponent = mySocketId ? state.players.find(p => p.id !== mySocketId) : null;
      opponentNameSpan.textContent = opponent ? opponent.name : (state.players.length > 1 ? 'Противник' : 'Ожидание...');
      if (state.started && !state.finished && state.players.length === 2) {
        totalTimeSeconds = state.timeLimit || 600;
        startGame();
      }
      if (state.finished) {
        gameActive = false;
        submitBtn.disabled = true;
        if (timerInterval) clearInterval(timerInterval);
      }
      // Прогресс
      if (state.progress && opponent) {
        myProgress = state.progress[mySocketId] || 0;
        opponentProgress = state.progress[opponent.id] || 0;
        updateProgressBars();
      }
    }

    function updateProgressBars() {
      myProgressFill.style.width = `${myProgress}%`;
      myProgressLabel.textContent = `Я: ${Math.round(myProgress)}%`;
      opponentProgressFill.style.width = `${opponentProgress}%`;
      opponentProgressLabel.textContent = `Противник: ${Math.round(opponentProgress)}%`;
    }

    let roomSyncRequested = false;
    function requestRoomSync() {
      if (roomSyncRequested) return;
      roomSyncRequested = true;
      socket.emit('syncRoom', { code: currentRoomCode, name: myName, token: playerToken }, (res) => {
        if (res && res.success) {
          currentRoomCode = res.roomCode;
          if (res.state.timeLimit) totalTimeSeconds = res.state.timeLimit;
          applyRoomState(res.state);
        } else {
          showNotification(res ? res.message : 'Ошибка синхронизации');
        }
        roomSyncRequested = false;
      });
    }

    socket.on('connect', () => {
      mySocketId = socket.id;
      requestRoomSync();
    });
    if (socket.connected) requestRoomSync();

    socket.on('roomState', (state) => {
      if (state.roomCode !== currentRoomCode) return;
      applyRoomState(state);
    });
    socket.on('gameStart', (data) => {
      if (data.roomCode !== currentRoomCode) return;
      totalTimeSeconds = data.timeLimit;
      startGame();
    });
    socket.on('submitResult', (res) => {
      if (!res.success) {
        showNotification(res.message);
        submitBtn.disabled = false;
        submitBtn.textContent = 'Готово';
      }
    });
    socket.on('progressUpdate', (data) => {
      if (data.roomCode !== currentRoomCode) return;
      const opponent = data.players ? data.players.find(p => p.id !== mySocketId) : null;
      myProgress = data.progress[mySocketId] || 0;
      opponentProgress = opponent ? (data.progress[opponent.id] || 0) : 0;
      updateProgressBars();
    });
    socket.on('gameOver', (data) => {
      if (data.roomCode !== currentRoomCode) return;
      gameActive = false;
      if (timerInterval) clearInterval(timerInterval);
      overlay.style.display = 'flex';
      const isWinner = data.winner === mySocketId;
      if (isWinner) overlayMsg.innerHTML = `<div>🎉 Вы выиграли! +${data.ratingGain} очков рейтинга</div>`;
      else overlayMsg.innerHTML = `<div>😔 Победил: ${data.winnerName}. Вы получили +${data.ratingGain} очков</div>`;
      submitBtn.disabled = true;
    });
    socket.on('playerLeft', () => {
      gameActive = false;
      if (timerInterval) clearInterval(timerInterval);
      overlay.style.display = 'flex';
      overlayMsg.innerHTML = '<div>👋 Соперник покинул игру</div>';
      submitBtn.disabled = true;
    });
    socket.on('chatMessage', (msg) => {
      const msgDiv = document.createElement('div');
      msgDiv.className = 'chat-message';
      msgDiv.innerHTML = `<span class="name">${msg.sender}:</span> ${msg.text}`;
      chatMessages.appendChild(msgDiv);
      chatMessages.scrollTop = chatMessages.scrollHeight;
    });

    submitBtn.addEventListener('click', async () => {
      if (!gameActive) return;
      submitBtn.disabled = true;
      submitBtn.textContent = 'Проверка...';
      try {
        const similarity = await comparePreviews();
        socket.emit('submit', { roomCode: currentRoomCode, similarity: Math.round(similarity) });
      } catch (err) {
        console.error(err);
        showNotification('Ошибка сравнения. Попробуйте ещё раз.');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Готово';
      }
    });

    document.getElementById('okBtn').addEventListener('click', () => window.location.href = '/');

    // Чат
    if (chatBtn) {
      chatBtn.onclick = () => chatModal.style.display = 'flex';
      closeChatBtn.onclick = () => chatModal.style.display = 'none';
      sendChatBtn.onclick = () => {
        const text = chatInput.value.trim();
        if (text) {
          socket.emit('chatMessage', { roomCode: currentRoomCode, text });
          chatInput.value = '';
        }
      };
      chatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendChatBtn.click(); });
    }

    function showNotification(msg) {
      const div = document.createElement('div');
      div.textContent = msg;
      div.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#333;padding:10px 20px;border-radius:8px;z-index:1000;color:white;';
      document.body.appendChild(div);
      setTimeout(() => div.remove(), 3000);
    }

    async function comparePreviews() {
      // Ждём загрузки целевого iframe (эталон)
      if (!targetFrame.contentDocument || !targetFrame.contentDocument.body) {
        await new Promise(resolve => {
          targetFrame.addEventListener('load', resolve, { once: true });
        });
      }
      const previewDoc = previewFrame.contentDocument;
      if (!previewDoc || !previewDoc.body) throw new Error('Preview not ready');
      
      const targetCanvas = await html2canvas(targetFrame.contentDocument.body, { scale: 1, backgroundColor: '#ffffff' });
      const previewCanvas = await html2canvas(previewDoc.body, { scale: 1, backgroundColor: '#ffffff' });
      
      const w = Math.min(targetCanvas.width, previewCanvas.width);
      const h = Math.min(targetCanvas.height, previewCanvas.height);
      if (w <= 0 || h <= 0) throw new Error('Empty canvas');
      
      const targetData = targetCanvas.getContext('2d').getImageData(0,0,w,h).data;
      const previewData = previewCanvas.getContext('2d').getImageData(0,0,w,h).data;
      let match = 0;
      const threshold = 35;
      for (let i=0; i<targetData.length; i+=4) {
        const dr = Math.abs(targetData[i] - previewData[i]);
        const dg = Math.abs(targetData[i+1] - previewData[i+1]);
        const db = Math.abs(targetData[i+2] - previewData[i+2]);
        if (dr+dg+db < threshold*3) match++;
      }
      return (match / (w*h)) * 100;
    }

    // Инициализация редактора – пустые строки
    htmlCode = '';
    cssCode = '';
    editor.value = '';
    updatePreview();
  }
}