import test from 'node:test';
import assert from 'node:assert/strict';
import {ArenaCore} from './arena-core.js';
import {decodeBinarySnapshot} from './binary-wire.js';
import {ArenaClient} from './arena-core.js';

test('a Rust-created multiplayer room spawns distinct drivers and two of each bomb for its bomber',()=>{
  const core=ArenaCore.room({code:'07',host:0,arena:1,bots:2,epoch:3,seed:41,players:[{id:0,name:'Oren',driver:0,role:'driver'},{id:1,name:'Bomber',driver:2,role:'bomber'}]});
  const host=decodeBinarySnapshot(core.packet(0)),guest=decodeBinarySnapshot(core.packet(1));
  assert.equal(host.code,'07');assert.equal(host.host,0);assert.equal(host.bots,2);assert.equal(host.players.length,2);assert.equal(host.world.bots.length,3);
  assert.equal(host.world.phase,'ready');assert.equal(host.world.soundEpoch,3);assert.equal(host.world.health,3);assert.equal(host.world.ammo,10);assert.equal(host.world.chaff,4);
  assert.equal(guest.world.name,'Bomber');assert.equal(guest.world.driver,2);assert.equal(guest.world.bomber,true);assert.equal(guest.world.bombAmmo,2);assert.equal(guest.world.stinkAmmo,2);
  assert.notEqual(host.world.color,guest.world.color);assert.notEqual(host.world.wx,guest.world.wx);
  assert.equal(host.world.supplies.length,9);assert.equal(host.world.duration,180);assert.equal(host.world.targetScore,10);
});

test('lobby names, animal choices and guest play requests reach every player without rebuilding the world',()=>{
  const config={code:'25',host:0,arena:0,bots:0,epoch:1,players:[{id:0,name:'Host',driver:0,role:'driver'},{id:1,name:'Guest',driver:1,role:'driver'}]};
  const core=ArenaCore.room(config),before=core.snapshot(1);
  config.players[1]={id:1,name:'Fox 🦊',driver:2,role:'driver',wantsToPlay:true};config.startRequest={id:1,remainingMs:3000};core.configure(config);
  const packet=decodeBinarySnapshot(core.packet(1));
  assert.equal(packet.world.name,'Fox 🦊');assert.equal(packet.world.driver,2);assert.equal(packet.players[1].wantsToPlay,true);assert.equal(packet.startRequest.remainingMs,3000);
  assert.equal(packet.world.wx,before.wx);assert.equal(packet.world.wz,before.wz);assert.equal(packet.world.ammo,10);
  config.players[1].wantsToPlay=false;config.players[1].playRequestRefused=true;config.startRequest=null;core.configure(config);
  const refused=decodeBinarySnapshot(core.packet(1));assert.equal(refused.startRequest,null);assert.equal(refused.players[1].playRequestRefused,true);
});

test('starting a Rust room runs the three second countdown and a reset creates a fresh match epoch',()=>{
  const config={code:'14',host:0,arena:0,bots:0,epoch:1,players:[{id:0,name:'Host',driver:0,role:'driver'}]};
  const core=ArenaCore.room(config);core.start();assert.equal(core.status.phase,'countdown');assert.throws(()=>core.start(),/not ready/);
  for(let i=0;i<181;i++)core.step(1/60);
  assert.equal(core.status.phase,'racing');core.step(1/60,[{actor:0,keys:['arrowup']}]);assert.equal(core.snapshot().speed,5);
  const reset=ArenaCore.room({...config,epoch:2});assert.equal(reset.status.phase,'ready');assert.equal(reset.status.soundEpoch,2);assert.equal(reset.snapshot().speed,0);assert.equal(reset.snapshot().kills,0);
});

test('a player joining a running Rust room gets a live protected kart and departing host transfers without ending play',()=>{
  const config={code:'33',host:0,arena:0,bots:0,epoch:1,players:[{id:0,name:'Host',driver:0,role:'driver'}]};
  const core=ArenaCore.room(config);core.start();for(let i=0;i<181;i++)core.step(1/60);
  config.players.push({id:1,name:'Friend',driver:1,role:'driver'});core.configure(config);
  const guest=decodeBinarySnapshot(core.packet(1));assert.equal(guest.world.phase,'racing');assert.equal(guest.world.destroyed,0);assert.equal(guest.world.shield,2);assert.equal(guest.world.ammo,10);assert.equal(guest.world.bots.length,1);
  config.players.shift();config.host=1;core.configure(config);
  const transferred=decodeBinarySnapshot(core.packet(1));assert.equal(transferred.host,1);assert.equal(transferred.world.phase,'racing');assert.equal(transferred.world.bots.length,0);assert.equal(transferred.world.name,'Friend');
});

