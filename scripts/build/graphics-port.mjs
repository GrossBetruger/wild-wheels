// Ports the browser client's procedural graphics to the native Rust client.
//
// The unmodified WebGL renderer runs in Node against a recording GL context.
// Synthetic one-subject battles are drawn; the uploaded vertex buffers, model
// instances and point sprites become a binary pack that the Bevy client plays back.
// See docs/native-graphics-port.md for the format and its limits.
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {Renderer} from '../../client/renderer.js';
import {createBattle,arenas,BOMB_FALL_TIME,RADIATION_DURATION} from '../../gameplay/combat.js';
import {drivers} from '../../gameplay/engine.js';
import {abilityNames} from '../../gameplay/special-abilities.js';
import {abilityCards} from '../../ui/ability-announcements.js';

globalThis.devicePixelRatio??=1;
// Reduced motion keeps the dizzy camera wobble out of recordings.
globalThis.matchMedia??=()=>({matches:true});

export const PACK_VERSION=7;
// Fire rings are recorded at this radius and scaled by the native client.
export const FIRE_RING_RADIUS=20;
// Clips whose every frame is new geometry are recorded at the slower rate to bound the pack size.
const SLOW_FPS=12;
// Transitions between states are recorded for this long after the change.
export const TRANSITION=1;
// Seconds over which timed states fade out in the browser, by state.
const ENDINGS={shield:1,hedge:1.5,tehilim:1.5};
// Racers are recorded in open ground: at the arena's center an obstacle would
// change anything that looks for free space, such as KnowItOwl's bat companion.
const HOME=[0,60];
const VERTICES=27,SPRITE=7,FPS=24,LOOP=8,OVERLAY_LOOP=4,WARMUP=3,BOOST_SPEED=40,MARKER='#fe01fd',SOLID=0,GLOW=1,PLUMAGE=2,REPEAT=0,ONCE=1;
const hex=color=>[1,3,5].map(i=>parseInt(color.slice(i,i+2),16));
const byte=value=>Math.max(0,Math.min(255,Math.round(value*255)));
const digest=data=>createHash('sha1').update(Buffer.from(data.buffer,data.byteOffset,data.byteLength)).digest('latin1');

