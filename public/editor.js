// editor.js — улучшенный редактор с подсказками, автозакрытием, нумерацией строк и синхронизацией таймера
const socket = io();

let currentRoomCode = null;
let mySocketId = null;
let gameActive = false;
let currentLang = 'html';
let htmlCode = '', cssCode = '';
let timerInterval = null;
let totalTimeSeconds = 0;
let showingMyCode = false;
let remainingTimeOnStart = null;

// Элементы
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
const lineNumbersDiv = document.getElementById('lineNumbers');
const suggestionsDiv = document.getElementById('suggestions');

// ---------- Офлайн-индикатор ----------
function initOfflineDetector() {
  const overlayDiv = document.createElement('div');
  overlayDiv.id = 'offlineOverlay';
  overlayDiv.className = 'offline-overlay';
  overlayDiv.innerHTML = '<div>🌐 Нет соединения с интернетом</div><div style="font-size:1rem;">Проверьте сеть</div>';
  document.body.appendChild(overlayDiv);
  function update() {
    overlayDiv.style.display = navigator.onLine ? 'none' : 'flex';
  }
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}
initOfflineDetector();

// ---------- Нумерация строк ----------
function updateLineNumbers() {
  const lines = editor.value.split('\n');
  const lineCount = lines.length;
  let numbers = '';
  for (let i = 1; i <= lineCount; i++) numbers += i + '\n';
  lineNumbersDiv.textContent = numbers;
  lineNumbersDiv.style.height = editor.scrollHeight + 'px';
}
editor.addEventListener('scroll', () => {
  lineNumbersDiv.scrollTop = editor.scrollTop;
});
editor.addEventListener('input', () => {
  updateLineNumbers();
  const val = editor.value;
  if (currentLang === 'html') htmlCode = val;
  else cssCode = val;
  updatePreview();
  handleAutoCloseTag();   // авто-закрытие тегов
  showSuggestions();      // вызов подсказок
});

