import test from 'node:test';
import assert from 'node:assert/strict';
import {createBattle,tickBattle,fireBattle,damageBattle} from '../../gameplay/combat.js';
import {ArenaCore,ArenaClient} from '../../gameplay/arena-core.js';
import {bicyclePose,bicycleLanding} from '../../gameplay/bicycle-pickup.js';
import {actorIntelligence,itemCapacity} from '../../gameplay/engine.js';

for(const engine of ['JavaScript','Rust']){
  test(`${engine}: each owl takeoff leaves one bicycle and a later takeoff leaves another`,()=>{
    const w=createBattle(14);Object.assign(w,{phase:'racing',human:true,wx:65,wz:0,heading:0,boost:3,supplies:[]});for(const a of w.bots)Object.assign(a,{inactive:true,destroyed:999});
    let core=engine==='Rust'?new ArenaCore(w):null;const step=dt=>core?core.step(dt):tickBattle(w,new Set(),dt),read=()=>core?core.snapshot():w;
    step(0);const bike=read().supplies[0];assert.equal(read().supplies.length,1);assert.equal(bike.kind,'bicycle');assert.equal(bike.owner,0);assert.equal(bike.dropWx,65);assert.equal(bike.dropWz,0);assert.equal(bike.wx,65);assert.equal(bike.wz,7);
    for(let i=0;i<80;i++)step(.05);assert.equal(read().supplies.length,1);assert.ok(read().supplies[0].age>3);assert.equal(read().supplies[0].cooldown,0);
    if(core){const next=core.snapshot();next.bots=w.bots.map(a=>next.bots.find(b=>b.id===a.id)??a);next.boost=2;core=new ArenaCore(next);}if(!core)w.boost=2;
    step(0);assert.equal(read().supplies.length,2);assert.equal(new Set(read().supplies.map(s=>s.id)).size,2);
  });
  test(`${engine}: an uncollected bicycle expires after three seconds on the floor`,()=>{
    const w=createBattle(0);Object.assign(w,{phase:'racing',human:true,wx:65,wz:-30,supplies:[{id:1001,kind:'bicycle',owner:1,heading:0,dropWx:65,dropWz:-7,wx:65,wz:0,age:1.2,cooldown:0,version:0}]});for(const a of w.bots)Object.assign(a,{inactive:true,destroyed:999});
    const core=engine==='Rust'?new ArenaCore(w):null,step=dt=>core?core.step(dt):tickBattle(w,new Set(),dt),read=()=>core?core.snapshot():w;
    for(let i=0;i<59;i++)step(.05);assert.equal(read().supplies.length,1);assert.equal(read().intelligenceBonus,0);
    step(.05);assert.equal(read().supplies.length,0);assert.equal(read().intelligenceBonus,0);
  });
  test(`${engine}: a bicycle grants one intelligence after landing and never respawns`,()=>{
    const w=createBattle(0);Object.assign(w,{phase:'racing',human:true,wx:65,wz:0,heading:0,vulcan:0,supplies:[{id:1001,kind:'bicycle',owner:1,heading:0,dropWx:65,dropWz:-7,wx:65,wz:0,age:1.1,cooldown:0,version:0}]});for(const a of w.bots)Object.assign(a,{inactive:true,destroyed:999});
    const core=engine==='Rust'?new ArenaCore(w):null,step=dt=>core?core.step(dt):tickBattle(w,new Set(),dt),read=()=>core?core.snapshot():w;
    step(0);assert.equal(read().intelligenceBonus,0);assert.equal(read().supplies.length,1);
    for(let i=0;i<3;i++)step(.05);assert.equal(actorIntelligence(read()),4);assert.equal(read().supplies.length,0);assert.equal(read().vulcan,0);assert.equal(read().ammo,10);
    for(let i=0;i<180;i++)step(.05);assert.equal(actorIntelligence(read()),4);assert.equal(read().supplies.length,0);
  });
  for(const scenario of [{bikes:1,intelligence:6,hedgehogs:20,missiles:7,turbos:7},{bikes:2,intelligence:7,hedgehogs:22,missiles:8,turbos:8}])test(`${engine}: ${scenario.bikes} bicycles raise intelligence above five and actually increase every carrying limit`,()=>{
    const w=createBattle(1);Object.assign(w,{phase:'racing',human:true,wx:65,wz:0,heading:0,ammo:18,missiles:6,turbos:6,vulcan:2,item:'hedgehog',fireCooldown:0,supplies:[...Array.from({length:scenario.bikes},(_,i)=>({id:1001+i,kind:'bicycle',owner:1,age:1.2,wx:65,wz:0,cooldown:0,version:0})),...['hedgehog','missile','missile','missile','boost','boost','boost'].map((kind,i)=>({id:i,kind,wx:65,wz:0,cooldown:0,version:0}))]});for(const a of w.bots)Object.assign(a,{inactive:true,destroyed:999});Object.assign(w.bots[0],{inactive:false,human:true,destroyed:0,wx:65,wz:-60,health:100});
    const core=engine==='Rust'?new ArenaCore(w):null,read=()=>core?core.snapshot():w;
    if(core)core.step(0);if(!core)tickBattle(w,new Set(),0);
    assert.equal(actorIntelligence(read()),scenario.intelligence);assert.equal(read().ammo,scenario.hedgehogs);assert.equal(read().missiles,scenario.missiles);assert.equal(read().turbos,scenario.turbos);assert.equal(read().projectiles.length,0);
    assert.equal(itemCapacity(read(),'abomb'),scenario.missiles);assert.equal(itemCapacity(read(),'stink'),scenario.missiles);
    if(core)core.step(0,[{actor:0,actions:[{type:'fire'}]}]);if(!core)fireBattle(w);assert.equal(read().projectiles.length,1);assert.equal(read().projectiles[0].vulcan,true);
  });
  test(`${engine}: intelligence and carrying limits persist through death and respawn`,()=>{
    const w=createBattle(1);Object.assign(w,{phase:'racing',human:true,wx:65,wz:0,intelligenceBonus:4,health:1,ammo:10,missiles:0,turbos:0,chaff:0,supplies:[]});for(const a of w.bots)Object.assign(a,{inactive:true,destroyed:999});Object.assign(w.bots[0],{driver:13,human:true,inactive:false,destroyed:0,wx:65,wz:-30,ammo:0,missiles:0,turbos:0,chaff:0,specialCooldown:0});
    const core=engine==='Rust'?new ArenaCore(w):null,step=dt=>core?core.step(dt):tickBattle(w,new Set(),dt),read=()=>core?core.snapshot():w;
    if(core)core.step(0,[{actor:1,actions:[{type:'special'}]}]);if(!core)damageBattle(w,w,1,1);assert.ok(read().destroyed>0);assert.equal(actorIntelligence(read()),9);
    for(let i=0;i<65;i++)step(.05);assert.equal(read().destroyed,0);assert.equal(actorIntelligence(read()),9);assert.equal(itemCapacity(read(),'hedgehog'),26);assert.equal(itemCapacity(read(),'missile'),10);
    assert.equal(actorIntelligence(createBattle(1)),5);
  });
}

