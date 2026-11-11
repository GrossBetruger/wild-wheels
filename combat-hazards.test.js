import test from 'node:test';
import assert from 'node:assert/strict';
import {createBattle,tickBattle,equipBomber,useBattleTurbo,predictKartMovement} from './combat.js';
import {ArenaCore,ArenaClient} from './arena-core.js';

for(const engine of ['solo','Rust']){
  test(`${engine}: an A-bomb victim becomes ash through respawn and peers receive the ash effect`,()=>{
    const seed=createBattle();Object.assign(seed,{phase:'racing',human:true,wx:-65,wz:0,health:3,shield:0,speed:0,supplies:[],bombs:[{id:1,owner:1,kind:'abomb',wx:-65,wz:0,age:.899,color:'#ffffff'}]});
    for(const bot of seed.bots)Object.assign(bot,{inactive:true,destroyed:1e9});equipBomber(seed.bots[0]);seed.bots[0].inactive=false;
    const core=engine==='Rust'?new ArenaCore(seed):null,step=()=>core?core.step(1/60):tickBattle(seed,new Set(),1/60),read=()=>core?core.snapshot():seed;
    step();assert.equal(read().health,0);assert.equal(read().deaths,1);assert.equal(read().bots[0].kills,1);assert.ok(read().effects.some(f=>f.type==='ash'));assert.equal(read().effects.some(f=>f.type==='explosion'),false);
    if(core){const peer=new ArenaClient();peer.accept(core.packet(1),0);peer.frame(0,[],0);assert.ok(peer.present().effects.some(f=>f.type==='ash'));}
    for(let i=0;i<120;i++)step();assert.ok(read().effects.some(f=>f.type==='ash'));assert.ok(read().destroyed>0);
    for(let i=0;i<61;i++)step();assert.ok(read().effects.some(f=>f.type==='ash'));assert.equal(read().destroyed,0);assert.equal(read().health,3);
    for(let i=0;i<80;i++)step();assert.equal(read().effects.some(f=>f.type==='ash'),false);
  });

  test(`${engine}: A-bomb impact plus immediate radiation deals six damage through radius 22 and four through radius 28`,()=>{
    for(const [radius,health]of [[0,0],[22,0],[22.01,2],[28,2],[28.01,6]]){
      const seed=createBattle();Object.assign(seed,{phase:'racing',human:true,wx:-65,wz:radius,health:6,shield:0,speed:0,supplies:[],bombs:[{id:1,owner:1,kind:'abomb',wx:-65,wz:0,age:.899,color:'#ffffff'}]});
      for(const bot of seed.bots)Object.assign(bot,{inactive:true,destroyed:1e9});equipBomber(seed.bots[0]);Object.assign(seed.bots[0],{inactive:false});
      const core=engine==='Rust'?new ArenaCore(seed):null;if(core)core.step(1/60);if(!core)tickBattle(seed,new Set(),1/60);
      assert.equal((core?core.snapshot():seed).health,health,`distance ${radius}`);
    }
  });

  test(`${engine}: a boosted wall crash explodes, while a normal wall impact is survivable`,()=>{
    for(const [boost,health,deaths]of [[1,0,1],[0,6,0]]){
      const seed=createBattle();Object.assign(seed,{phase:'racing',human:true,wx:93,wz:70,heading:Math.PI/2,motionHeading:Math.PI/2,cameraHeading:Math.PI/2,speed:800,boost,health:6,shield:0,supplies:[]});for(const bot of seed.bots)Object.assign(bot,{inactive:true,destroyed:1e9});
      const core=engine==='Rust'?new ArenaCore(seed):null;if(core)core.step(1/60);if(!core)tickBattle(seed,new Set(),1/60);
      const after=core?core.snapshot():seed;assert.equal(after.health,health);assert.equal(after.deaths,deaths);assert.equal(after.effects.some(f=>f.type==='explosion'),boost>0);
    }
  });

  test(`${engine}: a dizzy boosted crash awards one full point to each active bomber once`,()=>{
    const seed=createBattle();Object.assign(seed,{phase:'racing',human:true,wx:93,wz:70,heading:Math.PI/2,motionHeading:Math.PI/2,cameraHeading:Math.PI/2,speed:0,boost:0,health:6,shield:0,supplies:[]});
    for(const bot of seed.bots)Object.assign(bot,{inactive:true,destroyed:1e9});
    for(const bot of seed.bots.slice(0,2)){equipBomber(bot);bot.inactive=false;}
    seed.stinkClouds=[{id:1,owner:1,wx:93,wz:70,age:0,life:5,hits:[]},{id:2,owner:2,wx:93,wz:70,age:0,life:5,hits:[]}];
    const core=engine==='Rust'?new ArenaCore(seed):null;if(core)core.step(1/60);if(!core)tickBattle(seed,new Set(),1/60);
    assert.equal((core?core.snapshot():seed).dizzy,8);
    if(core)core.step(1/60,[{actor:0,keys:['arrowup'],actions:[{id:0,type:'turbo',afterMove:-1}]}]);if(!core)useBattleTurbo(seed);
    for(let i=0;i<60;i++){if(core)core.step(1/60,[{actor:0,keys:['arrowup']}]);if(!core)tickBattle(seed,new Set(['arrowup']),1/60);}
    const after=core?core.snapshot():seed;assert.equal(after.health,0);assert.equal(after.deaths,1);assert.deepEqual(after.bots.slice(0,2).map(b=>b.kills),[1,1]);assert.equal(after.killFeed.length,2);assert.ok(after.killFeed.every(f=>!f.assist));
  });
}

test('dizziness pulls steering harder during boost than during normal driving',()=>{
  const world=createBattle();Object.assign(world,{phase:'racing',wx:-65,wz:0,heading:0,motionHeading:0,cameraHeading:0,speed:100,dizzy:7.9,boost:0});
  const normal={...world},boosted={...world,boost:1};predictKartMovement(world,normal,new Set(),1/60);predictKartMovement(world,boosted,new Set(),1/60);
  assert.ok(Math.abs(normal.heading)>.02);assert.ok(Math.abs(boosted.heading)>Math.abs(normal.heading));assert.equal(world.health,3);
});

test('a client stops at a boosted wall impact immediately and the server confirms the explosion',()=>{
  const seed=createBattle();Object.assign(seed,{phase:'racing',human:true,multiplayer:true,wx:93,wz:70,heading:Math.PI/2,motionHeading:Math.PI/2,cameraHeading:Math.PI/2,speed:800,boost:1,health:6,shield:0,supplies:[]});for(const bot of seed.bots)Object.assign(bot,{inactive:true,destroyed:1e9});
  const server=new ArenaCore(seed),client=new ArenaClient();client.accept(server.packet(),0);client.frame(1/60,[],1/60);
  assert.equal(client.snapshot().speed,0);assert.equal(client.snapshot().boost,0);const stopped=client.snapshot();client.frame(1/60,['arrowup'],2/60);assert.equal(client.snapshot().wx,stopped.wx);
  server.step(1/60,[{actor:0,...client.outbound([])}]);client.accept(server.packet(),.05);client.frame(0,[],.05);
  assert.equal(server.snapshot().deaths,1);assert.equal(client.snapshot().health,0);assert.equal(client.snapshot().speed,0);assert.equal(client.snapshot().wx,server.snapshot().wx);
});
