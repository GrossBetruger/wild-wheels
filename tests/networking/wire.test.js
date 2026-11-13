import {arenaFixture} from '../../scripts/helpers/arena-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, predictKartMovement } from '../../gameplay/combat.js';
import { Multiplayer } from '../../server/multiplayer.js';
import { encodeSnapshot, decodeSnapshot } from '../../networking/wire.js';
import { decodeBinarySnapshot } from '../../networking/binary-wire.js';

test('older compact snapshots still display their drift effects',()=>{
  const world=createBattle();world.skids=[[1,2,3,4,5]];world.driftParticles=[[1,2,.3,4,5,6,.1,.9,1,2]];
  const decoded=decodeSnapshot({wireVersion:1,world}).world;
  assert.deepEqual(decoded.skids,[{ax:1,az:2,bx:3,bz:4,time:5}]);
  assert.equal(decoded.driftParticles[0].kind,'spark');assert.equal(decoded.driftParticles[0].level,2);
});

test('compact updates preserve game outcomes and reconstruct the visible effects',()=>{
  const world=createBattle(3,1);Object.assign(world,{wx:12.3456789,health:4,kills:2,ammo:3});
  world.skids=[{ax:1.234,az:2.345,bx:3.456,bz:4.567,time:5.6789}];
  world.driftParticles=[{wx:1.234,wz:2.345,height:.456,vx:3.456,vz:4.567,vy:5.678,age:.1234,life:.8,kind:'spark',level:2}];
  world.projectiles=[{id:7,owner:1,kind:'missile',wx:4,wz:5,trail:[{wx:1.234,wz:2.345,height:.456}]}];
  const decoded=decodeSnapshot(JSON.parse(encodeSnapshot({type:'state',code:'07',world})));
  assert.equal(decoded.code,'07');assert.equal(decoded.world.driver,3);assert.equal(decoded.world.health,4);assert.equal(decoded.world.kills,2);assert.equal(decoded.world.ammo,3);
  assert.equal(decoded.world.wx,12.3456789);assert.equal(world.wx,12.3456789);
  assert.deepEqual(decoded.world.skids,[{ax:1.23,az:2.35,bx:3.46,bz:4.57,time:5.679}]);
  assert.deepEqual(decoded.world.driftParticles,[{wx:1.23,wz:2.35,height:.46,vx:3.46,vz:4.57,vy:5.68,age:.123,life:.8,kind:'spark',level:2}]);
  assert.deepEqual(decoded.world.projectiles[0].trail,[{wx:1.23,wz:2.35,height:.46}]);
});

test('a boost expiring on the next tick has the same speed on the server and guest',()=>{
  const world=createBattle();Object.assign(world,{phase:'racing',boost:1/60,speed:700,wx:0,wz:70,heading:0,motionHeading:0,cameraHeading:0});
  const decoded=decodeSnapshot(JSON.parse(encodeSnapshot({world}))).world;
  predictKartMovement(world,world,new Set(['arrowup']),1/60);
  predictKartMovement(decoded,decoded,new Set(['arrowup']),1/60);
  assert.equal(world.speed,520);assert.equal(decoded.speed,520);
  assert.equal(world.boost,0);assert.equal(decoded.boost,0);
});

test('a busy connection sends the latest position and retains intervening action sounds',t=>{
  const app=new Multiplayer({fixtureWorld:arenaFixture});t.after(()=>app.close());clearInterval(app.timer);
  const room={code:'07',arena:0,botCount:0,host:0,members:new Map()};app.makeWorld(room);
  const member=app.join(room,{name:'Host',driver:0}),sent=[];
  member.socket={readyState:1,send:(text,done)=>sent.push({state:decodeBinarySnapshot(text),done})};
  room.world.wx=1;app.send(member,app.snapshot(room,member));
  room.world.wx=2;room.events=[{id:'1:1',owner:0,type:'fire'}];app.send(member,app.snapshot(room,member));
  room.world.wx=3;room.world.health=2;room.events=[{id:'1:2',owner:0,type:'chaff'}];app.send(member,app.snapshot(room,member));
  assert.equal(sent.length,1);
  sent[0].done();
  assert.deepEqual(sent.map(packet=>packet.state.world.wx),[1,3]);
  assert.equal(sent[1].state.world.health,2);
  assert.deepEqual(sent[1].state.world.events.map(event=>event.type),['fire','chaff']);
  sent[1].done();assert.equal(sent.length,2);
});

test('a new match discards queued sounds from the previous match',t=>{
  const app=new Multiplayer({fixtureWorld:arenaFixture});t.after(()=>app.close());clearInterval(app.timer);
  const room={code:'07',arena:0,botCount:0,host:0,members:new Map()};app.makeWorld(room);
  const member=app.join(room,{name:'Host',driver:0}),sent=[];
  member.socket={readyState:1,send:(text,done)=>sent.push({state:decodeBinarySnapshot(text),done})};
  app.send(member,app.snapshot(room,member));
  room.events=[{id:'1:1',owner:0,type:'explosion'}];app.send(member,app.snapshot(room,member));
  app.makeWorld(room);app.send(member,app.snapshot(room,member));
  sent[0].done();
  assert.deepEqual(sent[1].state.world.events,[]);
  assert.equal(sent[1].state.world.phase,'ready');
  sent[1].done();
});
