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

// ═══════════════════════════════════════════════════════════
//  СОСТОЯНИЕ
// ═══════════════════════════════════════════════════════════
let tg = null;
let userData = null;
let currentMode = "vrt";
let gameState = null;
let selectedCard = null;
let pollTimer = null;

// ═══════════════════════════════════════════════════════════
//  УТИЛИТЫ
// ═══════════════════════════════════════════════════════════
function $(id) {
  return document.getElementById(id);
}

function showScreen(name) {
  ['menu', 'game', 'lobby', 'result'].forEach(s => {
    const el = $(s);
    if (el) el.style.display = (s === name) ? 'block' : 'none';
  });
}

function hideLoading() {
  const el = $('loading');
  if (el) el.style.display = 'none';
}

function showStatus(text) {
  const el = $('status');
  if (el && el.offsetParent !== null) {
    el.textContent = text;
  } else if (tg && tg.showAlert) {
    tg.showAlert(text);
  } else {
    console.log('[STATUS]', text);
  }
}

// ═══════════════════════════════════════════════════════════
//  ПРИВЯЗКА СОБЫТИЙ
// ═══════════════════════════════════════════════════════════
function bindEvents() {
  const startBot = $('start-bot');
  if (startBot) startBot.onclick = startBotGame;

  const createRoom = $('create-room');
  if (createRoom) createRoom.onclick = createRoomHandler;

  const joinRoom = $('join-room');
  if (joinRoom) joinRoom.onclick = joinRoomHandler;

  const openRules = $('open-rules');
  if (openRules) openRules.onclick = showRules;

  const closeBtn = $('close-btn');
  if (closeBtn) closeBtn.onclick = () => { if (tg) tg.close(); };

  document.querySelectorAll('.mode-btn').forEach(b => {
    b.onclick = () => setMode(b.dataset.mode);
  });

  const btnPass = $('btn-pass');
  if (btnPass) btnPass.onclick = () => action('pass');

  const btnTake = $('btn-take');
  if (btnTake) btnTake.onclick = () => action('take');

  const btnExit = $('btn-exit');
  if (btnExit) btnExit.onclick = exitGame;

  const startMp = $('start-mp');
  if (startMp) startMp.onclick = () => {
    if (gameState?.lobby) startMultiplayerGame(gameState.lobby.code);
  };

  const leaveLobby = $('leave-lobby');
  if (leaveLobby) leaveLobby.onclick = exitGame;

  const copyCode = $('copy-code');
  if (copyCode) copyCode.onclick = copyLobbyCode;

  console.log('[INIT] Кнопки привязаны');
}

function copyLobbyCode() {
  const code = $('lobby-code')?.textContent;
  if (code && navigator.clipboard) {
    navigator.clipboard.writeText(code);
    showStatus("✅ Код скопирован: " + code);
  }
}

// ═══════════════════════════════════════════════════════════
//  ИНИЦИАЛИЗАЦИЯ
// ═══════════════════════════════════════════════════════════
async function init() {
  console.log('[INIT] Начинаем');

  if (window.Telegram && window.Telegram.WebApp) {
    tg = window.Telegram.WebApp;
    try {
      tg.ready();
      tg.expand();
      console.log('[INIT] Telegram готов, initData длина:', tg.initData.length);
    } catch (e) {
      console.warn('[INIT] Telegram SDK error:', e);
    }
  }

  hideLoading();
  showScreen('menu');
  await loadUser();

  if (tg && tg.MainButton) {
    try {
      tg.MainButton.setText("🃏 Играть с ботами");
      tg.MainButton.show();
      tg.MainButton.onClick(() => {
        const btn = $('start-bot');
        if (btn) btn.click();
      });
    } catch (e) {
      console.warn('[INIT] MainButton error:', e);
    }
  }

  console.log('[INIT] Завершено');
}

async function loadUser() {
  try {
    const res = await fetch(`${API_URL}/api/durak/me`, {
      method: 'POST',
      headers: REQUEST_HEADERS,
      body: JSON.stringify({ init_data: tg ? tg.initData : "" })
    }).then(r => r.json());

    if (!res.ok) {
      console.warn('[LOAD] Auth failed:', res);
      $('bal-vrt').textContent = "ошибка";
      $('bal-stars').textContent = "ошибка";
      return;
    }
    userData = res.user;
    renderBalance();
    console.log('[LOAD] User загружен');
  } catch (err) {
    console.warn('[LOAD] Network error:', err);
    $('bal-vrt').textContent = "?";
    $('bal-stars').textContent = "?";
  }
}

