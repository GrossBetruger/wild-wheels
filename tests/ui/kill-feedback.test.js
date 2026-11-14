import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, damageBattle, equipBomber, tickBattle } from '../../gameplay/combat.js';
import { KillCelebration, ChaffNotice } from '../../ui/combat-notices.js';

test('Pearococo keeps ordinary weapon kills free of the Fashion Statement quote',()=>{
  const world=createBattle(9);Object.assign(world,{phase:'racing'});
  const victim=world.bots[0];Object.assign(victim,{driver:0,health:1,shield:0});
  const feedback=new KillCelebration();feedback.sample(world,0);
  damageBattle(world,victim,world.id,1,'hedgehog');
  assert.equal(feedback.sample(world,.1).subtitle,'');
});

test('whacking Master-Yuda names the player and adds his unimpressed reaction regardless of their name',()=>{
  for(const [driver,name,subtitle]of [[10,'Oren',"he's unimpressed..."],[10,'Master-Yuda',"he's unimpressed..."],[0,'Master-Yuda','']]){
    const world=createBattle();Object.assign(world,{phase:'racing',elapsed:1});
    const victim=world.bots[0];Object.assign(victim,{driver,name,health:1,shield:0});
    const feedback=new KillCelebration();feedback.sample(world,0);damageBattle(world,victim,world.id,1);
    const message=feedback.sample(world,.1);assert.equal(message.title,'✦ YOU WHACKED ✦');assert.equal(message.name,name);assert.equal(message.subtitle,subtitle);
  }
});

test('a radiation kill celebrates you chernowhacked and names its victim',()=>{
  const world=equipBomber(createBattle());Object.assign(world,{phase:'racing',supplies:[]});
  const victim=world.bots[0];Object.assign(victim,{name:'Sam',wx:-65,wz:0,health:1,shield:0,human:true,speed:0});for(const bot of world.bots.slice(1))Object.assign(bot,{inactive:true,destroyed:1e9});
  const feedback=new KillCelebration();feedback.sample(world,0);
  world.effects=[{type:'radiation',owner:0,wx:-65,wz:0,age:0,life:8,doses:{}}];tickBattle(world,new Set(),1/60);
  const message=feedback.sample(world,.1);assert.equal(message.title,'YOU CHERNOWHACKED');assert.equal(message.name,'Sam');assert.equal(message.assist,false);assert.equal(world.kills,1);
});

test('stinkbomb assists say co-whacked while the bomber’s own killing blow still says you whacked',()=>{
  const world=equipBomber(createBattle());Object.assign(world,{phase:'racing',supplies:[]});
  const [killer,victimA,victimB]=world.bots;world.bots=[killer,victimA,victimB];
  for(const victim of [victimA,victimB])Object.assign(victim,{name:'Sam <img>',wx:-65,wz:0,shield:0,health:3,human:true,speed:0});
  const feedback=new KillCelebration();feedback.sample(world,0);
  world.stinkClouds=[{owner:world.id,wx:-65,wz:0,age:0,life:2.5,hits:[]}];tickBattle(world,new Set(),1/60);
  damageBattle(world,victimA,killer.id,3);
  const assist=feedback.sample(world,.1);
  assert.equal(assist.title,'✦ CO-WHACKED ✦');assert.equal(assist.assist,true);assert.equal(assist.name,'Sam <img>');assert.equal(world.kills,.5);
  damageBattle(world,victimB,world.id,3);
  const direct=feedback.sample(world,2.2);
  assert.equal(direct.title,'✦ YOU WHACKED ✦');assert.equal(direct.assist,false);assert.equal(world.kills,1.5);
});

test('solo rematches can celebrate fresh kills and chaff diversions even when their IDs start over',()=>{
  const world=createBattle();Object.assign(world,{phase:'racing',elapsed:5});
  const kills=new KillCelebration(),chaff=new ChaffNotice();kills.sample(world,0);chaff.sample(world,0);
  world.killFeed=[{id:1,attacker:0,victim:1,victimName:'First rival',time:5}];world.chaffClouds=[{id:0,owner:0,diversions:1,divertedAt:5}];
  assert.equal(kills.sample(world,.1).name,'First rival');assert.ok(chaff.sample(world,.1));
  const next=createBattle();kills.sample(next,1);chaff.sample(next,1);
  Object.assign(next,{phase:'racing',elapsed:1,killFeed:[{id:1,attacker:0,victim:1,victimName:'Second rival',time:1}],chaffClouds:[{id:0,owner:0,diversions:1,divertedAt:1}]});
  assert.equal(kills.sample(next,1.1).name,'Second rival');assert.ok(chaff.sample(next,1.1));
});

test('a confirmed kill celebrates the victim by name once, while an ordinary hit does not',()=>{
  const world=createBattle();Object.assign(world,{phase:'racing',soundEpoch:1});
  const victim=world.bots[0];Object.assign(victim,{name:'Sam',color:'#df7053',health:3,shield:0});
  const feedback=new KillCelebration();feedback.sample(world,0);
  damageBattle(world,victim,0,1);assert.equal(feedback.sample(world,.1),null);
  damageBattle(world,victim,0,2);
  assert.equal(feedback.sample(world,.2).name,'Sam');assert.equal(feedback.sample(world,.3).color,'#df7053');
  victim.name='New name';assert.equal(feedback.sample(world,1).name,'Sam');
  assert.equal(feedback.sample(world,2.21),null);assert.equal(feedback.sample(world,3),null);
});

test('two kills in one tick both get a message and another player’s kill does not',()=>{
  const world=createBattle();Object.assign(world,{id:1,phase:'racing',soundEpoch:1,elapsed:1});
  const feedback=new KillCelebration();feedback.sample(world,0);
  world.killFeed=[{id:3,attacker:0,victim:4,victimName:'Other kill',time:1},{id:2,attacker:1,victim:3,victimName:'Jo',time:1},{id:1,attacker:1,victim:2,victimName:'Sam',time:1}];
  assert.equal(feedback.sample(world,.1).name,'Sam');
  assert.equal(feedback.sample(world,2.11).name,'Jo');
  assert.equal(feedback.sample(world,4.12),null);
});

test('joining a match does not replay old kills and a new round can reuse kill IDs',()=>{
  const world=createBattle();Object.assign(world,{phase:'racing',soundEpoch:1,elapsed:1,killFeed:[{id:1,attacker:0,victim:1,victimName:'Old kill',time:1}]});
  const feedback=new KillCelebration();assert.equal(feedback.sample(world,0),null);
  feedback.sample({...world,soundEpoch:2,elapsed:0,killFeed:[]},.1);
  const next={...world,soundEpoch:2,killFeed:[{id:1,attacker:0,victim:1,victimName:'New kill',time:1}]};
  assert.equal(feedback.sample(next,.2).name,'New kill');
  assert.equal(feedback.sample({...next,phase:'finished'},.3),null);
});
