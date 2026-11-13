export const BICYCLE_LANDING=1.2;
export const hasBatCompanion=actor=>actor.driver===14||actor.batCompanion===true;
export function bicycleLanding(arena,x,z,heading){
  const blocked=(x,z)=>Math.abs(x)>arena.size-1||Math.abs(z)>arena.size-1||arena.blocks.some(([bx,bz,w,d])=>Math.abs(x-bx)<w/2+1&&Math.abs(z-bz)<d/2+1);
  for(const reach of [7,5,3,0]){const wx=x+Math.sin(heading)*reach,wz=z+Math.cos(heading)*reach;if(!blocked(wx,wz))return {wx,wz};}return {wx:x,wz:z};
}
export function bicyclePose(supply){
  const t=Math.max(0,Math.min(1,supply.age/BICYCLE_LANDING)),smooth=t*t*(3-2*t),travel=1-(1-t)**3;
  const glow=Math.max(0,Math.min(1,(supply.age-.8)/.4));
  return {x:supply.dropWx+(supply.wx-supply.dropWx)*travel,z:supply.dropWz+(supply.wz-supply.dropWz)*travel,height:(supply.dropHeight??0)*(1-smooth)+Math.sin(t*Math.PI)**2*2.2+.2*smooth,angle:supply.heading,roll:1.35*smooth+Math.sin(t*Math.PI*4)*.12*(1-t)**2,pitch:Math.sin(t*Math.PI*2)*.16*(1-t)**2,glow:glow*glow*(3-2*glow)};
}
export function tickBicycles(world,dt,arena){
  for(const supply of world.supplies)if(supply.kind==='bicycle')supply.age+=dt;
  for(const actor of [world,...world.bots]){
    if(world.specialAbilities!==false&&world.timeStop>0&&world.timeOwner!==actor.id)continue;
    const boosting=actor.driver===14&&actor.boost>0&&!actor.destroyed&&!actor.inactive&&!actor.afk&&!actor.bomber,drop=boosting&&!actor.owlBoosting;actor.owlBoosting=boosting;if(!drop)continue;
    const heading=actor.heading-(actor.yaw??0)+(actor.spin??0),end=bicycleLanding(arena,actor.wx,actor.wz,heading),progress=Math.max(0,Math.min(1,1-(actor.somersault??0)/.55));
    world.bicycleSequence=(world.bicycleSequence??0)+1;world.supplies.push({id:1000+world.bicycleSequence,...end,kind:'bicycle',heading,owner:actor.id,dropWx:actor.wx,dropWz:actor.wz,dropHeight:actor.somersault>0?Math.sin(progress*Math.PI)*5:0,age:0,cooldown:0,version:0,collector:null});
  }
}
