import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, releaseChaff, tickBattle } from './combat.js';
import { encodeSnapshot, decodeSnapshot } from './wire.js';
import { ActionAudio } from './action-audio.js';
import { ChaffNotice } from './combat-notices.js';

test('a diverted missile circles once, falls without another turn, and explodes safely after the cloud expires',()=>{
  const world=createBattle();Object.assign(world,{phase:'racing',wx:-65,wz:0,shield:0,bots:[],supplies:[],chaffClouds:[{id:0,owner:0,wx:-65,wz:20,age:0,life:.1}],projectiles:[{kind:'missile',owner:99,target:null,decoy:0,decoyOwner:0,decoyCenter:{wx:-65,wz:20},wx:-60,wz:20,heading:Math.PI,speed:70,height:1.3,life:4,trail:[],orbitAge:0,orbitAngle:Math.PI/2,orbitRadius:5,orbitHeight:1.3,chaffed:true}]});
  const missile=world.projectiles[0];let rotation=0,previous=Math.PI,maxHeight=0,sawFall=false,sankWhileCircling=false,movedWhileFalling=false;
  for(let i=0;i<120;i++){
    const before={wx:missile.wx,wz:missile.wz};
    tickBattle(world,new Set(),1/60);maxHeight=Math.max(maxHeight,missile.height);
    rotation+=Math.atan2(Math.sin(missile.heading-previous),Math.cos(missile.heading-previous));previous=missile.heading;
    if(missile.orbitAge>0&&missile.orbitAge<.6&&missile.height<1.3)sankWhileCircling=true;
    if(missile.orbitAge>.6&&missile.height<.8)sawFall=true;
    if(missile.orbitAge>.6&&world.projectiles.includes(missile)&&Math.hypot(missile.wx-before.wx,missile.wz-before.wz)>.5)movedWhileFalling=true;
  }
  assert.ok(Math.abs(rotation-Math.PI*2)<1e-6);assert.ok(maxHeight<=1.3);assert.equal(sawFall,true);assert.equal(sankWhileCircling,true);assert.equal(movedWhileFalling,true);assert.ok(missile.wz<10);
  assert.equal(missile.height,.15);assert.equal(world.projectiles.length,0);assert.equal(world.chaffClouds.length,0);assert.equal(world.health,3);
  assert.ok(world.effects.some(effect=>effect.type==='explosion'));
});

test('chaff preserves either incoming turn and forward flight through one descending circle',()=>{
  for(const [heading,direction]of[[.35,-1],[-.35,1]]){
    const world=createBattle();Object.assign(world,{phase:'racing',wx:-65,wz:0,shield:0,bots:[],supplies:[],chaffClouds:[{id:0,owner:0,wx:-65,wz:20,age:0,life:8}],projectiles:[{kind:'missile',owner:99,target:null,decoy:0,decoyOwner:0,decoyCenter:{wx:-65,wz:20},wx:-65,wz:10,heading,speed:70,height:1.3,life:4,trail:[]}]});
    const missile=world.projectiles[0];let entered=false,previous=heading,rotation=0,movedAfterCircle=false;
    for(let frame=0;frame<120;frame++){
      const position={wx:missile.wx,wz:missile.wz};tickBattle(world,new Set(),1/60);const turn=Math.atan2(Math.sin(missile.heading-previous),Math.cos(missile.heading-previous));
      if(missile.orbitAge!==undefined){
        if(!entered){assert.ok(Math.abs(turn)<=.08,'entering the circle preserves the incoming heading');entered=true;}
        if(missile.orbitAge>0)rotation+=turn;
        assert.equal(missile.orbitDirection,direction);
        if(missile.orbitAge>.6&&world.projectiles.includes(missile)){assert.ok(Math.hypot(missile.wx-position.wx,missile.wz-position.wz)>1,'the missile keeps flying while it drops');movedAfterCircle=true;}
      }
      previous=missile.heading;
    }
    assert.equal(entered,true);assert.ok(Math.abs(rotation-direction*Math.PI*2)<1e-6);assert.equal(movedAfterCircle,true);assert.equal(world.projectiles.length,0);assert.equal(world.health,3);
  }
});

