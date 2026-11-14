import test from 'node:test';
import assert from 'node:assert/strict';
import {createBattle,tickBattle,predictKartMovement} from '../../gameplay/combat.js';
import {useSpecial,characterAbilities} from '../../gameplay/special-abilities.js';
import {ArenaCore,ArenaClient} from '../../gameplay/arena-core.js';

for(const engine of ['JavaScript','Rust']){
  test(`${engine}: the green shockwave reverses racers inside and on its 85-unit radius, leaving racers outside unaffected`,()=>{
    const world=createBattle(5);Object.assign(world,{phase:'racing',human:true,wx:0,wz:0,supplies:[]});
    for(const [index,bot] of world.bots.entries())Object.assign(bot,{driver:0,human:true,inactive:false,destroyed:0,wx:[0,0,0,60,61][index],wz:[84.9,85,85.1,60,61][index]});
    const core=engine==='Rust'?new ArenaCore(world):null;
    if(core)core.step(0,[{actor:0,actions:[{type:'special'}]}]);
    if(!core)assert.equal(useSpecial(world),true);
    const state=core?core.snapshot():world;
    assert.deepEqual(state.bots.map(a=>a.reverseControls??0),[5,5,0,5,0]);assert.equal(state.reverseControls??0,0);
    const wave=state.effects.find(f=>f.type==='reverseShockwave');
    assert.deepEqual([wave.wx,wave.wz,wave.radius,wave.life],[0,0,85,2.2]);
    if(core){const client=new ArenaClient();client.accept(core.packet(0),0);client.frame(0,[],0);const visual=client.present().effects.find(f=>f.type==='reverseShockwave');assert.equal(visual.radius,85);}
  });
  test(`${engine}: Reverse Psychology swaps both movement axes, including another Tammy, and leaves its caster alone`,()=>{
    for(const [key,axis,direction] of [['arrowup','speed',-1],['arrowdown','speed',1],['arrowleft','heading',-1],['arrowright','heading',1]]){
      const world=createBattle(5);Object.assign(world,{phase:'racing',human:true,wx:65,wz:0,heading:0,motionHeading:0,speed:0,supplies:[]});
      for(const bot of world.bots)Object.assign(bot,{inactive:true,destroyed:999});
      Object.assign(world.bots[0],{driver:5,inactive:false,destroyed:0,human:true,wx:25,wz:0,specialCooldown:0});
      const core=engine==='Rust'?new ArenaCore(world):null;
      if(core){core.step(0,[{actor:1,actions:[{type:'special'}]}]);core.step(.05,[{actor:0,keys:[key]}]);}
      if(!core){assert.equal(useSpecial(world,world.bots[0]),true);tickBattle(world,new Set([key]),.05);}
      const after=core?core.snapshot():world;
      assert.equal(Math.sign(after[axis]),direction,key);assert.ok(after.reverseControls>4.9);assert.equal(after.bots[0].reverseControls??0,0);
      assert.equal(after.locusts.length,0);assert.equal(after.bots[0].specialCooldown,19.95);
    }
  });
  test(`${engine}: server bot AI has its steering and accelerator reversed after deciding how to chase`,()=>{
    const results=[];
    for(const activate of [false,true]){
      const world=createBattle(5);Object.assign(world,{phase:'racing',human:true,wx:70,wz:40,supplies:[]});
      for(const bot of world.bots)Object.assign(bot,{inactive:true,destroyed:999});
      Object.assign(world.bots[0],{driver:0,inactive:false,destroyed:0,human:false,wx:65,wz:0,heading:0,motionHeading:0,speed:0,brain:0});
      const core=engine==='Rust'?new ArenaCore(world):null;
      if(core){if(activate)core.step(0,[{actor:0,actions:[{type:'special'}]}]);core.step(.05);}
      if(!core){if(activate)useSpecial(world);tickBattle(world,new Set(),.05);}
      const bot=(core?core.snapshot():world).bots[0];results.push([Math.sign(bot.speed),Math.sign(bot.heading)]);
    }
    assert.deepEqual(results,[[1,1],[-1,-1]]);
  });
  test(`${engine}: controls return after five seconds and disabling room abilities cancels the reversal`,()=>{
    for(const disable of [false,true]){
      const world=createBattle(5);Object.assign(world,{phase:'racing',human:true,wx:65,wz:0,supplies:[]});
      for(const bot of world.bots)Object.assign(bot,{inactive:true,destroyed:999});
      Object.assign(world.bots[0],{driver:0,inactive:false,destroyed:0,human:true,wx:25,wz:0});
      if(!disable)useSpecial(world);
      if(disable){world.bots[0].reverseControls=5;world.specialAbilities=false;}
      const core=engine==='Rust'?new ArenaCore(world):null;
      for(let i=0;i<(disable?1:101);i++){if(core)core.step(.05);if(!core)tickBattle(world,new Set(),.05);}
      assert.equal((core?core.snapshot():world).bots[0].reverseControls,0);
    }
  });
}
test('multiplayer prediction rewires analog steering and acceleration with the same controls as the server',()=>{
  const world=createBattle(0);Object.assign(world,{phase:'racing',human:true,wx:65,wz:0,heading:0,motionHeading:0,speed:0,reverseControls:5,supplies:[]});
  for(const bot of world.bots)Object.assign(bot,{inactive:true,destroyed:999});
  const core=new ArenaCore(world),client=new ArenaClient();client.accept(core.packet(0),0);client.frame(1/60,['arrowup','arrowright'],1/60);
  assert.ok(client.snapshot().speed<0);assert.ok(client.snapshot().heading>0);assert.ok(client.present().reverseControls>4.9);
  const keys=new Set(['arrowup']);keys.steer=.5;predictKartMovement(world,world,keys,1/60);
  assert.ok(world.speed<0);assert.ok(world.heading>0);
});

