import test from 'node:test';
import assert from 'node:assert/strict';
import {createBattle,tickBattle} from '../../gameplay/combat.js';
import {useSpecial,characterAbilities} from '../../gameplay/special-abilities.js';
import {ArenaCore,ArenaClient} from '../../gameplay/arena-core.js';

for(const engine of ['JavaScript','Rust']){
  test(`${engine}: a locust navigates across the arena around walls before hitting`,()=>{
    const world=createBattle(5);Object.assign(world,{phase:'racing',human:true,wx:-65,wz:-60,supplies:[],locusts:[{id:1,owner:0,wx:-65,wz:0,age:1,jump:0,heading:0}]});
    world.bots.forEach((a,i)=>Object.assign(a,{human:true,inactive:i>0,destroyed:i>0?999:0,wx:65,wz:0,health:3,shield:0}));
    const core=engine==='Rust'?new ArenaCore(world):null,read=()=>core?core.snapshot():world;
    for(let i=0;i<1200&&read().locusts.length;i++){if(core)core.step(.05);else tickBattle(world,new Set(),.05);}
    assert.equal(read().locusts.length,0);assert.equal(read().bots[0].health,2);
  });
  test(`${engine}: Low-Cost Locust spawns two per opponent in groups of four`,()=>{
    const world=createBattle(5);Object.assign(world,{phase:'racing',human:true,supplies:[]});
    world.bots.forEach((a,i)=>Object.assign(a,{human:true,inactive:i>=3,destroyed:i>=3?999:0,wx:65,wz:0}));
    const core=engine==='Rust'?new ArenaCore(world):null;
    if(core)core.step(0,[{actor:0,actions:[{type:'special'}]}]);else assert.equal(useSpecial(world),true);
    const state=core?core.snapshot():world;
    assert.equal(state.locusts.length,6);assert.equal(state.effects.filter(f=>f.type==='locustSpawn').length,2);
    assert.ok(state.locusts.slice(0,4).every(b=>Math.abs(b.wx+65)<2&&Math.abs(b.wz+65)<2));
    assert.ok(state.locusts.slice(4).every(b=>Math.abs(b.wx-65)<2&&Math.abs(b.wz-65)<2));
    assert.equal(state.specialCooldown,20);
    if(core){const client=new ArenaClient();client.accept(core.packet(),0);client.frame(0,[],0);assert.equal(client.present().locusts.length,6);}
  });
  test(`${engine}: every exploding locust deals one damage and disappears only after hitting`,()=>{
    const world=createBattle(5);Object.assign(world,{phase:'racing',human:true,wx:-65,wz:0,supplies:[],locusts:[{id:1,owner:0,wx:65,wz:0,age:1,jump:.7},{id:2,owner:0,wx:65,wz:0,age:1,jump:.7}]});
    world.bots.forEach((a,i)=>Object.assign(a,{human:true,inactive:i>0,destroyed:i>0?999:0,wx:65,wz:1,health:3,shield:0}));
    const core=engine==='Rust'?new ArenaCore(world):null;if(core)core.step(.01);else tickBattle(world,new Set(),.01);
    const state=core?core.snapshot():world;assert.equal(state.bots[0].health,1);assert.equal(state.health,3);assert.equal(state.locusts.length,0);assert.equal(state.effects.filter(e=>e.type==='locustBurst').length,2);
  });
  test(`${engine}: old locusts remain alive without a target and never hurt either Tammy`,()=>{
    const world=createBattle(5);Object.assign(world,{phase:'racing',human:true,wx:65,wz:0,supplies:[],locusts:[{id:1,owner:0,wx:65,wz:0,age:1000,jump:0}]});
    world.bots.forEach((a,i)=>Object.assign(a,{driver:5,human:true,inactive:i>0,destroyed:i>0?999:0,wx:65,wz:1,health:3}));
    const core=engine==='Rust'?new ArenaCore(world):null;
    for(let i=0;i<200;i++){if(core)core.step(.05);else tickBattle(world,new Set(),.05);}
    const state=core?core.snapshot():world;assert.equal(state.locusts.length,1);assert.equal(state.health,3);assert.equal(state.bots[0].health,3);
  });
}
test('Tammy’s preview explains Low-Cost Locust and Cricket’s Jump separately',()=>{
  assert.deepEqual(characterAbilities(5).map(a=>a.title),['LOW-COST LOCUST','CRICKET’S JUMP']);
});
test('Tammy can activate Low-Cost Locust through the actual client command protocol',()=>{
  const world=createBattle(5);Object.assign(world,{phase:'racing',human:true,supplies:[]});
  world.bots.forEach((a,i)=>Object.assign(a,{human:true,inactive:i>0,destroyed:i>0?999:0}));
  const server=new ArenaCore(world),client=new ArenaClient();client.accept(server.packet(),0);client.frame(0,[],0);
  assert.equal(client.action('special',undefined,0),true);
  assert.equal(client.action('special',undefined,0),false);
  server.step(0,[{actor:0,...client.outbound([])}]);
  assert.equal(server.snapshot().locusts.length,2);
  client.accept(server.packet(),.02);client.frame(0,[],.02);
  assert.equal(client.action('special',undefined,.02),false);
});
test('Tammy deploys Low-Cost Locust when every opponent is a server-controlled bot',()=>{
  const server=ArenaCore.room({code:'00',maxPlayers:8,dedicated:true,host:null,arena:0,bots:3,epoch:1,players:[{id:0,name:'Tammy',driver:5,role:'driver'}]});
  server.start();for(let i=0;i<181;i++)server.step(1/60);
  assert.equal(server.snapshot().bots.filter(a=>!a.human).length,3);
  const client=new ArenaClient();client.accept(server.packet(),0);client.frame(0,[],0);
  assert.equal(client.action('special',undefined,0),true);server.step(.01,[{actor:0,...client.outbound([])}]);
  assert.equal(server.snapshot().locusts.length,6);
  client.accept(server.packet(),.02);client.frame(0,[],.02);assert.equal(client.present().locusts.length,6);
});
