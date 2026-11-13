import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, tickBattle } from '../../gameplay/combat.js';
import { ArenaCore } from '../../gameplay/arena-core.js';

for (const engine of ['solo', 'Rust multiplayer']) {
  test(`${engine}: Avita-Jas's Vulcan electrons deal one damage and do not spend ammunition`, () => {
    const seed = createBattle(8); Object.assign(seed, { phase: 'racing', human: true, wx: -65, wz: 0, heading: 0, motionHeading: 0, cameraHeading: 0, vulcan: 8, item: 'hedgehog', fireCooldown: 0, ammo: 10, supplies: [] });
    Object.assign(seed.bots[0], { human: true, wx: -65, wz: 12, speed: 0, health: 3, shield: 0 }); for (const bot of seed.bots.slice(1)) Object.assign(bot, { inactive: true, destroyed: 1e9 });
    const core = engine === 'solo' ? null : new ArenaCore(seed);
    for (let tick = 0; tick < 3; tick++) { if (core) core.step(1 / 60, [{ actor: 0, keys: [' '] }]); if (!core) tickBattle(seed, new Set([' ']), 1 / 60); }
    const after = core ? core.snapshot() : seed; assert.equal(after.bots[0].health, 2); assert.equal(after.ammo, 10); assert.equal(after.missiles, 1);
  });
}
