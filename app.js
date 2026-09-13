// ═══════════════════════════════════════════════════════════
//  ⚙️ НАСТРОЙКИ — МЕНЯЕШЬ ЗДЕСЬ
// ═══════════════════════════════════════════════════════════
const API_URL = "https://ТВОЙ-ТУННЕЛЬ.trycloudflare.com"; // ← адрес backend

const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

let userData = null;
let currentBet = null;
let currentMode = "vrt";    // vrt | stars
let isSpinning = false;

const WHEEL_ORDER = [
  0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,
  20,14,31,9,22,18,29,7,28,12,35,3,26
];
const RED_NUMBERS = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);

// ─── Рисуем колесо ────────────────────────────────────────
function drawWheel() {
  const canvas = document.getElementById('wheel');
  const ctx = canvas.getContext('2d');
  const cx = canvas.width / 2, cy = canvas.height / 2;
  const r = Math.min(cx, cy) - 4;
  const seg = (Math.PI * 2) / WHEEL_ORDER.length;

  for (let i = 0; i < WHEEL_ORDER.length; i++) {
    const n = WHEEL_ORDER[i];
    const start = i * seg - Math.PI / 2 - seg / 2;
    const end = start + seg;

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, start, end);
    ctx.closePath();
    ctx.fillStyle = n === 0 ? '#0a7c0a'
                  : RED_NUMBERS.has(n) ? '#b91c1c' : '#1a1a1a';
    ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke();

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(start + seg / 2);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText(n, r * 0.8, 4);
    ctx.restore();
  }

  // центр
  ctx.beginPath();
  ctx.arc(cx, cy, 30, 0, Math.PI * 2);
  ctx.fillStyle = '#222'; ctx.fill();
  ctx.strokeStyle = '#888'; ctx.lineWidth = 2; ctx.stroke();

  // указатель
  ctx.beginPath();
  ctx.moveTo(cx, 6);
  ctx.lineTo(cx - 10, 26);
  ctx.lineTo(cx + 10, 26);
  ctx.closePath();
  ctx.fillStyle = '#fbbf24'; ctx.fill();
}

// ─── Строим стол чисел ────────────────────────────────────
function buildTable() {
  const container = document.getElementById('numbers');
  const cols = [
    [3,6,9,12,15,18,21,24,27,30,33,36],
    [2,5,8,11,14,17,20,23,26,29,32,35],
    [1,4,7,10,13,16,19,22,25,28,31,34]
  ];
  cols.forEach(col => {
    col.forEach(n => {
      const btn = document.createElement('button');
      btn.textContent = n;
      btn.dataset.bet = `straight:${n}`;
      btn.className = RED_NUMBERS.has(n) ? 'red' : 'black';
      btn.onclick = () => selectBet(btn, `straight:${n}`);
      container.appendChild(btn);
    });
  });
}

function selectBet(btn, betType) {
  if (isSpinning) return;
  document.querySelectorAll('.selected').forEach(el => el.classList.remove('selected'));
  btn.classList.add('selected');
  currentBet = betType;
  updateSpinButton();
}

function updateSpinButton() {
  const bet = parseInt(document.getElementById('bet').value) || 0;
  const btn = document.getElementById('spin-btn');
  let bal;
  if (currentMode === 'vrt') bal = userData?.balance_vrt || 0;
  else bal = userData?.balance_stars || 0;
  btn.disabled = isSpinning || !currentBet || bet < 10 || bet > bal;
}

