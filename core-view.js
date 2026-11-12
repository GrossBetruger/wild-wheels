const decoder=new TextDecoder('utf-8',{fatal:true});
const phase=['ready','countdown','racing','paused','finished'];
const color=value=>'#'+Math.round(value).toString(16).padStart(6,'0');
class Pool{
  cache=[];
  constructor(length,create){this.count=length;this.create=create;}
  get length(){return this.count();}
  at(index){if(index<0)index+=this.length;if(index<0||index>=this.length)return undefined;return this.cache[index]??=this.create(index);}
  *[Symbol.iterator](){for(let i=0;i<this.length;i++)yield this.at(i);}
  map(fn){return [...this].map(fn);}filter(fn){return [...this].filter(fn);}find(fn){for(const row of this)if(fn(row))return row;}some(fn){for(const row of this)if(fn(row))return true;return false;}slice(...args){return [...this].slice(...args);}forEach(fn){let i=0;for(const row of this)fn(row,i++);}reduce(fn,initial){return [...this].reduce(fn,initial);}
}
const indexed=pool=>{const methods=new Map();return new Proxy(pool,{get(target,key){if(typeof key==='string'&&/^\d+$/.test(key))return target.at(Number(key));const value=Reflect.get(target,key,target);if(typeof value!=='function'||key==='constructor')return value;if(!methods.has(key))methods.set(key,value.bind(target));return methods.get(key);}});};
class Row{constructor(frame,base){this.frame=frame;this.offset=base;}get base(){return typeof this.offset==='function'?this.offset():this.offset;}n(index){return this.frame.n(this.base+index);}}
function fields(Type,names,{booleans=[],nullable=[]}={}){
  for(const [index,name]of names.entries()){
    if(!name)continue;
    Object.defineProperty(Type.prototype,name,{get(){const value=this.n(index);if(booleans.includes(name))return Boolean(value);if(nullable.includes(name)&&value<0)return null;return value;}});
  }
}
class Actor extends Row{
  get specialCooldown(){return this.n(46);}
  get specialActive(){return this.n(47);}
  get healTimer(){return this.n(43);}
  get hedgeShield(){return this.n(44);}
  get tehilim(){return this.n(45);}
  get afk(){return Boolean(this.n(42));}
  get name(){return this.frame.text.actors[this.id]?.name??undefined;}
  get notice(){return this.frame.text.actors[this.id]?.notice??'';}
  get color(){return color(this.n(41));}
  get item(){return ['hedgehog','missile'][this.n(40)]??null;}
}
fields(Actor,['id','driver','wx','wz','heading','motionHeading','cameraHeading','speed','health','kills','deaths','shield','destroyed','boost','drift','wasDrifting','yaw','spin','celebrate','stun','vulcan','chaff','chaffCooldown','ammo','missiles','turbos','fireCooldown','somersault','somersaultCooldown','somersaultCameraStart','dizzy','bomber','inactive','human','bombAmmo','stinkAmmo','bombReload','noticeTime','wallCooldown','voiceCooldown'],{booleans:['wasDrifting','bomber','inactive','human']});
class Skid extends Row{}fields(Skid,['owner','ax','az','bx','bz','time']);
class Particle extends Row{get kind(){return this.n(9)===1?'spark':'smoke';}}
fields(Particle,['owner','wx','wz','height','vx','vz','vy','age','life',null,'level']);
class Trail extends Row{}fields(Trail,['wx','wz','height']);
class Shot extends Row{
  constructor(frame,base){super(frame,base);this.trail=indexed(new Pool(()=>this.n(20),i=>new Trail(frame,()=>this.base+24+i*3)));}
  get kind(){return this.n(2)===1?'missile':'hedgehog';}
  get orbitAge(){return this.n(15)<0?undefined:this.n(15);}
}
fields(Shot,['id','owner',null,'wx','wz','heading','speed','height','vy','life','age','vulcan','actionId','target','decoy',null,'orbitAngle','orbitRadius','orbitHeight','chaffed',null,'orbitDirection'],{booleans:['vulcan','chaffed'],nullable:['actionId','target','decoy']});
class Supply extends Row{get kind(){return ['hedgehog','missile','boost','health','hedgeproof','tehilim'][this.n(3)];}}
fields(Supply,['id','wx','wz',null,'cooldown','version','collector'],{nullable:['collector']});
class Bomb extends Row{get kind(){return this.n(2)===1?'stink':'abomb';}get color(){return color(this.n(7));}}
fields(Bomb,['id','owner',null,'wx','wz','age','actionId'],{nullable:['actionId']});
class Chaff extends Row{get color(){return color(this.n(10));}}
fields(Chaff,['id','owner','wx','wz','originX','originZ','age','life','diversions','divertedAt'],{nullable:['divertedAt']});
class Stink extends Row{}fields(Stink,['id','owner','wx','wz','age','life']);
class Effect extends Row{get heading(){return this.n(7);}get type(){return ['effect','explosion','abomb','boost','pickup','hit','crash','fire','vulcanReady','ash','radiation','yudaSmoke','fashionSnap','heartbeat','taxAudit','teleportOut','teleportIn'][this.n(0)];}get color(){return color(this.n(5));}}
fields(Effect,[null,'wx','wz','age','life',null,'owner','radius'],{nullable:['owner']});
class World extends Actor{
  get base(){return 32+this.frame.n(21)*48;}
  get mode(){return 'combat';}get phase(){const value=phase[this.frame.n(10)];return this.frame.paused&&['countdown','racing'].includes(value)?'paused':value;}get resumePhase(){return phase[this.frame.n(10)];}
  get arena(){return this.frame.n(11);}get elapsed(){return this.frame.n(12);}get countdown(){return this.frame.n(13);}get duration(){return this.frame.n(14);}get targetScore(){return this.frame.n(15);}
  get finishRank(){return this.frame.n(16)<0?null:this.frame.n(16);}get finishTime(){return this.frame.n(17)<0?null:this.frame.n(17);}get finishCountdown(){return this.frame.n(18)<0?null:this.frame.n(18);}
  get rank(){return this.frame.n(19);}get shake(){return this.frame.n(20);}get soundEpoch(){return this.frame.n(22);}get winner(){return this.frame.text.winner;}get host(){return this.frame.text.host;}get multiplayer(){return this.frame.text.multiplayer;}
  get specialAbilities(){return this.frame.text.specialAbilities!==false;}get timeStop(){return this.frame.text.timeStop??0;}get timeOwner(){return this.frame.text.timeOwner;}
  get killFeed(){return this.frame.text.killFeed;}get events(){return this.frame.events;}get voices(){return this.frame.voices;}
  get bots(){return this.frame.bots;}get skids(){return this.frame.pools.skids;}get driftParticles(){return this.frame.pools.driftParticles;}get projectiles(){return this.frame.pools.projectiles;}get supplies(){return this.frame.pools.supplies;}get bombs(){return this.frame.pools.bombs;}get chaffClouds(){return this.frame.pools.chaffClouds;}get stinkClouds(){return this.frame.pools.stinkClouds;}get effects(){return this.frame.pools.effects;}
}
export class CoreView{
  text={actors:[],killFeed:[],events:[],voices:[],room:{}};version=-1;events=[];voices=[];paused=false;botIds=[];bases={};pools={};
  constructor(core){
    this.core=core;this.world=new World(this,0);this.bots=indexed(new Pool(()=>this.botIds.length,i=>this.actors[this.botIds[i]]));this.actors=Array.from({length:6},(_,i)=>new Actor(this,()=>32+i*48));
    const groups=[['skids',2,6,Skid],['driftParticles',3,12,Particle],['projectiles',4,96,Shot],['supplies',5,8,Supply],['bombs',6,10,Bomb],['chaffClouds',7,16,Chaff],['stinkClouds',8,8,Stink],['effects',9,8,Effect]];
    this.groups=groups;
    for(const[name,count,stride,Type]of groups)this.pools[name]=indexed(new Pool(()=>this.n(count),i=>new Type(this,()=>this.bases[name]+i*stride)));
  }
  rebind(){if(this.data&&this.data.buffer!==this.core.memory.buffer)this.data=new Float64Array(this.core.memory.buffer,this.pointer,this.length);}
  // SDK commands rebind once after Wasm calls; rendering runs synchronously and
  // cannot grow the heap between these reads. Avoid a Wasm getter per property.
  n(index){return this.data[index];}
  refresh(length){
    if(length<32)throw new Error('Rust presentation unavailable');this.pointer=this.core.presentation_ptr();this.length=length;this.data=new Float64Array(this.core.memory.buffer,this.pointer,length);
    if(this.n(0)!==1)throw new Error('Rust presentation version mismatch');
    let base=32+this.n(1)*48;for(const[name,count,stride]of this.groups){this.bases[name]=base;base+=this.n(count)*stride;}
    if(base!==length)throw new Error('Rust presentation layout mismatch');
    this.botIds=[];for(let i=0;i<this.n(1);i++)if(i!==this.n(21)&&!this.actors[i].inactive)this.botIds.push(i);
    const version=this.core.presentation_text_version();
    if(version!==this.version){this.version=version;this.text=JSON.parse(decoder.decode(new Uint8Array(this.core.memory.buffer,this.core.presentation_text_ptr(),this.core.presentation_text_len())));this.events=this.text.events.map(event=>typeof event==='string'?event:event.type);this.voices=this.text.voices;}
    return this.world;
  }
}
