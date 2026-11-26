import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, damageBattle, tickBattle } from '../../gameplay/combat.js';
import { ArenaCore } from '../../gameplay/arena-core.js';
import { useSpecial, karmaTarget } from '../../gameplay/special-abilities.js';
import { AbilityUsage } from '../../ui/ability-announcements.js';
import { RewardQueue } from '../../ui/reward-notice.js';
import {
  drawPickupTruck,
  drawTycoon,
  drawKarmaAura,
  drawKarmaRaccoon,
  drawTycoonBoost,
} from './tycoon.js';

function recorder() {
  const m = {
    origin: [0, 0, 0],
    yaw: 0,
    tris: 0,
    boxes: 0,
    balls: 0,
    cones: 0,
    quads: 0,
    points: [],
    at(x, y, z, yaw = 0) { this.origin = [x, y, z]; this.yaw = yaw; },
    point([x, y, z]) {
      const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
      const out = [x * c + z * s + this.origin[0], y + this.origin[1], -x * s + z * c + this.origin[2]];
      this.points.push(out);
      return out;
    },
    tri(a, b, c) { this.point(a); this.point(b); this.point(c); this.tris++; },
    quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); this.quads++; },
    box(x, y, z) { this.point([x, y, z]); this.boxes++; },
    ball(x, y, z) { this.point([x, y, z]); this.balls++; },
    cone(x, y, z) { this.point([x, y, z]); this.cones++; },
  };
  const glow = {
    origin: [0, 0, 0],
    quads: 0,
    particles: [],
    at(x, y, z) { this.origin = [x, y, z]; },
    quad() { this.quads++; },
    particle(x, y, z, size, color) { this.particles.push({ x, y, z, size, color }); },
  };
  const smoke = {
    origin: [0, 0, 0],
    particles: [],
    at(x, y, z) { this.origin = [x, y, z]; },
    particle(x, y, z, size, color) { this.particles.push({ x, y, z, size, color }); },
  };
  return { m, glow, smoke };
}

test('Tycoon pickup truck, raccoon animation, aura, boost, and Karmic Raccooning 3D effect are deterministic and finite', () => {
  const truck = recorder();
  drawPickupTruck(truck.m, '#6eb89f');
  assert.ok(truck.m.boxes > 20 && truck.m.balls > 40);

  // Idle sway and celebrate wave produce distinct raccoon poses.
  const idle0 = recorder(), idle2 = recorder(), wave = recorder();
  drawTycoon(idle0.m, 0, false);
  drawTycoon(idle2.m, 2, false);
  drawTycoon(wave.m, 2, true);
  assert.notDeepEqual(idle0.m.points, idle2.m.points);
  assert.notDeepEqual(idle2.m.points, wave.m.points);

  // Karmic aura and alpine boost emit glowing geometry and particles.
  const aura = recorder();
  drawKarmaAura(aura.m, aura.glow, { x: 0, z: 0 }, 1.25, null);
  assert.ok(aura.glow.quads === 36 && aura.glow.particles.length === 6 && aura.m.balls === 6);

  const boost = recorder();
  drawTycoonBoost(boost.glow, boost.smoke, { x: 0, z: 0 }, 0, 0.5, null);
  assert.ok(boost.glow.particles.length > 0 && boost.smoke.particles.length > 0);

  // Karmic Raccooning 3D animation blooms, spins, swaps orbs, and fades out cleanly.
  const early = recorder(), mid = recorder(), late = recorder(), ended = recorder();
  drawKarmaRaccoon(early.m, early.glow, { wx: 10, wz: -8, age: 0.2, life: 2.8 }, 0);
  drawKarmaRaccoon(mid.m, mid.glow, { wx: 10, wz: -8, age: 1.2, life: 2.8 }, 0);
  drawKarmaRaccoon(late.m, late.glow, { wx: 10, wz: -8, age: 2.5, life: 2.8 }, 0);
  drawKarmaRaccoon(ended.m, ended.glow, { wx: 10, wz: -8, age: 2.8, life: 2.8 }, 0);

  assert.ok(mid.m.quads > 0 && mid.m.tris > 0 && mid.glow.particles.length > 0);
  assert.notDeepEqual(early.m.points, mid.m.points);
  assert.notDeepEqual(mid.m.points, late.m.points);
  assert.equal(ended.m.points.length, 0);
  for (const pt of [...early.m.points, ...mid.m.points, ...late.m.points]) {
    assert.ok(pt.every(Number.isFinite));
  }
});

