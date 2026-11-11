import {arenaFixture} from './scripts/arena-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Multiplayer } from './multiplayer.js';
import { createBattle } from './combat.js';
import { LocalPrediction } from './prediction.js';

test('a burst of movement requests cannot buy extra simulation time, even with a forged duration',t=>{
  const app=new Multiplayer({fixtureWorld:arenaFixture});clearInterval(app.timer);t.after(()=>app.close());
  const room={code:'07',arena:0,botCount:0,host:0,members:new Map()};app.makeWorld(room);app.rooms.set('07',room);
  const member=app.join(room,{name:'Driver',driver:0});
  Object.assign(room.world,{phase:'racing',wx:0,wz:70,heading:0,motionHeading:0,cameraHeading:0,supplies:[]});
  const message={sequence:0,keys:['arrowup'],actions:[],epoch:room.world.soundEpoch,moves:Array.from({length:8},(_,sequence)=>({sequence,keys:['arrowup'],dt:1000}))};
  app.controls(member,message);app.step(1/60);
  assert.equal(room.world.speed,5);assert.equal(app.snapshot(room,member).movementSequence,0);
  // Retransmission after reconnect must not run these same inputs twice.
  app.controls(member,{...message,sequence:1});
  for(let tick=0;tick<7;tick++)app.step(1/60);
  assert.equal(room.world.speed,40);assert.equal(app.snapshot(room,member).movementSequence,7);
  const position=room.world.wz;app.step(1/60);assert.equal(room.world.wz,position);
});

test('old match commands cannot move a player after the host resets the arena',t=>{
  const app=new Multiplayer({fixtureWorld:arenaFixture});clearInterval(app.timer);t.after(()=>app.close());
  const room={code:'07',arena:0,botCount:0,host:0,members:new Map()};app.makeWorld(room);app.rooms.set('07',room);
  const member=app.join(room,{name:'Driver',driver:0}),epoch=room.world.soundEpoch;
  app.controls(member,{sequence:0,keys:[],actions:[],epoch,moves:[{sequence:0,keys:['arrowup']}]});
  app.makeWorld(room);room.world.phase='racing';
  const {wx,wz}=room.world;
  app.controls(member,{sequence:1,keys:[],actions:[],epoch,moves:[{sequence:1,keys:['arrowup']}]});app.step(1/60);
  assert.equal(room.world.wx,wx);assert.equal(room.world.wz,wz);assert.equal(room.world.speed,0);
});

test('reconnecting resends an unacknowledged movement and a matching confirmation does not pull the kart back',()=>{
  const world=createBattle();Object.assign(world,{phase:'racing',wx:0,wz:70,heading:0,motionHeading:0,cameraHeading:0,speed:0});
  const prediction=new LocalPrediction();prediction.accept(world,0);
  prediction.sample(new Set(['arrowup']),1/60,1/60);
  const first=prediction.commands();prediction.resend();
  assert.deepEqual(prediction.commands(),first);
  prediction.accept({...world,wz:70.00708333333333,speed:5},.2,{sequence:0});
  const view=prediction.sample(new Set(),0,.2);
  assert.equal(view.speed,5);assert.ok(Math.abs(view.wz-70.00708333333333)<1e-9);
  assert.deepEqual(prediction.commands(),[]);
});

test('uneven render intervals still move forward on every frame at steady speed',()=>{
  const world=createBattle();Object.assign(world,{phase:'racing',wx:0,wz:60,heading:0,motionHeading:0,cameraHeading:0,speed:520});
  const prediction=new LocalPrediction();prediction.accept(world,0);
  let now=0,position=60;
  for(const dt of [.0166,.0167,.0167,.0166,.0167,.0167]){
    now+=dt;const view=prediction.sample(new Set(['arrowup']),dt,now);
    assert.ok(Math.abs((view.wz-position)-44.2*dt)<1e-9);position=view.wz;
  }
});
