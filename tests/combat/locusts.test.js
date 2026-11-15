import test from 'node:test';
import assert from 'node:assert/strict';
import {createBattle,tickBattle} from '../../gameplay/combat.js';
import {ArenaCore} from '../../gameplay/arena-core.js';

for(const engine of ['JavaScript','Rust']){
  for(const owner of [0,1])test(`${engine}: a lethal locust credits Tammy in slot ${owner}`,()=>{
    const world=createBattle(owner===0?5:0);Object.assign(world,{phase:'racing',human:true,wx:65,wz:0,health:1,supplies:[],locusts:[{id:1,owner,wx:65,wz:0,age:1,jump:.7}]});
    world.bots.forEach((a,i)=>Object.assign(a,{human:true,driver:owner===1&&i===0?5:0,inactive:i>0,destroyed:i>0?999:0,wx:65,wz:1,health:1,shield:0}));
    const core=engine==='Rust'?new ArenaCore(world):null;if(core)core.step(.01);else tickBattle(world,new Set(),.01);
    const state=core?core.snapshot():world,actors=[state,...state.bots];assert.equal(actors.find(a=>a.id===owner).kills,1);assert.equal(actors.find(a=>a.id===1-owner).deaths,1);assert.equal(state.killFeed[0].attacker,owner);
  });
  test(`${engine}: a locust navigates across the arena around walls before hitting`,()=>{
    const world=createBattle(5);Object.assign(world,{phase:'racing',human:true,wx:-65,wz:-60,supplies:[],locusts:[{id:1,owner:0,wx:-65,wz:0,age:1,jump:0,heading:0}]});
    world.bots.forEach((a,i)=>Object.assign(a,{human:true,inactive:i>0,destroyed:i>0?999:0,wx:65,wz:0,health:3,shield:0}));
    const core=engine==='Rust'?new ArenaCore(world):null,read=()=>core?core.snapshot():world;
    for(let i=0;i<1200&&read().locusts.length;i++){if(core)core.step(.05);else tickBattle(world,new Set(),.05);}
    assert.equal(read().locusts.length,0);assert.equal(read().bots[0].health,2);
  });
  test(`${engine}: every exploding locust deals one damage and disappears only after hitting`,()=>{
    const world=createBattle(5);Object.assign(world,{phase:'racing',human:true,wx:-65,wz:0,supplies:[],locusts:[{id:1,owner:0,wx:65,wz:0,age:1,jump:.7},{id:2,owner:0,wx:65,wz:0,age:1,jump:.7}]});
    world.bots.forEach((a,i)=>Object.assign(a,{human:true,inactive:i>0,destroyed:i>0?999:0,wx:65,wz:1,health:3,shield:0}));
    const core=engine==='Rust'?new ArenaCore(world):null;if(core)core.step(.01);else tickBattle(world,new Set(),.01);
    const state=core?core.snapshot():world;assert.equal(state.bots[0].health,1);assert.equal(state.health,3);assert.equal(state.locusts.length,0);assert.equal(state.effects.filter(e=>e.type==='locustBurst').length,2);
  });
  test(`${engine}: old locusts remain alive without a target and never hurt either Tammy`,()=>{
    const world=createBattle(5);Object.assign(world,{phase:'racing',human:true,wx:65,wz:0,supplies:[],locusts:[{id:1,owner:0,wx:65,wz:0,age:1000,jump:0}]});
    world.bots.forEach((a,i)=>Object.assign(a,{driver:5,human:true,inactive:i>0,destroyed:i>0?999:0,wx:65,wz:1,health:3}));
    const core=engine==='Rust'?new ArenaCore(world):null;
    for(let i=0;i<200;i++){if(core)core.step(.05);else tickBattle(world,new Set(),.05);}
    const state=core?core.snapshot():world;assert.equal(state.locusts.length,1);assert.equal(state.health,3);assert.equal(state.bots[0].health,3);
  });
}
