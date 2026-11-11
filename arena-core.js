const url=new URL('./rust-core.wasm',import.meta.url);
import {CoreView} from './core-view.js';
const bytes=typeof window==='undefined'?await(await import('node:fs/promises')).readFile(url):await(await fetch(url)).arrayBuffer();
const module=await WebAssembly.compile(bytes),encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const keyBits=new Map([['arrowup',1],['w',1],['arrowdown',2],['s',2],['arrowright',4],['d',4],['arrowleft',8],['a',8],['shift',16],[' ',32]]);
export const keyMask=keys=>typeof keys==='number'?keys:[...keys].reduce((mask,key)=>mask|(keyBits.get(key)??0),0);
export class ArenaCore{
  constructor(seed){this.core=new WebAssembly.Instance(module,{}).exports;this.view=new CoreView(this.core);this.write(seed);if(!this.core.game_init(this.inputLength))throw new Error('Invalid Rust arena seed');}
  write(value){const bytes=encoder.encode(JSON.stringify(value));if(bytes.length>512*1024)throw new Error('Rust command exceeds input capacity');new Uint8Array(this.core.memory.buffer,this.core.game_io_ptr(),bytes.length).set(bytes);this.inputLength=bytes.length;}
  step(dt,inputs=[]){
    this.write({dt,inputs:inputs.map(input=>({...input,keys:keyMask(input.keys??[]),moves:input.moves?.map(move=>({...move,keys:keyMask(move.keys)}))}))});
    if(!this.core.game_frame(this.inputLength))throw new Error('Invalid Rust frame command');
  }
  // Diagnostic snapshots only. Rendering will consume typed memory views, not this JSON.
  snapshot(viewer=0){const size=this.core.game_snapshot(viewer);if(!size)throw new Error('Unable to read Rust arena');return JSON.parse(decoder.decode(new Uint8Array(this.core.memory.buffer,this.core.game_output_ptr(),size)));}
  packet(viewer=0){const size=this.core.game_packet(viewer);if(!size)throw new Error('Unable to encode Rust packet');return new Uint8Array(this.core.memory.buffer,this.core.game_output_ptr(),size).slice();}
  drainEvents(){this.core.game_drain();}
  present(viewer=0){const view=this.view.refresh(this.core.game_present(viewer));this.drainEvents();return view;}
}
export class ArenaClient{
  constructor(){this.core=new WebAssembly.Instance(module,{}).exports;this.view=new CoreView(this.core);}
  accept(packet,now){const bytes=packet instanceof ArrayBuffer?new Uint8Array(packet):packet;if(!(bytes instanceof Uint8Array)||bytes.length>512*1024)throw new Error('Invalid Rust snapshot');new Uint8Array(this.core.memory.buffer,this.core.game_io_ptr(),bytes.length).set(bytes);if(!this.core.client_accept(bytes.length,now))throw new Error('Rust snapshot rejected');}
  frame(dt,keys,now,steer=2){this.keys=keyMask(keys);this.steer=steer;if(!this.core.client_frame(dt,this.keys,steer,now))throw new Error('Invalid Rust client frame');}
  read(size){if(!size)throw new Error('Rust client output unavailable');return decoder.decode(new Uint8Array(this.core.memory.buffer,this.core.game_output_ptr(),size));}
  outbound(keys){return JSON.parse(this.read(this.core.client_outbound(keyMask(keys))));}
  outboundText(keys){return this.read(this.core.client_outbound(keyMask(keys)));}
  snapshot(){return JSON.parse(this.read(this.core.client_snapshot()));}
  resend(){this.core.client_resend();}
  present(){const view=this.view.refresh(this.core.client_present());this.core.client_drain();return view;}
  action(type,item,now){const value={type,...(type==='bomb'?item:{}),...(type==='select'?{item}:{})};const bytes=encoder.encode(JSON.stringify(value));if(bytes.length>2048)return false;new Uint8Array(this.core.memory.buffer,this.core.game_io_ptr(),bytes.length).set(bytes);const accepted=Boolean(this.core.client_action(bytes.length,now));if(accepted)this.core.client_frame(0,this.keys??0,this.steer??2,now);return accepted;}
}