test('the bicycle eases into its exact floor pose without a position or velocity jump',()=>{
  const bike={age:0,dropWx:65,dropWz:0,dropHeight:0,wx:65,wz:7,heading:0};
  const start=bicyclePose(bike),air=bicyclePose({...bike,age:.6}),before=bicyclePose({...bike,age:1.199}),landed=bicyclePose({...bike,age:1.2}),rest=bicyclePose({...bike,age:10});
  assert.equal(start.x,65);assert.equal(start.z,0);assert.equal(start.height,0);assert.ok(air.height>2);assert.ok(air.z>0&&air.z<7);
  assert.equal(landed.z,7);assert.equal(landed.height,.2);assert.equal(landed.roll,1.35);assert.equal(landed.glow,1);assert.deepEqual(rest,landed);
  assert.ok(Math.abs(before.z-landed.z)<.00001);assert.ok(Math.abs(before.height-landed.height)<.0001);assert.ok(Math.abs(before.roll-landed.roll)<.0001);
});

test('the bicycle stops before an arena wall instead of landing inside it',()=>{
  const arena={size:96,blocks:[]};assert.deepEqual(bicycleLanding(arena,65,92,0),{wx:65,wz:95});
});

test('remote bicycles animate between packets and the acquired upgrade reaches every presentation',()=>{
  const w=createBattle(0);Object.assign(w,{phase:'racing',elapsed:1,multiplayer:true,human:true,fireCooldown:0,wx:65,wz:-30,supplies:[{id:1001,kind:'bicycle',owner:1,heading:0,dropWx:65,dropWz:-7,dropHeight:0,wx:65,wz:0,age:.5,cooldown:0,version:0}]});for(const a of w.bots)Object.assign(a,{inactive:true,destroyed:999});
  const server=new ArenaCore(w),client=new ArenaClient();client.accept(server.packet(),0);client.frame(0,[],0);const initial=client.present().supplies[0].age;
  client.frame(.02,[],.02);const between=client.present().supplies[0];assert.ok(between.age>initial);assert.equal(between.owner,1);assert.equal(between.dropWz,-7);assert.equal(between.wz,0);assert.equal(between.kind,'bicycle');
  const next=server.snapshot();next.bots=w.bots;Object.assign(next,{wx:65,wz:0});next.supplies[0].age=1.2;const collector=new ArenaCore(next);collector.step(0);client.accept(collector.packet(),.03);client.frame(0,[],.03);assert.equal(client.present().intelligenceBonus,1);assert.equal(client.present().supplies.length,0);assert.equal(actorIntelligence(client.present()),4);
  const powered=collector.snapshot();powered.bots=w.bots;powered.vulcan=2;powered.fireCooldown=0;const vulcan=new ArenaCore(powered);client.accept(vulcan.packet(),.04);client.frame(0,[],.04);assert.equal(client.present().intelligenceBonus,1);assert.equal(client.action('fire',undefined,.04),true);
});

test('predicted bicycle collections immediately raise capacity above five and reconcile without counting twice',()=>{
  const w=createBattle(1);Object.assign(w,{phase:'racing',elapsed:1,multiplayer:true,human:true,wx:65,wz:0,ammo:18,missiles:6,turbos:6,vulcan:2,supplies:[{id:1001,kind:'bicycle',owner:1,age:1.2,wx:65,wz:0,cooldown:0,version:0},{id:1002,kind:'bicycle',owner:1,age:1.2,wx:65,wz:0,cooldown:0,version:0},...['hedgehog','missile','missile','missile','boost','boost','boost'].map((kind,id)=>({id,kind,wx:65,wz:0,cooldown:0,version:0}))]});for(const a of w.bots)Object.assign(a,{inactive:true,destroyed:999});
  const server=new ArenaCore(w),client=new ArenaClient();client.accept(server.packet(),0);client.frame(0,[],0);
  assert.equal(actorIntelligence(client.present()),7);assert.equal(client.present().ammo,22);assert.equal(client.present().missiles,8);assert.equal(client.present().turbos,8);assert.equal(server.snapshot().intelligenceBonus,0);
  server.step(0);client.accept(server.packet(),.02);client.frame(0,[],.02);assert.equal(actorIntelligence(client.present()),7);assert.equal(client.present().ammo,22);assert.equal(client.present().missiles,8);assert.equal(client.present().turbos,8);
});
