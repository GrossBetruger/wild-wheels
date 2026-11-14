import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, tickBattle, blocked, arenas } from '../../gameplay/combat.js';
import { ArenaCore, ArenaClient } from '../../gameplay/arena-core.js';

for (const engine of ['solo', 'Rust']) {
  test(`${engine}: Providence leads a moving shooter with aggressive steering`, () => {
    const seed = createBattle(11); Object.assign(seed, { phase: 'racing', human: true, wx: 65, wz: 80, specialActive: 8, supplies: [] }); for (const bot of seed.bots) Object.assign(bot, { inactive: true, destroyed: 999 }); Object.assign(seed.bots[0], { inactive: false, destroyed: 0, human: true, wx: 65, wz: 40, heading: Math.PI / 2, motionHeading: Math.PI / 2, speed: 300 });
    seed.projectiles = [{ id: 1, kind: 'missile', owner: 1, target: 0, wx: 65, wz: 60, heading: Math.PI, speed: 70, height: 1.3, vy: 0, life: 3, age: 0, trail: [] }];
    const core = engine === 'Rust' ? new ArenaCore(seed) : null; if (core) core.step(1 / 60, [{ actor: 1, keys: ['arrowup'] }]); if (!core) tickBattle(seed, new Set(), 1 / 60, new Map([[1, new Set(['arrowup'])]]));
    const shot = (core ? core.snapshot() : seed).projectiles[0]; assert.equal(shot.target, 1); assert.equal(shot.speed, 100); assert.ok(shot.life > 5.9); assert.ok(shot.heading < Math.PI - .1);
  });
  test(`${engine}: Tehilim books have the same rarity, duration and refill as Hedgeguard`, () => {
    for (const arena of [0, 1]) {
      const seed = createBattle(0, arena), books = seed.supplies.filter(s => s.kind === 'tehilim'); assert.equal(books.length, 1); assert.equal(books[0].cooldown, 30); assert.equal(blocked(arenas[arena], books[0].wx, books[0].wz, 4), false);
      books[0].randomSpawn=false; // Isolate timing from randomized spawn placement.
      Object.assign(seed, { phase: 'racing', human: true, wx: books[0].wx, wz: books[0].wz }); for (const bot of seed.bots) Object.assign(bot, { inactive: true, destroyed: 999 });
      const core = engine === 'Rust' ? new ArenaCore(seed) : null, step = () => core ? core.step(1 / 60) : tickBattle(seed, new Set(), 1 / 60), read = () => core ? core.snapshot() : seed;
      for (let i = 0; i < 1799; i++)step(); assert.equal(read().tehilim, 0); step(); step(); assert.ok(read().tehilim > 24.97); assert.ok(read().supplies.find(s => s.kind === 'tehilim').cooldown > 49.9); assert.equal(read().item, 'hedgehog');
    }
  });
  test(`${engine}: Tehilim repels a halfway missile without transferring ownership or targeting its shooter`, () => {
    const seed = createBattle(); Object.assign(seed, { phase: 'racing', human: true, wx: 65, wz: 80, health: 6, tehilim: 25, supplies: [] }); for (const bot of seed.bots) Object.assign(bot, { inactive: true, destroyed: 999 }); Object.assign(seed.bots[0], { inactive: false, destroyed: 0, human: true, wx: 65, wz: 40, health: 3, tehilim: 25 });
    seed.projectiles = [{ id: 1, kind: 'missile', owner: 1, target: 0, wx: 65, wz: 60, heading: 0, speed: 70, height: 1.3, vy: 0, life: 3, age: 0, trail: [] }];
    const core = engine === 'Rust' ? new ArenaCore(seed) : null, step = dt => core ? core.step(dt) : tickBattle(seed, new Set(), dt), read = () => core ? core.snapshot() : seed;
    step(0); assert.equal(read().projectiles[0].owner, 1); assert.equal(read().projectiles[0].target, null); assert.equal(read().projectiles[0].repelledFrom, 0); assert.equal(read().projectiles[0].heading, 0);
    assert.equal(read().projectiles[0].speed, 70); assert.equal(read().projectiles[0].life, 3);
    step(1 / 60); assert.ok(Math.abs(read().projectiles[0].heading) > .19 && Math.abs(read().projectiles[0].heading) < .21);
    for (let i = 0; i < 120; i++)step(1 / 60);
    assert.equal(read().health, 6); assert.equal(read().kills, 0); assert.equal(read().bots[0].deaths, 0);
  });
  for (const [kind, target, z, timer, health] of [['missile', 0, -31, 25, 6], ['missile', null, -2, 25, 3], ['missile', 0, -2, 0, 3], ['hedgehog', 0, -2, 25, 5]]) {
    test(`${engine}: ${kind} target ${target} at ${z} with ${timer}s books leaves ${health} health`, () => {
      const seed = createBattle(); Object.assign(seed, { phase: 'racing', human: true, wx: -65, wz: 0, health: 6, tehilim: timer, supplies: [] }); for (const bot of seed.bots) Object.assign(bot, { inactive: true, destroyed: 999 }); Object.assign(seed.bots[0], { inactive: false, destroyed: 0, human: true, wx: -65, wz: -60 });
      seed.projectiles = [{ id: 1, kind, owner: 1, target, wx: -65, wz: z, heading: 0, speed: 70, height: 1.3, vy: 0, life: 3, age: 0, trail: [] }];
      const core = engine === 'Rust' ? new ArenaCore(seed) : null; if (core) core.step(1 / 60); if (!core) tickBattle(seed, new Set(), 1 / 60); const after = core ? core.snapshot() : seed;
      assert.equal(after.health, health); if (z === -31) { assert.equal(after.projectiles[0].owner, 1); assert.equal(after.projectiles[0].target, 0); }
    });
  }
}
test('collecting books is immediate for the client and the aura is replicated to other players', () => {
  const seed = createBattle(); Object.assign(seed, { phase: 'racing', human: true, multiplayer: true, wx: -65, wz: 0, supplies: [{ id: 9, kind: 'tehilim', wx: -65, wz: 0, version: 0, cooldown: 0 }] }); for (const bot of seed.bots) Object.assign(bot, { inactive: true, destroyed: 999 });
  const server = new ArenaCore(seed), local = new ArenaClient(), peer = new ArenaClient(); local.accept(server.packet(), 0); local.frame(1 / 60, [], 1 / 60); assert.equal(local.present().tehilim, 25); assert.equal(server.snapshot().tehilim, 0);
  server.step(1 / 60, [{ actor: 0, ...local.outbound([]) }]); local.accept(server.packet(), 1 / 60); local.frame(0, [], 1 / 60); peer.accept(server.packet(1), 1 / 60); peer.frame(0, [], 1 / 60);
  assert.equal(local.present().tehilim, 25); assert.equal(peer.present().bots.find(a => a.id === 0).tehilim, 25); assert.equal(local.present().supplies[0].kind, 'tehilim'); assert.equal(local.present().supplies[0].cooldown, 50);
});

