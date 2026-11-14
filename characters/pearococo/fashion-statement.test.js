import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattle } from '../../gameplay/combat.js';
import { fashionDamage, useSpecial } from '../../gameplay/special-abilities.js';
import { ArenaCore } from '../../gameplay/arena-core.js';
import { KillCelebration } from '../../ui/combat-notices.js';
import { decodeBinarySnapshot } from '../../networking/binary-wire.js';
test('Fashion-Statement damage decreases with cuteness and never drops below one', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(fashionDamage), [2, 2, 2, 2, 1]);
});
for (const engine of ['JavaScript', 'Rust']) {
  for (const [driver, health] of [[6, 4], [1, 4], [2, 4], [5, 5]]) test(`${engine}: Fashion-Statement leaves driver ${driver} with ${health} of six hearts`, () => {
    const w = createBattle(9); Object.assign(w, { phase: 'racing', human: true, wx: 65, wz: 40, supplies: [] }); for (const b of w.bots) Object.assign(b, { inactive: true, destroyed: 999 }); Object.assign(w.bots[0], { driver, wx: 65, wz: 55, health: 6, human: true, inactive: false, destroyed: 0 });
    const core = engine === 'Rust' ? new ArenaCore(w) : null; if (core) core.step(0, [{ actor: 0, actions: [{ type: 'special' }] }]); if (!core) useSpecial(w);
    const after = core ? core.snapshot() : w; assert.equal(after.bots[0].health, health); assert.equal(after.health, 3); assert.equal(after.specialCooldown, 30); assert.equal(after.effects.filter(e => e.type === 'fashionSnap').length, 1);
  });
  test(`${engine}: Fashion-Statement scores its kill, also hits distant opponents and cannot repeat during recharge`, () => {
    const w = createBattle(9); Object.assign(w, { phase: 'racing', human: true, wx: 65, wz: 40, supplies: [] }); for (const b of w.bots) Object.assign(b, { inactive: true, destroyed: 999 }); Object.assign(w.bots[0], { driver: 6, wx: 65, wz: 55, health: 2, human: true, inactive: false, destroyed: 0 }); Object.assign(w.bots[1], { driver: 6, wx: 65, wz: 80, health: 3, human: true, inactive: false, destroyed: 0 });
    const core = engine === 'Rust' ? new ArenaCore(w) : null;
    const celebration = new KillCelebration(); celebration.sample(core ? core.snapshot() : w, 0);
    for (let i = 0; i < 2; i++) { if (core) core.step(0, [{ actor: 0, actions: [{ type: 'special' }] }]); if (!core) useSpecial(w); }
    const after = core ? core.snapshot() : w; assert.equal(after.kills, 1); assert.equal(after.bots[0].destroyed, 3); assert.equal(after.bots[1].health, 1);
    assert.deepEqual(after.effects.filter(e => e.type === 'fashionSnap').map(e => [e.wx, e.wz]), [[65, 55], [65, 80]]);
    assert.equal(celebration.sample(after, .1).subtitle, "That's all.");
    if (core) assert.equal(decodeBinarySnapshot(core.packet(0)).world.killFeed[0].kind, 'fashion');
  });
  test(`${engine}: host disabling abilities prevents Fashion-Statement damage`, () => {
    const w = createBattle(9); Object.assign(w, { phase: 'racing', specialAbilities: false, wx: 65, wz: 40 }); Object.assign(w.bots[0], { driver: 6, wx: 65, wz: 55, health: 6, human: true });
    const core = engine === 'Rust' ? new ArenaCore(w) : null; if (core) core.step(0, [{ actor: 0, actions: [{ type: 'special' }] }]); if (!core) assert.equal(useSpecial(w), false); assert.equal((core ? core.snapshot() : w).bots[0].health, 6);
  });
}
