export class KillCelebration {
  identity=null;elapsed=null;seen=new Set();queue=[];active=null;
  sample(world,now){
    const identity=[world.mode,world.soundEpoch,world.arena,world.id].join(':');
    const key=entry=>entry.id??`${entry.time}:${entry.attacker}:${entry.victim}`;
    const restarted=this.elapsed!==null&&world.elapsed<this.elapsed;this.elapsed=world.elapsed;
    if(identity!==this.identity||restarted){
      this.identity=identity;this.queue=[];this.active=null;
      // Joining an existing match must not celebrate kills from the previous occupant.
      this.seen=new Set((world.killFeed??[]).map(key));
    }
    if(world.mode!=='combat'||world.phase!=='racing'){
      this.queue=[];this.active=null;for(const entry of world.killFeed??[])this.seen.add(key(entry));return null;
    }
    for(const entry of [...world.killFeed].reverse()){
      const id=key(entry);if(this.seen.has(id))continue;
      this.seen.add(id);if(this.seen.size>256)this.seen.delete(this.seen.values().next().value);
      if(entry.attacker!==world.id||world.elapsed-entry.time>3)continue;
      const victim=[world,...world.bots].find(actor=>actor.id===entry.victim);
      this.queue.push({key:id,assist:entry.assist===true,title:entry.assist===true?'✦ CO-WHACKED ✦':entry.radiation===true?'✦ YOU RADIOWHACKED ✦':'✦ YOU WHACKED ✦',name:entry.victimName??victim?.name??'RIVAL',color:entry.victimColor??victim?.color??'#7251d2'});
    }
    this.queue=this.queue.slice(-16);
    if(this.active&&now>=this.active.until)this.active=null;
    if(!this.active&&this.queue.length)this.active={...this.queue.shift(),until:now+2};
    return this.active;
  }
}

export class ChaffNotice {
  identity=null;elapsed=null;seen=new Map();active=null;
  sample(world,now){
    const identity=[world.mode,world.soundEpoch,world.arena,world.id].join(':');
    const own=(world.chaffClouds??[]).filter(cloud=>cloud.owner===world.id);
    const restarted=this.elapsed!==null&&world.elapsed<this.elapsed;this.elapsed=world.elapsed;
    if(identity!==this.identity||restarted){this.identity=identity;this.active=null;this.seen=new Map(own.map(cloud=>[cloud.id,cloud.diversions??0]));}
    for(const cloud of own){
      const count=cloud.diversions??0,previous=this.seen.get(cloud.id)??0;this.seen.set(cloud.id,count);
      if(count>previous&&world.elapsed-cloud.divertedAt<3)this.active={key:`${cloud.id}:${count}`,until:now+2};
    }
    if(this.seen.size>64)this.seen.delete(this.seen.keys().next().value);
    if(world.mode!=='combat'||world.phase!=='racing'||world.destroyed>0){this.active=null;return null;}
    if(this.active&&now>=this.active.until)this.active=null;
    return this.active;
  }
}
