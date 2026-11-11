import test from 'node:test';
import assert from 'node:assert/strict';
import {createBattle,tickBattle} from './combat.js';
import {ArenaCore} from './arena-core.js';

for(const engine of ['solo','Rust multiplayer']){
  test(`${engine}: Pearococo's ballet pumps keep Vulcan damage, ammunition and kill celebration`,()=>{
    const seed=createBattle(9);Object.assign(seed,{phase:'racing',human:true,wx:-65,wz:0,heading:0,motionHeading:0,cameraHeading:0,vulcan:8,item:'hedgehog',fireCooldown:0,ammo:10,supplies:[]});
    Object.assign(seed.bots[0],{human:true,wx:-65,wz:12,speed:0,health:2,shield:0});for(const bot of seed.bots.slice(1))Object.assign(bot,{inactive:true,destroyed:1e9});
    const core=engine==='solo'?null:new ArenaCore(seed),step=()=>core?core.step(1/60,[{actor:0,keys:[' ']}]):tickBattle(seed,new Set([' ']),1/60),read=()=>core?core.snapshot():seed;
    for(let tick=0;tick<3;tick++)step();
    assert.equal(read().bots[0].health,1);assert.equal(read().kills,0);assert.equal(read().ammo,10);
    for(let tick=0;tick<5;tick++)step();
    assert.equal(read().bots[0].health,0);assert.equal(read().kills,1);assert.ok(read().celebrate>1.5);assert.equal(read().ammo,10);assert.equal(read().missiles,1);
  });
}
