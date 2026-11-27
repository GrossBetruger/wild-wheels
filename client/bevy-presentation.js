import { createBinaryEncoder } from '../networking/binary-wire.js';
import { kartNameplates } from '../ui/nameplates.js';
import { arenas } from '../gameplay/combat.js';

const prefix = '/experimental/';
let assetFetchVersioned = false;
// Appends `?v=<build>` to Bevy's unversioned `assets/...` fetches so browsers
// and Cloud CDN cache `.glb` models as immutable per build without stale hits.
export function versionAssetUrl(url, build) {
  if (typeof url !== 'string') return url;
  if (url.startsWith('assets/')) url = prefix + url;
  if (!build || url.includes('?')) return url;
  if (url.startsWith(`${prefix}assets/`)) {
    return `${url}?v=${encodeURIComponent(build)}`;
  }
  return url;
}
function installAssetFetchVersioning(build) {
  if (assetFetchVersioned || typeof globalThis.fetch !== 'function') return;
  assetFetchVersioned = true;
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input, init) => {
    if (typeof input === 'string') {
      const next = versionAssetUrl(input, build);
      if (next !== input) return originalFetch(next, init);
    }
    return originalFetch(input, init);
  };
}
const mobileProfiles = [
  { name: 'High', scale: .8, pixels: 120000, fps: 30 },
  { name: 'Balanced', scale: .6, pixels: 80000, fps: 30 },
  { name: 'Low', scale: .45, pixels: 52000, fps: 30 },
  { name: 'Minimum', scale: .33, pixels: 32000, fps: 20 },
];
const mobileIdle = mobileProfiles.length;

export class MobileBevyQuality {
  level = 1;
  fps = 0;
  slow = 0;
  fast = 0;
  recoverAfter = 0;
  sample = null;

  get profile() { return mobileProfiles[this.level]; }

  scale(width, height, pixelRatio) {
    return Math.min(this.profile.scale, Math.sqrt(this.profile.pixels / (width * height))) / pixelRatio;
  }

  reset() {
    this.sample = null;
    this.fps = this.slow = this.fast = 0;
  }

  measure(now, frames) {
    this.sample ??= { now, frames };
    const elapsed = now - this.sample.now;
    if (elapsed < 1000) return false;
    this.fps = ((frames - this.sample.frames) >>> 0) * 1000 / elapsed;
    this.sample = { now, frames };
    const target = this.profile.fps;
    this.slow = this.fps < target * .85 ? this.slow + 1 : 0;
    this.fast = this.fps >= target * .94 ? this.fast + 1 : 0;
    if (this.slow >= 2 && this.level < mobileIdle - 1) {
      this.level++;
      this.recoverAfter = now + 15000;
      this.slow = this.fast = 0;
    }
    if (this.fast >= 10 && this.level > 0 && now >= this.recoverAfter) {
      this.level--;
      this.slow = this.fast = 0;
    }
    return true;
  }
}

// The shared browser game owns simulation, controls, audio, and networking.
// Bevy receives the same frame the browser HUD is displaying.
export class BevyPresentation {
  constructor(gameCanvas, log, mobile) {
    this.viewport = gameCanvas.parentElement;
    this.surface = document.createElement('div');
    this.surface.className = 'bevy-surface';
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'bevy-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.tabIndex = -1;
    this.surface.append(this.canvas);
    gameCanvas.after(this.surface);
    this.log = log;
    this.mobile = mobile;
    this.nextFrame = 0;
    this.encode = createBinaryEncoder();
    this.ready = false;
    this.failed = false;
    this.progress = { stage: 'downloading', percent: 0, loadedBytes: 0, totalBytes: 0 };
    this.progressListeners = new Set();
    this.canvas.addEventListener('webglcontextlost', () => this.fail('graphics-lost'));
    if (mobile) this.configureMobile();
    // Eagerly begin downloading WASM + graphics pack while the player is in the lobby.
    this.loading = this.load();
  }

  get active() { return this.viewport.classList.contains('bevy-active'); }
  get fps() { return Math.round(this.quality?.fps ?? 0); }
  get status() {
    if (this.failed) return 'BEVY UNAVAILABLE';
    if (!this.active) return 'BEVY';
    return this.mobile ? `BEVY MOBILE · ${this.quality.profile.name.toUpperCase()}` : 'BEVY';
  }

  onProgress(listener) {
    this.progressListeners.add(listener);
    listener(this.progress);
    return () => this.progressListeners.delete(listener);
  }

  reportProgress(patch) {
    this.progress = { ...this.progress, ...patch };
    for (const listener of this.progressListeners) listener(this.progress);
  }

  setQuality(value) {
    if (this.mobile) return;
    const scale = { balanced: .75, low: .5 }[value] ?? 1;
    this.surface.style.width = this.surface.style.height = `${scale * 100}%`;
    this.surface.style.transform = `scale(${1 / scale})`;
  }

