import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, tickBattle } from '../../gameplay/combat.js';
import { ArenaCore } from '../../gameplay/arena-core.js';
import { useSpecial } from '../../gameplay/special-abilities.js';

for (const engine of ['JavaScript', 'Rust']) {
  test(`${engine}: Tax-Audit totals all carried items and instantly defeats the richest rival through shields`, () => {
    const w = createBattle(13); Object.assign(w, { phase: 'racing', human: true, ammo: 10, missiles: 0, turbos: 0, chaff: 0, supplies: [] });
    for (const a of w.bots) Object.assign(a, { inactive: true, destroyed: 999 });
    Object.assign(w.bots[0], { inactive: false, destroyed: 0, human: true, ammo: 11, missiles: 0, turbos: 0, chaff: 0, health: 6, wx: 60, wz: 60 });
    Object.assign(w.bots[1], { inactive: false, destroyed: 0, human: true, ammo: 5, missiles: 3, turbos: 2, chaff: 2, health: 6, hedgeShield: 25, tehilim: 25, wx: -60, wz: -60 });
    const core = engine === 'Rust' ? new ArenaCore(w) : null;
    if (core) core.step(0, [{ actor: 0, actions: [{ type: 'special' }] }]); if (!core) useSpecial(w);
    const after = core ? core.snapshot() : w;
    assert.equal(after.bots[0].health, 6); assert.equal(after.bots[1].health, 0); assert.equal(after.bots[1].destroyed, 3); assert.equal(after.kills, 1); assert.equal(after.specialCooldown, 20);
    assert.ok(after.effects.some(e => e.type === 'taxAudit' && e.wx === -60 && e.wz === -60));
    if (core) core.step(0, [{ actor: 0, actions: [{ type: 'special' }] }]); if (!core) useSpecial(w);
    assert.equal((core ? core.snapshot() : w).bots[0].health, 6);
  });
  for (const own of [12, 13]) test(`${engine}: Fourmidable holding ${own} items versus a rival's 12 triggers Xylophone-Attack for five seconds`, () => {
    const w = createBattle(13); Object.assign(w, { phase: 'racing', human: true, ammo: own, missiles: 0, turbos: 0, chaff: 0, supplies: [] });
    for (const a of w.bots) Object.assign(a, { inactive: true, destroyed: 999, ammo: 100 });
    Object.assign(w.bots[0], { inactive: false, destroyed: 0, human: true, ammo: 12, missiles: 0, turbos: 0, chaff: 0, health: 3 });
    const core = engine === 'Rust' ? new ArenaCore(w) : null; if (core) core.step(0, [{ actor: 0, actions: [{ type: 'special' }] }]); if (!core) useSpecial(w);
    const after = core ? core.snapshot() : w; assert.equal(after.bots[0].health, 3); assert.equal(after.health, 3); assert.equal(after.specialCooldown, 20); assert.equal(after.specialActive, 5); assert.equal(after.kills, 0);
    for (let i = 0; i < 101; i++) { if (core) core.step(.05); if (!core) tickBattle(w, new Set(), .05); } assert.equal((core ? core.snapshot() : w).specialActive, 0);
  });
  test(`${engine}: rival ties audit the lowest player ID and the host can disable Tax-Audit`, () => {
    for (const enabled of [true, false]) {
      const w = createBattle(13); Object.assign(w, { phase: 'racing', human: true, ammo: 1, chaff: 0, specialAbilities: enabled, supplies: [] });
      for (const a of w.bots) Object.assign(a, { inactive: true, destroyed: 999 });
      for (const a of w.bots.slice(0, 2)) Object.assign(a, { inactive: false, destroyed: 0, human: true, ammo: 12, missiles: 0, turbos: 0, chaff: 0, health: 3 });
      const core = engine === 'Rust' ? new ArenaCore(w) : null; if (core) core.step(0, [{ actor: 0, actions: [{ type: 'special' }] }]); if (!core) useSpecial(w);
      const after = core ? core.snapshot() : w; assert.equal(after.bots[0].health, enabled ? 0 : 3); assert.equal(after.bots[1].health, 3);
    }
  });
}
