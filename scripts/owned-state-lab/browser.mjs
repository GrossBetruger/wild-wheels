export async function compareOwnedStateBrowser(evaluate){
  await evaluate(`(async()=>{
    globalThis.__ownedModule=await import('/owned-state-lab/experiment.mjs');
    globalThis.__ownedWasm=await (await fetch('/encoding-lab/kernel.wasm')).arrayBuffer();
    globalThis.__ownedCorpus=await (await fetch('/encoding-lab/corpus.json')).json();
  })()`);
  const rows=[];
  for(let i=0;i<3;i++){
    const row=await evaluate(`(async()=>{
      const result=await __ownedModule.ownedStateExperiment(__ownedWasm,[__ownedCorpus[${i}]]);
      const row=result.results[0];row.packetSizes={javascript:row.finalJsPacket.length,rust:row.finalRustPacket.length};
      delete row.finalJsPacket;delete row.finalRustPacket;return row;
    })()`);
    rows.push(row);
  }
  return {userAgent:await evaluate('navigator.userAgent'),crossOriginIsolated:await evaluate('crossOriginIsolated'),results:rows,pass:true};
}
