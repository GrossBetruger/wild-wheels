export async function compareEncodingBrowser(evaluate){
  return evaluate(`(async()=>{
    const {createCodecs}=await import('/encoding-lab/codecs.mjs');
    const {codecs,timings}=await createCodecs(await (await fetch('/encoding-lab/kernel.wasm')).arrayBuffer());
    const corpora=await (await fetch('/encoding-lab/corpus.json')).json();
    const stats=values=>{const sorted=[...values].sort((a,b)=>a-b);return {samples:values.length,meanMs:values.reduce((a,b)=>a+b,0)/values.length,p95Ms:sorted[Math.floor(sorted.length*.95)]};};
    const results=[];
    for(const {scenario,snapshots} of corpora){
      for(let i=0;i<120;i++)for(const codec of codecs)codec.decode(codec.encode(snapshots[i%snapshots.length]));
      timings.encode.length=0;timings.decode.length=0;
      const samples=codecs.map(c=>({name:c.name,encode:[],decode:[],roundtrip:[]}));
      for(let round=0;round<3;round++)for(let j=0;j<snapshots.length;j++)for(let offset=0;offset<3;offset++){
        const i=(round+j+offset)%3,codec=codecs[i],sample=samples[i],state=snapshots[j];
        let start=performance.now();for(let batch=0;batch<10;batch++)codec.encode(state);sample.encode.push((performance.now()-start)/10);
        const packet=Uint8Array.from(codec.encode(state));
        start=performance.now();for(let batch=0;batch<10;batch++)codec.decode(packet);sample.decode.push((performance.now()-start)/10);
        start=performance.now();for(let batch=0;batch<10;batch++)codec.decode(codec.encode(state));sample.roundtrip.push((performance.now()-start)/10);
      }
      results.push({scenario,results:samples.map(s=>({name:s.name,encode:stats(s.encode),decode:stats(s.decode),roundtrip:stats(s.roundtrip)}))});
    }
    return {userAgent:navigator.userAgent,batchSize:10,results,pass:true};
  })()`);
}
