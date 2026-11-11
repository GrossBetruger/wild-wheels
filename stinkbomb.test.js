import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, equipBomber, dropBomb, tickBattle, predictKartMovement, damageBattle } from './combat.js';
import { LocalFeedback } from './feedback.js';
import { LocalPrediction } from './prediction.js';
import { Multiplayer } from './multiplayer.js';

test('stinkbombs use their own ammunition and show the selected canister immediately',()=>{
  const world=equipBomber(createBattle());Object.assign(world,{phase:'racing',soundEpoch:1,stinkAmmo:1,bots:[],supplies:[]});
  const feedback=new LocalFeedback(()=>{});feedback.accept({world,actionSequence:-1},0);
  assert.equal(feedback.action('bomb',{wx:30,wz:40,kind:'stink'},world,.01,-1),true);
  const view=feedback.render(world,world,.01,-1);assert.equal(view.bombAmmo,2);assert.equal(view.stinkAmmo,0);assert.equal(view.bombs[0].kind,'stink');
  assert.equal(feedback.action('bomb',{wx:30,wz:40,kind:'stink'},world,.02,-1),false);
  assert.deepEqual(feedback.commands(),[{id:0,type:'bomb',afterMove:-1,wx:30,wz:40,kind:'stink'}]);
  assert.ok(dropBomb(world,world,{wx:30,wz:40,kind:'stink'},0));feedback.accept({world,actionSequence:0},.1);
  assert.equal(feedback.render(world,world,.1,-1).bombs.length,1);assert.equal(world.bombAmmo,2);assert.equal(world.stinkAmmo,0);
});
test('gas makes nearby exposed karts dizzy for four seconds without damaging health or awarding kills',()=>{
  const world=equipBomber(createBattle());Object.assign(world,{phase:'racing',supplies:[],stinkAmmo:1});
  const [nearby,shielded,outside]=world.bots;world.bots=[nearby,shielded,outside];
  Object.assign(nearby,{wx:-65,wz:0,health:3,shield:0,speed:0,human:true});Object.assign(shielded,{wx:-55,wz:0,health:3,shield:6,speed:0,human:true});Object.assign(outside,{wx:-65,wz:20,health:3,shield:0,speed:0,human:true});
  dropBomb(world,world,{wx:-65,wz:0,kind:'stink'});for(let i=0;i<54;i++)tickBattle(world,new Set(),1/60);
  assert.equal(nearby.dizzy,4);assert.equal(shielded.dizzy,0);assert.equal(outside.dizzy,0);
  assert.equal(nearby.health,3);assert.equal(world.kills,0);assert.equal(world.bombAmmo,2);assert.equal(world.stinkClouds.length,1);
  for(let i=0;i<120;i++)tickBattle(world,new Set(),1/60);assert.ok(Math.abs(nearby.dizzy-2)<1e-8);
  for(let i=0;i<121;i++)tickBattle(world,new Set(),1/60);assert.equal(nearby.dizzy,0);assert.equal(nearby.health,3);assert.equal(world.stinkClouds.length,1);
  for(let i=0;i<60;i++)tickBattle(world,new Set(),1/60);assert.equal(world.stinkClouds.length,0);
});
test('karts entering lingering gas get dizzy, and death clears dizziness',()=>{
  const world=equipBomber(createBattle());Object.assign(world,{phase:'racing',supplies:[],stinkAmmo:1});
  const target=world.bots[0];world.bots=[target];Object.assign(target,{wx:-65,wz:25,health:3,shield:0,speed:0,human:true});
  dropBomb(world,world,{wx:-65,wz:0,kind:'stink'});for(let i=0;i<54;i++)tickBattle(world,new Set(),1/60);assert.equal(target.dizzy,0);
  target.wz=0;tickBattle(world,new Set(),1/60);assert.equal(target.dizzy,4);
  damageBattle(world,target,world.id,3);assert.equal(target.dizzy,0);
});
test('dizzy steering weaves, remains responsive, and returns to normal after the effect expires',()=>{
  const world=createBattle();Object.assign(world,{phase:'racing',wx:-65,wz:0,speed:200,heading:0,motionHeading:0,cameraHeading:0,dizzy:4});
  for(let i=0;i<30;i++)predictKartMovement(world,world,new Set(['arrowup']),1/60);
  assert.ok(Math.abs(world.heading)>.01);assert.ok(world.speed>200);
  world.dizzy=0;world.heading=0;world.motionHeading=0;world.cameraHeading=0;
  for(let i=0;i<6;i++)predictKartMovement(world,world,new Set(['arrowup']),1/60);assert.equal(world.heading,0);
});
test('dizzy guest prediction follows the same movement and expiration as the server',t=>{
  const app=new Multiplayer();t.after(()=>app.close());clearInterval(app.timer);
  const room={code:'07',arena:0,botCount:0,host:0,members:new Map()};app.makeWorld(room);app.rooms.set('07',room);app.join(room,{name:'Host',driver:0});const guest=app.join(room,{name:'Dizzy guest',driver:1});
  Object.assign(room.world,{phase:'racing',supplies:[],destroyed:999});const actor=room.world.bots[0];Object.assign(actor,{wx:-65,wz:0,speed:200,heading:0,motionHeading:0,cameraHeading:0,dizzy:4});
  const prediction=new LocalPrediction();prediction.accept(app.snapshot(room,guest).world,0);
  for(let i=1;i<=8;i++)prediction.sample(new Set(['arrowup','arrowright']),1/60,i/60);
  const expected=prediction.sample(new Set(['arrowup','arrowright']),0,8/60);
  app.controls(guest,{sequence:0,keys:[],actions:[],epoch:room.world.soundEpoch,moves:prediction.commands()});for(let i=0;i<8;i++)app.step(1/60);
  assert.ok(Math.abs(actor.wx-expected.wx)<1e-9);assert.ok(Math.abs(actor.wz-expected.wz)<1e-9);assert.equal(actor.heading,expected.heading);assert.equal(actor.dizzy,expected.dizzy);
});

