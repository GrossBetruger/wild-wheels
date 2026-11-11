import test from 'node:test';
import assert from 'node:assert/strict';
import { createRace, tick, useItem, useTurbo, selectItem, cycleItem, LENGTH } from './engine.js';
import { sampleTrack } from './track.js';
test('a paused race keeps the player, opponents and clock still',()=>{const r=createRace();r.phase='paused';r.speed=400;tick(r,new Set(['arrowup']),.05);assert.equal(r.s,0);assert.equal(r.elapsed,0);assert.equal(r.bots[0].s,140);});
test('accelerating moves the kart and braking slows it',()=>{const r=createRace();r.phase='racing';for(let i=0;i<40;i++)tick(r,new Set(['arrowup']),.05);assert.ok(r.s>100);const speed=r.speed;tick(r,new Set(['arrowdown']),.05);assert.ok(r.speed<speed);});
test('the center turbo cell stores a separate boost and preserves the equipped weapon',()=>{const r=createRace();r.phase='racing';r.s=990;r.speed=400;tick(r,new Set(['arrowup']),.05);assert.equal(r.item,'hedgehog');assert.equal(r.turbos,1);useTurbo(r);assert.equal(r.item,'hedgehog');assert.equal(r.turbos,0);assert.equal(r.ammo,10);assert.equal(r.boost,3.6);});
test('missing every pickup lane awards no item',()=>{const r=createRace();r.phase='racing';r.item=null;r.ammo=0;r.s=990;r.speed=400;r.x=1.1;tick(r,new Set(['arrowup']),.05);assert.equal(r.item,null);assert.equal(r.ammo,0);});
test('three full laps records second place and keeps the kart moving',()=>{const r=createRace();r.phase='racing';r.s=LENGTH*3-10;r.speed=400;r.bots[0].s=LENGTH*3+30;tick(r,new Set(['arrowup']),.05);assert.equal(r.phase,'racing');assert.equal(r.finishRank,2);assert.ok(r.speed>0);});
test('a hedgehog hit consumes one shot and spins the opponent',()=>{const r=createRace();r.phase='racing';r.bots[0].s=170;r.bots[0].x=0;useItem(r);tick(r,new Set(),.05);assert.equal(r.ammo,9);assert.equal(r.bots[0].stun,3);assert.ok(r.bots[0].spin>6);assert.equal(r.projectiles.length,0);});
test('a barrier impact rebounds the kart and removes speed',()=>{const r=createRace();r.phase='racing';r.x=1.21;r.vx=2;r.speed=500;tick(r,new Set(['arrowright','arrowup']),.05);assert.equal(r.x,1.22);assert.ok(r.vx<0);assert.ok(r.speed<400);assert.ok(r.shake>0);});
test('kart contact pushes both racers apart',()=>{const r=createRace();r.phase='racing';r.speed=500;r.x=.05;r.bots[0].s=10;r.bots[0].x=0;tick(r,new Set(['arrowup']),.05);assert.ok(r.vx>0);assert.ok(r.bots[0].vx<0);assert.ok(r.speed<450);});
test('a missed projectile falls and bounces off the road',()=>{const r=createRace();r.phase='racing';r.x=1;useItem(r);for(let i=0;i<24;i++)tick(r,new Set(),.05);assert.equal(r.projectiles.length,1);assert.ok(r.projectiles[0].bounces>=1);assert.ok(r.projectiles[0].height>=.5);});
test('ten shots exhaust the starting ammo',()=>{const r=createRace();r.phase='racing';assert.equal(r.ammo,10);for(let shot=0;shot<11;shot++)useItem(r);assert.equal(r.ammo,0);assert.equal(r.item,null);assert.equal(r.projectiles.length,10);});
test('releasing a charged drift awards a temporary turbo',()=>{const r=createRace();r.phase='racing';r.s=3000;r.speed=500;r.x=-.7;for(let i=0;i<18;i++)tick(r,new Set(['arrowup','arrowright','shift']),.05);tick(r,new Set(['arrowup']),.05);assert.equal(r.boost,1.2);});
test('right arrow moves toward the camera right side of the road',()=>{const r=createRace();r.phase='racing';r.speed=300;const initial=sampleTrack(0);tick(r,new Set(['arrowright','arrowup']),.05);const center=sampleTrack(r.s/LENGTH),p=sampleTrack(r.s/LENGTH,r.x);const towardScreenRight=(p.x-center.x)*(-initial.tz)+(p.z-center.z)*initial.tx;assert.ok(towardScreenRight>0);});
test('left arrow moves toward the camera left side of the road',()=>{const r=createRace();r.phase='racing';r.speed=300;const initial=sampleTrack(0);tick(r,new Set(['arrowleft','arrowup']),.05);const center=sampleTrack(r.s/LENGTH),p=sampleTrack(r.s/LENGTH,r.x);const towardScreenRight=(p.x-center.x)*(-initial.tz)+(p.z-center.z)*initial.tx;assert.ok(towardScreenRight<0);});
test('each field includes two strong rivals and a spread of lower skills',()=>{
  const r=createRace(0,0,()=>.5);
  const skills=r.bots.map(b=>b.skill).sort((a,b)=>b-a);
  assert.equal(skills.length,5);
  assert.ok(skills[0]>=.94&&skills[0]<=1);
  assert.ok(skills[1]>=.86&&skills[1]<=.93);
  assert.ok(skills[4]>=.35&&skills[4]<=.51);
  assert.equal(new Set(skills).size,5);
});
test('new race draws change which characters receive the strongest skills',()=>{
  const first=createRace(0,0,()=>.2),second=createRace(0,0,()=>.8);
  const firstLeader=first.bots.reduce((a,b)=>a.skill>b.skill?a:b);
  const secondLeader=second.bots.reduce((a,b)=>a.skill>b.skill?a:b);
  assert.notEqual(firstLeader.driver,secondLeader.driver);
  assert.notEqual(firstLeader.skill,secondLeader.skill);
});
test('elite rivals finish three laps faster than unboosted player pace and weaker rivals',()=>{
  const r=createRace(0,0,()=>.5);r.phase='racing';
  const expert=r.bots.find(b=>b.skill===.97),rookie=r.bots.find(b=>b.skill===.43);
  let expertFinish=0,rookieFinish=0,sawBoost=false;
  // The player stays parked; opponent pace must come from driving, not player catch-up.
  for(let frame=0;frame<2200;frame++){
    tick(r,new Set(),.05);
    if(expert.boost>0)sawBoost=true;
    if(expert.finished&&!expertFinish)expertFinish=r.elapsed;
    if(rookie.finished&&!rookieFinish)rookieFinish=r.elapsed;
  }
  assert.ok(expertFinish>=68&&expertFinish<=80);
  assert.ok(rookieFinish>expertFinish+8);
  assert.ok(rookieFinish<105);
  assert.equal(sawBoost,true);
});
test('a stunned elite rival loses its boost and travels slowly',()=>{
  const r=createRace(0,0,()=>.5);r.phase='racing';
  const bot=r.bots[0];bot.s=5000;bot.speed=850;bot.boost=2;bot.stun=3;
  tick(r,new Set(),.05);
  assert.equal(bot.boost,0);
  assert.equal(bot.speed,130);
  assert.equal(bot.s,5006.5);
});
test('winning emits one announcement while driving, rivals and projectiles continue',()=>{
  const r=createRace(0,0,()=>.5);r.phase='racing';r.s=LENGTH*3-5;r.speed=400;
  useItem(r);tick(r,new Set(['arrowup']),.05);
  assert.equal(r.winner,'player');assert.equal(r.finishRank,1);assert.equal(r.events.filter(e=>e==='victory').length,1);
  const playerS=r.s,botS=r.bots[0].s,shotS=r.projectiles[0].s,time=r.elapsed;
  r.events=[];tick(r,new Set(['arrowup','arrowright']),.05);
  assert.equal(r.phase,'racing');assert.ok(r.s>playerS);assert.ok(r.bots[0].s>botS);assert.ok(r.projectiles[0].s>shotS);assert.ok(r.elapsed>time);assert.ok(r.vx>0);assert.equal(r.events.includes('victory'),false);
});
test('an opponent finishing does not announce a player result or start the end timer',()=>{
  const r=createRace(0,0,()=>.5);r.phase='racing';r.speed=400;r.bots[0].s=LENGTH*3-5;r.bots[0].speed=600;
  tick(r,new Set(['arrowup']),.05);
  assert.equal(r.winner,0);assert.equal(r.phase,'racing');assert.ok(r.speed>0);assert.equal(r.events.includes('finish'),false);assert.equal(r.finishRank,null);assert.equal(r.finishCountdown,null);
  const botS=r.bots[0].s;tick(r,new Set(['arrowup']),.05);assert.ok(r.bots[0].s>botS);
});
test('a rival who finished earlier still beats the player after being overtaken',()=>{
  const r=createRace(0,0,()=>.5);r.phase='racing';r.s=LENGTH*3-200;r.speed=400;r.x=-.6;r.bots[0].s=LENGTH*3-5;r.bots[0].speed=600;r.bots[0].x=.6;
  tick(r,new Set(['arrowup']),.05);
  r.s=LENGTH*3-5;r.bots[0].speed=0;r.bots[0].stun=3;r.speed=850;r.boost=1;r.events=[];
  tick(r,new Set(['arrowup']),.05);
  assert.ok(r.s>r.bots[0].s);assert.equal(r.finishRank,2);assert.equal(r.rank,2);assert.equal(r.events.includes('victory'),false);assert.equal(r.events.includes('finish'),true);
});
test('finishing behind all five opponents records sixth place once',()=>{
  const r=createRace(0,0,()=>.5);r.phase='racing';r.s=LENGTH*3-5;r.speed=400;
  for(const [i,bot] of r.bots.entries()){bot.s=LENGTH*3+100+i*100;bot.x=.8;}
  tick(r,new Set(['arrowup']),.05);
  assert.equal(r.finishRank,6);assert.equal(r.rank,6);assert.equal(r.events.includes('victory'),false);
  r.events=[];r.speed=850;r.boost=2;tick(r,new Set(['arrowup']),.05);
  assert.equal(r.finishRank,6);assert.equal(r.events.includes('finish'),false);
});
test('the race moves for three seconds after the player finishes then freezes',()=>{
  const r=createRace(0,0,()=>.5);r.phase='racing';r.s=LENGTH*3-5;r.speed=400;
  tick(r,new Set(['arrowup']),.05);const finishS=r.s,finishTime=r.finishTime;
  for(let i=0;i<59;i++)tick(r,new Set(['arrowup']),.05);
  assert.equal(r.phase,'racing');assert.ok(r.s>finishS);assert.equal(r.finishTime,finishTime);
  tick(r,new Set(['arrowup']),.05);
  assert.equal(r.phase,'finished');assert.equal(r.speed,0);assert.ok(r.bots.every(b=>b.speed===0));
  const positions=[r.s,...r.bots.map(b=>b.s)],elapsed=r.elapsed,ammo=r.ammo;
  tick(r,new Set(['arrowup','arrowright']),.05);useItem(r);
  assert.deepEqual([r.s,...r.bots.map(b=>b.s)],positions);assert.equal(r.elapsed,elapsed);assert.equal(r.ammo,ammo);assert.equal(r.finishRank,1);
});
test('pausing the finish announcement preserves its remaining time',()=>{
  const r=createRace(0,0,()=>.5);r.phase='racing';r.s=LENGTH*3-5;r.speed=400;
  tick(r,new Set(['arrowup']),.05);r.phase='paused';
  for(let i=0;i<100;i++)tick(r,new Set(),.05);
  assert.equal(r.finishCountdown,3);assert.equal(r.finishRank,1);
});
test('the earlier finish crossing wins even when another kart travels farther in the same frame',()=>{
  const r=createRace(0,0,()=>.5);r.phase='racing';r.s=LENGTH*3-5;r.speed=400;r.x=-.6;r.bots[0].s=LENGTH*3-15;r.bots[0].speed=800;r.bots[0].x=.6;r.bots[0].boost=1;
  tick(r,new Set(['arrowup']),.05);
  assert.ok(r.bots[0].s>r.s);assert.equal(r.winner,'player');assert.equal(r.finishRank,1);
});
test('the red pickup in the first right lane arms a missile without consuming hedgehogs',()=>{
  const r=createRace(0,0,()=>.5);r.phase='racing';r.s=990;r.x=.65;r.speed=400;
  tick(r,new Set(['arrowup']),.05);
  assert.equal(r.item,'missile');assert.equal(r.missiles,1);assert.equal(r.ammo,10);
  useItem(r);assert.equal(r.missiles,0);assert.equal(r.ammo,10);assert.equal(r.item,'hedgehog');assert.equal(r.projectiles[0].kind,'missile');
});
test('switching weapons keeps all collected ammunition and turbo cells',()=>{
  const r=createRace();r.phase='racing';r.missiles=2;r.turbos=1;
  cycleItem(r);assert.equal(r.item,'missile');cycleItem(r);assert.equal(r.item,'hedgehog');selectItem(r,'boost');assert.equal(r.item,'hedgehog');
  selectItem(r,'hedgehog');useItem(r);
  assert.equal(r.ammo,9);assert.equal(r.missiles,2);assert.equal(r.turbos,1);
});
test('an empty missile inventory cannot be selected or fired',()=>{
  const r=createRace();r.phase='racing';selectItem(r,'missile');assert.equal(r.item,'hedgehog');
  r.item='missile';useItem(r);assert.equal(r.missiles,0);assert.equal(r.projectiles.length,0);
});
test('missiles track a nearby rival and remove it from the race temporarily',()=>{
  const r=createRace(0,0,()=>.5);r.phase='racing';r.missiles=1;r.item='missile';
  for(const [i,bot] of r.bots.entries())bot.s=5000+i*500;
  const target=r.bots[0];target.s=500;target.x=.5;
  useItem(r);
  for(let i=0;i<40&&!target.destroyed;i++)tick(r,new Set(),.05);
  assert.equal(target.destroyed,4);assert.equal(target.speed,0);assert.equal(r.projectiles.length,0);assert.ok(r.effects.some(fx=>fx.type==='explosion'));
  const position=target.s;
  for(let i=0;i<60;i++)tick(r,new Set(),.05);
  assert.equal(target.s,position);assert.ok(target.destroyed>0);
  for(let i=0;i<30;i++)tick(r,new Set(),.05);
  assert.equal(target.destroyed,0);assert.ok(target.s>position);
});
test('a missile explosion destroys nearby karts but spares a distant opponent',()=>{
  const r=createRace(0,0,()=>.5);r.phase='racing';r.missiles=1;r.item='missile';
  r.bots[0].s=160;r.bots[0].x=0;r.bots[1].s=190;r.bots[1].x=.1;r.bots[2].s=6000;
  useItem(r);tick(r,new Set(),.05);
  assert.equal(r.bots[0].destroyed,4);assert.equal(r.bots[1].destroyed,4);assert.ok(!r.bots[2].destroyed);
});
test('missiles expire even when no rival is in front',()=>{
  const r=createRace(0,0,()=>.5);r.phase='racing';r.missiles=1;r.item='missile';r.bots=[];
  useItem(r);for(let i=0;i<105;i++)tick(r,new Set(),.05);
  assert.equal(r.projectiles.length,0);assert.equal(r.missiles,0);
});
test('a successful hedgehog hit starts a short celebration while driving continues',()=>{
  const r=createRace(0,0,()=>.5);r.phase='racing';r.speed=300;r.bots[0].s=170;r.bots[0].x=0;
  useItem(r);tick(r,new Set(['arrowup']),.05);
  assert.equal(r.celebrate,1.6);
  const position=r.s;r.projectiles=[];
  tick(r,new Set(['arrowup','arrowright']),.05);
  assert.ok(r.s>position);assert.ok(r.vx>0);assert.ok(r.celebrate>0);
  for(let i=0;i<33;i++)tick(r,new Set(['arrowup']),.05);
  assert.equal(r.celebrate,0);
});
test('destroying a kart with a missile also triggers celebration',()=>{
  const r=createRace(0,0,()=>.5);r.phase='racing';r.missiles=1;r.item='missile';r.bots[0].s=160;r.bots[0].x=0;
  useItem(r);tick(r,new Set(),.05);
  assert.equal(r.bots[0].destroyed,4);assert.equal(r.celebrate,1.6);
});
test('firing and missing does not celebrate',()=>{
  const r=createRace(0,0,()=>.5);r.phase='racing';r.bots=[];r.missiles=1;r.item='missile';
  useItem(r);assert.equal(r.celebrate,0);
  for(let i=0;i<110;i++)tick(r,new Set(),.05);
  assert.equal(r.celebrate,0);
});
test('pausing freezes an active celebration',()=>{
  const r=createRace();r.phase='paused';r.celebrate=1.2;
  tick(r,new Set(),.05);assert.equal(r.celebrate,1.2);
});
test('overtaking a nearby rival gives the passing driver a happy call',()=>{
  const r=createRace(0,0,()=>.5);r.phase='racing';r.speed=600;r.bots[0].s=8;r.bots[0].speed=100;r.bots[0].x=.6;
  tick(r,new Set(['arrowup']),.05);
  assert.ok(r.voices.some(v=>v.driver===0&&v.cue==='pass'));
  r.voices=[];r.bots[0].s=r.s+8;r.bots[0].speed=100;
  tick(r,new Set(['arrowup']),.05);
  assert.equal(r.voices.some(v=>v.driver===0&&v.cue==='pass'),false);
});
test('a rival passing the player uses its own animal voice',()=>{
  const r=createRace(0,0,()=>.5);r.phase='racing';r.speed=100;r.bots[0].s=-8;r.bots[0].speed=600;r.bots[0].x=.6;
  tick(r,new Set(['arrowup']),.05);
  assert.ok(r.voices.some(v=>v.driver===1&&v.cue==='pass'&&v.pan>0));
});
test('a hit produces a cheer from the attacker and a yelp from the victim',()=>{
  const r=createRace(0,0,()=>.5);r.phase='racing';r.bots[0].s=170;r.bots[0].x=0;
  useItem(r);tick(r,new Set(),.05);
  assert.ok(r.voices.some(v=>v.driver===0&&v.cue==='cheer'));
  assert.ok(r.voices.some(v=>v.driver===1&&v.cue==='hurt'));
});
test('crossing a lap triggers one animal call rather than repeating each frame',()=>{
  const r=createRace(2,0,()=>.5);r.phase='racing';r.s=LENGTH-5;r.speed=400;
  tick(r,new Set(['arrowup']),.05);assert.ok(r.voices.some(v=>v.driver===2&&v.cue==='lap'));
  r.voices=[];tick(r,new Set(['arrowup']),.05);assert.equal(r.voices.some(v=>v.cue==='lap'),false);
});
test('the winning animal calls once and nonwinning players do not make a victory call',()=>{
  const r=createRace(0,0,()=>.5);r.phase='racing';r.s=LENGTH*3-5;r.speed=400;r.bots[0].s=LENGTH*3+100;
  tick(r,new Set(['arrowup']),.05);
  assert.equal(r.finishRank,2);assert.ok(r.voices.some(v=>v.driver===1&&v.cue==='win'));assert.equal(r.voices.some(v=>v.driver===0&&v.cue==='win'),false);
  r.voices=[];tick(r,new Set(['arrowup']),.05);assert.equal(r.voices.some(v=>v.cue==='win'),false);
});
