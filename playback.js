const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

// Render between server snapshots instead of chasing each arriving packet.
export class NetworkPlayback {
  frames=[];offset=null;lastNow=null;presented=null;
  clear(){this.frames=[];this.offset=null;this.lastNow=null;this.presented=null;}
  push(time,world,now=performance.now()/1000){
    if(!Number.isFinite(time))return;
    const previous=this.frames.at(-1);
    if(previous&&(world.arena!==previous.world.arena||world.phase!==previous.world.phase||world.id!==previous.world.id||time<previous.time))this.clear();
    if(this.frames.at(-1)?.time===time)this.frames.pop();
    this.frames.push({time,world,offset:now-time});
    if(this.frames.length>32)this.frames.shift();
    this.offset??=now-time;
  }
  sample(now=performance.now()/1000){
    if(!this.frames.length)return null;
    const latest=this.frames.at(-1),dt=clamp(now-(this.lastNow??now),0,.25);
    this.lastNow=now;
    const bestOffset=Math.min(...this.frames.map(frame=>frame.offset));
    this.offset+=clamp(bestOffset-this.offset,-dt*.1,dt*.1);
    const target=Math.min(latest.time,now-this.offset-.1);
    this.presented=Math.min(latest.time,Math.max(this.presented??target,target));
    const after=this.frames.find(frame=>frame.time>=this.presented)??latest;
    const index=this.frames.indexOf(after),before=this.frames[Math.max(0,index-1)];
    const fraction=after.time===before.time?1:clamp((this.presented-before.time)/(after.time-before.time),0,1);
    const earlier=new Map([before.world,...before.world.bots].map(actor=>[actor.id,actor]));
    const later=new Map([after.world,...after.world.bots].map(actor=>[actor.id,actor]));
    const pose=actor=>{
      const a=earlier.get(actor.id),b=later.get(actor.id);
      // Destruction, spawning and roster changes must never glide across the arena.
      if(!a||!b||actor.destroyed||a.destroyed||b.destroyed||Math.hypot(b.wx-a.wx,b.wz-a.wz)>18||Math.hypot(actor.wx-b.wx,actor.wz-b.wz)>18)return actor;
      const result={...actor,wx:a.wx+(b.wx-a.wx)*fraction,wz:a.wz+(b.wz-a.wz)*fraction};
      for(const field of ['heading','cameraHeading'])result[field]=a[field]+Math.atan2(Math.sin(b[field]-a[field]),Math.cos(b[field]-a[field]))*fraction;
      return result;
    };
    return {...pose(latest.world),bots:latest.world.bots.map(pose)};
  }
}
