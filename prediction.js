import { predictKartMovement, MOVEMENT_DT } from './combat.js';

const fields=['wx','wz','speed','heading','motionHeading','cameraHeading','drift','wasDrifting','boost','yaw'];
const angle=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
const copy=world=>({...world,driftTrail:null,driftEmit:0});
export class LocalPrediction {
  actor=null;world=null;received=0;history=[];sounds=[];nextSequence=0;lastSent=-1;accumulator=0;error={wx:0,wz:0,heading:0,cameraHeading:0};
  clear(){this.actor=null;this.world=null;this.history=[];this.sounds=[];this.nextSequence=0;this.lastSent=-1;this.accumulator=0;this.error={wx:0,wz:0,heading:0,cameraHeading:0};}
  commands(limit=8){
    const commands=this.history.filter(command=>command.sequence>this.lastSent).slice(0,limit);
    if(commands.length)this.lastSent=commands.at(-1).sequence;
    return commands;
  }
  resend(){this.lastSent=-1;}
  accept(world,now,{sequence=-1}={}){
    const identity=!this.actor||this.world.id!==world.id||this.world.arena!==world.arena||this.world.soundEpoch!==world.soundEpoch||world.elapsed<this.world.elapsed;
    const reset=identity||this.world.phase!==world.phase||Boolean(this.world.destroyed)!==Boolean(world.destroyed);
    const old=this.actor,previousError=this.error;
    if(identity){this.history=[];this.nextSequence=sequence+1;this.lastSent=sequence;this.accumulator=0;}
    this.world=world;this.received=now;this.actor=copy(world);
    // The snapshot includes exactly these acknowledged ticks. Replay every later tick once.
    this.history=this.history.filter(command=>command.sequence>sequence);
    for(const command of this.history)predictKartMovement(world,this.actor,new Set(command.keys),MOVEMENT_DT);
    if(reset||Math.hypot(old.wx-this.actor.wx,old.wz-this.actor.wz)>18){this.error={wx:0,wz:0,heading:0,cameraHeading:0};return;}
    this.error={wx:old.wx+previousError.wx-this.actor.wx,wz:old.wz+previousError.wz-this.actor.wz,heading:angle(old.heading+previousError.heading,this.actor.heading),cameraHeading:angle(old.cameraHeading+previousError.cameraHeading,this.actor.cameraHeading)};
  }
  sample(keys,dt,now){
    if(!this.actor)return null;
    if(now-this.received<.5&&this.world.phase==='racing'&&this.history.length<120){
      this.accumulator+=Math.min(.05,Math.max(0,dt));
      while(this.accumulator>=MOVEMENT_DT-1e-8&&this.history.length<120){
        const held=[...keys].filter(key=>['arrowup','arrowdown','arrowleft','arrowright','w','a','s','d','shift'].includes(key));
        this.history.push({sequence:this.nextSequence++,keys:held});
        this.sounds.push(...(predictKartMovement(this.world,this.actor,new Set(held),MOVEMENT_DT)??[]));
        this.accumulator-=MOVEMENT_DT;
      }
    }
    const decay=Math.exp(-Math.max(0,dt)*15);
    const result=Object.fromEntries(fields.map(field=>[field,this.actor[field]]));
    // Present the fraction of a tick too: real RAF intervals alternate around 16.67 ms.
    // Previewing at most one tick keeps controls immediate without changing simulation.
    if(now-this.received<.5&&this.accumulator>1e-8){
      const future=copy(this.actor),fraction=Math.min(1,this.accumulator/MOVEMENT_DT);
      predictKartMovement(this.world,future,keys,MOVEMENT_DT);
      for(const field of ['wx','wz'])result[field]+=(future[field]-this.actor[field])*fraction;
      for(const field of ['heading','motionHeading','cameraHeading'])result[field]+=angle(future[field],this.actor[field])*fraction;
    }
    for(const field of Object.keys(this.error)){this.error[field]*=decay;result[field]+=this.error[field];}
    return result;
  }
}
