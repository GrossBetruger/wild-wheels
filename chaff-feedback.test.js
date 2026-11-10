import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, releaseChaff, tickBattle } from './combat.js';
import { encodeSnapshot, decodeSnapshot } from './wire.js';
import { ActionAudio } from './action-audio.js';
import { ChaffNotice } from './combat-notices.js';

test('the green notice confirms only this player’s successful chaff diversion and expires once',()=>{
  const world=createBattle();Object.assign(world,{id:1,phase:'racing',soundEpoch:1,elapsed:2,chaffClouds:[]});
  const notice=new ChaffNotice();assert.equal(notice.sample(world,0),null);
  world.chaffClouds=[{id:0,owner:1,diversions:0}];assert.equal(notice.sample(world,.1),null);
  world.chaffClouds.push({id:1,owner:0,diversions:1,divertedAt:2});assert.equal(notice.sample(world,.2),null);
  world.chaffClouds[0]={id:0,owner:1,diversions:1,divertedAt:2};assert.ok(notice.sample(world,.3));
  assert.ok(notice.sample(world,1));assert.equal(notice.sample(world,2.31),null);assert.equal(notice.sample(world,3),null);
  world.chaffClouds[0].diversions=2;assert.ok(notice.sample(world,3.1));
  assert.equal(notice.sample({...world,phase:'finished'},3.2),null);
});

test('guest chaff keeps its kart color and emits one success cue when it diverts a missile',()=>{
  const world=createBattle();Object.assign(world,{phase:'racing',multiplayer:true,soundEpoch:1,destroyed:999,supplies:[]});
  const guest=world.bots[0];Object.assign(guest,{human:true,wx:-65,wz:0,heading:0,speed:0,color:'#df7053',chaff:2,chaffCooldown:0});world.bots=[guest];
  world.projectiles=[{kind:'missile',owner:0,target:1,wx:-65,wz:-30,heading:0,speed:70,height:1.3,life:2,trail:[]}];
  releaseChaff(world,guest);
  assert.equal(world.chaffClouds[0].color,'#df7053');assert.equal(world.chaffClouds[0].owner,1);
  const cue=world.events.filter(event=>event.type==='chaffDivert');assert.equal(cue.length,1);assert.equal(cue[0].owner,1);
  const decoded=decodeSnapshot(JSON.parse(encodeSnapshot({world}))).world;
  assert.equal(decoded.chaffClouds[0].color,'#df7053');
  const audio=new ActionAudio(()=>{});audio.accept({...decoded,id:1},0);
  assert.deepEqual(audio.confirmations(cue,0),['chaffDivert']);assert.deepEqual(audio.confirmations(cue,.1),[]);
  for(let i=0;i<10;i++)tickBattle(world,new Set(),1/60,new Map([[1,new Set()]]));
  assert.equal(world.events.filter(event=>event.type==='chaffDivert').length,1);
});

test('an existing cloud sounds when a later missile locks on but not on every subsequent tick',()=>{
  const world=createBattle();Object.assign(world,{phase:'racing',wx:-65,wz:0,heading:0,speed:0,color:'#8456cf',bots:[],supplies:[]});
  releaseChaff(world);
  assert.deepEqual(world.events,['chaff']);assert.equal(world.chaffClouds[0].color,'#8456cf');
  world.projectiles=[{kind:'missile',owner:1,target:0,wx:-65,wz:-30,heading:0,speed:70,height:1.3,life:2,trail:[]}];
  for(let i=0;i<10;i++)tickBattle(world,new Set(),1/60);
  assert.equal(world.projectiles[0].target,null);assert.equal(world.events.filter(event=>event==='chaffDivert').length,1);
});

test('chaff does not play a success cue for missiles targeting another player',()=>{
  const world=createBattle();Object.assign(world,{phase:'racing',wx:-65,wz:0,heading:0,bots:[],projectiles:[{kind:'missile',owner:1,target:2,wx:-65,wz:-30,life:2}]});
  releaseChaff(world);
  assert.deepEqual(world.events,['chaff']);assert.equal(world.projectiles[0].target,2);
});