for (const engine of ['solo', 'Rust']) for (const shooterAlive of [true, false]) test(`${engine}: books repel a point-blank locked missile even when shooter alive is ${shooterAlive}`, () => {
  const world = createBattle(); Object.assign(world, { phase: 'racing', human: true, wx: 65, wz: 0, health: 6, tehilim: 25, supplies: [] }); for (const a of world.bots) Object.assign(a, { inactive: true, destroyed: 999 });
  Object.assign(world.bots[0], { inactive: false, destroyed: shooterAlive ? 0 : 3, human: true, wx: 65, wz: -60 });
  world.projectiles = [{ id: 1, kind: 'missile', owner: 1, target: 0, wx: 65, wz: -2, heading: 0, speed: 70, height: 1.3, vy: 0, life: 3, age: 0, trail: [] }];
  const core = engine === 'Rust' ? new ArenaCore(world) : null; if (core) core.step(1 / 60); if (!core) tickBattle(world, new Set(), 1 / 60);
  const after = core ? core.snapshot() : world; assert.equal(after.health, 6); assert.equal(after.projectiles[0].owner, 1); assert.equal(after.projectiles[0].target, null); assert.ok(after.projectiles[0].wz < -3);
});

test('repulsion ownership and lock loss are replicated to the shooter', () => {
  const world = createBattle(); Object.assign(world, { phase: 'racing', human: true, wx: 65, wz: 80, health: 6, tehilim: 25, supplies: [] }); for (const a of world.bots) Object.assign(a, { inactive: true, destroyed: 999 }); Object.assign(world.bots[0], { inactive: false, destroyed: 0, human: true, wx: 65, wz: 40 });
  world.projectiles = [{ id: 1, kind: 'missile', owner: 1, target: 0, wx: 65, wz: 60, heading: 0, speed: 70, height: 1.3, vy: 0, life: 3, age: 0, trail: [] }];
  const core = new ArenaCore(world); core.step(0); const client = new ArenaClient(); client.accept(core.packet(1), 0); client.frame(0, [], 0);
  assert.equal(client.present().projectiles[0].owner, 1); assert.equal(client.present().projectiles[0].target, null);
});
