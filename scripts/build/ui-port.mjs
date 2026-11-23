// Ports the browser client's HTML/CSS announcements and reward cards to
// transparent RGBA textures for the native Rust client.
//
// The real unmodified `style.css` and `ui/ability-announcements.js` stay the
// single source of truth: headless Chrome renders every themed card (gradients,
// double/dashed borders, glowing shadows, and color emoji icons) into a compact
// zlib-compressed WWUP pack embedded by `native-client/build.rs`.
import {spawn} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {deflateSync, inflateSync} from 'node:zlib';
import WebSocket from 'ws';
import {abilityCards} from '../../ui/ability-announcements.js';

export const UI_PACK_VERSION = 1;
const ROOT = resolve(import.meta.dirname, '../..');
const SCALE = 2;
const GLOW_PAD = 42;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

export function findChrome() {
  return CHROME_CANDIDATES.find(path => existsSync(path)) ?? null;
}

/// Complete catalog of themed HTML/CSS announcement cards derived directly from
/// `ui/ability-announcements.js` plus the multi-ability & reward variants.
export function cardCatalog() {
  const cards = [];
  const driverIds = Object.keys(abilityCards).map(Number).sort((a, b) => a - b);
  for (const id of driverIds) {
    const c = abilityCards[id];
    cards.push({
      key: `ability:${id}`,
      kind: 'ability',
      theme: c.theme,
      color: c.color,
      icon: c.icon,
      title: c.title,
      placeholder: `PLAYER · ${c.detail}`,
    });
  }
  cards.push(
    {
      key: 'ability:5:jump',
      kind: 'ability',
      theme: 'locust',
      color: '#b7f35b',
      icon: '🦗',
      title: 'CRICKET’S JUMP',
      placeholder: 'PLAYER · NOW YOU SEE HER…',
    },
    {
      key: 'ability:7:nightmare',
      kind: 'ability',
      theme: 'gravity',
      color: '#d068ff',
      icon: '✺',
      title: 'NIGHTMARE FUEL',
      placeholder: 'PLAYER · HOUSTON, WE HAVE A PROBLEM',
    },
    {
      key: 'ability:8:rival',
      kind: 'ability',
      theme: 'relativity',
      color: '#9ffaff',
      icon: '⏱',
      title: 'TIME DILATION',
      placeholder: 'RIVAL · Time is what happens when nothing else happens.',
    },
    {
      key: 'ability:13:xylophone',
      kind: 'ability',
      theme: 'xylophone',
      color: '#fff29b',
      icon: '♫',
      title: 'XYLOPHONE-ATTACK',
      placeholder: 'PLAYER · A VERY TAXING PERFORMANCE',
    },
    {
      key: 'ability:15:swap',
      kind: 'ability',
      theme: 'karma',
      color: '#8ef0c8',
      icon: '☯',
      title: 'KARMIC RACCOONING · SCORES SWAPPED!',
      placeholder: 'PLAYER KO’D RIVAL & SWAPPED KILLS · 10 ⇄ 4',
    },
    {
      key: 'reward:intelligence',
      kind: 'reward',
      theme: '',
      color: '#c6adff',
      icon: '🧠',
      title: 'INTELLIGENCE UP!',
      placeholder: '5 ➜ 6 · BICYCLE COLLECTED · CARRY MORE ITEMS',
    },
    {
      key: 'euler:path',
      kind: 'ability',
      theme: 'euler',
      color: '#f5d77f',
      icon: '👻',
      title: 'EULERIAN PATH ACHIEVED!',
      placeholder: 'PLAYER BROKE THE THEOREM · EULER’S GHOST HAUNTS THE ARENA!',
    },
    {
      key: 'euler:near',
      kind: 'ability',
      theme: 'euler',
      color: '#9fd8f5',
      icon: '🌉',
      title: '6/7 BRIDGES',
      placeholder: '6/7 bridges, Euler remains confident of his result...',
    },
  );
  return cards;
}

