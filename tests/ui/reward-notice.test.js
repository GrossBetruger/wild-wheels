import test from 'node:test';
import assert from 'node:assert/strict';
import {PermanentStatGains,RewardQueue} from '../../ui/reward-notice.js';
import {bicycleResults} from '../../ui/results.js';

test('a bicycle visibly upgrades intelligence from five to six, and two more reach eight',()=>{
  const gains=new PermanentStatGains();
  assert.equal(gains.observe('intelligence','match-1',0,5),null);
  const first=gains.observe('intelligence','match-1',1,6);assert.equal(first.from,5);assert.equal(first.to,6);
  const next=gains.observe('intelligence','match-1',3,8);assert.equal(next.from,6);assert.equal(next.to,8);
});
test('restoring existing upgrades and reconciling a predicted pickup do not replay its reward',()=>{
  const gains=new PermanentStatGains();
  assert.equal(gains.observe('intelligence','match-1',2,7),null);
  const pickup=gains.observe('intelligence','match-1',3,8);assert.equal(pickup.from,7);assert.equal(pickup.to,8);
  assert.equal(gains.observe('intelligence','match-1',2,7),null);
  assert.equal(gains.observe('intelligence','match-1',3,8),null);
  assert.equal(gains.observe('intelligence','match-2',0,5),null);
  assert.equal(gains.observe('intelligence','match-2',1,6).from,5);
});
test('reward animations queue other stats and non-stat events without replaying duplicate event IDs',()=>{
  const rewards=new RewardQueue();
  rewards.show({id:'fuel-1',title:'FUEL UP',from:2,to:3});rewards.show({id:'fuel-1',title:'FUEL UP',from:2,to:3});
  rewards.show({id:'shield-1',title:'SHIELD READY',detail:'Missiles only!'});
  assert.equal(rewards.sample(0).title,'FUEL UP');assert.equal(rewards.sample(2.9).to,3);
  assert.equal(rewards.sample(3).title,'SHIELD READY');assert.equal(rewards.sample(6),null);
});
test('the bicycle results section is absent when no bicycles were stolen',()=>{
  const world={mode:'combat',id:0,driver:0,bicyclesStolen:0,bots:[{id:1,driver:14,bicyclesStolen:0}]};
  assert.deepEqual(bicycleResults(world),[]);
});
test('bicycle results name only thieves and order them by bikes stolen',()=>{
  const world={mode:'combat',id:0,name:'Oren',driver:1,bicyclesStolen:2,bots:[{id:1,name:'Sarah',driver:2,bicyclesStolen:3},{id:2,name:'KnowItOwl',driver:14,bicyclesStolen:0}]};
  assert.deepEqual(bicycleResults(world),[{id:1,name:'Sarah',you:false,count:3},{id:0,name:'Oren',you:true,count:2}]);
});
