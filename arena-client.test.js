import test from 'node:test';
import assert from 'node:assert/strict';
import {ArenaCore,ArenaClient} from './arena-core.js';
import {createBattle} from './scripts/reference-combat.mjs';

test('Rust-owned prediction and authoritative movement stay identical through command acknowledgements',()=>{
  const seed=createBattle();Object.assign(seed,{phase:'racing',multiplayer:true,human:true,supplies:[],wx:-65,wz:70,heading:Math.PI/2,motionHeading:Math.PI/2,cameraHeading:Math.PI/2});
  for(const bot of seed.bots)Object.assign(bot,{inactive:true,destroyed:1e9});
  const server=new ArenaCore(seed),client=new ArenaClient();client.accept(server.packet(),0);
  for(let tick=1;tick<=600;tick++){
    const now=tick/60,keys=new Set(tick%240<120?['arrowup']:['arrowup','arrowright','shift']);
    client.frame(1/60,keys,now);const input=client.outbound(keys);
    server.step(1/60,[{actor:0,...input}]);client.accept(server.packet(),now);client.frame(0,keys,now);
    const expected=server.snapshot(),actual=client.snapshot();
    for(const field of ['wx','wz','heading','cameraHeading','speed'])assert.ok(Math.abs(actual[field]-expected[field])<1e-9,`${field} at tick ${tick}`);
    assert.equal(client.stats.pendingCommands,0,'acknowledged commands leave the replay backlog');
  }
});

test('Rust prediction remains immediate while acknowledgements are delayed and replayed',()=>{
  const seed=createBattle();Object.assign(seed,{phase:'racing',multiplayer:true,human:true,supplies:[],wx:-65,wz:70,heading:Math.PI/2,motionHeading:Math.PI/2,cameraHeading:Math.PI/2});
  for(const bot of seed.bots)Object.assign(bot,{inactive:true,destroyed:1e9});
  const server=new ArenaCore(seed),client=new ArenaClient();client.accept(server.packet(),0);
  const up=[],down=[];let serverKeys=[];
  for(let tick=1;tick<=300;tick++){
    const now=tick/60,keys=['arrowup'];client.frame(1/60,keys,now);
    if(tick%2===0)up.push({tick:tick+5,input:client.outbound(keys)});
    const moves=[];
    while(up[0]?.tick<=tick){const input=up.shift().input;serverKeys=input.keys;moves.push(...input.moves);}
    server.step(1/60,[{actor:0,keys:serverKeys,moves}]);
    if(tick%2===0)down.push({tick:tick+5,packet:server.packet()});
    while(down[0]?.tick<=tick)client.accept(down.shift().packet,now);
    client.frame(0,keys,now);
    if(tick===1)assert.equal(client.snapshot().speed,5);
  }
  const actual=client.snapshot();assert.ok(actual.speed>0);assert.ok(actual.wx> -65);assert.ok(client.outbound(['arrowup']).moves.length<=8);
});

test('Rust snapshot decoding rejects bad packets without replacing live prediction state',()=>{
  const seed=createBattle();Object.assign(seed,{phase:'racing',multiplayer:true,human:true,supplies:[]});
  const server=new ArenaCore(seed),client=new ArenaClient();client.accept(server.packet(),0);const before=client.snapshot();
  assert.throws(()=>client.accept(new Uint8Array([1,2,3]),.1),/snapshot rejected/);
  assert.deepEqual(client.snapshot(),before);
});

test('Rust shooting appears immediately and server confirmation produces neither duplicate projectiles nor sounds',()=>{
  const seed=createBattle();Object.assign(seed,{phase:'racing',multiplayer:true,human:true,supplies:[],wx:-65,wz:0,heading:0,motionHeading:0,cameraHeading:0,fireCooldown:0});
  for(const bot of seed.bots)Object.assign(bot,{inactive:true,destroyed:1e9});
  const server=new ArenaCore(seed),client=new ArenaClient();client.accept(server.packet(),0);client.frame(1/60,[],1/60);
  assert.equal(client.action('fire',undefined,1/60),true);
  let view=client.present();assert.equal(view.ammo,4);assert.equal(view.projectiles.length,1);assert.deepEqual(view.events,['fire']);
  const input=client.outbound([]);server.step(1/60,[{actor:0,...input}]);client.accept(server.packet(),1/60);client.frame(0,[],1/60);
  view=client.present();assert.equal(view.ammo,4);assert.equal(view.projectiles.length,1);assert.deepEqual(view.events,[]);
});

