import test from 'node:test';
import assert from 'node:assert/strict';
import { TiltSteering, allowTilt, usesMobileControls, mobileLockTarget } from './mobile.js';
import { createBattle } from './combat.js';
import { LocalPrediction } from './prediction.js';
import { Multiplayer } from './multiplayer.js';
import { createRace, tick } from './engine.js';

test('mobile controls require both touch and a coarse pointer, so desktops keep manual fire',()=>{
  assert.equal(usesMobileControls(1,true),true);assert.equal(usesMobileControls(0,true),false);assert.equal(usesMobileControls(5,false),false);
});
test('tilt permission failures preserve the touch-control route',async()=>{
  await assert.rejects(allowTilt({mobile:true,secure:true,orientation:{requestPermission:async()=> 'denied'}}),/Touch controls still work/);
  await assert.rejects(allowTilt({mobile:true,secure:false,orientation:{}}),/HTTPS invitation/);
  await assert.rejects(allowTilt({mobile:true,secure:true}),/touch controls/);
  await allowTilt({mobile:true,secure:true,orientation:{requestPermission:async()=> 'granted'}});
});
test('tilt has a neutral dead zone, proportional steering, auto drive, and a working brake',()=>{
  const tilt=new TiltSteering();tilt.enabled=true;tilt.sample(35,0,0);tilt.sample(35,3,0);
  assert.equal(tilt.keys(new Set(),true).steer,0);
  tilt.sample(35,14,0);const physical=new Set();const driving=tilt.keys(physical,true);
  assert.equal(driving.steer,.5);assert.equal(driving.has('arrowup'),true);assert.equal(physical.size,0);
  const braking=tilt.keys(new Set(['arrowdown']),true);assert.equal(braking.has('arrowup'),false);assert.equal(braking.has('arrowdown'),true);
  assert.equal(tilt.keys(new Set(),false).size,0);
  tilt.recenter();assert.equal(tilt.keys(new Set(),true).size,0);tilt.sample(35,14,0);assert.equal(tilt.steer,0);
});
test('landscape at 90 degrees steers toward the lowered edge of the screen',()=>{
  const tilt=new TiltSteering();tilt.enabled=true;tilt.sample(0,35,90);
  tilt.sample(14,35,90);assert.equal(tilt.keys(new Set(),true).steer,.5);
  tilt.sample(-14,35,90);assert.equal(tilt.keys(new Set(),true).steer,-.5);
});
test('landscape at 270 degrees steers toward the lowered edge of the screen',()=>{
  const tilt=new TiltSteering();tilt.enabled=true;tilt.sample(0,-35,270);
  tilt.sample(-14,-35,270);assert.equal(tilt.keys(new Set(),true).steer,.5);
  tilt.sample(14,-35,270);assert.equal(tilt.keys(new Set(),true).steer,-.5);
});
test('rotating from portrait to landscape recenters steering at the new holding position',()=>{
  const tilt=new TiltSteering();tilt.enabled=true;tilt.sample(35,0,0);tilt.sample(35,14,0);
  assert.equal(tilt.keys(new Set(),true).steer,.5);
  tilt.sample(8,35,90);assert.equal(tilt.keys(new Set(),true).steer,0);
  tilt.sample(22,35,90);assert.equal(tilt.keys(new Set(),true).steer,.5);
});
test('tilting right steers the kart right in solo Grand Prix',()=>{
  const race=createRace();Object.assign(race,{phase:'racing',speed:300,x:0});
  const tilt=new TiltSteering();tilt.enabled=true;tilt.sample(35,0);tilt.sample(35,14);
  for(let i=0;i<12;i++)tick(race,tilt.keys(new Set(),true),1/60);
  assert.ok(race.x>0);assert.ok(race.yaw>0);assert.ok(race.speed>300);
});
test('mobile automatic fire only locks an exposed enemy ahead during live combat',()=>{
  const world=createBattle();Object.assign(world,{phase:'racing',wx:-65,wz:0,heading:0});
  const rival=world.bots[0];Object.assign(rival,{wx:-65,wz:50,shield:0,destroyed:0});world.bots=[rival];
  assert.equal(mobileLockTarget(world,true).id,1);assert.equal(mobileLockTarget(world,false),null);assert.equal(mobileLockTarget(world,true,false),null);
  assert.equal(mobileLockTarget({...world,phase:'paused'},true),null);assert.equal(mobileLockTarget({...world,destroyed:1},true),null);
  rival.wz=-50;assert.equal(mobileLockTarget(world,true),null);
  rival.wz=50;rival.shield=1;assert.equal(mobileLockTarget(world,true),null);
  rival.shield=0;world.wx=0;world.wz=-40;rival.wx=0;rival.wz=40;assert.equal(mobileLockTarget(world,true),null);
});
test('analog mobile steering follows the same path in guest prediction and server simulation',t=>{
  const app=new Multiplayer();t.after(()=>app.close());clearInterval(app.timer);
  const room={code:'07',arena:0,botCount:0,host:0,members:new Map()};app.makeWorld(room);app.rooms.set('07',room);app.join(room,{name:'Host',driver:0});const member=app.join(room,{name:'Phone',driver:1});
  Object.assign(room.world,{phase:'racing',supplies:[],destroyed:999});const actor=room.world.bots[0];Object.assign(actor,{wx:-65,wz:0,heading:0,motionHeading:0,cameraHeading:0,speed:200});
  const state=app.snapshot(room,member),prediction=new LocalPrediction();prediction.accept(state.world,0);
  const keys=new Set(['arrowup']);keys.steer=.35;for(let i=1;i<=8;i++)prediction.sample(keys,1/60,i/60);
  const view=prediction.sample(keys,0,8/60);app.controls(member,{sequence:0,keys:[],actions:[],epoch:room.world.soundEpoch,moves:prediction.commands()});for(let i=0;i<8;i++)app.step(1/60);
  assert.ok(Math.abs(actor.wx-view.wx)<1e-9);assert.ok(Math.abs(actor.wz-view.wz)<1e-9);assert.equal(actor.heading,view.heading);
  assert.throws(()=>app.controls(member,{sequence:1,keys:[],actions:[],moves:[{sequence:8,keys:[],steer:2}],epoch:room.world.soundEpoch}),/Invalid steering/);
});
