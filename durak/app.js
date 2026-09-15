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
let isSending = false;
let lastTrump = null;
let freeMode = false;

// ═══════════════════════════════════════════════════════════
//  УТИЛИТЫ
// ═══════════════════════════════════════════════════════════
function $(id) { return document.getElementById(id); }

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

function showToast(text, type = 'info') {
  const toast = document.createElement('div');
  toast.className = 'toast toast-' + type;
  toast.textContent = text;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 1500);
}

function shake(el) {
  if (!el) return;
  el.classList.add('shake');
  setTimeout(() => el.classList.remove('shake'), 400);
}

function vibrate(pattern) {
  if (tg && tg.HapticFeedback) {
    try {
      if (pattern === 'success') tg.HapticFeedback.notificationOccurred('success');
      else if (pattern === 'error') tg.HapticFeedback.notificationOccurred('error');
      else tg.HapticFeedback.impactOccurred('light');
    } catch (e) {}
  }
}

function cardToStr(card) {
  if (!card) return '';
  return `${card.rank}${card.suit}`;
}

function highlightOpponent(oppId, on) {
  const container = $('opponents');
  if (!container) return;
  container.querySelectorAll('.opponent').forEach(el => {
    if (el.dataset.id == oppId) {
      el.classList.toggle('active-turn', on);
    }
  });
}

// ═══════════════════════════════════════════════════════════
//  🎖️ АНИМАЦИЯ «ПОГОНЫ»
// ═══════════════════════════════════════════════════════════
function showPogony(whoGotPogony) {
  const overlay = document.createElement('div');
  overlay.className = 'pogony-overlay';

  const isMe = whoGotPogony === 'me';

  overlay.innerHTML = `
    <div class="pogony-emoji">🎖️</div>
    <div class="pogony-title">ПОГОНЫ!</div>
    <div class="pogony-subtitle">
      ${isMe ? '😱 Ты повесил 4 шестёрки!' : '🎉 Соперник повесил 4 шестёрки!'}<br>
      ${isMe ? 'Ты получил погоны!' : 'Ты выиграл ×5!'}
    </div>
  `;

  document.body.appendChild(overlay);
  vibrate(isMe ? 'error' : 'success');

  // искры
  for (let i = 0; i < 12; i++) {
    const spark = document.createElement('div');
    spark.className = 'sparkle';
    spark.textContent = '✨';
    spark.style.left = Math.random() * 100 + '%';
    spark.style.top = Math.random() * 100 + '%';
    spark.style.animationDelay = (Math.random() * 1.5) + 's';
    overlay.appendChild(spark);
  }

  setTimeout(() => overlay.remove(), 4000);
}

// ═══════════════════════════════════════════════════════════
//  СРАВНЕНИЕ СОСТОЯНИЙ
// ═══════════════════════════════════════════════════════════
function stateChanged(oldState, newState) {
  if (!oldState || !newState) return true;

  if (oldState.phase !== newState.phase) return true;
  if (oldState.current_turn !== newState.current_turn) return true;
  if (oldState.current_attacker !== newState.current_attacker) return true;
  if (oldState.current_defender !== newState.current_defender) return true;
  if (oldState.deck_count !== newState.deck_count) return true;
  if (oldState.finished !== newState.finished) return true;

  const oldTable = oldState.table || [];
  const newTable = newState.table || [];
  if (oldTable.length !== newTable.length) return true;
  for (let i = 0; i < oldTable.length; i++) {
    const oa = oldTable[i].attack;
    const na = newTable[i].attack;
    if (!oa || !na) return true;
    if (oa.rank !== na.rank || oa.suit !== na.suit) return true;

    const od = oldTable[i].defend;
    const nd = newTable[i].defend;
    if ((od && !nd) || (!od && nd)) return true;
    if (od && nd && (od.rank !== nd.rank || od.suit !== nd.suit)) return true;
  }

  const oldHand = oldState.my_hand || [];
  const newHand = newState.my_hand || [];
  if (oldHand.length !== newHand.length) return true;

  const oldOpp = oldState.opponents || [];
  const newOpp = newState.opponents || [];
  if (oldOpp.length !== newOpp.length) return true;
  for (let i = 0; i < oldOpp.length; i++) {
    if (oldOpp[i].card_count !== newOpp[i].card_count) return true;
  }

  const ol = oldState.last_action;
  const nl = newState.last_action;
  if (!ol && nl) return true;
  if (ol && !nl) return true;
  if (ol && nl && ol.type !== nl.type) return true;

  return false;
}

