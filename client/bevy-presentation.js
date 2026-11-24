import { createBinaryEncoder } from '../networking/binary-wire.js';
import { arenas } from '../gameplay/combat.js';

const prefix = '/experimental/';
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
    this.canvas.addEventListener('webglcontextlost', () => this.fail('graphics-lost'));
    if (mobile) this.configureMobile();
    // Eagerly begin downloading WASM + graphics pack while the player is in the lobby.
    this.loading = this.load();
  }

  get active() { return this.viewport.classList.contains('bevy-active'); }
  get fps() { return Math.round(this.quality?.fps ?? 0); }
  get status() {
    if (this.failed) return 'BEVY UNAVAILABLE';
    if (!this.active) return 'BEVY BETA';
    return this.mobile ? `BEVY MOBILE · ${this.quality.profile.name.toUpperCase()}` : 'BEVY';
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
    const level = this.inView && this.supported && !document.hidden && !this.failed ? this.quality.level : mobileIdle;
    if (level === this.mobileLevel || !this.bindings) return;
    this.bindings.set_mobile_presentation_level(level);
    if (level === mobileIdle || this.mobileLevel === mobileIdle) this.quality.reset();
    this.mobileLevel = level;
    this.nextFrame = 0;
  }

  async load() {
    const started = performance.now();
    const build = typeof document !== 'undefined' ? document.body?.dataset?.build : '';
    const v = build ? `?v=${encodeURIComponent(build)}` : '';
    try {
      const [{ bindings, wasmMs }, { pack, assetMs }] = await Promise.all([
        import(`${prefix}pkg/wild_wheels_wasm_poc.js${v}`).then(async bindings => {
          await bindings.default({ module_or_path: `${prefix}pkg/wild_wheels_wasm_poc_bg.wasm${v}` });
          return { bindings, wasmMs: performance.now() - started };
        }),
        fetch(`${prefix}graphics.wwgp${v}`, { signal: AbortSignal.timeout(120000) }).then(response => {
          if (!response.ok) throw new Error(`Graphics pack returned HTTP ${response.status}`);
          return response.arrayBuffer();
        }).then(pack => ({ pack, assetMs: performance.now() - started })),
      ]);
      if (this.mobile && typeof bindings.set_mobile_presentation_level !== 'function') {
        throw new Error('Mobile Bevy graphics require the current WASM build');
      }
      bindings.start_presentation(new Uint8Array(pack), this.mobile);
      this.bindings = bindings;
      if (this.mobile) this.updateMobileLevel();
      this.startup = { started, wasmMs, assetMs, graphicsBytes: pack.byteLength };
    } catch (error) {
      this.fail('bevy-startup-failed', error);
    }
  }

  fail(event, error) {
    this.failed = true;
    this.viewport.classList.remove('bevy-active');
    if (this.mobile) this.updateMobileLevel();
    this.log.note('error', event, { message: error?.message });
  }

  draw(world, client) {
    this.supported = world.mode === 'combat' && !world.bomber;
    if (this.mobile) this.updateMobileLevel();
    if (this.failed || !this.supported) {
      if (this.active) this.viewport.classList.remove('bevy-active');
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
      if (!this.active) this.viewport.classList.add('bevy-active');
      return true;
    } catch (error) {
      this.fail('bevy-frame-failed', error);
      return false;
    }
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
