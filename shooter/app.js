// ═══════════════════════════════════════════════════════════
//  НАСТРОЙКИ
// ═══════════════════════════════════════════════════════════
// ⚡ Адрес туннеля (wss для HTTPS!)
const SERVER_WS = "wss://va1kadav-roulette-backend.loca.lt";

const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); }

let ws = null;
let myId = null;
let gameState = null;
let myPlayer = null;
let isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
let keys = {};
let mouse = { x: 0, y: 0, down: false };
let camera = { x: 0, y: 0 };
let lastMoveSend = 0;
let lastAimSend = 0;
let lastShootSend = 0;

let joyMove = { active: false, dx: 0, dy: 0, touchId: null };
let joyAim = { active: false, dx: 0, dy: 0, touchId: null };

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const $ = id => document.getElementById(id);

const WEAPONS = {
  deagle: { name: 'DEAGLE', mag_size: 7 },
  ak: { name: 'AK-47', mag_size: 30 },
  lmg: { name: 'PULSE', mag_size: 200 },
  awp: { name: 'AWP', mag_size: 10 },
  shotgun: { name: 'SHOTGUN', mag_size: 8 },
  knife: { name: 'KNIFE', mag_size: 999 },
};

function setStatus(text, color = '#888') {
  const el = $('status');
  if (el) { el.textContent = text; el.style.color = color; }
}

// ═══════════════════════════════════════════════════════════
//  ПОДКЛЮЧЕНИЕ
// ═══════════════════════════════════════════════════════════
function connect() {
  const code = $('room-code').value.trim() || 'room1';
  const name = $('player-name').value.trim() || 'Player';
  const mode = $('game-mode').value || '1v1';

  const uid = Math.random().toString(36).substr(2, 9);
  myId = uid;

  setStatus('Подключаюсь...', '#ffaa00');

  const url = `${SERVER_WS}/ws/shooter/${code}/${uid}?name=${encodeURIComponent(name)}&mode=${mode}`;
  console.log('[WS] connecting to', url);

  try {
    ws = new WebSocket(url);
  } catch (e) {
    setStatus('❌ Ошибка: ' + e.message, '#ff3333');
    return;
  }

  ws.onopen = () => {
    setStatus('✅ Подключено', '#33cc33');
    $('menu').style.display = 'none';
    $('game').style.display = 'block';
    resizeCanvas();
    if (isMobile) $('mobile-controls').style.display = 'flex';
    requestAnimationFrame(renderLoop);
  };

  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'welcome') {
        console.log('[WS] welcome:', msg);
      } else if (msg.type === 'state') {
        gameState = msg.data;
        myPlayer = gameState.players.find(p => p.id === myId);
        updateHUD();
      } else if (msg.type === 'error') {
        setStatus('❌ ' + msg.message, '#ff3333');
      }
    } catch (e) { console.error(e); }
  };

  ws.onerror = (e) => {
    setStatus('❌ Ошибка WebSocket', '#ff3333');
    console.error('[WS] error', e);
  };

  ws.onclose = (e) => {
    setStatus('❌ Соединение закрыто (' + e.code + ')', '#ff3333');
    $('menu').style.display = 'flex';
    $('game').style.display = 'none';
  };
}

function send(data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function sendMove(dx, dy) { send({ action: 'move', dx, dy }); }
function sendAim(angle) { send({ action: 'aim', angle }); }
function sendShoot() { send({ action: 'shoot' }); }
function sendReload() { send({ action: 'reload' }); }
function sendWeapon(w) { send({ action: 'switch_weapon', weapon: w }); }
function sendCrouch(v) { send({ action: 'crouch', value: v }); }
function sendScope(v) { send({ action: 'scope', value: v }); }

// ═══════════════════════════════════════════════════════════
//  CANVAS
// ═══════════════════════════════════════════════════════════
function resizeCanvas() {
  const rect = $('game').getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
}
window.addEventListener('resize', resizeCanvas);

// ═══════════════════════════════════════════════════════════
//  ВВОД ПК
// ═══════════════════════════════════════════════════════════
window.addEventListener('keydown', (e) => {
  keys[e.key.toLowerCase()] = true;
  if (e.key === 'r' || e.key === 'R') sendReload();
  if (e.key === 'Control' || e.key === 'c') sendCrouch(true);
  if (e.key >= '1' && e.key <= '6') {
    const list = ['deagle', 'ak', 'lmg', 'awp', 'shotgun', 'knife'];
    const w = list[parseInt(e.key) - 1];
    if (w) { sendWeapon(w); updateWeaponsBar(w); }
  }
  if (e.key === ' ') {
    e.preventDefault();
    sendScope(true);
  }
});

window.addEventListener('keyup', (e) => {
  keys[e.key.toLowerCase()] = false;
  if (e.key === 'Control' || e.key === 'c') sendCrouch(false);
  if (e.key === ' ') sendScope(false);
});

canvas.addEventListener('mousemove', (e) => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
});

