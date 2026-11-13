import test from 'node:test';
import assert from 'node:assert/strict';
import { ActionAudio } from '../../audio/action-audio.js';

test('a shot sounds immediately and its confirmation does not echo or hide another player',()=>{
  const heard=[],audio=new ActionAudio(type=>heard.push(type));
  audio.accept({id:1,phase:'racing',elapsed:1,destroyed:0,finishCountdown:null,item:'hedgehog',ammo:5,fireCooldown:0},0);
  audio.action('fire',undefined,0);
  assert.deepEqual(heard,['fire']);
  const confirmed=[{id:'1:1',owner:1,type:'fire'},{id:'1:2',owner:0,type:'fire'},{id:'1:3',owner:1,type:'hit'}];
  assert.deepEqual(audio.confirmations(confirmed,.1),['fire','hit']);
  assert.deepEqual(audio.confirmations(confirmed,.12),[]);
});

test('held fire respects cooldown and does not spend the last round twice before confirmation',()=>{
  const heard=[],audio=new ActionAudio(type=>heard.push(type));
  audio.accept({id:0,phase:'racing',elapsed:1,destroyed:0,finishCountdown:null,item:'hedgehog',ammo:1,fireCooldown:0},0);
  audio.action('fire',undefined,0);audio.action('fire',undefined,.01);
  audio.accept({id:0,phase:'racing',elapsed:1.4,destroyed:0,finishCountdown:null,item:'hedgehog',ammo:1,fireCooldown:0},.4);
  audio.action('fire',undefined,.46);
  assert.deepEqual(heard,['fire']);
});

test('choosing a missile and launching chaff have immediate distinct cues',()=>{
  const heard=[],audio=new ActionAudio(type=>heard.push(type));
  audio.accept({id:0,phase:'racing',elapsed:1,destroyed:0,finishCountdown:null,item:'hedgehog',ammo:5,missiles:1,chaff:1,fireCooldown:0,chaffCooldown:0},0);
  audio.action('select','missile',0,5);audio.action('fire',undefined,.01,6);audio.action('chaff',undefined,.02,7);audio.action('chaff',undefined,.03,8);
  assert.deepEqual(heard,['missile','chaff']);
  assert.deepEqual(audio.confirmations([{id:'1:1',owner:0,type:'missile'},{id:'1:2',owner:0,type:'chaff'}],.1),[]);
});

test('empty weapons and destroyed players do not produce speculative firing cues',()=>{
  const heard=[],audio=new ActionAudio(type=>heard.push(type));
  audio.accept({id:0,phase:'racing',elapsed:1,destroyed:0,finishCountdown:null,item:'hedgehog',ammo:0,fireCooldown:0},0);
  audio.action('fire',undefined,0);
  audio.accept({id:0,phase:'racing',elapsed:2,destroyed:1,finishCountdown:null,item:'hedgehog',ammo:5,fireCooldown:0},.1);
  audio.action('fire',undefined,.1);
  assert.deepEqual(heard,[]);
});

test('replaying a drift correction does not repeat its charge cue',()=>{
  const heard=[],audio=new ActionAudio(type=>heard.push(type));
  audio.emit('driftCharge',0);audio.emit('driftCharge',.05);
  assert.deepEqual(heard,['driftCharge']);
});
