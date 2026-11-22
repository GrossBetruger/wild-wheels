import test from 'node:test';
import assert from 'node:assert/strict';
import { Renderer } from '../../client/renderer.js';
import { OwlFlight } from '../../characters/knowitowl/knowitowl.js';

globalThis.devicePixelRatio ??= 1;
globalThis.matchMedia ??= () => ({ matches: true });

function fakeGl({ capacityBytes = Infinity } = {}) {
  let bound = null;
  let allocatedBytes = 0;
  let nextId = 1;
  const deleted = [];
  const gl = {
    ARRAY_BUFFER: 0x8892,
    BUFFER_SIZE: 0x8764,
    STATIC_DRAW: 0x88e4,
    DYNAMIC_DRAW: 0x88e8,
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    COLOR_BUFFER_BIT: 0x4000,
    DEPTH_BUFFER_BIT: 0x0100,
    DEPTH_TEST: 0x0b71,
    BLEND: 0x0be2,
    SRC_ALPHA: 0x0302,
    ONE_MINUS_SRC_ALPHA: 0x0303,
    ONE: 1,
    TRIANGLES: 4,
    POINTS: 0,
    FLOAT: 0x1406,
    createBuffer: () => ({ id: nextId++, bytes: 0, deleted: false }),
    bindBuffer: (_target, buffer) => { bound = buffer; },
    bufferData: (_target, data) => {
      if (!bound) return;
      const bytes = data.byteLength;
      if (allocatedBytes - bound.bytes + bytes > capacityBytes) {
        allocatedBytes -= bound.bytes;
        bound.bytes = 0;
        return;
      }
      allocatedBytes = allocatedBytes - bound.bytes + bytes;
      bound.bytes = bytes;
    },
    deleteBuffer: buffer => {
      if (!buffer || buffer.deleted) return;
      buffer.deleted = true;
      allocatedBytes -= buffer.bytes;
      buffer.bytes = 0;
      deleted.push(buffer.id);
    },
    getBufferParameter: (_target, param) => (param === 0x8764 ? bound?.bytes ?? 0 : 0),
    isContextLost: () => false,
    createShader: () => ({}),
    createProgram: () => ({}),
    getUniformLocation: () => ({}),
    getAttribLocation: () => 0,
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getExtension: () => null,
    getParameter: () => 'fake-gl',
  };
  return {
    gl: new Proxy(gl, { get: (target, name) => target[name] ?? (() => {}) }),
    stats: () => ({ allocatedBytes, deleted: [...deleted] }),
  };
}

function makeRenderer(options) {
  const { gl, stats } = fakeGl(options);
  const renderer = new Renderer({ getContext: () => gl, clientWidth: 640, clientHeight: 400, width: 0, height: 0 });
  return { renderer, stats };
}

test('Renderer evicts least-recently-used model buffers past budget without deleting current-frame models', () => {
  const { renderer, stats } = makeRenderer();
  const buildBox = mesh => mesh.box(0, 0, 0, 1, 1, 1, '#ffffff');
  // One box = 12 triangles = 36 vertices = 1296 bytes.
  renderer.maxModelBytes = 2600;

  renderer.renderFrame = 1;
  renderer.model('a', 0, 0, 0, 0, buildBox);
  renderer.model('b', 0, 0, 0, 0, buildBox);
  assert.equal(renderer.models.size, 2);

  // Touch 'a' on frame 2 so 'b' becomes the least-recently-used buffer.
  renderer.renderFrame = 2;
  renderer.model('a', 0, 0, 0, 0, buildBox);
  renderer.model('c', 0, 0, 0, 0, buildBox);
  assert.equal(renderer.models.has('a'), true);
  assert.equal(renderer.models.has('c'), true);
  assert.equal(renderer.models.has('b'), false);
  assert.equal(stats().deleted.length, 1);

  // Models drawn in the same frame are never evicted while the frame is still being assembled.
  renderer.model('d', 0, 0, 0, 0, buildBox);
  assert.equal(renderer.models.has('a'), true);
  assert.equal(renderer.models.has('c'), true);
  assert.equal(renderer.models.has('d'), true);
  assert.equal(stats().deleted.length, 1);
});

test('Renderer recovers from WebGL out-of-memory by evicting old buffers and never caches 0-byte buffers', () => {
  // Capacity fits only 2 boxes (2592 bytes) on the GPU.
  const { renderer, stats } = makeRenderer({ capacityBytes: 2600 });
  const buildBox = mesh => mesh.box(0, 0, 0, 1, 1, 1, '#ffffff');
  const reports = [];
  renderer.report = (...args) => reports.push(args);

  renderer.renderFrame = 1;
  renderer.model('old-1', 0, 0, 0, 0, buildBox);
  renderer.model('old-2', 0, 0, 0, 0, buildBox);
  assert.equal(renderer.models.size, 2);

  // Frame 2 hits the GPU cap even though JS budget is higher; it must evict old buffers and succeed.
  renderer.renderFrame = 2;
  renderer.instances = [];
  renderer.model('fresh', 0, 0, 0, 0, buildBox);
  assert.equal(renderer.models.has('fresh'), true);
  assert.equal(renderer.models.get('fresh').buffer.bytes, 1296);
  assert.equal(renderer.instances.length, 1);
  assert.equal(reports.length, 0);
  assert.equal(stats().deleted.length, 2);

  // A mesh larger than total GPU capacity must fail cleanly without poisoning this.models.
  renderer.renderFrame = 3;
  renderer.instances = [];
  renderer.model('too-big', 0, 0, 0, 0, mesh => {
    for (let i = 0; i < 4; i++) mesh.box(i, 0, 0, 1, 1, 1, '#ffffff');
  });
  assert.equal(renderer.models.has('too-big'), false);
  assert.equal(renderer.instances.length, 0);
  assert.equal(reports.length, 1);
  assert.equal(reports[0][2], 'model-buffer-allocation-failed');
});

test('OwlFlight quantizes flight transition keys to 5 steps (0..4)', () => {
  const flight = new OwlFlight();
  const keys = new Set();
  const fakeRenderer = {
    model: key => { if (key.startsWith('owl:body:')) keys.add(key); },
    glow: { at() {}, particle() {}, quad() {} },
    bicycleDrop() {},
  };
  const fakeMesh = {};
  for (let i = 0; i <= 40; i++) {
    flight.draw(fakeRenderer, fakeMesh, { id: 1, x: 0, z: 0, tx: 0, tz: 1, specialActive: 0 }, '#fff', 0, 0, true, i * 0.016, 0, null, null);
  }
  const flightSteps = new Set([...keys].map(k => Number(k.split(':')[3])));
  assert.ok(flightSteps.size <= 5, `expected at most 5 flight steps, got ${[...flightSteps]}`);
  for (const step of flightSteps) assert.ok(step >= 0 && step <= 4, `unexpected flight step ${step}`);
});
