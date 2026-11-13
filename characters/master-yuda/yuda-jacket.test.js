import test from 'node:test';
import assert from 'node:assert/strict';
import { YudaJackets } from './master-yuda.js';

test('boost throws the jacket behind Yuda, keeps him bare, and restores it through a dressing animation', () => {
  const jackets = new YudaJackets(), pose = { x: 10, z: 20, height: 0, angle: 1 };
  assert.equal(jackets.update(0, 0, false, pose).bare, false);
  const launched = jackets.update(0, 1, true, pose); assert.equal(launched.bare, true); assert.deepEqual(launched.flight, { ...pose, start: 1 });
  assert.equal(jackets.update(0, 1.5, true, { ...pose, x: 15 }).flight.x, 10);
  const boosting = jackets.update(0, 3, true, pose); assert.equal(boosting.bare, true); assert.equal(boosting.flight, null); assert.equal(boosting.dressing, null);
  assert.equal(jackets.update(0, 4, false, pose).dressing, 0);
  const dressing = jackets.update(0, 4.4, false, pose); assert.equal(dressing.bare, true); assert.ok(dressing.dressing > .4 && dressing.dressing < .5);
  const restored = jackets.update(0, 4.86, false, pose); assert.equal(restored.bare, false); assert.equal(restored.dressing, null);
});
test('overlapping boost and Vulcan keep the jacket off until both end, and reactivation interrupts dressing', () => {
  const jackets = new YudaJackets(), pose = { x: 0, z: 0, height: 0, angle: 0 };
  jackets.update(0, 0, false, pose); jackets.update(0, 1, true, pose);
  const vulcan = jackets.update(0, 5, true, pose); assert.equal(vulcan.bare, true); assert.equal(vulcan.dressing, null); assert.equal(vulcan.flight, null);
  jackets.update(0, 6, false, pose); jackets.update(0, 6.2, false, pose);
  const restarted = jackets.update(0, 6.3, true, pose); assert.equal(restarted.bare, true); assert.equal(restarted.dressing, null); assert.equal(restarted.flight.start, 6.3);
});
test('each rider has independent clothing and a restarted preview clock resets its outfit', () => {
  const jackets = new YudaJackets(), pose = { x: 0, z: 0, height: 0, angle: 0 };
  jackets.update(0, 5, true, pose); assert.equal(jackets.update(1, 5, false, pose).bare, false);
  assert.equal(jackets.update(0, 6, true, pose).bare, true);
  assert.equal(jackets.update(0, 0, false, pose).bare, false);
});
