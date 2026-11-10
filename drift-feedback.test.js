import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattle } from './combat.js';
import { LocalDrift } from './drift-feedback.js';
import { encodeSnapshot, decodeSnapshot } from './wire.js';

test('drift smoke, sparks and two tire tracks start at the rendered wheels on the first drift frame',()=>{
  const world=createBattle();Object.assign(world,{phase:'racing',wx:0,wz:60,heading:0,speed:250});
  const feedback=new LocalDrift();feedback.render(world,0);
  const view=feedback.render({...world,wz:60.3,wasDrifting:true,drift:1/60},1/60);
  assert.equal(view.driftParticles.filter(p=>p.kind==='smoke').length,2);
  assert.equal(view.driftParticles.filter(p=>p.kind==='spark').length,6);
  assert.deepEqual(view.skids.map(s=>[s.ax,s.az,s.bx,s.bz]),[[-1.6,58.5,-1.6,58.8],[1.6,58.5,1.6,58.8]]);
  assert.deepEqual(view.driftParticles.filter(p=>p.kind==='smoke').map(p=>[p.wx,p.wz,p.age]),[[-1.6,58.8,0],[1.6,58.8,0]]);
  assert.equal(world.skids.length,0);assert.equal(world.driftParticles.length,0);assert.equal(world.boost,0);
});

test('blue and purple sparks appear on their local charge milestones without waiting for emission cadence',()=>{
  const world=createBattle();Object.assign(world,{phase:'racing',wx:0,wz:60,heading:0,wasDrifting:true,drift:.44});
  const feedback=new LocalDrift();feedback.render(world,0);
  const blue=feedback.render({...world,drift:.45},.016);
  assert.equal(blue.driftParticles.at(-1).level,1);assert.equal(blue.driftParticles.at(-1).age,0);
  const purple=feedback.render({...world,drift:.85},.032);
  assert.equal(purple.driftParticles.at(-1).level,2);assert.equal(purple.driftParticles.at(-1).age,0);
});

test('late server effects do not duplicate local trails and another player retains their own effects',()=>{
  const world=createBattle();Object.assign(world,{id:1,phase:'racing',wx:0,wz:60,heading:0});
  const feedback=new LocalDrift();feedback.render(world,0);
  const drifting={...world,wz:60.3,wasDrifting:true,drift:.1};
  feedback.render(drifting,.016);
  world.skids=[{owner:1,ax:5,az:5,bx:6,bz:6,time:0},{owner:0,ax:10,az:10,bx:11,bz:11,time:0}];
  world.driftParticles=[{owner:1,wx:5,wz:5,height:.2,vx:0,vz:0,vy:1,age:0,life:.9,kind:'smoke',level:0},{owner:0,wx:10,wz:10,height:.2,vx:0,vz:0,vy:1,age:0,life:.9,kind:'smoke',level:0}];
  const decoded=decodeSnapshot(JSON.parse(encodeSnapshot({world:{...drifting,skids:world.skids,driftParticles:world.driftParticles}}))).world;
  const view=feedback.render(decoded,.02);
  assert.equal(view.skids.filter(s=>s.owner===1).length,2);
  assert.equal(view.driftParticles.filter(p=>p.owner===1).length,8);
  assert.deepEqual(view.skids.filter(s=>s.owner===0),world.skids.filter(s=>s.owner===0));
  assert.deepEqual(view.driftParticles.filter(p=>p.owner===0),world.driftParticles.filter(p=>p.owner===0));
  assert.ok(view.driftParticles.filter(p=>p.owner===1).every(p=>p.wz>58));
});

test('release stops emissions immediately while smoke moves and fades smoothly across a snapshot clock correction',()=>{
  const world=createBattle();Object.assign(world,{phase:'racing',elapsed:10,wx:0,wz:60,heading:0});
  const feedback=new LocalDrift();feedback.render(world,0);
  feedback.render({...world,wz:60.3,wasDrifting:true,drift:.1},.016);
  const released=feedback.render({...world,elapsed:9},.116),smoke=released.driftParticles.find(p=>p.kind==='smoke');
  assert.equal(released.skids.length,2);assert.equal(released.driftParticles.length,8);
  assert.ok(Math.abs(smoke.wz-58.6)<1e-9);assert.ok(Math.abs(smoke.age-.1)<1e-9);
  assert.ok(Math.abs(released.elapsed-released.skids[0].time-.1)<1e-9);
  const faded=feedback.render({...world,elapsed:20},1.016);
  assert.equal(faded.driftParticles.length,0);assert.equal(faded.skids.length,2);
  assert.equal(feedback.render(world,6.017).skids.length,0);
});

test('a stalled connection stops fresh drift effects and a respawn cannot join distant tire tracks',()=>{
  const world=createBattle();Object.assign(world,{phase:'racing',wx:0,wz:60,heading:0,wasDrifting:true,drift:.2});
  const feedback=new LocalDrift();feedback.render(world,0);
  const stalled=feedback.render(world,.1,false);
  assert.equal(stalled.driftParticles.length,8);assert.ok(stalled.driftParticles.every(p=>p.age===.1));
  const destroyed=feedback.render({...world,destroyed:1},.2);
  assert.equal(destroyed.driftParticles.length,0);assert.equal(destroyed.skids.length,0);
  const spawned=feedback.render({...world,wx:-60,wz:-60,wasDrifting:false,drift:0},.3);
  assert.equal(spawned.driftParticles.length,0);assert.equal(spawned.skids.length,0);
  const drifting=feedback.render({...world,wx:-60,wz:-59.7},.316);
  assert.ok(drifting.skids.every(s=>Math.hypot(s.bx-s.ax,s.bz-s.az)<1));
});

test('rendering twice at the same time cannot replay drift emissions and a new match clears old tracks',()=>{
  const world=createBattle();Object.assign(world,{phase:'racing',soundEpoch:1,wx:0,wz:60,heading:0,wasDrifting:true,drift:.2});
  const feedback=new LocalDrift();feedback.render(world,0);
  const repeated=feedback.render(world,0);
  assert.equal(repeated.driftParticles.length,8);assert.equal(repeated.skids.length,2);
  const next=feedback.render({...world,soundEpoch:2,wasDrifting:false,drift:0},.1);
  assert.equal(next.driftParticles.length,0);assert.equal(next.skids.length,0);
});
