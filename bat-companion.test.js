import test from 'node:test';
import assert from 'node:assert/strict';
import {createBattle,tickBattle,fireBattle} from './combat.js';
import {ArenaCore,ArenaClient} from './arena-core.js';
for(const engine of ['JavaScript','Rust']){
  test(`${engine}: BatYouDidn'tKnow fires behind the owl without input and credits its Uzi kill to the owl`,()=>{
    const w=createBattle(14);Object.assign(w,{phase:'racing',human:true,wx:65,wz:0,heading:0,ammo:5,vulcan:2,fireCooldown:0,supplies:[]});for(const a of w.bots)Object.assign(a,{inactive:true,destroyed:999});Object.assign(w.bots[0],{human:true,inactive:false,destroyed:0,wx:65,wz:-30,heading:0,speed:0,health:3});
    const core=engine==='Rust'?new ArenaCore(w):null,step=dt=>core?core.step(dt):tickBattle(w,new Set(),dt),read=()=>core?core.snapshot():w;
    step(0);const after=read(),shot=after.projectiles[0];assert.equal(after.projectiles.length,1);assert.equal(shot.owner,0);assert.equal(shot.target,1);assert.equal(shot.vulcan,true);assert.equal(shot.speed,125);assert.ok(shot.heading< -2.5);assert.ok(shot.wx>68);assert.equal(after.ammo,5);
    for(let i=0;i<45;i++)step(1/60);assert.equal(read().kills,1);assert.equal(read().bots[0].deaths,1);assert.equal(read().ammo,5);
  });
  test(`${engine}: bat Uzi fires every 150ms at half the Vulcan rate while the owl launches a missile`,()=>{
    const w=createBattle(14);Object.assign(w,{phase:'racing',human:true,wx:65,wz:0,heading:0,ammo:5,missiles:2,item:'missile',vulcan:2,fireCooldown:0,supplies:[]});for(const a of w.bots)Object.assign(a,{inactive:true,destroyed:999});Object.assign(w.bots[0],{human:true,inactive:false,destroyed:0,wx:65,wz:-60,health:6});
    const core=engine==='Rust'?new ArenaCore(w):null,step=dt=>core?core.step(dt):tickBattle(w,new Set(),dt),read=()=>core?core.snapshot():w;
    step(0);if(core)core.step(0,[{actor:0,actions:[{type:'fire'}]}]);if(!core)fireBattle(w);assert.equal(read().projectiles.filter(s=>s.kind==='missile').length,1);assert.equal(read().missiles,1);
    step(.05);step(.05);assert.equal(read().projectiles.filter(s=>s.vulcan).length,1);step(.05);assert.equal(read().projectiles.filter(s=>s.vulcan).length,2);assert.ok(read().fireCooldown>.7);assert.equal(read().ammo,5);
  });
  for(const scenario of [
    {name:'a wall blocking the target',x:-30,z:0,enemyX:30,enemyZ:0,vulcan:2,afk:false,destroyed:0,warp:0},
    {name:'a target beyond 100 units',x:65,z:50,enemyX:65,enemyZ:-60,vulcan:2,afk:false,destroyed:0,warp:0},
    {name:'expired Vulcan',x:65,z:0,enemyX:65,enemyZ:-30,vulcan:.01,afk:false,destroyed:0,warp:0},
    {name:'AFK owl',x:65,z:0,enemyX:65,enemyZ:-30,vulcan:2,afk:true,destroyed:0,warp:0},
    {name:'destroyed owl',x:65,z:0,enemyX:65,enemyZ:-30,vulcan:2,afk:false,destroyed:2,warp:0},
    {name:'enemy time warp',x:65,z:0,enemyX:65,enemyZ:-30,vulcan:2,afk:false,destroyed:0,warp:1},
  ])test(`${engine}: bat does not fire with ${scenario.name}`,()=>{
    const w=createBattle(14);Object.assign(w,{phase:'racing',human:true,wx:scenario.x,wz:scenario.z,vulcan:scenario.vulcan,afk:scenario.afk,destroyed:scenario.destroyed,timeStop:scenario.warp,timeOwner:1,supplies:[]});for(const a of w.bots)Object.assign(a,{inactive:true,destroyed:999});Object.assign(w.bots[0],{human:true,inactive:false,destroyed:0,wx:scenario.enemyX,wz:scenario.enemyZ,health:6});
    const core=engine==='Rust'?new ArenaCore(w):null;if(core)core.step(.02);if(!core)tickBattle(w,new Set(),.02);assert.equal((core?core.snapshot():w).projectiles.length,0);
  });
}
test('local fire feedback creates no phantom owl Vulcan shot while the bat fires authoritatively',()=>{
  const w=createBattle(14);Object.assign(w,{phase:'racing',human:true,multiplayer:true,wx:65,wz:0,heading:0,motionHeading:0,vulcan:2,fireCooldown:0,supplies:[]});for(const a of w.bots)Object.assign(a,{inactive:true,destroyed:999});Object.assign(w.bots[0],{human:true,inactive:false,destroyed:0,wx:65,wz:-30});
  const server=new ArenaCore(w),client=new ArenaClient();client.accept(server.packet(),0);client.frame(0,[],0);assert.equal(client.action('fire',undefined,0),false);assert.equal(client.present().projectiles.length,0);
  server.step(0);client.accept(server.packet(),.01);client.frame(0,[],.01);assert.equal(client.present().projectiles.length,1);assert.equal(client.present().projectiles[0].owner,0);assert.ok(client.present().projectiles[0].wx>68);
});

for(const engine of ['JavaScript','Rust'])for(const [driver,shots]of [[0,12],[14,6]])test(`${engine}: driver ${driver} fires ${shots} shots in one second`,()=>{
  const w=createBattle(driver);Object.assign(w,{phase:'racing',human:true,wx:65,wz:0,heading:0,vulcan:2,ammo:5,fireCooldown:0,supplies:[]});for(const a of w.bots)Object.assign(a,{inactive:true,destroyed:999});Object.assign(w.bots[0],{human:true,inactive:false,destroyed:0,wx:65,wz:-60,health:100});
  const core=engine==='Rust'?new ArenaCore(w):null;
  for(let i=0;i<60;i++){if(core)core.step(1/60,[{actor:0,keys:driver===0?[' ']:[]}]);if(!core)tickBattle(w,new Set(driver===0?[' ']:[]),1/60);}
  assert.equal((core?core.snapshot():w).projectileSequence,shots);
});
