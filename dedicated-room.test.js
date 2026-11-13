import test from 'node:test';
import assert from 'node:assert/strict';
import {ArenaCore,ArenaClient} from './arena-core.js';
import {createBattle} from './combat.js';
import {NetworkGame,PlayRequestPrompt} from './network.js';
import {matchResults,battleTieNotice} from './results.js';
import {decodeBinarySnapshot} from './binary-wire.js';

test('a dedicated room has no host in either player’s snapshots or browser presentation',()=>{
  const room=ArenaCore.room({dedicated:true,maxPlayers:8,code:'00',host:null,arena:0,bots:0,epoch:1,players:[{id:0,name:'First',driver:0,role:'driver'},{id:1,name:'Second',driver:1,role:'driver'}]});
  for(const id of [0,1]){
    const snapshot=decodeBinarySnapshot(room.packet(id));assert.equal(snapshot.host,null);assert.equal(snapshot.dedicated,true);assert.equal(snapshot.startRequest,null);
    const client=new ArenaClient();client.accept(room.packet(id),0);client.frame(0,[],0);client.peek();assert.equal(client.state().host,null);assert.equal(client.state().dedicated,true);assert.equal(client.present().host,null);
  }
});

test('all dedicated players can configure the waiting room, and none can configure a running match',()=>{
  for(const id of [0,1]){
    const lobby=Object.assign(Object.create(NetworkGame.prototype),{dedicated:true,token:'joined',state:{host:null,you:id,world:{phase:'ready'},players:[{id:0,afk:false},{id:1,afk:false}]}});
    assert.equal(lobby.isHost,false);assert.equal(lobby.canControl,true);assert.equal(lobby.canConfigure,true);
    lobby.state.world.phase='racing';assert.equal(lobby.canConfigure,false);
    lobby.state.world.phase='finished';assert.equal(lobby.canConfigure,true);
    lobby.state.players[id].afk=true;assert.equal(lobby.canControl,false);assert.equal(lobby.canConfigure,false);
  }
});

test('dedicated rooms never display a captain’s play-request prompt',()=>{
  const prompt=new PlayRequestPrompt();
  assert.deepEqual(prompt.sample({dedicated:true,host:null,you:0,world:{phase:'ready'},startRequest:{id:1},players:[{id:1,name:'Second',wantsToPlay:true}]}),[]);
});

test('dedicated ties use fewer deaths without favoring the first player or announcing a host win',()=>{
  const w=createBattle(0);Object.assign(w,{multiplayer:true,host:null,phase:'racing',human:true,duration:.01,kills:5,deaths:3});for(const a of w.bots)Object.assign(a,{inactive:true,destroyed:999});Object.assign(w.bots[0],{human:true,inactive:false,destroyed:0,kills:5,deaths:1});
  const core=new ArenaCore(w);core.step(.02);const finished=core.snapshot();assert.equal(finished.finishRank,2);assert.equal(battleTieNotice(finished),'');assert.deepEqual(matchResults(finished).map(a=>[a.you,a.kills,a.deaths]),[[false,5,1],[true,5,3]]);
});

test('player-hosted rooms still require a host and dedicated rooms reject a hidden captain',()=>{
  const config={maxPlayers:8,code:'00',arena:0,bots:0,epoch:1,players:[{id:0,name:'First',driver:0,role:'driver'}]};
  assert.throws(()=>ArenaCore.room({...config,host:null}));assert.throws(()=>ArenaCore.room({...config,dedicated:true,host:0}));
  const hosted=ArenaCore.room({...config,host:0});assert.equal(hosted.snapshot().host,0);
});
