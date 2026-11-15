import test from 'node:test';
import assert from 'node:assert/strict';
import {createBattle,arenas,blocked,tickBattle} from '../../gameplay/combat.js';
import {ArenaCore} from '../../gameplay/arena-core.js';
import {placeSupply} from '../../gameplay/supply-spawns.js';
function check(world){
  for(const [i,s] of world.supplies.entries()){
    assert.equal(blocked(arenas[world.arena],s.wx,s.wz,8),false);
    for(const actor of [world,...world.bots])if(!actor.inactive&&!actor.afk&&!actor.bomber&&actor.destroyed<=0)assert.ok(Math.hypot(s.wx-actor.wx,s.wz-actor.wz)>=12);
    for(const other of world.supplies.slice(i+1))assert.ok(Math.hypot(s.wx-other.wx,s.wz-other.wz)>=16);
  }
}
test('both arenas randomize initial supplies with wall, player and pickup clearance',()=>{
  for(const arena of [0,1])for(let seed=1;seed<=40;seed++)check(createBattle(0,arena,()=>seed/100));
  assert.notDeepEqual(createBattle(0,0,()=>.1).supplies,createBattle(0,0,()=>.8).supplies);
});
for(const engine of ['solo','Rust'])test(`${engine}: respawns choose clear positions and match the seeded simulation`,()=>{
  const world=createBattle(0,1,()=>.3);Object.assign(world,{phase:'racing',human:true});for(const a of world.bots)Object.assign(a,{human:true});
  for(const s of world.supplies)s.cooldown=.01;
  const before=world.supplies.map(s=>[s.wx,s.wz]);
  const core=new ArenaCore(world);tickBattle(world,new Set(),1/60);core.step(1/60);
  const result=engine==='Rust'?core.snapshot():world;check(result);
  assert.notDeepEqual(result.supplies.map(s=>[s.wx,s.wz]),before);
  for(let i=0;i<world.supplies.length;i++){assert.ok(Math.abs(core.snapshot().supplies[i].wx-world.supplies[i].wx)<1e-8);assert.ok(Math.abs(core.snapshot().supplies[i].wz-world.supplies[i].wz)<1e-8);}
});
test('crowded maps never fall back to an unsafe position',()=>{
  const world=createBattle();const original={...world.supplies[0]};
  assert.equal(placeSupply(world,{size:96,blocks:[[0,0,400,400]]},0),false);
  assert.deepEqual(world.supplies[0],original);
});
test('native rooms randomize supplies using their room seed',()=>{
  const snapshots=[1,2].map(seed=>{const core=ArenaCore.room({code:'00',host:null,dedicated:true,maxPlayers:8,arena:0,bots:1,players:[{id:0,name:'Player',driver:0,role:'driver'}],epoch:1,seed});return core.snapshot();});
  for(const world of snapshots)check(world);
  assert.notDeepEqual(snapshots[0].supplies.map(s=>[s.wx,s.wz]),snapshots[1].supplies.map(s=>[s.wx,s.wz]));
});
for(const engine of ['solo','Rust'])test(`${engine}: delayed rare pickups avoid a player camping their old position`,()=>{
  const world=createBattle(0,0,()=>.6),rare=world.supplies.find(s=>s.kind==='hedgeproof');
  Object.assign(world,{phase:'racing',human:true,wx:rare.wx,wz:rare.wz});
  for(const bot of world.bots)Object.assign(bot,{inactive:true,destroyed:999});
  rare.cooldown=.01;
  const core=engine==='Rust'?new ArenaCore(world):null;
  if(core)core.step(1/60);else tickBattle(world,new Set(),1/60);
  const result=core?core.snapshot():world,spawn=result.supplies.find(s=>s.kind==='hedgeproof');
  assert.equal(spawn.cooldown,0);assert.ok(Math.hypot(spawn.wx-result.wx,spawn.wz-result.wz)>=12);assert.equal(result.hedgeShield,0);
});
