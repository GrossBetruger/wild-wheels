import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {ArenaCore} from '../arena-core.js';
const arg=(flag,fallback)=>{const i=process.argv.indexOf(flag);return i<0?fallback:process.argv[i+1];};
const binary=resolve(arg('--binary','dedicated-server/target/release/wild-wheels-server')),output=arg('--output','/private/tmp/wild-wheels-dedicated-benchmark.json');
const trials=[];
for(let trial=0;trial<3;trial++){
  const native=JSON.parse(execFileSync(binary,['--benchmark'],{encoding:'utf8',maxBuffer:4*1024*1024}));
  const config={code:'00',maxPlayers:8,arena:0,bots:0,dedicated:true,host:null,epoch:1,seed:123,players:Array.from({length:8},(_,id)=>({id,name:`Player ${id}`,driver:id,role:'driver'}))};
  const game=ArenaCore.room(config);game.start();const times=[];let bytes=0;
  for(let step=0;step<3600;step++){
    const inputs=Array.from({length:8},(_,actor)=>{const keys=33|[4,8,16][(Math.floor(step/180)+actor)%3];return {actor,keys,moves:[{sequence:step,keys:keys&31}],sequence:step};});
    const start=performance.now();game.step(1/60,inputs);if(step%2===0){for(let id=0;id<8;id++)bytes+=game.packet(id).length;game.drainEvents();}if(step>=600)times.push(performance.now()-start);
  }
  const final=game.snapshot(7),fields=['wx','wz','heading','health','kills','deaths','ammo','missiles'];for(const key of fields)assert.ok(Math.abs(final[key]-native.final[key])<1e-8,`Native/Wasm mismatch: ${key}`);
  assert.ok(Math.abs(bytes-native.bytes)/bytes<.01,'Equivalent packet volume required');delete native.final;times.sort((a,b)=>a-b);const wasm={runtime:'node-wasm',medianMs:times[times.length/2],p95Ms:times[Math.floor(times.length*.95)],p99Ms:times[Math.floor(times.length*.99)],maxMs:times.at(-1),bytes};
  trials.push({native,wasm,p95Speedup:wasm.p95Ms/native.p95Ms});
}
const report={pass:trials.every(t=>t.native.p99Ms<2),criteria:'Eight players: tick plus all eight 30Hz packet encodes p99 < 2ms within a 16.67ms tick budget; matching movement/gameplay and equivalent packet volume.',trials};await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(!report.pass)process.exitCode=1;
