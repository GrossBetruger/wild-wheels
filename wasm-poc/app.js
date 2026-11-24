import init, {
  start_game,
  restart_local_match,
  set_paused,
  set_muted,
  set_input_blocked,
  set_network_mode,
  accept_net_packet,
  poll_net_outbound,
  set_virtual_keys,
  trigger_action,
  get_metadata,
  hud_state,
  take_invalid_packets,
} from './pkg/wild_wheels_wasm_poc.js';

const $ = id => document.getElementById(id);
const menuEl = $('menu');
const hudLayer = $('hud-layer');
const pauseModal = $('pause-modal');
const resultsModal = $('results-modal');
const statusEl = $('status');
const playBtn = $('play');
const playerNameEl = $('player-name');
const driverEl = $('driver');
const driverMetaEl = $('driver-meta');
const arenaEl = $('arena');
const botsEl = $('bots');
const botsVal = $('bots-val');
const scoreEl = $('target-score');
const scoreVal = $('score-val');
const minsEl = $('match-minutes');
const minsVal = $('mins-val');
const specialsEl = $('special-abilities');
const modeTabsEl = $('mode-tabs');
const tabOnline = $('tab-online');
const tabSolo = $('tab-solo');
const allTimeBox = $('alltime-box');
const allTimeList = $('alltime-list');

const perfEl = $('perf');
const boardEl = $('board');
const clockEl = $('clock');
const bridgesBadge = $('bridges-badge');
const noticeEl = $('notice');
const bannerEl = $('center-banner');
const heartsEl = $('hearts');
const buffsEl = $('buffs');
const loadoutEl = $('loadout');
const speedEl = $('speed');
const meterFill = $('meter-fill');
const killFeedEl = $('kill-feed');
const radarCanvas = $('radar');
const radarCtx = radarCanvas.getContext('2d');
const resultsWinner = $('results-winner');
const resultsTable = $('results-table');
const hudStartOnline = $('hud-start-online');
const hudChatBtn = $('hud-chat-btn');
const chatBox = $('chat-box');
const chatLog = $('chat-log');
const chatForm = $('chat-form');
const chatInput = $('chat-input');

if (location.pathname.startsWith('/experimental')) {
  $('classic-link')?.classList.remove('hidden');
}

playerNameEl.value = localStorage.getItem('ww_wasm_name') || 'WASM Pilot';
const savedDriver = localStorage.getItem('ww_wasm_driver');
if (savedDriver !== null) driverEl.value = savedDriver;
const savedArena = localStorage.getItem('ww_wasm_arena');
if (savedArena !== null) arenaEl.value = savedArena;

botsEl.oninput = () => { botsVal.textContent = botsEl.value; };
scoreEl.oninput = () => { scoreVal.textContent = scoreEl.value; };
minsEl.oninput = () => { minsVal.textContent = minsEl.value; };

let wasmStarted = false;
let paused = false;
let muted = localStorage.getItem('ww_wasm_muted') === '1';
let resultsShown = false;
let metaCache = null;
let virtualBits = 0;

// Online multiplayer state
let serverAvailable = false;
let onlineSelected = false;
let activeOnline = false;
let netToken = null;
let netSocket = null;
let netSendTimer = null;
let chatTimer = null;
let chatCursor = 0;
let lastPing = 0;
let lastPacketAt = 0;
let rtt = 0;

const client = 'bevy-wasm';
const logger = location.pathname.startsWith('/experimental/')
  ? await import('/client/log.js').catch(() => null)
  : null;
const clientLog = logger && new logger.ClientLog({ client });
const frameHealth = logger && new logger.FrameHealth((level, event, data) => clientLog.note(level, event, data));
let flushLog;

function reportProblem(event, stage, error, details = {}) {
  if (!clientLog) return;
  let message = String(error?.message ?? error ?? '');
  for (const secret of [netToken, new URLSearchParams(location.hash.slice(1)).get('invite')]) {
    if (secret) message = message.replaceAll(secret, '[redacted]');
  }
  message = message.replace(/https?:\/\/[^\s)]+/gi, '[url]');
  clientLog.limited(`${event}:${stage}`, 15000, 'error', event, {
    stage, message, status: error?.status, ...details,
  });
}

