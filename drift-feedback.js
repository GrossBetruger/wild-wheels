import { driftWheels, emitDriftTrail, ageDriftEffects } from './combat.js';

// Cosmetic history follows rendered poses, never movement replay or packet arrival.
export class LocalDrift {
  scene={elapsed:0,skids:[],driftParticles:[]};previous=null;emitter=null;lastNow=null;identity=null;
  render(world,now,enabled=true){
    const identity=[world.soundEpoch,world.id,world.arena,world.phase,Boolean(world.destroyed)].join(':');
    const teleport=this.previous&&Math.hypot(world.wx-this.previous.wx,world.wz-this.previous.wz)>18;
    if(identity!==this.identity||teleport){
      this.scene={elapsed:0,skids:[],driftParticles:[]};this.previous=null;this.emitter=null;this.lastNow=null;this.identity=identity;
    }
    const dt=Math.max(0,now-(this.lastNow??now));this.lastNow=now;
    this.scene.elapsed+=dt;ageDriftEffects(this.scene,dt);
    const active=enabled&&world.phase==='racing'&&world.finishCountdown===null&&!world.destroyed&&world.wasDrifting;
    if(active){
      const level=world.drift>=.85?2:world.drift>=.45?1:0;
      if(!this.emitter)this.emitter={driftTrail:driftWheels(this.previous??world),driftEmit:.035,level};
      // A charge milestone must show its new color in this frame too.
      if(this.emitter.level!==level)this.emitter.driftEmit=.035;
      Object.assign(this.emitter,{id:world.id,wx:world.wx,wz:world.wz,heading:world.heading,drift:world.drift,level});
      emitDriftTrail(this.scene,this.emitter,Math.min(.05,dt));
    }
    if(!active)this.emitter=null;
    this.previous={wx:world.wx,wz:world.wz,heading:world.heading};
    return {...world,
      skids:[...world.skids.filter(s=>s.owner!==world.id),...this.scene.skids.map(s=>({...s,time:world.elapsed-(this.scene.elapsed-s.time)}))],
      driftParticles:[...world.driftParticles.filter(p=>p.owner!==world.id),...this.scene.driftParticles]
    };
  }
}
