import test from 'node:test';
import assert from 'node:assert/strict';
import { YudaExhaust } from './master-yuda.js';

test('exhaust stays at its world position for three seconds after the rider leaves', () => {
  const exhaust = new YudaExhaust(); exhaust.update('match', 0); exhaust.emit(0, { x: 0, y: .5, z: 0 }, 0);
  exhaust.update('match', .1); exhaust.emit(0, { x: 5, y: .5, z: 0 }, .1);
  assert.equal(exhaust.clouds[0].x, 0); assert.equal(exhaust.clouds[0].z, 0);
  exhaust.update('match', 2.99); assert.ok(exhaust.clouds.some(c => c.born === 0));
  exhaust.update('match', 3); assert.equal(exhaust.clouds.some(c => c.born === 0), false);
  exhaust.update('match', 3.1); assert.equal(exhaust.clouds.length, 0);
});
test('moving exhaust fills the path and remote riders leave independent trails', () => {
  const exhaust = new YudaExhaust(); exhaust.update('match', 0); exhaust.emit(0, { x: 0, y: .5, z: 0 }, 0);
  exhaust.update('match', .05); exhaust.emit(0, { x: 4.5, y: .5, z: 0 }, .05); exhaust.emit(1, { x: 20, y: .5, z: 20 }, .05);
  assert.deepEqual(exhaust.clouds.filter(c => c.owner === 0).map(c => c.x), [0, 1.5, 3, 4.5]);
  assert.equal(exhaust.clouds.filter(c => c.owner === 1).length, 1);
  exhaust.update('new-match', .06); assert.equal(exhaust.clouds.length, 0);
});
test('teleports and stale poses do not draw a smoke bridge across the arena', () => {
  const exhaust = new YudaExhaust(); exhaust.update('match', 0); exhaust.emit(0, { x: 0, y: .5, z: 0 }, 0);
  exhaust.emit(0, { x: 0, y: .5, z: 0 }, 0); assert.equal(exhaust.clouds.length, 1);
  exhaust.update('match', .1); exhaust.emit(0, { x: 80, y: .5, z: 0 }, .1);
  assert.deepEqual(exhaust.clouds.map(c => c.x), [0, 80]);
});
