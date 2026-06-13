const socket = io();

function getPlayerToken() {
  let token = sessionStorage.getItem('playerToken');
  if (!token) {
    token = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    sessionStorage.setItem('playerToken', token);
  }
  return token;
}

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
        sessionStorage.setItem('roomCode', res.roomCode);
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