import test from 'node:test';
import assert from 'node:assert/strict';
import { PlayRequestPrompt } from './network.js';

test('the host sees who wants to play while guests and live matches get no popup',()=>{
  const state={code:'07',host:0,you:0,world:{phase:'ready',soundEpoch:1},players:[{id:0,name:'Host'},{id:1,name:'Sam',wantsToPlay:true}]};
  const prompt=new PlayRequestPrompt();
  assert.deepEqual(prompt.sample(state).map(player=>player.name),['Sam']);
  assert.deepEqual(prompt.sample({...state,you:1}),[]);
  assert.deepEqual(prompt.sample({...state,world:{phase:'racing',soundEpoch:1}}),[]);
  assert.deepEqual(prompt.sample({...state,world:{phase:'finished',soundEpoch:1}}).map(player=>player.name),['Sam']);
});

test('not yet keeps guests ready without repeating the popup until another player requests play',()=>{
  const state={code:'07',host:0,you:0,world:{phase:'ready',soundEpoch:1},players:[{id:0,name:'Host'},{id:1,name:'Sam',wantsToPlay:true},{id:2,name:'Jo',wantsToPlay:false}]};
  const prompt=new PlayRequestPrompt();prompt.sample(state);prompt.dismiss(state);
  assert.deepEqual(prompt.sample(state),[]);assert.equal(state.players[1].wantsToPlay,true);
  const joined={...state,players:state.players.map(player=>({...player,wantsToPlay:player.id>0}))};
  assert.deepEqual(prompt.sample(joined).map(player=>player.name),['Sam','Jo']);
});

test('a withdrawn request can notify the host again and a new round resets dismissal',()=>{
  const state={code:'07',host:0,you:0,world:{phase:'ready',soundEpoch:1},players:[{id:1,name:'Sam',wantsToPlay:true}]};
  const prompt=new PlayRequestPrompt();prompt.sample(state);prompt.dismiss(state);
  assert.deepEqual(prompt.sample({...state,players:[{id:1,name:'Sam',wantsToPlay:false}]}),[]);
  assert.equal(prompt.sample(state).length,1);
  prompt.dismiss(state);
  assert.equal(prompt.sample({...state,world:{phase:'ready',soundEpoch:2}}).length,1);
});
