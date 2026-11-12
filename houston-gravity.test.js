import test from 'node:test';
import assert from 'node:assert/strict';
import {createBattle,tickBattle} from './combat.js';
import {useSpecial} from './special-abilities.js';
import {ArenaCore} from './arena-core.js';
for(const engine of ['JavaScript','Rust']){
  test(`${engine}: Houston attracts ready power-ups within 80 units and collected supplies respawn at home`,()=>{
    const w=createBattle(7);Object.assign(w,{phase:'racing',human:true,wx:-65,wz:0,missiles:0,supplies:[{id:0,kind:'missile',wx:-65,wz:80,cooldown:0,version:0},{id:1,kind:'boost',wx:-65,wz:81,cooldown:0,version:0},{id:2,kind:'tehilim',wx:-65,wz:55,cooldown:30,version:0}]});for(const a of w.bots)Object.assign(a,{inactive:true,destroyed:999});
    const core=engine==='Rust'?new ArenaCore(w):null,read=()=>core?core.snapshot():w,step=()=>core?core.step(.05):tickBattle(w,new Set(),.05);
    if(core)core.step(0,[{actor:0,actions:[{type:'special'}]}]);if(!core)useSpecial(w);assert.equal(read().specialActive,8);assert.equal(read().specialCooldown,20);
    step();assert.equal(read().supplies[0].wz,77.25);assert.equal(read().supplies[1].wz,81);assert.equal(read().supplies[2].wz,55);
    for(let i=0;i<30;i++)step();assert.equal(read().missiles,1);assert.equal(read().supplies[0].wz,80);assert.ok(read().supplies[0].cooldown>7);
  });
  test(`${engine}: uncollected power-ups return home when Houston's ability expires`,()=>{
    const w=createBattle(7);Object.assign(w,{phase:'racing',human:true,wx:-65,wz:0,health:6,supplies:[{id:0,kind:'health',wx:-65,wz:20,cooldown:0,version:0}]});for(const a of w.bots)Object.assign(a,{inactive:true,destroyed:999});
    const core=engine==='Rust'?new ArenaCore(w):null,read=()=>core?core.snapshot():w,step=()=>core?core.step(.05):tickBattle(w,new Set(),.05);
    if(core)core.step(0,[{actor:0,actions:[{type:'special'}]}]);if(!core)useSpecial(w);for(let i=0;i<20;i++)step();assert.equal(read().supplies[0].wz,0);for(let i=0;i<141;i++)step();assert.equal(read().supplies[0].wz,20);assert.equal(read().health,6);
  });
  test(`${engine}: the nearest active Houston attracts a shared pickup with a stable tie-break`,()=>{
    const w=createBattle(7);Object.assign(w,{phase:'racing',human:true,wx:-20,wz:65,specialActive:8,supplies:[{id:0,kind:'missile',wx:0,wz:65,cooldown:0,version:0}]});for(const a of w.bots)Object.assign(a,{inactive:true,destroyed:999});Object.assign(w.bots[0],{driver:7,human:true,inactive:false,destroyed:0,wx:20,wz:65,specialActive:8});
    const core=engine==='Rust'?new ArenaCore(w):null;if(core)core.step(.05);if(!core)tickBattle(w,new Set(),.05);assert.equal((core?core.snapshot():w).supplies[0].wx,-2.75);
  });
  test(`${engine}: disabled abilities prevent Houston's tractor field`,()=>{
    const w=createBattle(7);Object.assign(w,{phase:'racing',human:true,specialAbilities:false,wx:-65,wz:0,supplies:[{id:0,kind:'missile',wx:-65,wz:20,cooldown:0,version:0}]});for(const a of w.bots)Object.assign(a,{inactive:true,destroyed:999});
    const core=engine==='Rust'?new ArenaCore(w):null;if(core)core.step(.05,[{actor:0,actions:[{type:'special'}]}]);if(!core){assert.equal(useSpecial(w),false);tickBattle(w,new Set(),.05);}assert.equal((core?core.snapshot():w).supplies[0].wz,20);
  });
}
