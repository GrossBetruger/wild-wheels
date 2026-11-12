import test from 'node:test';
import assert from 'node:assert/strict';
import {createBattle,tickBattle,blocked,arenas} from './combat.js';
import {ArenaCore,ArenaClient} from './arena-core.js';

for(const engine of ['solo','Rust']){
  test(`${engine}: Tehilim books have the same rarity, duration and refill as Hedgeguard`,()=>{
    for(const arena of [0,1]){
      const seed=createBattle(0,arena),books=seed.supplies.filter(s=>s.kind==='tehilim');assert.equal(books.length,1);assert.equal(books[0].cooldown,30);assert.equal(blocked(arenas[arena],books[0].wx,books[0].wz,4),false);
      Object.assign(seed,{phase:'racing',human:true,wx:50,wz:50});for(const bot of seed.bots)Object.assign(bot,{inactive:true,destroyed:999});
      const core=engine==='Rust'?new ArenaCore(seed):null,step=()=>core?core.step(1/60):tickBattle(seed,new Set(),1/60),read=()=>core?core.snapshot():seed;
      for(let i=0;i<1799;i++)step();assert.equal(read().tehilim,0);step();step();assert.ok(read().tehilim>24.97);assert.ok(read().supplies.find(s=>s.kind==='tehilim').cooldown>44.9);assert.equal(read().item,'hedgehog');
    }
  });
  test(`${engine}: a halfway missile turns back smoothly, hits its shooter and credits the books' owner`,()=>{
    const seed=createBattle();Object.assign(seed,{phase:'racing',human:true,wx:65,wz:80,health:6,tehilim:25,supplies:[]});for(const bot of seed.bots)Object.assign(bot,{inactive:true,destroyed:999});Object.assign(seed.bots[0],{inactive:false,destroyed:0,human:true,wx:65,wz:40,health:3,tehilim:25});
    seed.projectiles=[{id:1,kind:'missile',owner:1,target:0,wx:65,wz:60,heading:0,speed:70,height:1.3,vy:0,life:3,age:0,trail:[]}];
    const core=engine==='Rust'?new ArenaCore(seed):null,step=dt=>core?core.step(dt):tickBattle(seed,new Set(),dt),read=()=>core?core.snapshot():seed;
    step(0);assert.equal(read().projectiles[0].owner,0);assert.equal(read().projectiles[0].target,1);assert.equal(read().projectiles[0].heading,0);
    step(1/60);assert.ok(Math.abs(read().projectiles[0].heading)<.09);
    for(let i=0;i<120;i++)step(1/60);
    assert.equal(read().health,6);assert.equal(read().kills,1);assert.equal(read().bots[0].deaths,1);
  });
  for(const [kind,target,z,timer,health]of [['missile',0,-31,25,6],['missile',null,-2,25,3],['missile',0,-2,0,3],['hedgehog',0,-2,25,5]]){
    test(`${engine}: ${kind} target ${target} at ${z} with ${timer}s books leaves ${health} health`,()=>{
      const seed=createBattle();Object.assign(seed,{phase:'racing',human:true,wx:-65,wz:0,health:6,tehilim:timer,supplies:[]});for(const bot of seed.bots)Object.assign(bot,{inactive:true,destroyed:999});Object.assign(seed.bots[0],{inactive:false,destroyed:0,human:true,wx:-65,wz:-60});
      seed.projectiles=[{id:1,kind,owner:1,target,wx:-65,wz:z,heading:0,speed:70,height:1.3,vy:0,life:3,age:0,trail:[]}];
      const core=engine==='Rust'?new ArenaCore(seed):null;if(core)core.step(1/60);if(!core)tickBattle(seed,new Set(),1/60);const after=core?core.snapshot():seed;
      assert.equal(after.health,health);if(z===-31){assert.equal(after.projectiles[0].owner,1);assert.equal(after.projectiles[0].target,0);}
    });
  }
}
test('collecting books is immediate for the client and the aura is replicated to other players',()=>{
  const seed=createBattle();Object.assign(seed,{phase:'racing',human:true,multiplayer:true,wx:-65,wz:0,supplies:[{id:9,kind:'tehilim',wx:-65,wz:0,version:0,cooldown:0}]});for(const bot of seed.bots)Object.assign(bot,{inactive:true,destroyed:999});
  const server=new ArenaCore(seed),local=new ArenaClient(),peer=new ArenaClient();local.accept(server.packet(),0);local.frame(1/60,[],1/60);assert.equal(local.present().tehilim,25);assert.equal(server.snapshot().tehilim,0);
  server.step(1/60,[{actor:0,...local.outbound([])}]);local.accept(server.packet(),1/60);local.frame(0,[],1/60);peer.accept(server.packet(1),1/60);peer.frame(0,[],1/60);
  assert.equal(local.present().tehilim,25);assert.equal(peer.present().bots.find(a=>a.id===0).tehilim,25);assert.equal(local.present().supplies[0].kind,'tehilim');assert.equal(local.present().supplies[0].cooldown,45);
});
