import { encodeSnapshot, decodeSnapshot } from '../../wire.js';

const CAPACITY=262144,encoder=new TextEncoder(),decoder=new TextDecoder();
const skidScales=[100,100,100,100,1000,1],particleScales=[100,100,100,100,100,100,1000,1000,1,1,1];
const summarizeScales=(layout,out)=>{
  let at=0;
  for(let i=0;i<layout.skids;i++)for(const scale of skidScales)out[at++]=scale;
  for(let i=0;i<layout.particles;i++)for(const scale of particleScales)out[at++]=scale;
  for(const count of layout.trails)for(let i=0;i<count*3;i++)out[at++]=100;
  return at;
};
export async function createCodecs(wasmBytes){
  const {instance}=await WebAssembly.instantiate(wasmBytes,{}),wasm=instance.exports;
  const values=new Float64Array(CAPACITY),scales=new Float64Array(CAPACITY),packed=new Int32Array(CAPACITY);
  let buffer=new Uint8Array(CAPACITY*4+1024*1024);
  // This kernel has fixed static memory and never allocates or grows it.
  const rustValues=new Float64Array(wasm.memory.buffer,wasm.values_ptr(),CAPACITY);
  const rustScales=new Float64Array(wasm.memory.buffer,wasm.scales_ptr(),CAPACITY);
  const rustPacked=new Int32Array(wasm.memory.buffer,wasm.packed_ptr(),CAPACITY);
  const timings={encode:[],decode:[]};
  const measureKernel={enabled:false};
  function encode(state,rust){
    const world=state.world,layout={skids:world.skids.length,particles:world.driftParticles.length,trails:world.projectiles.map(shot=>shot.trail.length)};
    const n=layout.skids*6+layout.particles*11+layout.trails.reduce((sum,n)=>sum+n*3,0);
    if(n>CAPACITY)throw new Error('Benchmark packet too large');
    let at=0;
    for(const s of world.skids)for(const value of [s.ax,s.az,s.bx,s.bz,s.time,s.owner??-1])values[at++]=value;
    for(const p of world.driftParticles)for(const value of [p.wx,p.wz,p.height,p.vx,p.vz,p.vy,p.age,p.life,p.kind==='spark'?1:0,p.level,p.owner??-1])values[at++]=value;
    for(const shot of world.projectiles)for(const p of shot.trail)for(const value of [p.wx,p.wz,p.height])values[at++]=value;
    summarizeScales(layout,scales);
    let bytes;
    if(rust){
      rustValues.set(values.subarray(0,n));rustScales.set(scales.subarray(0,n));
      const start=measureKernel.enabled?performance.now():0;if(!wasm.transform(n,false))throw new Error('Invalid Rust encoding input');if(measureKernel.enabled)timings.encode.push(performance.now()-start);
      bytes=new Uint8Array(wasm.memory.buffer,wasm.packed_ptr(),n*4);
    }
    if(!rust){for(let i=0;i<n;i++){
      const value=Math.round(values[i]*scales[i]);
      if(!Number.isFinite(value)||value< -2147483648||value>2147483647)throw new Error('Invalid JS encoding input');
      packed[i]=value;
    }bytes=new Uint8Array(packed.buffer,0,n*4);}
    // Metadata, including authoritative gameplay fields, retains normal JSON precision.
    const meta=encoder.encode(JSON.stringify({layout,state:{...state,wireVersion:2,world:{...world,skids:[],driftParticles:[],projectiles:world.projectiles.map(shot=>({...shot,trail:[]}))}}}));
    const offset=(8+meta.length+3)&~3,total=offset+n*4;
    if(buffer.length<total)buffer=new Uint8Array(total*2);
    new DataView(buffer.buffer).setUint32(0,meta.length,true);new DataView(buffer.buffer).setUint32(4,n,true);
    buffer.set(meta,8);buffer.fill(0,8+meta.length,offset);buffer.set(bytes,offset);
    return buffer.subarray(0,total);
  }
  function decode(packet,rust){
    const view=new DataView(packet.buffer,packet.byteOffset,packet.byteLength),length=view.getUint32(0,true),n=view.getUint32(4,true),offset=(8+length+3)&~3;
    if(n>CAPACITY||offset+n*4!==packet.byteLength)throw new Error('Invalid benchmark packet length');
    const {layout,state}=JSON.parse(decoder.decode(packet.subarray(8,8+length)));
    if(!Number.isSafeInteger(layout.skids)||layout.skids<0||!Number.isSafeInteger(layout.particles)||layout.particles<0||!Array.isArray(layout.trails)||layout.trails.some(n=>!Number.isSafeInteger(n)||n<0)||layout.skids*6+layout.particles*11+layout.trails.reduce((a,b)=>a+b*3,0)!==n)throw new Error('Invalid benchmark layout');
    summarizeScales(layout,scales);
    const input=new Int32Array(packet.buffer,packet.byteOffset+offset,n);
    if(rust){
      rustPacked.set(input);rustScales.set(scales.subarray(0,n));
      const start=measureKernel.enabled?performance.now():0;if(!wasm.transform(n,true))throw new Error('Invalid Rust decoding input');if(measureKernel.enabled)timings.decode.push(performance.now()-start);
      values.set(rustValues.subarray(0,n));
    }
    if(!rust)for(let i=0;i<n;i++)values[i]=input[i]/scales[i];
    let at=0;const world=state.world;
    for(let i=0;i<layout.skids;i++){
      const skid={ax:values[at++],az:values[at++],bx:values[at++],bz:values[at++],time:values[at++]},owner=values[at++];
      if(owner>=0)skid.owner=owner;world.skids.push(skid);
    }
    for(let i=0;i<layout.particles;i++){
      const p={wx:values[at++],wz:values[at++],height:values[at++],vx:values[at++],vz:values[at++],vy:values[at++],age:values[at++],life:values[at++],kind:values[at++]===1?'spark':'smoke',level:values[at++]},owner=values[at++];
      if(owner>=0)p.owner=owner;world.driftParticles.push(p);
    }
    for(let i=0;i<world.projectiles.length;i++)for(let j=0;j<layout.trails[i];j++)world.projectiles[i].trail.push({wx:values[at++],wz:values[at++],height:values[at++]});
    return state;
  }
  return {timings,measureKernel,codecs:[
    {name:'current-json',encode:state=>encoder.encode(encodeSnapshot(state)),decode:packet=>decodeSnapshot(JSON.parse(decoder.decode(packet)))},
    {name:'javascript-binary',encode:state=>encode(state,false),decode:packet=>decode(packet,false)},
    {name:'rust-wasm-binary',encode:state=>encode(state,true),decode:packet=>decode(packet,true)}
  ]};
}