  configureMobile() {
    this.quality = new MobileBevyQuality();
    this.inView = true;
    this.surface.classList.add('bevy-surface-mobile');
    const size = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (!(width > 0 && height > 0)) return;
      const physical = entry.devicePixelContentBoxSize?.[0];
      const pixelRatio = physical?.inlineSize > 0 ? physical.inlineSize / width : devicePixelRatio;
      this.viewportSize = { width, height, pixelRatio: Math.max(1, pixelRatio) };
      this.resize();
    });
    size.observe(this.viewport);
    const visibility = new IntersectionObserver(([entry]) => {
      this.inView = entry.isIntersecting;
      this.updateMobileLevel();
    });
    visibility.observe(this.viewport);
    document.addEventListener('visibilitychange', () => this.updateMobileLevel());
  }

  resize() {
    if (!this.viewportSize) return;
    const { width, height, pixelRatio } = this.viewportSize;
    const scale = this.quality.scale(width, height, pixelRatio);
    this.surface.style.setProperty('--bevy-render-size', `${scale * 100}%`);
    this.surface.style.setProperty('--bevy-render-upscale', String(1 / scale));
  }

  updateMobileLevel() {
    // The lobby's character preview needs frames even while the arena is scrolled out of view.
    const previewing = performance.now() - (this.previewAt ?? -Infinity) < 500;
    const level = (this.inView && this.supported || previewing) && !document.hidden && !this.failed ? this.quality.level : mobileIdle;
    if (level === this.mobileLevel || !this.bindings) return;
    this.bindings.set_mobile_presentation_level(level);
    if (level === mobileIdle || this.mobileLevel === mobileIdle) this.quality.reset();
    this.mobileLevel = level;
    this.nextFrame = 0;
  }

  async fetchWithProgress(url, onBytes) {
    const response = await fetch(url, { signal: AbortSignal.timeout(300000) });
    if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
    const total = Number(response.headers.get('content-length')) || 0;
    if (!response.body?.getReader) {
      const buf = await response.arrayBuffer();
      onBytes(buf.byteLength, total || buf.byteLength);
      return buf;
    }
    const reader = response.body.getReader();
    const chunks = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      onBytes(loaded, total);
    }
    const out = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return out.buffer;
  }

  async load() {
    const started = performance.now();
    const build = typeof document !== 'undefined' ? document.body?.dataset?.build : '';
    const v = build ? `?v=${encodeURIComponent(build)}` : '';
    installAssetFetchVersioning(build);
    let wasmDone = false;
    let packLoaded = 0;
    let packTotal = 0;
    const emit = () => {
      const packRatio = packTotal > 0 ? Math.min(1, packLoaded / packTotal) : (packLoaded > 0 ? Math.min(0.9, packLoaded / 16_000_000) : 0);
      const wasmRatio = wasmDone ? 1 : 0.15;
      const percent = Math.min(95, Math.round((packRatio * 0.72 + wasmRatio * 0.28) * 100));
      this.reportProgress({ stage: 'downloading', percent, loadedBytes: packLoaded, totalBytes: packTotal });
    };
    try {
      const [{ bindings, wasmMs }, { pack, assetMs }, uiPack] = await Promise.all([
        import(`${prefix}pkg/wild_wheels_wasm.js${v}`).then(async bindings => {
          await bindings.default({ module_or_path: `${prefix}pkg/wild_wheels_wasm_bg.wasm${v}` });
          wasmDone = true;
          emit();
          return { bindings, wasmMs: performance.now() - started };
        }),
        this.fetchWithProgress(`${prefix}graphics.wwgp${v}`, (loaded, total) => {
          packLoaded = loaded;
          packTotal = total;
          emit();
        }).then(pack => ({ pack, assetMs: performance.now() - started })),
        fetch(`${prefix}ui.wwup${v}`)
          .then(res => (res.ok ? res.arrayBuffer() : null))
          .catch(() => null),
      ]);
      if (this.mobile && typeof bindings.set_mobile_presentation_level !== 'function') {
        throw new Error('Mobile Bevy graphics require the current WASM build');
      }
      this.reportProgress({ stage: 'initializing', percent: 97, loadedBytes: pack.byteLength, totalBytes: pack.byteLength });
      if (uiPack && uiPack.byteLength > 0 && typeof bindings.set_ui_pack === 'function') {
        bindings.set_ui_pack(new Uint8Array(uiPack));
      }
      bindings.start_presentation(new Uint8Array(pack), this.mobile);
      this.bindings = bindings;
      this.ready = true;
      if (this.mobile) this.updateMobileLevel();
      this.startup = { started, wasmMs, assetMs, graphicsBytes: pack.byteLength };
      this.reportProgress({ stage: 'ready', percent: 100, loadedBytes: pack.byteLength, totalBytes: pack.byteLength });
    } catch (error) {
      this.fail('bevy-startup-failed', error);
    }
  }

  fail(event, error) {
    this.failed = true;
    this.ready = true;
    this.viewport.classList.remove('bevy-active', 'bevy-hud-active');
    if (this.mobile) this.updateMobileLevel();
    this.reportProgress({ stage: 'failed', percent: 100 });
    this.log.note('error', event, { message: error?.message });
  }

  nameplates(world) {
    const camera = this.bindings?.arena_camera?.();
    if (camera?.length !== 19) return [];
    return kartNameplates(world, camera.subarray(0, 16), camera.subarray(16));
  }

  draw(world, client) {
    this.supported = world.mode === 'combat' && !world.bomber;
    if (this.mobile) this.updateMobileLevel();
    if (this.failed || !this.supported) {
      if (this.active) this.viewport.classList.remove('bevy-active', 'bevy-hud-active');
      this.bindings?.set_hud_active?.(false);
      return false;
    }
    if (this.mobile && (!this.inView || document.hidden)) return true;
    this.loading ??= this.load();
    if (!this.bindings) return false;

    try {
      const { bindings } = this;
      if (this.mobile) {
        const now = performance.now();
        if (this.active) this.measureMobile(now);
        if (now + 1 < this.nextFrame) return this.active;
        this.nextFrame = Math.max(now + 1, this.nextFrame + 1000 / this.quality.profile.fps);
      }
      const packet = client ? client.presentationPacket() : this.encode({
        type: 'state', time: world.elapsed, you: world.id,
        world: { ...world, arenaDef: arenas[world.arena] },
      });
      bindings.present_frame(packet);
      const rejected = bindings.take_invalid_packets();
      if (rejected) this.log.limited('bevy-frame-invalid', 15000, 'warn', 'bevy-frame-invalid', { rejected });
      if (!bindings.presentation_ready()) return false;
      if (this.startup) {
        const { started, ...metrics } = this.startup;
        this.log.note('info', 'bevy-startup', { ...metrics, firstFrameMs: performance.now() - started,
          mobile: this.mobile, width: this.canvas.width, height: this.canvas.height });
        this.startup = null;
      }
      const hudOn = (world.phase === 'racing' || world.phase === 'paused') && !this.mobile;
      bindings.set_hud_active?.(hudOn);
      if (!this.active) this.viewport.classList.add('bevy-active');
      this.viewport.classList.toggle('bevy-hud-active', hudOn);
      return true;
    } catch (error) {
      this.fail('bevy-frame-failed', error);
      return false;
    }
  }

  // Show a racer on the Bevy client's preview stage and return its newest
  // frame as ImageData, or null when none has arrived since the last call.
  preview({ driver, color, clock, yaw, celebrate, boost, tall, width, height }) {
    const { bindings } = this;
    if (this.failed || !bindings?.show_character_preview || !bindings.presentation_ready() || !(width > 0 && height > 0)) return null;
    // Rows of the copied image are unpadded only at widths that are multiples of 64.
    const pixels = Math.min(this.mobile ? 1 : 1.5, devicePixelRatio || 1);
    const columns = Math.max(64, Math.round(width * pixels / 64) * 64), rows = Math.max(32, Math.round(columns * height / width));
    this.previewAt = performance.now();
    try {
      bindings.show_character_preview(driver, color, clock, yaw, celebrate, Boolean(boost), tall, columns, rows);
      const bytes = bindings.take_character_preview();
      if (bytes.length < 8) return null;
      const size = new DataView(bytes.buffer, bytes.byteOffset, 8), frameWidth = size.getUint32(0, true), frameHeight = size.getUint32(4, true);
      if (bytes.length !== 8 + frameWidth * frameHeight * 4) return null;
      return new ImageData(new Uint8ClampedArray(bytes.buffer, bytes.byteOffset + 8, frameWidth * frameHeight * 4), frameWidth, frameHeight);
    } catch (error) {
      this.log.limited('bevy-preview-failed', 15000, 'warn', 'bevy-preview-failed', { message: error?.message });
      return null;
    }
  }

  hidePreview() {
    if (this.previewAt === undefined) return;
    this.previewAt = undefined;
    try { this.bindings?.hide_character_preview?.(); } catch { /* The preview falls back to the regular renderer. */ }
  }

  measureMobile(now) {
    const previous = this.quality.profile.name;
    if (!this.quality.measure(now, this.bindings.mobile_presentation_frames())) return;
    const { name, fps } = this.quality.profile;
    const metrics = { quality: name, fps: Math.round(this.quality.fps), targetFps: fps,
      width: this.canvas.width, height: this.canvas.height };
    if (name !== previous) {
      this.resize();
      this.updateMobileLevel();
      this.log.note('info', 'bevy-mobile-quality', { ...metrics, from: previous });
      return;
    }
    this.log.limited('bevy-mobile-performance', 15000, 'info', 'bevy-mobile-performance', metrics);
  }
}
