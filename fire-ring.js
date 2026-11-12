import {damageBattle} from './combat.js';
import {frozen} from './special-abilities.js';
export const FIRE_RING_RADIUS=10;
export function tickFireRings(world,dt){
  world.effects=world.effects.filter(f=>f.type!=='fireRing');const actors=[world,...world.bots];
  for(const a of actors){
    if(frozen(world,a.id)){if(a.ringRemaining>0&&!a.afk&&!a.inactive&&!a.destroyed)world.effects.push({type:'fireRing',owner:a.id,wx:a.wx,wz:a.wz,age:0,life:.1});continue;}
    const delta=a.ringHeading==null?0:Math.atan2(Math.sin(a.heading-a.ringHeading),Math.cos(a.heading-a.ringHeading));a.ringHeading=a.heading;
    const turning=Math.abs(delta)>.001&&Math.abs(a.speed)>2;
    if(world.specialAbilities===false||a.driver!==10||a.inactive||a.afk||a.bomber||a.destroyed||world.phase!=='racing'||!turning){a.ringTurn=0;a.ringRemaining=0;a.ringSpent=false;a.ringDoses={};continue;}
    a.ringRemaining=Math.max(0,(a.ringRemaining??0)-dt);
    if(!a.ringRemaining&&!a.ringSpent){
      if(!a.wasDrifting){a.ringTurn=0;continue;}
      if(Math.sign(a.ringTurn??0)!==Math.sign(delta))a.ringTurn=0;
      a.ringTurn=(a.ringTurn??0)+delta;
      if(Math.abs(a.ringTurn)>=Math.PI*2&&a.drift>=.85){a.ringRemaining=20;a.ringSpent=true;world.events.push('boost');}
    }
    if(a.ringRemaining>0)world.effects.push({type:'fireRing',owner:a.id,wx:a.wx,wz:a.wz,age:0,life:.1});
  }
  for(const ring of world.effects.filter(f=>f.type==='fireRing')){
    const owner=actors.find(a=>a.id===ring.owner);owner.ringDoses??={};
    for(const a of actors){if(a.id===owner.id||frozen(world,a.id))continue;
      const touching=!a.inactive&&!a.afk&&!a.bomber&&!a.destroyed&&Math.abs(Math.hypot(a.wx-ring.wx,a.wz-ring.wz)-10)<=2.5;
      if(!touching){delete owner.ringDoses[a.id];continue;}
      owner.ringDoses[a.id]=(owner.ringDoses[a.id]??dt)-dt;
      if(owner.ringDoses[a.id]<=1e-8){owner.ringDoses[a.id]+=.3;damageBattle(world,a,owner.id,2,'fireRing');}
    }
  }
}
export function fireRingBlocks(world,ax,az,bx,bz){
  if(world.specialAbilities===false)return false;
  return world.effects.some(f=>{if(f.type!=='fireRing')return false;const dx=bx-ax,dz=bz-az,len=dx*dx+dz*dz,t=len?Math.max(0,Math.min(1,((f.wx-ax)*dx+(f.wz-az)*dz)/len)):0;return Math.hypot(ax+dx*t-f.wx,az+dz*t-f.wz)<=10.8&&Math.max(Math.hypot(ax-f.wx,az-f.wz),Math.hypot(bx-f.wx,bz-f.wz))>=9.2;});
}