test('Rust bomber feedback spends stink ammo and shows the bomb before any server reply',()=>{
  const seed=createBattle();Object.assign(seed,{phase:'racing',multiplayer:true,human:true,bomber:true,bombAmmo:2,stinkAmmo:2,supplies:[]});
  const server=new ArenaCore(seed),client=new ArenaClient();client.accept(server.packet(),0);client.frame(0,[],.01);
  assert.equal(client.action('bomb',{wx:30,wz:40,kind:'stink'},.01),true);
  let view=client.present();assert.equal(view.stinkAmmo,1);assert.equal(view.bombAmmo,2);assert.equal(view.bombs.length,1);assert.equal(view.bombs[0].kind,'stink');assert.equal(view.bombs[0].wx,30);
  const input=client.outbound([]);server.step(1/60,[{actor:0,...input}]);client.accept(server.packet(),.02);client.frame(0,[],.02);
  view=client.present();assert.equal(view.stinkAmmo,1);assert.equal(view.bombs.length,1);assert.deepEqual(view.events,[]);
});

test('Rust pickup feedback hides the item, updates inventory and plays its cue in the same frame',()=>{
  const seed=createBattle();Object.assign(seed,{phase:'racing',multiplayer:true,human:true,wx:-65,wz:0,supplies:[{id:0,wx:-65,wz:0,kind:'missile',cooldown:0,version:0}]});
  for(const bot of seed.bots)Object.assign(bot,{inactive:true,destroyed:1e9});
  const server=new ArenaCore(seed),client=new ArenaClient();client.accept(server.packet(),0);client.frame(0,[],.01);
  let view=client.present();assert.equal(view.missiles,2);assert.equal(view.item,'missile');assert.equal(view.supplies[0].cooldown,8);assert.deepEqual(view.events,['pickup']);
  client.frame(1/60,[],1/60);const input=client.outbound([]);server.step(1/60,[{actor:0,...input}]);client.accept(server.packet(),.02);client.frame(0,[],.02);
  view=client.present();assert.equal(view.missiles,2);assert.equal(view.supplies[0].cooldown,8);assert.deepEqual(view.events,[]);
});

test('a contested pickup returns a Rust guest to the authoritative inventory',()=>{
  const seed=createBattle();Object.assign(seed,{phase:'racing',multiplayer:true,human:true,wx:-65,wz:0,supplies:[{id:0,wx:-65,wz:0,kind:'missile',cooldown:0,version:0}]});
  Object.assign(seed.bots[0],{human:true,wx:-65,wz:0});for(const bot of seed.bots.slice(1))Object.assign(bot,{inactive:true,destroyed:1e9});
  const server=new ArenaCore(seed),client=new ArenaClient();client.accept(server.packet(1),0);client.frame(0,[],.01);assert.equal(client.present().missiles,2);
  server.step(1/60,[{actor:0,keys:[],moves:[]},{actor:1,keys:[],moves:[]}]);client.accept(server.packet(1),.02);client.frame(0,[],.02);
  assert.equal(client.present().missiles,1);
});

test('fresh drift sparks stay attached to the rendered wheels when network UI updates fall just before a render',()=>{
  const seed=createBattle();Object.assign(seed,{phase:'racing',multiplayer:true,human:true,wx:-65,wz:70,heading:Math.PI/2,motionHeading:Math.PI/2,cameraHeading:Math.PI/2,speed:250,supplies:[]});
  for(const bot of seed.bots)Object.assign(bot,{inactive:true,destroyed:1e9});
  const server=new ArenaCore(seed),client=new ArenaClient();client.accept(server.packet(),0);let fresh=0;
  for(let frame=1;frame<=24;frame++){
    const now=frame/60,keys=['arrowup','arrowright','shift'];client.frame(0,keys,now-.0002);client.frame(1/60,keys,now);
    const view=client.present(),tx=Math.sin(view.heading),tz=Math.cos(view.heading);
    const wheels=[{wx:view.wx-tx*1.5-tz*1.6,wz:view.wz-tz*1.5+tx*1.6},{wx:view.wx-tx*1.5+tz*1.6,wz:view.wz-tz*1.5-tx*1.6}];
    for(const spark of view.driftParticles.filter(p=>p.kind==='spark'&&p.age<.001)){fresh++;assert.ok(Math.min(...wheels.map(w=>Math.hypot(spark.wx-w.wx,spark.wz-w.wz)))<=.05,'new sparks originate at the wheels in the displayed frame');}
  }
  assert.ok(fresh>0);
});

test('growing the Wasm heap between frames preserves the visible kart and immediate firing feedback',()=>{
  const seed=createBattle();Object.assign(seed,{phase:'racing',multiplayer:true,human:true,wx:-65,wz:0,heading:0,motionHeading:0,cameraHeading:0,fireCooldown:0,supplies:[]});
  for(const bot of seed.bots)Object.assign(bot,{inactive:true,destroyed:1e9});
  const server=new ArenaCore(seed),client=new ArenaClient();client.accept(server.packet(),0);client.frame(1/60,[],1/60);const view=client.present();
  client.core.memory.grow(1);client.outbound([]);assert.equal(view.wx,-65);assert.equal(view.health,3);
  client.core.memory.grow(1);assert.equal(client.action('fire',undefined,1/60),true);assert.equal(view.wx,-65);
  client.present();assert.equal(view.ammo,4);assert.equal(view.projectiles.length,1);assert.deepEqual(view.events,['fire']);
});
