// Cosmetic history uses rendered positions for both the local rider and peers.
// No extra particles or animation state travel over the network.
export class YudaDrift {
  riders=new Map();sparks=[];lastTime=null;scene=null;sequence=0;
  update(world,time){
    const scene=`${world.soundEpoch}:${world.arena}:${world.id}`;
    if(scene!==this.scene||time<(this.lastTime??time)){this.riders.clear();this.sparks=[];this.lastTime=null;this.scene=scene;}
    const dt=Math.min(.05,Math.max(0,time-(this.lastTime??time))),elapsed=Math.max(0,time-(this.lastTime??time));this.lastTime=time;
    for(const spark of this.sparks){spark.age+=elapsed;spark.x+=spark.vx*dt;spark.z+=spark.vz*dt;spark.y+=spark.vy*dt;spark.vy-=18*dt;if(spark.y<.06){spark.y=.06;spark.vy=Math.abs(spark.vy)*.22;spark.vx*=.8;spark.vz*=.8;}}
    this.sparks=this.sparks.filter(spark=>spark.age<spark.life);
    const present=new Set();
    for(const actor of [world,...world.bots]){
      if(actor.driver!==10||actor.destroyed||actor.inactive||actor.afk||actor.bomber)continue;
      present.add(actor.id);
      let rider=this.riders.get(actor.id);
      const teleported=rider&&Math.hypot(actor.wx-rider.x,actor.wz-rider.z)>18;
      if(!rider||teleported){rider={roll:0,side:1,x:actor.wx,z:actor.wz,contact:null};this.riders.set(actor.id,rider);}
      const active=world.phase==='racing'&&actor.wasDrifting&&!(actor.somersault>0);
      const slip=Math.atan2(Math.sin(actor.heading-actor.motionHeading),Math.cos(actor.heading-actor.motionHeading));
      if(active&&Math.abs(slip)>.015)rider.side=-Math.sign(slip);
      const target=active?rider.side*1.12:0;
      rider.roll+=(target-rider.roll)*(1-Math.exp(-dt*(active?18:12)));
      if(actor.somersault>0)rider.roll=0;
      const c=Math.cos(actor.heading),s=Math.sin(actor.heading),roll=rider.roll;
      // The low exhaust/foot peg touches the floor on the inside of the slide.
      const localX=-Math.sign(roll||rider.side)*.65*Math.cos(roll)+.23*Math.sin(roll);
      const contact={x:actor.wx+localX*c-s*1.65,z:actor.wz-localX*s-c*1.65};
      if(active&&dt>0&&!teleported){
        const from=rider.contact??contact,distance=Math.hypot(contact.x-from.x,contact.z-from.z),steps=Math.min(8,Math.max(1,Math.ceil(distance/.45)));
        for(let step=1;step<=steps;step++)for(let i=0;i<6;i++){
          const n=this.sequence++,a=n*2.399,t=step/steps,speed=3+n%7;
          this.sparks.push({owner:actor.id,x:from.x+(contact.x-from.x)*t,y:.12,z:from.z+(contact.z-from.z)*t,vx:Math.cos(a)*speed-Math.sin(actor.motionHeading)*7,vz:Math.sin(a)*speed-Math.cos(actor.motionHeading)*7,vy:1.2+n%5*.55,age:0,life:.65+n%4*.1,hot:n%4===0});
        }
      }
      rider.contact=active?contact:null;rider.level=actor.drift>=.85?2:actor.drift>=.45?1:0;rider.x=actor.wx;rider.z=actor.wz;
    }
    for(const id of this.riders.keys())if(!present.has(id))this.riders.delete(id);
    this.sparks=this.sparks.slice(-1800);
  }
  roll(id){return this.riders.get(id)?.roll??0;}
}
