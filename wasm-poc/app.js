import init, {
  start_game,
  restart_local_match,
  set_paused,
  set_muted,
  set_virtual_keys,
  trigger_action,
  get_metadata,
  hud_state,
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

// Show "← Classic" return link when served under the main game server (/experimental/)
if (location.pathname.startsWith('/experimental')) {
  $('classic-link')?.classList.remove('hidden');
}

// Persist basic pilot preferences
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

function setPauseState(next) {
  if (!wasmStarted || !menuEl.classList.contains('hidden')) return;
  paused = next;
  set_paused(paused);
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

function doRestart() {
  const c = currentConfig();
  paused = false;
  resultsShown = false;
  pauseModal.classList.add('hidden');
  resultsModal.classList.add('hidden');
  menuEl.classList.add('hidden');
  hudLayer.classList.remove('hidden');
  restart_local_match(
    c.driver,
    c.arena,
    c.bots,
    c.playerName,
    c.targetScore,
    c.matchMinutes,
    c.specialAbilities
  );
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
  playBtn.textContent = 'Start Match';
}

$('btn-restart').onclick = doRestart;
$('btn-rematch').onclick = doRestart;
$('btn-lobby').onclick = returnToLobby;
$('btn-results-lobby').onclick = returnToLobby;

window.addEventListener('keydown', e => {
  if (e.code === 'Escape' && wasmStarted && menuEl.classList.contains('hidden') && resultsModal.classList.contains('hidden')) {
    e.preventDefault();
    setPauseState(!paused);
  } else if (e.code === 'KeyM' && document.activeElement !== playerNameEl) {
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
    if (bit) {
      virtualBits |= bit;
      set_virtual_keys(virtualBits);
    } else if (act) {
      trigger_action(act, '');
    }
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

// Clickable HUD weapon/ability slots
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
    if (metaCache.arenas?.length) {
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

  // Arena outline
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(pad, pad, w - pad * 2, h - pad * 2);

  // Water channels (e.g. Seven Bridges of Königsberg)
  if (radar.water?.length) {
    ctx.fillStyle = 'rgba(54, 152, 232, 0.45)';
    for (const [x, z, bw, bd] of radar.water) {
      ctx.fillRect(sx(x - bw / 2), sy(z - bd / 2), sw(bw), sw(bd));
    }
  }
  // Bridges
  if (radar.bridges?.length) {
    ctx.fillStyle = 'rgba(222, 184, 120, 0.85)';
    for (const [x, z, bw, bd] of radar.bridges) {
      ctx.fillRect(sx(x - bw / 2), sy(z - bd / 2), sw(bw), sw(bd));
    }
  }
  // Walls / blocks
  if (radar.blocks?.length) {
    ctx.fillStyle = 'rgba(148, 164, 194, 0.5)';
    for (const [x, z, bw, bd] of radar.blocks) {
      ctx.fillRect(sx(x - bw / 2), sy(z - bd / 2), sw(bw), sw(bd));
    }
  }
  // Supplies
  for (const s of radar.supplies || []) {
    ctx.fillStyle = s.kind === 'health' ? '#ff6688' : s.kind === 'missile' ? '#ff9944' : '#7ae5ff';
    ctx.fillRect(sx(s.wx) - 2, sy(s.wz) - 2, 4, 4);
  }
  // Missiles
  ctx.fillStyle = '#ff3d3d';
  for (const m of radar.missiles || []) {
    ctx.beginPath();
    ctx.arc(sx(m.wx), sy(m.wz), 2.8, 0, Math.PI * 2);
    ctx.fill();
  }
  // Euler Ghost
  for (const g of radar.ghosts || []) {
    ctx.fillStyle = '#9ef7ff';
    ctx.beginPath();
    ctx.arc(sx(g.wx), sy(g.wz), 4.5, 0, Math.PI * 2);
    ctx.fill();
  }
  // Racers
  for (const a of radar.actors || []) {
    if (a.dead) continue;
    const x = sx(a.wx), y = sy(a.wz);
    if (a.me) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-a.heading);
      ctx.fillStyle = '#ffe47a';
      ctx.beginPath();
      ctx.moveTo(0, 6);
      ctx.lineTo(-4.5, -5);
      ctx.lineTo(4.5, -5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    } else {
      ctx.fillStyle = a.color || '#ffffff';
      ctx.beginPath();
      ctx.arc(x, y, 3.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

const fmtClock = s => {
  const n = Math.max(0, Math.floor(s));
  return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
};

playBtn.onclick = async () => {
  if (wasmStarted) {
    doRestart();
    return;
  }
  playBtn.disabled = true;
  const c = currentConfig();
  const t0 = performance.now();
  try {
    statusEl.textContent = '1/2 Loading Bevy WASM engine...';
    await init();
    const tWasm = performance.now() - t0;
    statusEl.textContent = `2/2 Fetching graphics.wwgp + sounds.wwsp... (WASM ready in ${(tWasm / 1000).toFixed(2)}s)`;
    const [respG, respS] = await Promise.all([fetch('./graphics.wwgp'), fetch('./sounds.wwsp')]);
    if (!respG.ok) throw new Error(`graphics.wwgp HTTP ${respG.status}`);
    if (!respS.ok) throw new Error(`sounds.wwsp HTTP ${respS.status}`);
    const [buf, soundBuf] = await Promise.all([
      respG.arrayBuffer().then(b => new Uint8Array(b)),
      respS.arrayBuffer().then(b => new Uint8Array(b)),
    ]);
    const tTotal = performance.now() - t0;

    menuEl.classList.add('hidden');
    hudLayer.classList.remove('hidden');
    wasmStarted = true;
    set_muted(muted);

    // Optional local perf telemetry (only active on wasm-poc/serve.py)
    const canPerfLog = location.port === '8088';
    const matchMeta = {
      driver: c.driver, arena: c.arena, bots: c.bots,
      bootMs: Math.round(tTotal),
      packBytes: buf.byteLength + soundBuf.byteLength,
    };
    const sendLog = payload => {
      if (!canPerfLog) return;
      const body = JSON.stringify({ ...matchMeta, ...payload });
      if (navigator.sendBeacon) navigator.sendBeacon('/perf-log', body);
      else fetch('/perf-log', { method: 'POST', body, keepalive: true }).catch(() => {});
    };

    let frames = 0, last = performance.now(), worst = 0, prev = last;
    function tickHud(now) {
      const dt = now - prev; prev = now;
      if (dt > worst) worst = dt;
      frames++;
      if (now - last >= 500) {
        const fps = (frames * 1000 / (now - last)).toFixed(0);
        perfEl.textContent = `Bevy WASM | ${fps} FPS | worst ${worst.toFixed(1)}ms | ${(tTotal / 1000).toFixed(1)}s boot`;
        frames = 0; worst = 0; last = now;
      }
      populateMetadataFromWasm();
      try {
        const raw = hud_state();
        if (raw) {
          const s = JSON.parse(raw);
          clockEl.textContent = fmtClock(Math.max(0, s.duration - s.elapsed));

          if (s.bridgeCount > 0) {
            bridgesBadge.classList.remove('hidden');
            bridgesBadge.textContent = `BRIDGES ${s.bridgesCrossed}/${s.bridgeCount}`;
          } else {
            bridgesBadge.classList.add('hidden');
          }

          if (s.phase === 'countdown') {
            bannerEl.classList.remove('hidden');
            bannerEl.textContent = Math.max(1, Math.ceil(s.countdown));
          } else if (s.phase === 'finished') {
            bannerEl.classList.add('hidden');
            if (!resultsShown && menuEl.classList.contains('hidden')) {
              resultsShown = true;
              resultsWinner.textContent = s.winner ? `🏆 ${s.winner} Wins!` : 'FINISH!';
              resultsTable.innerHTML = (s.standings || []).map((r, idx) =>
                `<div class="res-row${r.me ? ' me' : ''}"><span>#${idx + 1} <i class="dot" style="background:${r.color}"></i>${r.name}</span><span>${Math.floor(r.kills)} K / ${r.deaths} D</span></div>`
              ).join('');
              resultsModal.classList.remove('hidden');
              sendLog({ event: 'match-finish', elapsed: Math.round(s.elapsed) });
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

          boardEl.innerHTML = (s.standings || []).slice(0, 6).map((r, i) =>
            `<div class="row${r.me ? ' me' : ''}"><span>${i + 1}. <i class="dot" style="background:${r.color}"></i>${r.name}</span><span>${Math.floor(r.kills)}/${r.deaths}</span></div>`
          ).join('');

          killFeedEl.innerHTML = (s.killFeed || []).map(k =>
            `<div class="kf-item">${k.text || `${k.attacker} → ${k.victim}`}</div>`
          ).join('');

          drawRadar(s.radar);
        }
      } catch {}
      requestAnimationFrame(tickHud);
    }
    requestAnimationFrame(tickHud);

    start_game(buf, soundBuf, c.driver, c.arena, c.bots, c.playerName, c.targetScore, c.matchMinutes, c.specialAbilities);
  } catch (e) {
    console.error(e);
    statusEl.textContent = `Error: ${e.message || e}`;
    playBtn.disabled = false;
  }
};
