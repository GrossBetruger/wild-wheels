import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, makeProjectile, advanceProjectile } from './combat.js';
import { LocalFeedback } from './feedback.js';
import { Multiplayer } from './multiplayer.js';
import { encodeSnapshot, decodeSnapshot } from './wire.js';

test('firing shows one projectile and spends one displayed round before a server reply',()=>{
  const world=createBattle();Object.assign(world,{phase:'racing',wx:0,wz:60,heading:0,fireCooldown:0});
  const heard=[],feedback=new LocalFeedback(type=>heard.push(type));feedback.accept({world,movementSequence:-1,actionSequence:-1},0);
  feedback.action('fire',undefined,world,0,-1);
  const view=feedback.render(world,world,0,-1);
  assert.equal(view.projectiles.length,1);assert.equal(view.projectiles[0].wz,63.5);
  assert.equal(view.ammo,4);assert.equal(world.ammo,5);assert.deepEqual(heard,['fire']);
  const later=feedback.render(world,world,.08,4);
  assert.ok(later.projectiles[0].wz>68);
});

test('a delayed shot confirmation neither duplicates nor rewinds the visible shot',()=>{
  const world=createBattle();Object.assign(world,{phase:'racing',wx:0,wz:60,heading:Math.PI/2,fireCooldown:0});
  const feedback=new LocalFeedback(()=>{});feedback.accept({world,movementSequence:-1,actionSequence:-1},0);feedback.action('fire',undefined,world,0,-1);
  const before=feedback.render(world,world,.16,9);
  const shot={...makeProjectile(world,world),id:10,actionId:0};advanceProjectile(world,shot,.08);
  const confirmed={...world,ammo:4,projectiles:[shot]};feedback.accept({world:confirmed,movementSequence:4,actionSequence:0},.16);
  const after=feedback.render(confirmed,world,.16,9);
  assert.equal(after.projectiles.length,1);assert.equal(after.projectiles[0].id,10);assert.equal(after.ammo,4);
  assert.ok(Math.abs(after.projectiles[0].wx-before.projectiles[0].wx)<.01);
  feedback.accept({world:{...confirmed,projectiles:[]},movementSequence:10,actionSequence:0},.2);
  assert.equal(feedback.render({...confirmed,projectiles:[]},world,.2,11).projectiles.length,0);
});

test('touching a pickup immediately hides it, updates inventory, and sounds once through confirmation',()=>{
  const world=createBattle();Object.assign(world,{phase:'racing',wx:0,wz:60,health:3});world.supplies=[{id:0,version:0,kind:'health',wx:0,wz:62,cooldown:0}];
  const heard=[],feedback=new LocalFeedback(type=>heard.push(type));feedback.accept({world,movementSequence:-1,actionSequence:-1},0);
  const immediate=feedback.render(world,world,0,0);
  assert.equal(immediate.health,4);assert.equal(world.health,3);assert.equal(immediate.supplies[0].cooldown,8);
  feedback.accept({world,movementSequence:-1,actionSequence:-1},.05);feedback.render(world,world,.05,0);
  const confirmed={...world,health:4,supplies:[{...world.supplies[0],version:1,collector:0,cooldown:8}]};feedback.accept({world:confirmed,movementSequence:1,actionSequence:-1},.16);
  assert.equal(feedback.render(confirmed,world,.16,1).health,4);assert.deepEqual(heard,['pickup']);
});

test('a contested pickup and rejected shot revert without awarding damage or inventory',()=>{
  const world=createBattle();Object.assign(world,{phase:'racing',wx:0,wz:60,ammo:0,fireCooldown:0});world.supplies=[{id:0,version:0,kind:'hedgehog',wx:0,wz:62,cooldown:0}];
  const feedback=new LocalFeedback(()=>{});feedback.accept({world,movementSequence:-1,actionSequence:-1},0);
  assert.equal(feedback.render(world,world,0,0).ammo,6);feedback.action('fire',undefined,world,0,0);
  const rejected={...world,supplies:[{...world.supplies[0],version:1,collector:1,cooldown:8}]};feedback.accept({world:rejected,movementSequence:1,actionSequence:0},.16);
  const view=feedback.render(rejected,world,.16,1);
  assert.equal(view.ammo,0);assert.equal(view.projectiles.length,0);assert.equal(world.kills,0);assert.equal(world.bots[0].health,3);
});

