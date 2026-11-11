import test from 'node:test';
import assert from 'node:assert/strict';
import {drivers} from './engine.js';
import {createBattle,tickBattle,recoveryInterval,hedgehogRecoveryInterval} from './combat.js';
import {ArenaCore} from './arena-core.js';

for(const engine of ['solo','Rust multiplayer']){
  test(`${engine}: cuteness replenishes hedgehogs every one to two seconds, up to six carried`,()=>{
    for(const [driver,seconds]of [[0,1],[1,1.5],[2,1.25],[3,1.25],[4,1],[5,1],[6,2]]){
      const seed=createBattle(driver);Object.assign(seed,{phase:'racing',human:true,ammo:0,reload:0,missiles:2,turbos:1,supplies:[]});
      for(const bot of seed.bots)Object.assign(bot,{inactive:true,destroyed:1e9});
      assert.equal(hedgehogRecoveryInterval(driver),seconds);const core=engine==='solo'?null:new ArenaCore(seed);
      for(let frame=0;frame<seconds*60-1;frame++){if(core)core.step(1/60);if(!core)tickBattle(seed,new Set(),1/60);}
      assert.equal((core?core.snapshot():seed).ammo,0);
      if(core)core.step(1/60);if(!core)tickBattle(seed,new Set(),1/60);
      assert.equal((core?core.snapshot():seed).ammo,1);
      for(let frame=0;frame<seconds*60*7;frame++){if(core)core.step(1/60);if(!core)tickBattle(seed,new Set(),1/60);}
      const after=core?core.snapshot():seed;assert.equal(after.ammo,6);assert.equal(after.missiles,2);assert.equal(after.turbos,1);
    }
  });

  test(`${engine}: each character recovers one heart at their cuteness interval`,()=>{
    for(const [driver,cuteness,seconds]of [[0,5,4],[1,3,8],[2,4,6],[3,4,6],[4,5,4],[5,5,4],[6,1,12]]){
      const seed=createBattle(driver);Object.assign(seed,{phase:'racing',human:true,health:1,shield:0,supplies:[]});
      for(const bot of seed.bots)Object.assign(bot,{inactive:true,destroyed:1e9});
      assert.equal(drivers[driver].cuteness,cuteness);assert.equal(recoveryInterval(driver),seconds);
      const core=engine==='solo'?null:new ArenaCore(seed);
      for(let frame=0;frame<seconds*60-1;frame++){if(core)core.step(1/60);if(!core)tickBattle(seed,new Set(),1/60);}
      assert.equal((core?core.snapshot():seed).health,1,`${drivers[driver].name} waits ${seconds} seconds`);
      if(core)core.step(1/60);if(!core)tickBattle(seed,new Set(),1/60);
      assert.equal((core?core.snapshot():seed).health,2,`${drivers[driver].name} recovers one heart`);
    }
  });

  test(`${engine}: recovery restores three normal hearts and preserves bonus hearts without generating more`,()=>{
    for(const [initial,expected]of [[1,3],[2,3],[3,3],[4,4],[6,6]]){
      const seed=createBattle(5);Object.assign(seed,{phase:'racing',human:true,health:initial,shield:0,supplies:[]});
      for(const bot of seed.bots)Object.assign(bot,{inactive:true,destroyed:1e9});
      const core=engine==='solo'?null:new ArenaCore(seed);
      for(let frame=0;frame<1200;frame++){if(core)core.step(1/60);if(!core)tickBattle(seed,new Set(),1/60);}
      assert.equal((core?core.snapshot():seed).health,expected);
    }
  });

  test(`${engine}: taking damage restarts the recovery interval`,()=>{
    const seed=createBattle(5);Object.assign(seed,{phase:'racing',human:true,wx:-65,wz:0,health:2,healTimer:3.5,shield:0,supplies:[]});
    for(const bot of seed.bots)Object.assign(bot,{inactive:true,destroyed:1e9});
    seed.projectiles=[{id:1,owner:1,kind:'hedgehog',wx:-65,wz:-2,heading:0,speed:90,height:1.3,vy:3,life:2,age:0,trail:[],bounces:0}];
    const core=engine==='solo'?null:new ArenaCore(seed);
    if(core)core.step(1/60);if(!core)tickBattle(seed,new Set(),1/60);
    assert.equal((core?core.snapshot():seed).health,1);
    for(let frame=0;frame<239;frame++){if(core)core.step(1/60);if(!core)tickBattle(seed,new Set(),1/60);}
    assert.equal((core?core.snapshot():seed).health,1);
    if(core)core.step(1/60);if(!core)tickBattle(seed,new Set(),1/60);
    assert.equal((core?core.snapshot():seed).health,2);
  });

  test(`${engine}: menus, ending, AFK, bombers and wrecks do not recover hearts`,()=>{
    for(const state of [{phase:'ready'},{phase:'paused'},{phase:'countdown',countdown:60},{phase:'finished'},{phase:'racing',finishCountdown:3},{phase:'racing',afk:true},{phase:'racing',inactive:true},{phase:'racing',bomber:true},{phase:'racing',destroyed:100}]){
      const seed=createBattle(5);Object.assign(seed,{phase:'racing',human:true,health:1,shield:0,supplies:[],...state});
      for(const bot of seed.bots)Object.assign(bot,{inactive:true,destroyed:1e9});
      if(state.inactive)Object.assign(seed.bots[0],{inactive:false,bomber:true,destroyed:0});
      const core=engine==='solo'?null:new ArenaCore(seed);
      for(let frame=0;frame<900;frame++){if(core)core.step(1/60);if(!core)tickBattle(seed,new Set(),1/60);}
      assert.equal((core?core.snapshot():seed).health,1,JSON.stringify(state));
    }
  });

  test(`${engine}: bots recover using their own cuteness and respawning clears old recovery progress`,()=>{
    const seed=createBattle();Object.assign(seed,{phase:'racing',human:true,bomber:true,supplies:[]});
    Object.assign(seed.bots[0],{driver:5,health:2,shield:0,healTimer:0,ammo:0,missiles:0,reload:-100});
    Object.assign(seed.bots[1],{human:true,driver:6,health:0,destroyed:1/60,healTimer:11.9});
    for(const bot of seed.bots.slice(2))Object.assign(bot,{inactive:true,destroyed:1e9});
    const core=engine==='solo'?null:new ArenaCore(seed);
    if(core)core.step(1/60);if(!core)tickBattle(seed,new Set(),1/60);
    const respawn=core?core.snapshot():seed;assert.equal(respawn.bots[1].health,3);assert.equal(respawn.bots[1].healTimer,0);
    for(let frame=1;frame<240;frame++){if(core)core.step(1/60);if(!core)tickBattle(seed,new Set(),1/60);}
    assert.equal((core?core.snapshot():seed).bots[0].health,3);
  });
}

test('resuming a multiplayer player preserves earned recovery progress and broadcasts their healed health to peers',()=>{
  const seed=createBattle(5);Object.assign(seed,{phase:'racing',human:true,name:'Tamar',health:2,healTimer:2,shield:0,supplies:[]});
  Object.assign(seed.bots[0],{human:true,name:'Friend'});for(const bot of seed.bots.slice(1))Object.assign(bot,{inactive:true,destroyed:1e9});
  const core=new ArenaCore(seed);
  core.resume(0);for(let frame=0;frame<120;frame++)core.step(1/60);
  assert.equal(core.snapshot(0).health,3);assert.equal(core.snapshot(1).bots.find(actor=>actor.id===0).health,3);assert.equal(core.present(0).health,3);
});
