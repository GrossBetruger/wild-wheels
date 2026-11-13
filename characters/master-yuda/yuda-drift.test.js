import test from 'node:test';
import assert from 'node:assert/strict';
import { YudaDrift } from './yuda-drift.js';

test('Master-Yuda leans near the floor in either direction and stands up smoothly after releasing drift', () => {
  for (const heading of [-.5, .5]) {
    const world = { id: 0, driver: 10, phase: 'racing', wx: 0, wz: 0, heading, motionHeading: 0, wasDrifting: true, bots: [] }, drift = new YudaDrift(); drift.update(world, 0);
    drift.update(world, 1 / 60); assert.ok(Math.abs(drift.roll(0)) > .2 && Math.abs(drift.roll(0)) < .4);
    for (let frame = 2; frame <= 30; frame++)drift.update(world, frame / 60);
    assert.ok(Math.abs(drift.roll(0)) > 1.1); assert.equal(Math.sign(drift.roll(0)), -Math.sign(heading));
    world.wasDrifting = false; drift.update(world, 31 / 60); assert.ok(Math.abs(drift.roll(0)) > .8);
    for (let frame = 32; frame <= 60; frame++)drift.update(world, frame / 60);
    assert.ok(Math.abs(drift.roll(0)) < .01);
  }
});
test('scraping sparks cover the traveled path, persist after release, and fade without waiting for a snapshot', () => {
  const world = { id: 0, driver: 10, phase: 'racing', wx: 0, wz: 0, heading: 0, motionHeading: 0, wasDrifting: true, bots: [] }, drift = new YudaDrift(); drift.update(world, 0); drift.update(world, 1 / 60);
  world.wz = 3; drift.update(world, 2 / 60);
  const fresh = drift.sparks.filter(s => s.age === 0); assert.ok(fresh.length >= 42);
  const positions = [...new Set(fresh.map(s => s.z))].sort((a, b) => a - b);
  assert.ok(positions[0] < -1.2); assert.ok(positions.at(-1) > 1.3);
  for (let i = 1; i < positions.length; i++)assert.ok(positions[i] - positions[i - 1] <= .45);
  const count = drift.sparks.length; world.wasDrifting = false; drift.update(world, .1);
  assert.equal(drift.sparks.length, count); assert.ok(drift.sparks.every(s => s.age > 0 && s.y >= .06));
  drift.update(world, 1.1); assert.equal(drift.sparks.length, 0);
});
test('remote Master-Yuda gets his own lean and sparks, while other drivers stay unchanged', () => {
  const world = { id: 0, driver: 0, phase: 'racing', wx: 0, wz: 0, heading: 0, motionHeading: 0, wasDrifting: true, bots: [{ id: 1, driver: 10, wx: 20, wz: 20, heading: .5, motionHeading: 0, wasDrifting: true }] }, drift = new YudaDrift(); drift.update(world, 0); drift.update(world, 1 / 60);
  assert.equal(drift.roll(0), 0); assert.ok(drift.roll(1) < -.2); assert.equal(drift.sparks.length, 6); assert.ok(drift.sparks.every(s => s.owner === 1));
  world.bots[0].somersault = .55; drift.update(world, 2 / 60); assert.equal(drift.roll(1), 0); assert.equal(drift.sparks.length, 6);
});
test('repeat frames, teleports, death and new matches never create a connecting spray across the arena', () => {
  const world = { id: 0, driver: 10, phase: 'racing', wx: 0, wz: 0, heading: 0, motionHeading: 0, wasDrifting: true, bots: [] }, drift = new YudaDrift(); drift.update(world, 0); drift.update(world, 1 / 60);
  drift.update(world, 1 / 60); assert.equal(drift.sparks.length, 6);
  world.wx = 80; drift.update(world, 2 / 60); assert.equal(drift.sparks.length, 6); assert.equal(drift.roll(0) > 0, true);
  world.destroyed = 1; drift.update(world, 3 / 60); assert.equal(drift.roll(0), 0); assert.equal(drift.sparks.length, 6);
  world.soundEpoch = 2; drift.update(world, 4 / 60); assert.equal(drift.sparks.length, 0);
});