// ═══════════════════════════════════════════════════════════
//  ПРИВЯЗКА СОБЫТИЙ
// ═══════════════════════════════════════════════════════════
function bindEvents() {
  const startBot = $('start-bot');
  if (startBot) startBot.onclick = () => {
    freeMode = false;
    startBotGame();
  };

  const startFree = $('start-free');
  if (startFree) startFree.onclick = () => {
    freeMode = true;
    startBotGame();
  };

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
    showToast("📋 Код скопирован", 'success');
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
      console.log('[INIT] Telegram готов');
    } catch (e) {}
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
    } catch (e) {}
  }
}

async function loadUser() {
  try {
    const res = await fetch(`${API_URL}/api/durak/me`, {
      method: 'POST',
      headers: REQUEST_HEADERS,
      body: JSON.stringify({ init_data: tg ? tg.initData : "" })
    }).then(r => r.json());

    if (!res.ok) {
      $('bal-vrt').textContent = "ошибка";
      $('bal-stars').textContent = "ошибка";
      return;
    }
    userData = res.user;
    renderBalance();
  } catch (err) {
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
  if (!userData && !freeMode) {
    return showStatus("⏳ Загрузка данных...");
  }

  const players = parseInt($('bot-players').value);
  const bet = freeMode ? 0 : parseInt($('bot-bet').value);

  if (!freeMode && bet < 10) {
    return showToast("❌ Минимум 10", 'error');
  }

  if (!freeMode && userData) {
    const bal = currentMode === 'vrt' ? userData.balance_vrt : userData.balance_stars;
    if (bal < bet) {
      return showToast(`❌ Недостаточно ${currentMode === 'vrt' ? 'VRT' : '★'}`, 'error');
    }
  }

  showStatus(freeMode ? "🆓 Создаём бесплатную игру..." : "⏳ Создаём игру...");

  try {
    const res = await fetch(`${API_URL}/api/durak/new`, {
      method: 'POST',
      headers: REQUEST_HEADERS,
      body: JSON.stringify({
        init_data: tg ? tg.initData : "",
        players: players,
        bet: bet,
        currency: currentMode,
        mode: freeMode ? 'free' : 'bot',
        free: freeMode
      })
    }).then(r => r.json());

    if (!res.ok) {
      return showToast("❌ " + (res.error || "Ошибка"), 'error');
    }

    gameState = res.game;
    selectedCard = null;
    lastTrump = null;
    showScreen('game');
    renderGame();
    showStatus("");

    // проверяем погоны сразу
    if (gameState.pogony) {
      showPogony(gameState.pogony === gameState.my_id ? 'me' : 'enemy');
    }

    if (res.next_is_bot) {
      setTimeout(() => runBotTurns(), 900);
    } else {
      startPolling();
    }
  } catch (err) {
    console.error('[START]', err);
    showToast("❌ Не могу связаться с сервером", 'error');
    showStatus("❌ Backend недоступен. Попробуй позже.");
  }
}

// ═══════════════════════════════════════════════════════════
//  МУЛЬТИПЛЕЕР
// ═══════════════════════════════════════════════════════════
async function createRoomHandler() {
  if (!userData) return showStatus("⏳ Загрузка...");

  const maxPlayers = parseInt($('mp-players').value);
  const bet = parseInt($('mp-bet').value);

  if (bet < 10) return showToast("❌ Минимум 10", 'error');

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

    if (!res.ok) return showToast("❌ " + (res.error || "Ошибка"), 'error');
    gameState = { lobby: res.lobby };
    showScreen('lobby');
    renderLobby();
    startPolling();
  } catch (err) {
    showToast("❌ Сеть недоступна", 'error');
  }
}

async function joinRoomHandler() {
  const code = ($('join-code').value || '').trim().toUpperCase();
  if (code.length < 4) return showToast("❌ Неверный код", 'error');

  try {
    const res = await fetch(`${API_URL}/api/durak/lobby/join`, {
      method: 'POST',
      headers: REQUEST_HEADERS,
      body: JSON.stringify({
        init_data: tg ? tg.initData : "",
        code: code
      })
    }).then(r => r.json());

    if (!res.ok) return showToast("❌ " + (res.error || "Ошибка"), 'error');

    if (res.game) {
      gameState = res.game;
      stopPolling();
      showScreen('game');
      renderGame();

      if (gameState.pogony) {
        showPogony(gameState.pogony === gameState.my_id ? 'me' : 'enemy');
      }

      if (res.next_is_bot) {
        setTimeout(() => runBotTurns(), 900);
      } else {
        startPolling();
      }
      return;
    }

    gameState = { lobby: res.lobby };
    showScreen('lobby');
    renderLobby();
    startPolling();
  } catch (err) {
    showToast("❌ Сеть недоступна", 'error');
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

    if (!res.ok) return showToast("❌ " + (res.error || "Ошибка"), 'error');
    gameState = res.game;
    selectedCard = null;
    lastTrump = null;
    stopPolling();
    showScreen('game');
    renderGame();

    if (gameState.pogony) {
      showPogony(gameState.pogony === gameState.my_id ? 'me' : 'enemy');
    }

    startPolling();
  } catch (err) {
    showToast("❌ Сеть недоступна", 'error');
  }
}

