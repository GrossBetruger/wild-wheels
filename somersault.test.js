import {arenaFixture} from './scripts/arena-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, somersaultBattle, somersaultPose, tickBattle, fireBattle, damageBattle, blocked, arenas } from './combat.js';
import { LocalPrediction } from './prediction.js';
import { LocalFeedback } from './feedback.js';
import { Multiplayer } from './multiplayer.js';
import { encodeSnapshot, decodeSnapshot } from './wire.js';

test('somersault reverses facing and travel immediately without spending weapons or awarding drift boost',()=>{
  const world=createBattle();Object.assign(world,{phase:'racing',wx:-65,wz:0,heading:0,motionHeading:.3,cameraHeading:0,speed:300,drift:1,wasDrifting:true,turbos:2,item:'missile',missiles:2,fireCooldown:0,bots:[],supplies:[]});
  assert.equal(somersaultBattle(world),true);
  assert.equal(world.heading,Math.PI);assert.equal(world.motionHeading,Math.PI);assert.equal(world.cameraHeading,0);
  assert.equal(world.turbos,2);assert.equal(world.missiles,2);assert.equal(world.item,'missile');assert.equal(world.boost,0);
  fireBattle(world);assert.equal(world.projectiles[0].heading,Math.PI);assert.ok(world.projectiles[0].wz<0);
  tickBattle(world,new Set(['arrowup']),1/60);
  assert.ok(world.wz<0);assert.equal(world.boost,0);assert.ok(somersaultPose(world).height>0);
});

test('the somersault reaches five units high, completes a full flip, lands and becomes available after one second',()=>{
  const world=createBattle();Object.assign(world,{phase:'racing',wx:-65,wz:0,heading:0,motionHeading:0,cameraHeading:0,speed:0,bots:[],supplies:[]});
  somersaultBattle(world);
  assert.deepEqual(somersaultPose({...world,somersault:.275}),{height:5,pitch:-Math.PI});
  for(let i=0;i<34;i++)tickBattle(world,new Set(),1/60);
  assert.equal(somersaultPose(world),null);assert.equal(somersaultBattle(world),false);
  for(let i=34;i<60;i++)tickBattle(world,new Set(),1/60);
  assert.equal(somersaultBattle(world),true);assert.equal(world.heading,Math.PI*2);
});

test('somersault camera rotates continuously through the half turn while aim reverses immediately',()=>{
  const world=createBattle();Object.assign(world,{phase:'racing',wx:-65,wz:0,heading:0,motionHeading:0,cameraHeading:0,speed:0,bots:[],supplies:[]});
  somersaultBattle(world);
  assert.equal(world.cameraHeading,0);assert.equal(world.heading,Math.PI);
  let previous=0;
  for(let frame=1;frame<=33;frame++){
    tickBattle(world,new Set(),1/60);
    assert.ok(world.cameraHeading>previous);
    assert.ok(world.cameraHeading-previous<Math.PI/18);
    if(frame===16)assert.ok(world.cameraHeading>1.4&&world.cameraHeading<1.6);
    previous=world.cameraHeading;
  }
  assert.ok(Math.abs(world.cameraHeading-Math.PI)<.01);
});

test('somersault cannot start while dead, paused, in the countdown, or after combat ends',()=>{
  const world=createBattle();Object.assign(world,{phase:'racing'});
  for(const state of [{destroyed:1},{phase:'paused'},{phase:'countdown'},{phase:'finished'},{finishCountdown:2},{mode:'race'}]){
    const actor={...world,...state};assert.equal(somersaultBattle(actor),false);assert.equal(actor.somersault,0);
  }
});

test('a somersault still obeys arena cover and destruction cancels the jump',()=>{
  const world=createBattle();Object.assign(world,{phase:'racing',wx:0,wz:12,heading:0,motionHeading:0,cameraHeading:0,speed:500,shield:0,bots:[],supplies:[]});
  somersaultBattle(world);for(let i=0;i<10;i++)tickBattle(world,new Set(['arrowup']),1/60);
  assert.equal(blocked(arenas[0],world.wx,world.wz),false);
  damageBattle(world,world,99,3);assert.equal(somersaultPose(world),null);
});

test('a guest flips locally and delayed command acknowledgment neither turns twice nor changes the path',t=>{
  const app=new Multiplayer({fixtureWorld:arenaFixture});t.after(()=>app.close());clearInterval(app.timer);
  const room={code:'07',arena:0,botCount:0,host:0,members:new Map()};app.makeWorld(room);app.rooms.set('07',room);
  app.join(room,{name:'Host',driver:0});const member=app.join(room,{name:'Guest',driver:1});
  Object.assign(room.world,{phase:'racing',destroyed:999,supplies:[]});
  const actor=room.world.bots[0];Object.assign(actor,{wx:-65,wz:70,heading:Math.PI/2,motionHeading:Math.PI/2,cameraHeading:Math.PI/2,speed:300});
  const prediction=new LocalPrediction(),feedback=new LocalFeedback(()=>{}),initial=decodeSnapshot(JSON.parse(encodeSnapshot(app.snapshot(room,member))));
  prediction.accept(initial.world,0);feedback.accept(initial,0);
  assert.equal(feedback.action('somersault',undefined,initial.world,0,-1),true);
  prediction.maneuver(feedback.operations.at(-1));
  assert.equal(prediction.sample(new Set(),0,0).heading,Math.PI*1.5);
  assert.equal(feedback.action('somersault',undefined,prediction.sample(new Set(),0,0),0,-1),false);
  for(let i=1;i<=8;i++)prediction.sample(new Set(['arrowup']),1/60,i/60);
  const before=prediction.sample(new Set(),0,8/60);
  assert.ok(before.cameraHeading>Math.PI/2&&before.cameraHeading<Math.PI);
  const input={sequence:0,keys:[],actions:feedback.commands(),epoch:initial.world.soundEpoch,moves:prediction.commands()};
  app.controls(member,input);app.controls(member,input);
  for(let i=0;i<8;i++)app.step(1/60);
  const confirmed=decodeSnapshot(JSON.parse(encodeSnapshot(app.snapshot(room,member))));
  prediction.accept(confirmed.world,.3,{sequence:confirmed.movementSequence,actionSequence:confirmed.actionSequence});
  const after=prediction.sample(new Set(),0,.3);
  assert.ok(Math.abs(after.heading-Math.PI*1.5)<1e-9);assert.ok(Math.abs(after.wx-before.wx)<1e-9);assert.ok(Math.abs(after.wz-before.wz)<1e-9);
  assert.ok(Math.abs(after.cameraHeading-before.cameraHeading)<1e-9);
  assert.ok(Math.abs(actor.heading-Math.PI*1.5)<1e-9);assert.equal(actor.item,'hedgehog');assert.ok(actor.somersault>0);
});
