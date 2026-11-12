import test from 'node:test';
import assert from 'node:assert/strict';
import {createBattle,tickBattle,somersaultBattle,blocked,arenas} from './combat.js';
import {ArenaCore,ArenaClient} from './arena-core.js';
import {useSpecial} from './special-abilities.js';
import {decodeBinarySnapshot} from './binary-wire.js';

for(const engine of ['JavaScript','Rust'])test(`${engine}: healing starts at t=0, repeats every second and stops at six hearts`,()=>{
  const world=createBattle(12);Object.assign(world,{phase:'racing',human:true,wx:-65,wz:0,health:3,supplies:[]});for(const a of world.bots)Object.assign(a,{inactive:true,destroyed:999});
  const core=engine==='Rust'?new ArenaCore(world):null,read=()=>core?core.snapshot():world,step=()=>core?core.step(.05):tickBattle(world,new Set(),.05);
  if(core)core.step(0,[{actor:0,actions:[{type:'special'}]}]);if(!core)useSpecial(world);assert.equal(read().health,4);assert.equal(read().effects.filter(f=>f.type==='heartbeat').length,1);
  for(let i=0;i<19;i++)step();assert.equal(read().health,4);step();assert.equal(read().health,5);assert.equal(read().effects.filter(f=>f.type==='heartbeat').length,1);
  for(let i=0;i<20;i++)step();assert.equal(read().health,6);assert.equal(read().specialActive,0);
  for(let i=0;i<20;i++)step();assert.equal(read().health,6);assert.equal(read().specialActive,0);
  for(let i=0;i<20;i++)step();assert.equal(read().health,6);assert.equal(read().effects.filter(f=>f.type==='heartbeat').length,0);
});

for(const engine of ['JavaScript','Rust'])test(`${engine}: bots keep their AI and resume driving after relativity`,()=>{
  const world=createBattle(8);Object.assign(world,{phase:'racing',human:true,wx:65,wz:70,supplies:[]});
  for(const a of world.bots)Object.assign(a,{inactive:true,destroyed:999});Object.assign(world.bots[0],{inactive:false,destroyed:0,human:false,wx:65,wz:0,heading:0,motionHeading:0,speed:0});
  const core=engine==='Rust'?new ArenaCore(world):null,step=()=>core?core.step(1/60):tickBattle(world,new Set(),1/60),read=()=>core?core.snapshot():world;
  if(core)core.step(0,[{actor:0,actions:[{type:'special'}]}]);if(!core)useSpecial(world);
  for(let i=0;i<155;i++)step();const after=read();assert.equal(after.bots[0].human,false);const z=after.bots[0].wz;
  for(let i=0;i<60;i++)step();assert.ok(read().bots[0].wz>z+1);
});

for(const engine of ['JavaScript','Rust'])for(const driver of [11,12])test(`${engine}: driver ${driver} starts inactive and must recharge for twenty seconds`,()=>{
  const world=createBattle(driver);Object.assign(world,{phase:'racing',human:true,wx:-65,wz:0,health:3,supplies:[]});for(const a of world.bots)Object.assign(a,{inactive:true,destroyed:999});
  const core=engine==='Rust'?new ArenaCore(world):null,read=()=>core?core.snapshot():world;
  const step=dt=>core?core.step(dt):tickBattle(world,new Set(),dt),activate=()=>core?core.step(0,[{actor:0,actions:[{type:'special'}]}]):useSpecial(world);
  step(.05);assert.equal(read().specialActive??0,0);assert.equal(read().health,3);
  activate();assert.equal(read().specialCooldown,20);assert.equal(read().specialActive,driver===11?8:5);assert.equal(read().health,driver===12?4:3);
  for(let i=0;i<200;i++)step(.05);assert.equal(read().specialActive,0);assert.ok(read().specialCooldown>9.9);activate();assert.equal(read().specialActive,0);
  for(let i=0;i<201;i++)step(.05);assert.equal(read().specialCooldown,0);
  if(driver===11){activate();assert.equal(read().specialActive,8);}
});

