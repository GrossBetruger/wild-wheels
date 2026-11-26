import test from 'node:test';
import assert from 'node:assert/strict';
import { ArenaClient, ArenaCore, wormholeSample } from '../../gameplay/arena-core.js';
import { createBattle, useBattleTurbo, tickBattle } from '../../gameplay/combat.js';

test('the offline capture stretches and thins the racer, then swallows both ends', () => {
  const world = Object.assign(createBattle(8), {phase:'racing', human:true, wx:65, wz:40, heading:0});
  for (const bot of world.bots) bot.inactive = true;
  Object.assign(world.bots[0], {inactive:false, human:true, wx:65, wz:54, health:3});
  useBattleTurbo(world);
  useBattleTurbo(world);
  tickBattle(world, new Set(), 0);
  assert.ok(world.effects.some(fx => fx.type === 'wormholeCapture' && fx.owner === world.bots[0].id));
  assert.equal(world.effects.some(fx => fx.type === 'explosion'), false);
  assert.equal(world.events.filter(cue => cue === 'wormholeShrink').length, 1);
  const pose = age => [0,1,2].map(component => wormholeSample(age,component));
  assert.deepEqual(pose(0), [1,1,1]);
  const [distance, length, width] = pose(1.05);
  assert.ok(distance < .35 && length > 2.8 && width < .25);
  for (let frame = 1; frame <= 160; frame++) {
    assert.ok(wormholeSample(frame/120, 2) <= wormholeSample((frame-1)/120, 2));
  }
  assert.deepEqual(pose(1.32), [0,0,0]);
});

test('Avita double-taps turbo and the server credits a Wormhole knockout through shields', () => {
  const world = Object.assign(createBattle(8), {
    phase: 'racing', multiplayer: true, human: true, wx: 65, wz: 40, heading: 0, supplies: []
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
  for (const viewer of [0,1]) {
    const cues = server.packetRecord(viewer).events;
    assert.equal(cues.filter(cue => cue.type === 'wormholeShrink').length, 1);
  }
  const peer = new ArenaClient();
  peer.accept(server.packet(1), 0);
  const effects = peer.present().effects;
  assert.ok(effects.some(fx => fx.type === 'wormholeCapture' && fx.owner === 1));
  assert.equal(effects.some(fx => fx.type === 'explosion'), false);
});

for (const mode of ['solo', 'multiplayer']) {
  test(`${mode}: Avita spends a turbo only on the third X after opening a Wormhole`, () => {
    const world = Object.assign(createBattle(8), {phase:'racing', turbos:1, human:true});
    const server = new ArenaCore(world);
    const client = new ArenaClient();
    client.accept(server.packet(0), 0);
    const press = at => {
      world.elapsed = at;
      return mode === 'solo' ? useBattleTurbo(world) : client.action('turbo', null, at);
    };
    const read = () => mode === 'solo' ? world : client.snapshot();
    press(.05);
    assert.equal(read().boost, 0);
    press(.2);
    assert.equal(read().nightmareActive, 8);
    assert.equal(read().turbos, 1);
    assert.equal(read().boost, 0);
    press(.25);
    assert.equal(read().turbos, 0);
    assert.equal(read().boost, 3.6);
    if (mode === 'multiplayer') {
      const input = client.outbound([]);
      assert.deepEqual(input.actions.map(action => action.type), ['nightmare','turbo']);
      server.step(0,[{...input,actor:0}]);
      assert.equal(server.snapshot().boost, 3.6);
    }
  });
}

test('a single multiplayer X becomes one turbo once the double-tap window expires', () => {
  const world = Object.assign(createBattle(8), {phase:'racing', turbos:1, human:true});
  const server = new ArenaCore(world), client = new ArenaClient();
  client.accept(server.packet(0),0);
  client.action('turbo',null,.02);
  client.frame(0,[],.35);
  assert.equal(client.snapshot().turbos,1);
  client.frame(0,[],.38);
  assert.equal(client.snapshot().turbos,0);
  assert.deepEqual(client.outbound([]).actions.map(action=>action.type),['turbo']);
});
