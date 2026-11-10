const cosmetic=value=>Math.round(value*100)/100;
const visualTime=value=>Math.round(value*1000)/1000;

// Only the wire format is compacted; server simulation keeps its full precision.
export function encodeSnapshot(state){
  const world=state.world;
  return JSON.stringify({...state,wireVersion:2,world:{...world,
    skids:world.skids.map(s=>[cosmetic(s.ax),cosmetic(s.az),cosmetic(s.bx),cosmetic(s.bz),visualTime(s.time),s.owner??-1]),
    driftParticles:world.driftParticles.map(p=>[cosmetic(p.wx),cosmetic(p.wz),cosmetic(p.height),cosmetic(p.vx),cosmetic(p.vz),cosmetic(p.vy),visualTime(p.age),visualTime(p.life),p.kind==='spark'?1:0,p.level,p.owner??-1]),
    projectiles:world.projectiles.map(shot=>({...shot,trail:shot.trail.map(p=>[cosmetic(p.wx),cosmetic(p.wz),cosmetic(p.height)])}))
  }});
}

function rows(value,width,limit){
  if(!Array.isArray(value)||value.length>limit||value.some(row=>!Array.isArray(row)||row.length!==width||row.some(n=>!Number.isFinite(n))))throw new Error('Invalid visual data');
  return value;
}
export function decodeSnapshot(state){
  if(state.wireVersion==null)return state;
  if(![1,2].includes(state.wireVersion))throw new Error('Unsupported game update');
  const world=state.world,owners=state.wireVersion===2;
  return {...state,world:{...world,
    skids:rows(world.skids,owners?6:5,512).map(([ax,az,bx,bz,time,owner=-1])=>({ax,az,bx,bz,time,...(owner>=0?{owner}:{})})),
    driftParticles:rows(world.driftParticles,owners?11:10,512).map(([wx,wz,height,vx,vz,vy,age,life,kind,level,owner=-1])=>({wx,wz,height,vx,vz,vy,age,life,kind:kind===1?'spark':'smoke',level,...(owner>=0?{owner}:{})})),
    projectiles:world.projectiles.map(shot=>({...shot,trail:rows(shot.trail,3,24).map(([wx,wz,height])=>({wx,wz,height}))}))
  }};
}
