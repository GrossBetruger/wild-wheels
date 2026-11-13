import test from 'node:test';
import assert from 'node:assert/strict';
import { darkBombLights, bombIllumination } from './dark-bomb-light.js';

test('A-bombs illuminate Dark Humor for one second, without regular explosions or radiation relighting it', () => {
  const world = { effects: [{ type: 'abomb', wx: 10, wz: 20, age: 0 }, { type: 'abomb', wx: 0, wz: 0, age: 1 }, { type: 'explosion', wx: 0, wz: 0, age: 0 }, { type: 'radiation', wx: 0, wz: 0, age: 0 }] };
  assert.deepEqual(darkBombLights(world, 1), [[10, 4, 20, 16]]); assert.deepEqual(darkBombLights(world, 0), []);
  world.effects[0].age = .5; assert.deepEqual(darkBombLights(world, 1), [[10, 4, 20, 4]]); world.effects[0].age = 1; assert.deepEqual(darkBombLights(world, 1), []);
});

test('blast light reaches the whole scene with inverse square-root distance falloff', () => {
  const lights = [[0, 4, 0, 4]];
  assert.equal(bombIllumination(lights, [1, 4, 0]), 4); assert.equal(bombIllumination(lights, [4, 4, 0]), 2); assert.equal(bombIllumination(lights, [16, 4, 0]), 1); assert.equal(bombIllumination(lights, [100, 4, 0]), .4);
});