for(const engine of ['JavaScript','Rust']){
  test(`${engine}: Catheterpillar heals to six hearts on activation only with abilities enabled`,()=>{
    for(const enabled of [true,false]){
      const world=createBattle(12);Object.assign(world,{phase:'racing',human:true,wx:-65,wz:0,health:3,specialAbilities:enabled,supplies:[]});
      for(const a of world.bots)Object.assign(a,{inactive:true,destroyed:999});
      const core=engine==='Rust'?new ArenaCore(world):null;
      assert.equal((core?core.snapshot():world).health,3);if(core)core.step(0,[{actor:0,actions:[{type:"special"}]}]);if(!core)useSpecial(world);
      for(let i=0;i<721;i++){if(core)core.step(1/60);if(!core)tickBattle(world,new Set(),1/60);}
      assert.equal((core?core.snapshot():world).health,enabled?6:3);
    }
  });
  test(`${engine}: Yuda's three-second smoke trail makes others dizzy, never its owner`,()=>{
    for(const enabled of [true,false]){
      const world=createBattle(10);Object.assign(world,{phase:'racing',human:true,wx:-65,wz:0,heading:0,boost:1,specialAbilities:enabled,supplies:[]});
      for(const a of world.bots)Object.assign(a,{inactive:true,destroyed:999});
      Object.assign(world.bots[0],{inactive:false,destroyed:0,human:true,wx:-65,wz:-5});
      const core=engine==='Rust'?new ArenaCore(world):null;
      if(core)core.step(1/60);if(!core)tickBattle(world,new Set(),1/60);
      const after=core?core.snapshot():world;
      assert.equal(after.dizzy,0);assert.ok(enabled?after.bots[0].dizzy>7.9:after.bots[0].dizzy===0);
    }
  });
  test(`${engine}: R-yeah's Providence returns a locked missile without needing books`,()=>{
    for(const enabled of [true,false]){
      const world=createBattle(11);Object.assign(world,{phase:'racing',human:true,wx:65,wz:80,specialAbilities:enabled,supplies:[]});
      for(const a of world.bots)Object.assign(a,{inactive:true,destroyed:999});Object.assign(world.bots[0],{inactive:false,destroyed:0,human:true,wx:65,wz:40});
      world.projectiles=[{id:1,owner:1,target:0,kind:'missile',wx:65,wz:60,heading:0,speed:70,height:1.3,vy:0,life:3,age:0,trail:[]}];
      const core=engine==='Rust'?new ArenaCore(world):null;
      assert.equal((core?core.snapshot():world).specialActive??0,0);if(core)core.step(0,[{actor:0,actions:[{type:"special"}]}]);if(!core){useSpecial(world);tickBattle(world,new Set(),0);}
      const after=core?core.snapshot():world;assert.equal(after.tehilim,0);assert.equal(after.projectiles[0].target,enabled?1:0);assert.equal(after.projectiles[0].owner,enabled?0:1);
    }
  });
  test(`${engine}: relativity slows opponents and their shots for 2.5 seconds, then movement resumes`,()=>{
    const world=createBattle(8);Object.assign(world,{phase:'racing',human:true,wx:65,wz:70,supplies:[]});
    for(const a of world.bots)Object.assign(a,{inactive:true,destroyed:999});Object.assign(world.bots[0],{inactive:false,destroyed:0,human:true,wx:-65,wz:0,heading:0,speed:100});
    world.projectiles=[{id:1,kind:'hedgehog',owner:1,wx:-65,wz:20,heading:0,speed:90,height:1.3,vy:0,life:2,age:0,trail:[]}];
    const core=engine==='Rust'?new ArenaCore(world):null;
    if(core)core.step(0,[{actor:0,actions:[{type:'special'}]}]);if(!core)assert.equal(useSpecial(world),true);
    for(let i=0;i<149;i++){if(core)core.step(1/60,[{actor:0,keys:['arrowup']},{actor:1,keys:['arrowup']}]);if(!core)tickBattle(world,new Set(['arrowup']),1/60,new Map([[0,new Set(['arrowup'])],[1,new Set(['arrowup'])]]));}
    const stopped=core?core.snapshot():world;assert.ok(Math.abs(stopped.bots[0].wz)<2);assert.ok(stopped.projectiles[0].wz>25&&stopped.projectiles[0].wz<26);assert.ok(stopped.projectiles[0].life>1.93);assert.notEqual(stopped.wz,70);assert.ok(stopped.specialCooldown>17);
    for(let i=0;i<3;i++){if(core)core.step(1/60,[{actor:1,keys:['arrowup']}]);if(!core)tickBattle(world,new Set(),1/60,new Map([[1,new Set(['arrowup'])]]));}
    const resumed=core?core.snapshot():world;assert.notEqual(resumed.bots[0].wz,0);assert.ok(resumed.projectiles[0].wz>20);
    if(core)core.step(0,[{actor:0,actions:[{type:'special'}]}]);if(!core)assert.equal(useSpecial(world),false);assert.equal((core?core.snapshot():world).timeStop,0);
  });
}
test('room abilities default on, replicate to guests, and switching off releases a time stop',()=>{
  const config={code:'22',host:0,arena:0,bots:0,epoch:1,players:[{id:0,name:'Worm',driver:8,role:'driver'},{id:1,name:'Lion',driver:11,role:'driver'}]};
  const core=ArenaCore.room(config);assert.equal(decodeBinarySnapshot(core.packet(1)).specialAbilities,true);
  core.start();for(let i=0;i<181;i++)core.step(1/60);core.step(0,[{actor:0,actions:[{type:'special'}]}]);assert.equal(core.snapshot().timeStop,2.5);
  core.configure({...config,specialAbilities:false});assert.equal(core.snapshot().timeStop,0);assert.equal(decodeBinarySnapshot(core.packet(1)).specialAbilities,false);
  core.step(0,[{actor:0,actions:[{type:'special'}]}]);assert.equal(core.snapshot().timeStop,0);
});
test('a slowed guest consumes movement sequences without moving and resumes without a backlog jump',()=>{
  const world=createBattle(8);Object.assign(world,{phase:'racing',human:true,wx:65,wz:70,timeStop:2.5,timeOwner:0,supplies:[]});
  for(const a of world.bots)Object.assign(a,{inactive:true,destroyed:999});Object.assign(world.bots[0],{inactive:false,destroyed:0,human:true,wx:-65,wz:0,heading:0});
  const core=new ArenaCore(world),client=new ArenaClient();client.accept(core.packet(1),0);
  for(let i=0;i<20;i++)client.frame(1/60,new Set(['arrowup']),i/60);
  assert.ok(Math.abs(client.snapshot().wz)<.1);
  core.step(1/60,[{actor:1,moves:[{sequence:0,keys:['arrowup']},{sequence:1,keys:['arrowup']}]}]);
  assert.ok(Math.abs(core.snapshot(1).wz)<.1);assert.equal(decodeBinarySnapshot(core.packet(1)).movementSequence,1);
});

for(const engine of ['JavaScript','Rust'])test(engine+': Tammy teleports on a somersault only when abilities are enabled',()=>{for(const enabled of [true,false]){const w=createBattle(5);Object.assign(w,{phase:'racing',specialAbilities:enabled,wx:65,wz:70});const core=engine==='Rust'?new ArenaCore(w):null;if(core)core.step(0,[{actor:0,actions:[{type:'somersault'}]}]);if(!core)somersaultBattle(w);const a=core?core.snapshot():w;assert.equal(a.somersault,.55);assert.equal(a.wx===65&&a.wz===70,!enabled);assert.equal(blocked(arenas[0],a.wx,a.wz,4),false);}});