if (clientLog) {
  addEventListener('error', event => {
    reportProblem('js-error', 'runtime', event.error ?? event.message, {
      line: event.lineno, column: event.colno,
    });
  });
  addEventListener('unhandledrejection', event => reportProblem('js-rejection', 'runtime', event.reason));
  $('bevy-canvas').addEventListener('webglcontextlost', () => clientLog.note('error', 'graphics-lost'));
  addEventListener('pagehide', () => frameHealth.frame(performance.now(), false, lastPacketAt, rtt));
  flushLog = logger.startReporting(clientLog, { token: () => netToken });
  fetch('/build.json', { signal: AbortSignal.timeout(3000) })
    .then(response => response.ok ? response.json() : null)
    .then(info => { if (typeof info?.build === 'string') clientLog.build = info.build.slice(0, 64); })
    .catch(() => {});
}

function setModeUI(isOnline) {
  onlineSelected = isOnline && serverAvailable;
  tabOnline.classList.toggle('active', onlineSelected);
  tabSolo.classList.toggle('active', !onlineSelected);
  playBtn.textContent = onlineSelected ? 'Join Online Arena' : (wasmStarted ? 'Start Solo Match' : 'Launch Bevy WASM');
}

tabOnline.onclick = () => setModeUI(true);
tabSolo.onclick = () => setModeUI(false);

// Auto-detect live Wild Wheels server & load all-time leaderboard
async function probeServer() {
  try {
    const resp = await fetch('/api/info', { signal: AbortSignal.timeout(1500) });
    if (!resp.ok) return;
    const info = await resp.json();
    if (!info || typeof info.room !== 'string') return;
    serverAvailable = true;
    modeTabsEl.classList.remove('hidden');
    if (Array.isArray(info.arenas) && info.arenas.length) {
      const curA = arenaEl.value;
      arenaEl.innerHTML = info.arenas.map((a, idx) =>
        `<option value="${idx}">${idx} · ${a.name}</option>`
      ).join('');
      arenaEl.value = curA;
    }
    setModeUI(true);
    statusEl.textContent = `Connected to Wild Wheels server (Room ${info.room}). Choose Online Arena or Solo vs Bots.`;
    // Load All-Time Leaderboard
    try {
      const lb = await fetch('/api/leaderboard', { cache: 'no-store', signal: AbortSignal.timeout(2500) });
      if (lb.ok) {
        const data = await lb.json();
        const players = data.players || data.entries || [];
        if (players.length) {
          allTimeBox.classList.remove('hidden');
          allTimeList.innerHTML = players.slice(0, 10).map((p, i) =>
            `<div class="at-row"><span>${i + 1}. ${p.name || 'Pilot'}</span><span>${p.wins ?? 0}W · ${Math.floor(p.kills ?? 0)}K</span></div>`
          ).join('');
        }
      }
    } catch {}
  } catch {}
}
probeServer();

function syncMuteUI() {
  const icon = muted ? '🔇' : '🔊';
  $('menu-mute').textContent = icon;
  $('hud-mute').textContent = icon;
  $('btn-mute-modal').textContent = `${icon} Sound: ${muted ? 'OFF' : 'ON'}`;
  localStorage.setItem('ww_wasm_muted', muted ? '1' : '0');
  if (wasmStarted) set_muted(muted);
}
syncMuteUI();

function toggleMute() {
  muted = !muted;
  syncMuteUI();
}
$('menu-mute').onclick = toggleMute;
$('hud-mute').onclick = toggleMute;
$('btn-mute-modal').onclick = toggleMute;

