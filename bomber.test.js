import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, equipBomber, dropBomb, tickBattle, damageBattle, targetAhead, fireBattle } from './combat.js';
import { Multiplayer } from './multiplayer.js';
import { LocalFeedback } from './feedback.js';

test('stinkbombs refill every five seconds and A-bombs every ten',()=>{
  const world=equipBomber(createBattle());Object.assign(world,{phase:'racing',bots:[],supplies:[]});
  assert.equal(world.bombAmmo,2);
  assert.equal(world.stinkAmmo,2);
  for(let i=0;i<299;i++)tickBattle(world,new Set(),1/60);assert.equal(world.bombAmmo,2);assert.equal(world.stinkAmmo,2);
  tickBattle(world,new Set(),1/60);assert.equal(world.bombAmmo,2);assert.equal(world.stinkAmmo,3);
  for(let i=0;i<300;i++)tickBattle(world,new Set(),1/60);assert.equal(world.bombAmmo,3);assert.equal(world.stinkAmmo,4);
  for(let i=0;i<300;i++)tickBattle(world,new Set(),1/60);assert.equal(world.bombAmmo,3);assert.equal(world.stinkAmmo,5);
  for(let i=0;i<300;i++)tickBattle(world,new Set(),1/60);assert.equal(world.bombAmmo,4);assert.equal(world.stinkAmmo,6);
  world.phase='paused';for(let i=0;i<600;i++)tickBattle(world,new Set(),1/60);assert.equal(world.bombAmmo,4);assert.equal(world.stinkAmmo,6);
});
test('a falling A-bomb explodes after 0.9 seconds and kills nearby karts without rewarding ammunition',()=>{
  const world=equipBomber(createBattle());Object.assign(world,{phase:'racing',supplies:[]});
  const [nearby,edge,outside]=world.bots;world.bots=[nearby,edge,outside];
  Object.assign(nearby,{wx:-65,wz:0,shield:0,health:3,speed:0,human:true});Object.assign(edge,{wx:-65,wz:22,shield:0,health:3,speed:0,human:true});Object.assign(outside,{wx:-65,wz:23,shield:0,health:3,speed:0,human:true});
  dropBomb(world,world,{wx:-65,wz:0});
  for(let i=0;i<53;i++)tickBattle(world,new Set(),1/60);
  assert.equal(nearby.health,3);assert.equal(edge.health,3);assert.equal(world.bombs.length,1);
  tickBattle(world,new Set(),1/60);
  assert.equal(nearby.health,0);assert.equal(edge.health,0);assert.equal(outside.health,3);assert.equal(world.kills,2);assert.equal(world.bombAmmo,1);assert.equal(world.stinkAmmo,2);assert.equal(world.vulcan,0);assert.equal(world.bombs.length,0);
  assert.ok(world.effects.some(effect=>effect.type==='abomb'&&effect.wx===-65&&effect.wz===0));
});
test('kills do not grant either bomb type or restart the ten-second refill clock',()=>{
  const world=equipBomber(createBattle());Object.assign(world,{phase:'racing',supplies:[]});
  const victim=world.bots[0];world.bots=[victim];Object.assign(victim,{wx:-65,wz:0,health:3,shield:0,speed:0,human:true});
  for(let i=0;i<594;i++)tickBattle(world,new Set(),1/60);
  damageBattle(world,victim,world.id,3);assert.equal(world.bombAmmo,2);assert.equal(world.stinkAmmo,3);assert.equal(world.kills,1);
  assert.equal(damageBattle(world,victim,world.id,3),false);assert.equal(world.bombAmmo,2);
  for(let i=0;i<6;i++)tickBattle(world,new Set(),1/60);assert.equal(world.bombAmmo,3);assert.equal(world.stinkAmmo,4);
});
test('bombers cannot drive, collect kart supplies, fire kart weapons, or be hit by karts',()=>{
  const world=equipBomber(createBattle());Object.assign(world,{phase:'racing',wx:-65,wz:0,bots:[],supplies:[{wx:-65,wz:0,kind:'missile',cooldown:0}]});
  tickBattle(world,new Set(['arrowup','arrowright',' ']),.05);
  assert.equal(world.wx,-65);assert.equal(world.wz,0);assert.equal(world.missiles,1);assert.equal(world.projectiles.length,0);assert.equal(fireBattle(world),undefined);
  assert.equal(damageBattle(world,world,1,3),false);assert.equal(world.health,3);
  const kart={...world,id:1,bomber:false,wx:-65,wz:-30,heading:0,bots:[world]};
  assert.equal(targetAhead(kart),null);
});
test('spawn shields block A-bombs and a tenth bomb kill wins the match',()=>{
  const world=equipBomber(createBattle());Object.assign(world,{phase:'racing',supplies:[],kills:9,bombAmmo:2});
  const victim=world.bots[0];world.bots=[victim];Object.assign(victim,{wx:-65,wz:0,health:3,shield:2,speed:0,human:true});
  dropBomb(world,world,{wx:-65,wz:0});for(let i=0;i<54;i++)tickBattle(world,new Set(),1/60);
  assert.equal(victim.health,3);assert.equal(world.kills,9);
  for(let i=0;i<80;i++)tickBattle(world,new Set(),1/60);
  dropBomb(world,world,{wx:-65,wz:0});for(let i=0;i<54;i++)tickBattle(world,new Set(),1/60);
  assert.equal(world.kills,10);assert.equal(world.finishRank,1);
  for(let i=0;i<180;i++)tickBattle(world,new Set(),1/60);assert.equal(world.phase,'finished');
});
test('only a bomber with ammunition can drop bombs during an active match',()=>{
  const world=createBattle();Object.assign(world,{phase:'racing',bots:[]});
  assert.equal(dropBomb(world,world,{wx:0,wz:0}),false);
  equipBomber(world);assert.ok(dropBomb(world,world,{wx:0,wz:0}));assert.ok(dropBomb(world,world,{wx:10,wz:10}));assert.equal(dropBomb(world,world,{wx:20,wz:20}),false);assert.equal(world.bombAmmo,0);
  assert.ok(dropBomb(world,world,{wx:0,wz:0,kind:'stink'}));assert.ok(dropBomb(world,world,{wx:10,wz:10,kind:'stink'}));assert.equal(dropBomb(world,world,{wx:20,wz:20,kind:'stink'}),false);assert.equal(world.stinkAmmo,0);
  world.bombAmmo=1;world.phase='paused';assert.equal(dropBomb(world,world,{wx:0,wz:0}),false);
  world.phase='racing';world.finishCountdown=3;assert.equal(dropBomb(world,world,{wx:0,wz:0}),false);assert.equal(world.bombAmmo,1);
});
test('the server rejects invalid bomb targets and prevents duplicate drops or forged ammunition',t=>{
  const app=new Multiplayer();t.after(()=>app.close());clearInterval(app.timer);
  const room={code:'07',arena:0,botCount:0,host:0,members:new Map()};app.makeWorld(room);app.rooms.set('07',room);
  const bomber=app.join(room,{name:'Phone',driver:0,role:'bomber'});app.join(room,{name:'Driver',driver:1});room.world.phase='racing';
  for(const target of [{wx:97,wz:0},{wx:0,wz:Infinity},{wx:'0',wz:0},{wx:0,wz:0,kind:'infinite'}])assert.throws(()=>app.controls(bomber,{sequence:0,keys:[],actions:[{type:'bomb',...target}]}),/Invalid action/);
  const epoch=room.world.soundEpoch;
  app.controls(bomber,{sequence:0,keys:[],actions:[{type:'bomb',id:0,afterMove:-1,wx:30,wz:40}],epoch,bombAmmo:100});app.step(1/60);
  app.controls(bomber,{sequence:1,keys:[],actions:[{type:'bomb',id:0,afterMove:-1,wx:30,wz:40},{type:'bomb',id:1,afterMove:-1,wx:30,wz:40},{type:'bomb',id:2,afterMove:-1,wx:30,wz:40}],epoch});app.step(1/60);
  assert.equal(room.world.bombs.length,2);assert.equal(room.world.bombAmmo,0);assert.equal(room.world.bombs[0].wx,30);assert.equal(room.world.bombs[0].wz,40);
  app.makeWorld(room);assert.equal(room.world.bomber,true);assert.equal(room.world.bombAmmo,2);
  assert.equal(room.world.stinkAmmo,2);
});
test('a tap shows its bomb and spends its ammunition immediately, then confirmation keeps one bomb',()=>{
  const world=equipBomber(createBattle());Object.assign(world,{phase:'racing',soundEpoch:1,bots:[],supplies:[]});
  const cues=[],feedback=new LocalFeedback(type=>cues.push(type));feedback.accept({world,actionSequence:-1},0);
  assert.equal(feedback.action('bomb',{wx:30,wz:40},world,.01,-1),true);
  const predicted=feedback.render(world,world,.01,-1);assert.equal(predicted.bombAmmo,1);assert.equal(predicted.bombs.length,1);assert.equal(predicted.bombs[0].wx,30);assert.equal(predicted.bombs[0].wz,40);assert.deepEqual(cues,['bombDrop']);
  dropBomb(world,world,{wx:30,wz:40},0);feedback.accept({world,actionSequence:0},.1);
  assert.equal(feedback.render(world,world,.1,-1).bombs.length,1);assert.equal(feedback.render(world,world,.1,-1).bombAmmo,1);
  assert.equal(feedback.action('bomb',{wx:0,wz:0},world,.11,-1),true);assert.equal(feedback.action('bomb',{wx:0,wz:0},world,.12,-1),false);
});
