// Ports the browser client's procedural graphics to the native Rust client.
//
// The unmodified WebGL renderer runs in Node against a recording GL context.
// Synthetic one-subject battles are drawn; the uploaded vertex buffers and model
// instances become a compact binary pack that the Bevy client plays back.
// See docs/native-graphics-port.md for the format and its limits.
import {createHash} from 'node:crypto';
import {Renderer} from '../../client/renderer.js';
import {createBattle,arenas} from '../../gameplay/combat.js';
import {drivers} from '../../gameplay/engine.js';

globalThis.devicePixelRatio??=1;

export const PACK_VERSION=1;
const FLOATS_PER_TRIANGLE=27,FPS=24,LOOP=8,WARMUP=3,MARKER='#fe01fd',SOLID=0,GLOW=1;
const hex=color=>[1,3,5].map(i=>parseInt(color.slice(i,i+2),16));
const byte=value=>Math.max(0,Math.min(255,Math.round(value*255)));

function recordingGl(){
  let bound=null;
  const methods={
    createBuffer:()=>({data:new Float32Array(0)}),
    bindBuffer:(target,buffer)=>{bound=buffer;},
    bufferData:(target,data)=>{if(bound)bound.data=data;},
    createShader:()=>({}),createProgram:()=>({}),getUniformLocation:()=>({}),getAttribLocation:()=>0,
    getShaderParameter:()=>true,getProgramParameter:()=>true,getExtension:()=>null,getParameter:()=>'recording',
  };
  return new Proxy(methods,{get:(target,name)=>target[name]??(()=>{})});
}
function renderer(){
  const gl=recordingGl();
  return new Renderer({getContext:()=>gl,clientWidth:1280,clientHeight:800,width:0,height:0});
}
// One racer at the origin facing +Z, with every other actor and pickup removed.
function world(driver,arena=0){
  const r=createBattle(driver,arena,()=>.5);
  Object.assign(r,{wx:0,wz:0,heading:0,cameraHeading:0,health:0,supplies:[]});
  for(const bot of r.bots)bot.inactive=true;
  return r;
}
function draw(view,r,time){
  view.draw(r,time);
  return {
    instances:view.instances.filter(i=>(i.opacity??1)>0).map(i=>({data:i.buffer.data,x:i.x,y:i.y,z:i.z,angle:i.angle,pitch:i.pitch??0,roll:i.roll??0})),
    dynamic:view.dynamicBuffer.data,glow:view.glowBuffer.data,scenery:view.staticBuffer.data,
  };
}
const triangleKey=(data,offset)=>Buffer.from(data.buffer,data.byteOffset+offset*4,FLOATS_PER_TRIANGLE*4).toString('latin1');
// Triangles drawn only because of a state change, such as health pips.
function added(base,extended){
  const counts=new Map();
  for(let i=0;i<base.length;i+=FLOATS_PER_TRIANGLE){const key=triangleKey(base,i);counts.set(key,(counts.get(key)??0)+1);}
  const out=[];
  for(let i=0;i<extended.length;i+=FLOATS_PER_TRIANGLE){
    const key=triangleKey(extended,i),count=counts.get(key)??0;
    if(count){counts.set(key,count-1);continue;}
    out.push(...extended.subarray(i,i+FLOATS_PER_TRIANGLE));
  }
  return new Float32Array(out);
}

