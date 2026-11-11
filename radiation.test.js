import test from 'node:test';
import assert from 'node:assert/strict';
import {createBattle,tickBattle,equipBomber} from './combat.js';
import {ArenaCore,ArenaClient} from './arena-core.js';

for(const engine of ['solo','Rust']){
  test(`${engine}: radiation hits on entry, then every second rather than every frame`,()=>{
    const seed=createBattle();Object.assign(seed,{phase:'racing',human:true,wx:-65,wz:0,health:6,shield:0,speed:0,supplies:[],effects:[{type:'radiation',owner:1,wx:-65,wz:0,age:0,life:8,doses:{}}]});
    for(const bot of seed.bots)Object.assign(bot,{inactive:true,destroyed:1e9});equipBomber(seed.bots[0]);seed.bots[0].inactive=false;
    const core=engine==='Rust'?new ArenaCore(seed):null,step=()=>core?core.step(1/60):tickBattle(seed,new Set(),1/60),read=()=>core?core.snapshot():seed;
    step();assert.equal(read().health,5);
    for(let i=0;i<59;i++)step();assert.equal(read().health,5);
    step();assert.equal(read().health,4);
    for(let i=0;i<59;i++)step();assert.equal(read().health,4);
    step();assert.equal(read().health,3);assert.equal(read().bots[0].kills,0);
  });

  test(`${engine}: radiation covers radius 28, respects shields, and expires after eight seconds`,()=>{
    for(const [distance,shield,hedgeShield,health]of [[28,0,0,5],[28.01,0,0,6],[0,1,0,6],[0,0,1,6]]){
      const seed=createBattle();Object.assign(seed,{phase:'racing',human:true,wx:-65,wz:distance,health:6,shield,hedgeShield,speed:0,supplies:[],effects:[{type:'radiation',owner:1,wx:-65,wz:0,age:0,life:8,doses:{}}]});for(const bot of seed.bots)Object.assign(bot,{inactive:true,destroyed:1e9});
      const core=engine==='Rust'?new ArenaCore(seed):null;if(core)core.step(1/60);if(!core)tickBattle(seed,new Set(),1/60);assert.equal((core?core.snapshot():seed).health,health);
    }
    const seed=createBattle();Object.assign(seed,{phase:'racing',human:true,wx:-65,wz:0,health:6,shield:99,supplies:[],effects:[{type:'radiation',owner:1,wx:-65,wz:0,age:0,life:8,doses:{}}]});for(const bot of seed.bots)Object.assign(bot,{inactive:true,destroyed:1e9});
    const core=engine==='Rust'?new ArenaCore(seed):null,step=()=>core?core.step(1/60):tickBattle(seed,new Set(),1/60),read=()=>core?core.snapshot():seed;
    for(let i=0;i<479;i++)step();assert.ok(read().effects.some(f=>f.type==='radiation'));
    step();step();assert.equal(read().effects.some(f=>f.type==='radiation'),false);assert.equal(read().health,6);
  });

  test(`${engine}: entering again starts a fresh immediate dose`,()=>{
    const seed=createBattle();Object.assign(seed,{phase:'racing',human:true,wx:-65,wz:29,health:6,shield:0,speed:0,supplies:[],effects:[{type:'radiation',owner:1,wx:-65,wz:0,age:.1,life:8,doses:{0:.5}}]});for(const bot of seed.bots)Object.assign(bot,{inactive:true,destroyed:1e9});
    const core=engine==='Rust'?new ArenaCore(seed):null;if(core)core.step(1/60);if(!core)tickBattle(seed,new Set(),1/60);
    const outside=core?core.snapshot():seed;assert.equal(outside.health,6);outside.wz=0;
    const resumed=core?new ArenaCore({...outside,bots:seed.bots}):null;if(resumed)resumed.step(1/60);if(!resumed)tickBattle(outside,new Set(),1/60);assert.equal((resumed?resumed.snapshot():outside).health,5);
  });

  test(`${engine}: a radiation kill credits its bomber and leaves ash`,()=>{
    const seed=createBattle();Object.assign(seed,{phase:'racing',human:true,wx:-65,wz:0,health:1,shield:0,speed:0,supplies:[],effects:[{type:'radiation',owner:2,wx:-65,wz:0,age:0,life:8,doses:{}}]});for(const bot of seed.bots)Object.assign(bot,{inactive:true,destroyed:1e9});equipBomber(seed.bots[1]);seed.bots[1].inactive=false;
    const core=engine==='Rust'?new ArenaCore(seed):null;if(core)core.step(1/60);if(!core)tickBattle(seed,new Set(),1/60);
    const after=core?core.snapshot():seed;assert.equal(after.health,0);assert.equal(after.deaths,1);assert.equal(after.bots.find(b=>b.id===2).kills,1);assert.ok(after.effects.some(f=>f.type==='ash'));
    if(core){const peer=new ArenaClient();peer.accept(core.packet(2),0);peer.frame(0,[],0);const zone=peer.present().effects.find(f=>f.type==='radiation');assert.equal(zone.owner,2);assert.equal(zone.radius,28);assert.equal(zone.life,8);}
  });
}