// ═══════════════════════════════════════════════════════════
//  ОТРИСОВКА ИГРЫ
// ═══════════════════════════════════════════════════════════
function renderGame() {
  if (!gameState) return;
  const g = gameState;

  // Козырь
  const trumpSuit = $('trump-suit');
  if (trumpSuit) {
    trumpSuit.textContent = g.trump_suit || '—';
    if (lastTrump !== g.trump_suit) {
      lastTrump = g.trump_suit;
      trumpSuit.classList.add('pulse');
      setTimeout(() => trumpSuit.classList.remove('pulse'), 800);
    }
  }

  const deckCount = $('deck-count');
  if (deckCount) deckCount.textContent = g.deck_count || 0;

  // Противники — перерисовываем только если изменилось
  const oppContainer = $('opponents');
  if (oppContainer) {
    const oppKey = JSON.stringify({
      opp: g.opponents,
      turn: g.current_turn,
    });
    if (oppContainer.dataset.key !== oppKey) {
      oppContainer.innerHTML = '';
      (g.opponents || []).forEach(opp => {
        const div = document.createElement('div');
        div.className = 'opponent';
        div.dataset.id = opp.id;
        if (g.current_turn === opp.id) div.classList.add('turn');
        div.innerHTML = `
          <div class="name">${opp.name}</div>
          <div class="count">🂠 ${opp.card_count}</div>
        `;
        oppContainer.appendChild(div);
      });
      oppContainer.dataset.key = oppKey;
    }
  }

  // Стол
  const tableEl = $('table');
  if (tableEl) {
    const tableKey = JSON.stringify(g.table || []);
    if (tableEl.dataset.key !== tableKey) {
      const oldCount = tableEl.querySelectorAll('.card-pair').length;
      tableEl.innerHTML = '';
      (g.table || []).forEach((pair, idx) => {
        const pairDiv = document.createElement('div');
        pairDiv.className = 'card-pair';

        if (pair.attack) {
          const attackEl = createCardEl(pair.attack, false, true);
          if (idx >= oldCount) attackEl.classList.add('fly-in');
          pairDiv.appendChild(attackEl);
        }

        if (pair.defend) {
          const defendEl = createCardEl(pair.defend, false, true);
          defendEl.classList.add('slam');
          pairDiv.appendChild(defendEl);
        }

        tableEl.appendChild(pairDiv);
      });
      tableEl.dataset.key = tableKey;
    }
  }

  // Мои карты
  const myHand = $('my-hand');
  if (myHand) {
    const handKey = JSON.stringify(g.my_hand || []);
    if (myHand.dataset.key !== handKey || myHand.dataset.selected !== String(selectedCard)) {
      myHand.innerHTML = '';
      (g.my_hand || []).forEach((card, idx) => {
        const el = createCardEl(card, true, false);
        el.dataset.index = idx;
        el.onclick = () => onCardClick(idx, el);
        if (selectedCard === idx) el.classList.add('selected');
        myHand.appendChild(el);
      });
      myHand.dataset.key = handKey;
      myHand.dataset.selected = String(selectedCard);
    }
  }

  // Статус
  let statusText = '';
  const isMyTurn = g.current_turn === g.my_id;
  if (g.free) {
    statusText = "🆓 Бесплатная игра · ";
  } else {
    statusText = "";
  }

  if (isMyTurn) {
    if (g.phase === 'attack') {
      statusText += g.table?.length > 0
        ? "👉 Подкиньте ещё или «Пас»"
        : "👉 Ваш ход: клик на карту";
    } else {
      statusText += "🛡 Отбивайтесь или «Взять»";
    }
  } else {
    const oppName = g.players?.[g.current_turn]?.name || 'игрок';
    statusText += `⏳ Ходит ${oppName}...`;
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

  // Погоны
  if (g.pogony && !g._pogonyShown) {
    g._pogonyShown = true;
    const who = g.pogony === g.my_id ? 'me' : 'enemy';
    setTimeout(() => showPogony(who), 500);
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
//  КЛИК НА КАРТУ
// ═══════════════════════════════════════════════════════════
async function onCardClick(idx, el) {
  if (!gameState) return;
  if (isSending) return;
  if (gameState.current_turn !== gameState.my_id) {
    return showToast("⏳ Не ваш ход", 'error');
  }

  selectedCard = idx;
  document.querySelectorAll('#my-hand .card').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');

  isSending = true;
  await action('play');
  isSending = false;
}

// ═══════════════════════════════════════════════════════════
//  ХОДЫ ИГРОКА
// ═══════════════════════════════════════════════════════════
async function action(type) {
  if (!gameState || !gameState.id) return;

  if (gameState.current_turn !== gameState.my_id) {
    return showToast("⏳ Не ваш ход", 'error');
  }

  if (type === 'play') {
    if (selectedCard === null || selectedCard === undefined) {
      return showToast("❌ Выберите карту", 'error');
    }
    if (!gameState.my_hand || selectedCard < 0 || selectedCard >= gameState.my_hand.length) {
      selectedCard = null;
      return showToast("❌ Карта не найдена", 'error');
    }
  }

  const payload = {
    init_data: tg ? tg.initData : "",
    game_id: gameState.id,
    action: type,
    card_index: (type === 'play') ? Number(selectedCard) : null,
  };

  try {
    const res = await fetch(`${API_URL}/api/durak/action`, {
      method: 'POST',
      headers: REQUEST_HEADERS,
      body: JSON.stringify(payload)
    }).then(r => r.json());

    if (!res.ok) {
      shake($('my-hand'));
      vibrate('error');
      showToast("❌ " + (res.error || "Ошибка"), 'error');
      document.querySelectorAll('#my-hand .card').forEach(c => c.classList.remove('selected'));
      selectedCard = null;
      return;
    }

    const g = res.game;
    const la = g.last_action || {};

    if (la.type === 'beat') {
      showToast(`✅ Отбито ${cardToStr(la.attacked)} → ${cardToStr(la.card)}`, 'success');
      vibrate('success');
    } else if (la.type === 'take') {
      showToast(`🙈 Взял ${la.count || ''} карт`, 'info');
      vibrate('light');
    } else if (la.type === 'attack') {
      showToast(`🃏 Атака ${cardToStr(la.card)}`, 'info');
      vibrate('light');
    } else if (la.type === 'throw') {
      showToast(`➕ Подкинул ${cardToStr(la.card)}`, 'info');
      vibrate('light');
    } else if (la.type === 'pass') {
      showToast(`🏁 Пас`, 'info');
      vibrate('light');
    } else if (la.type === 'defend_done') {
      showToast(`✅ Отбито — можете подкинуть или «Пас»`, 'info');
      vibrate('light');
    } else if (la.type === 'end_round') {
      showToast(`🎯 Раунд окончен`, 'success');
      vibrate('success');
    } else if (la.type === 'pogony') {
      // показываем погоны
      showPogony('me');
    }

    selectedCard = null;
    gameState = g;
    renderGame();

    if (res.next_is_bot) {
      setTimeout(() => runBotTurns(), 900);
    } else {
      startPolling();
    }

  } catch (err) {
    console.error('[ACTION]', err);
    shake($('my-hand'));
    showToast("❌ Сеть недоступна", 'error');
  }
}

// ═══════════════════════════════════════════════════════════
//  ХОДЫ БОТОВ
// ═══════════════════════════════════════════════════════════
async function runBotTurns() {
  if (!gameState || !gameState.id) return;
  if (isSending) return;

  isSending = true;
  stopPolling();

  try {
    while (gameState && !gameState.finished) {
      const current = gameState.current_turn;
      const isBotTurn = gameState.opponents?.some(o => o.id === current);

      if (!isBotTurn) break;

      highlightOpponent(current, true);

      await new Promise(r => setTimeout(r, 700));

      const res = await fetch(`${API_URL}/api/durak/bot_turn`, {
        method: 'POST',
        headers: REQUEST_HEADERS,
        body: JSON.stringify({
          init_data: tg ? tg.initData : "",
          game_id: gameState.id
        })
      }).then(r => r.json());

      if (!res.ok) {
        highlightOpponent(current, false);
        break;
      }

      gameState = res.game;
      renderGame();
      highlightOpponent(current, false);

      const la = gameState.last_action;
      if (la) {
        if (la.type === 'beat') {
          showToast(`🛡 Отбил ${cardToStr(la.attacked)} → ${cardToStr(la.card)}`, 'info');
        } else if (la.type === 'take') {
          showToast(`🙈 Взял ${la.count || ''} карт`, 'info');
        } else if (la.type === 'attack') {
          showToast(`🤖 Атака ${cardToStr(la.card)}`, 'info');
        } else if (la.type === 'throw') {
          showToast(`➕ Подкинул ${cardToStr(la.card)}`, 'info');
        } else if (la.type === 'pass') {
          showToast(`🏁 Пас`, 'info');
        } else if (la.type === 'defend_done') {
          showToast(`✅ Отбито`, 'info');
        } else if (la.type === 'end_round') {
          showToast(`🎯 Раунд окончен`, 'success');
        } else if (la.type === 'pogony') {
          // соперник повесил погоны → мы выиграли x5
          showPogony('enemy');
        }
      }

      await new Promise(r => setTimeout(r, 800));

      if (gameState.current_turn === gameState.my_id) {
        showToast("🎯 Твой ход!", 'success');
        vibrate('success');
        break;
      }

      if (gameState.finished) break;
    }
  } catch (err) {
    console.error('[BOT_TURNS]', err);
  } finally {
    isSending = false;

    if (gameState && !gameState.finished) {
      const cur = gameState.current_turn;
      const isBotTurn = gameState.opponents?.some(o => o.id === cur);
      if (!isBotTurn) {
        startPolling();
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════
//  ПОЛЛИНГ
// ═══════════════════════════════════════════════════════════
function startPolling() {
  stopPolling();
  pollTimer = setInterval(pollUpdate, 2000);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function pollUpdate() {
  if (!gameState) return;
  if (isSending) return;

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

          if (res.next_is_bot) {
            setTimeout(() => runBotTurns(), 900);
          } else {
            startPolling();
          }
        } else {
          renderLobby();
        }
      }
      return;
    }

    if (!gameState.id) return;

    const cur = gameState.current_turn;
    const isBotTurn = gameState.opponents?.some(o => o.id === cur);
    if (isBotTurn) {
      runBotTurns();
      return;
    }

    const res = await fetch(`${API_URL}/api/durak/state`, {
      method: 'POST',
      headers: REQUEST_HEADERS,
      body: JSON.stringify({
        init_data: tg ? tg.initData : "",
        game_id: gameState.id
      })
    }).then(r => r.json());

    if (!res.ok || !res.game) return;

    if (stateChanged(gameState, res.game)) {
      gameState = res.game;
      renderGame();

      if (res.next_is_bot) {
        setTimeout(() => runBotTurns(), 900);
      }
    } else {
      gameState.last_action = res.game.last_action;
    }
  } catch (err) {}
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
  const pogony = g.pogony === g.my_id;

  let html = '';
  if (won) {
    html += `<h2 class="win">🎉 ПОБЕДА!</h2>`;
    if (g.prize) {
      html += `<div class="prize">Выигрыш: +${g.prize}</div>`;
    }
    if (g.pogony) {
      html += `<div class="prize">🎖️ ×5 за погоны!</div>`;
    }
    vibrate('success');
  } else if (isDurak && pogony) {
    html += `<h2 class="lose">🎖️ ПОГОНЫ!</h2>`;
    html += `<div class="prize">Ты повесил 4 шестёрки!</div>`;
    vibrate('error');
  } else if (isDurak) {
    html += `<h2 class="lose">🃏 ВЫ ДУРАК!</h2>`;
    if (g.bet) html += `<div class="prize">Потеряно: -${g.bet}</div>`;
    vibrate('error');
  } else {
    html += `<h2 class="lose">😞 Проигрыш</h2>`;
    if (g.bet) html += `<div class="prize">Потеряно: -${g.bet}</div>`;
  }

  html += `<button class="primary-btn" onclick="exitGame()">🏠 В меню</button>`;
  result.innerHTML = html;
}

function exitGame() {
  stopPolling();
  gameState = null;
  selectedCard = null;
  isSending = false;
  lastTrump = null;
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
    "• После отбоя можно подкинуть карту того же ранга\n" +
    "• Не отбился — забирает все карты со стола\n\n" +
    "🎖️ ПОГОНЫ:\n" +
    "Если у тебя остались 4 шестёрки — это погоны!\n" +
    "Ты проигрываешь, а победитель получает ×5!"
  );
  if (tg && tg.showAlert) tg.showAlert(rules);
  else alert(rules);
}

// ═══════════════════════════════════════════════════════════
//  ЗАПУСК
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  init();
});

if (document.readyState !== 'loading') {
  bindEvents();
  init();
}
