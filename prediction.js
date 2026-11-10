import { predictKartMovement } from './combat.js';

const fields=['wx','wz','speed','heading','motionHeading','cameraHeading','drift','wasDrifting','boost','yaw'];
const angle=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
const copy=world=>({...world,driftTrail:null,driftEmit:0});
export class LocalPrediction {
  actor=null;world=null;received=0;history=[];sounds=[];error={wx:0,wz:0,heading:0,cameraHeading:0};
  clear(){this.actor=null;this.world=null;this.history=[];this.sounds=[];this.error={wx:0,wz:0,heading:0,cameraHeading:0};}
  record(keys,now){
    const held=[...keys].filter(key=>['arrowup','arrowdown','arrowleft','arrowright','w','a','s','d','shift'].includes(key)).sort();
    if(this.history.at(-1)?.keys.join('|')===held.join('|'))return;
    this.history.push({now,keys:held});if(this.history.length>64)this.history.shift();
  }
  accept(world,now,latency=0){
    const reset=!this.actor||this.world.id!==world.id||this.world.arena!==world.arena||this.world.phase!==world.phase||Boolean(this.world.destroyed)!==Boolean(world.destroyed)||world.elapsed<this.world.elapsed;
    const old=this.actor,previousError=this.error;
    this.world=world;this.received=now;this.actor=copy(world);
    // Approximate in-flight movement using recent local input, capped at 150 ms.
    const start=now-Math.max(0,Math.min(.15,latency));
    for(let time=start;time<now-1e-8;){
      const next=this.history.find(entry=>entry.now>time+1e-8)?.now??now;
      const dt=Math.min(1/60,now-time,next-time);
      const keys=this.history.findLast(entry=>entry.now<=time)?.keys??[];
      predictKartMovement(world,this.actor,new Set(keys),dt);time+=dt;
    }
    if(reset||Math.hypot(old.wx-this.actor.wx,old.wz-this.actor.wz)>18){this.error={wx:0,wz:0,heading:0,cameraHeading:0};return;}
    this.error={wx:old.wx+previousError.wx-this.actor.wx,wz:old.wz+previousError.wz-this.actor.wz,heading:angle(old.heading+previousError.heading,this.actor.heading),cameraHeading:angle(old.cameraHeading+previousError.cameraHeading,this.actor.cameraHeading)};
  }
  sample(keys,dt,now){
    if(!this.actor)return null;
    this.record(keys,now);
    if(now-this.received<.25){
      let remaining=Math.min(.05,Math.max(0,dt));
      while(remaining>1e-8){const step=Math.min(1/60,remaining);this.sounds.push(...(predictKartMovement(this.world,this.actor,keys,step)??[]));remaining-=step;}
    }
    const decay=Math.exp(-Math.max(0,dt)*15);
    const result=Object.fromEntries(fields.map(field=>[field,this.actor[field]]));
    for(const field of Object.keys(this.error)){this.error[field]*=decay;result[field]+=this.error[field];}
    return result;
  }
}
