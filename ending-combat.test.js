import test from 'node:test';
import assert from 'node:assert/strict';
import {createBattle,tickBattle,dropBomb} from './combat.js';
import {ArenaCore,ArenaClient} from './arena-core.js';

for(const engine of ['solo','Rust multiplayer']){
  test(`${engine}: humans can destroy during the three-second ending without changing final results or stink assists`,()=>{
    const seed=createBattle();Object.assign(seed,{phase:'racing',finishCountdown:3,finishTime:20,finishRank:2,winner:0,kills:3,deaths:4,human:true,multiplayer:true,wx:-65,wz:0,heading:0,motionHeading:0,cameraHeading:0,shield:0,fireCooldown:0,item:'missile',supplies:[]});
    const [victim,bomber,...unused]=seed.bots;
    Object.assign(victim,{human:true,wx:-65,wz:20,health:3,shield:0,destroyed:0,kills:10,deaths:2,dizzy:4,stinkContributors:new Map([[2,100]])});
    Object.assign(bomber,{human:true,bomber:true,kills:.5});for(const bot of unused)Object.assign(bot,{inactive:true,destroyed:1e9});
    const core=engine==='solo'?null:new ArenaCore(seed);
    const step=keys=>core?core.step(1/60,[{actor:0,keys}]):tickBattle(seed,new Set(keys),1/60);
    step([' ']);for(let i=0;i<40;i++)step([]);
    const hit=core?core.snapshot():seed;
    assert.ok(hit.bots[0].destroyed>0);assert.equal(hit.bots[0].health,0);
    assert.deepEqual([hit.kills,hit.deaths,hit.bots[0].kills,hit.bots[0].deaths,hit.bots[1].kills],[3,4,10,2,.5]);
    assert.equal(hit.killStreak,0);assert.equal(hit.vulcan,0);assert.deepEqual(hit.killFeed,[]);
    assert.deepEqual([hit.phase,hit.finishTime,hit.finishRank,hit.winner],['racing',20,2,0]);
    for(let i=0;i<180;i++)step([]);
    const stopped=core?core.snapshot():seed;assert.equal(stopped.phase,'finished');assert.equal(stopped.bots[0].deaths,2);assert.equal(stopped.finishTime,20);
    const frozen=[stopped.wx,stopped.wz,stopped.projectileSequence,3];
    for(let i=0;i<120;i++)step([' ','arrowup']);
    const later=core?core.snapshot():seed;assert.deepEqual([later.wx,later.wz,later.projectileSequence,later.kills],frozen);
  });

  test(`${engine}: armed bots remain idle during the ending while humans can drive and shoot them`,()=>{
    const seed=createBattle();Object.assign(seed,{phase:'racing',finishCountdown:3,finishTime:20,human:true,wx:-65,wz:0,heading:0,motionHeading:0,cameraHeading:0,shield:0,fireCooldown:0,item:'missile',supplies:[]});
    Object.assign(seed.bots[0],{human:false,wx:-65,wz:20,heading:Math.PI,speed:100,shield:0,fireCooldown:0,health:3});
    for(const bot of seed.bots.slice(1))Object.assign(bot,{inactive:true,destroyed:1e9});
    const core=engine==='solo'?null:new ArenaCore(seed);
    const step=keys=>core?core.step(1/60,[{actor:0,keys}]):tickBattle(seed,new Set(keys),1/60);
    for(let i=0;i<60;i++)step([]);
    const idle=core?core.snapshot():seed;
    assert.deepEqual([idle.bots[0].wx,idle.bots[0].wz,idle.bots[0].speed,idle.bots[0].missiles],[-65,20,0,1]);assert.equal(idle.projectiles.length,0);
    step([' ','arrowup']);for(let i=0;i<40;i++)step(['arrowup']);
    const hit=core?core.snapshot():seed;assert.ok(hit.bots[0].destroyed>0);assert.ok(hit.wz>0);assert.equal(hit.kills,0);assert.equal(hit.bots[0].deaths,0);
  });

  test(`${engine}: bombers can attack during the ending without awarding points`,()=>{
    const seed=createBattle();Object.assign(seed,{phase:'racing',finishCountdown:3,finishTime:20,human:true,bomber:true,bombAmmo:2,stinkAmmo:2,bombReload:0,supplies:[]});
    Object.assign(seed.bots[0],{human:true,wx:-65,wz:0,health:3,shield:0});for(const bot of seed.bots.slice(1))Object.assign(bot,{inactive:true,destroyed:1e9});
    const core=engine==='solo'?null:new ArenaCore(seed);
    if(core)core.step(1/60,[{actor:0,keys:[],actions:[{type:'bomb',id:0,afterMove:-1,kind:'abomb',wx:-65,wz:0}]}]);
    if(!core){assert.ok(dropBomb(seed,seed,{kind:'abomb',wx:-65,wz:0}));tickBattle(seed,new Set(),1/60);}
    for(let i=0;i<59;i++){if(core)core.step(1/60);if(!core)tickBattle(seed,new Set(),1/60);}
    const hit=core?core.snapshot():seed;assert.ok(hit.bots[0].destroyed>0);assert.equal(hit.kills,0);assert.equal(hit.bots[0].deaths,0);
    for(let i=0;i<180;i++){if(core)core.step(1/60);if(!core)tickBattle(seed,new Set(),1/60);}
    const refill=core?core.snapshot():seed;assert.equal(refill.phase,'finished');assert.equal(refill.bombAmmo,1);assert.equal(refill.stinkAmmo,2);assert.equal(refill.finishTime,20);
  });
}

test('ending client predicts shots and movement until the final leaderboard stops play',()=>{
  const seed=createBattle();Object.assign(seed,{phase:'racing',finishCountdown:3,finishTime:20,human:true,multiplayer:true,wx:-65,wz:0,heading:0,motionHeading:0,cameraHeading:0,shield:0,fireCooldown:0,item:'hedgehog',supplies:[]});
  for(const bot of seed.bots)Object.assign(bot,{inactive:true,destroyed:1e9});
  const server=new ArenaCore(seed),client=new ArenaClient();client.accept(server.packet(),0);client.frame(1/60,new Set(),1/60);
  assert.equal(client.action('fire',undefined,1/60),true);assert.equal(client.snapshot().projectiles.length,1);assert.equal(server.snapshot().projectiles.length,0);
  server.step(1/60,[{actor:0,...client.outbound([])}]);client.accept(server.packet(),1/60);
  for(let tick=2;tick<=120;tick++){
    const now=tick/60,keys=new Set([' ','arrowup']);client.frame(1/60,keys,now);server.step(1/60,[{actor:0,...client.outbound(keys)}]);client.accept(server.packet(),now);
  }
  assert.ok(server.snapshot().projectileSequence>=4);assert.ok(client.snapshot().wz>0);assert.equal(client.stats.pendingCommands,0);assert.equal(server.snapshot().kills,0);assert.equal(server.snapshot().phase,'racing');
  for(let tick=121;tick<=240;tick++){const now=tick/60,keys=new Set([' ','arrowup']);client.frame(1/60,keys,now);server.step(1/60,[{actor:0,...client.outbound(keys)}]);client.accept(server.packet(),now);}
  assert.equal(server.snapshot().phase,'finished');const stopped=server.snapshot();client.frame(1/60,new Set(),4.01);assert.equal(client.action('fire',undefined,4.01),false);server.step(1/60,[{actor:0,keys:['arrowup']}]);assert.equal(server.snapshot().wz,stopped.wz);
});