canvas.addEventListener('mousedown', (e) => {
  if (e.button === 0) { mouse.down = true; sendShoot(); }
  if (e.button === 2) sendScope(true);
});

canvas.addEventListener('mouseup', (e) => {
  if (e.button === 0) mouse.down = false;
  if (e.button === 2) sendScope(false);
});

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// ═══════════════════════════════════════════════════════════
//  ДЖОЙСТИКИ
// ═══════════════════════════════════════════════════════════
function setupJoysticks() {
  const setup = (joyEl, joyObj) => {
    const stick = joyEl.querySelector('.stick');
    const R = 50;

    const start = (e) => {
      e.preventDefault();
      const touch = e.changedTouches[0];
      joyObj.touchId = touch.identifier;
      joyObj.active = true;
      move(touch);
    };

    const move = (touch) => {
      const rect = joyEl.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      let dx = touch.clientX - cx;
      let dy = touch.clientY - cy;
      const dist = Math.hypot(dx, dy);
      if (dist > R) { dx = dx / dist * R; dy = dy / dist * R; }
      joyObj.dx = dx / R;
      joyObj.dy = dy / R;
      stick.style.transform = `translate(${dx}px, ${dy}px)`;
    };

    const end = (e) => {
      e.preventDefault();
      joyObj.active = false;
      joyObj.dx = 0;
      joyObj.dy = 0;
      joyObj.touchId = null;
      stick.style.transform = '';
    };

    joyEl.addEventListener('touchstart', start, { passive: false });
    joyEl.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier === joyObj.touchId) move(t);
      }
    }, { passive: false });
    joyEl.addEventListener('touchend', end, { passive: false });
    joyEl.addEventListener('touchcancel', end, { passive: false });
  };

  setup($('joy-move'), joyMove);
  setup($('joy-aim'), joyAim);

  $('btn-reload-mobile').addEventListener('touchstart', (e) => {
    e.preventDefault(); sendReload();
  }, { passive: false });

  $('btn-crouch-mobile').addEventListener('touchstart', (e) => {
    e.preventDefault(); sendCrouch(true);
  }, { passive: false });
  $('btn-crouch-mobile').addEventListener('touchend', (e) => {
    e.preventDefault(); sendCrouch(false);
  }, { passive: false });
}

if (isMobile) setupJoysticks();

// ═══════════════════════════════════════════════════════════
//  КНОПКИ ОРУЖИЯ
// ═══════════════════════════════════════════════════════════
document.querySelectorAll('.weapon-btn').forEach(btn => {
  btn.onclick = () => {
    const w = btn.dataset.weapon;
    sendWeapon(w);
    updateWeaponsBar(w);
  };
});

function updateWeaponsBar(weapon) {
  document.querySelectorAll('.weapon-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.weapon === weapon);
  });
}

// ═══════════════════════════════════════════════════════════
//  ИГРОВОЙ ЦИКЛ
// ═══════════════════════════════════════════════════════════
function renderLoop(ts) {
  if (!gameState) {
    requestAnimationFrame(renderLoop);
    return;
  }

  let dx = 0, dy = 0;
  let aimX = 0, aimY = 0;

  if (isMobile) {
    dx = joyMove.dx;
    dy = joyMove.dy;
    aimX = joyAim.dx;
    aimY = joyAim.dy;
  } else {
    if (keys['w']) dy -= 1;
    if (keys['s']) dy += 1;
    if (keys['a']) dx -= 1;
    if (keys['d']) dx += 1;
  }

  if ((dx !== 0 || dy !== 0) && ts - lastMoveSend > 33) {
    sendMove(dx, dy);
    lastMoveSend = ts;
  }

  if (myPlayer) {
    let angle = myPlayer.angle;
    if (isMobile && (aimX !== 0 || aimY !== 0)) {
      angle = Math.atan2(aimY, aimX);
    } else if (!isMobile) {
      const wx = mouse.x + camera.x;
      const wy = mouse.y + camera.y;
      angle = Math.atan2(wy - myPlayer.y, wx - myPlayer.x);
    }

    if (ts - lastAimSend > 33) {
      sendAim(angle);
      lastAimSend = ts;
    }

    if (mouse.down && !isMobile && ts - lastShootSend > 100) {
      sendShoot();
      lastShootSend = ts;
    }

    if (isMobile && Math.hypot(aimX, aimY) > 0.7 && ts - lastShootSend > 100) {
      sendShoot();
      lastShootSend = ts;
    }
  }

  render();
  requestAnimationFrame(renderLoop);
}