test('Tammy’s preview explains Reverse Psychology and Cricket’s Jump separately',()=>{
  assert.deepEqual(characterAbilities(5).map(a=>a.title),['REVERSE PSYCHOLOGY','CRICKET’S JUMP']);
});
test('Tammy can activate Reverse Psychology through the actual client command protocol',()=>{
  const world=createBattle(5);Object.assign(world,{phase:'racing',human:true,supplies:[]});
  world.bots.forEach((a,i)=>Object.assign(a,{human:true,inactive:i>0,destroyed:i>0?999:0,wx:world.wx,wz:world.wz-5}));
  const server=new ArenaCore(world),client=new ArenaClient();client.accept(server.packet(),0);client.frame(0,[],0);
  assert.equal(client.action('special',undefined,0),true);
  assert.equal(client.action('special',undefined,0),false);
  server.step(0,[{actor:0,...client.outbound([])}]);
  assert.equal(server.snapshot().locusts.length,0);assert.equal(server.snapshot().bots[0].reverseControls,5);
  client.accept(server.packet(),.02);client.frame(0,[],.02);
  assert.equal(client.action('special',undefined,.02),false);
});
test('Tammy activates Reverse Psychology when every opponent is a server-controlled bot',()=>{
  const server=ArenaCore.room({code:'00',maxPlayers:8,dedicated:true,host:null,arena:0,bots:3,epoch:1,players:[{id:0,name:'Tammy',driver:5,role:'driver'}]});
  server.start();for(let i=0;i<181;i++)server.step(1/60);
  assert.equal(server.snapshot().bots.filter(a=>!a.human).length,3);
  const client=new ArenaClient();client.accept(server.packet(),0);client.frame(0,[],0);
  assert.equal(client.action('special',undefined,0),true);server.step(.01,[{actor:0,...client.outbound([])}]);
  assert.equal(server.snapshot().locusts.length,0);
  // Tammy starts at (0,78); bot 1 at (55,55) is within 85 units,
  // while bots 2 and 3 at (78,0) and (55,-55) are outside.
  client.accept(server.packet(),.02);client.frame(0,[],.02);assert.deepEqual(client.present().bots.map(a=>a.reverseControls>4),[true,false,false]);
});
test('Reverse Psychology recharges in twenty seconds after its five-second effect',()=>{
  const config={code:'00',maxPlayers:8,dedicated:true,host:null,arena:0,bots:3,epoch:1,players:[{id:0,name:'Tammy',driver:5,role:'driver'}]};
  const server=ArenaCore.room(config);server.start();for(let i=0;i<181;i++)server.step(1/60);
  server.step(0,[{actor:0,actions:[{type:'special'}]}]);assert.equal(server.snapshot().specialCooldown,20);
  server.configure({...config,bots:0});for(let i=0;i<60;i++)server.step(1/60);
  assert.ok(Math.abs(server.snapshot().specialCooldown-19)<1e-7);assert.equal(server.snapshot().locusts.length,0);
  const client=new ArenaClient();client.accept(server.packet(),1);client.frame(0,[],1);assert.equal(client.action('special',undefined,1),false);
  for(let i=0;i<1141;i++)server.step(1/60);
  assert.equal(server.snapshot().specialCooldown,0);assert.equal(server.snapshot().locusts.length,0);
  client.accept(server.packet(),21);client.frame(0,[],21);assert.equal(client.action('special',undefined,21),true);
});
