import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { arenas, blocked, createBattle, inArenaBounds, standings, tickBattle } from '../../gameplay/combat.js';
import { ArenaCore } from '../../gameplay/arena-core.js';
import { Multiplayer } from '../../server/multiplayer.js';

test('Octagon is an obstacle-free regular octagon capped at 4 players', () => {
  const octagon = arenas[2];
  assert.equal(octagon.name, 'Octagon');
  assert.equal(octagon.shape, 'octagon');
  assert.equal(octagon.maxPlayers, 4);
  assert.deepEqual(octagon.blocks, []);

  // Center and interior are completely open.
  for (const [x, z] of [[0, 0], [30, 0], [0, -30], [35, 35], [-35, 35], [40, 40]]) {
    assert.equal(blocked(octagon, x, z, 2), false, `expected (${x},${z}) open`);
  }
  // Cardinal walls at ±size and diagonal octagon walls at (|x|+|z|)/sqrt(2) = size.
  assert.equal(inArenaBounds(octagon, 64, 0), true);
  assert.equal(inArenaBounds(octagon, 64.1, 0), false);
  assert.equal(inArenaBounds(octagon, 45, 45), true); // (45+45)/sqrt(2) = 63.64 <= 64
  assert.equal(inArenaBounds(octagon, 46, 46), false); // (46+46)/sqrt(2) = 65.05 > 64
  assert.equal(blocked(octagon, 45, 45, 2), true); // 63.64 > 62
  assert.equal(blocked(octagon, 43, 43, 2), false); // 60.81 <= 62
});

test('solo Octagon spawns 4 active fighters inside the octagon and matches Rust movement bounds', () => {
  const world = createBattle(0, 2, () => 0.4);
  const active = standings(world);
  assert.equal(active.length, 4);
  for (const actor of active) {
    assert.equal(blocked(arenas[2], actor.wx, actor.wz, 2), false);
  }

  // Drive diagonally toward the (+x, +z) octagon wall in both JS and Rust and verify identical collision.
  world.phase = 'racing';
  world.human = true;
  for (const b of world.bots) b.human = true;
  world.wx = 40;
  world.wz = 40;
  world.heading = Math.PI / 4;
  world.motionHeading = Math.PI / 4;
  world.cameraHeading = Math.PI / 4;
  world.speed = 400;
  const core = new ArenaCore(world);
  const keys = new Set(['arrowup']);
  for (let i = 0; i < 40; i++) {
    tickBattle(world, keys, 1 / 60);
    core.step(1 / 60, [{ actor: 0, keys: 1 }]);
  }
  const snap = core.snapshot();
  assert.equal(blocked(arenas[2], world.wx, world.wz, 2), false);
  assert.equal(blocked(arenas[2], snap.wx, snap.wz, 2), false);
  assert.ok((Math.abs(snap.wx) + Math.abs(snap.wz)) * Math.SQRT1_2 <= arenas[2].size - 2 + 1e-6);
  assert.ok(Math.abs(snap.wx - world.wx) < 1e-5);
  assert.ok(Math.abs(snap.wz - world.wz) < 1e-5);
});

test('multiplayer server enforces Octagon 4-player maximum on join, bots, and arena switching', async t => {
  const mp = new Multiplayer();
  const server = http.createServer((req, res) => mp.handle(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { mp.close(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, body, token) => {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: base,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };

  // Creating an Octagon room with >3 bots is rejected; 3 bots succeeds (1 human + 3 bots = 4).
  const tooManyBots = await post('/api/rooms', { name: 'Host', driver: 0, arena: 2, bots: 4 });
  assert.equal(tooManyBots.status, 400);

  const created = await post('/api/rooms', { name: 'Host', driver: 0, arena: 2, bots: 3 });
  assert.equal(created.status, 200);
  const { code, token: hostToken } = created.body;
  assert.equal(created.body.world.arena, 2);
  assert.equal(created.body.bots, 3);

  // Join 3 more humans (total 4); bots automatically drop to 0.
  for (let i = 1; i <= 3; i++) {
    const joined = await post('/api/join', { code, name: `P${i}`, driver: i });
    assert.equal(joined.status, 200);
    assert.equal(joined.body.bots, 3 - i);
  }
  // 5th human is rejected while on Octagon.
  const fifth = await post('/api/join', { code, name: 'P4', driver: 4 });
  assert.equal(fifth.status, 409);

  // Switch to Scrapyard -> 5th human can join -> switching back to Octagon is rejected with 409.
  assert.equal((await post('/api/control', { action: 'arena', arena: 0 }, hostToken)).status, 200);
  assert.equal((await post('/api/join', { code, name: 'P4', driver: 4 })).status, 200);
  const backToOctagon = await post('/api/control', { action: 'arena', arena: 2 }, hostToken);
  assert.equal(backToOctagon.status, 409);
});
