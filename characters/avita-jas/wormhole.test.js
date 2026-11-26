import test from 'node:test';
import assert from 'node:assert/strict';
import { ArenaClient, ArenaCore } from '../../gameplay/arena-core.js';
import { createBattle } from '../../gameplay/combat.js';

test('Avita double-taps turbo and the server credits a Wormhole knockout through shields', () => {
  const world = Object.assign(createBattle(8), {
    phase: 'racing', human: true, wx: 65, wz: 40, heading: 0, supplies: []
  });
  for (const bot of world.bots) bot.inactive = true;
  Object.assign(world.bots[0], { inactive: false, human: true, wx: 65, wz: 54, health: 6, shield: 10 });
  const server = new ArenaCore(world);
  const client = new ArenaClient();
  client.accept(server.packet(0), 0);
  client.frame(1 / 60, [], 0.02);

  client.action('turbo', null, 0.05);
  client.action('turbo', null, 0.2);
  assert.equal(client.snapshot().nightmareActive, 8);
  server.step(0, [{ ...client.outbound([]), actor: 0 }]);
  const result = server.snapshot();
  assert.equal(result.nightmareCooldown, 24);
  server.step(1 / 60);
  const after = server.snapshot();
  assert.equal(after.kills, 1);
  assert.equal(after.bots[0].health, 0);
  assert.equal(after.killFeed[0].kind, 'wormhole');
});
