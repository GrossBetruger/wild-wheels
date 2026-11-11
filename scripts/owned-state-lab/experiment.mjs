import { createBinaryEncoder, decodeBinarySnapshot } from '../../binary-wire.js';

const stats=values=>{const sorted=[...values].sort((a,b)=>a-b);return {samples:values.length,meanMs:values.reduce((a,b)=>a+b,0)/values.length,p95Ms:sorted[Math.floor(sorted.length*.95)]};};
const commands=step=>[1/60,step%120<60?.03:-.02,.025,.001];
function advance(state,[dt,dx,dz,turn]){
  const bump=(object,key,delta)=>{if(typeof object[key]==='number')object[key]+=delta;};
  bump(state,'time',dt);const world=state.world;
  bump(world,'elapsed',dt);bump(world,'wx',dx);bump(world,'wz',dz);bump(world,'heading',turn);
  for(const actors of [world.bots,world.projectiles])for(const actor of actors){bump(actor,'wx',dx);bump(actor,'wz',dz);bump(actor,'heading',turn);}
  for(const skid of world.skids)skid.time+=dt;
  for(const p of world.driftParticles){p.wx+=p.vx*dt;p.wz+=p.vz*dt;p.height+=p.vy*dt;p.age+=dt;if(p.age>=p.life)p.age=0;}
  for(const shot of world.projectiles)for(const p of shot.trail){p.wx+=dx;p.wz+=dz;}
}
function canonical(value){
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
  return value;
}
export async function ownedStateExperiment(wasmBytes,corpora){
  const module=await WebAssembly.compile(wasmBytes),results=[];
  for(const {scenario,snapshots} of corpora){
    // A real recorded busy snapshot seeds each persistent instance once.
    let seedIndex=0,largest=0;
    for(let i=0;i<snapshots.length;i++){const size=JSON.stringify(snapshots[i]).length;if(size>largest){seedIndex=i;largest=size;}}
    const seed=snapshots[seedIndex],encode=createBinaryEncoder();
    let start=performance.now();const js=JSON.parse(JSON.stringify(seed)),jsInitializationMs=performance.now()-start;
    const wasm=(await WebAssembly.instantiate(module,{})).exports;
    start=performance.now();const initialBytes=new TextEncoder().encode(JSON.stringify(seed));
    if(initialBytes.length>512*1024)throw new Error('Seed exceeds Wasm input capacity');
    new Uint8Array(wasm.memory.buffer,wasm.input_ptr(),initialBytes.length).set(initialBytes);
    if(!wasm.initialize(initialBytes.length))throw new Error('Rust seed initialization failed');
    const initializationMs=performance.now()-start;
    const rustEncode=()=>{
      const size=wasm.encode();if(!size)throw new Error('Rust encoding failed');
      // Copy to an owned packet: WebSocket writes must survive later Wasm calls.
      return new Uint8Array(wasm.memory.buffer,wasm.output_ptr(),size).slice();
    };
    const assertEqual=(a,b)=>{if(JSON.stringify(canonical(a))!==JSON.stringify(canonical(b)))throw new Error('Persistent state differs: '+scenario);};
    assertEqual(decodeBinarySnapshot(encode(js)),decodeBinarySnapshot(rustEncode()));
    // Warm both implementations, checking state after changing commands.
    for(let i=0;i<120;i++){
      const command=commands(i);advance(js,command);if(!wasm.advance(...command))throw new Error('Rust command rejected');
      assertEqual(decodeBinarySnapshot(encode(js)),decodeBinarySnapshot(rustEncode()));
    }
    const samples=[{name:'javascript-owned',update:[],encode:[],decode:[],pipeline:[]},{name:'rust-wasm-owned',update:[],encode:[],decode:[],pipeline:[]}];
    let jsBytes,rustBytes;
    for(let i=0;i<600;i++){
      const command=commands(i+120),decoded=[];
      for(let offset=0;offset<2;offset++){
        const side=(i+offset)%2,sample=samples[side];
        start=performance.now();
        if(side===0)advance(js,command);
        if(side===1&&!wasm.advance(...command))throw new Error('Rust command rejected');
        const updated=performance.now(),packet=side===0?encode(js):rustEncode(),encoded=performance.now();
        decoded[side]=decodeBinarySnapshot(packet);const end=performance.now();
        sample.update.push(updated-start);sample.encode.push(encoded-updated);sample.decode.push(end-encoded);sample.pipeline.push(end-start);
        if(side===0)jsBytes=packet;
        if(side===1)rustBytes=packet;
      }
      // Outside timed regions. Verify every measured update, including round-off.
      assertEqual(decoded[0],decoded[1]);
    }
    results.push({scenario,seedIndex,seedBytes:initialBytes.length,jsInitializationMs,initializationMs,verifiedUpdates:720,commandsPerUpdate:4,commandBytesIfPacked:32,
      results:samples.map(sample=>({name:sample.name,update:stats(sample.update),encode:stats(sample.encode),decode:stats(sample.decode),pipeline:stats(sample.pipeline)})),
      finalJsPacket:Array.from(jsBytes),finalRustPacket:Array.from(rustBytes)});
  }
  return {results,pass:true};
}