test('a driver kill awards one point to the killer and half a point to each bomber whose gas is active',()=>{
  const world=createBattle();Object.assign(world,{phase:'racing',supplies:[]});
  const [bomberA,bomberB,victim]=world.bots;world.bots=[bomberA,bomberB,victim];equipBomber(bomberA);equipBomber(bomberB);
  Object.assign(victim,{wx:-65,wz:0,shield:0,health:3,human:true,speed:0});
  world.stinkClouds=[{owner:bomberA.id,wx:-65,wz:0,age:0,life:2.5,hits:[]},{owner:bomberB.id,wx:-65,wz:0,age:0,life:2.5,hits:[]}];
  tickBattle(world,new Set(),1/60);
  damageBattle(world,victim,world.id,1);assert.deepEqual([world.kills,bomberA.kills,bomberB.kills],[0,0,0]);
  damageBattle(world,victim,world.id,2);
  assert.deepEqual([world.kills,bomberA.kills,bomberB.kills,victim.deaths],[1,.5,.5,1]);
  damageBattle(world,victim,world.id,3);assert.deepEqual([world.kills,bomberA.kills,bomberB.kills],[1,.5,.5]);
});
test('a bomber who also lands the killing blow gets one point despite multiple gas clouds',()=>{
  const world=equipBomber(createBattle());Object.assign(world,{phase:'racing',supplies:[]});
  const victim=world.bots[0];world.bots=[victim];Object.assign(victim,{wx:-65,wz:0,shield:0,health:3,human:true,speed:0});
  world.stinkClouds=[{owner:world.id,wx:-65,wz:0,age:0,life:2.5,hits:[]},{owner:world.id,wx:-65,wz:0,age:0,life:2.5,hits:[]}];
  tickBattle(world,new Set(),1/60);damageBattle(world,victim,world.id,3);
  assert.equal(world.kills,1);assert.equal(victim.deaths,1);assert.equal(world.bombAmmo,2);
});
test('newer gas does not extend another bomber credit beyond their own four seconds',()=>{
  const world=createBattle();Object.assign(world,{phase:'racing',supplies:[]});
  const [bomberA,bomberB,victim]=world.bots;world.bots=[bomberA,bomberB,victim];equipBomber(bomberA);equipBomber(bomberB);
  Object.assign(victim,{wx:-65,wz:0,shield:0,health:3,human:true,speed:0});
  world.stinkClouds=[{owner:bomberA.id,wx:-65,wz:0,age:0,life:2.5,hits:[]}];tickBattle(world,new Set(),1/60);
  for(let i=0;i<180;i++)tickBattle(world,new Set(),1/60);
  world.stinkClouds=[{owner:bomberB.id,wx:-65,wz:0,age:0,life:2.5,hits:[]}];tickBattle(world,new Set(),1/60);
  for(let i=0;i<61;i++)tickBattle(world,new Set(),1/60);
  damageBattle(world,victim,world.id,3);
  assert.deepEqual([world.kills,bomberA.kills,bomberB.kills],[1,0,.5]);
});
test('expired gas earns no point and gas credit does not carry across respawn',()=>{
  const world=createBattle();Object.assign(world,{phase:'racing',supplies:[]});
  const [bomber,victim]=world.bots;world.bots=[bomber,victim];equipBomber(bomber);
  Object.assign(victim,{wx:-65,wz:0,shield:0,health:3,human:true,speed:0});
  world.stinkClouds=[{owner:bomber.id,wx:-65,wz:0,age:0,life:2.5,hits:[]}];tickBattle(world,new Set(),1/60);
  for(let i=0;i<241;i++)tickBattle(world,new Set(),1/60);
  damageBattle(world,victim,world.id,3);assert.deepEqual([world.kills,bomber.kills],[1,0]);
  for(let i=0;i<310;i++)tickBattle(world,new Set(),1/60);
  damageBattle(world,victim,world.id,3);assert.deepEqual([world.kills,bomber.kills,victim.deaths],[2,0,2]);
});
test('gas credit is cleared on death so the next life awards only its killer',()=>{
  const world=createBattle();Object.assign(world,{phase:'racing',supplies:[]});
  const [bomber,victim]=world.bots;world.bots=[bomber,victim];equipBomber(bomber);
  Object.assign(victim,{wx:-65,wz:0,shield:0,health:3,human:true,speed:0});
  world.stinkClouds=[{owner:bomber.id,wx:-65,wz:0,age:0,life:2.5,hits:[]}];tickBattle(world,new Set(),1/60);
  damageBattle(world,victim,world.id,3);assert.deepEqual([world.kills,bomber.kills],[1,.5]);
  for(let i=0;i<310;i++)tickBattle(world,new Set(),1/60);
  damageBattle(world,victim,world.id,3);assert.deepEqual([world.kills,bomber.kills,victim.deaths],[2,.5,2]);
});

