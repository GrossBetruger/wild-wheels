import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattle } from '../../gameplay/combat.js';
import { createRace } from '../../gameplay/engine.js';
import { ordinal, matchResults, battleTieNotice } from '../../ui/results.js';

test('a host tied for the highest points wins even with more deaths, and the result explicitly reports the tie',()=>{
  const world=createBattle();Object.assign(world,{multiplayer:true,host:3,phase:'finished',finishRank:2,id:0,name:'Guest',kills:7,deaths:1});
  world.bots=[{id:3,driver:7,name:'Host',kills:7,deaths:9},{id:2,driver:2,name:'Other',kills:6,deaths:0}];
  assert.deepEqual(matchResults(world),[
    {place:1,name:'Host',you:false,kills:7,deaths:9},
    {place:2,name:'Guest · YOU',you:true,kills:7,deaths:1},
    {place:3,name:'Other',you:false,kills:6,deaths:0}
  ]);
  assert.equal(battleTieNotice(world),'TIE ON POINTS · HOST WINS');
});

test('a host with fewer points does not win another pair of players’ tie',()=>{
  const world=createBattle();Object.assign(world,{multiplayer:true,host:0,phase:'finished',finishRank:3,id:0,name:'Host',kills:6,deaths:0});
  world.bots=[{id:1,driver:1,name:'Sam',kills:7,deaths:3},{id:2,driver:2,name:'Jo',kills:7,deaths:1}];
  assert.deepEqual(matchResults(world).map(row=>[row.name,row.kills,row.deaths]),[['Jo',7,1],['Sam',7,3],['Host · YOU',6,0]]);
  assert.equal(battleTieNotice(world),'');
});

test('final battle leaderboard ranks by kills then fewer deaths and keeps player names',()=>{
  const world=createBattle();Object.assign(world,{id:0,name:'Alex',kills:5,deaths:3});
  world.bots=[{id:1,driver:1,name:'Sam',kills:10,deaths:4},{id:2,driver:2,name:'Jo',kills:5,deaths:1},{id:3,driver:3,name:'Left room',kills:20,deaths:0,inactive:true}];
  assert.deepEqual(matchResults(world),[
    {place:1,name:'Sam',you:false,kills:10,deaths:4},
    {place:2,name:'Jo',you:false,kills:5,deaths:1},
    {place:3,name:'Alex · YOU',you:true,kills:5,deaths:3}
  ]);
});

test('a guest gets the same final ordering and their own row is identified',()=>{
  const world=createBattle();Object.assign(world,{id:1,name:'Sam',kills:10,deaths:4});
  world.bots=[{id:0,driver:0,name:'Alex',kills:5,deaths:3},{id:2,driver:2,name:'Jo',kills:5,deaths:1}];
  assert.deepEqual(matchResults(world).map(row=>[row.place,row.name,row.you]),[[1,'Sam · YOU',true],[2,'Jo',false],[3,'Alex',false]]);
});

test('race results keep recorded finish order even after an overtake and label unfinished racers',()=>{
  const world=createRace();Object.assign(world,{name:'Alex',s:10000,finishOrder:[{id:0,time:90},{id:'player',time:95}]});
  world.bots=[{name:'Sam',driver:1,s:9000},{name:'Jo',driver:2,s:8000}];
  assert.deepEqual(matchResults(world),[
    {place:1,name:'Sam',you:false,time:90},
    {place:2,name:'Alex · YOU',you:true,time:95},
    {place:3,name:'Jo',you:false,time:null}
  ]);
});

test('placement labels cover every eight-player finish and teen exceptions',()=>{
  for(const [place,label]of [[1,'1ST PLACE'],[2,'2ND PLACE'],[3,'3RD PLACE'],[4,'4TH PLACE'],[5,'5TH PLACE'],[6,'6TH PLACE'],[7,'7TH PLACE'],[8,'8TH PLACE'],[11,'11TH PLACE'],[12,'12TH PLACE'],[13,'13TH PLACE'],[21,'21ST PLACE']])assert.equal(`${place}${ordinal(place)} PLACE`,label);
});
