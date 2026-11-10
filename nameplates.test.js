import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattle } from './combat.js';
import { kartNameplates } from './nameplates.js';

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