for (const engine of ['JavaScript', 'Rust']) {
  test(`${engine}: Karmic Raccooning kills the last killer through shields and swaps kill scores when in Tycoon's favor`, () => {
    const w = createBattle(15);
    Object.assign(w, { phase: 'racing', human: true, kills: 1, supplies: [] });
    for (const a of w.bots) Object.assign(a, { inactive: true, destroyed: 999 });
    // Bot 0 previously killed Tycoon and has a commanding lead (7 kills) plus shields.
    Object.assign(w.bots[0], {
      inactive: false, destroyed: 0, human: true, name: 'Rocco',
      health: 6, kills: 7, shield: 2, hedgeShield: 25, wx: 40, wz: -20,
    });
    w.lastKiller = w.bots[0].id;

    const core = engine === 'Rust' ? new ArenaCore(w) : null;
    if (core) core.step(0, [{ actor: 0, actions: [{ type: 'special' }] }]);
    else assert.equal(useSpecial(w), true);

    const after = core ? core.snapshot() : w;
    assert.equal(after.bots[0].health, 0);
    assert.equal(after.bots[0].destroyed, 3);
    // Tycoon got +1 (1 -> 2), then swapped with Rocco (7) in Tycoon's favor -> Tycoon 7, Rocco 2!
    assert.equal(after.kills, 7);
    assert.equal(after.bots[0].kills, 2);
    assert.equal(after.specialCooldown, 30);
    assert.ok(after.specialActive > 2);
    assert.ok(after.effects.some(e => e.type === 'karmaRaccoon' && e.wx === 40 && e.wz === -20));
    assert.equal(after.lastKarma.swapped, true);
    assert.equal(after.lastKarma.casterBefore, 1);
    assert.equal(after.lastKarma.casterAfter, 7);
    assert.equal(after.lastKarma.victimBefore, 7);
    assert.equal(after.lastKarma.victimAfter, 2);
  });

  test(`${engine}: Karmic Raccooning kills last killer without swapping when Tycoon is already ahead`, () => {
    const w = createBattle(15);
    Object.assign(w, { phase: 'racing', human: true, kills: 6, supplies: [] });
    for (const a of w.bots) Object.assign(a, { inactive: true, destroyed: 999 });
    Object.assign(w.bots[0], {
      inactive: false, destroyed: 0, human: true, name: 'Felix',
      health: 3, kills: 2, wx: -30, wz: 15,
    });
    w.lastKiller = w.bots[0].id;

    const core = engine === 'Rust' ? new ArenaCore(w) : null;
    if (core) core.step(0, [{ actor: 0, actions: [{ type: 'special' }] }]);
    else assert.equal(useSpecial(w), true);

    const after = core ? core.snapshot() : w;
    assert.equal(after.bots[0].health, 0);
    // Tycoon stays ahead (6 + 1 = 7) and does NOT swap down to 2.
    assert.equal(after.kills, 7);
    assert.equal(after.bots[0].kills, 2);
    assert.equal(after.lastKarma.swapped, false);
  });

  test(`${engine}: getting knocked out records lastKiller across respawn, and Karmic Raccooning refuses without a living killer`, () => {
    const w = createBattle(15);
    Object.assign(w, { phase: 'racing', human: true, health: 1, supplies: [] });
    for (const a of w.bots) Object.assign(a, { inactive: true, destroyed: 999 });
    Object.assign(w.bots[0], { inactive: false, destroyed: 0, human: true, health: 3, kills: 5 });

    // No killer yet -> cannot activate.
    if (engine === 'JavaScript') {
      assert.equal(karmaTarget(w, w), null);
      assert.equal(useSpecial(w), false);
      assert.equal(w.specialCooldown ?? 0, 0);
      // Bot 0 knocks Tycoon out.
      damageBattle(w, w, w.bots[0].id, 1, 'hedgehog');
      assert.equal(w.lastKiller, w.bots[0].id);
      // Respawn preserves lastKiller.
      for (let i = 0; i < 65; i++) tickBattle(w, new Set(), 0.05);
      assert.equal(w.destroyed, 0);
      assert.equal(w.lastKiller, w.bots[0].id);
      assert.equal(karmaTarget(w, w).id, w.bots[0].id);
    } else {
      const core = new ArenaCore(w);
      core.step(0, [{ actor: 0, actions: [{ type: 'special' }] }]);
      assert.equal(core.snapshot().specialCooldown, 0);
    }
  });
}

test('Karmic Raccooning produces a crystal-clear animated announcement with score swap details', () => {
  const tracker = new AbilityUsage();
  const queue = new RewardQueue();
  const world = {
    mode: 'combat', phase: 'racing', soundEpoch: 1, arena: 0, elapsed: 10,
    id: 0, driver: 15, name: 'Tai-Coon', specialCooldown: 0, lastKarma: null, bots: [],
  };
  assert.deepEqual(tracker.sample(world), []);

  world.specialCooldown = 30;
  world.lastKarma = {
    id: 1, caster: 0, casterName: 'Tai-Coon', victim: 1, victimName: 'Rocco',
    swapped: true, casterBefore: 1, casterAfter: 7, victimBefore: 7, victimAfter: 2, time: 10,
  };
  const events = tracker.sample(world);
  assert.equal(events.length, 1);
  assert.equal(events[0].theme, 'karma');
  assert.match(events[0].title, /SCORES SWAPPED/i);
  assert.ok(events[0].detail.startsWith('karma is a Waschbitch · '));
  assert.match(events[0].detail, /ROCCO/i);
  assert.match(events[0].detail, /7.*2/);
  assert.equal(events[0].from, 1);
  assert.equal(events[0].to, 7);
  queue.show(events[0]);
  assert.equal(queue.sample(0).theme, 'karma');
  assert.equal(queue.sample(3.8), null);
});
