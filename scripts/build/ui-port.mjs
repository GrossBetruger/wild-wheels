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
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {deflateSync, inflateSync} from 'node:zlib';
import {abilityCards,wormholeCard} from '../../ui/ability-announcements.js';

export const UI_PACK_VERSION = 1;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
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
      placeholder: id===15 ? c.detail : `PLAYER · ${c.detail}`,
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
    ...Array.from({length: 9}, (_, frame) => ({
      key: frame ? `ability:8:wormhole:${frame}` : 'ability:8:wormhole',
      kind: 'ability',
      ...wormholeCard,
      placeholder: wormholeCard.detail,
      morphTime: 240 + frame * 110,
    })),
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
    {
      key: 'whack:solo',
      kind: 'whack',
      cls: 'whack-card',
      title: '✦ YOU WHACKED ✦',
      placeholder: '“Rocco the Raccoon”',
    },
    {
      key: 'whack:co',
      kind: 'whack',
      cls: 'whack-card co-whack',
      title: '✦ CO-WHACKED ✦',
      placeholder: '“Rocco the Raccoon”',
    },
    {
      key: 'whack:wormhole',
      kind: 'whack',
      cls: 'whack-card',
      title: 'You Spaghetti-whacked',
      placeholder: '“Rocco the Raccoon”',
    },
    {
      key: 'whack:cherno',
      kind: 'whack',
      cls: 'whack-card cherno-whack',
      radiation: true,
      title: 'YOU CHERNOWHACKED',
      placeholder: '“Rocco the Raccoon”',
    },
    {
      key: 'ring:orange',
      kind: 'ring',
      cls: 'ring-of-fire-announcement',
      title: 'RING OF FIRE',
      detail: 'KEEP TURNING · LET IT BURN',
    },
    {
      key: 'ring:blue',
      kind: 'ring',
      cls: 'ring-of-fire-announcement blue-fire',
      title: 'RING OF FIRE',
      detail: 'KEEP TURNING · LET IT BURN',
    },
  );
  return cards;
}

