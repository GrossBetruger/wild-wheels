import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { constants, deflateRawSync } from 'node:zlib';
import { Multiplayer } from '../../server/multiplayer.js';
import {arenaFixture} from '../helpers/arena-fixture.mjs';
import { createCodecs } from '../encoding-lab/codecs.mjs';

const wasm=process.argv[2],output=process.argv[3];
if(!wasm||!output)throw new Error('Usage: node scripts/profiling/compare-encoding.mjs kernel.wasm results.json');
const {codecs,timings,measureKernel}=await createCodecs(await readFile(wasm));
const stats=values=>{
  const sorted=[...values].sort((a,b)=>a-b);
  return {samples:values.length,meanMs:values.reduce((a,b)=>a+b,0)/values.length,p50Ms:sorted[Math.floor(sorted.length*.5)],p95Ms:sorted[Math.floor(sorted.length*.95)]};
};
function corpus(scenario){
  const app=new Multiplayer({fixtureWorld:arenaFixture});clearInterval(app.timer);app.broadcast=()=>{};
  const random=Math.random;let seed=123;Math.random=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296);
  try{
    const room={code:'07',arena:0,botCount:scenario.bots,host:0,members:new Map()};app.makeWorld(room);app.rooms.set('07',room);
    const members=Array.from({length:scenario.players},(_,i)=>app.join(room,{name:i===0?'Bomber 🦊 שלום':'Player '+i,driver:null}));room.world.phase='racing';
    const snapshots=[];
    for(let frame=0;frame<1800;frame++){
      for(const member of members){member.lastSeen=member.inputAt=Date.now();member.keys=new Set(['arrowup',' ',...(frame%240<180?['arrowleft']:[]),...(scenario.drift?['shift']:[])]);if(scenario.vulcan)[room.world,...room.world.bots][member.id].vulcan=15;}
      app.step(1/60);
      if(frame>=300&&frame%25===0)snapshots.push(JSON.parse(JSON.stringify(app.snapshot(room,members.at(-1)))));
    }
    return snapshots;
  }finally{Math.random=random;app.close();}
}
const results=[];
const corpora=[];
for(const scenario of [{name:'driving',players:2,bots:1},{name:'drifting',players:2,bots:1,drift:true},{name:'six-player-vulcan',players:6,bots:0,drift:true,vulcan:true}]){
  const snapshots=corpus(scenario),samples=codecs.map(codec=>({name:codec.name,encode:[],decode:[],roundtrip:[],rawBytes:0,compressedBytes:0}));
  corpora.push({scenario:scenario.name,snapshots});
  // Verify all snapshots, both binary cross-decode directions, and byte identity.
  for(const state of snapshots){
    const expected=codecs[0].decode(codecs[0].encode(state));
    const js=Uint8Array.from(codecs[1].encode(state)),rust=Uint8Array.from(codecs[2].encode(state));
    assert.deepEqual(rust,js);
    assert.deepEqual(codecs[1].decode(rust),expected);assert.deepEqual(codecs[2].decode(js),expected);
    for(let i=0;i<codecs.length;i++){
      const packet=codecs[i].encode(state);assert.deepEqual(codecs[i].decode(packet),expected);
      samples[i].rawBytes+=packet.length;
      samples[i].compressedBytes+=deflateRawSync(packet,{level:1,finishFlush:constants.Z_SYNC_FLUSH}).length-4;
    }
  }
  for(let warm=0;warm<120;warm++)for(const codec of codecs)codec.decode(codec.encode(snapshots[warm%snapshots.length]));
  timings.encode.length=0;timings.decode.length=0;
  // Rotate order to avoid giving one implementation all the warmest iterations.
  for(let round=0;round<10;round++)for(let j=0;j<snapshots.length;j++)for(let offset=0;offset<3;offset++){
    const i=(round+j+offset)%3,codec=codecs[i],sample=samples[i],start=performance.now();
    const packet=codec.encode(snapshots[j]),middle=performance.now();codec.decode(packet);const end=performance.now();
    sample.encode.push(middle-start);sample.decode.push(end-middle);sample.roundtrip.push(end-start);
  }
  // Separate kernel-only sampling so its timers do not penalize the Rust full path.
  measureKernel.enabled=true;
  for(let i=0;i<600;i++)codecs[2].decode(codecs[2].encode(snapshots[i%snapshots.length]));
  measureKernel.enabled=false;
  const result={scenario:scenario.name,snapshots:snapshots.length,semanticEquality:true,binaryBytesIdentical:true,results:samples.map(s=>({name:s.name,encode:stats(s.encode),decode:stats(s.decode),roundtrip:stats(s.roundtrip),rawBytes:s.rawBytes/snapshots.length,compressedBytes:s.compressedBytes/snapshots.length,compressedMbpsAt30Hz:s.compressedBytes/snapshots.length*30*8/1e6})),wasmKernelOnly:{encode:stats(timings.encode),decode:stats(timings.decode)}};
  results.push(result);console.log(JSON.stringify(result));
}
await writeFile(output,JSON.stringify({node:process.version,platform:process.platform,arch:process.arch,results},null,2)+'\n');
await writeFile(output+'.corpus.json',JSON.stringify(corpora));
