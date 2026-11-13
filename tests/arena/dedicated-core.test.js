import test from 'node:test';
import assert from 'node:assert/strict';
import {ArenaCore,ArenaClient} from '../../gameplay/arena-core.js';

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
