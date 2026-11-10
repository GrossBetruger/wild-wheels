const cosmetic=value=>Math.round(value*100)/100;
const precise=(_,value)=>typeof value==='number'&&!Number.isInteger(value)&&Number.isFinite(value)&&Math.abs(value)<1e9?Math.round(value*1000)/1000:value;

// Only the wire format is compacted; server simulation keeps its full precision.
export function encodeSnapshot(state){
  const world=state.world;
  return JSON.stringify({...state,wireVersion:1,world:{...world,
    skids:world.skids.map(s=>[cosmetic(s.ax),cosmetic(s.az),cosmetic(s.bx),cosmetic(s.bz),s.time]),
    driftParticles:world.driftParticles.map(p=>[cosmetic(p.wx),cosmetic(p.wz),cosmetic(p.height),cosmetic(p.vx),cosmetic(p.vz),cosmetic(p.vy),p.age,p.life,p.kind==='spark'?1:0,p.level]),
    projectiles:world.projectiles.map(shot=>({...shot,trail:shot.trail.map(p=>[cosmetic(p.wx),cosmetic(p.wz),cosmetic(p.height)])}))
  }},precise);
}

function rows(value,width,limit){
  if(!Array.isArray(value)||value.length>limit||value.some(row=>!Array.isArray(row)||row.length!==width||row.some(n=>!Number.isFinite(n))))throw new Error('Invalid visual data');
  return value;
}
export function decodeSnapshot(state){
  if(state.wireVersion==null)return state;
  if(state.wireVersion!==1)throw new Error('Unsupported game update');
  const world=state.world;
  return {...state,world:{...world,
    skids:rows(world.skids,5,512).map(([ax,az,bx,bz,time])=>({ax,az,bx,bz,time})),
    driftParticles:rows(world.driftParticles,10,512).map(([wx,wz,height,vx,vz,vy,age,life,kind,level])=>({wx,wz,height,vx,vz,vy,age,life,kind:kind===1?'spark':'smoke',level})),
    projectiles:world.projectiles.map(shot=>({...shot,trail:rows(shot.trail,3,24).map(([wx,wz,height])=>({wx,wz,height}))}))
  }};
}