async function apiPost(path, body) {
  const resp = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(netToken ? { Authorization: `Bearer ${netToken}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(4000),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw Object.assign(new Error(data.error || `HTTP ${resp.status}`), { status: resp.status });
  return data;
}

function disconnectOnline(notify = false) {
  activeOnline = false;
  if (netSendTimer) { clearInterval(netSendTimer); netSendTimer = null; }
  if (chatTimer) { clearInterval(chatTimer); chatTimer = null; }
  if (netSocket) { try { netSocket.close(); } catch {} netSocket = null; }
  if (notify && netToken) apiPost('/api/leave', {}).catch(() => {});
  hudStartOnline.classList.add('hidden');
  hudChatBtn.classList.add('hidden');
  chatBox.classList.add('hidden');
}

async function pollChat() {
  if (!activeOnline || !netToken) return;
  try {
    const res = await apiPost('/api/chat', { after: chatCursor });
    const msgs = res.messages || [];
    for (const m of msgs) {
      if (m.id > chatCursor) chatCursor = m.id;
      if (m.deleted) continue;
      const line = document.createElement('div');
      line.className = 'chat-line';
      const strong = document.createElement('strong');
      strong.textContent = `${m.name || 'Pilot'}:`;
      if (m.color) strong.style.color = m.color;
      line.append(strong, document.createTextNode(m.text || ''));
      chatLog.append(line);
      while (chatLog.children.length > 30) chatLog.firstChild.remove();
      chatLog.scrollTop = chatLog.scrollHeight;
    }
  } catch {}
}

chatInput.addEventListener('focus', () => { if (wasmStarted) set_input_blocked(true); });
chatInput.addEventListener('blur', () => { if (wasmStarted) set_input_blocked(false); });
playerNameEl.addEventListener('focus', () => { if (wasmStarted) set_input_blocked(true); });
playerNameEl.addEventListener('blur', () => { if (wasmStarted) set_input_blocked(false); });

chatForm.onsubmit = async e => {
  e.preventDefault();
  const text = chatInput.value.trim();
  chatInput.value = '';
  chatInput.blur();
  if (!text || !activeOnline) return;
  try {
    await apiPost('/api/chat', { after: chatCursor, text, to: null });
    pollChat();
  } catch {}
};

hudChatBtn.onclick = () => {
  chatBox.classList.toggle('hidden');
  if (!chatBox.classList.contains('hidden')) chatInput.focus();
};

hudStartOnline.onclick = async () => {
  if (!activeOnline) return;
  const c = currentConfig();
  try {
    await apiPost('/api/driver', { driver: c.driver }).catch(() => {});
    await apiPost('/api/control', { action: 'arena', arena: c.arena }).catch(() => {});
    await apiPost('/api/control', { action: 'bots', bots: c.bots }).catch(() => {});
    await apiPost('/api/control', { action: 'start' });
  } catch (e) {
    reportProblem('control-failed', 'start-battle', e);
    console.warn('start battle error:', e);
  }
};

async function joinOnline(c) {
  let reply;
  const invite = new URLSearchParams(location.hash.slice(1)).get('invite') || '';
  const code = new URL(location.href).searchParams.get('room') || '00';
  try {
    reply = await apiPost('/api/session', {});
  } catch {
    reply = await apiPost('/api/join', {
      name: c.playerName,
      driver: c.driver,
      role: 'driver',
      arena: c.arena,
      bots: c.bots,
      code: code.toUpperCase(),
      invite,
    });
  }
  netToken = reply.token || netToken;
}

async function connectOnline(c) {
  disconnectOnline(false);
  set_network_mode(true);
  await joinOnline(c);
  // Apply chosen driver if room is between matches
  await apiPost('/api/driver', { driver: c.driver }).catch(() => {});

  activeOnline = true;
  chatCursor = 0;
  chatLog.innerHTML = '';
  hudChatBtn.classList.remove('hidden');

  const wsUrl = new URL('/api/socket', location.href);
  wsUrl.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const sock = new WebSocket(wsUrl);
  sock.binaryType = 'arraybuffer';
  netSocket = sock;
  const openedAt = performance.now();
  lastPacketAt = openedAt;
  lastPing = 0;
  rtt = 0;

  sock.onopen = () => {
    if (netSocket !== sock) return;
    sock.send(JSON.stringify({ type: 'authenticate', token: netToken, client }));
  };
  sock.onmessage = ev => {
    if (netSocket !== sock) return;
    if (ev.data instanceof ArrayBuffer) {
      lastPacketAt = performance.now();
      accept_net_packet(new Uint8Array(ev.data));
      return;
    }
    try {
      const message = JSON.parse(ev.data);
      if (message.type === 'pong' && Number.isFinite(message.sent)) {
        rtt = Math.max(0, performance.now() / 1000 - message.sent);
      }
    } catch (error) {
      reportProblem('socket-message-invalid', 'socket', error.name);
    }
  };
  sock.onerror = () => {
    if (netSocket === sock) clientLog?.limited('socket-error', 15000, 'warn', 'socket-error');
  };
  sock.onclose = event => {
    if (netSocket !== sock || !activeOnline) return;
    const now = performance.now();
    clientLog?.limited('socket-closed', 15000, 'warn', 'socket-closed', {
      code: event.code, clean: event.wasClean, openSeconds: (now - openedAt) / 1000,
      waitingBytes: sock.bufferedAmount, sinceServerMs: Math.round(now - lastPacketAt),
    });
    setTimeout(() => {
      if (netSocket === sock && activeOnline) {
        connectOnline(currentConfig()).catch(error => reportProblem('reconnect-failed', 'socket', error));
      }
    }, 1000);
  };

  netSendTimer = setInterval(() => {
    if (!activeOnline || netSocket !== sock || sock.readyState !== WebSocket.OPEN || sock.bufferedAmount > 16384) return;
    const now = performance.now() / 1000;
    if (now - lastPing >= 1.0) {
      lastPing = now;
      netSocket.send(JSON.stringify({ type: 'ping', sent: now }));
    }
    const out = poll_net_outbound();
    if (out) netSocket.send(out);
  }, 33);

  chatTimer = setInterval(pollChat, 1500);
  pollChat();
}

function setPauseState(next) {
  if (!wasmStarted || !menuEl.classList.contains('hidden')) return;
  paused = next;
  set_paused(paused);
  if (activeOnline) apiPost('/api/afk', { afk: paused }).catch(() => {});
  pauseModal.classList.toggle('hidden', !paused);
}

$('hud-pause').onclick = () => setPauseState(!paused);
$('btn-resume').onclick = () => setPauseState(false);

function currentConfig() {
  const name = (playerNameEl.value || 'WASM Pilot').trim().slice(0, 18);
  localStorage.setItem('ww_wasm_name', name);
  localStorage.setItem('ww_wasm_driver', driverEl.value);
  localStorage.setItem('ww_wasm_arena', arenaEl.value);
  return {
    driver: +driverEl.value,
    arena: +arenaEl.value,
    bots: +botsEl.value,
    playerName: name,
    targetScore: +scoreEl.value,
    matchMinutes: +minsEl.value,
    specialAbilities: specialsEl.checked,
  };
}

async function doRestart() {
  const c = currentConfig();
  paused = false;
  resultsShown = false;
  pauseModal.classList.add('hidden');
  resultsModal.classList.add('hidden');
  menuEl.classList.add('hidden');
  hudLayer.classList.remove('hidden');
  if (onlineSelected) {
    try {
      if (!activeOnline) {
        await connectOnline(c);
      } else {
        await apiPost('/api/driver', { driver: c.driver }).catch(() => {});
        await apiPost('/api/control', { action: 'arena', arena: c.arena }).catch(() => {});
        await apiPost('/api/control', { action: 'bots', bots: c.bots }).catch(() => {});
        await apiPost('/api/control', { action: 'start' }).catch(() => {});
      }
    } catch (e) {
      reportProblem('control-failed', 'restart', e);
      statusEl.textContent = `Online error: ${e.message}`;
      returnToLobby();
      return;
    }
  } else {
    disconnectOnline(true);
    set_network_mode(false);
    restart_local_match(
      c.driver, c.arena, c.bots, c.playerName,
      c.targetScore, c.matchMinutes, c.specialAbilities
    );
  }
  $('bevy-canvas').focus();
}

function returnToLobby() {
  paused = true;
  resultsShown = false;
  if (wasmStarted) set_paused(true);
  pauseModal.classList.add('hidden');
  resultsModal.classList.add('hidden');
  hudLayer.classList.add('hidden');
  menuEl.classList.remove('hidden');
  playBtn.disabled = false;
  setModeUI(onlineSelected);
}

$('btn-restart').onclick = doRestart;
$('btn-rematch').onclick = doRestart;
$('btn-lobby').onclick = returnToLobby;
$('btn-results-lobby').onclick = returnToLobby;

window.addEventListener('keydown', e => {
  const typing = document.activeElement === chatInput || document.activeElement === playerNameEl;
  if (e.code === 'Escape') {
    if (typing) { document.activeElement.blur(); return; }
    if (wasmStarted && menuEl.classList.contains('hidden') && resultsModal.classList.contains('hidden')) {
      e.preventDefault();
      setPauseState(!paused);
    }
  } else if (e.code === 'Enter' && activeOnline && !typing && menuEl.classList.contains('hidden')) {
    e.preventDefault();
    chatBox.classList.remove('hidden');
    chatInput.focus();
  } else if (e.code === 'KeyM' && !typing) {
    toggleMute();
  }
});

// Touch controls wiring
for (const btn of document.querySelectorAll('#touch-controls .tbtn')) {
  const bit = btn.dataset.bit ? +btn.dataset.bit : 0;
  const act = btn.dataset.act || '';
  const press = e => {
    e.preventDefault();
    if (!wasmStarted) return;
    if (bit) { virtualBits |= bit; set_virtual_keys(virtualBits); }
    else if (act) trigger_action(act, '');
  };
  const release = e => {
    e.preventDefault();
    if (!wasmStarted || !bit) return;
    virtualBits &= ~bit;
    set_virtual_keys(virtualBits);
  };
  btn.addEventListener('pointerdown', press);
  btn.addEventListener('pointerup', release);
  btn.addEventListener('pointercancel', release);
  btn.addEventListener('pointerleave', release);
}

loadoutEl.addEventListener('click', e => {
  const btn = e.target.closest('[data-act]');
  if (!btn || !wasmStarted) return;
  trigger_action(btn.dataset.act, btn.dataset.item || '');
});

function updateDriverMeta() {
  if (!metaCache) return;
  const d = metaCache.drivers.find(x => x.id === +driverEl.value);
  if (!d) { driverMetaEl.textContent = ''; return; }
  driverMetaEl.innerHTML = `<span>${d.description || ''}</span>${d.ability ? `<span class="ability-tag">★ ${d.ability}</span>` : ''}`;
}
driverEl.onchange = updateDriverMeta;

function populateMetadataFromWasm() {
  if (metaCache) return;
  try {
    const raw = get_metadata();
    if (!raw) return;
    metaCache = JSON.parse(raw);
    if (metaCache.drivers?.length) {
      const cur = driverEl.value;
      driverEl.innerHTML = metaCache.drivers.map(d =>
        `<option value="${d.id}">${d.id} · ${d.name}${d.blender ? ' ✨ 3D PBR' : ''}</option>`
      ).join('');
      driverEl.value = cur;
      updateDriverMeta();
    }
    if (metaCache.arenas?.length && !serverAvailable) {
      const curA = arenaEl.value;
      arenaEl.innerHTML = metaCache.arenas.map(a =>
        `<option value="${a.id}">${a.id} · ${a.name}</option>`
      ).join('');
      arenaEl.value = curA;
    }
  } catch {}
}

function drawRadar(radar) {
  if (!radar || !radar.size) return;
  const w = radarCanvas.width, h = radarCanvas.height;
  const ctx = radarCtx;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(12, 16, 26, 0.78)';
  ctx.fillRect(0, 0, w, h);

  const half = radar.size * 0.52;
  const pad = 10;
  const sx = x => pad + ((x + half) / (half * 2)) * (w - pad * 2);
  const sy = z => pad + ((z + half) / (half * 2)) * (h - pad * 2);
  const sw = v => (v / (half * 2)) * (w - pad * 2);

  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(pad, pad, w - pad * 2, h - pad * 2);

  if (radar.water?.length) {
    ctx.fillStyle = 'rgba(54, 152, 232, 0.45)';
    for (const [x, z, bw, bd] of radar.water) ctx.fillRect(sx(x - bw / 2), sy(z - bd / 2), sw(bw), sw(bd));
  }
  if (radar.bridges?.length) {
    ctx.fillStyle = 'rgba(222, 184, 120, 0.85)';
    for (const [x, z, bw, bd] of radar.bridges) ctx.fillRect(sx(x - bw / 2), sy(z - bd / 2), sw(bw), sw(bd));
  }
  if (radar.blocks?.length) {
    ctx.fillStyle = 'rgba(148, 164, 194, 0.5)';
    for (const [x, z, bw, bd] of radar.blocks) ctx.fillRect(sx(x - bw / 2), sy(z - bd / 2), sw(bw), sw(bd));
  }
  for (const s of radar.supplies || []) {
    ctx.fillStyle = s.kind === 'health' ? '#ff6688' : s.kind === 'missile' ? '#ff9944' : '#7ae5ff';
    ctx.fillRect(sx(s.wx) - 2, sy(s.wz) - 2, 4, 4);
  }
  ctx.fillStyle = '#ff3d3d';
  for (const m of radar.missiles || []) {
    ctx.beginPath(); ctx.arc(sx(m.wx), sy(m.wz), 2.8, 0, Math.PI * 2); ctx.fill();
  }
  for (const g of radar.ghosts || []) {
    ctx.fillStyle = '#9ef7ff';
    ctx.beginPath(); ctx.arc(sx(g.wx), sy(g.wz), 4.5, 0, Math.PI * 2); ctx.fill();
  }
  for (const a of radar.actors || []) {
    if (a.dead) continue;
    const x = sx(a.wx), y = sy(a.wz);
    if (a.me) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-a.heading);
      ctx.fillStyle = '#ffe47a';
      ctx.beginPath();
      ctx.moveTo(0, 6); ctx.lineTo(-4.5, -5); ctx.lineTo(4.5, -5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    } else {
      ctx.fillStyle = a.color || '#ffffff';
      ctx.beginPath(); ctx.arc(x, y, 3.6, 0, Math.PI * 2); ctx.fill();
    }
  }
}

const fmtClock = s => {
  const n = Math.max(0, Math.floor(s));
  return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
};

playBtn.onclick = async () => {
  if (wasmStarted) {
    await doRestart();
    return;
  }
  playBtn.disabled = true;
  const c = currentConfig();
  const online = onlineSelected;
  const t0 = performance.now();
  let stage = 'wasm';
  try {
    statusEl.textContent = '1/2 Loading Bevy WASM engine...';
    const wasmStart = performance.now();
    await init();
    const tWasm = performance.now() - wasmStart;
    stage = 'assets';
    const assetStart = performance.now();
    statusEl.textContent = `2/2 Fetching graphics.wwgp + sounds.wwsp... (WASM ready in ${(tWasm / 1000).toFixed(2)}s)`;
    const [respG, respS] = await Promise.all([fetch('./graphics.wwgp'), fetch('./sounds.wwsp')]);
    if (!respG.ok) throw new Error(`graphics.wwgp HTTP ${respG.status}`);
    if (!respS.ok) throw new Error(`sounds.wwsp HTTP ${respS.status}`);
    const [buf, soundBuf] = await Promise.all([
      respG.arrayBuffer().then(b => new Uint8Array(b)),
      respS.arrayBuffer().then(b => new Uint8Array(b)),
    ]);
    const assetMs = performance.now() - assetStart;
    const graphicsBytes = buf.byteLength;
    const soundBytes = soundBuf.byteLength;

    stage = 'connection';
    if (online) await connectOnline(c);

    stage = 'renderer';
    set_muted(muted);
    start_game(buf, soundBuf, c.driver, c.arena, c.bots, c.playerName, c.targetScore, c.matchMinutes, c.specialAbilities);
    menuEl.classList.add('hidden');
    hudLayer.classList.remove('hidden');
    wasmStarted = true;

    let firstHud = true;
    let frames = 0, last = performance.now(), worst = 0, prev = last;
    function tickHud(now) {
      const dt = now - prev; prev = now;
      if (dt > worst) worst = dt;
      frames++;
      if (now - last >= 500) {
        const fps = (frames * 1000 / (now - last)).toFixed(0);
        const tag = activeOnline ? 'ONLINE' : 'SOLO';
        perfEl.textContent = `Bevy WASM · ${tag} | ${fps} FPS | worst ${worst.toFixed(1)}ms`;
        const invalidPackets = take_invalid_packets();
        if (invalidPackets) clientLog?.limited('packet-invalid', 15000, 'warn', 'packet-invalid', { invalidPackets });
        frames = 0; worst = 0; last = now;
      }
      populateMetadataFromWasm();
      try {
        const raw = hud_state();
        if (raw) {
          const s = JSON.parse(raw);
          if (firstHud) {
            firstHud = false;
            if (online) clientLog?.note('info', 'bevy-startup', {
              wasmMs: tWasm, assetMs, firstHudMs: now - t0, graphicsBytes, soundBytes,
            });
          }
          frameHealth?.frame(now, activeOnline && s.phase === 'racing' && !document.hidden,
            lastPacketAt, rtt, { match: s.match, seconds: s.elapsed });
          clockEl.textContent = fmtClock(Math.max(0, s.duration - s.elapsed));

          if (s.bridgeCount > 0) {
            bridgesBadge.classList.remove('hidden');
            bridgesBadge.textContent = `BRIDGES ${s.bridgesCrossed}/${s.bridgeCount}`;
          } else {
            bridgesBadge.classList.add('hidden');
          }

          hudStartOnline.classList.toggle('hidden', !(activeOnline && (s.phase === 'ready' || s.phase === 'finished')));

          if (s.phase === 'ready' && activeOnline) {
            bannerEl.classList.remove('hidden');
            bannerEl.textContent = 'PRESS START BATTLE ↗';
          } else if (s.phase === 'countdown') {
            resultsShown = false;
            resultsModal.classList.add('hidden');
            bannerEl.classList.remove('hidden');
            bannerEl.textContent = Math.max(1, Math.ceil(s.countdown));
          } else if (s.phase === 'finished') {
            bannerEl.classList.add('hidden');
            if (!resultsShown && menuEl.classList.contains('hidden')) {
              resultsShown = true;
              resultsWinner.textContent = s.winner ? `🏆 ${s.winner} Wins!` : 'FINISH!';
              resultsTable.replaceChildren(...(s.standings || []).map((r, idx) => {
                const row = document.createElement('div');
                row.className = `res-row${r.me ? ' me' : ''}`;
                const left = document.createElement('span');
                const dot = document.createElement('i');
                dot.className = 'dot';
                dot.style.backgroundColor = r.color || '#ffffff';
                left.append(`#${idx + 1} `, dot, r.name || 'Bot');
                const right = document.createElement('span');
                right.textContent = `${Math.floor(r.kills)} K / ${r.deaths} D`;
                row.append(left, right);
                return row;
              }));
              resultsModal.classList.remove('hidden');
            }
          } else if (s.destroyed > 0) {
            bannerEl.classList.remove('hidden');
            bannerEl.textContent = `RESPAWN ${s.destroyed.toFixed(1)}s`;
          } else {
            bannerEl.classList.add('hidden');
          }

          if (s.notice && s.noticeTime > 0) {
            noticeEl.classList.remove('hidden');
            noticeEl.textContent = s.notice;
          } else {
            noticeEl.classList.add('hidden');
          }

          const hp = Math.max(0, Math.round(s.health));
          heartsEl.textContent = '♥'.repeat(hp) + '♡'.repeat(Math.max(0, 3 - hp));

          const buffs = [];
          if (s.shield > 0) buffs.push(`<span class="buff">🛡 ${s.shield.toFixed(0)}s</span>`);
          if (s.hedgeShield > 0) buffs.push(`<span class="buff">🦔 ${s.hedgeShield.toFixed(0)}s</span>`);
          if (s.vulcan > 0) buffs.push(`<span class="buff fire">🔥 VULCAN ${s.vulcan.toFixed(0)}s</span>`);
          if (s.nightmareActive > 0) buffs.push(`<span class="buff fire">🚀 NIGHTMARE</span>`);
          buffsEl.innerHTML = buffs.join('');

          const spCd = s.specialCooldown > 0 ? `${Math.ceil(s.specialCooldown)}s` : 'READY';
          const spClass = s.specialCooldown > 0 ? 'slot cd' : 'slot active';
          const bombCount = (s.bombAmmo || 0) + (s.stinkAmmo || 0);
          loadoutEl.innerHTML = [
            `<button class="slot${s.item === 'hedgehog' ? ' active' : ''}" data-act="select" data-item="hedgehog">1 · 🦔 ${s.ammo}</button>`,
            `<button class="slot${s.item === 'missile' ? ' active' : ''}" data-act="select" data-item="missile">2 · 🚀 ${s.missiles}</button>`,
            bombCount > 0 ? `<button class="slot" data-act="bomb">B · 💣 ${bombCount}</button>` : '',
            `<button class="slot" data-act="turbo">X · ⚡ ${s.turbos}</button>`,
            `<button class="slot" data-act="chaff">C · ✦ ${s.chaff}</button>`,
            `<button class="${spClass}" data-act="special">F · ★ ${spCd}</button>`,
          ].join('');

          const kmh = Math.round(Math.abs(s.speed || 0) * 0.45);
          speedEl.innerHTML = `${kmh}<small>km/h</small>`;
          const fillPct = s.wasDrifting ? Math.min(100, (s.drift || 0) * 55) : Math.min(100, (kmh / 240) * 100);
          meterFill.style.width = `${fillPct}%`;

          boardEl.replaceChildren(...(s.standings || []).slice(0, 6).map((r, i) => {
            const row = document.createElement('div');
            row.className = `row${r.me ? ' me' : ''}`;
            const left = document.createElement('span');
            const dot = document.createElement('i');
            dot.className = 'dot';
            dot.style.backgroundColor = r.color || '#ffffff';
            left.append(`${i + 1}. `, dot, r.name || 'Bot');
            const right = document.createElement('span');
            right.textContent = `${Math.floor(r.kills)}/${r.deaths}`;
            row.append(left, right);
            return row;
          }));

          killFeedEl.innerHTML = (s.killFeed || []).map(k =>
            `<div class="kf-item">${k.text || `${k.attacker} → ${k.victim}`}</div>`
          ).join('');

          drawRadar(s.radar);
        }
      } catch (error) { reportProblem('hud-error', 'hud', error); }
      requestAnimationFrame(tickHud);
    }
    requestAnimationFrame(tickHud);
  } catch (e) {
    reportProblem('bevy-startup-failed', stage, e);
    statusEl.textContent = `Error: ${e.message || e}`;
    if (online && clientLog && !netToken && stage !== 'connection') {
      // The player picked Online. Try to get a session for the startup report.
      await joinOnline(c).catch(() => {});
    }
    if (online && netToken) {
      // Send startup failures while the room still recognizes this session.
      await flushLog?.();
      disconnectOnline(true);
      netToken = null;
    }
    console.error(e);
    playBtn.disabled = false;
  }
};