// Minimal pure-Node PNG -> RGBA8 decoder for Chrome's 8-bit RGB/RGBA screenshots.
function decodePngRgba(png) {
  if (png.length < 24 || png.readUInt32BE(0) !== 0x89504e47) {
    throw new Error('Invalid PNG signature from Chrome screenshot');
  }
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  let pos = 8;
  while (pos + 8 <= png.length) {
    const len = png.readUInt32BE(pos);
    const type = png.toString('ascii', pos + 4, pos + 8);
    const data = png.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }
  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) {
    throw new Error(`Unsupported PNG format: bitDepth=${bitDepth} colorType=${colorType}`);
  }
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  const recon = Buffer.alloc(height * stride);
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const val = raw[src + x];
      const left = x >= bpp ? recon[dst + x - bpp] : 0;
      const up = y > 0 ? recon[dst - stride + x] : 0;
      const upLeft = y > 0 && x >= bpp ? recon[dst - stride + x - bpp] : 0;
      let out = val;
      if (filter === 1) out = (val + left) & 255;
      else if (filter === 2) out = (val + up) & 255;
      else if (filter === 3) out = (val + ((left + up) >> 1)) & 255;
      else if (filter === 4) out = (val + paeth(left, up, upLeft)) & 255;
      recon[dst + x] = out;
    }
  }
  if (bpp === 4) return {width, height, rgba: recon};
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0, j = 0; i < recon.length; i += 3, j += 4) {
    rgba[j] = recon[i];
    rgba[j + 1] = recon[i + 1];
    rgba[j + 2] = recon[i + 2];
    rgba[j + 3] = 255;
  }
  return {width, height, rgba};
}

export function encodeUiPack(entries) {
  const u16 = v => { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; };
  const u32 = v => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; };
  const parts = [Buffer.from('WWUP'), u32(UI_PACK_VERSION), u32(entries.length)];
  for (const e of entries) {
    const key = Buffer.from(e.key, 'utf8');
    const compressed = deflateSync(e.rgba, {level: 6});
    parts.push(
      u16(key.length),
      key,
      u16(e.width),
      u16(e.height),
      u16(e.logicalW),
      u16(e.logicalH),
      u16(e.detailLeft),
      u16(e.detailTop),
      u16(e.detailW),
      u16(e.detailH),
      u32(compressed.length),
      compressed,
    );
  }
  return Buffer.concat(parts);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitUntil(fn, message, ms = 12000) {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    if (fn()) return;
    await sleep(30);
  }
  throw new Error(message);
}

