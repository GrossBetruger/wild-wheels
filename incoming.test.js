import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, incomingMissiles, releaseChaff, tickBattle } from './combat.js';

test('the incoming warning counts only live enemy missiles locked onto this guest',()=>{
  const world=createBattle();Object.assign(world,{id:2,phase:'racing',destroyed:0,projectiles:[
    {kind:'missile',target:2,owner:0,life:1},
    {kind:'missile',target:2,owner:1,life:2},
    {kind:'missile',target:0,owner:1,life:2},
    {kind:'missile',target:null,owner:0,life:2},
    {kind:'missile',target:2,owner:2,life:1},
    {kind:'hedgehog',target:2,owner:0,life:1},
    {kind:'missile',target:2,owner:0,life:0},
    {kind:'missile',target:2,owner:0,life:1,decoy:0}
  ]});
  assert.equal(incomingMissiles(world),2);
});

test('chaff immediately clears the warning when it diverts the locked missile',()=>{
  const world=createBattle();Object.assign(world,{phase:'racing',wx:-65,wz:0,heading:0,chaff:2,chaffCooldown:0,projectiles:[{kind:'missile',owner:1,target:0,wx:-65,wz:-20,life:2}]});
  assert.equal(incomingMissiles(world),1);
  assert.equal(releaseChaff(world),true);
  assert.equal(incomingMissiles(world),0);
});

test('missile expiry clears the warning without an impact',()=>{
  const world=createBattle();Object.assign(world,{phase:'racing',wx:-65,wz:0,bots:[],supplies:[],projectiles:[{kind:'missile',owner:1,target:0,wx:-65,wz:-50,heading:0,speed:70,life:.001,age:0,height:1.3,trail:[]}]});
  assert.equal(incomingMissiles(world),1);
  tickBattle(world,new Set(),1/60);
  assert.equal(incomingMissiles(world),0);
});

test('the warning is hidden outside live combat and while the player is destroyed',()=>{
  const world=createBattle();Object.assign(world,{phase:'racing',projectiles:[{kind:'missile',target:0,owner:1,life:1}]});
  assert.equal(incomingMissiles(world),1);
  assert.equal(incomingMissiles({...world,destroyed:1}),0);
  for(const phase of ['ready','countdown','paused','finished'])assert.equal(incomingMissiles({...world,phase}),0);
  assert.equal(incomingMissiles({...world,finishCountdown:2}),1);
  assert.equal(incomingMissiles({...world,mode:'race'}),0);
});
