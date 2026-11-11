import { readFile, writeFile } from 'node:fs/promises';
import { deflateRawSync, constants } from 'node:zlib';
import { ownedStateExperiment } from './owned-state-lab/experiment.mjs';

const [wasm,corpus,output]=process.argv.slice(2);
if(!wasm||!corpus||!output)throw new Error('Usage: node scripts/compare-owned-state.mjs module.wasm corpus.json output.json');
const result=await ownedStateExperiment(await readFile(wasm),JSON.parse(await readFile(corpus,'utf8')));
for(const row of result.results){
  row.packetSizes={};
  for(const [name,field] of [['javascript-owned','finalJsPacket'],['rust-wasm-owned','finalRustPacket']]){
    const bytes=Uint8Array.from(row[field]);
    row.packetSizes[name]={bytes:bytes.length,compressedBytes:deflateRawSync(bytes,{level:1,finishFlush:constants.Z_SYNC_FLUSH}).length-4};delete row[field];
  }
}
await writeFile(output,JSON.stringify({node:process.version,platform:process.platform,arch:process.arch,...result},null,2)+'\n');
console.log(JSON.stringify(result));
