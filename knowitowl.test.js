import test from 'node:test';
import assert from 'node:assert/strict';
import {createBattle,tickBattle} from './combat.js';
import {ArenaCore} from './arena-core.js';
import {useSpecial} from './special-abilities.js';
import {darkHumorState} from './dark-humor.js';
for(const engine of ['JavaScript','Rust']){
  test(`${engine}: Dark Humor lasts seven seconds, gives its caster X-ray vision and recharges for twenty`,()=>{
    const world=createBattle(14);Object.assign(world,{phase:'racing',human:true,supplies:[]});for(const a of world.bots)Object.assign(a,{inactive:true,destroyed:999});
    const core=engine==='Rust'?new ArenaCore(world):null,read=()=>core?core.snapshot():world,activate=()=>core?core.step(0,[{actor:0,actions:[{type:'special'}]}]):useSpecial(world);
    activate();assert.equal(read().specialActive,7);assert.equal(read().specialCooldown,20);
    for(let i=0;i<20;i++){if(core)core.step(.05);if(!core)tickBattle(world,new Set(),.05);}
    assert.equal(darkHumorState(read()).strength,1);assert.equal(darkHumorState(read()).xray,true);
    activate();assert.ok(read().specialActive<6.01);
    for(let i=0;i<121;i++){if(core)core.step(.05);if(!core)tickBattle(world,new Set(),.05);}
    assert.equal(read().specialActive,0);assert.equal(darkHumorState(read()).strength,0);assert.equal(darkHumorState(read()).xray,false);assert.ok(read().specialCooldown>12.9);
  });
  test(`${engine}: host disabling abilities prevents Dark Humor`,()=>{
    const world=createBattle(14);Object.assign(world,{phase:'racing',human:true,specialAbilities:false});
    const core=engine==='Rust'?new ArenaCore(world):null;if(core)core.step(0,[{actor:0,actions:[{type:'special'}]}]);if(!core)useSpecial(world);
    const after=core?core.snapshot():world;assert.equal(after.specialActive??0,0);assert.equal(after.specialCooldown??0,0);
  });
}
test('Dark Humor hides opponents without giving another owl the caster’s X-ray vision',()=>{
  const world=createBattle(14);Object.assign(world,{phase:'racing',specialActive:0});for(const a of world.bots)Object.assign(a,{specialActive:0});
  Object.assign(world.bots[0],{driver:14,specialActive:5});assert.equal(darkHumorState(world).strength,1);assert.equal(darkHumorState(world).xray,false);
  world.specialActive=3;assert.equal(darkHumorState(world).xray,true);
  world.specialAbilities=false;assert.equal(darkHumorState(world).strength,0);assert.equal(darkHumorState(world).xray,false);
});
