import { createBinaryEncoder } from '../networking/binary-wire.js';
import { arenas } from '../gameplay/combat.js';

const prefix = '/experimental/';

// The shared browser game owns simulation, controls, audio, and networking.
// Bevy receives the same frame the browser HUD is displaying.
export class BevyPresentation {
  constructor(gameCanvas, log, mobile) {
    this.viewport = gameCanvas.parentElement;
    const surface = document.createElement('div');
    surface.className = 'bevy-surface';
    if (mobile) {
      // Fit the backing canvas to a smaller parent, then scale only its CSS display.
      surface.classList.add('bevy-surface-mobile');
    }
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'bevy-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.tabIndex = -1;
    surface.append(this.canvas);
    gameCanvas.after(surface);
    this.log = log;
    this.mobile = mobile;
    this.nextFrame = 0;
    this.encode = createBinaryEncoder();
    this.canvas.addEventListener('webglcontextlost', () => this.fail('graphics-lost'));
  }

  get active() { return this.viewport.classList.contains('bevy-active'); }
  get status() {
    if (this.failed) return 'BEVY UNAVAILABLE';
    if (!this.active) return 'BEVY BETA';
    return this.mobile ? 'BEVY MOBILE' : 'BEVY';
  }

  async load() {
    const started = performance.now();
    try {
      const [{ bindings, wasmMs }, { pack, assetMs }] = await Promise.all([
        import(`${prefix}pkg/wild_wheels_wasm_poc.js`).then(async bindings => {
          await bindings.default();
          return { bindings, wasmMs: performance.now() - started };
        }),
        fetch(`${prefix}graphics.wwgp`, { signal: AbortSignal.timeout(120000) }).then(response => {
          if (!response.ok) throw new Error(`Graphics pack returned HTTP ${response.status}`);
          return response.arrayBuffer();
        }).then(pack => ({ pack, assetMs: performance.now() - started })),
      ]);
      bindings.start_presentation(new Uint8Array(pack), this.mobile);
      this.bindings = bindings;
      this.startup = { started, wasmMs, assetMs, graphicsBytes: pack.byteLength };
    } catch (error) {
      this.fail('bevy-startup-failed', error);
    }
  }

  fail(event, error) {
    this.failed = true;
    this.viewport.classList.remove('bevy-active');
    this.log.note('error', event, { message: error?.message });
  }

  draw(world, client) {
    if (this.failed || world.mode !== 'combat' || world.bomber) {
      if (this.active) this.viewport.classList.remove('bevy-active');
      return false;
    }
    this.loading ??= this.load();
    if (!this.bindings) return false;
    if (this.mobile) {
      const now = performance.now();
      if (now + 1 < this.nextFrame) return this.active;
      this.nextFrame = Math.max(now + 1, this.nextFrame + 1000 / 30);
    }

    try {
      const { bindings } = this;
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
}
