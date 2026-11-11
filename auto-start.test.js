import test from 'node:test';
import assert from 'node:assert/strict';
import { Multiplayer } from './multiplayer.js';

test('a guest request starts the normal match countdown once, at three seconds',t=>{
  let now=0;const app=new Multiplayer({startNow:()=>now});clearInterval(app.timer);t.after(()=>app.close());
  const room={code:'07',arena:0,botCount:0,host:0,members:new Map()};app.makeWorld(room);app.rooms.set('07',room);
  const host=app.join(room,{name:'Host',driver:0}),guest=app.join(room,{name:'Guest',driver:1});
  app.setReady(guest,true);assert.equal(app.snapshot(room,host).startRequest.remainingMs,3000);
  now=2999;app.step(1/60);assert.equal(room.world.phase,'ready');
  now=3000;app.step(1/60);assert.equal(room.world.phase,'countdown');assert.equal(guest.wantsToPlay,false);assert.equal(app.snapshot(room,host).startRequest,null);
  const epoch=room.world.soundEpoch;now=10000;app.step(1/60);assert.equal(room.world.soundEpoch,epoch);
});
test('host refusal cancels auto-start, informs the guest, and permits a fresh request',t=>{
  let now=0;const app=new Multiplayer({startNow:()=>now});clearInterval(app.timer);t.after(()=>app.close());
  const room={code:'07',arena:0,botCount:0,host:0,members:new Map()};app.makeWorld(room);app.rooms.set('07',room);
  const host=app.join(room,{name:'Host',driver:0}),guest=app.join(room,{name:'Guest',driver:1});
  app.setReady(guest,true);const requestId=app.snapshot(room,host).startRequest.id;
  now=2900;app.refusePlayRequest(host,requestId);now=8000;app.step(1/60);
  assert.equal(room.world.phase,'ready');assert.equal(guest.wantsToPlay,false);assert.equal(app.snapshot(room,guest).players.find(player=>player.id===guest.id).playRequestRefused,true);
  app.setReady(guest,true);assert.equal(guest.playRequestRefused,false);assert.equal(app.snapshot(room,guest).startRequest.remainingMs,3000);
  now=10999;app.step(1/60);assert.equal(room.world.phase,'ready');now=11000;app.step(1/60);assert.equal(room.world.phase,'countdown');
});
test('duplicate requests and additional ready guests do not postpone the first deadline',t=>{
  let now=0;const app=new Multiplayer({startNow:()=>now});clearInterval(app.timer);t.after(()=>app.close());
  const room={code:'07',arena:0,botCount:0,host:0,members:new Map()};app.makeWorld(room);app.rooms.set('07',room);
  app.join(room,{name:'Host',driver:0});const first=app.join(room,{name:'First',driver:1}),second=app.join(room,{name:'Second',driver:2});
  app.setReady(first,true);now=2000;app.setReady(first,true);app.setReady(second,true);
  assert.equal(app.snapshot(room,second).startRequest.remainingMs,1000);now=3000;app.step(1/60);assert.equal(room.world.phase,'countdown');
});
test('withdrawing or leaving cancels auto-start when no requesting guests remain',t=>{
  let now=0;const app=new Multiplayer({startNow:()=>now});clearInterval(app.timer);t.after(()=>app.close());
  const room={code:'07',arena:0,botCount:0,host:0,members:new Map()};app.makeWorld(room);app.rooms.set('07',room);
  const host=app.join(room,{name:'Host',driver:0}),guest=app.join(room,{name:'Guest',driver:1});
  app.setReady(guest,true);app.setReady(guest,false);now=3000;app.step(1/60);assert.equal(room.world.phase,'ready');
  app.setReady(guest,true);app.remove(guest);now=6000;app.step(1/60);assert.equal(room.world.phase,'ready');assert.equal(app.snapshot(room,host).startRequest,null);
});
test('a replacement host gets a fresh three-second window to refuse an outstanding request',t=>{
  let now=0;const app=new Multiplayer({startNow:()=>now});clearInterval(app.timer);t.after(()=>app.close());
  const room={code:'07',arena:0,botCount:0,host:0,members:new Map()};app.makeWorld(room);app.rooms.set('07',room);
  const host=app.join(room,{name:'Host',driver:0}),successor=app.join(room,{name:'Next host',driver:1}),guest=app.join(room,{name:'Guest',driver:2});
  app.setReady(guest,true);now=2000;app.remove(host);
  assert.equal(room.host,successor.id);assert.equal(app.snapshot(room,successor).startRequest.remainingMs,3000);
  now=3000;app.step(1/60);assert.equal(room.world.phase,'ready');now=5000;app.step(1/60);assert.equal(room.world.phase,'countdown');
});
test('only the current host can refuse, and an old refusal cannot cancel a newer request',t=>{
  let now=0;const app=new Multiplayer({startNow:()=>now});clearInterval(app.timer);t.after(()=>app.close());
  const room={code:'07',arena:0,botCount:0,host:0,members:new Map()};app.makeWorld(room);app.rooms.set('07',room);
  const host=app.join(room,{name:'Host',driver:0}),guest=app.join(room,{name:'Guest',driver:1});
  app.setReady(guest,true);const oldId=app.snapshot(room,host).startRequest.id;app.refusePlayRequest(host,oldId);app.setReady(guest,true);const newId=app.snapshot(room,host).startRequest.id;
  assert.throws(()=>app.refusePlayRequest(guest,newId),/Only the host/);assert.throws(()=>app.refusePlayRequest(host,oldId),/no longer pending/);assert.throws(()=>app.refusePlayRequest(host,String(newId)),/pending play request/);
  assert.equal(guest.wantsToPlay,true);assert.equal(app.snapshot(room,host).startRequest.remainingMs,3000);
});
test('finished matches can auto-restart, while resetting the lobby cancels a pending request',t=>{
  let now=0;const app=new Multiplayer({startNow:()=>now});clearInterval(app.timer);t.after(()=>app.close());
  const room={code:'07',arena:0,botCount:0,host:0,members:new Map()};app.makeWorld(room);app.rooms.set('07',room);
  const host=app.join(room,{name:'Host',driver:0}),guest=app.join(room,{name:'Guest',driver:1});
  room.world.phase='finished';app.setReady(guest,true);now=3000;app.step(1/60);assert.equal(room.world.phase,'countdown');
  app.makeWorld(room);app.setReady(guest,true);app.makeWorld(room);now=6000;app.step(1/60);assert.equal(room.world.phase,'ready');assert.equal(app.snapshot(room,host).startRequest,null);
});
