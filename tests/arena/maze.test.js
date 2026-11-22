import test from 'node:test';
import assert from 'node:assert/strict';
import { arenas, blocked, createBattle, standings, tickBattle } from '../../gameplay/combat.js';
import { ArenaCore } from '../../gameplay/arena-core.js';

test('Maze has connected drivable corridors, generous spawn clearance, and supports full player count', () => {
  const maze = arenas[3];
  assert.equal(maze.name, 'Maze');
  assert.equal(maze.size, 96);
  assert.equal(maze.maxPlayers, undefined);
  assert.equal(maze.blocks.length, 24);

  // Every spawn point on the 8-player ring has >= 10 units of clearance from every wall.
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    const sx = Math.sin(a) * 78;
    const sz = Math.cos(a) * 78;
    assert.equal(blocked(maze, sx, sz, 10), false, `spawn ${i} too close to a wall`);
  }

  // Every open cell on the 18x18 bot navigation grid is mutually reachable (zero traps/isolated pockets).
  const open = [];
  for (let nz = 0; nz < 18; nz++) {
    for (let nx = 0; nx < 18; nx++) {
      if (!blocked(maze, nx * 10 - 85, nz * 10 - 85, 3)) open.push(nx + nz * 18);
    }
  }
  assert.ok(open.length > 200);
  const visited = new Set([open[0]]);
  const queue = [open[0]];
  while (queue.length) {
    const n = queue.shift();
    const x = n % 18;
    const z = Math.floor(n / 18);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const nz = z + dz;
      const next = nx + nz * 18;
      if (nx >= 0 && nx < 18 && nz >= 0 && nz < 18 && !visited.has(next) && !blocked(maze, nx * 10 - 85, nz * 10 - 85, 3)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  assert.equal(visited.size, open.length, 'all Maze corridors must form one connected graph');
});

test('Maze supports 8-player Rust rooms and active bot combat with kills', () => {
  const core = ArenaCore.room({
    code: '00',
    host: null,
    dedicated: true,
    maxPlayers: 8,
    arena: 3,
    bots: 7,
    players: [{ id: 0, name: 'Runner', driver: 0, role: 'driver' }],
    epoch: 1,
    seed: 7,
  });
  core.start();
  for (let i = 0; i < 60 * 35; i++) core.step(1 / 60);
  const snap = core.snapshot();
  assert.equal(snap.arena, 3);
  assert.equal(snap.bots.length, 7);
  const totalKills = snap.kills + snap.bots.reduce((sum, b) => sum + b.kills, 0);
  assert.ok(totalKills >= 1, `expected active combat kills in Maze, got ${totalKills}`);
  // Packet includes inline arenaDef so older native clients render Maze without rebuilding.
  const decoded = core.packet(0);
  const metaSize = new DataView(decoded.buffer, decoded.byteOffset, decoded.byteLength).getUint32(4, true);
  const meta = JSON.parse(new TextDecoder().decode(decoded.subarray(16, 16 + metaSize)));
  assert.equal(meta.state.world.arenaDef.name, 'Maze');
  assert.equal(meta.state.world.arenaDef.blocks.length, 24);

  // Solo 6-fighter match also spawns all 6 fighters cleanly and produces combat.
  const solo = createBattle(0, 3, () => 0.37);
  assert.equal(standings(solo).length, 6);
  solo.phase = 'racing';
  for (let i = 0; i < 60 * 25; i++) tickBattle(solo, new Set(), 1 / 60);
  const soloKills = solo.kills + solo.bots.reduce((sum, b) => sum + b.kills, 0);
  assert.ok(soloKills >= 1, `expected active solo combat kills in Maze, got ${soloKills}`);
});
