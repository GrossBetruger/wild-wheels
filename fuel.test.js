import test from 'node:test';
import assert from 'node:assert/strict';
import {drivers,createRace,useTurbo,boostDuration} from './engine.js';
import {createBattle,useBattleTurbo,tickBattle} from './combat.js';
import {ArenaCore,ArenaClient} from './arena-core.js';

test('Houston has maximum Fuel and every other character has at most three',()=>{
  assert.equal(drivers[7].fuel,5);
  for(const [id,driver]of drivers.entries()){if(id===7)continue;assert.ok(driver.fuel>=1&&driver.fuel<=3,driver.name);}
});

for(const engine of ['Grand Prix','solo arena','Rust multiplayer']){
  test(`${engine}: Fuel determines how long one turbo lasts for every character`,()=>{
    for(const [driver,fuel,seconds]of [[0,3,3.6],[1,2,2.8],[2,2,2.8],[3,3,3.6],[4,3,3.6],[5,2,2.8],[6,3,3.6],[7,5,5.2],[8,3,3.6],[9,3,3.6],[10,3,3.6]]){
      assert.equal(drivers[driver].fuel,fuel);assert.equal(boostDuration(driver),seconds);
      if(engine==='Grand Prix'){
        const race=createRace(driver);Object.assign(race,{phase:'racing',turbos:1});assert.equal(useTurbo(race),true);assert.equal(race.boost,seconds);assert.equal(race.turbos,0);continue;
      }
      const seed=createBattle(driver);Object.assign(seed,{phase:'racing',human:true,wx:-65,wz:0,heading:0,speed:0,turbos:1,supplies:[]});for(const bot of seed.bots)Object.assign(bot,{inactive:true,destroyed:1e9});
      const core=engine==='Rust multiplayer'?new ArenaCore(seed):null;
      if(core)core.step(1/60,[{actor:0,actions:[{type:'turbo',id:0,afterMove:-1}]}]);
      if(!core){assert.equal(useBattleTurbo(seed),true);tickBattle(seed,new Set(),1/60);}
      const after=core?core.snapshot():seed;assert.ok(Math.abs(after.boost-(seconds-1/60))<1e-6);assert.equal(after.turbos,0);
    }
  });
}

test('predicted Fuel durations agree with the server for immediate and queued turbo actions',()=>{
  for(const [driver,seconds]of [[1,2.8],[7,5.2]])for(const moves of [0,1]){
    const seed=createBattle(driver);Object.assign(seed,{phase:'racing',human:true,multiplayer:true,wx:-65,wz:0,heading:0,motionHeading:0,cameraHeading:0,speed:0,turbos:1,supplies:[]});for(const bot of seed.bots)Object.assign(bot,{inactive:true,destroyed:1e9});
    const server=new ArenaCore(seed),client=new ArenaClient();client.accept(server.packet(),0);client.frame(moves/60,[],moves/60);
    assert.equal(client.action('turbo',undefined,moves/60),true);assert.ok(Math.abs(client.snapshot().boost-seconds)<1e-6);assert.equal(client.snapshot().turbos,0);
    server.step(1/60,[{actor:0,...client.outbound([])}]);client.accept(server.packet(),.05);client.frame(0,[],.05);
    assert.ok(Math.abs(server.snapshot().boost-client.snapshot().boost)<1e-6);assert.equal(server.snapshot().turbos,0);assert.equal(client.snapshot().turbos,0);
  }
});
