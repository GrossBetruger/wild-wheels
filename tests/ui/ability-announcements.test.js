import test from 'node:test';
import assert from 'node:assert/strict';
import {AbilityUsage,abilityCards} from '../../ui/ability-announcements.js';
import {RewardQueue} from '../../ui/reward-notice.js';

test('having an ability does not announce it while idle, and an activation expires after 2.4 seconds',()=>{
  const tracker=new AbilityUsage(),queue=new RewardQueue(),world={mode:'combat',phase:'racing',soundEpoch:1,arena:0,elapsed:1,id:0,driver:5,specialCooldown:0,bots:[]};
  assert.deepEqual(tracker.sample(world),[]);assert.deepEqual(tracker.sample(world),[]);
  world.specialCooldown=20;const [event]=tracker.sample(world);assert.equal(event.title,'LOW-COST LOCUST');queue.show(event);
  assert.equal(queue.sample(0).theme,'locust');world.specialCooldown=19.9;assert.deepEqual(tracker.sample(world),[]);
  assert.equal(queue.sample(2.4),null);assert.deepEqual(tracker.sample(world),[]);
});
test('joining a match mid-ability does not replay an old announcement',()=>{
  const tracker=new AbilityUsage(),world={mode:'combat',phase:'racing',soundEpoch:1,arena:0,elapsed:10,id:0,driver:14,specialCooldown:17,specialActive:4,bots:[]};
  assert.deepEqual(tracker.sample(world),[]);world.specialActive=0;world.specialCooldown=13;assert.deepEqual(tracker.sample(world),[]);
});
test('Tax-Audit and Xylophone-Attack receive distinct designs and no disabled ability announces',()=>{
  const tracker=new AbilityUsage(),world={mode:'combat',phase:'racing',soundEpoch:1,arena:0,elapsed:1,id:0,driver:13,specialCooldown:0,specialActive:0,bots:[]};
  tracker.sample(world);world.specialCooldown=20;assert.equal(tracker.sample(world)[0].theme,'audit');
  world.specialCooldown=0;tracker.sample(world);world.specialCooldown=20;world.specialActive=5;assert.equal(tracker.sample(world)[0].theme,'xylophone');
  world.specialAbilities=false;world.specialCooldown=0;tracker.sample(world);world.specialCooldown=20;assert.deepEqual(tracker.sample(world),[]);
});
test('each character’s activated ability has its own visual theme',()=>{
  assert.equal(new Set(Object.values(abilityCards).map(card=>card.theme)).size,9);
});
