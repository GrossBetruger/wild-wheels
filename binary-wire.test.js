import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, predictKartMovement } from './combat.js';
import { Multiplayer } from './multiplayer.js';
import { createBinaryEncoder, decodeBinarySnapshot } from './binary-wire.js';
import { encodeSnapshot, decodeSnapshot } from './wire.js';

test('binary snapshots preserve fractional scores, precise movement, Unicode names and cosmetic ownership',()=>{
  const world=createBattle();Object.assign(world,{name:'Fox 🦊 שלום',kills:2.5,wx:12.3456789,boost:1/60,health:4});
  world.skids=[{ax:-1.235,az:2.345,bx:3.456,bz:-4.567,time:5.6789,owner:2}];
  world.driftParticles=[{wx:1.234,wz:2.345,height:.456,vx:-3.456,vz:4.567,vy:5.678,age:.1234,life:.8,kind:'spark',level:2,owner:1}];
  world.projectiles=[{id:7,owner:1,kind:'missile',wx:4.123456789,wz:5,trail:[{wx:-1.235,wz:2.345,height:.456}]}];
  const state={type:'state',code:'07',world},encode=createBinaryEncoder(),decoded=decodeBinarySnapshot(encode(state));
  assert.equal(decoded.world.name,'Fox 🦊 שלום');assert.equal(decoded.world.kills,2.5);assert.equal(decoded.world.wx,12.3456789);assert.equal(decoded.world.boost,1/60);
  assert.deepEqual(decoded.world.skids,[{ax:-1.24,az:2.35,bx:3.46,bz:-4.57,time:5.679,owner:2}]);
  assert.equal(decoded.world.projectiles[0].wx,4.123456789);
  const legacy=decodeSnapshot(JSON.parse(encodeSnapshot(state)));
  assert.deepEqual({...decoded,wireVersion:2},legacy);
});

test('binary movement preserves a boost expiring on the next server tick',()=>{
  const world=createBattle();Object.assign(world,{phase:'racing',boost:1/60,speed:700,wx:0,wz:70,heading:0,motionHeading:0,cameraHeading:0});
  const decoded=decodeBinarySnapshot(createBinaryEncoder()({type:'state',world})).world;
  predictKartMovement(world,world,new Set(['arrowup']),1/60);predictKartMovement(decoded,decoded,new Set(['arrowup']),1/60);
  assert.equal(decoded.speed,520);assert.equal(decoded.boost,0);assert.equal(decoded.wx,world.wx);assert.equal(decoded.wz,world.wz);
});

test('queued binary snapshots keep their original state and merge sounds into the latest update',t=>{
  const app=new Multiplayer();t.after(()=>app.close());clearInterval(app.timer);
  const room={code:'07',arena:0,botCount:0,host:0,members:new Map()};app.makeWorld(room);
  const member=app.join(room,{name:'Host',driver:0}),sent=[];
  member.socket={readyState:1,send:(bytes,done)=>sent.push({bytes,done})};
  room.world.wx=1;app.send(member,app.snapshot(room,member));
  room.world.wx=2;room.events=[{id:'1:1',owner:0,type:'fire'}];app.send(member,app.snapshot(room,member));
  room.world.wx=3;room.world.health=2;room.events=[{id:'1:2',owner:0,type:'chaff'}];app.send(member,app.snapshot(room,member));
  assert.equal(decodeBinarySnapshot(sent[0].bytes).world.wx,1);
  sent[0].done();assert.equal(sent.length,2);
  const latest=decodeBinarySnapshot(sent[1].bytes).world;
  assert.equal(latest.wx,3);assert.equal(latest.health,2);assert.deepEqual(latest.events.map(e=>e.type),['fire','chaff']);
  app.makeWorld(room);app.send(member,app.snapshot(room,member));sent[1].done();
  assert.deepEqual(decodeBinarySnapshot(sent[2].bytes).world.events,[]);assert.equal(decodeBinarySnapshot(sent[2].bytes).world.phase,'ready');
});

test('binary updates reject truncation, extra bytes, wrong versions and excessive effect counts',()=>{
  const state={type:'state',world:createBattle()},packet=createBinaryEncoder()(state);
  assert.throws(()=>decodeBinarySnapshot(packet.subarray(0,15)),RangeError);
  assert.throws(()=>decodeBinarySnapshot(packet.subarray(0,packet.length-1)),RangeError);
  assert.throws(()=>decodeBinarySnapshot(new Uint8Array(packet.length+1)),RangeError);
  const wrongVersion=packet.slice();new DataView(wrongVersion.buffer).setUint32(0,0,true);assert.throws(()=>decodeBinarySnapshot(wrongVersion),RangeError);
  const oversized=packet.slice();new DataView(oversized.buffer).setUint32(8,0xffffffff,true);assert.throws(()=>decodeBinarySnapshot(oversized),RangeError);
  const world=createBattle();world.skids=Array.from({length:513},()=>({ax:0,az:0,bx:0,bz:0,time:0}));
  assert.throws(()=>createBinaryEncoder()({type:'state',world}),RangeError);
});

test('binary packets remain decodable when received in an unaligned buffer view',()=>{
  const world=createBattle();world.skids=[{ax:1,az:2,bx:3,bz:4,time:5}];
  const packet=createBinaryEncoder()({type:'state',world}),storage=new Uint8Array(packet.length+1);storage.set(packet,1);
  assert.deepEqual(decodeBinarySnapshot(storage.subarray(1)).world.skids,[{ax:1,az:2,bx:3,bz:4,time:5}]);
});
