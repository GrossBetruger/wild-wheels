import { selectItem, cycleItem } from '../gameplay/engine.js';

export class ActionAudio {
  pending=[];seen=new Set();cues=new Map();world=null;selected=null;fireAt=0;chaffAt=0;
  constructor(play){this.play=play;}
  accept(world,now,sequence=-1){
    if(!this.world||world.phase!==this.world.phase||Boolean(world.destroyed)!==Boolean(this.world.destroyed)||world.elapsed<this.world.elapsed){
      this.pending=[];this.selected=null;this.cues.clear();this.fireAt=now+(world.fireCooldown??0);this.chaffAt=now+(world.chaffCooldown??0);
    }
    this.world=world;this.received=now;
    if(this.selected&&sequence>=this.selected.sequence)this.selected=null;
    this.pending=this.pending.filter(event=>now-event.time<1);
  }
  emit(type,now,resource=null,key=null){
    if(!resource&&['driftCharge','driftChargeMax','boost'].includes(type)){
      if(now-(this.cues.get(type)??-Infinity)<.3)return;
      this.cues.set(type,now);
    }
    this.pending.push({type,time:now,resource,key});this.play(type);
  }
  available(resource){return (this.world?.[resource]??0)-this.pending.filter(event=>event.resource===resource).length;}
  action(type,item,now,sequence=-1){
    const world=this.world;if(!world)return;
    if(type==='select'||type==='cycle'){
      const choice={...world,item:this.selected?.item??world.item};
      if(type==='select')selectItem(choice,item);
      if(type==='cycle')cycleItem(choice);
      this.selected={item:choice.item,sequence};return;
    }
    if(world.phase!=='racing'||world.destroyed>0||world.finishCountdown!==null||now-this.received>.25)return;
    if(type==='chaff'){
      if(now<this.chaffAt||this.available('chaff')<=0)return;
      this.chaffAt=now+.65;this.emit('chaff',now,'chaff');return;
    }
    if(type!=='fire'||now<this.fireAt)return;
    const selected=this.selected?.item??world.item;
    if(selected==='boost'&&this.available('turbos')>0){
      this.fireAt=now+.2;this.emit('boost',now,'turbos');
      this.selected={item:this.available('missiles')>0?'missile':'hedgehog',sequence};return;
    }
    if(selected==='missile'&&this.available('missiles')>0){this.fireAt=now+.9;this.emit('missile',now,'missiles');return;}
    const vulcan=world.vulcan>0;
    if(!vulcan&&this.available('ammo')<=0)return;
    this.fireAt=now+(vulcan?.075:.45);this.emit(vulcan?'vulcanFire':'fire',now,vulcan?null:'ammo');
  }
  confirmations(events,now){
    return events.flatMap(event=>{
      if(typeof event==='string')return [event];
      if(this.seen.has(event.id))return [];
      this.seen.add(event.id);if(this.seen.size>256)this.seen.delete(this.seen.values().next().value);
      if(event.owner===this.world?.id){
        const index=this.pending.findIndex(pending=>pending.type===event.type&&now-pending.time<1&&(!event.key||pending.key===event.key));
        if(index>=0){this.pending.splice(index,1);return [];}
      }
      return [event.type];
    });
  }
}
