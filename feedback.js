import { applySupply, makeProjectile, advanceProjectile, MOVEMENT_DT, MAX_HEALTH, validBombTarget } from './combat.js';
import { selectItem, cycleItem } from './engine.js';

const poseFields=['wx','wz','heading','motionHeading','cameraHeading','speed','drift','wasDrifting','boost','yaw','somersault','somersaultCooldown','dizzy'];
const resources=['ammo','missiles','turbos','health','hedgeShield','tehilim','chaff','item','notice','noticeTime'];
const pick=(object,fields)=>Object.fromEntries(fields.filter(field=>object[field]!==undefined).map(field=>[field,object[field]]));
const copyShot=shot=>({...shot,trail:shot.trail.map(point=>({...point}))});
function advance(world,shot,seconds){
  for(let left=Math.min(.5,Math.max(0,seconds));left>1e-8&&shot.life>0;){const dt=Math.min(MOVEMENT_DT,left);advanceProjectile(world,shot,dt);left-=dt;}
}
function presentShot(world,actual,age){
  const model=copyShot(actual),ahead=Math.max(0,(model.age??0)-age),previous=model.trail.at(-1);
  // A newly spawned server shot has already advanced one tick, even on localhost.
  if(ahead>0&&previous){
    const rewind=Math.min(MOVEMENT_DT,ahead),fraction=1-rewind/MOVEMENT_DT;
    for(const field of ['wx','wz','height'])model[field]=previous[field]+(model[field]-previous[field])*fraction;
    model.age-=rewind;model.life+=rewind;return model;
  }
  advance(world,model,age-(model.age??0));return model;
}

