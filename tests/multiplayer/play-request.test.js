import test from 'node:test';
import assert from 'node:assert/strict';
import { PlayRequestPrompt } from '../../networking/network.js';

test('the host sees who wants to play while guests and live matches get no popup',()=>{
  const state={code:'07',host:0,you:0,startRequest:{id:1,remainingMs:3000},world:{phase:'ready',soundEpoch:1},players:[{id:0,name:'Host'},{id:1,name:'Sam',wantsToPlay:true}]};
  const prompt=new PlayRequestPrompt();
  assert.deepEqual(prompt.sample(state).map(player=>player.name),['Sam']);
  assert.deepEqual(prompt.sample({...state,you:1}),[]);
  assert.deepEqual(prompt.sample({...state,world:{phase:'racing',soundEpoch:1}}),[]);
  assert.deepEqual(prompt.sample({...state,world:{phase:'finished',soundEpoch:1}}).map(player=>player.name),['Sam']);
});

test('host refusal closes the popup and a fresh request from the same guest opens it again',()=>{
  const state={code:'07',host:0,you:0,startRequest:{id:1,remainingMs:3000},world:{phase:'ready',soundEpoch:1},players:[{id:0,name:'Host'},{id:1,name:'Sam',wantsToPlay:true}]};
  const prompt=new PlayRequestPrompt();assert.deepEqual(prompt.sample(state).map(player=>player.name),['Sam']);
  assert.deepEqual(prompt.sample({...state,startRequest:null,players:[{id:0,name:'Host'},{id:1,name:'Sam',wantsToPlay:false,playRequestRefused:true}]}),[]);
  assert.deepEqual(prompt.sample({...state,startRequest:{id:2,remainingMs:3000}}).map(player=>player.name),['Sam']);
});

test('a withdrawn request leaves no popup, and later requests show every waiting guest',()=>{
  const state={code:'07',host:0,you:0,startRequest:{id:1,remainingMs:3000},world:{phase:'ready',soundEpoch:1},players:[{id:1,name:'Sam',wantsToPlay:true}]};
  const prompt=new PlayRequestPrompt();assert.deepEqual(prompt.sample({...state,startRequest:null,players:[{id:1,name:'Sam',wantsToPlay:false}]}),[]);
  const next={...state,startRequest:{id:2,remainingMs:3000},players:[{id:1,name:'Sam',wantsToPlay:true},{id:2,name:'Jo',wantsToPlay:true}]};
  assert.deepEqual(prompt.sample(next).map(player=>player.name),['Sam','Jo']);
});
