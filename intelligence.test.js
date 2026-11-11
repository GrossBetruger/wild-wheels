import test from 'node:test';
import assert from 'node:assert/strict';
import {drivers,createRace,itemCapacity} from './engine.js';
import {createBattle,tickBattle} from './combat.js';
import {ArenaCore,ArenaClient} from './arena-core.js';

for(const engine of ['solo','Rust multiplayer']){
  test(`${engine}: Intelligence sets hedgehog, missile and turbo pickup limits for each character`,()=>{
    for(const [driver,intelligence,hedgehogs,items]of [[0,3,14,4],[1,5,18,6],[2,4,16,5],[3,2,12,3],[4,4,16,5],[5,3,14,4],[6,4,16,5],[7,5,18,6]]){
      const seed=createBattle(driver);Object.assign(seed,{phase:'racing',human:true,wx:-65,wz:0,ammo:0,missiles:0,turbos:0});
      for(const bot of seed.bots)Object.assign(bot,{inactive:true,destroyed:1e9});
      seed.supplies=['hedgehog',...Array(10).fill('missile'),...Array(10).fill('boost')].map((kind,id)=>({id,version:0,wx:-65,wz:0,kind,cooldown:0}));
      assert.equal(drivers[driver].intelligence,intelligence);assert.equal(itemCapacity(driver,'hedgehog'),hedgehogs);assert.equal(itemCapacity(driver,'missile'),items);assert.equal(itemCapacity(driver,'boost'),items);
      const core=engine==='solo'?null:new ArenaCore(seed);if(core)core.step(1/60);if(!core)tickBattle(seed,new Set(),1/60);
      const after=core?core.snapshot():seed;assert.deepEqual([after.ammo,after.missiles,after.turbos],[hedgehogs,items,items]);
    }
  });

  test(`${engine}: every character and kart starts and respawns with ten hedgehogs`,()=>{
    for(let driver=0;driver<8;driver++){
      const seed=createBattle(driver);assert.deepEqual([seed,...seed.bots].map(actor=>actor.ammo),[10,10,10,10,10,10]);
      assert.equal(createRace(driver).ammo,10);
      Object.assign(seed,{phase:'racing',human:true,ammo:0,destroyed:1/60,supplies:[]});for(const bot of seed.bots)Object.assign(bot,{inactive:true,destroyed:1e9});
      const core=engine==='solo'?null:new ArenaCore(seed);if(core)core.step(1/60);if(!core)tickBattle(seed,new Set(),1/60);
      assert.equal((core?core.snapshot():seed).ammo,10);
    }
  });

  test(`${engine}: bomber bomb storage follows Intelligence while the five and ten second refill clocks stay intact`,()=>{
    for(const [driver,maximum]of [[3,3],[0,4],[2,5],[7,6]]){
      const seed=createBattle(driver);Object.assign(seed,{phase:'racing',human:true,bomber:true,bombAmmo:2,stinkAmmo:2,bombReload:0,supplies:[]});for(const bot of seed.bots)Object.assign(bot,{inactive:true,destroyed:1e9});
      const core=engine==='solo'?null:new ArenaCore(seed);
      for(let tick=0;tick<299;tick++){if(core)core.step(1/60);if(!core)tickBattle(seed,new Set(),1/60);}
      const before=core?core.snapshot():seed;assert.deepEqual([before.bombAmmo,before.stinkAmmo],[2,2]);
      if(core)core.step(1/60);if(!core)tickBattle(seed,new Set(),1/60);
      assert.equal((core?core.snapshot():seed).stinkAmmo,3);assert.equal((core?core.snapshot():seed).bombAmmo,2);
      for(let tick=0;tick<2700;tick++){if(core)core.step(1/60);if(!core)tickBattle(seed,new Set(),1/60);}
      const after=core?core.snapshot():seed;assert.equal(after.bombAmmo,maximum);assert.equal(after.stinkAmmo,maximum);
    }
  });

  test(`${engine}: regular hedgehogs can fire four times in 0.9 seconds and consume four rounds`,()=>{
    const seed=createBattle();Object.assign(seed,{phase:'racing',human:true,wx:-65,wz:0,heading:0,motionHeading:0,cameraHeading:0,fireCooldown:0,ammo:10,reload:0,supplies:[]});for(const bot of seed.bots)Object.assign(bot,{inactive:true,destroyed:1e9});
    const core=engine==='solo'?null:new ArenaCore(seed);
    for(let tick=0;tick<54;tick++){if(core)core.step(1/60,[{actor:0,keys:[' ']}]);if(!core)tickBattle(seed,new Set([' ']),1/60);}
    const after=core?core.snapshot():seed;assert.equal(after.projectiles.length,4);assert.equal(after.ammo,6);assert.equal(after.missiles,1);
  });
}

test('predicted pickups respect Intelligence limits immediately and settle to the same server inventory',()=>{
  const seed=createBattle(7);Object.assign(seed,{phase:'racing',human:true,multiplayer:true,wx:-65,wz:0,heading:0,motionHeading:0,cameraHeading:0,ammo:0,missiles:5,turbos:5});for(const bot of seed.bots)Object.assign(bot,{inactive:true,destroyed:1e9});
  seed.supplies=[{id:0,version:0,wx:-65,wz:0,kind:'hedgehog',cooldown:0},{id:1,version:0,wx:-65,wz:0,kind:'missile',cooldown:0},{id:2,version:0,wx:-65,wz:0,kind:'boost',cooldown:0}];
  const server=new ArenaCore(seed),client=new ArenaClient();client.accept(server.packet(),0);client.frame(1/60,[],1/60);
  const predicted=client.snapshot();assert.deepEqual([predicted.ammo,predicted.missiles,predicted.turbos],[18,6,6]);
  server.step(1/60,[{actor:0,...client.outbound([])}]);client.accept(server.packet(),1/60);client.frame(0,[],1/60);
  const settled=client.snapshot();assert.deepEqual([settled.ammo,settled.missiles,settled.turbos],[18,6,6]);
});

test('held client fire predicts the faster regular shots and confirms four authoritative shots in 0.9 seconds',()=>{
  const seed=createBattle();Object.assign(seed,{phase:'racing',human:true,multiplayer:true,wx:-65,wz:0,heading:0,motionHeading:0,cameraHeading:0,ammo:10,fireCooldown:0,reload:0,supplies:[]});for(const bot of seed.bots)Object.assign(bot,{inactive:true,destroyed:1e9});
  const server=new ArenaCore(seed),client=new ArenaClient();client.accept(server.packet(),0);
  for(let tick=1;tick<=54;tick++){const now=tick/60,keys=new Set([' ']);client.frame(1/60,keys,now);server.step(1/60,[{actor:0,...client.outbound(keys)}]);client.accept(server.packet(),now);}
  assert.equal(server.snapshot().projectiles.length,4);assert.equal(server.snapshot().ammo,6);assert.equal(client.snapshot().ammo,6);assert.equal(client.stats.pendingCommands,0);
});