test('the green notice confirms only this player’s successful chaff diversion and expires once',()=>{
  const world=createBattle();Object.assign(world,{id:1,phase:'racing',soundEpoch:1,elapsed:2,chaffClouds:[]});
  const notice=new ChaffNotice();assert.equal(notice.sample(world,0),null);
  world.chaffClouds=[{id:0,owner:1,diversions:0}];assert.equal(notice.sample(world,.1),null);
  world.chaffClouds.push({id:1,owner:0,diversions:1,divertedAt:2});assert.equal(notice.sample(world,.2),null);
  world.chaffClouds[0]={id:0,owner:1,diversions:1,divertedAt:2};assert.ok(notice.sample(world,.3));
  assert.ok(notice.sample(world,1));assert.equal(notice.sample(world,2.31),null);assert.equal(notice.sample(world,3),null);
  world.chaffClouds[0].diversions=2;assert.ok(notice.sample(world,3.1));
  assert.equal(notice.sample({...world,phase:'finished'},3.2),null);
});

test('guest chaff keeps its kart color and emits one success cue when it diverts a missile',()=>{
  const world=createBattle();Object.assign(world,{phase:'racing',multiplayer:true,soundEpoch:1,destroyed:999,supplies:[]});
  const guest=world.bots[0];Object.assign(guest,{human:true,wx:-65,wz:0,heading:0,speed:0,color:'#df7053',chaff:2,chaffCooldown:0});world.bots=[guest];
  world.projectiles=[{kind:'missile',owner:0,target:1,wx:-65,wz:-30,heading:0,speed:70,height:1.3,life:2,trail:[]}];
  releaseChaff(world,guest);
  assert.equal(world.chaffClouds[0].color,'#df7053');assert.equal(world.chaffClouds[0].owner,1);
  const cue=world.events.filter(event=>event.type==='chaffDivert');assert.equal(cue.length,1);assert.equal(cue[0].owner,1);
  const decoded=decodeSnapshot(JSON.parse(encodeSnapshot({world}))).world;
  assert.equal(decoded.chaffClouds[0].color,'#df7053');
  const audio=new ActionAudio(()=>{});audio.accept({...decoded,id:1},0);
  assert.deepEqual(audio.confirmations(cue,0),['chaffDivert']);assert.deepEqual(audio.confirmations(cue,.1),[]);
  for(let i=0;i<10;i++)tickBattle(world,new Set(),1/60,new Map([[1,new Set()]]));
  assert.equal(world.events.filter(event=>event.type==='chaffDivert').length,1);
});

test('an existing cloud sounds when a later missile locks on but not on every subsequent tick',()=>{
  const world=createBattle();Object.assign(world,{phase:'racing',wx:-65,wz:0,heading:0,speed:0,color:'#8456cf',bots:[],supplies:[]});
  releaseChaff(world);
  assert.deepEqual(world.events,['chaff']);assert.equal(world.chaffClouds[0].color,'#8456cf');
  world.projectiles=[{kind:'missile',owner:1,target:0,wx:-65,wz:-30,heading:0,speed:70,height:1.3,life:2,trail:[]}];
  for(let i=0;i<10;i++)tickBattle(world,new Set(),1/60);
  assert.equal(world.projectiles[0].target,null);assert.equal(world.events.filter(event=>event==='chaffDivert').length,1);
});

test('chaff does not play a success cue for missiles targeting another player',()=>{
  const world=createBattle();Object.assign(world,{phase:'racing',wx:-65,wz:0,heading:0,bots:[],projectiles:[{kind:'missile',owner:1,target:2,wx:-65,wz:-30,life:2}]});
  releaseChaff(world);
  assert.deepEqual(world.events,['chaff']);assert.equal(world.projectiles[0].target,2);
});
