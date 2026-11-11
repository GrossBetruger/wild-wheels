import test from 'node:test';
import assert from 'node:assert/strict';
import {createBattle,tickBattle,blocked,arenas} from './combat.js';
import {ArenaCore,ArenaClient} from './arena-core.js';

for(const engine of ['solo','Rust multiplayer']){
  test(`${engine}: a single rare Hedgeguard appears after 30 seconds and collecting it gives twelve seconds of protection`,()=>{
    for(const arena of [0,1]){
      const seed=createBattle(0,arena),rare=seed.supplies.filter(s=>s.kind==='hedgeproof');
      assert.equal(rare.length,1);assert.equal(rare[0].cooldown,30);assert.equal(blocked(arenas[arena],rare[0].wx,rare[0].wz,4),false);
      Object.assign(seed,{phase:'racing',human:true,wx:rare[0].wx,wz:rare[0].wz});for(const bot of seed.bots)Object.assign(bot,{inactive:true,destroyed:1e9});
      const core=engine==='solo'?null:new ArenaCore(seed),step=()=>core?core.step(1/60):tickBattle(seed,new Set(),1/60),read=()=>core?core.snapshot():seed;
      for(let i=0;i<1799;i++)step();assert.equal(read().hedgeShield,0);
      // Floating point summation can leave the initial cooldown above zero for one tick.
      step();step();const after=read();assert.ok(after.hedgeShield>11.97&&after.hedgeShield<=12);assert.equal(after.item,'hedgehog');assert.ok(after.supplies.find(s=>s.kind==='hedgeproof').cooldown>44.9);
    }
  });

  for(const [weapon,vulcan,shooter,health]of [['hedgehog',false,0,6],['hedgehog',true,0,6],['hedgehog',true,5,6],['hedgehog',true,6,6],['missile',false,0,3],['abomb',false,0,6]]){
    test(`${engine}: Hedgeguard ${health===6?'blocks':'allows'} ${vulcan?'Vulcan ':''}${weapon} damage from character ${shooter}`,()=>{
      const seed=createBattle();Object.assign(seed,{phase:'racing',human:true,wx:-65,wz:0,shield:0,hedgeShield:12,health:6,healTimer:1,supplies:[]});
      for(const bot of seed.bots)Object.assign(bot,{inactive:true,destroyed:1e9});Object.assign(seed.bots[0],{driver:shooter,human:true,inactive:false,destroyed:0,wx:-65,wz:20});
      if(weapon==='abomb')seed.bombs=[{id:1,kind:'abomb',owner:1,wx:-65,wz:0,age:.899,color:'#ffffff'}];
      if(weapon!=='abomb')seed.projectiles=[{id:1,kind:weapon,vulcan,owner:1,wx:-65,wz:3,heading:Math.PI,speed:90,height:1.3,vy:0,life:2,age:0,trail:[],target:null}];
      const core=engine==='solo'?null:new ArenaCore(seed);if(core)core.step(1/60);if(!core)tickBattle(seed,new Set(),1/60);
      const after=core?core.snapshot():seed;assert.equal(after.health,health);assert.equal(after.deaths,0);assert.equal(after.bots[0].kills,0);assert.ok(after.hedgeShield>11.9);
    });
  }

  test(`${engine}: hedgehogs hurt again when the twelve second protection expires`,()=>{
    const seed=createBattle();Object.assign(seed,{phase:'racing',human:true,wx:-65,wz:0,shield:0,hedgeShield:12,health:6,supplies:[]});for(const bot of seed.bots)Object.assign(bot,{inactive:true,destroyed:1e9});
    // Hold a stationary shot just outside contact until the last protection tick.
    seed.projectiles=[{id:1,kind:'hedgehog',owner:1,wx:-65,wz:3,heading:Math.PI,speed:0,height:1.3,vy:0,life:30,age:0,trail:[]}];
    const core=engine==='solo'?null:new ArenaCore(seed),step=()=>core?core.step(1/60):tickBattle(seed,new Set(),1/60),read=()=>core?core.snapshot():seed;
    for(let i=0;i<719;i++)step();assert.ok(read().hedgeShield>0&&read().hedgeShield<.017);step();step();assert.equal(read().hedgeShield,0);
    const expired={...seed,hedgeShield:read().hedgeShield};expired.projectiles=[{id:2,kind:'hedgehog',owner:1,wx:-65,wz:3,heading:Math.PI,speed:90,height:1.3,vy:0,life:2,trail:[]}];
    const finalCore=core?new ArenaCore(expired):null;if(finalCore)finalCore.step(1/60);if(!finalCore)tickBattle(expired,new Set(),1/60);assert.equal((finalCore?finalCore.snapshot():expired).health,5);
  });

  test(`${engine}: a lethal missile removes the aura and respawn does not restore it`,()=>{
    const seed=createBattle();Object.assign(seed,{phase:'racing',human:true,wx:-65,wz:0,shield:0,hedgeShield:12,health:3,supplies:[],projectiles:[{id:1,kind:'missile',owner:1,wx:-65,wz:3,heading:Math.PI,speed:90,height:1.3,vy:0,life:2,trail:[]}]});for(const bot of seed.bots)Object.assign(bot,{inactive:true,destroyed:1e9});
    const core=engine==='solo'?null:new ArenaCore(seed),step=()=>core?core.step(1/60):tickBattle(seed,new Set(),1/60),read=()=>core?core.snapshot():seed;
    step();assert.equal(read().health,0);assert.equal(read().hedgeShield,0);assert.equal(read().deaths,1);
    for(let i=0;i<182;i++)step();assert.equal(read().health,3);assert.equal(read().destroyed,0);assert.equal(read().hedgeShield,0);
  });
}

test('a client receives Hedgeguard immediately on contact and both players see the authoritative twelve second aura',()=>{
  const seed=createBattle(5);Object.assign(seed,{phase:'racing',human:true,multiplayer:true,wx:-65,wz:0,shield:0});for(const bot of seed.bots)Object.assign(bot,{inactive:true,destroyed:1e9});
  seed.supplies=[{id:8,kind:'hedgeproof',wx:-65,wz:0,version:0,cooldown:0}];
  const server=new ArenaCore(seed),local=new ArenaClient(),observer=new ArenaClient();local.accept(server.packet(),0);local.frame(1/60,[],1/60);
  assert.equal(local.present().hedgeShield,12);assert.equal(local.snapshot().hedgeShield,12);assert.equal(server.snapshot().hedgeShield,0);
  server.step(1/60,[{actor:0,...local.outbound([])}]);local.accept(server.packet(),1/60);local.frame(0,[],1/60);observer.accept(server.packet(1),1/60);observer.frame(0,[],1/60);
  assert.equal(local.present().hedgeShield,12);assert.equal(observer.present().bots.find(a=>a.id===0).hedgeShield,12);assert.equal(server.snapshot().supplies[0].cooldown,45);
  assert.equal(local.present().supplies[0].kind,'hedgeproof');assert.equal(local.present().supplies[0].cooldown,45);
});
