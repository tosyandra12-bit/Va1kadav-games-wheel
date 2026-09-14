// ═══════════════════════════════════════════════════════════
//  ⚙️ НАСТРОЙКИ
// ═══════════════════════════════════════════════════════════
const API_URL = "https://va1kadav-roulette-backend.loca.lt";

const REQUEST_HEADERS = {
  'Content-Type': 'application/json',
  'bypass-tunnel-reminder': 'true',
  'User-Agent': 'Va1kadavBot/1.0'
};

const SUITS = {
  '♠': { symbol: '♠', color: 'black' },
  '♥': { symbol: '♥', color: 'red' },
  '♦': { symbol: '♦', color: 'red' },
  '♣': { symbol: '♣', color: 'black' },
};
const RANKS = ['6', '7', '8', '9', '10', 'В', 'Д', 'К', 'Т'];

// ═══════════════════════════════════════════════════════════
//  СОСТОЯНИЕ
// ═══════════════════════════════════════════════════════════
const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

let userData = null;
let currentMode = "vrt";     // vrt | stars
let gameState = null;
let selectedCard = null;
let pollTimer = null;

// ═══════════════════════════════════════════════════════════
//  ИНИЦИАЛИЗАЦИЯ
// ═══════════════════════════════════════════════════════════
async function init() {
  try {
    const res = await fetch(`${API_URL}/api/durak/me`, {
      method: 'POST',
      headers: REQUEST_HEADERS,
      body: JSON.stringify({ init_data: tg.initData })
    }).then(r => r.json());

    if (!res.ok) {
      document.getElementById('loading').textContent = "❌ Авторизация не удалась";
      return;
    }
    userData = res.user;
    document.getElementById('loading').style.display = 'none';
    document.getElementById('menu').style.display = 'block';
    renderBalance();
  } catch (err) {
    document.getElementById('loading').textContent = "❌ Не могу связаться с сервером";
    return;
  }

  // Кнопки меню
  document.querySelectorAll('.mode-btn').forEach(b => {
    b.onclick = () => setMode(b.dataset.mode);
  });

  document.getElementById('start-bot').onclick = startBotGame;
  document.getElementById('create-room').onclick = createRoom;
  document.getElementById('join-room').onclick = joinRoom;
  document.getElementById('open-rules').onclick = showRules;
  document.getElementById('close-btn').onclick = () => tg.close();

  // Игра
  document.getElementById('btn-pass').onclick = () => action('pass');
  document.getElementById('btn-take').onclick = () => action('take');
  document.getElementById('btn-exit').onclick = exitGame;

  tg.MainButton.setText("🃏 Играть").show().onClick(() => {
    document.getElementById('start-bot').click();
  });
}

// ═══════════════════════════════════════════════════════════
//  БАЛАНС
// ═══════════════════════════════════════════════════════════
function renderBalance() {
  document.getElementById('bal-vrt').textContent = userData.balance_vrt;
  document.getElementById('bal-stars').textContent = userData.balance_stars;
}