// Speculation changes only this browser's presentation. Server snapshots settle every operation.
export class LocalFeedback {
  world=null;operations=[];shots=new Map();rejected=new Set();nextId=0;lastSent=-1;fireTick=-1;chaffTick=-1;
  constructor(emit){this.emit=emit;}
  commands(){
    const actions=this.operations.filter(op=>op.type!=='pickup'&&op.id>this.lastSent).slice(0,8);
    if(actions.length)this.lastSent=actions.at(-1).id;
    return actions.map(({id,type,item,afterMove,wx,wz,kind})=>({id,type,afterMove,...(item?{item}:{}),...(type==='bomb'?{wx,wz,kind}:{})}));
  }
  resend(){this.lastSent=-1;}
  accept(state,now){
    const world=state.world,ack=state.actionSequence??-1,movement=state.movementSequence??-1;
    const identity=!this.world||world.soundEpoch!==this.world.soundEpoch||world.id!==this.world.id||world.arena!==this.world.arena;
    const reset=identity||world.phase!==this.world.phase||Boolean(world.destroyed)!==Boolean(this.world.destroyed);
    if(reset){this.operations=[];this.shots.clear();this.rejected.clear();this.fireTick=movement;this.chaffTick=movement;}
    if(identity){this.nextId=ack+1;this.lastSent=ack;}
    this.world=world;this.received=now;
    this.operations=this.operations.filter(op=>{
      if(op.type!=='pickup')return op.id>ack;
      const supply=world.supplies.find((s,index)=>(s.id??index)===op.supplyId);
      if(!supply||(supply.version??0)!==op.version)return false;
      if(movement<op.afterMove)return true;
      this.rejected.add(op.key);return false;
    });
    this.fireTick=Math.max(movement+Math.ceil((world.fireCooldown??0)/MOVEMENT_DT-1e-8),...this.operations.filter(op=>op.type==='fire').map(op=>op.readyTick));
    this.chaffTick=Math.max(movement+Math.ceil((world.chaffCooldown??0)/MOVEMENT_DT-1e-8),...this.operations.filter(op=>op.type==='chaff').map(op=>op.readyTick));
    for(const [id,entry] of this.shots){
      const actual=world.projectiles.find(shot=>shot.owner===world.id&&shot.actionId===id);
      if(!actual){if(id<=ack||now-entry.born>3.5)this.shots.delete(id);continue;}
      const elapsed=Math.max(0,now-entry.updated),decay=Math.exp(-elapsed*20);
      advance(world,entry.model,elapsed);
      const previous={wx:entry.model.wx+entry.error.wx*decay,wz:entry.model.wz+entry.error.wz*decay};
      const model=presentShot(world,actual,now-entry.born);
      entry.error={wx:previous.wx-model.wx,wz:previous.wz-model.wz};entry.model=model;entry.updated=now;
    }
  }
  inventory(pose){
    const actor={...this.world,...pick(pose,poseFields)};
    for(const op of this.operations)switch(op.type){
      case 'pickup':applySupply(actor,op.kind);break;
      case 'select':selectItem(actor,op.item);break;
      case 'turbo':actor.turbos=Math.max(0,actor.turbos-1);break;
      case 'fire':
        if(op.resource)actor[op.resource]=Math.max(0,actor[op.resource]-1);
        if(op.kind==='missile'&&!actor.missiles)actor.item='hedgehog';
        break;
      case 'chaff':actor.chaff=Math.max(0,actor.chaff-1);break;
      case 'bomb':{const resource=op.resource??'bombAmmo';actor[resource]=Math.max(0,actor[resource]-1);break;}
    }
    return actor;
  }
  action(type,item,pose,now,sequence){
    if(!this.world||this.operations.length>=64)return false;
    const actor=this.inventory(pose);
    if(actor.bomber){
      const kind=item?.kind??'abomb',resource=kind==='stink'?'stinkAmmo':'bombAmmo';
      if(type!=='bomb'||!['abomb','stink'].includes(kind)||actor.phase!=='racing'||actor.finishCountdown!==null||now-this.received>.5||!(actor[resource]>=1)||!validBombTarget(actor,item))return false;
      const id=this.nextId++;this.operations.push({id,type,kind,resource,afterMove:-1,wx:item.wx,wz:item.wz,born:now});this.emit('bombDrop',`action:${id}`);return true;
    }
    // A rendered fractional tick can touch a pickup just before the next full movement tick.
    const afterMove=Math.max(sequence,...this.operations.filter(op=>op.type==='pickup').map(op=>op.afterMove));
    if(type==='select'||type==='cycle'){
      if(type==='select')selectItem(actor,item);
      if(type==='cycle')cycleItem(actor);
      this.operations.push({id:this.nextId++,type:'select',item:actor.item,afterMove});return true;
    }
    if(actor.phase!=='racing'||actor.destroyed||actor.finishCountdown!==null||now-this.received>.5)return false;
    if(type==='somersault'){
      if((actor.somersaultCooldown??0)>1e-8||this.operations.some(op=>op.type==='somersault'))return false;
      this.operations.push({id:this.nextId++,type,afterMove:sequence});return true;
    }
    if(type==='turbo'){
      if(actor.turbos<=0||actor.boost>0||this.operations.some(op=>op.type==='turbo'))return false;
      const id=this.nextId++;this.operations.push({id,type,afterMove});this.emit('boost',`action:${id}`);return true;
    }
    if(type==='chaff'){
      if(sequence<this.chaffTick||actor.chaff<=0)return false;
      this.chaffTick=afterMove+39;this.operations.push({id:this.nextId++,type,afterMove,readyTick:this.chaffTick});this.emit('chaff');return true;
    }
    if(type!=='fire'||sequence<this.fireTick)return false;
    const kind=actor.item==='missile'&&actor.missiles>0?'missile':'hedgehog';
    const vulcan=kind==='hedgehog'&&actor.vulcan>0,resource=kind==='missile'?'missiles':vulcan?null:'ammo';
    if(resource&&actor[resource]<=0)return false;
    const cooldown=kind==='missile'?.9:vulcan?.075:.225,id=this.nextId++;
    this.fireTick=afterMove+Math.ceil(cooldown/MOVEMENT_DT-1e-8);
    this.operations.push({id,type:'fire',kind,resource,afterMove,readyTick:this.fireTick});
    this.shots.set(id,{born:now,updated:now,model:{...makeProjectile({...this.world,...actor},actor),id:`local:${this.world.soundEpoch}:${id}`,actionId:id},error:{wx:0,wz:0}});
    this.emit(kind==='missile'?'missile':vulcan?'vulcanFire':'fire',`action:${id}`);return true;
  }
  render(world,pose,now,sequence){
    if(!this.world)return {...world,...pose};
    let actor=this.inventory(pose);
    if(actor.bomber)return {...world,bombAmmo:actor.bombAmmo,stinkAmmo:actor.stinkAmmo,bombs:[...(world.bombs??[]),...this.operations.filter(op=>op.type==='bomb'&&!world.bombs?.some(bomb=>bomb.owner===world.id&&bomb.actionId===op.id)).map(op=>({id:`local:${op.id}`,kind:op.kind,actionId:op.id,owner:world.id,wx:op.wx,wz:op.wz,age:Math.max(0,now-op.born),color:world.color}))]};
    if(actor.phase==='racing'&&!actor.destroyed&&actor.finishCountdown===null&&now-this.received<.5){
      for(const [index,supply] of this.world.supplies.entries()){
        const supplyId=supply.id??index,version=supply.version??0,key=`pickup:${supplyId}:${version+1}`,distance=Math.hypot(actor.wx-supply.wx,actor.wz-supply.wz);
        if(distance>=4){this.rejected.delete(key);continue;}
        if(supply.cooldown>0||this.rejected.has(key)||this.operations.some(op=>op.type==='pickup'&&op.key===key)||supply.kind==='health'&&actor.health>=MAX_HEALTH)continue;
        this.operations.push({type:'pickup',supplyId,version,key,kind:supply.kind,afterMove:sequence+1});applySupply(actor,supply.kind);this.emit('pickup',key);
      }
    }
    const view={...world,...pick(pose,poseFields),...pick(actor,resources),fireCooldown:Math.max(0,(this.fireTick-sequence)*MOVEMENT_DT)};
    view.supplies=this.world.supplies.map((s,index)=>this.operations.some(op=>op.type==='pickup'&&op.supplyId===(s.id??index))?{...s,cooldown:8}:s);
    view.projectiles=world.projectiles.filter(shot=>shot.owner!==world.id||shot.actionId==null||!this.shots.has(shot.actionId));
    for(const entry of this.shots.values()){
      const elapsed=Math.max(0,now-entry.updated);advance(view,entry.model,elapsed);entry.updated=now;
      const decay=Math.exp(-elapsed*20);entry.error.wx*=decay;entry.error.wz*=decay;
      entry.display={...entry.model,wx:entry.model.wx+entry.error.wx,wz:entry.model.wz+entry.error.wz};
      if(entry.model.life>0)view.projectiles.push(entry.display);
    }
    return view;
  }
}