function recordingGl(){
  let bound=null;
  const gl={
    smokeFlag:null,
    createBuffer:()=>({data:new Float32Array(0)}),
    bindBuffer:(target,buffer)=>{bound=buffer;},
    bufferData:(target,data)=>{if(!bound)return;bound.data=data;bound.uploads?.push({data,smoke:gl.smokeFlag?.value>.5});},
    uniform1f:(location,value)=>{if(location)location.value=value;},
    createShader:()=>({}),createProgram:()=>({}),getUniformLocation:()=>({}),getAttribLocation:()=>0,
    getShaderParameter:()=>true,getProgramParameter:()=>true,getExtension:()=>null,getParameter:()=>'recording',
  };
  return new Proxy(gl,{get:(target,name)=>target[name]??(()=>{})});
}
function renderer(){
  const gl=recordingGl(),view=new Renderer({getContext:()=>gl,clientWidth:1280,clientHeight:800,width:0,height:0});
  gl.smokeFlag=view.particleSmoke;
  return view;
}
// One racer at `HOME` facing +Z, with every other actor and pickup removed.
function world(driver=0,arena=0){
  const r=createBattle(driver,arena,()=>.5);
  Object.assign(r,{wx:HOME[0],wz:HOME[1],heading:0,cameraHeading:0,health:0,supplies:[]});
  for(const bot of r.bots)bot.inactive=true;
  return r;
}
// The vertex shader's rigid placement of one model instance, as a 3x4 matrix.
// Pearococo's feather fold is rigid and is baked in here; her feathers' sway and
// iridescence are the native client's plumage shader (native-client/src/plumage.wesl).
function placement(instance,[dx,dz]){
  const point=([x,y,z])=>{
    const plumage=instance.plumage;
    if(plumage){
      const fold=plumage.fold??0,turn=(plumage.angle??0)*fold*.86,root=[0,1.75,-1.05];
      let ox=x-root[0],oy=y-root[1],oz=z-root[2],c=Math.cos(turn),s=Math.sin(turn);
      [ox,oy]=[ox*c-oy*s,ox*s+oy*c];oz-=Math.abs(plumage.angle??0)*fold*.12;
      c=Math.cos(-fold*.95);s=Math.sin(-fold*.95);[oy,oz]=[oy*c-oz*s,oy*s+oz*c];
      x=root[0]+ox;y=root[1]+oy;z=root[2]+oz;
    }
    let c=Math.cos(instance.roll??0),s=Math.sin(instance.roll??0);[x,y]=[x*c-(y-.9)*s,x*s+(y-.9)*c+.9];
    c=Math.cos(instance.pitch??0);s=Math.sin(instance.pitch??0);[y,z]=[(y-2)*c-z*s+2,(y-2)*s+z*c];
    c=Math.cos(instance.angle);s=Math.sin(instance.angle);
    return [x*c+z*s+instance.x-dx,y+instance.y,-x*s+z*c+instance.z-dz];
  };
  const origin=point([0,0,0]);
  return [...[[1,0,0],[0,1,0],[0,0,1]].flatMap(axis=>point(axis).map((v,i)=>v-origin[i])),...origin];
}
const moved=(data,stride,[dx,dz])=>{if(!dx&&!dz)return data;const out=Float32Array.from(data);for(let i=0;i<out.length;i+=stride){out[i]-=dx;out[i+2]-=dz;}return out;};
const join=arrays=>{const out=new Float32Array(arrays.reduce((sum,a)=>sum+a.length,0));let at=0;for(const a of arrays){out.set(a,at);at+=a.length;}return out;};
// `shift` is where the subject stands, so that recordings are relative to it.
function draw(view,r,time,shift=[0,0]){
  view.particleBuffer.uploads=[];
  view.draw(r,time);
  const sprites=smoke=>moved(join(view.particleBuffer.uploads.filter(u=>u.smoke===smoke).map(u=>u.data)),SPRITE,shift);
  return {
    instances:view.instances.filter(i=>(i.opacity??1)>0).map(i=>({data:i.buffer.data,matrix:placement(i,shift),plumage:Boolean(i.plumage)})),
    dynamic:moved(view.dynamicBuffer.data,9,shift),glow:moved(view.glowBuffer.data,9,shift),
    sparks:sprites(false),smoke:sprites(true),scenery:view.staticBuffer.data,
  };
}
// Records of `extended` that `base` does not also contain.
function added(base,extended,stride){
  const key=(data,i)=>Buffer.from(data.buffer,data.byteOffset+i*4,stride*4).toString('latin1'),counts=new Map();
  for(let i=0;i<base.length;i+=stride){const k=key(base,i);counts.set(k,(counts.get(k)??0)+1);}
  const out=[];
  for(let i=0;i<extended.length;i+=stride){
    const k=key(extended,i),count=counts.get(k)??0;
    if(count){counts.set(k,count-1);continue;}
    out.push(extended.subarray(i,i+stride));
  }
  return join(out);
}

