import test from 'node:test';
import assert from 'node:assert/strict';
import {ArenaCore,ArenaClient} from '../../gameplay/arena-core.js';
import {decodeBinarySnapshot} from '../../networking/binary-wire.js';

test('eight-player snapshots reach every browser perspective and preserve predicted controls',()=>{
  const config={code:'00',maxPlayers:8,arena:0,bots:0,host:0,epoch:1,seed:123,players:Array.from({length:8},(_,id)=>({id,name:`Friend ${id}`,driver:id,role:'driver'}))};
  const game=ArenaCore.room(config);game.start();for(let step=0;step<182;step++)game.step(1/60);
  const client=new ArenaClient();client.accept(game.packet(7),0);client.frame(0,0,0);client.peek();
  const initial=client.state();assert.equal(initial.you,7);assert.equal(initial.maxPlayers,8);assert.equal(initial.world.name,'Friend 7');assert.equal(initial.world.bots.length,7);
  const before={wx:initial.world.wx,wz:initial.world.wz};client.frame(1/60,['w'],1/60);const outbound=client.outbound(['w']);
  game.step(1/60,[{actor:7,...outbound,keys:['w']}]);client.accept(game.packet(7),2/60);client.frame(0,['w'],2/60);client.peek();
  assert.equal(client.state().movementSequence,0);assert.ok(Math.hypot(client.state().world.wx-before.wx,client.state().world.wz-before.wz)>0);
  for(let id=0;id<8;id++){const browser=new ArenaClient();browser.accept(game.packet(id),0);browser.frame(0,0,0);browser.peek();assert.equal(browser.state().you,id);assert.equal(browser.state().world.name,`Friend ${id}`);}
});

test('dedicated capacity rejects a ninth slot while existing six-player arenas retain six slots',()=>{
  const room={code:'00',arena:0,bots:1,host:0,epoch:1,seed:1,players:[{id:0,name:'Host',driver:0,role:'driver'}]};
  assert.equal(ArenaCore.room(room).snapshot().bots.length,1);
  assert.throws(()=>ArenaCore.room({...room,maxPlayers:9}));
  assert.throws(()=>ArenaCore.room({...room,maxPlayers:8,players:[...room.players,{id:8,name:'Ninth',driver:1,role:'driver'}]}));
});

test('joining a bot slot does not claim its old kills or deaths, and historical names stay unchanged',()=>{
  const config={code:'00',maxPlayers:8,dedicated:true,host:null,arena:0,bots:1,epoch:1,players:[{id:0,name:'Alice',driver:0,role:'driver'}]};
  const game=ArenaCore.room(config),world=game.snapshot();
  Object.assign(world,{phase:'racing',elapsed:10,killSequence:2,killFeed:[
    {id:2,attacker:0,victim:1,attackerName:'Alice',victimName:'Rocco the Raccoon',text:'Alice → Rocco the Raccoon',time:9},
    {id:1,attacker:1,victim:0,attackerName:'Rocco the Raccoon',victimName:'Alice',text:'Rocco the Raccoon → Alice',time:8}
  ]});
  Object.assign(world.bots[0],{health:0,destroyed:2,kills:1,deaths:1});
  for(let id=2;id<8;id++)world.bots.push({id,inactive:true,destroyed:1e9});
  game.write(world);assert.equal(game.core.game_test_edit(game.inputLength),1);
  config.players.push({id:1,name:'Bob',driver:2,role:'driver'});game.configure(config);
  const joined=decodeBinarySnapshot(game.packet(1));
  assert.equal(joined.world.health,3);assert.equal(joined.world.destroyed,0);assert.equal(joined.world.kills,0);assert.equal(joined.world.deaths,0);
  assert.deepEqual(joined.world.killFeed.map(entry=>entry.text),['Alice → Rocco the Raccoon','Rocco the Raccoon → Alice']);
  config.players[0].name='Renamed Alice';game.configure(config);
  assert.deepEqual(decodeBinarySnapshot(game.packet(1)).world.killFeed.map(entry=>entry.text),['Alice → Rocco the Raccoon','Rocco the Raccoon → Alice']);
  assert.deepEqual(decodeBinarySnapshot(game.packet(0)).world.killFeed.map(entry=>entry.text),['YOU → Rocco the Raccoon','Rocco the Raccoon → YOU']);
  const battle=game.snapshot();battle.health=1;
  battle.projectiles=[{id:1,owner:1,target:0,kind:'missile',wx:battle.wx,wz:battle.wz,heading:0,speed:70,height:1.3,life:1,trail:[]}];
  for(let id=3;id<8;id++)battle.bots.push({id,inactive:true,destroyed:1e9});
  game.write(battle);assert.equal(game.core.game_test_edit(game.inputLength),1);game.step(1/60);
  assert.equal(decodeBinarySnapshot(game.packet(1)).world.killFeed[0].text,'YOU → Renamed Alice');
  config.players[1].name='Renamed Bob';game.configure(config);game.resume(1);
  assert.equal(decodeBinarySnapshot(game.packet(0)).world.killFeed[0].text,'Bob → YOU');
  assert.equal(decodeBinarySnapshot(game.packet(1)).world.killFeed[0].text,'YOU → Renamed Alice');
  assert.equal(decodeBinarySnapshot(game.packet(1)).world.kills,1);
});

test('joining after the finish starts fresh instead of inheriting a living bot’s score and inventory',()=>{
  const config={code:'00',maxPlayers:8,dedicated:true,host:null,arena:0,bots:1,epoch:1,players:[{id:0,name:'Alice',driver:0,role:'driver'}]};
  const game=ArenaCore.room(config),world=game.snapshot();
  world.phase='finished';Object.assign(world.bots[0],{health:1,kills:7,deaths:4,ammo:2,intelligenceBonus:3});
  for(let id=2;id<8;id++)world.bots.push({id,inactive:true,destroyed:1e9});
  game.write(world);assert.equal(game.core.game_test_edit(game.inputLength),1);
  config.players.push({id:1,name:'Bob',driver:2,role:'driver'});game.configure(config);
  const joined=decodeBinarySnapshot(game.packet(1));
  assert.equal(joined.world.health,3);assert.equal(joined.world.kills,0);assert.equal(joined.world.deaths,0);assert.equal(joined.world.ammo,10);assert.equal(joined.world.intelligenceBonus,0);
});
