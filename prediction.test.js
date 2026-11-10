import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, predictKartMovement, tickBattle } from './combat.js';
import { LocalPrediction } from './prediction.js';

test('a separate turbo accelerates immediately and replays once until acknowledged',()=>{
  const world=createBattle();Object.assign(world,{phase:'racing',wx:-65,wz:70,heading:0,motionHeading:0,cameraHeading:0,speed:300,turbos:1});
  const prediction=new LocalPrediction();prediction.accept(world,0);
  prediction.turbo({id:0,afterMove:-1});
  const boosted=prediction.sample(new Set(['arrowup']),1/60,1/60);
  assert.ok(boosted.speed>315);assert.ok(boosted.boost>2.4);assert.equal(world.boost,0);
  prediction.accept(world,.1,{sequence:-1,actionSequence:-1});
  const replay=prediction.sample(new Set(),0,.1);
  assert.equal(replay.speed,boosted.speed);assert.equal(replay.boost,boosted.boost);
  prediction.accept({...world,speed:boosted.speed,wz:boosted.wz,boost:boosted.boost,turbos:0},.2,{sequence:0,actionSequence:0});
  const settled=prediction.sample(new Set(),1/60,.2167);
  assert.ok(settled.boost<2.48);assert.equal(world.turbos,1);
});

test('guest movement prediction matches the server while accelerating through a turn',()=>{
  const world=createBattle();world.phase='racing';world.destroyed=99;world.supplies=[];
  for(const bot of world.bots)bot.destroyed=99;
  const guest=world.bots[0];Object.assign(guest,{human:true,destroyed:0,wx:0,wz:60,heading:0,motionHeading:0,cameraHeading:0,speed:200});
  const predicted={...guest},keys=new Set(['arrowup','arrowright']);
  predictKartMovement(world,predicted,keys,1/60);
  tickBattle(world,new Set(),1/60,new Map([[guest.id,keys]]));
  assert.ok(Math.abs(predicted.wx-guest.wx)<1e-9);
  assert.ok(Math.abs(predicted.wz-guest.wz)<1e-9);
  assert.equal(predicted.heading,guest.heading);
});

test('driving and steering respond on the next frame without another server update',()=>{
  const world=createBattle();Object.assign(world,{phase:'racing',wx:0,wz:60,heading:0,motionHeading:0,cameraHeading:0,speed:0});
  const prediction=new LocalPrediction();prediction.accept(world,0);
  const view=prediction.sample(new Set(['arrowup','arrowright']),1/60,1/60);
  assert.equal(view.speed,5);
  assert.ok(view.wz>60);
  assert.ok(view.heading<0);
  assert.equal(world.wz,60);
  assert.equal(world.health,3);
  assert.equal(world.ammo,5);
});

test('small server corrections settle smoothly without a sudden position jump',()=>{
  const world=createBattle();Object.assign(world,{phase:'racing',wx:0,wz:60,speed:0});
  const prediction=new LocalPrediction();prediction.accept(world,0);
  prediction.accept({...world,wx:1},.1);
  const first=prediction.sample(new Set(),1/60,.1+1/60);
  assert.ok(first.wx>0&&first.wx<.5);
  let view=first;
  for(let frame=2;frame<=30;frame++)view=prediction.sample(new Set(),1/60,.1+frame/60);
  assert.ok(Math.abs(view.wx-1)<.001);
});

test('prediction stops advancing when the connection stalls and snaps to a respawn',()=>{
  const world=createBattle();Object.assign(world,{phase:'racing',wx:0,wz:60,heading:0,motionHeading:0,speed:300});
  const prediction=new LocalPrediction();prediction.accept(world,0);
  const moving=prediction.sample(new Set(['arrowup']),1/60,.1);
  const stalled=prediction.sample(new Set(['arrowup']),1/60,.5);
  assert.equal(stalled.wz,moving.wz);
  prediction.accept({...world,destroyed:1},.6,{sequence:0});
  prediction.accept({...world,wx:-60,wz:-60,destroyed:0,speed:0},.7,{sequence:0});
  const respawn=prediction.sample(new Set(),0,.7);
  assert.equal(respawn.wx,-60);assert.equal(respawn.wz,-60);
});

test('a delayed acknowledgment preserves the second movement without replaying the first or spending ammunition',()=>{
  const world=createBattle();Object.assign(world,{phase:'racing',wx:0,wz:60,heading:0,motionHeading:0,cameraHeading:0,speed:0});
  const prediction=new LocalPrediction();prediction.accept(world,0);
  prediction.sample(new Set(['arrowup',' ']),1/60,1/60);
  prediction.sample(new Set(['arrowup',' ']),1/60,2/60);
  prediction.accept({...world,wz:60.00708333333333,speed:5},.1,{sequence:0});
  const view=prediction.sample(new Set(),0,.1);
  assert.ok(Math.abs(view.wz-60.02125)<1e-9);
  assert.equal(view.speed,10);
  assert.equal(world.health,3);assert.equal(world.ammo,5);assert.equal(world.projectiles.length,0);
});
