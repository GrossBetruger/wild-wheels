import { arenas, blocked, emitDriftTrail, SOMERSAULT_DURATION, DIZZY_DURATION } from '../combat.js';
// Frozen JavaScript movement model from d5c9b69, used only as a migration oracle.
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const angleDelta=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
const sound=(r,cue)=>r.events.push(cue),fx=(r,type)=>r.effects.push({type}),voice=()=>{};
function moveActor(r,actor,steer,gas,brake,dt,handbrake=false){
  if(actor.dizzy>0)steer=clamp(steer*.6+Math.sin((DIZZY_DURATION-actor.dizzy)*9)*.4,-1,1);
  // Chassis rotation and travel direction separate while the rear tires slide.
  const drifting=handbrake&&!(actor.somersault>0)&&!brake&&Math.abs(steer)>.1&&actor.speed>(actor.wasDrifting?70:110);
  const before=actor.drift;
  if(drifting){actor.drift=Math.min(1.2,actor.drift+dt);if(before<.45&&actor.drift>=.45)sound(r,'driftCharge',actor);if(before<.85&&actor.drift>=.85)sound(r,'driftChargeMax',actor);}
  if(!drifting&&actor.wasDrifting){
    if(!handbrake&&!brake&&actor.speed>90&&actor.drift>=.45&&r.finishCountdown===null){actor.boost=Math.max(actor.boost,actor.drift>=.85?1.35:.8);actor.motionHeading=actor.heading;fx(r,'boost',actor);}
    actor.drift=0;actor.driftTrail=null;
  }
  actor.wasDrifting=drifting;
  actor.heading-=steer*(drifting?4.8:1.7+Math.min(1,Math.abs(actor.speed)/300)*.7)*dt;
  actor.speed=clamp(actor.speed+(gas?(drifting?100:300):drifting?-90:-170)*dt-(brake?400*dt:0),brake?-160:0,drifting?400:actor.boost>0?850:520);
  if(actor.boost>0&&!drifting)actor.speed=Math.min(850,actor.speed+650*dt);
  actor.motionHeading+=angleDelta(actor.heading,actor.motionHeading)*(1-Math.exp(-(drifting?3.8:14)*dt));
  if(actor.somersault>0){
    const progress=clamp(1-actor.somersault/SOMERSAULT_DURATION,0,1),turn=progress*progress*(3-2*progress);
    actor.cameraHeading=actor.somersaultCameraStart+Math.PI*turn;
  }
  if(!(actor.somersault>0))actor.cameraHeading+=angleDelta(actor.heading,actor.cameraHeading)*(1-Math.exp(-(drifting?5:9)*dt));
  const travel=drifting||actor===r||actor.human?actor.motionHeading:actor.heading;
  const nx=actor.wx+Math.sin(travel)*actor.speed*.085*dt,nz=actor.wz+Math.cos(travel)*actor.speed*.085*dt;
  const arena=arenas[r.arena];
  if(!blocked(arena,nx,nz)){actor.wx=nx;actor.wz=nz;if(drifting)emitDriftTrail(r,actor,dt);return;}
  if(!blocked(arena,nx,actor.wz))actor.wx=nx;
  if(!blocked(arena,actor.wx,nz))actor.wz=nz;
  actor.speed*=.3;actor.drift=0;actor.wasDrifting=false;actor.driftTrail=null;actor.motionHeading=actor.heading;if(actor===r&&actor.wallCooldown<=0){fx(r,'crash',actor);actor.wallCooldown=.7;r.shake=.3;voice(r,actor,'hurt');}
}
export function referenceAdvance(world,actor,keys,dt){
  actor.dizzy=Math.max(0,(actor.dizzy??0)-dt);
  actor.somersault=Math.max(0,(actor.somersault??0)-dt);actor.somersaultCooldown=Math.max(0,(actor.somersaultCooldown??0)-dt);
  actor.boost=Math.max(0,(actor.boost??0)-dt);actor.human=true;
  const steer=keys.steer??(Number(keys.has('arrowright')||keys.has('d'))-Number(keys.has('arrowleft')||keys.has('a')));
  moveActor(world,actor,steer,keys.has('arrowup')||keys.has('w'),keys.has('arrowdown')||keys.has('s'),dt,keys.has('shift'));
  actor.yaw=steer*.12;
}
