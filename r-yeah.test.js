import test from 'node:test';
import assert from 'node:assert/strict';
import {ArenaCore,ArenaClient} from './arena-core.js';
import {createBattle,tickBattle} from './combat.js';

test('R-yeah can host a room and his lion pilot reaches both players and client presentation',()=>{
  const core=ArenaCore.room({code:'12',host:0,arena:0,bots:0,epoch:1,players:[{id:0,name:'Lion King',driver:11,role:'driver'},{id:1,name:'Guest',driver:0,role:'driver'}]});
  for(const viewer of [0,1]){const client=new ArenaClient();client.accept(core.packet(viewer),0);client.frame(0,[],0);const view=client.present(),lion=viewer===0?view:view.bots.find(a=>a.id===0);assert.equal(lion.driver,11);assert.equal(lion.name,'Lion King');assert.equal(lion.health,3);assert.equal(lion.ammo,10);}
});
for(const engine of ['solo','Rust'])test(`${engine}: R-yeah's helicopter uses normal hedgehog damage and kill credit`,()=>{
  const seed=createBattle(11);Object.assign(seed,{phase:'racing',human:true,wx:-65,wz:0,heading:0,fireCooldown:0,ammo:10,supplies:[]});for(const bot of seed.bots)Object.assign(bot,{inactive:true,destroyed:999});Object.assign(seed.bots[0],{inactive:false,destroyed:0,human:true,wx:-65,wz:10,health:1});
  const core=engine==='Rust'?new ArenaCore(seed):null;
  for(let frame=0;frame<7;frame++){if(core)core.step(1/60,[{actor:0,keys:frame===0?[' ']:[]}]);if(!core)tickBattle(seed,new Set(frame===0?[' ']:[]),1/60);}
  const after=core?core.snapshot():seed;assert.equal(after.kills,1);assert.equal(after.ammo,9);assert.equal(after.bots[0].health,0);assert.ok(after.celebrate>0);
});
