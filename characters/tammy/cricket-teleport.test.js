import { arrivalScale, departurePose } from './cricket-teleport.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, tickBattle, somersaultBattle } from '../../gameplay/combat.js';
import { ArenaCore, ArenaClient } from '../../gameplay/arena-core.js';

test('observers see Tammy jump and vanish before she emerges at the landing point', () => {
  assert.ok(departurePose(.1).height > 0); assert.ok(departurePose(.1).scale > 0); assert.equal(arrivalScale(.1), 0);
  assert.equal(departurePose(.35).scale, 0); assert.equal(arrivalScale(.35), 0);
  assert.equal(departurePose(.45).scale, 0); assert.ok(arrivalScale(.45) > 0); assert.equal(arrivalScale(.55), 1);
});

for (const engine of ['JavaScript', 'Rust']) for (const enabled of [true, false]) test(`${engine}: Tammy shares a departure and landing haze only when teleport is enabled: ${enabled}`, () => {
  const w = createBattle(5); Object.assign(w, { phase: 'racing', human: true, wx: 65, wz: 70, heading: .4, color: '#559955', specialAbilities: enabled, supplies: [] }); for (const a of w.bots) Object.assign(a, { inactive: true, destroyed: 999 });
  const core = engine === 'Rust' ? new ArenaCore(w) : null, read = () => core ? core.snapshot() : w;
  if (core) core.step(0, [{ actor: 0, actions: [{ type: 'somersault' }] }]); if (!core) somersaultBattle(w);
  const after = read(), effects = after.effects.filter(e => e.type === 'teleportOut' || e.type === 'teleportIn'); assert.equal(effects.length, enabled ? 2 : 0); assert.equal(after.somersault, .55);
  if (!enabled) { assert.equal(after.wx, 65); assert.equal(after.wz, 70); return; }
  const [out, arrival] = effects; assert.equal(out.type, 'teleportOut'); assert.equal(out.wx, 65); assert.equal(out.wz, 70); assert.equal(out.heading, .4); assert.equal(out.owner, 0); assert.equal(out.color, '#559955');
  assert.equal(arrival.type, 'teleportIn'); assert.equal(arrival.wx, after.wx); assert.equal(arrival.wz, after.wz); assert.equal(arrival.heading, .4 + Math.PI); assert.equal(arrival.owner, 0); assert.equal(arrival.color, '#559955'); assert.equal(arrival.life, 1.35);
  if (core) core.step(0, [{ actor: 0, actions: [{ type: 'somersault' }] }]); if (!core) somersaultBattle(w); assert.equal(read().effects.filter(e => e.type.startsWith('teleport')).length, 2);
  for (let i = 0; i < 28; i++) { if (core) core.step(.05); if (!core) tickBattle(w, new Set(), .05); } assert.equal(read().effects.filter(e => e.type.startsWith('teleport')).length, 0);
});

test('other racers receive both teleport locations, heading and car color; prediction creates no duplicate haze', () => {
  const w = createBattle(5); Object.assign(w, { phase: 'racing', human: true, multiplayer: true, wx: 65, wz: 70, heading: .4, color: '#559955', supplies: [] }); for (const a of w.bots) Object.assign(a, { inactive: true, destroyed: 999 });
  const server = new ArenaCore(w), local = new ArenaClient(), observer = new ArenaClient(); local.accept(server.packet(), 0); local.frame(1 / 60, [], 1 / 60);
  assert.equal(local.action('somersault', undefined, 1 / 60), true); assert.equal(local.present().effects.filter(e => e.type.startsWith('teleport')).length, 0);
  server.step(1 / 60, [{ actor: 0, ...local.outbound([]) }]); local.accept(server.packet(), .03); local.frame(0, [], .03); observer.accept(server.packet(1), .03); observer.frame(0, [], .03);
  for (const view of [local.present(), observer.present()]) {
    const effects = view.effects.filter(e => e.type.startsWith('teleport')); assert.equal(effects.length, 2); assert.equal(effects[0].wx, 65); assert.equal(effects[0].wz, 70); assert.equal(effects[0].heading, .4); assert.equal(effects[0].owner, 0); assert.equal(effects[0].color, '#559955');
    assert.equal(effects[1].wx, server.snapshot().wx); assert.equal(effects[1].wz, server.snapshot().wz); assert.equal(effects[1].heading, .4 + Math.PI);
  }
});
