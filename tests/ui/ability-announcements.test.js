import test from 'node:test';
import assert from 'node:assert/strict';
import {AbilityUsage,abilityCards} from '../../ui/ability-announcements.js';
import {RewardQueue} from '../../ui/reward-notice.js';

test('having an ability does not announce it while idle, and an activation expires after 2.4 seconds',()=>{
  const tracker=new AbilityUsage(),queue=new RewardQueue(),world={mode:'combat',phase:'racing',soundEpoch:1,arena:0,elapsed:1,id:0,driver:5,specialCooldown:0,bots:[]};
  assert.deepEqual(tracker.sample(world),[]);assert.deepEqual(tracker.sample(world),[]);
  world.specialCooldown=20;const [event]=tracker.sample(world);assert.equal(event.title,'REVERSE PSYCHOLOGY');queue.show(event);
  assert.equal(queue.sample(0).theme,'locust');world.specialCooldown=19.9;assert.deepEqual(tracker.sample(world),[]);
  assert.equal(queue.sample(2.4),null);assert.deepEqual(tracker.sample(world),[]);
});
test('joining a match mid-ability does not replay an old announcement',()=>{
  const tracker=new AbilityUsage(),world={mode:'combat',phase:'racing',soundEpoch:1,arena:0,elapsed:10,id:0,driver:14,specialCooldown:17,specialActive:4,bots:[]};
  assert.deepEqual(tracker.sample(world),[]);world.specialActive=0;world.specialCooldown=13;assert.deepEqual(tracker.sample(world),[]);
});
test('Tax-Audit and Xylophone-Attack receive distinct designs and no disabled ability announces',()=>{
  const tracker=new AbilityUsage(),world={mode:'combat',phase:'racing',soundEpoch:1,arena:0,elapsed:1,id:0,driver:13,specialCooldown:0,specialActive:0,bots:[]};
  tracker.sample(world);world.specialCooldown=20;assert.equal(tracker.sample(world)[0].theme,'audit');
  world.specialCooldown=0;tracker.sample(world);world.specialCooldown=20;world.specialActive=5;assert.equal(tracker.sample(world)[0].theme,'xylophone');
  world.specialAbilities=false;world.specialCooldown=0;tracker.sample(world);world.specialCooldown=20;assert.deepEqual(tracker.sample(world),[]);
});
test('each character’s activated ability has its own visual theme',()=>{
  assert.equal(new Set(Object.values(abilityCards).map(card=>card.theme)).size,10);
});

test('driving across two Königsberg bridges announces 1/7 then 2/7 on the multiplayer HUD', async () => {
  const {createBattle, arenas} = await import('../../gameplay/combat.js');
  const {ArenaClient, ArenaCore} = await import('../../gameplay/arena-core.js');
  const world = Object.assign(createBattle(0), {
    arena:4, phase:'racing', wx:-35, wz:-36, heading:0, motionHeading:0, human:true,
    specialAbilities:false, supplies:[], arenaDef:{
      ...arenas[0], name:'Bridges of Königsberg', shape:'square', blocks:[],
      bridges:[[-35,-24,16,10,0],[-5,-24,16,10,0],[55,-32,16,12,0],
        [-35,24,16,10,0],[-5,24,16,10,0],[55,32,16,12,0],[15,0,10,18,1]],
      spawns:[], water:[]
    }
  });
  for(const bot of world.bots) bot.inactive=true;
  const core = new ArenaCore(world), client = new ArenaClient(), tracker = new AbilityUsage();
  const titles=[];
  let crossed=0;
  for(let frame=0; frame<300 && crossed!==9; frame++){
    core.step(1/60,[{actor:0,keys:['w']}]);
    client.accept(core.packet(0),frame/60);
    client.frame(0,[],frame/60);
    const displayed=client.present();
    crossed=displayed.eulerBridges;
    titles.push(...tracker.sample(displayed).map(event=>event.title));
  }
  assert.equal(crossed,9,'both bridge bits reach the local HUD');
  assert.deepEqual(titles,['1/7 BRIDGES','2/7 BRIDGES']);
});


test('Avita opening a wormhole shows the topology line to the caster and rivals',()=>{
  for(const viewer of [0,1]){
    const tracker=new AbilityUsage();
    const avita={id:0,driver:8,nightmareCooldown:0,specialCooldown:0};
    const rival={id:1,driver:5};
    const world={mode:'combat',phase:'racing',elapsed:1,...(viewer===0?avita:rival),bots:[viewer===0?rival:avita]};
    const caster=viewer===0?world:avita;
    tracker.sample(world);
    caster.nightmareCooldown=30;
    const [notice]=tracker.sample(world);
    assert.equal(notice.title,'WORMHOLE');
    assert.equal(notice.detail,'Can you handle the topology');
    caster.specialCooldown=30;
    assert.equal(tracker.sample(world)[0].title,viewer===0?'SPECIAL RELATIVITY':'TIME DILATION');
  }
});