test('invalid or out of match room changes leave the current Rust game untouched',()=>{
  const config={code:'09',host:0,arena:0,bots:0,epoch:5,players:[{id:0,name:'Host',driver:0,role:'driver'}]};
  const core=ArenaCore.room(config);core.start();const before=core.packet(0);
  for(const change of [{...config,arena:1},{...config,epoch:6},{...config,players:[...config.players,...config.players]},{...config,players:[{...config.players[0],driver:3}]},{...config,players:[{...config.players[0],name:'x'.repeat(25)}]},{...config,bots:6}])assert.throws(()=>core.configure(change),/Invalid Rust room/);
  assert.deepEqual(core.packet(0),before);
  assert.throws(()=>ArenaCore.room({...config,code:'../'}),/Invalid Rust arena/);
});

test('late movement after a finished match is acknowledged without moving or crashing the game',()=>{
  const core=ArenaCore.room({code:'09',host:0,arena:0,bots:0,epoch:1,players:[{id:0,name:'Host',driver:0,role:'driver'}]});
  const world=core.snapshot();world.phase='finished';for(let id=1;id<6;id++)world.bots.push({id,inactive:true,destroyed:1e9});
  core.write(world);assert.equal(core.core.game_test_edit(core.inputLength),1);
  core.step(1/60,[{actor:0,keys:['arrowup'],moves:[{sequence:0,keys:['arrowup']}]}]);
  assert.doesNotThrow(()=>core.step(1/60,[{actor:0,keys:['arrowup'],moves:[{sequence:1,keys:['arrowup']}]}]));
  const after=decodeBinarySnapshot(core.packet(0));assert.equal(after.movementSequence,1);assert.equal(after.world.wx,world.wx);assert.equal(after.world.wz,world.wz);assert.equal(after.world.phase,'finished');
});

test('elephant, cricket, Roadster, astronaut sloth, worm pilot and Pearococo survive room configuration, packets and client presentation',()=>{
  const core=ArenaCore.room({code:'11',host:0,arena:0,bots:0,epoch:1,players:[{id:0,name:'Elon',driver:6,role:'driver'},{id:1,name:'Ellie',driver:4,role:'driver'},{id:2,name:'Tamar',driver:5,role:'driver'},{id:3,name:'Houston',driver:7,role:'driver'},{id:4,name:'Avita-Jas',driver:8,role:'driver'},{id:5,name:'Pearococo',driver:9,role:'driver'}]});
  for(const [viewer,driver,name]of[[0,6,'Elon'],[1,4,'Ellie'],[2,5,'Tamar'],[3,7,'Houston'],[4,8,'Avita-Jas'],[5,9,'Pearococo']]){
    const client=new ArenaClient();client.accept(core.packet(viewer),0);client.frame(0,[],0);const view=client.present();
    assert.equal(view.driver,driver);assert.equal(view.name,name);assert.equal(view.health,3);assert.equal(view.bots.length,5);
  }
  assert.throws(()=>core.configure({code:'11',host:0,arena:0,bots:0,epoch:1,players:[{id:0,name:'Invalid',driver:10,role:'driver'}]}),/Invalid Rust room/);
});

test('every Roadster and its chaff remain white across room slots and character changes',()=>{
  const config={code:'11',host:0,arena:0,bots:0,epoch:1,players:[{id:0,name:'First Roadster',driver:6,role:'driver'},{id:1,name:'Second Roadster',driver:6,role:'driver'}]};
  const core=ArenaCore.room(config);const first=decodeBinarySnapshot(core.packet(0)),second=decodeBinarySnapshot(core.packet(1));
  assert.equal(first.world.color,'#e8edf2');assert.equal(second.world.color,'#e8edf2');assert.deepEqual(first.players.map(player=>player.color),['#e8edf2','#e8edf2']);
  core.configure({...config,players:[{...config.players[0],driver:0},config.players[1]]});assert.equal(core.snapshot(0).color,'#8456cf');assert.equal(core.snapshot(1).color,'#e8edf2');
  core.start();for(let i=0;i<181;i++)core.step(1/60);core.step(1/60,[{actor:1,keys:[],actions:[{type:'chaff'}]}]);assert.equal(core.snapshot(1).chaffClouds[0].color,'#e8edf2');
});
