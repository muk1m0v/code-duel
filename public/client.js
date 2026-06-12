const socket = io();

// ---------- Главная страница ----------
if (document.getElementById('createRoomBtn')) {
  const nameInput = document.getElementById('playerName');
  const nameError = document.getElementById('nameError');

  function isValidName(name) {
    return name.trim().length > 0 && /^[a-zA-Z\s]+$/.test(name.trim());
  }

  nameInput.addEventListener('input', () => {
    const val = nameInput.value;
    if (val && !isValidName(val)) {
      nameError.style.display = 'block';
      nameInput.style.borderColor = '#e74c3c';
    } else {
      nameError.style.display = 'none';
      nameInput.style.borderColor = '#c77dff';
    }
  });

  document.getElementById('createRoomBtn').onclick = () => {
    const name = nameInput.value.trim();
    if (!isValidName(name)) {
      nameError.style.display = 'block';
      nameInput.style.borderColor = '#e74c3c';
      return;
    }
    sessionStorage.setItem('playerName', name);
    socket.emit('createRoom', { name }, (res) => {
      if (res.success) {
        document.getElementById('roomCodeDisplay').style.display = 'block';
        document.getElementById('roomCode').textContent = res.roomCode;
      }
    });
  };

  document.getElementById('joinRoomBtn').onclick = () => {
    const code = document.getElementById('joinCodeInput').value.trim();
    const name = nameInput.value.trim();
    if (!code) return;
    if (!isValidName(name)) {
      nameError.style.display = 'block';
      nameInput.style.borderColor = '#e74c3c';
      return;
    }
    sessionStorage.setItem('playerName', name);
    socket.emit('joinRoom', { code, name }, (res) => {
      if (res.success) {
        sessionStorage.setItem('roomCode', code);
        window.location.href = '/room';
      } else {
        document.getElementById('errorMsg').textContent = res.message;
      }
    });
  };
}

// ---------- Комната ----------
if (document.getElementById('codeEditor')) {
  const roomCode = sessionStorage.getItem('roomCode');
  const myName = sessionStorage.getItem('playerName') || 'Я';
  if (!roomCode) window.location.href = '/';

  const editor = document.getElementById('codeEditor');
  const previewFrame = document.getElementById('previewFrame');
  const taskFrame = document.getElementById('taskFrame');
  const submitBtn = document.getElementById('submitBtn');
  const overlay = document.getElementById('overlay');
  const overlayMsg = document.getElementById('overlayMsg');
  const myNameSpan = document.getElementById('myName');
  const opponentNameSpan = document.getElementById('opponentName');

  myNameSpan.textContent = myName;

  // Живой предпросмотр
  editor.addEventListener('input', () => {
    previewFrame.srcdoc = editor.value;
  });

  socket.on('gameStart', (data) => {
    taskFrame.src = '/tasks/task1.html';
    // Определяем соперника
    const opponent = data.players.find(p => p.name !== myName);
    opponentNameSpan.textContent = opponent ? opponent.name : 'Противник';
    editor.focus();
  });

  socket.on('submitResult', (res) => {
    if (!res.success) {
      alert(res.message);
    }
  });

  socket.on('gameOver', (data) => {
    overlay.style.display = 'flex';
    const isWinner = data.winner === socket.id;
    overlayMsg.innerHTML = isWinner
      ? '🎉 Вы выиграли!'
      : `💀 Вы проиграли! Победил: <span style="color:#c77dff;">${data.winnerName}</span>`;
    submitBtn.disabled = true;
  });

  socket.on('playerLeft', () => {
    alert('Соперник покинул игру.');
    window.location.href = '/';
  });

  submitBtn.addEventListener('click', async () => {
    const similarity = await comparePreviews();
    socket.emit('submit', { roomCode, similarity: Math.round(similarity) });
  });

  document.getElementById('okBtn').addEventListener('click', () => {
    window.location.href = '/';
  });

  // Функция сравнения скриншотов
  async function comparePreviews() {
    const taskFrame = document.getElementById('taskFrame');
    const previewFrame = document.getElementById('previewFrame');

    const [taskCanvas, previewCanvas] = await Promise.all([
      html2canvas(taskFrame.contentDocument.body, { useCORS: true, scale: 1 }),
      html2canvas(previewFrame.contentDocument.body, { useCORS: true, scale: 1 })
    ]);

    const width = Math.min(taskCanvas.width, previewCanvas.width);
    const height = Math.min(taskCanvas.height, previewCanvas.height);

    const taskCtx = taskCanvas.getContext('2d');
    const previewCtx = previewCanvas.getContext('2d');
    const taskData = taskCtx.getImageData(0, 0, width, height).data;
    const previewData = previewCtx.getImageData(0, 0, width, height).data;

    let mismatched = 0;
    const threshold = 30;

    for (let i = 0; i < taskData.length; i += 4) {
      if (
        Math.abs(taskData[i] - previewData[i]) > threshold ||
        Math.abs(taskData[i + 1] - previewData[i + 1]) > threshold ||
        Math.abs(taskData[i + 2] - previewData[i + 2]) > threshold
      ) {
        mismatched++;
      }
    }

    const totalPixels = width * height;
    return ((totalPixels - mismatched) / totalPixels) * 100;
  }
}