test('two stinkbomb assists add up to one point on the leaderboard',()=>{
  const world=createBattle();Object.assign(world,{phase:'racing',supplies:[]});
  const [bomber,victimA,victimB]=world.bots;world.bots=[bomber,victimA,victimB];equipBomber(bomber);
  for(const victim of [victimA,victimB])Object.assign(victim,{wx:-65,wz:0,shield:0,health:3,human:true,speed:0});
  world.stinkClouds=[{owner:bomber.id,wx:-65,wz:0,age:0,life:2.5,hits:[]}];tickBattle(world,new Set(),1/60);
  damageBattle(world,victimA,world.id,3);assert.deepEqual([world.kills,bomber.kills],[1,.5]);
  damageBattle(world,victimB,world.id,3);assert.deepEqual([world.kills,bomber.kills],[2,1]);
});

test('stink gas still affects a new arrival after three seconds and disperses after five seconds',()=>{
  const world=equipBomber(createBattle());Object.assign(world,{phase:'racing',supplies:[],stinkAmmo:1});
  const victim=world.bots[0];world.bots=[victim];Object.assign(victim,{wx:-65,wz:30,shield:0,health:3,human:true,speed:0});
  dropBomb(world,world,{wx:-65,wz:0,kind:'stink'});
  for(let i=0;i<234;i++)tickBattle(world,new Set(),1/60);
  assert.equal(world.stinkClouds.length,1);assert.equal(victim.dizzy,0);
  victim.wz=0;tickBattle(world,new Set(),1/60);assert.equal(victim.dizzy,4);
  for(let i=0;i<118;i++)tickBattle(world,new Set(),1/60);assert.equal(world.stinkClouds.length,1);
  for(let i=0;i<2;i++)tickBattle(world,new Set(),1/60);assert.equal(world.stinkClouds.length,0);assert.ok(victim.dizzy>1.9);assert.equal(victim.health,3);
});