class Pack {
  palette=[[0,0,0]];colors=new Map();meshes=[];meshIds=new Map();raw=new Map();clips=[];clipIds=new Map();names=new Map();arenas=[];
  color(r,g,b){
    const key=byte(r)<<16|byte(g)<<8|byte(b);let id=this.colors.get(key);
    if(id===undefined){id=this.palette.length;if(id>65535)throw new Error('Graphics palette exceeds 65535 colors.');this.palette.push([byte(r),byte(g),byte(b)]);this.colors.set(key,id);}
    return id;
  }
  // `tinted` is the same mesh drawn with the marker racer color. Triangles that
  // follow the racer color use palette entry 0 and are recolored per player.
  mesh(data,tinted=null,base=null){
    const paired=tinted?.length===data.length,rawKey=digest(data)+(paired?digest(tinted):'');
    const known=this.raw.get(rawKey);if(known!==undefined)return known;
    let extent=0;for(let i=0;i<data.length;i+=9)extent=Math.max(extent,Math.abs(data[i]),Math.abs(data[i+1]),Math.abs(data[i+2]));
    const scale=Math.max(extent,1e-6)/32767,triangles=[],marker=hex(MARKER);
    for(let i=0;i<data.length;i+=VERTICES){
      const p=[];for(let v=0;v<3;v++)for(let k=0;k<3;k++)p.push(Math.round(data[i+v*9+k]/scale));
      const ux=p[3]-p[0],uy=p[4]-p[1],uz=p[5]-p[2],vx=p[6]-p[0],vy=p[7]-p[1],vz=p[8]-p[2];
      if(Math.hypot(uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx)===0)continue;
      const own=[data[i+6],data[i+7],data[i+8]].map(byte);
      const follows=paired&&own.every((c,k)=>c===base[k])&&[tinted[i+6],tinted[i+7],tinted[i+8]].map(byte).every((c,k)=>c===marker[k]);
      triangles.push(...p,follows?0:this.color(data[i+6],data[i+7],data[i+8]));
    }
    const raw=Buffer.alloc(triangles.length*2);
    for(let i=0;i<triangles.length;i++)i%10===9?raw.writeUInt16LE(triangles[i],i*2):raw.writeInt16LE(triangles[i],i*2);
    // Each mesh is compressed on its own, so the native client inflates only what it shows.
    const packed=deflateSync(raw,{level:6}),body=Buffer.alloc(12+packed.length);
    body.writeFloatLE(scale,0);body.writeUInt32LE(triangles.length/10,4);body.writeUInt32LE(packed.length,8);packed.copy(body,12);
    const id=this.intern(this.meshes,this.meshIds,body);this.raw.set(rawKey,id);
    return id;
  }
  intern(list,ids,body){
    const key=createHash('sha1').update(body).digest('latin1');let id=ids.get(key);
    if(id===undefined){id=list.length;list.push(body);ids.set(key,id);}
    return id;
  }
  // Interns a shot's meshes. Model instances keep their order, so a marker-colored
  // shot of the same frame pairs with it index by index.
  frame(shot,tinted=null,base=null){
    const still=[1,0,0,0,1,0,0,0,1,0,0,0];
    // Models the browser draws with its plumage shader keep that as their layer: the
    // native client sways and shades them with its own port of that shader.
    const parts=shot.instances.map((part,i)=>({matrix:part.matrix,layer:part.plumage?PLUMAGE:SOLID,mesh:this.mesh(part.data,tinted?.instances[i]?.data,base)}));
    if(shot.dynamic.length)parts.push({matrix:still,layer:SOLID,mesh:this.mesh(shot.dynamic,tinted?.dynamic,base)});
    if(shot.glow.length)parts.push({matrix:still,layer:GLOW,mesh:this.mesh(shot.glow)});
    return {parts,sparks:shot.sparks,smoke:shot.smoke};
  }
  // What `shot` draws beyond `base`: the visuals of one extra state.
  overlay(base,shot){
    const key=part=>part.mesh+':'+part.matrix.join(','),models=({instances})=>this.frame({instances,dynamic:[],glow:[]}).parts,before=models(base),after=models(shot);
    const counts=new Map();for(const part of before)counts.set(key(part),(counts.get(key(part))??0)+1);
    const extra=after.filter(part=>{const count=counts.get(key(part))??0;if(count)counts.set(key(part),count-1);return!count;});
    // A state that swaps part of the racer's own model cannot be layered on top of it.
    const swapped=[...counts.values()].some(count=>count>0);
    const rest=this.frame({instances:[],dynamic:added(base.dynamic,shot.dynamic,VERTICES),glow:added(base.glow,shot.glow,VERTICES),sparks:added(base.sparks,shot.sparks,SPRITE),smoke:added(base.smoke,shot.smoke,SPRITE)});
    return {...rest,parts:[...(swapped?[]:extra),...rest.parts]};
  }
  clip(name,fps,frames,mode=REPEAT){
    if(frames.every(frame=>!frame.parts.length&&!frame.sparks.length&&!frame.smoke.length))return;
    const u16=value=>{const b=Buffer.alloc(2);b.writeUInt16LE(value);return b;},u32=value=>{const b=Buffer.alloc(4);b.writeUInt32LE(value);return b;};
    const floats=values=>{const array=Float32Array.from(values);return Buffer.from(array.buffer,array.byteOffset,array.byteLength);};
    const chunks=[floats([fps]),u32(mode),u32(frames.length)];
    for(const frame of frames){
      chunks.push(u16(frame.parts.length));
      for(const part of frame.parts)chunks.push(u32(part.mesh),u32(part.layer),floats(part.matrix));
      for(const sprites of [frame.sparks,frame.smoke])chunks.push(u32(sprites.length/SPRITE),floats(sprites));
    }
    this.names.set(name,this.intern(this.clips,this.clipIds,Buffer.concat(chunks)));
  }
  encode(){
    const u32=value=>{const b=Buffer.alloc(4);b.writeUInt32LE(value);return b;},names=[...this.names].sort(([a],[b])=>a<b?-1:1);
    const text=value=>{const bytes=Buffer.from(value),size=Buffer.alloc(2);size.writeUInt16LE(bytes.length);return Buffer.concat([size,bytes]);};
    return Buffer.concat([
      Buffer.from('WWGP'),u32(PACK_VERSION),
      u32(this.palette.length),Buffer.from(this.palette.flat()),
      u32(this.meshes.length),...this.meshes,
      ...(()=>{const raw=Buffer.concat([u32(this.clips.length),...this.clips]),packed=deflateSync(raw,{level:6});return[u32(raw.length),u32(packed.length),packed];})(),
      u32(names.length),...names.flatMap(([name,clip])=>{const text=Buffer.from(name),size=Buffer.alloc(2);size.writeUInt16LE(text.length);return[size,text,u32(clip)];}),
      u32(this.arenas.length),...this.arenas.flatMap(({sky,mesh,xray,name,desc})=>[Buffer.from(sky),u32(mesh),u32(xray),text(name),text(desc)]),
      // The menus name racers and arenas from the same data the browser shows.
      u32(drivers.length),...drivers.flatMap((driver,index)=>{
        // The announcement shown when a racer's special ability is used.
        const card=abilityCards[index];
        return[text(driver.name),text(driver.desc),Buffer.from(hex(driver.color)),text(abilityNames[index]??''),Buffer.from([driver.intelligence]),text(card?.title??''),text(card?.detail??''),Buffer.from(hex(card?.color??'#ffffff'))];
      }),
    ]);
  }
}