// ─── Вращение ─────────────────────────────────────────────
async function spin() {
  if (isSpinning || !currentBet) return;
  const bet = parseInt(document.getElementById('bet').value);
  if (bet < 10) return;

  const balanceKey = currentMode === 'vrt' ? 'balance_vrt' : 'balance_stars';
  if (bet > userData[balanceKey]) return;

  isSpinning = true;
  updateSpinButton();
  document.getElementById('result').textContent = '';
  document.getElementById('result').className = '';

  // локально списываем
  userData[balanceKey] -= bet;
  renderBalance();

  const payload = {
    init_data: tg.initData,
    bet: bet,
    bet_type: currentBet,
    currency: currentMode,
  };

  let res;
  try {
    res = await fetch(`${API_URL}/api/roulette/spin`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload),
    }).then(r => r.json());
  } catch (err) {
    document.getElementById('result').textContent = "❌ Сеть недоступна";
    isSpinning = false;
    userData[balanceKey] += bet;
    renderBalance();
    updateSpinButton();
    return;
  }

  if (!res.ok) {
    document.getElementById('result').textContent = "❌ " + (res.error || "Ошибка");
    isSpinning = false;
    userData[balanceKey] += bet;
    renderBalance();
    updateSpinButton();
    return;
  }

  // Прокрутка колеса
  const winNumber = res.number;
  const idx = WHEEL_ORDER.indexOf(winNumber);
  const seg = 360 / WHEEL_ORDER.length;
  const targetAngle = 360 * 6 + (360 - idx * seg);
  const canvas = document.getElementById('wheel');
  canvas.style.transform = `rotate(${targetAngle}deg)`;

  setTimeout(() => {
    userData.balance_vrt = res.balance_vrt;
    userData.balance_stars = res.balance_stars;
    renderBalance();

    const r = document.getElementById('result');
    const unit = currentMode === 'vrt' ? 'VRT' : '★';
    if (res.win > 0) {
      r.textContent = `🎉 Выпало ${winNumber}! +${res.win}${unit}`;
      r.className = 'win';
      tg.HapticFeedback?.notificationOccurred('success');
    } else {
      r.textContent = `😞 Выпало ${winNumber}. -${bet}${unit}`;
      r.className = 'lose';
      tg.HapticFeedback?.notificationOccurred('error');
    }

    // сброс колеса
    setTimeout(() => {
      canvas.style.transition = 'none';
      canvas.style.transform = `rotate(${targetAngle % 360}deg)`;
      setTimeout(() => canvas.style.transition = '', 50);
    }, 500);

    isSpinning = false;
    updateSpinButton();
  }, 4000);
}

// ─── Рендер ───────────────────────────────────────────────
function renderBalance() {
  document.getElementById('balance-vrt').textContent = userData.balance_vrt;
  document.getElementById('balance-stars').textContent = userData.balance_stars;
  updateSpinButton();
}

// ─── Режим валюты ─────────────────────────────────────────
function setMode(mode) {
  if (isSpinning) return;
  currentMode = mode;
  document.querySelectorAll('.mode-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
  updateSpinButton();
}

// ─── Инициализация ────────────────────────────────────────
async function init() {
  drawWheel();
  buildTable();

  try {
    const res = await fetch(`${API_URL}/api/roulette/me`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({init_data: tg.initData})
    }).then(r => r.json());

    if (!res.ok) {
      document.getElementById('loading').textContent = "❌ Авторизация не удалась";
      return;
    }
    userData = res.user;
    document.getElementById('loading').style.display = 'none';
    document.getElementById('game').style.display = 'block';
    renderBalance();
  } catch (err) {
    document.getElementById('loading').textContent = "❌ Не могу связаться с сервером";
    return;
  }

  document.getElementById('bet').oninput = updateSpinButton;
  document.querySelectorAll('[data-add]').forEach(b => {
    b.onclick = () => {
      const inp = document.getElementById('bet');
      inp.value = (parseInt(inp.value) || 0) + parseInt(b.dataset.add);
      updateSpinButton();
    };
  });
  document.querySelectorAll('[data-bet]').forEach(b => {
    b.onclick = () => selectBet(b, b.dataset.bet);
  });
  document.querySelectorAll('.mode-btn').forEach(b => {
    b.onclick = () => setMode(b.dataset.mode);
  });
  document.getElementById('spin-btn').onclick = spin;
  document.getElementById('close-btn').onclick = () => tg.close();

  tg.MainButton.setText("🎰 КРУТИТЬ").show().onClick(spin);
}

init();