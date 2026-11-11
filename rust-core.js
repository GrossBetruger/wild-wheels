// One module, shared by Node authority and browser prediction. No JS simulation fallback.
const url=new URL('./rust-core.wasm',import.meta.url);
const bytes=typeof window==='undefined'?await (await import('node:fs/promises')).readFile(url):await (async()=>{const response=await fetch(url);if(!response.ok)throw new Error('Unable to load Rust game core');return response.arrayBuffer();})();
const {instance}=await WebAssembly.instantiate(bytes,{}),core=instance.exports;
if(core.abi_version()!==1)throw new Error('Rust game core version mismatch');
export const simulationCore='rust-wasm';
const fields=['wx','wz','heading','motionHeading','cameraHeading','speed','drift','boost','somersault','somersaultCooldown','dizzy','somersaultCameraStart','yaw','wasDrifting','wallCooldown'];
const entries=new WeakMap(),slots=Array.from({length:128},(_,slot)=>({slot,valid:false,stamp:0,view:new Float64Array(core.memory.buffer,core.state_ptr(slot),16),last:new Float64Array(15)}));
let clock=0;
export function configureRustArenas(arenas){
  if(arenas.length>8)throw new Error('Too many Rust arenas');
  const input=new Float64Array(core.memory.buffer,core.config_ptr(),128);
  arenas.forEach((arena,index)=>{
    if(arena.blocks.length>32)throw new Error('Too many arena blocks');
    input.set(arena.blocks.flat());if(!core.set_arena(index,arena.size,arena.blocks.length))throw new Error('Invalid Rust arena');
  });
}
export function moveRustKart(world,actor,{steer,gas,brake,handbrake=false,dt,advance=false}){
  let entry=entries.get(actor);
  if(!entry?.valid){
    entry=slots.reduce((oldest,item)=>item.stamp<oldest.stamp?item:oldest);
    const replacement={slot:entry.slot,view:entry.view,last:new Float64Array(15),valid:true,stamp:0};entry.valid=false;slots[entry.slot]=replacement;entry=replacement;entries.set(actor,entry);
    for(let i=0;i<fields.length;i++){const value=Number(actor[fields[i]]??0);entry.view[i]=value;entry.last[i]=value;}
  }
  entry.stamp=++clock;
  // Reconcile only fields changed by combat/actions or an authoritative snapshot.
  // Otherwise this kart's state stays in its Rust slot between command ticks.
  for(let i=0;i<fields.length;i++){const value=Number(actor[fields[i]]??0);if(value!==entry.last[i])entry.view[i]=value;}
  const flags=Number(advance)|Number(gas)*2|Number(brake)*4|Number(handbrake)*8|Number(advance||actor===world||actor.human)*16|Number(world.finishCountdown===null)*32|Number(actor===world)*64;
  const events=core.step(entry.slot,world.arena,steer,dt,flags);
  if(events&0x80000000)throw new Error('Invalid Rust movement command');
  for(let i=0;i<fields.length;i++){const value=entry.view[i];entry.last[i]=value;actor[fields[i]]=fields[i]==='wasDrifting'?Boolean(value):value;}
  if(advance)actor.human=true;
  return events;
}
