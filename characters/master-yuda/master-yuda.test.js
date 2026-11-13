import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, tickBattle, somersaultBattle, somersaultPose } from '../../gameplay/combat.js';
import { ArenaCore } from '../../gameplay/arena-core.js';

for (const engine of ['solo', 'Rust multiplayer']) {
  test(`${engine}: Master-Yuda's lasers deal one damage at Vulcan cadence without spending hedgehogs`, () => {
    const seed = createBattle(10); Object.assign(seed, { phase: 'racing', human: true, wx: -65, wz: 0, heading: 0, motionHeading: 0, cameraHeading: 0, vulcan: 8, item: 'hedgehog', fireCooldown: 0, ammo: 10, supplies: [] });
    Object.assign(seed.bots[0], { human: true, wx: -65, wz: 12, speed: 0, health: 2, shield: 0 }); for (const bot of seed.bots.slice(1)) Object.assign(bot, { inactive: true, destroyed: 1e9 });
    const core = engine === 'solo' ? null : new ArenaCore(seed), step = () => core ? core.step(1 / 60, [{ actor: 0, keys: [' '] }]) : tickBattle(seed, new Set([' ']), 1 / 60), read = () => core ? core.snapshot() : seed;
    for (let frame = 0; frame < 3; frame++)step();
    assert.equal(read().bots[0].health, 1); assert.equal(read().kills, 0); assert.equal(read().ammo, 10);
    for (let frame = 0; frame < 5; frame++)step();
    assert.equal(read().bots[0].health, 0); assert.equal(read().kills, 1); assert.ok(read().celebrate > 1.5); assert.equal(read().ammo, 10);
  });
  test(`${engine}: Master-Yuda reverses on a motorcycle flip and lands without spending supplies`, () => {
    const seed = createBattle(10); Object.assign(seed, { phase: 'racing', human: true, wx: -65, wz: 0, heading: 0, motionHeading: 0, cameraHeading: 0, speed: 0, supplies: [] }); for (const bot of seed.bots) Object.assign(bot, { inactive: true, destroyed: 1e9 });
    const core = engine === 'solo' ? null : new ArenaCore(seed);
    if (core) core.step(0, [{ actor: 0, actions: [{ type: 'somersault', id: 0, afterMove: -1 }] }]);
    if (!core) assert.equal(somersaultBattle(seed), true);
    const read = () => core ? core.snapshot() : seed;
    assert.equal(read().heading, Math.PI); assert.equal(read().somersault, .55);
    const middle = somersaultPose({ ...read(), somersault: .275 }); assert.equal(middle.height, 2.8); assert.equal(middle.roll, Math.PI); assert.equal(middle.yaw, -Math.PI / 2);
    for (let frame = 0; frame < 34; frame++) { if (core) { core.step(1 / 60, []); continue; } tickBattle(seed, new Set(), 1 / 60); }
    assert.equal(somersaultPose(read()), null); assert.equal(read().ammo, 10); assert.equal(read().missiles, 1); assert.equal(read().turbos, 1);
  });
}