test('an empty weapon, full health pickup, and destroyed driver give no false action feedback',()=>{
  const world=createBattle();Object.assign(world,{phase:'racing',wx:0,wz:60,ammo:0,health:6,fireCooldown:0});world.supplies=[{id:0,version:0,kind:'health',wx:0,wz:62,cooldown:0}];
  const heard=[],feedback=new LocalFeedback(type=>heard.push(type));feedback.accept({world,movementSequence:-1,actionSequence:-1},0);
  feedback.action('fire',undefined,world,0,-1);
  assert.equal(feedback.render(world,world,0,-1).supplies[0].cooldown,0);
  feedback.accept({world:{...world,destroyed:1,ammo:5},movementSequence:0,actionSequence:-1},.1);feedback.action('fire',undefined,world,.1,0);
  assert.equal(feedback.render(world,world,.1,0).projectiles.length,0);assert.deepEqual(heard,[]);
});

test('held Vulcan fire produces twelve authoritative shots per second and keeps reserve ammo',t=>{
  const app=new Multiplayer();clearInterval(app.timer);t.after(()=>app.close());
  const room={code:'07',arena:0,botCount:0,host:0,members:new Map()};app.makeWorld(room);app.rooms.set('07',room);
  const member=app.join(room,{name:'Driver',driver:0});Object.assign(room.world,{phase:'racing',wx:-65,wz:70,heading:Math.PI/2,motionHeading:Math.PI/2,cameraHeading:Math.PI/2,fireCooldown:0,vulcan:15,supplies:[]});
  const feedback=new LocalFeedback(()=>{});feedback.accept(decodeSnapshot(JSON.parse(encodeSnapshot(app.snapshot(room,member)))),0);
  for(let frame=0;frame<60;frame++){
    feedback.action('fire',undefined,room.world,frame/60,frame);
    app.controls(member,{sequence:frame,epoch:room.world.soundEpoch,keys:[],moves:[{sequence:frame,keys:[]}],actions:feedback.commands()});app.step(1/60);
    feedback.accept(decodeSnapshot(JSON.parse(encodeSnapshot(app.snapshot(room,member)))),(frame+1)/60);
  }
  assert.equal(room.world.projectiles.length,12);assert.equal(room.world.ammo,5);assert.equal(room.world.kills,0);
});

test('a delayed movement batch collects a passed pickup and can fire its missile at the contact position',t=>{
  const app=new Multiplayer();clearInterval(app.timer);t.after(()=>app.close());
  const room={code:'07',arena:0,botCount:0,host:0,members:new Map()};app.makeWorld(room);app.rooms.set('07',room);
  const member=app.join(room,{name:'Driver',driver:0});for(let tick=0;tick<8;tick++)app.step(1/60);
  Object.assign(room.world,{phase:'racing',wx:-65,wz:70,heading:Math.PI/2,motionHeading:Math.PI/2,cameraHeading:Math.PI/2,speed:850,boost:10,fireCooldown:0,missiles:0,supplies:[{id:0,version:0,kind:'missile',wx:-60,wz:70,cooldown:0}]});
  app.controls(member,{sequence:0,epoch:room.world.soundEpoch,keys:[],moves:Array.from({length:8},(_,sequence)=>({sequence,keys:['arrowup']})),actions:[{type:'fire',id:0,afterMove:0}]});app.step(1/60);
  assert.ok(room.world.wx>-56);assert.equal(room.world.supplies[0].collector,0);assert.equal(room.world.supplies[0].version,1);
  assert.equal(room.world.projectiles.length,1);assert.equal(room.world.projectiles[0].kind,'missile');assert.ok(room.world.projectiles[0].wx< -58);
  assert.equal(room.world.missiles,0);assert.equal(room.world.ammo,5);
});

test('duplicate and excessive fire requests cannot duplicate a projectile or bypass cooldown',t=>{
  const app=new Multiplayer();clearInterval(app.timer);t.after(()=>app.close());
  const room={code:'07',arena:0,botCount:0,host:0,members:new Map()};app.makeWorld(room);app.rooms.set('07',room);
  const member=app.join(room,{name:'Driver',driver:0});Object.assign(room.world,{phase:'racing',wx:0,wz:60,heading:0,fireCooldown:0,supplies:[]});
  const request={sequence:0,epoch:room.world.soundEpoch,keys:[],moves:[{sequence:0,keys:[]}],actions:Array.from({length:8},(_,id)=>({type:'fire',id,afterMove:0}))};
  app.controls(member,request);app.step(1/60);app.controls(member,{...request,sequence:1});app.step(1/60);
  assert.equal(room.world.projectiles.length,1);assert.equal(room.world.ammo,4);assert.equal(app.snapshot(room,member).actionSequence,7);
});