function setMode(mode) {
  currentMode = mode;
  document.querySelectorAll('.mode-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
  // меняем плейсхолдеры ставок
  const unit = mode === 'vrt' ? 'VRT' : '★';
  document.getElementById('bot-bet').placeholder = `50 ${unit}`;
  document.getElementById('mp-bet').placeholder = `50 ${unit}`;
}

// ═══════════════════════════════════════════════════════════
//  ИГРА С БОТАМИ
// ═══════════════════════════════════════════════════════════
async function startBotGame() {
  const players = parseInt(document.getElementById('bot-players').value);
  const bet = parseInt(document.getElementById('bot-bet').value);

  if (bet < 10) return showStatus("❌ Минимальная ставка 10");
  const bal = currentMode === 'vrt' ? userData.balance_vrt : userData.balance_stars;
  if (bal < bet) return showStatus(`❌ Недостаточно ${currentMode === 'vrt' ? 'VRT' : '★'}`);

  showStatus("⏳ Создаём игру...");
  try {
    const res = await fetch(`${API_URL}/api/durak/new`, {
      method: 'POST',
      headers: REQUEST_HEADERS,
      body: JSON.stringify({
        init_data: tg.initData,
        players: players,
        bet: bet,
        currency: currentMode,
        mode: 'bot'
      })
    }).then(r => r.json());

    if (!res.ok) return showStatus("❌ " + (res.error || "Ошибка"));
    gameState = res.game;
    showScreen('game');
    renderGame();
  } catch (err) {
    showStatus("❌ Сеть недоступна");
  }
}

// ═══════════════════════════════════════════════════════════
//  МУЛЬТИПЛЕЕР
// ═══════════════════════════════════════════════════════════
async function createRoom() {
  const maxPlayers = parseInt(document.getElementById('mp-players').value);
  const bet = parseInt(document.getElementById('mp-bet').value);

  if (bet < 10) return showStatus("❌ Минимальная ставка 10");

  try {
    const res = await fetch(`${API_URL}/api/durak/lobby/create`, {
      method: 'POST',
      headers: REQUEST_HEADERS,
      body: JSON.stringify({
        init_data: tg.initData,
        max_players: maxPlayers,
        bet: bet,
        currency: currentMode
      })
    }).then(r => r.json());

    if (!res.ok) return showStatus("❌ " + (res.error || "Ошибка"));
    gameState = { lobby: res.lobby };
    showScreen('lobby');
    renderLobby();
    startPolling();
  } catch (err) {
    showStatus("❌ Сеть недоступна");
  }
}

async function joinRoom() {
  const code = document.getElementById('join-code').value.trim().toUpperCase();
  if (code.length < 4) return showStatus("❌ Неверный код");

  try {
    const res = await fetch(`${API_URL}/api/durak/lobby/join`, {
      method: 'POST',
      headers: REQUEST_HEADERS,
      body: JSON.stringify({
        init_data: tg.initData,
        code: code
      })
    }).then(r => r.json());

    if (!res.ok) return showStatus("❌ " + (res.error || "Ошибка"));
    gameState = { lobby: res.lobby };
    showScreen('lobby');
    renderLobby();
    startPolling();
  } catch (err) {
    showStatus("❌ Сеть недоступна");
  }
}

// ═══════════════════════════════════════════════════════════
//  ЛОББИ
// ═══════════════════════════════════════════════════════════
function renderLobby() {
  if (!gameState?.lobby) return;
  const l = gameState.lobby;
  document.getElementById('lobby-code').textContent = l.code;

  const players = document.getElementById('lobby-players');
  players.innerHTML = '';
  l.players.forEach(p => {
    const div = document.createElement('div');
    div.className = 'lobby-player' + (p.ready ? ' ready' : '');
    div.innerHTML = `
      <span>${p.is_host ? '👑 ' : ''}${p.name}</span>
      <span>${p.ready ? '✅' : '⏳'}</span>
    `;
    players.appendChild(div);
  });

  const startBtn = document.getElementById('start-mp');
  if (l.you_are_host && l.players.length >= 2) {
    startBtn.style.display = 'block';
    startBtn.onclick = () => startMultiplayerGame(l.code);
  } else {
    startBtn.style.display = 'none';
  }
}

async function startMultiplayerGame(code) {
  try {
    const res = await fetch(`${API_URL}/api/durak/lobby/start`, {
      method: 'POST',
      headers: REQUEST_HEADERS,
      body: JSON.stringify({
        init_data: tg.initData,
        code: code
      })
    }).then(r => r.json());

    if (!res.ok) return showStatus("❌ " + (res.error || "Ошибка"));
    gameState = res.game;
    stopPolling();
    showScreen('game');
    renderGame();
    startPolling();
  } catch (err) {
    showStatus("❌ Сеть недоступна");
  }
}

// ═══════════════════════════════════════════════════════════
//  ОТРИСОВКА ИГРЫ
// ═══════════════════════════════════════════════════════════
function renderGame() {
  if (!gameState) return;
  const g = gameState;

  // Козырь
  document.getElementById('trump-suit').textContent = g.trump_suit;
  document.getElementById('deck-count').textContent = g.deck_count;

  // Противники
  const oppContainer = document.getElementById('opponents');
  oppContainer.innerHTML = '';
  (g.opponents || []).forEach((opp, idx) => {
    const div = document.createElement('div');
    div.className = 'opponent' + (g.current_turn === opp.id ? ' turn' : '');
    div.innerHTML = `
      <div class="name">${opp.name}</div>
      <div class="count">🂠 ${opp.card_count}</div>
    `;
    oppContainer.appendChild(div);
  });

  // Стол (пары карт: атакующая + отбивающая)
  const tableEl = document.getElementById('table');
  tableEl.innerHTML = '';
  (g.table || []).forEach(pair => {
    const pairDiv = document.createElement('div');
    pairDiv.className = 'card-pair';
    if (pair.attack) pairDiv.appendChild(createCardEl(pair.attack, false, true));
    if (pair.defend) pairDiv.appendChild(createCardEl(pair.defend, false, true));
    tableEl.appendChild(pairDiv);
  });

  // Мои карты
  const myHand = document.getElementById('my-hand');
  myHand.innerHTML = '';
  (g.my_hand || []).forEach((card, idx) => {
    const el = createCardEl(card, true, false);
    el.dataset.index = idx;
    el.onclick = () => selectCard(idx, el);
    if (selectedCard === idx) el.classList.add('selected');
    myHand.appendChild(el);
  });

  // Статус
  let statusText = '';
  if (g.current_turn === g.my_id) {
    statusText = g.phase === 'attack' ? "👉 Ваш ход: выберите карту" : "🛡 Отбивайтесь или возьмите";
  } else {
    statusText = `⏳ Ходит ${g.players[g.current_turn]?.name || 'игрок'}...`;
  }
  if (g.message) statusText = g.message;
  document.getElementById('status').textContent = statusText;

  // Кнопки
  const isMyTurn = g.current_turn === g.my_id;
  document.getElementById('btn-pass').style.display = isMyTurn && g.phase === 'attack' && g.table.length > 0 ? 'block' : 'none';
  document.getElementById('btn-take').style.display = isMyTurn && g.phase === 'defend' ? 'block' : 'none';

  if (g.finished) showResult(g);
}

function createCardEl(card, clickable, small) {
  const el = document.createElement('div');
  el.className = 'card ' + (SUITS[card.suit]?.color || 'black');
  if (small) el.classList.add('small');
  el.innerHTML = `
    <span class="rank">${card.rank}</span>
    <span class="suit">${card.suit}</span>
  `;
  return el;
}

function selectCard(idx, el) {
  if (!gameState) return;
  if (gameState.current_turn !== gameState.my_id) return;
  selectedCard = selectedCard === idx ? null : idx;
  document.querySelectorAll('#my-hand .card').forEach(c => c.classList.remove('selected'));
  if (selectedCard !== null) el.classList.add('selected');
}

// ═══════════════════════════════════════════════════════════
//  ХОДЫ
// ═══════════════════════════════════════════════════════════
async function action(type) {
  if (!gameState) return;
  if (gameState.current_turn !== gameState.my_id) return;
  if (type === 'play' && selectedCard === null) {
    return showStatus("❌ Выберите карту");
  }

  try {
    const res = await fetch(`${API_URL}/api/durak/action`, {
      method: 'POST',
      headers: REQUEST_HEADERS,
      body: JSON.stringify({
        init_data: tg.initData,
        game_id: gameState.id,
        action: type,
        card_index: selectedCard
      })
    }).then(r => r.json());

    if (!res.ok) return showStatus("❌ " + (res.error || "Ошибка"));
    selectedCard = null;
    gameState = res.game;
    renderGame();
  } catch (err) {
    showStatus("❌ Сеть недоступна");
  }
}

// ═══════════════════════════════════════════════════════════
//  ПОЛЛИНГ (для мультиплеера)
// ═══════════════════════════════════════════════════════════
function startPolling() {
  stopPolling();
  pollTimer = setInterval(async () => {
    if (!gameState) return;
    try {
      if (gameState.lobby) {
        const res = await fetch(`${API_URL}/api/durak/lobby/state`, {
          method: 'POST',
          headers: REQUEST_HEADERS,
          body: JSON.stringify({ init_data: tg.initData, code: gameState.lobby.code })
        }).then(r => r.json());
        if (res.ok) {
          gameState.lobby = res.lobby;
          if (res.game) {
            gameState = res.game;
            stopPolling();
            showScreen('game');
            renderGame();
          } else {
            renderLobby();
          }
        }
      } else if (gameState.id) {
        const res = await fetch(`${API_URL}/api/durak/state`, {
          method: 'POST',
          headers: REQUEST_HEADERS,
          body: JSON.stringify({ init_data: tg.initData, game_id: gameState.id })
        }).then(r => r.json());
        if (res.ok && res.game) {
          gameState = res.game;
          renderGame();
        }
      }
    } catch (err) {
      // игнорируем
    }
  }, 1500);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// ═══════════════════════════════════════════════════════════
//  РЕЗУЛЬТАТ
// ═══════════════════════════════════════════════════════════
function showResult(g) {
  stopPolling();
  document.getElementById('game').style.display = 'none';
  document.getElementById('result').style.display = 'block';

  const result = document.getElementById('result');
  const won = g.winner === g.my_id;
  const isDurak = g.durak === g.my_id;

  let html = '';
  if (won) {
    html += `<h2 class="win">🎉 ПОБЕДА!</h2>`;
    html += `<div class="prize">Выигрыш: +${g.prize || 0}</div>`;
  } else if (isDurak) {
    html += `<h2 class="lose">🃏 ВЫ ДУРАК!</h2>`;
    html += `<div class="prize">Потеряно: -${g.bet}</div>`;
  } else {
    html += `<h2 class="lose">😞 Проигрыш</h2>`;
    html += `<div class="prize">Потеряно: -${g.bet}</div>`;
  }
  html += `<button class="primary-btn" onclick="exitGame()">🏠 В меню</button>`;
  result.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════
//  УТИЛИТЫ
// ═══════════════════════════════════════════════════════════
function showScreen(name) {
  ['menu', 'game', 'lobby', 'result'].forEach(s => {
    document.getElementById(s).style.display = s === name ? 'block' : 'none';
  });
}

function showStatus(text) {
  const el = document.getElementById('status');
  if (el) el.textContent = text;
  else {
    // показать всплывашку если статус не на экране игры
    tg.showAlert(text);
  }
}

function exitGame() {
  stopPolling();
  gameState = null;
  selectedCard = null;
  showScreen('menu');
  // перезагрузить баланс
  fetch(`${API_URL}/api/durak/me`, {
    method: 'POST',
    headers: REQUEST_HEADERS,
    body: JSON.stringify({ init_data: tg.initData })
  }).then(r => r.json()).then(res => {
    if (res.ok) {
      userData = res.user;
      renderBalance();
    }
  });
}

function showRules() {
  tg.showAlert(
    "🃏 ДУРАК\n\n" +
    "Цель: избавиться от всех карт первым.\n\n" +
    "• Козырь бьёт любую карту другой масти\n" +
    "• Старшая карта бьёт младшую (Т > К > Д > В > 10 > 9 > 8 > 7 > 6)\n" +
    "• Атакующий кладёт карту, защитник отбивает\n" +
    "• Не отбился — забирает все карты со стола\n" +
    "• Первый избавившийся от карт — победитель\n" +
    "• Последний — ДУРАК"
  );
}

// Запуск
init();