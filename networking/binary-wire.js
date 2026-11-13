const MAGIC=0x33535757,HEADER=16,MAX_PACKET=512*1024,MAX_EFFECTS=512,MAX_SHOTS=512,MAX_TRAIL=24;
const textEncoder=new TextEncoder(),textDecoder=new TextDecoder('utf-8',{fatal:true});
const skidScale=[100,100,100,100,1000,1],particleScale=[100,100,100,100,100,100,1000,1000,1,1,1];

function count(layout){
  if(!layout||!Number.isInteger(layout.skids)||layout.skids<0||layout.skids>MAX_EFFECTS||!Number.isInteger(layout.particles)||layout.particles<0||layout.particles>MAX_EFFECTS||!Array.isArray(layout.trails)||layout.trails.length>MAX_SHOTS||layout.trails.some(n=>!Number.isInteger(n)||n<0||n>MAX_TRAIL))throw new RangeError('Invalid binary effect counts');
  return layout.skids*6+layout.particles*11+layout.trails.reduce((sum,n)=>sum+n*3,0);
}

// Scratch memory is reused, but each returned packet owns its bytes. Socket writes
// and queued snapshots can outlive the next call to the encoder.
export function createBinaryEncoder(){
  let scratch=new Uint8Array(16384);
  return state=>{
    const world=state.world,layout={skids:world.skids.length,particles:world.driftParticles.length,trails:world.projectiles.map(shot=>shot.trail.length)},n=count(layout);
    const meta=textEncoder.encode(JSON.stringify({layout,state:{...state,wireVersion:3,world:{...world,skids:[],driftParticles:[],projectiles:world.projectiles.map(shot=>({...shot,trail:[]}))}}}));
    const offset=Math.ceil((HEADER+meta.length)/4)*4,total=offset+n*4;
    if(total>MAX_PACKET)throw new RangeError('Binary update too large');
    if(scratch.length<total)scratch=new Uint8Array(Math.min(MAX_PACKET,Math.max(total,scratch.length*2)));
    const view=new DataView(scratch.buffer);view.setUint32(0,MAGIC,true);view.setUint32(4,meta.length,true);view.setUint32(8,n,true);view.setUint32(12,total,true);
    scratch.set(meta,HEADER);scratch.fill(0,HEADER+meta.length,offset);
    let at=offset;
    const write=(value,scale)=>{const packed=Math.round(value*scale);if(!Number.isFinite(packed)||packed< -2147483648||packed>2147483647)throw new RangeError('Unrepresentable binary effect');view.setInt32(at,packed,true);at+=4;};
    for(const s of world.skids){write(s.ax,100);write(s.az,100);write(s.bx,100);write(s.bz,100);write(s.time,1000);write(s.owner??-1,1);}
    for(const p of world.driftParticles){write(p.wx,100);write(p.wz,100);write(p.height,100);write(p.vx,100);write(p.vz,100);write(p.vy,100);write(p.age,1000);write(p.life,1000);write(p.kind==='spark'?1:0,1);write(p.level,1);write(p.owner??-1,1);}
    for(const shot of world.projectiles)for(const p of shot.trail){write(p.wx,100);write(p.wz,100);write(p.height,100);}
    return scratch.slice(0,total);
  };
}

export function decodeBinarySnapshot(input){
  const packet=input instanceof ArrayBuffer?new Uint8Array(input):input;
  if(!(packet instanceof Uint8Array)||packet.byteLength<HEADER||packet.byteLength>MAX_PACKET)throw new RangeError('Invalid binary update size');
  const view=new DataView(packet.buffer,packet.byteOffset,packet.byteLength);
  if(view.getUint32(0,true)!==MAGIC||view.getUint32(12,true)!==packet.byteLength)throw new RangeError('Invalid binary update header');
  const length=view.getUint32(4,true),n=view.getUint32(8,true),offset=Math.ceil((HEADER+length)/4)*4;
  if(offset>packet.byteLength||offset+n*4!==packet.byteLength)throw new RangeError('Truncated binary update');
  const {layout,state}=JSON.parse(textDecoder.decode(packet.subarray(HEADER,HEADER+length)));
  if(count(layout)!==n||state?.type!=='state'||state.wireVersion!==3||!state.world||!Array.isArray(state.world.skids)||state.world.skids.length||!Array.isArray(state.world.driftParticles)||state.world.driftParticles.length||!Array.isArray(state.world.projectiles)||state.world.projectiles.length!==layout.trails.length||state.world.projectiles.some(shot=>!shot||!Array.isArray(shot.trail)||shot.trail.length))throw new RangeError('Invalid binary update metadata');
  let at=offset;
  const read=scale=>{const value=view.getInt32(at,true)/scale;at+=4;return value;},world=state.world;
  for(let i=0;i<layout.skids;i++){
    const s={ax:read(skidScale[0]),az:read(skidScale[1]),bx:read(skidScale[2]),bz:read(skidScale[3]),time:read(skidScale[4])},owner=read(1);if(owner>=0)s.owner=owner;world.skids.push(s);
  }
  for(let i=0;i<layout.particles;i++){
    const p={wx:read(particleScale[0]),wz:read(particleScale[1]),height:read(particleScale[2]),vx:read(particleScale[3]),vz:read(particleScale[4]),vy:read(particleScale[5]),age:read(particleScale[6]),life:read(particleScale[7]),kind:read(1)===1?'spark':'smoke',level:read(1)},owner=read(1);if(owner>=0)p.owner=owner;world.driftParticles.push(p);
  }
  for(let i=0;i<world.projectiles.length;i++)for(let j=0;j<layout.trails[i];j++)world.projectiles[i].trail.push({wx:read(100),wz:read(100),height:read(100)});
  return state;
}