test('an authoritative Vulcan reward clears the old cooldown and allows immediate fire',()=>{
  const world=createBattle();Object.assign(world,{phase:'racing',wx:0,wz:60,fireCooldown:.5});
  const feedback=new LocalFeedback(()=>{});feedback.accept({world,movementSequence:0,actionSequence:-1},0);
  const rewarded={...world,vulcan:15,fireCooldown:0};feedback.accept({world:rewarded,movementSequence:1,actionSequence:-1},1/60);
  assert.equal(feedback.action('fire',undefined,rewarded,1/60,1),true);
  const view=feedback.render(rewarded,rewarded,1/60,1);assert.equal(view.projectiles.length,1);assert.equal(view.projectiles[0].vulcan,true);
});

test('an already confirmed projectile stays visible when its driver is destroyed',()=>{
  const world=createBattle();Object.assign(world,{phase:'racing',wx:0,wz:60,destroyed:1});
  world.projectiles=[{...makeProjectile(world,world),id:9,actionId:7}];
  const feedback=new LocalFeedback(()=>{});feedback.accept({world,movementSequence:20,actionSequence:7},1);
  const view=feedback.render(world,world,1,20);
  assert.equal(view.projectiles.length,1);assert.equal(view.projectiles[0].id,9);assert.equal(view.destroyed,1);
});

test('a confirmation arriving between rendered frames keeps a projectile moving at its normal speed',()=>{
  const world=createBattle();Object.assign(world,{phase:'racing',wx:0,wz:60,heading:Math.PI/2,fireCooldown:0});
  const feedback=new LocalFeedback(()=>{});feedback.accept({world,movementSequence:-1,actionSequence:-1},0);feedback.action('fire',undefined,world,0,-1);
  feedback.render(world,world,.1,5);
  const shot={...makeProjectile(world,world),id:10,actionId:0};advanceProjectile(world,shot,.08);
  const confirmed={...world,ammo:4,projectiles:[shot]};feedback.accept({world:confirmed,movementSequence:4,actionSequence:0},.16);
  const next=feedback.render(confirmed,world,1/6,9);
  assert.ok(Math.abs(next.projectiles[0].wx-18.5)<1e-9);
});

test('a localhost confirmation already advanced by the server does not speed up the visible shot',()=>{
  const world=createBattle();Object.assign(world,{phase:'racing',wx:0,wz:60,heading:Math.PI/2,fireCooldown:0});
  const feedback=new LocalFeedback(()=>{});feedback.accept({world,movementSequence:-1,actionSequence:-1},0);feedback.action('fire',undefined,world,0,-1);
  const shot={...makeProjectile(world,world),id:10,actionId:0};advanceProjectile(world,shot,1/60);
  const confirmed={...world,ammo:4,projectiles:[shot]};feedback.accept({world:confirmed,movementSequence:0,actionSequence:0},.001);
  const next=feedback.render(confirmed,world,1/60,0);
  assert.ok(Math.abs(next.projectiles[0].wx-5)<1e-9);
});

test('a missile picked up between movement ticks can be fired immediately without becoming a hedgehog',t=>{
  const app=new Multiplayer();clearInterval(app.timer);t.after(()=>app.close());
  const room={code:'07',arena:0,botCount:0,host:0,members:new Map()};app.makeWorld(room);app.rooms.set('07',room);
  const member=app.join(room,{name:'Driver',driver:0});
  Object.assign(room.world,{phase:'racing',wx:-65,wz:70,heading:Math.PI/2,motionHeading:Math.PI/2,cameraHeading:Math.PI/2,speed:850,boost:10,fireCooldown:0,missiles:0,supplies:[{id:0,version:0,kind:'missile',wx:-60,wz:70,cooldown:0}]});
  const feedback=new LocalFeedback(()=>{});feedback.accept(decodeSnapshot(JSON.parse(encodeSnapshot(app.snapshot(room,member)))),0);
  const displayed={...room.world,wx:-63.9};
  assert.equal(feedback.render(room.world,displayed,0,-1).missiles,1);
  feedback.action('fire',undefined,displayed,0,-1);
  app.controls(member,{sequence:0,epoch:room.world.soundEpoch,keys:[],moves:[{sequence:0,keys:['arrowup']}],actions:feedback.commands()});app.step(1/60);
  assert.equal(room.world.projectiles.length,1);assert.equal(room.world.projectiles[0].kind,'missile');assert.equal(room.world.ammo,5);assert.equal(room.world.missiles,0);
});