/// Custom 2x DPI vector art matching Wild Wheels' 3D projectiles, boosters, and abilities.
const CUSTOM_ICON_SVGS = {
  'icon:hedgehog': `<svg viewBox="0 0 32 32" width="28" height="28" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="hg-body" cx="42%" cy="40%" r="60%">
        <stop offset="0%" stop-color="#8b5a34"/><stop offset="65%" stop-color="#5a341c"/><stop offset="100%" stop-color="#2e180c"/>
      </radialGradient>
      <radialGradient id="hg-face" cx="55%" cy="45%" r="60%">
        <stop offset="0%" stop-color="#f7dfc0"/><stop offset="100%" stop-color="#c99c6e"/>
      </radialGradient>
    </defs>
    <g stroke="#221108" stroke-width="1.3" stroke-linejoin="round">
      <path d="M16 2 L18.6 8 L23.8 4.4 L23 10.6 L29.4 9.5 L25.5 14.8 L30.2 18 L24.6 20.5 L27 26.2 L20.8 24.4 L19.5 29.8 L15.2 25.6 L11.2 29.5 L10.8 23.6 L4.6 24.6 L7.5 19 L2.2 16.5 L7.5 13 L4.6 7.4 L11 9.5 L11.8 3.6 Z" fill="url(#hg-body)"/>
      <path d="M16 5 L18 10 L22 7.5 L21 12.2 L26 11.8 L23 15.8 L26.5 18.2 L22 19.8 L23.5 23.8 L19 22.4 L16 25.5 L13 22 L8.8 23 L10.4 18.5 L6.5 16.5 L10.5 14 L8.8 9.8 L13.4 11.2 Z" fill="#a87043" stroke="none" opacity="0.55"/>
      <ellipse cx="20.5" cy="18.2" rx="6.6" ry="5.5" fill="url(#hg-face)"/>
      <circle cx="26.4" cy="17.8" r="1.8" fill="#1e1410"/>
      <circle cx="21.2" cy="16.5" r="1.5" fill="#151018"/>
      <circle cx="21.7" cy="16.0" r="0.55" fill="#fff" stroke="none"/>
    </g>
  </svg>`,
  'icon:missile': `<svg viewBox="0 0 32 32" width="28" height="28" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="ms-body" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#ffffff"/><stop offset="55%" stop-color="#d2dbe6"/><stop offset="100%" stop-color="#7c8a9e"/>
      </linearGradient>
      <linearGradient id="ms-nose" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#ff6b57"/><stop offset="100%" stop-color="#c4192c"/>
      </linearGradient>
      <radialGradient id="ms-fire" cx="70%" cy="30%" r="70%">
        <stop offset="0%" stop-color="#fff9b8"/><stop offset="50%" stop-color="#ff9d2e"/><stop offset="100%" stop-color="#e63517"/>
      </radialGradient>
    </defs>
    <path d="M5 27 C3 22, 6 18, 10 17 L15 22 C14 26, 10 29, 5 27 Z" fill="url(#ms-fire)"/>
    <g stroke="#1b1c2a" stroke-width="1.4" stroke-linejoin="round">
      <path d="M9 13 L5 14 L8 19 L13 17 Z" fill="#d92b3a"/>
      <path d="M19 23 L18 27 L13 24 L15 19 Z" fill="#b51c2a"/>
      <path d="M27.5 4.5 C23 4.5, 17 7.5, 12 12.5 L8.5 16 L16 23.5 L19.5 20 C24.5 15, 27.5 9, 27.5 4.5 Z" fill="url(#ms-body)"/>
      <path d="M27.5 4.5 C24.8 4.5, 21.8 5.6, 19.2 7.3 L24.7 12.8 C26.4 10.2, 27.5 7.2, 27.5 4.5 Z" fill="url(#ms-nose)"/>
      <circle cx="17.5" cy="14.5" r="2.3" fill="#32c5ff" stroke="#1b1c2a" stroke-width="1.2"/>
      <circle cx="18.1" cy="13.9" r="0.8" fill="#e6fbff" stroke="none"/>
    </g>
  </svg>`,
  'icon:vulcan': `<svg viewBox="0 0 32 32" width="28" height="28" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="vc-metal" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#ffe599"/><stop offset="50%" stop-color="#d4943a"/><stop offset="100%" stop-color="#6b4118"/>
      </linearGradient>
      <radialGradient id="vc-flash" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#ffffff"/><stop offset="45%" stop-color="#ffe066"/><stop offset="100%" stop-color="#ff5e1a"/>
      </radialGradient>
    </defs>
    <path d="M22 4 L24.5 10.5 L31 10 L26 14.8 L30.5 20 L23.8 19.5 L22 26 L19.5 19.5 L15 21 L18.5 15.5 L15 10.5 L19.8 11.5 Z" fill="url(#vc-flash)"/>
    <g stroke="#24160c" stroke-width="1.3" stroke-linejoin="round">
      <rect x="3" y="10.5" width="15" height="3.2" rx="1.2" fill="url(#vc-metal)"/>
      <rect x="2" y="14.4" width="17" height="3.2" rx="1.2" fill="url(#vc-metal)"/>
      <rect x="3" y="18.3" width="15" height="3.2" rx="1.2" fill="url(#vc-metal)"/>
      <rect x="6" y="9.2" width="3.2" height="13.6" rx="1" fill="#4e586e"/>
      <rect x="13" y="9.2" width="2.8" height="13.6" rx="1" fill="#4e586e"/>
    </g>
  </svg>`,
  'icon:turbo': `<svg viewBox="0 0 32 32" width="28" height="28" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="tb-flame" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#ffffff"/><stop offset="35%" stop-color="#6cf2ff"/><stop offset="75%" stop-color="#ffb830"/><stop offset="100%" stop-color="#ff4818"/>
      </linearGradient>
      <linearGradient id="tb-cone" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#dce6f2"/><stop offset="100%" stop-color="#59667d"/>
      </linearGradient>
    </defs>
    <path d="M20 4 L9 17 L16 17 L12 28 L25 14 L18 14 Z" fill="url(#tb-flame)" stroke="#1a1d30" stroke-width="1.5" stroke-linejoin="round"/>
    <path d="M18.5 8 L12.5 15.5 L16.5 15.5 L14.5 22.5 L21.5 14.8 L17.5 14.8 Z" fill="#fffef0" opacity="0.85"/>
  </svg>`,
  'icon:chaff': `<svg viewBox="0 0 32 32" width="24" height="24" xmlns="http://www.w3.org/2000/svg">
    <g stroke="#1b263b" stroke-width="1.2" stroke-linejoin="round">
      <path d="M16 3 L18.5 11.5 L27 14 L18.5 16.5 L16 25 L13.5 16.5 L5 14 L13.5 11.5 Z" fill="#fff099"/>
      <rect x="21" y="5" width="5.5" height="2.4" rx="1" transform="rotate(35 23.7 6.2)" fill="#7ee8ff"/>
      <rect x="6" y="21" width="5.5" height="2.4" rx="1" transform="rotate(-30 8.7 22.2)" fill="#ffdf70"/>
      <rect x="21" y="22" width="5" height="2.2" rx="1" transform="rotate(-40 23.5 23.1)" fill="#b9f5ff"/>
      <circle cx="8" cy="8" r="2" fill="#7ee8ff"/>
    </g>
  </svg>`,
  'icon:flip': `<svg viewBox="0 0 32 32" width="24" height="24" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="fl-arc" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#a8f9ff"/><stop offset="100%" stop-color="#2cb6ff"/>
      </linearGradient>
    </defs>
    <path d="M24.5 13 A9.5 9.5 0 1 0 21 24.2" fill="none" stroke="#132238" stroke-width="5.6" stroke-linecap="round"/>
    <path d="M24.5 13 A9.5 9.5 0 1 0 21 24.2" fill="none" stroke="url(#fl-arc)" stroke-width="3.2" stroke-linecap="round"/>
    <polygon points="27.5,16.8 20.8,14.2 26.2,9.2" fill="#a8f9ff" stroke="#132238" stroke-width="1.2" stroke-linejoin="round"/>
    <circle cx="16" cy="16" r="2.2" fill="#fff5b8"/>
  </svg>`,
  'icon:special': `<svg viewBox="0 0 32 32" width="24" height="24" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="sp-star" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#fff8b8"/><stop offset="50%" stop-color="#ffd24d"/><stop offset="100%" stop-color="#ff6fd8"/>
      </linearGradient>
    </defs>
    <path d="M16 2.5 L19.8 11.2 L29 12.2 L22 18.4 L24 27.6 L16 22.8 L8 27.6 L10 18.4 L3 12.2 L12.2 11.2 Z" fill="url(#sp-star)" stroke="#291840" stroke-width="1.6" stroke-linejoin="round"/>
    <circle cx="16" cy="15.8" r="3" fill="#ffffff" opacity="0.85"/>
  </svg>`,
  'icon:shield': `<svg viewBox="0 0 32 32" width="24" height="24" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="sh-fill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#9fffe8"/><stop offset="100%" stop-color="#1ca89e"/>
      </linearGradient>
    </defs>
    <path d="M16 3 L27 7.5 V15.5 C27 22.5, 22 27.2, 16 29.5 C10 27.2, 5 22.5, 5 15.5 V7.5 Z" fill="url(#sh-fill)" stroke="#14333d" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M16 6.5 L23.5 9.6 V15.2 C23.5 20.2, 20 23.8, 16 25.6 Z" fill="#ffffff" opacity="0.28"/>
  </svg>`,
  'icon:mic': `<svg viewBox="0 0 32 32" width="24" height="24" xmlns="http://www.w3.org/2000/svg">
    <g stroke="#182235" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <rect x="11.5" y="4" width="9" height="14" rx="4.5" fill="#d9f4ff"/>
      <path d="M8.5 14.5 A7.5 7.5 0 0 0 23.5 14.5" fill="none" stroke="#9be6ff" stroke-width="2.2"/>
      <line x1="16" y1="22" x2="16" y2="27.5" stroke="#9be6ff" stroke-width="2.2"/>
      <line x1="11.5" y1="27.5" x2="20.5" y2="27.5" stroke="#9be6ff" stroke-width="2.2"/>
    </g>
  </svg>`,
};