export async function buildUiPack({optional = false} = {}) {
  const chromePath = findChrome();
  if (!chromePath) {
    if (optional) return encodeUiPack([]);
    throw new Error('Chrome/Chromium binary not found; set CHROME_PATH to port HTML UI textures');
  }
  const profile = await mkdtemp(join(tmpdir(), 'wild-wheels-ui-port-'));
  let chrome = null;
  let ws = null;
  try {
    chrome = spawn(chromePath, [
      '--headless=new',
      '--mute-audio',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--window-size=800,360',
    ], {stdio: ['ignore', 'pipe', 'pipe']});
    let chromeLog = '';
    chrome.stdout.on('data', b => { chromeLog += b; });
    chrome.stderr.on('data', b => { chromeLog += b; });
    await waitUntil(
      () => /DevTools listening on (ws:\/\/[^\s]+)/.test(chromeLog) || chrome.exitCode !== null,
      'Chrome did not start for UI port',
    );
    const match = chromeLog.match(/DevTools listening on (ws:\/\/[^\s]+)/);
    if (!match) throw new Error(`Chrome exited before DevTools opened: ${chromeLog}`);

    ws = new WebSocket(match[1]);
    await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
    let nextId = 0;
    const pending = new Map();
    ws.on('message', bytes => {
      const msg = JSON.parse(bytes);
      if (msg.id && pending.has(msg.id)) {
        const {resolve: res, reject: rej, timer} = pending.get(msg.id);
        pending.delete(msg.id);
        clearTimeout(timer);
        if (msg.error) rej(new Error(JSON.stringify(msg.error)));
        else res(msg.result);
      }
    });
    const call = (method, params = {}, sessionId = undefined) => new Promise((res, rej) => {
      const id = ++nextId;
      const timer = setTimeout(() => { pending.delete(id); rej(new Error(`CDP timeout: ${method}`)); }, 15000);
      pending.set(id, {resolve: res, reject: rej, timer});
      ws.send(JSON.stringify(sessionId ? {id, method, params, sessionId} : {id, method, params}));
    });

    const {targetId} = await call('Target.createTarget', {url: 'about:blank'});
    const {sessionId} = await call('Target.attachToTarget', {targetId, flatten: true});
    await call('Page.enable', {}, sessionId);
    await call('Runtime.enable', {}, sessionId);
    await call('Emulation.setDeviceMetricsOverride', {
      width: 800,
      height: 360,
      deviceScaleFactor: SCALE,
      mobile: false,
    }, sessionId);
    await call('Emulation.setDefaultBackgroundColorOverride', {
      color: {r: 0, g: 0, b: 0, a: 0},
    }, sessionId);

    const css = readFileSync(join(ROOT, 'style.css'), 'utf8');
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}
      html, body { margin: 0; padding: 0; background: transparent !important; overflow: hidden; }
      .viewport { position: relative; width: 800px; height: 360px; background: transparent !important; overflow: visible !important; }
      .viewport .reward-notice, .viewport .ability-announcement.special-status {
        position: absolute !important;
        left: 50% !important;
        top: 50% !important;
        transform: translate(-50%, -50%) !important;
        max-width: 680px !important;
      }
      .reward-card, .reward-icon, .reward-arrow, .reward-roll {
        animation: none !important;
        opacity: 1 !important;
      }
      .reward-spark { display: none !important; }
      .reward-card > small { color: transparent !important; text-shadow: none !important; }
    </style></head><body><div class="viewport"><div id="host"></div></div></body></html>`;

    const {frameTree} = await call('Page.getFrameTree', {}, sessionId);
    await call('Page.setDocumentContent', {frameId: frameTree.frame.id, html}, sessionId);
    await call('Runtime.evaluate', {expression: 'document.fonts?.ready', awaitPromise: true}, sessionId);

    const entries = [];
    for (const spec of cardCatalog()) {
      const expr = `(() => {
        const host = document.getElementById('host');
        const wrap = document.createElement('div');
        wrap.className = ${JSON.stringify(spec.kind === 'ability' ? 'reward-notice ability-announcement special-status' : 'reward-notice')};
        wrap.dataset.theme = ${JSON.stringify(spec.theme)};
        wrap.style.setProperty('--reward-color', ${JSON.stringify(spec.color)});
        const card = document.createElement('div');
        card.className = 'reward-card';
        const icon = document.createElement('span');
        icon.className = 'reward-icon';
        icon.textContent = ${JSON.stringify(spec.icon)};
        const title = document.createElement('strong');
        title.textContent = ${JSON.stringify(spec.title)};
        const detail = document.createElement('small');
        detail.textContent = ${JSON.stringify(spec.placeholder)};
        card.append(icon, title, detail);
        wrap.append(card);
        host.replaceChildren(wrap);
        const r = card.getBoundingClientRect();
        const d = detail.getBoundingClientRect();
        return {
          x: Math.max(0, Math.floor(r.left - ${GLOW_PAD})),
          y: Math.max(0, Math.floor(r.top - ${GLOW_PAD})),
          w: Math.ceil(r.width + ${GLOW_PAD * 2}),
          h: Math.ceil(r.height + ${GLOW_PAD * 2}),
          dx: d.left,
          dy: d.top,
          dw: d.width,
          dh: d.height,
        };
      })()`;
      const evaluated = await call('Runtime.evaluate', {expression: expr, returnByValue: true}, sessionId);
      const rect = evaluated.result.value;
      const shot = await call('Page.captureScreenshot', {
        format: 'png',
        clip: {x: rect.x, y: rect.y, width: rect.w, height: rect.h, scale: 1},
      }, sessionId);
      const {width, height, rgba} = decodePngRgba(Buffer.from(shot.data, 'base64'));
      entries.push({
        key: spec.key,
        width,
        height,
        logicalW: rect.w,
        logicalH: rect.h,
        detailLeft: Math.max(0, Math.round(rect.dx - rect.x)),
        detailTop: Math.max(0, Math.round(rect.dy - rect.y)),
        detailW: Math.max(1, Math.round(rect.dw)),
        detailH: Math.max(1, Math.round(rect.dh)),
        rgba,
      });
    }
    return encodeUiPack(entries);
  } catch (error) {
    if (optional) {
      console.warn(`ui-port skipped (${error.message}); native client will use fallback banners`);
      return encodeUiPack([]);
    }
    throw error;
  } finally {
    try { ws?.close(); } catch {}
    try { chrome?.kill('SIGKILL'); } catch {}
    await rm(profile, {recursive: true, force: true});
  }
}
