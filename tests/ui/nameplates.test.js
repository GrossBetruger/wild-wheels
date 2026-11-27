import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattle } from '../../gameplay/combat.js';
import { kartNameplates } from '../../ui/nameplates.js';

test('far visible karts have projected nameplates with their names and colors',()=>{
  const world=createBattle();Object.assign(world,{phase:'racing',wx:-65,wz:0,bots:[{id:1,driver:1,name:'Sam',color:'#df7053',wx:-65,wz:50}]});
  const projection=[.01,0,0,0,0,1,0,0,0,0,1,1,0,0,-1,0];
  assert.deepEqual(kartNameplates(world,projection,[-65,10,-17]),[{id:1,name:'Sam',color:'#df7053',x:49.35,y:42.8}]);
  world.bots[0].somersault=.275;assert.equal(kartNameplates(world,projection,[-65,10,-17])[0].y,37.8);
});
test('nearby, destroyed, behind-camera and covered karts have no nameplate',()=>{
  const world=createBattle();Object.assign(world,{phase:'racing',wx:-65,wz:0,bots:[{id:1,driver:1,wx:-65,wz:10}]});
  const projection=[.01,0,0,0,0,1,0,0,0,0,1,1,0,0,-1,0];
  assert.deepEqual(kartNameplates(world,projection,[-65,10,-17]),[]);
  Object.assign(world.bots[0],{wz:50,destroyed:1});assert.deepEqual(kartNameplates(world,projection,[-65,10,-17]),[]);
  Object.assign(world.bots[0],{wz:-50,destroyed:0});assert.deepEqual(kartNameplates(world,projection,[-65,10,-17]),[]);
  Object.assign(world,{arena:1,wx:0,wz:-30});Object.assign(world.bots[0],{wx:0,wz:40});assert.deepEqual(kartNameplates(world,projection,[0,10,-47]),[]);
});
test('nameplates disappear during Dark Humor for both victims and the caster',()=>{
  const world=createBattle();Object.assign(world,{phase:'racing',wx:-65,wz:0,bots:[{id:1,driver:14,name:'KnowItOwl',color:'#5b6088',wx:-65,wz:50,specialActive:5}]});
  const projection=[.01,0,0,0,0,1,0,0,0,0,1,1,0,0,-1,0];
  assert.deepEqual(kartNameplates(world,projection,[-65,10,-17]),[]);
  // Also hidden when the local player is the KnowItOwl casting Dark Humor.
  Object.assign(world,{driver:14,specialActive:5});world.bots[0].specialActive=0;
  assert.deepEqual(kartNameplates(world,projection,[-65,10,-17]),[]);
  // Reappear once Dark Humor ends or when special abilities are disabled.
  world.specialAbilities=false;
  assert.equal(kartNameplates(world,projection,[-65,10,-17]).length,1);
  world.specialAbilities=true;world.specialActive=0;
  assert.equal(kartNameplates(world,projection,[-65,10,-17]).length,1);
});
