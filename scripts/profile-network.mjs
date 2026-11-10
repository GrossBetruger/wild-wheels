import { constants, deflateRawSync } from 'node:zlib';
import { Multiplayer } from '../multiplayer.js';
import { encodeSnapshot, decodeSnapshot } from '../wire.js';

// Thirty simulated seconds per scenario, sampled at the game's 30 Hz send rate.
// Estimates payload bandwidth; excludes TCP/TLS/framing and real network latency.
const scenarios=[
  {name:'Two players driving and firing, one bot',players:2,bots:1,drift:false},
  {name:'Two players drifting, one bot',players:2,bots:1,drift:true},
  {name:'Six players drifting with Vulcan',players:6,bots:0,drift:true,vulcan:true}
];
const originalRandom=Math.random;
for(const scenario of scenarios){
  // Seed cosmetic/AI randomness only in this standalone benchmark process.
  let seed=123;
  Math.random=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296);
  const app=new Multiplayer();clearInterval(app.timer);
  try{
    const room={code:'07',arena:0,botCount:scenario.bots,host:0,members:new Map()};
    app.makeWorld(room);app.rooms.set(room.code,room);
    const members=Array.from({length:scenario.players},(_,i)=>app.join(room,{name:`Player ${i+1}`,driver:null}));
    room.world.phase='racing';
    let rawBytes=0,compactBytes=0,compressedBytes=0,samples=0;
    for(let frame=0;frame<1800;frame++){
      for(const member of members){
        member.inputAt=member.lastSeen=Date.now();
        member.keys=new Set(['arrowup',' ',...(frame%240<180?['arrowleft']:[]),...(scenario.drift?['shift']:[])]);
        if(scenario.vulcan)[room.world,...room.world.bots][member.id].vulcan=15;
      }
      app.step(1/60);
      if(frame%2)continue;
      const state=app.snapshot(room,members.at(-1)),encoded=encodeSnapshot(state);
      decodeSnapshot(JSON.parse(encoded)); // Exercise the browser decoder, including effect limits.
      rawBytes+=Buffer.byteLength(JSON.stringify(state));
      compactBytes+=Buffer.byteLength(encoded);
      compressedBytes+=deflateRawSync(encoded,{level:1,finishFlush:constants.Z_SYNC_FLUSH}).length-4;
      samples++;
    }
    const mbps=bytes=>+(bytes/samples*30*8/1e6).toFixed(2);
    console.log(JSON.stringify({scenario:scenario.name,seconds:30,snapshots:samples,rawMbpsPerGuest:mbps(rawBytes),compactMbpsPerGuest:mbps(compactBytes),compressedMbpsPerGuest:mbps(compressedBytes),reductionPercent:+((1-compressedBytes/rawBytes)*100).toFixed(1)}));
  }finally{app.close();Math.random=originalRandom;}
}