function renderBalance() {
  if (!userData) return;
  const vrt = $('bal-vrt');
  const st = $('bal-stars');
  if (vrt) vrt.textContent = userData.balance_vrt;
  if (st) st.textContent = userData.balance_stars;
}

function setMode(mode) {
  currentMode = mode;
  document.querySelectorAll('.mode-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
}

// ═══════════════════════════════════════════════════════════
//  ИГРА С БОТАМИ
// ═══════════════════════════════════════════════════════════
async function startBotGame() {
  console.log('[GAME] startBotGame');

  if (!userData) return showStatus("⏳ Загрузка данных...");

  const players = parseInt($('bot-players').value);
  const bet = parseInt($('bot-bet').value);

  if (bet < 10) return showStatus("❌ Минимальная ставка 10");

  const bal = currentMode === 'vrt'
    ? userData.balance_vrt
    : userData.balance_stars;

  if (bal < bet) {
    return showStatus(`❌ Недостаточно ${currentMode === 'vrt' ? 'VRT' : '★'}`);
  }

  showStatus("⏳ Создаём игру...");
  try {
    const res = await fetch(`${API_URL}/api/durak/new`, {
      method: 'POST',
      headers: REQUEST_HEADERS,
      body: JSON.stringify({
        init_data: tg ? tg.initData : "",
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
    showStatus("");
  } catch (err) {
    console.error('[GAME]', err);
    showStatus("❌ Сеть недоступна");
  }
}

// ═══════════════════════════════════════════════════════════
//  МУЛЬТИПЛЕЕР
// ═══════════════════════════════════════════════════════════
async function createRoomHandler() {
  if (!userData) return showStatus("⏳ Загрузка...");

  const maxPlayers = parseInt($('mp-players').value);
  const bet = parseInt($('mp-bet').value);

  if (bet < 10) return showStatus("❌ Минимальная ставка 10");

  try {
    const res = await fetch(`${API_URL}/api/durak/lobby/create`, {
      method: 'POST',
      headers: REQUEST_HEADERS,
      body: JSON.stringify({
        init_data: tg ? tg.initData : "",
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
    console.error('[MP]', err);
    showStatus("❌ Сеть недоступна");
  }
}

async function joinRoomHandler() {
  const code = ($('join-code').value || '').trim().toUpperCase();
  if (code.length < 4) return showStatus("❌ Неверный код");

  try {
    const res = await fetch(`${API_URL}/api/durak/lobby/join`, {
      method: 'POST',
      headers: REQUEST_HEADERS,
      body: JSON.stringify({
        init_data: tg ? tg.initData : "",
        code: code
      })
    }).then(r => r.json());

    if (!res.ok) return showStatus("❌ " + (res.error || "Ошибка"));
    gameState = { lobby: res.lobby };
    showScreen('lobby');
    renderLobby();
    startPolling();
  } catch (err) {
    console.error('[MP]', err);
    showStatus("❌ Сеть недоступна");
  }
}

function renderLobby() {
  if (!gameState || !gameState.lobby) return;
  const l = gameState.lobby;
  const codeEl = $('lobby-code');
  if (codeEl) codeEl.textContent = l.code;

  const players = $('lobby-players');
  if (!players) return;
  players.innerHTML = '';
  l.players.forEach(p => {
    const div = document.createElement('div');
    div.className = 'lobby-player' + (p.ready ? ' ready' : '');
    div.innerHTML = `
      <span>${p.is_host ? '👑 ' : ''}${p.name}${p.you ? ' (вы)' : ''}</span>
      <span>${p.ready ? '✅' : '⏳'}</span>
    `;
    players.appendChild(div);
  });

  const startBtn = $('start-mp');
  if (startBtn) {
    if (l.you_are_host && l.players.length >= 2) {
      startBtn.style.display = 'block';
    } else {
      startBtn.style.display = 'none';
    }
  }
}

async function startMultiplayerGame(code) {
  try {
    const res = await fetch(`${API_URL}/api/durak/lobby/start`, {
      method: 'POST',
      headers: REQUEST_HEADERS,
      body: JSON.stringify({
        init_data: tg ? tg.initData : "",
        code: code
      })
    }).then(r => r.json());

    if (!res.ok) return showStatus("❌ " + (res.error || "Ошибка"));
    gameState = res.game;
    stopPolling();
    showScreen('game');
    renderGame();
  } catch (err) {
    console.error('[MP]', err);
    showStatus("❌ Сеть недоступна");
  }
}

// ═══════════════════════════════════════════════════════════
//  ОТРИСОВКА ИГРЫ
// ═══════════════════════════════════════════════════════════
function renderGame() {
  if (!gameState) return;
  const g = gameState;

  const trumpSuit = $('trump-suit');
  if (trumpSuit) trumpSuit.textContent = g.trump_suit || '—';

  const deckCount = $('deck-count');
  if (deckCount) deckCount.textContent = g.deck_count || 0;

  // Противники
  const oppContainer = $('opponents');
  if (oppContainer) {
    oppContainer.innerHTML = '';
    (g.opponents || []).forEach(opp => {
      const div = document.createElement('div');
      div.className = 'opponent';
      if (g.current_turn === opp.id) div.classList.add('turn');
      div.innerHTML = `
        <div class="name">${opp.name}</div>
        <div class="count">🂠 ${opp.card_count}</div>
      `;
      oppContainer.appendChild(div);
    });
  }

  // Стол (пары атака/защита)
  const tableEl = $('table');
  if (tableEl) {
    tableEl.innerHTML = '';
    (g.table || []).forEach(pair => {
      const pairDiv = document.createElement('div');
      pairDiv.className = 'card-pair';
      if (pair.attack) pairDiv.appendChild(createCardEl(pair.attack, false, true));
      if (pair.defend) pairDiv.appendChild(createCardEl(pair.defend, false, true));
      tableEl.appendChild(pairDiv);
    });
  }

  // Мои карты
  const myHand = $('my-hand');
  if (myHand) {
    myHand.innerHTML = '';
    (g.my_hand || []).forEach((card, idx) => {
      const el = createCardEl(card, true, false);
      el.dataset.index = idx;
      el.onclick = () => onCardClick(idx, el);
      if (selectedCard === idx) el.classList.add('selected');
      myHand.appendChild(el);
    });
  }

  // Статус
  let statusText = '';
  const isMyTurn = g.current_turn === g.my_id;
  if (isMyTurn) {
    if (g.phase === 'attack') {
      statusText = "👉 Ваш ход: клик на карту = атака";
    } else {
      statusText = "🛡 Отбивайтесь: клик на карту, или «Взять»";
    }
  } else {
    const oppName = g.players?.[g.current_turn]?.name || 'игрок';
    statusText = `⏳ Ходит ${oppName}...`;
  }
  if (g.message) statusText = g.message;
  const statusEl = $('status');
  if (statusEl) statusEl.textContent = statusText;

  // Кнопки
  const btnPass = $('btn-pass');
  const btnTake = $('btn-take');
  if (btnPass) {
    btnPass.style.display = (isMyTurn && g.phase === 'attack' && g.table?.length > 0)
      ? 'block' : 'none';
  }
  if (btnTake) {
    btnTake.style.display = (isMyTurn && g.phase === 'defend')
      ? 'block' : 'none';
  }

  if (g.finished) showResult(g);
}

function createCardEl(card, clickable, small) {
  const el = document.createElement('div');
  const color = (SUITS[card.suit]?.color) || 'black';
  el.className = 'card ' + color;
  if (small) el.classList.add('small');
  el.innerHTML = `
    <span class="rank">${card.rank}</span>
    <span class="suit">${card.suit}</span>
  `;
  return el;
}

// ═══════════════════════════════════════════════════════════
//  🔥 ФИКС: клик на карту = сразу ход
// ═══════════════════════════════════════════════════════════
function onCardClick(idx, el) {
  console.log('[CLICK] Карта', idx);

  if (!gameState) return;
  if (gameState.current_turn !== gameState.my_id) {
    return showStatus("⏳ Не ваш ход");
  }

  // выделяем карту
  selectedCard = idx;
  document.querySelectorAll('#my-hand .card').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');

  // ⚡ сразу отправляем ход
  action('play');
}

// ═══════════════════════════════════════════════════════════
//  ХОДЫ
// ═══════════════════════════════════════════════════════════
async function action(type) {
  if (!gameState || !gameState.id) return;
  if (gameState.current_turn !== gameState.my_id) {
    return showStatus("⏳ Не ваш ход");
  }

  if (type === 'play' && selectedCard === null) {
    return showStatus("❌ Выберите карту");
  }

  console.log('[ACTION]', type, 'card_index=', selectedCard);

  try {
    const res = await fetch(`${API_URL}/api/durak/action`, {
      method: 'POST',
      headers: REQUEST_HEADERS,
      body: JSON.stringify({
        init_data: tg ? tg.initData : "",
        game_id: gameState.id,
        action: type,
        card_index: selectedCard
      })
    }).then(r => r.json());

    if (!res.ok) {
      // ошибка — показываем и НЕ сбрасываем selectedCard
      showStatus("❌ " + (res.error || "Ошибка"));
      // снимаем выделение с карты
      document.querySelectorAll('#my-hand .card').forEach(c => c.classList.remove('selected'));
      selectedCard = null;
      return;
    }

    // успех
    selectedCard = null;
    gameState = res.game;
    renderGame();
  } catch (err) {
    console.error('[ACTION]', err);
    showStatus("❌ Сеть недоступна");
  }
}

// ═══════════════════════════════════════════════════════════
//  ПОЛЛИНГ
// ═══════════════════════════════════════════════════════════
function startPolling() {
  stopPolling();
  pollTimer = setInterval(pollUpdate, 1500);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function pollUpdate() {
  if (!gameState) return;
  try {
    if (gameState.lobby) {
      const res = await fetch(`${API_URL}/api/durak/lobby/state`, {
        method: 'POST',
        headers: REQUEST_HEADERS,
        body: JSON.stringify({
          init_data: tg ? tg.initData : "",
          code: gameState.lobby.code
        })
      }).then(r => r.json());
      if (res.ok) {
        gameState.lobby = res.lobby;
        if (res.game) {
          gameState = res.game;
          stopPolling();
          showScreen('game');
          renderGame();
          startPolling();
        } else {
          renderLobby();
        }
      }
    } else if (gameState.id) {
      const res = await fetch(`${API_URL}/api/durak/state`, {
        method: 'POST',
        headers: REQUEST_HEADERS,
        body: JSON.stringify({
          init_data: tg ? tg.initData : "",
          game_id: gameState.id
        })
      }).then(r => r.json());
      if (res.ok && res.game) {
        gameState = res.game;
        renderGame();
      }
    }
  } catch (err) {
    // тихо
  }
}

// ═══════════════════════════════════════════════════════════
//  РЕЗУЛЬТАТ
// ═══════════════════════════════════════════════════════════
function showResult(g) {
  stopPolling();
  showScreen('result');

  const result = $('result');
  if (!result) return;

  const won = g.winner === g.my_id;
  const isDurak = g.durak === g.my_id;

  let html = '';
  if (won) {
    html += `<h2 class="win">🎉 ПОБЕДА!</h2>`;
    html += `<div class="prize">Выигрыш: +${g.prize || 0}</div>`;
  } else if (isDurak) {
    html += `<h2 class="lose">🃏 ВЫ ДУРАК!</h2>`;
    html += `<div class="prize">Потеряно: -${g.bet || 0}</div>`;
  } else {
    html += `<h2 class="lose">😞 Проигрыш</h2>`;
    html += `<div class="prize">Потеряно: -${g.bet || 0}</div>`;
  }
  html += `<button class="primary-btn" onclick="exitGame()">🏠 В меню</button>`;
  result.innerHTML = html;
}

function exitGame() {
  stopPolling();
  gameState = null;
  selectedCard = null;
  showScreen('menu');
  loadUser();
}

function showRules() {
  const rules = (
    "🃏 ДУРАК\n\n" +
    "Цель: избавиться от всех карт первым.\n\n" +
    "• Козырь бьёт любую карту другой масти\n" +
    "• Старшая бьёт младшую (Т>К>Д>В>10>9>8>7>6)\n" +
    "• Атакующий кладёт карту, защитник отбивает\n" +
    "• Не отбился — забирает все карты со стола\n" +
    "• Первый без карт — победитель\n" +
    "• Последний — ДУРАК"
  );
  if (tg && tg.showAlert) {
    tg.showAlert(rules);
  } else {
    alert(rules);
  }
}

// ═══════════════════════════════════════════════════════════
//  ЗАПУСК
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  console.log('[BOOT] DOM загружен');
  bindEvents();
  init();
});

if (document.readyState !== 'loading') {
  bindEvents();
  init();
}