// ═══════════════════════════════════════════════════════════
//  ОТРИСОВКА
// ═══════════════════════════════════════════════════════════
function render() {
  const W = canvas.width;
  const H = canvas.height;

  if (myPlayer) {
    camera.x = myPlayer.x - W / 2;
    camera.y = myPlayer.y - H / 2;
  }

  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.translate(-camera.x, -camera.y);

  const arena = gameState.arena || [1200, 800];
  const walls = gameState.walls || [];

  ctx.fillStyle = '#2a2a2a';
  ctx.fillRect(0, 0, arena[0], arena[1]);

  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  for (let x = 0; x < arena[0]; x += 50) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, arena[1]); ctx.stroke();
  }
  for (let y = 0; y < arena[1]; y += 50) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(arena[0], y); ctx.stroke();
  }

  ctx.fillStyle = '#4a4a4a';
  for (const [x, y, w, h] of walls) {
    ctx.fillRect(x, y, w, h);
  }

  // пули
  for (const b of (gameState.bullets || [])) {
    ctx.beginPath();
    ctx.arc(b.x, b.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#ffdd33';
    ctx.shadowColor = '#ffdd33';
    ctx.shadowBlur = 12;
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  // игроки
  for (const p of (gameState.players || [])) {
    if (!p.alive) continue;

    let color = p.color;
    if (p.id === myId) color = '#ffaa33';

    ctx.beginPath();
    ctx.arc(p.x, p.y + 2, 16, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fill();

    const r = p.crouching ? 11 : 15;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.fill();
    ctx.shadowBlur = 0;

    // ствол
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(
      p.x + 25 * Math.cos(p.angle),
      p.y + 25 * Math.sin(p.angle)
    );
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 4;
    ctx.stroke();

    // имя
    ctx.font = 'bold 13px sans-serif';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.fillText(p.name, p.x, p.y - 25);

    // hp
    const hpW = 40;
    const hpX = p.x - hpW / 2;
    const hpY = p.y - 40;
    ctx.fillStyle = '#333';
    ctx.fillRect(hpX, hpY, hpW, 4);
    ctx.fillStyle = p.hp > 50 ? '#33cc33' : p.hp > 25 ? '#ffaa33' : '#ff3333';
    ctx.fillRect(hpX, hpY, hpW * (p.hp / 100), 4);
  }

  ctx.restore();

  if (myPlayer && !myPlayer.alive) {
    $('respawn').style.display = 'block';
    const left = Math.max(0, Math.ceil((myPlayer.respawn_at || 0)));
    $('respawn-timer').textContent = left;
  } else {
    $('respawn').style.display = 'none';
  }
}

function updateHUD() {
  if (!myPlayer) return;
  $('hp-fill').style.width = myPlayer.hp + '%';
  $('hp-text').textContent = myPlayer.hp;
  const w = WEAPONS[myPlayer.weapon] || WEAPONS.deagle;
  $('weapon-name').textContent = w.name;
  $('ammo').textContent = myPlayer.reloading
    ? 'ПЕРЕЗАРЯДКА'
    : `${myPlayer.ammo} / ${w.mag_size}`;
  $('kills-text').textContent = `${myPlayer.kills} / ${myPlayer.deaths}`;
  updateWeaponsBar(myPlayer.weapon);
}

// ═══════════════════════════════════════════════════════════
//  КНОПКИ МЕНЮ
// ═══════════════════════════════════════════════════════════
$('btn-connect').onclick = connect;

$('btn-share').onclick = () => {
  const code = $('room-code').value.trim() || 'room1';
  const url = `${location.origin}${location.pathname}?room=${code}`;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(url);
    setStatus('✅ Ссылка скопирована!', '#33cc33');
  } else {
    setStatus('Ссылка: ' + url, '#ffaa00');
  }
};

const urlParams = new URLSearchParams(location.search);
if (urlParams.get('room')) {
  $('room-code').value = urlParams.get('room');
}