// Draws one subject for `frames` frames. `setup` prepares the world once and
// `each(r,seconds)` updates it per frame; a negative warm-up settles eased state.
function capture({driver=0,frames=1,fps=FPS,warmup=0,speed=0,setup,each}){
  const view=renderer(),r=world(driver),start=LOOP*2,shots=[];
  setup?.(r);
  for(let i=-Math.round(warmup*fps);i<frames;i++){
    const seconds=i/fps;if(speed)r.wz=HOME[1]+speed*(seconds+warmup);
    each?.(r,seconds);
    const shot=draw(view,r,start+seconds,[r.wx,r.wz]);
    if(i>=0)shots.push(shot);
  }
  return shots;
}
// World effects are recorded at the origin with the racer out of sight.
const hidden=r=>{r.afk=true;r.wx=0;r.wz=0;};

export function buildGraphicsPack({only=[...drivers.keys()]}={}){
  const pack=new Pack();
  const record=(name,options,mode=REPEAT)=>pack.clip(name,options.fps??FPS,capture(options).map(shot=>pack.frame(shot)),mode);
  // Records a subject twice, the second time in the marker color, to find tinted triangles.
  const tinted=(name,base,options,mode=REPEAT)=>{
    const plain=capture(options),marked=capture({...options,setup:r=>{options.setup?.(r);options.mark(r);}});
    pack.clip(name,options.fps??FPS,plain.map((shot,i)=>pack.frame(shot,marked[i],base)),mode);
    return plain;
  };
  const once=(name,life,setup,each,options={})=>record(name,{frames:Math.ceil(life*FPS)+1,setup:r=>{hidden(r);setup?.(r);},each,...options},ONCE);

  for(const index of arenas.keys()){
    const view=renderer(),scenery=draw(view,Object.assign(world(0,index),{afk:true}),0).scenery;
    // KnowItOwl's X-ray outlines of the arena are built the first time Dark Humor is drawn for its caster.
    view.draw(Object.assign(world(14,index),{phase:'racing',specialActive:3}),1);
    pack.arenas.push({name:arenas[index].name,desc:arenas[index].desc,sky:hex(arenas[index].sky),mesh:pack.mesh(scenery),xray:pack.mesh(view.models.get(`dark:arena:${index}`).buffer.data)});
  }

  const wreck=capture({setup:r=>{r.destroyed=1;}})[0];
  pack.clip('wreck',FPS,[pack.frame(wreck)]);
  for(const driver of only){
    const base=hex(drivers[driver].color),mark=r=>{r.color=MARKER;};
    const idle=tinted(`driver:${driver}:idle`,base,{driver,frames:LOOP*FPS,warmup:WARMUP,mark});
    // Boosting racers are recorded while driving so that trails stream behind them.
    tinted(`driver:${driver}:boost`,base,{driver,frames:LOOP*FPS,warmup:WARMUP,speed:BOOST_SPEED,mark,setup:r=>{r.boost=1;}});
    // Boosting in and out, through whatever easing the renderer keeps between
    // frames: Pearococo's tail folds, KnowItOwl takes off, rotors tilt.
    const steps=Math.round(TRANSITION*FPS)+1;
    tinted(`driver:${driver}:boost:in`,base,{driver,frames:steps,warmup:WARMUP,mark,each:(r,t)=>{r.boost=t>=0?1:0;r.wz=HOME[1]+Math.max(0,t)*BOOST_SPEED;}},ONCE);
    tinted(`driver:${driver}:boost:out`,base,{driver,frames:steps,warmup:WARMUP,mark,each:(r,t)=>{r.boost=t<0?1:0;r.wz=HOME[1]+Math.min(0,t)*BOOST_SPEED;}},ONCE);
    tinted(`driver:${driver}:celebrate`,base,{driver,fps:SLOW_FPS,frames:Math.ceil(1.6*SLOW_FPS),mark,each:(r,t)=>{r.celebrate=Math.max(.001,1.6-t);}},ONCE);
    // One trail puff of this racer's rapid fire: the shot drawn with and without it.
    const rapid=trail=>capture({driver,setup:r=>{hidden(r);r.projectiles=[{id:1,owner:r.id,kind:'hedgehog',vulcan:true,wx:0,wz:0,heading:0,height:0,age:1,trail}];}})[0];
    pack.clip(`trail:vulcan:${driver}`,FPS,[pack.overlay(rapid([]),rapid([{wx:0,wz:0,height:0}]))]);
    record(`shot:vulcan:${driver}`,{driver,frames:FPS,setup:r=>{hidden(r);r.projectiles=[{id:1,owner:r.id,kind:'hedgehog',vulcan:true,wx:0,wz:0,heading:0,height:0,age:1,trail:[]}];}});
    // States layered over the racer. KnowItOwl's special is a full-screen shader effect.
    const states={shield:r=>{r.shield=1;},hedge:r=>{r.hedgeShield=2;},tehilim:r=>{r.tehilim=2;},dizzy:r=>{r.dizzy=1;},vulcan:r=>{r.vulcan=3;r.fireCooldown=0;},...(driver===14?{}:{special:r=>{r.specialActive=4;}})};
    for(const [state,setup] of Object.entries(states)){
      const shots=capture({driver,frames:OVERLAY_LOOP*FPS,warmup:1,setup});
      pack.clip(`overlay:${driver}:${state}`,FPS,shots.map((shot,i)=>pack.overlay(idle[i],shot)));
    }
    // Rapid fire starting and ending: KnowItOwl's bat flies in and away.
    for(const [name,on] of [['in',t=>t>=0],['out',t=>t<0]]){
      const shots=capture({driver,frames:steps,warmup:1,each:(r,t)=>{r.vulcan=on(t)?3:0;r.fireCooldown=0;}});
      pack.clip(`overlay:${driver}:vulcan:${name}`,FPS,shots.map((shot,i)=>pack.overlay(idle[i],shot)),ONCE);
    }
    // Timed states fade over their last moments, driven by the time remaining.
    const field={shield:'shield',hedge:'hedgeShield',tehilim:'tehilim'};
    for(const [state,length] of Object.entries(ENDINGS)){
      const shots=capture({driver,frames:Math.round(length*FPS)+1,each:(r,t)=>{r[field[state]]=Math.max(.001,length-Math.max(0,t));}});
      pack.clip(`overlay:${driver}:${state}:end`,FPS,shots.map((shot,i)=>pack.overlay(idle[i],shot)),ONCE);
    }
    // R-yeah's archangels descend when called and rise when the ability ends.
    if(driver===11)for(const [name,value] of [['start',t=>12-Math.max(0,t)],['end',t=>Math.max(.001,TRANSITION-Math.max(0,t))]]){
      const shots=capture({driver,frames:steps,each:(r,t)=>{r.specialActive=value(t);}});
      pack.clip(`overlay:${driver}:special:${name}`,FPS,shots.map((shot,i)=>pack.overlay(idle[i],shot)),ONCE);
    }
    // Ashes collapse from the body that was last drawn alive at that spot.
    const ash=capture({driver,fps:SLOW_FPS,frames:Math.ceil(4.3*SLOW_FPS)+1,warmup:2/SLOW_FPS,each:(r,t)=>{if(t<0)return;r.destroyed=1;r.effects=[{type:'ash',wx:r.wx,wz:r.wz,age:t,life:4.3}];}});
    pack.clip(`effect:ash:${driver}`,SLOW_FPS,ash.map(shot=>pack.overlay(wreck,shot)),ONCE);
  }

  const shot=(kind,vulcan=false)=>r=>{hidden(r);r.projectiles=[{id:1,owner:r.id,kind,vulcan,wx:0,wz:0,heading:0,height:0,age:1,trail:[]}];};
  record('shot:hedgehog',{frames:FPS,setup:shot('hedgehog')});
  record('shot:missile',{frames:FPS,setup:shot('missile')});
  // A trail puff at its largest; the native client shrinks it along the trail.
  for(const kind of ['hedgehog','missile']){
    const single=trail=>capture({setup:r=>{shot(kind)(r);r.projectiles[0].trail=trail;}})[0];
    pack.clip(`trail:${kind}`,FPS,[pack.overlay(single([]),single([{wx:0,wz:0,height:0}]))]);
  }
  // A unit-length skid mark fading into each arena's ground over six seconds.
  for(const arena of arenas.keys()){
    const view=renderer(),r=Object.assign(world(0,arena),{afk:true}),frames=[];
    for(let i=0;i<=24;i++){r.elapsed=100+i/4;r.skids=[{owner:99,ax:0,az:-.5,bx:0,bz:.5,time:100}];frames.push(pack.frame(draw(view,r,LOOP*2)));}
    pack.clip(`skid:${arena}`,4,frames,ONCE);
  }
  // Pickups bob with sin(2t) and spin with t, so one loop lasts 2π seconds.
  const turn={frames:150,fps:150/(2*Math.PI)};
  for(const kind of ['missile','hedgehog','boost','health','hedgeproof','tehilim'])record(`pickup:${kind}`,{...turn,setup:r=>{hidden(r);r.supplies=[{id:0,version:0,wx:0,wz:0,kind,cooldown:0}];}});
  record('pickup:bicycle',{...turn,setup:r=>{hidden(r);r.supplies=[{id:1000,version:0,owner:99,kind:'bicycle',cooldown:0,age:5,heading:0,wx:0,wz:0,dropWx:0,dropWz:0,dropHeight:0}];}});
  const bare=draw(renderer(),world(0),LOOP*2,HOME);
  for(let health=1;health<=6;health++)pack.clip(`health:${health}`,FPS,[pack.overlay(bare,draw(renderer(),Object.assign(world(0),{health}),LOOP*2,HOME))]);

  // World effects play once, frame by frame of their age.
  const effect=(type,life,extra={})=>(r,t)=>{r.effects=[{type,owner:r.id,wx:0,wz:0,age:Math.max(0,t),life,...extra}];};
  for(const [type,life] of [['explosion',2.5],['abomb',3],['radiation',RADIATION_DURATION],['fashionSnap',1.2],['heartbeat',.7],['taxAudit',2.5],['teleportOut',1.35],['teleportIn',1.35],['locustSpawn',1.2],['locustBurst',.7]])once(`effect:${type}`,life,null,effect(type,life,{heading:0}));
  once('effect:default',.65,null,effect('pickup',.65));
  once('effect:fireRingOut',2.4,null,effect('fireRingOut',2.4,{radius:FIRE_RING_RADIUS,color:'#ff631c'}));
  for(const [name,color] of [['orange','#ff631c'],['blue','#4abaff']])record(`effect:fireRing:${name}`,{fps:SLOW_FPS,frames:OVERLAY_LOOP*SLOW_FPS,setup:hidden,each:effect('fireRing',.1,{radius:FIRE_RING_RADIUS,color})});
  once('timestop',2.5,null,(r,t)=>{r.timeStop=Math.max(.001,2.5-t);r.timeOwner=r.id;});
  for(const kind of ['bomb','stink'])once(`bomb:${kind}`,BOMB_FALL_TIME,null,(r,t)=>{r.bombs=[{id:1,kind,owner:r.id,wx:0,wz:0,age:Math.max(0,t),color:r.color}];});
  const chaff=(r,t)=>{r.chaffClouds=[{id:0,owner:r.id,wx:0,wz:0,originX:0,originZ:0,color:'#a8cde1',age:Math.max(0,t),life:8}];};
  once('cloud:chaff',8,null,chaff);
  if(only.includes(9))once('cloud:chaff:fairy',8,null,chaff,{driver:9});
  once('cloud:stink',5,null,(r,t)=>{r.stinkClouds=[{id:0,owner:r.id,wx:0,wz:0,age:Math.max(0,t),life:5,hits:[]}];});
  // Drift particles are recorded over a one-second life; the native client plays them by age/life.
  const particle=(kind,level)=>(r,t)=>{r.driftParticles=[{owner:99,wx:0,wz:0,height:0,vx:0,vy:0,vz:0,age:Math.max(0,t),life:1,kind,level}];};
  once('particle:smoke',1,null,particle('smoke',0));
  for(const level of [0,1,2])once(`particle:spark:${level}`,1,null,particle('spark',level));
  const locust=jump=>({id:0,owner:99,wx:0,wz:0,heading:0,age:1,jump});
  record('locust',{frames:2*FPS,setup:r=>{hidden(r);r.locusts=[locust(0)];}});
  once('locust:jump',.7,null,(r,t)=>{r.locusts=[locust(Math.max(.001,.7-t))];});
  // Fourmidable's special conjures a xylophone in front of every other racer.
  const quiet=capture({frames:FPS}),noisy=capture({frames:FPS,setup:r=>{Object.assign(r.bots[0],{driver:13,specialActive:1});}});
  pack.clip('overlay:xylophone',FPS,noisy.map((frame,i)=>pack.overlay(quiet[i],frame)));
  return pack.encode();
}
