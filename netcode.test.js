import test from 'node:test';
import assert from 'node:assert/strict';
import { simulate, compare, profiles, scenarios } from './scripts/check-netcode.mjs';

for(const scenario of scenarios)for(const profile of profiles.slice(1)){
  test(`${scenario.name} feels like local driving at ${profile.name}`,()=>{
    const reference=simulate({rtt:0,jitter:0},scenario);
    const remote=simulate(profile,scenario);
    const result=compare(reference,remote);
    assert.ok(result.positionP95<=.15,`Position error ${result.positionP95} exceeds 0.15 units`);
    assert.ok(result.positionMax<=.5,`Position spike ${result.positionMax} exceeds 0.5 units`);
    assert.ok(result.cameraP95Degrees<=1,`Camera error ${result.cameraP95Degrees} exceeds 1 degree`);
    assert.ok(result.cameraMaxDegrees<=3,`Camera spike ${result.cameraMaxDegrees} exceeds 3 degrees`);
    assert.equal(result.freezeFrames,0);assert.equal(result.backwardFrames,0);
  });
}

test('a guest keeps the same path with uneven rendering and a slower 30 FPS display',()=>{
  const scenario={name:'uneven rendering',seconds:8,guest:true,renderTimes:[.0166,.0167,.0167,.0333],keys:t=>t<.5?[]:t<2?['arrowup']:t<4?['arrowup','arrowright']:t<5?['arrowup','arrowright','shift']:['arrowup','arrowleft']};
  const reference=simulate({rtt:0,jitter:0},scenario);
  const remote=simulate({rtt:.16,jitter:.03},scenario);
  const result=compare(reference,remote);
  assert.ok(result.pass,JSON.stringify(result));
});
