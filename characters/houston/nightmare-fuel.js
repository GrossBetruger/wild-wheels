import {damageBattle,arenas,blocked} from '../../gameplay/combat.js';
import {frozen} from '../../gameplay/special-abilities.js';
export const NIGHTMARE_DURATION=12,NIGHTMARE_COOLDOWN=30,NIGHTMARE_LENGTH=29;
export function activateNightmare(world,actor=world){
  if(world.specialAbilities===false||world.phase!=='racing'||world.finishCountdown!==null||actor.driver!==7||actor.destroyed>0||actor.inactive||actor.afk||actor.bomber||frozen(world,actor.id)||(actor.nightmareCooldown??0)>1e-8)return false;
  actor.nightmareActive=NIGHTMARE_DURATION;actor.nightmareCooldown=NIGHTMARE_COOLDOWN;actor.boost=NIGHTMARE_DURATION;
  actor.notice='NIGHTMARE FUEL';actor.noticeTime=2.4;return true;
}
export function tapNightmare(world,actor=world){
  if(actor.driver!==7||world.specialAbilities===false)return false;
  const previous=actor.nightmareTap;delete actor.nightmareTap;
  const double=previous!==undefined&&world.elapsed>=previous&&world.elapsed-previous<=.35;
  if(!double)actor.nightmareTap=world.elapsed;
  return double&&activateNightmare(world,actor);
}
export function tickNightmare(world,dt){
  const actors=[world,...world.bots];
  if(world.specialAbilities===false){for(const actor of actors){if(actor.nightmareActive>0)actor.boost=0;actor.nightmareActive=0;}return;}
  const hits=[];
  for(const source of actors){
    if(source.driver!==7||!(source.nightmareActive>0)||source.boost<=0||source.destroyed>0||source.inactive||source.afk||frozen(world,source.id))continue;
    for(const target of actors){
      if(target.id===source.id||target.destroyed>0||target.inactive||target.afk||target.bomber)continue;
      const dx=target.wx-source.wx,dz=target.wz-source.wz,behind=-dx*Math.sin(source.heading)-dz*Math.cos(source.heading),side=Math.abs(dx*Math.cos(source.heading)-dz*Math.sin(source.heading));
      if(behind<3.5||behind>3.5+NIGHTMARE_LENGTH||side>3)continue;
      const distance=Math.hypot(dx,dz);let clear=true;
      for(let along=3;along<distance;along+=3){if(blocked(arenas[world.arena],source.wx+dx*along/distance,source.wz+dz*along/distance,.4)){clear=false;break;}}
      if(clear)hits.push([target,source.id,Math.max(target.health,1)]);
    }
  }
  for(const [target,owner,health]of hits)damageBattle(world,target,owner,health,'nightmare');
  for(const actor of actors){
    if(frozen(world,actor.id))continue;
    actor.nightmareCooldown=Math.max(0,(actor.nightmareCooldown??0)-dt);
    actor.nightmareActive=actor.destroyed>0||actor.inactive||actor.afk||actor.boost<=0?0:Math.max(0,(actor.nightmareActive??0)-dt);
  }
}

// Shared by the browser renderer and the native graphics exporter.
export function drawNightmareFuel(glow,p,heading,time,jump=null){
  glow.at(p.x,.13+(jump?.height??0),p.z,heading);glow.pitch=jump?.pitch??0;glow.pivot=1.87;
  for(const side of [-.55,0,.55]){
    glow.flame(side,1.45,-3.55,.42,NIGHTMARE_LENGTH*(1+.025*Math.sin(time*49+side)),[.8,.08,1.4],time+side);
    glow.flame(side,1.45,-3.55,.2,NIGHTMARE_LENGTH*.82,[.5,.35,1.6],time+side);
  }
  for(let i=0;i<48;i++){
    const t=i/48,fade=1-t;
    glow.particle(Math.sin(time*42+i)*.25,1.45,-3.55-t*NIGHTMARE_LENGTH,(1.1-t*.7)*(1+.12*Math.sin(time*55+i)),[.6*fade,.1*fade,1.4*fade]);
  }
}