/// Pre-baked 2x DPI custom SVG icons & CSS HUD chrome rendered from `style.css`.
export function hudChromeCatalog() {
  const icons = [
    ['icon:hedgehog', '🦔', 24],
    ['icon:missile', '🚀', 24],
    ['icon:vulcan', '🔥', 24],
    ['icon:turbo', '⚡', 24],
    ['icon:heart', '❤️', 20],
    ['icon:heart_extra', '💛', 20],
    ['icon:chaff', '✨', 18],
    ['icon:flip', '🤸', 18],
    ['icon:special', '✦', 18],
    ['icon:mic', '🎙️', 18],
    ['icon:shield', '🛡️', 18],
  ].map(([key, glyph, size]) => ({kind: 'icon', key, glyph, svg: CUSTOM_ICON_SVGS[key] ?? null, size}));

  const cards = [
    {key: 'chrome:ammo:base', id: '', cls: 'ammo-card', disabled: false},
    {key: 'chrome:ammo:selected', id: '', cls: 'ammo-card selected', disabled: false},
    {key: 'chrome:ammo:missile', id: 'ammo-missile', cls: 'ammo-card selected', disabled: false},
    {key: 'chrome:ammo:vulcan', id: '', cls: 'ammo-card vulcan', disabled: false},
    {key: 'chrome:ammo:disabled', id: '', cls: 'ammo-card', disabled: true},
    {key: 'chrome:ammo:selected_disabled', id: '', cls: 'ammo-card selected', disabled: true},
  ].map(spec => ({kind: 'ammo-chrome', ...spec}));

  const buttons = [
    {key: 'chrome:btn:action', cls: 'chaff-button', disabled: false, width: 152},
    {key: 'chrome:btn:disabled', cls: 'chaff-button', disabled: true, width: 152},
    {key: 'chrome:btn:nightmare', cls: 'chaff-button nightmare-button', disabled: false, width: 190},
    {key: 'chrome:btn:nightmare_active', cls: 'chaff-button nightmare-button active', disabled: false, width: 190},
  ].map(spec => ({kind: 'btn-chrome', ...spec}));

  return [...icons, ...cards, ...buttons];
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

    const WS = globalThis.WebSocket ?? (await import('ws')).default;
    ws = new WS(match[1]);
    await new Promise((res, rej) => {
      if (typeof ws.addEventListener === 'function') {
        ws.addEventListener('open', res, {once: true});
        ws.addEventListener('error', rej, {once: true});
      } else {
        ws.once('open', res);
        ws.once('error', rej);
      }
    });
    let nextId = 0;
    const pending = new Map();
    const onMessage = raw => {
      const msg = JSON.parse(typeof raw === 'string' ? raw : raw?.data ?? String(raw));
      if (msg.id && pending.has(msg.id)) {
        const {resolve: res, reject: rej, timer} = pending.get(msg.id);
        pending.delete(msg.id);
        clearTimeout(timer);
        if (msg.error) rej(new Error(JSON.stringify(msg.error)));
        else res(msg.result);
      }
    };
    if (typeof ws.addEventListener === 'function') {
      ws.addEventListener('message', onMessage);
    } else {
      ws.on('message', onMessage);
    }
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
      .reward-card, .reward-icon, .reward-arrow, .reward-roll, .whack-card, .ring-of-fire-announcement {
        animation: none !important;
        opacity: 1 !important;
      }
      .reward-spark, .ring-of-fire-announcement::before, .ring-of-fire-announcement::after { display: none !important; }
      .viewport .whack-banner, .viewport .ring-of-fire-announcement {
        position: absolute !important;
        left: 50% !important;
        top: 50% !important;
        transform: translate(-50%, -50%) !important;
      }
      .whack-card strong { color: transparent !important; text-shadow: none !important; }
      .reward-notice:not([data-theme="karma"]) .reward-card > small { color: transparent !important; text-shadow: none !important; }
    </style></head><body><div class="viewport"><div id="host"></div></div></body></html>`;

    const {frameTree} = await call('Page.getFrameTree', {}, sessionId);
    await call('Page.setDocumentContent', {frameId: frameTree.frame.id, html}, sessionId);
    await call('Runtime.evaluate', {expression: 'document.fonts?.ready', awaitPromise: true}, sessionId);

    const entries = [];
    for (const spec of cardCatalog()) {
      const expr = `(() => {
        const host = document.getElementById('host');
        const spec = ${JSON.stringify(spec)};
        let boxEl, detailEl;
        if (spec.kind === 'whack') {
          const wrap = document.createElement('div');
          wrap.className = 'whack-banner';
          const card = document.createElement('div');
          card.className = spec.cls;
          const title = document.createElement('span');
          title.textContent = spec.title;
          const name = document.createElement('strong');
          name.textContent = spec.placeholder;
          if (spec.radiation) {
            const ns = 'http://www.w3.org/2000/svg';
            const svg = document.createElementNS(ns, 'svg');
            svg.setAttribute('viewBox', '0 0 48 48');
            svg.setAttribute('class', 'cherno-emblem');
            const shape = (tag, attrs) => { const n = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); svg.append(n); return n; };
            shape('circle', {cx: 24, cy: 24, r: 22, fill: '#e4ee70', stroke: '#be9b31', 'stroke-width': 2});
            for (let arm = 0; arm < 3; arm++) shape('path', {d: 'M15 8.4 A18 18 0 0 1 33 8.4 L27.5 17.94 A7 7 0 0 0 20.5 17.94 Z', fill: '#721b28', transform: 'rotate(' + (arm * 120) + ' 24 24)'});
            shape('circle', {cx: 24, cy: 24, r: 9, fill: '#a52632'});
            shape('text', {x: 24, y: 30, 'text-anchor': 'middle', 'font-size': 19, 'font-family': 'Georgia,serif', fill: '#fff2a0'}).textContent = '☭';
            const copy = document.createElement('div');
            copy.className = 'cherno-copy';
            copy.append(title, name);
            card.append(svg, copy);
          } else {
            card.append(title, name);
          }
          wrap.append(card);
          host.replaceChildren(wrap);
          boxEl = card;
          detailEl = name;
        } else if (spec.kind === 'ring') {
          const banner = document.createElement('div');
          banner.className = spec.cls;
          const title = document.createElement('strong');
          title.textContent = spec.title;
          const help = document.createElement('span');
          help.textContent = spec.detail;
          banner.append(title, help);
          host.replaceChildren(banner);
          boxEl = banner;
          detailEl = help;
        } else {
          const wrap = document.createElement('div');
          wrap.className = spec.kind === 'ability' ? 'reward-notice ability-announcement special-status' : 'reward-notice';
          wrap.dataset.theme = spec.theme;
          wrap.style.setProperty('--reward-color', spec.color);
          const card = document.createElement('div');
          card.className = 'reward-card';
          const icon = document.createElement('span');
          icon.className = 'reward-icon';
          icon.textContent = spec.icon;
          const title = document.createElement('strong');
          title.textContent = spec.title;
          const detail = document.createElement('small');
          detail.textContent = spec.placeholder;
          card.append(icon, title, detail);
          wrap.append(card);
          host.replaceChildren(wrap);
          for (const animation of icon.getAnimations({subtree: true})) {
            if (animation.animationName === 'topology-handle') {
              animation.pause();
              animation.currentTime = spec.morphTime ?? 0;
            }
          }
          boxEl = card;
          detailEl = detail;
        }
        const r = boxEl.getBoundingClientRect();
        const d = detailEl.getBoundingClientRect();
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
    for (const spec of hudChromeCatalog()) {
      const expr = `(() => {
        const host = document.getElementById('host');
        const spec = ${JSON.stringify(spec)};
        let el, pad = 2;
        if (spec.kind === 'icon') {
          el = document.createElement('span');
          if (spec.svg) {
            el.innerHTML = spec.svg;
            el.style.cssText = 'position:absolute;left:40px;top:40px;display:inline-flex;align-items:center;justify-content:center;width:' + (spec.size + 8) + 'px;height:' + (spec.size + 8) + 'px;filter:drop-shadow(0 2px 3px rgba(16,20,33,.6));';
          } else {
            el.textContent = spec.glyph;
            el.style.cssText = 'position:absolute;left:40px;top:40px;display:inline-flex;align-items:center;justify-content:center;width:' + (spec.size + 8) + 'px;height:' + (spec.size + 8) + 'px;font-size:' + spec.size + 'px;line-height:1;color:#fff;text-shadow:0 2px 3px rgba(16,20,33,.55);';
          }
          pad = 2;
        } else if (spec.kind === 'ammo-chrome') {
          el = document.createElement('button');
          if (spec.id) el.id = spec.id;
          el.className = spec.cls;
          el.disabled = spec.disabled;
          el.style.cssText = 'position:absolute;left:40px;top:40px;margin:0;transition:none;';
          el.innerHTML = '&nbsp;';
          pad = 16;
        } else {
          el = document.createElement('button');
          el.className = spec.cls;
          el.disabled = spec.disabled;
          el.style.cssText = 'position:absolute;left:40px;top:40px;right:auto;bottom:auto;width:' + spec.width + 'px;margin:0;transition:none;';
          el.innerHTML = '&nbsp;';
          pad = 18;
        }
        host.replaceChildren(el);
        const r = el.getBoundingClientRect();
        return {
          x: Math.max(0, Math.floor(r.left - pad)),
          y: Math.max(0, Math.floor(r.top - pad)),
          w: Math.ceil(r.width + pad * 2),
          h: Math.ceil(r.height + pad * 2),
          pad,
          rw: Math.round(r.width),
          rh: Math.round(r.height),
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
        detailLeft: rect.pad,
        detailTop: rect.pad,
        detailW: rect.rw,
        detailH: rect.rh,
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