// ---------- Автозакрытие тегов (HTML) ----------
let lastTypedChar = '';
editor.addEventListener('keydown', (e) => {
  if (e.key === '>' && currentLang === 'html') {
    const cursorPos = editor.selectionStart;
    const textBefore = editor.value.substring(0, cursorPos);
    const tagMatch = textBefore.match(/<(\w+)(?:\s[^>]*)?$/);
    if (tagMatch) {
      const tagName = tagMatch[1];
      e.preventDefault();
      const closeTag = `></${tagName}>`;
      editor.setRangeText(closeTag, cursorPos, cursorPos, 'end');
      editor.setSelectionRange(cursorPos, cursorPos);
      updateLineNumbers();
    }
  }
  if (e.key === 'Enter' && currentLang === 'html') {
    const cursorPos = editor.selectionStart;
    const textBefore = editor.value.substring(0, cursorPos);
    if (textBefore.trim().endsWith('!')) {
      e.preventDefault();
      const snippet = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Document</title>
</head>
<body>
    \n\n
</body>
</html>`;
      editor.setRangeText(snippet, cursorPos-1, cursorPos, 'end');
      editor.setSelectionRange(cursorPos + snippet.indexOf('<body>') + 6, cursorPos + snippet.indexOf('<body>') + 6);
      updateLineNumbers();
    }
  }
});

function handleAutoCloseTag() {
  // Доп. логика (уже обработано выше)
}

// ---------- Подсказки HTML/CSS ----------
const htmlHints = [
  'div', 'span', 'p', 'a', 'img', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'table', 'tr', 'td', 'form', 'input', 'button', 'section', 'header', 'footer', 'nav'
];
const cssHints = [
  'color', 'background', 'background-color', 'margin', 'padding', 'border', 'font-size',
  'font-family', 'width', 'height', 'display', 'flex', 'grid', 'align-items', 'justify-content',
  'position', 'top', 'left', 'right', 'bottom', 'box-shadow', 'border-radius'
];

let currentSuggestions = [];
let selectedSuggestionIndex = 0;

function showSuggestions() {
  const cursorPos = editor.selectionStart;
  const textBefore = editor.value.substring(0, cursorPos);
  let word = '';
  let startIdx = cursorPos;
  const lastSpace = textBefore.lastIndexOf(/\s/.exec(textBefore)?.[0]);
  if (currentLang === 'html') {
    const match = textBefore.match(/<(\w*)$/);
    if (match) {
      word = match[1];
      startIdx = cursorPos - word.length;
      currentSuggestions = htmlHints.filter(h => h.startsWith(word));
    } else currentSuggestions = [];
  } else if (currentLang === 'css') {
    const match = textBefore.match(/([a-z-]+)$/);
    if (match && !match[0].startsWith('</')) {
      word = match[1];
      startIdx = cursorPos - word.length;
      currentSuggestions = cssHints.filter(h => h.startsWith(word));
    } else currentSuggestions = [];
  }
  if (currentSuggestions.length > 0 && word.length > 0) {
    selectedSuggestionIndex = 0;
    renderSuggestions();
    const rect = editor.getBoundingClientRect();
    const coords = getCaretCoordinates(editor, cursorPos);
    suggestionsDiv.style.display = 'block';
    suggestionsDiv.style.left = rect.left + coords.left + 'px';
    suggestionsDiv.style.top = rect.top + coords.top + 20 + 'px';
  } else {
    suggestionsDiv.style.display = 'none';
  }
}

function renderSuggestions() {
  suggestionsDiv.innerHTML = '';
  currentSuggestions.forEach((s, idx) => {
    const div = document.createElement('div');
    div.textContent = s;
    if (idx === selectedSuggestionIndex) div.classList.add('selected');
    div.addEventListener('click', () => {
      applySuggestion(s);
    });
    suggestionsDiv.appendChild(div);
  });
}

function applySuggestion(suggestion) {
  const cursorPos = editor.selectionStart;
  const textBefore = editor.value.substring(0, cursorPos);
  let wordStart = cursorPos;
  if (currentLang === 'html') {
    const match = textBefore.match(/<(\w*)$/);
    if (match) wordStart = cursorPos - match[1].length;
  } else if (currentLang === 'css') {
    const match = textBefore.match(/([a-z-]+)$/);
    if (match) wordStart = cursorPos - match[1].length;
  }
  editor.setRangeText(suggestion, wordStart, cursorPos, 'end');
  updateLineNumbers();
  suggestionsDiv.style.display = 'none';
  editor.focus();
}

// Подсказки на клавиши
editor.addEventListener('keydown', (e) => {
  if (suggestionsDiv.style.display === 'block') {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedSuggestionIndex = (selectedSuggestionIndex + 1) % currentSuggestions.length;
      renderSuggestions();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedSuggestionIndex = (selectedSuggestionIndex - 1 + currentSuggestions.length) % currentSuggestions.length;
      renderSuggestions();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (currentSuggestions[selectedSuggestionIndex]) applySuggestion(currentSuggestions[selectedSuggestionIndex]);
    } else if (e.key === 'Escape') {
      suggestionsDiv.style.display = 'none';
    }
  }
});

// Получение координат курсора в textarea
function getCaretCoordinates(element, position) {
  const div = document.createElement('div');
  const style = window.getComputedStyle(element);
  const properties = ['font-family', 'font-size', 'font-weight', 'word-wrap', 'white-space', 'line-height'];
  properties.forEach(prop => div.style[prop] = style[prop]);
  div.style.position = 'absolute';
  div.style.visibility = 'hidden';
  div.style.top = '0';
  div.style.left = '0';
  div.style.whiteSpace = 'pre-wrap';
  div.textContent = element.value.substring(0, position);
  const span = document.createElement('span');
  span.textContent = element.value.substring(position) || '.';
  div.appendChild(span);
  document.body.appendChild(div);
  const { offsetLeft, offsetTop } = span;
  document.body.removeChild(div);
  return { left: offsetLeft, top: offsetTop };
}

// ---------- Остальная логика игры с синхронизацией таймера ----------
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
  myNameSpan.textContent = myName;
  gameActive = false;
  submitBtn.disabled = true;

  // Переключение вкладок HTML/CSS
  const htmlTab = document.querySelector('.editor-tab[data-lang="html"]');
  const cssTab = document.querySelector('.editor-tab[data-lang="css"]');
  if (htmlTab && cssTab) {
    htmlTab.addEventListener('click', () => {
      currentLang = 'html';
      htmlTab.classList.add('active');
      cssTab.classList.remove('active');
      editor.value = htmlCode;
      updatePreview();
      updateLineNumbers();
    });
    cssTab.addEventListener('click', () => {
      currentLang = 'css';
      cssTab.classList.add('active');
      htmlTab.classList.remove('active');
      editor.value = cssCode;
      updatePreview();
      updateLineNumbers();
    });
  }

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
    if (showingMyCode && gameActive) taskFrame.srcdoc = full;
  }

  function startGame(initialRemainingSec = null) {
    if (gameActive) return;
    gameActive = true;
    submitBtn.disabled = false;
    editor.focus();
    updatePreview();
    showingMyCode = false;
    viewBtn.textContent = 'View';
    if (timerInterval) clearInterval(timerInterval);
    let remaining = (initialRemainingSec !== null) ? initialRemainingSec : totalTimeSeconds;
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
      // Важно: используем оставшееся время от сервера
      const remaining = state.remainingTime !== null ? state.remainingTime : totalTimeSeconds;
      if (!gameActive) startGame(remaining);
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
    startGame(totalTimeSeconds);
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

  // Инициализация редактора
  htmlCode = '';
  cssCode = '';
  editor.value = '';
  updateLineNumbers();
  updatePreview();

  if (socket.connected) requestRoomSync();
  socket.on('connect', () => requestRoomSync());
}