import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createBattle, predictKartMovement } from '../combat.js';
import { referenceAdvance } from './reference-movement.mjs';

const output=process.argv[2];
if(!output)throw new Error('Usage: node scripts/compare-movement.mjs results.json');
const reference=(world,actor,keys,dt)=>{
  const scene={mode:'combat',phase:world.phase,arena:world.arena,elapsed:world.elapsed,finishCountdown:null,events:[],effects:[],skids:[],driftParticles:[]};
  referenceAdvance(scene,actor,keys,dt);return scene.events;
};
const world=createBattle();Object.assign(world,{phase:'racing',elapsed:0});
const keys=[new Set(['arrowup']),new Set(['arrowup','arrowright']),new Set(['arrowup','arrowright','shift']),new Set(['arrowup']),new Set(['arrowdown','arrowleft'])];
const fresh=()=>({...world,wx:-65,wz:60,speed:0,heading:0,motionHeading:0,cameraHeading:0,drift:0,boost:0,driftTrail:null,driftEmit:0});
function run(step,mode,ticks){
  let actor=fresh();world.elapsed=0;
  const start=performance.now();
  for(let i=0;i<ticks;i++){
    if(mode==='reconciliation'&&i%2===0)actor={...actor};
    const held=keys[Math.floor(i%600/120)];
    step(world,actor,held,1/60);
    if(mode==='preview')step(world,{...actor},held,1/60);
    world.elapsed+=1/60;
  }
  const ms=(performance.now()-start)/ticks;
  // Keep final state observable so a JIT cannot discard unused simulation work.
  return {ms,actor};
}
const results=[];
for(const mode of ['resident','reconciliation','preview']){
  run(reference,mode,2000);run(predictKartMovement,mode,2000);
  const js=[],rust=[];
  let final;
  for(let round=0;round<7;round++){
    const actors=[];
    for(let offset=0;offset<2;offset++){
      const native=(round+offset)%2===1,result=run(native?predictKartMovement:reference,mode,4000);
      (native?rust:js).push(result.ms);actors[Number(native)]=result.actor;
    }
    for(const field of ['wx','wz','speed','heading','motionHeading','cameraHeading','drift','boost'])assert.ok(Math.abs(actors[0][field]-actors[1][field])<1e-8,field);
    final={wx:actors[1].wx,wz:actors[1].wz,speed:actors[1].speed};
  }
  const stats=values=>({batches:values.length,ticksPerBatch:4000,medianMs:[...values].sort((a,b)=>a-b)[3],meanMs:values.reduce((a,b)=>a+b,0)/values.length,batchesMs:values});
  results.push({mode,javascript:stats(js),rust:stats(rust),final});
}
const result={node:process.version,platform:process.platform,arch:process.arch,results};
await writeFile(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