class Pack {
  palette=[[0,0,0]];colors=new Map();meshes=[];meshIds=new Map();clips=[];clipIds=new Map();names=new Map();arenas=[];
  color(r,g,b){
    const key=byte(r)<<16|byte(g)<<8|byte(b);let id=this.colors.get(key);
    if(id===undefined){id=this.palette.length;if(id>65535)throw new Error('Graphics palette exceeds 65535 colors.');this.palette.push([byte(r),byte(g),byte(b)]);this.colors.set(key,id);}
    return id;
  }
  // `tinted` is the same mesh drawn with the marker racer color. Triangles that
  // follow the racer color use palette entry 0 and are recolored per player.
  mesh(data,tinted=null,base=null){
    let extent=0;for(let i=0;i<data.length;i+=9)extent=Math.max(extent,Math.abs(data[i]),Math.abs(data[i+1]),Math.abs(data[i+2]));
    const scale=Math.max(extent,1e-6)/32767,triangles=[],marker=hex(MARKER);
    const paired=tinted?.length===data.length;
    for(let i=0;i<data.length;i+=FLOATS_PER_TRIANGLE){
      const p=[];for(let v=0;v<3;v++)for(let k=0;k<3;k++)p.push(Math.round(data[i+v*9+k]/scale));
      const ux=p[3]-p[0],uy=p[4]-p[1],uz=p[5]-p[2],vx=p[6]-p[0],vy=p[7]-p[1],vz=p[8]-p[2];
      if(Math.hypot(uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx)===0)continue;
      const own=[data[i+6],data[i+7],data[i+8]].map(byte);
      const follows=paired&&own.every((c,k)=>c===base[k])&&[tinted[i+6],tinted[i+7],tinted[i+8]].map(byte).every((c,k)=>c===marker[k]);
      triangles.push(...p,follows?0:this.color(data[i+6],data[i+7],data[i+8]));
    }
    const body=Buffer.alloc(8+triangles.length*2);body.writeFloatLE(scale,0);body.writeUInt32LE(triangles.length/10,4);
    for(let i=0;i<triangles.length;i++)i%10===9?body.writeUInt16LE(triangles[i],8+i*2):body.writeInt16LE(triangles[i],8+i*2);
    return this.intern(this.meshes,this.meshIds,body);
  }
  intern(list,ids,body){
    const key=createHash('sha1').update(body).digest('latin1');let id=ids.get(key);
    if(id===undefined){id=list.length;list.push(body);ids.set(key,id);}
    return id;
  }
  frame(shot,tinted=null,base=null,dynamic=shot.dynamic){
    const parts=shot.instances.map((part,i)=>({...part,mesh:this.mesh(part.data,tinted?.instances[i]?.data,base)}));
    const still={x:0,y:0,z:0,angle:0,pitch:0,roll:0};
    if(dynamic.length)parts.push({...still,mesh:this.mesh(dynamic,tinted?.dynamic,base)});
    // Additive geometry such as boost flames; point sprites are not ported.
    if(shot.glow?.length)parts.push({...still,mesh:this.mesh(shot.glow),layer:GLOW});
    return parts;
  }
  clip(name,fps,frames){
    const size=frames.reduce((sum,frame)=>sum+2+frame.length*32,0),body=Buffer.alloc(8+size);let at=body.writeFloatLE(fps,0);at=body.writeUInt32LE(frames.length,at);
    for(const frame of frames){
      at=body.writeUInt16LE(frame.length,at);
      for(const part of frame){at=body.writeUInt32LE(part.mesh,at);at=body.writeUInt32LE(part.layer??SOLID,at);for(const value of [part.x,part.y,part.z,part.angle,part.pitch,part.roll])at=body.writeFloatLE(value,at);}
    }
    this.names.set(name,this.intern(this.clips,this.clipIds,body));
  }
  encode(){
    const u32=value=>{const b=Buffer.alloc(4);b.writeUInt32LE(value);return b;},names=[...this.names].sort(([a],[b])=>a<b?-1:1);
    return Buffer.concat([
      Buffer.from('WWGP'),u32(PACK_VERSION),
      u32(this.palette.length),Buffer.from(this.palette.flat()),
      u32(this.meshes.length),...this.meshes,
      u32(this.clips.length),...this.clips,
      u32(names.length),...names.flatMap(([name,clip])=>{const text=Buffer.from(name),size=Buffer.alloc(2);size.writeUInt16LE(text.length);return[size,text,u32(clip)];}),
      u32(this.arenas.length),...this.arenas.flatMap(({sky,mesh})=>[Buffer.from(sky),u32(mesh)]),
    ]);
  }
}

// Draws `setup(color)` over `frames` after a warm-up that settles eased state.
// A second, marker-colored pass identifies the triangles that follow the racer color.
function record(pack,name,{driver=0,frames=1,fps=FPS,setup,base=null,warmup=0}){
  const passes=(base?[null,MARKER]:[null]).map(color=>{const r=world(driver);if(color)r.color=color;setup?.(r);return{view:renderer(),r};});
  const start=LOOP*2,out=[];
  for(let i=-Math.round(warmup*fps);i<frames;i++){
    const [shot,tinted]=passes.map(({view,r})=>draw(view,r,start+i/fps));
    if(i>=0)out.push(pack.frame(shot,tinted,base));
  }
  pack.clip(name,fps,out);
}

// `only` limits the racers ported; tests use it to stay fast.
export function buildGraphicsPack({only=[...drivers.keys()]}={}){
  const pack=new Pack();
  for(const index of arenas.keys())pack.arenas.push({sky:hex(arenas[index].sky),mesh:pack.mesh(draw(renderer(),Object.assign(world(0,index),{afk:true}),0).scenery)});
  for(const driver of only){
    const base=hex(drivers[driver].color);
    record(pack,`driver:${driver}:idle`,{driver,base,frames:LOOP*FPS,warmup:WARMUP});
    record(pack,`driver:${driver}:boost`,{driver,base,frames:LOOP*FPS,warmup:WARMUP,setup:r=>{r.boost=1;}});
    record(pack,`shot:vulcan:${driver}`,{driver,frames:FPS,setup:r=>{r.afk=true;r.projectiles=[{id:1,owner:r.id,kind:'hedgehog',vulcan:true,wx:0,wz:0,heading:0,height:0,age:1,trail:[]}];}});
  }
  record(pack,'shot:hedgehog',{frames:FPS,setup:r=>{r.afk=true;r.projectiles=[{id:1,owner:r.id,kind:'hedgehog',vulcan:false,wx:0,wz:0,heading:0,height:0,age:1,trail:[]}];}});
  record(pack,'shot:missile',{setup:r=>{r.afk=true;r.projectiles=[{id:1,owner:r.id,kind:'missile',vulcan:false,wx:0,wz:0,heading:0,height:0,age:1,trail:[]}];}});
  record(pack,'wreck',{setup:r=>{r.destroyed=1;}});
  // Pickups bob with sin(2t) and spin with t, so one loop lasts 2π seconds.
  for(const kind of ['missile','hedgehog','boost','health','hedgeproof','tehilim'])record(pack,`pickup:${kind}`,{frames:150,fps:150/(2*Math.PI),setup:r=>{r.afk=true;r.supplies=[{id:0,version:0,wx:0,wz:0,kind,cooldown:0}];}});
  const bare=draw(renderer(),world(0),LOOP*2);
  for(let health=1;health<=6;health++){
    const shot=draw(renderer(),Object.assign(world(0),{health}),LOOP*2);
    pack.clip(`health:${health}`,FPS,[pack.frame({instances:[]},null,null,added(bare.dynamic,shot.dynamic))]);
  }
  return pack.encode();
}
