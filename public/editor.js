const socket = io();

let currentRoomCode = null;
let mySocketId = null;
let gameActive = false;
let currentLang = 'html';
let htmlCode = '', cssCode = '';
let timerInterval = null;
let totalTimeSeconds = 0;
let showingMyCode = false;

socket.on('connect', () => {
  mySocketId = socket.id;
  requestRoomSync();
});

function getPlayerToken() {
  let token = sessionStorage.getItem('playerToken');
  if (!token) {
    token = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    sessionStorage.setItem('playerToken', token);
  }
  return token;
}

const roomCode = sessionStorage.getItem('roomCode');
const myName = sessionStorage.getItem('playerName') || 'Я';
const playerToken = getPlayerToken();

if (roomCode) {
  currentRoomCode = roomCode;
  document.getElementById('roomCodeValue').textContent = roomCode;

  const editor = document.getElementById('codeEditor');
  const previewFrame = document.getElementById('previewFrame');
  const taskFrame = document.getElementById('taskFrame');
  const targetFrame = document.getElementById('targetFrame');
  const submitBtn = document.getElementById('submitBtn');
  const overlay = document.getElementById('overlay');
  const overlayMsg = document.getElementById('overlayMsg');
  const myNameSpan = document.getElementById('myName');
  const opponentNameSpan = document.getElementById('opponentName');
  const timerDisplay = document.getElementById('timerDisplay');
  const chatBtn = document.getElementById('chatBtn');
  const chatModal = document.getElementById('chatModal');
  const closeChatBtn = document.getElementById('closeChatBtn');
  const sendChatBtn = document.getElementById('sendChatBtn');
  const chatInput = document.getElementById('chatInput');
  const chatMessages = document.getElementById('chatMessages');
  const viewBtn = document.getElementById('viewBtn');

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

  // Кнопка View
  viewBtn.addEventListener('click', () => {
    if (!gameActive) return;
    showingMyCode = !showingMyCode;
    if (showingMyCode) {
      const full = generateFullHTML(htmlCode, cssCode);
      taskFrame.srcdoc = full;
      viewBtn.textContent = 'Задание';
    } else {
      const currentSrc = taskFrame.getAttribute('data-original-src');
      if (currentSrc) taskFrame.src = currentSrc;
      else taskFrame.src = `/tasks/${window.currentTask || 'task1.html'}`;
      viewBtn.textContent = 'View';
    }
  });

  function generateFullHTML(html, css) {
    return `<!DOCTYPE html><html><head><style>${css}</style></head><body>${html}</body></html>`;
  }

  function updatePreview() {
    const full = generateFullHTML(htmlCode, cssCode);
    previewFrame.srcdoc = full;
    if (showingMyCode && gameActive) {
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
    showingMyCode = false;
    viewBtn.textContent = 'View';
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
      if (state.currentTask && taskFrame.src.indexOf(state.currentTask) === -1) {
        const taskUrl = `/tasks/${state.currentTask}`;
        taskFrame.src = taskUrl;
        taskFrame.setAttribute('data-original-src', taskUrl);
        targetFrame.src = taskUrl;
        window.currentTask = state.currentTask;
      }
      startGame();
    }
    if (state.finished) {
      gameActive = false;
      submitBtn.disabled = true;
      if (timerInterval) clearInterval(timerInterval);
    }
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
    const taskUrl = data.taskUrl;
    taskFrame.src = taskUrl;
    taskFrame.setAttribute('data-original-src', taskUrl);
    targetFrame.src = taskUrl;
    window.currentTask = data.task;
    startGame();
  });
  socket.on('submitResult', (res) => {
    if (!res.success) {
      showNotification(res.message);
      submitBtn.disabled = false;
      submitBtn.textContent = 'Готово';
    }
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

  // Инициализация
  htmlCode = '';
  cssCode = '';
  editor.value = '';
  updatePreview();
}