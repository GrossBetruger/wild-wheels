import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, predictKartMovement, somersaultBattle } from './combat.js';
import { simulationCore } from './rust-core.js';
import { referenceAdvance } from './scripts/reference-movement.mjs';

test('Rust driving preserves acceleration, steering, drifts, braking and wall collisions on both arenas',()=>{
  assert.equal(simulationCore,'rust-wasm');
  for(const arena of [0,1]){
    const world=createBattle(0,arena);Object.assign(world,{phase:'racing',elapsed:0});
    const actor={...world,wx:-65,wz:60,heading:0,motionHeading:0,cameraHeading:0,speed:0},reference=structuredClone(actor);
    const scene={...world,events:[],effects:[],skids:[],driftParticles:[]};
    for(let tick=0;tick<1200;tick++){
      const phase=tick%600;
      const keys=new Set(phase<180?['arrowup']:phase<300?['arrowup','arrowright']:phase<390?['arrowup','arrowright','shift']:phase<480?['arrowup']:['arrowdown','arrowleft']);
      predictKartMovement(world,actor,keys,1/60);referenceAdvance(scene,reference,keys,1/60);
      for(const field of ['wx','wz','speed','heading','motionHeading','cameraHeading','drift','boost'])assert.ok(Math.abs(actor[field]-reference[field])<1e-8,`${field}, arena ${arena}, tick ${tick}`);
      assert.equal(actor.wasDrifting,reference.wasDrifting);
    }
  }
});

test('Rust prediction reconciles external turbo, dizziness and somersault actions without changing their movement',()=>{
  const world=createBattle();Object.assign(world,{phase:'racing',elapsed:0});
  const actor={...world,wx:-65,wz:0,speed:200,heading:0,motionHeading:0,cameraHeading:0},reference=structuredClone(actor);
  const scene={...world,events:[],effects:[],skids:[],driftParticles:[]};
  for(let tick=0;tick<600;tick++){
    if(tick===30){actor.boost=2.5;reference.boost=2.5;}
    if(tick===90){actor.dizzy=4;reference.dizzy=4;}
    if(tick===120){somersaultBattle(world,actor);somersaultBattle(world,reference);}
    const keys=new Set(['arrowup',...(tick%100<60?['arrowright']:[])]);
    predictKartMovement(world,actor,keys,1/60);referenceAdvance(scene,reference,keys,1/60);
    for(const field of ['wx','wz','speed','heading','motionHeading','cameraHeading','boost','somersault','somersaultCooldown','dizzy'])assert.ok(Math.abs(actor[field]-reference[field])<1e-8,`${field}, tick ${tick}`);
  }
});

test('Rust keeps each kart independent and restores movement state after temporary prediction actors are discarded',()=>{
  const world=createBattle();Object.assign(world,{phase:'racing'});
  const driver={...world,wx:-65,wz:0,speed:100,heading:0,motionHeading:0,cameraHeading:0};
  predictKartMovement(world,driver,new Set(['arrowup']),1/60);
  for(let i=0;i<300;i++)predictKartMovement(world,{...world,wx:65,wz:0},new Set(['arrowdown']),1/60);
  const before=driver.wz;
  predictKartMovement(world,driver,new Set(['arrowup']),1/60);
  assert.equal(driver.speed,110);assert.ok(driver.wz>before);assert.equal(driver.wx,-65);
});
