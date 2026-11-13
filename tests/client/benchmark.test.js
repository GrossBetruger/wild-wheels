import test from 'node:test';
import assert from 'node:assert/strict';
import { projectileMotion } from '../../scripts/scenarios/check-feedback-scenario.mjs';

test('a 90-unit-per-second projectile remains smooth when rendered frames exceed the gameplay dt cap',()=>{
  const trace=[
    {time:0,dt:.05,shots:[{kind:'hedgehog',wx:0}]},
    {time:.075,dt:.05,shots:[{kind:'hedgehog',wx:6.75}]},
    {time:.15,dt:.05,shots:[{kind:'hedgehog',wx:13.5}]}
  ];
  assert.deepEqual(projectileMotion(trace),{projectileBackwardFrames:0,projectileStepErrorP95:0});
});

test('the projectile benchmark still rejects a backward jump on a slow display',()=>{
  const trace=[{time:0,dt:.05,shots:[{kind:'hedgehog',wx:0}]},{time:.075,dt:.05,shots:[{kind:'hedgehog',wx:-1}]}];
  assert.deepEqual(projectileMotion(trace),{projectileBackwardFrames:1,projectileStepErrorP95:7.75});
});
