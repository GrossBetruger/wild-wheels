import {createServer} from 'node:http';
import {readFile,mkdir,writeFile,mkdtemp} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
import {tmpdir,cpus,platform,release} from 'node:os';
import {spawn,spawnSync} from 'node:child_process';
import {parseArgs} from 'node:util';
import WebSocket from 'ws';
import {renderEffectCostReport,openEffectReport} from './effect-report.mjs';

const root=resolve(import.meta.dirname,'../..');
const {values}=parseArgs({options:{samples:{type:'string',default:'30'},out:{type:'string',default:join(root,'.wild-wheels/reports/effect-costs')},limit:{type:'string'},filter:{type:'string'},resume:{type:'boolean',default:false},'no-open':{type:'boolean',default:false},'report-only':{type:'boolean',default:false}}});
const samples=Number(values.samples),limit=values.limit===undefined?Infinity:Number(values.limit);
if(!Number.isInteger(samples)||samples<10||samples>600)throw new Error('--samples must be an integer from 10 to 600.');
if(limit!==Infinity&&(!Number.isInteger(limit)||limit<1))throw new Error('--limit must be a positive integer.');
const output=resolve(values.out);await mkdir(resolve(output,'..'),{recursive:true});
if(values['report-only']){
  const report=JSON.parse(await readFile(output+'.json','utf8'));
  if(report.errors?.length)throw new Error('The saved measurements contain browser errors. Run the profiler again.');
  await writeFile(output+'.html',renderEffectCostReport(report));
  console.log(`HTML report: ${output}.html`);
  openEffectReport(output+'.html',{disabled:values['no-open']});
  process.exit(0);
}
const errors=[];
let interrupted=false;
process.once('SIGINT',()=>{interrupted=true;});
process.once('SIGTERM',()=>{interrupted=true;});
const server=createServer(async(req,res)=>{
  try{
    const path=new URL(req.url,'http://localhost').pathname;
    if(path==='/'){
      res.writeHead(200,{'Content-Type':'text/html'});
      res.end('<!doctype html><meta charset="utf-8"><title>Effect profiler</title><style>body{margin:0}canvas{width:1280px;height:800px}</style><canvas width="1280" height="800"></canvas><script type="module">import {createEffectProfiler} from "/scripts/profiling/effect-scenes.mjs";globalThis.profiler=createEffectProfiler(document.querySelector("canvas"),{samples:'+samples+'});</script>');return;
    }
    const file=resolve(root,`.${decodeURIComponent(path)}`);
    const allowed=['client','characters','gameplay','ui','audio','networking','scripts/profiling'].some(dir=>file.startsWith(join(root,dir)+sep));
    if((!allowed||extname(file)!=='.js'&&extname(file)!=='.mjs')&&file!==join(root,'rust-core.wasm')){res.writeHead(404);res.end();return;}
    const body=await readFile(file);res.writeHead(200,{'Content-Type':file.endsWith('.wasm')?'application/wasm':'text/javascript'});res.end(body);
  }catch{res.writeHead(404);res.end();}
});
await new Promise((done,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',done);});
const profile=await mkdtemp(join(tmpdir(),'wild-wheels-effects-chrome-'));
const chrome=spawn(process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows','--window-size=1400,1000','about:blank'],{stdio:['ignore','ignore','pipe']});
let chromeLog='',chromeError,ws,sequence=0;const pending=new Map();
chrome.on('error',error=>{chromeError=error;});chrome.stderr.on('data',data=>{chromeLog+=data;});
const sleep=ms=>new Promise(done=>setTimeout(done,ms));
async function waitFor(fn,label){const end=Date.now()+30000;while(Date.now()<end){if(chromeError)throw chromeError;if(await fn())return;await sleep(100);}throw new Error(`Timed out: ${label}`);}
function call(method,params={},sessionId){return new Promise((done,reject)=>{
  const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error(`CDP timeout: ${method}`));},60000);
  pending.set(id,{done,reject,timer});ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));
});}
async function evaluate(sessionId,expression){const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},sessionId);if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description??result.exceptionDetails.text);return result.result.value;}
const number=(value,digits=3)=>value===null?'unavailable':value.toFixed(digits);
try{
  await waitFor(()=>/DevTools listening on (ws:\/\/\S+)/.test(chromeLog),'Chrome startup');
  ws=new WebSocket(chromeLog.match(/DevTools listening on (ws:\/\/\S+)/)[1]);await new Promise((done,reject)=>{ws.once('open',done);ws.once('error',reject);});
  ws.on('message',bytes=>{const message=JSON.parse(bytes);if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.text);const task=pending.get(message.id);if(!task)return;pending.delete(message.id);clearTimeout(task.timer);if(message.error)task.reject(new Error(JSON.stringify(message.error)));else task.done(message.result);});
  const {targetId}=await call('Target.createTarget',{url:`http://127.0.0.1:${server.address().port}/`});
  const {sessionId}=await call('Target.attachToTarget',{targetId,flatten:true});await call('Runtime.enable',{},sessionId);
  await waitFor(()=>evaluate(sessionId,'Boolean(globalThis.profiler)'),'profiler module');
  const metadata=await evaluate(sessionId,'profiler.metadata'),scenes=await evaluate(sessionId,'profiler.scenes');
  const revision=spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).stdout?.trim()??'unknown';
  const report={generatedAt:new Date().toISOString(),revision,machine:{cpu:cpus()[0]?.model,platform:platform(),release:release()},metadata,scope:'Browser renderer only; single subject or the explicitly named multiplicity, Scrapyard, Balanced 1280 × 800. Each effect follows a same-driver baseline. Animation ages are sampled from representative portions, not every possible state or worst-case overlap. CPU and GPU overlap; never add them. Negative deltas are retained as noise or changes in visible scene. Native playback and gameplay simulation are not timed.',results:[],errors};
  if(values.resume){
    const previous=JSON.parse(await readFile(output+'.json','utf8'));
    for(const key of ['gpu','samples','width','height'])if(previous.metadata?.[key]!==metadata[key])throw new Error(`Cannot resume with different ${key}.`);
    if(!Array.isArray(previous.results))throw new Error('Cannot resume an invalid results file.');
    report.results=previous.results;report.previousGeneratedAt=previous.generatedAt;
  }
  if(values.filter&&!scenes.some(scene=>scene.name.includes(values.filter)))throw new Error('No scenes match --filter.');
  for(let i=0;i<Math.min(limit,scenes.length);i++){
    if(interrupted)throw new Error('Profiling interrupted; partial JSON retained.');
    if(values.filter&&!scenes[i].name.includes(values.filter))continue;
    const row=await evaluate(sessionId,`profiler.run(${i})`);row.measuredAt=new Date().toISOString();
    const previous=report.results.findIndex(result=>result.name===row.name);
    if(previous<0)report.results.push(row);
    if(previous>=0)report.results[previous]=row;
    console.log(`${i+1}/${Math.min(limit,scenes.length)} ${row.name}: CPU Δ ${number(row.delta.cpuMs)} ms, GPU Δ ${number(row.delta.gpuMs)} ms`);
    await writeFile(output+'.json',JSON.stringify(report,null,2)+'\n');
  }
  const sorted=[...report.results].sort((a,b)=>b.delta.cpuMs-a.delta.cpuMs);
  const header='| Effect | CPU Δ ms | Total CPU p95 ms | GPU Δ ms | Draw calls Δ | Triangles Δ | Particles Δ | Upload Δ KiB |';
  const table=rows=>[header,'|---|---:|---:|---:|---:|---:|---:|---:|',...rows.map(row=>`| ${row.name} | ${number(row.delta.cpuMs)} | ${number(row.effect.cpuMs.p95)} | ${number(row.delta.gpuMs)} | ${number(row.delta.draws,1)} | ${number(row.delta.triangles,0)} | ${number(row.delta.points,0)} | ${number(row.delta.uploadBytes/1024,1)} |`)].join('\n');
  const markdown=`# Visual effect costs\n\nMeasured ${report.generatedAt} on ${report.machine.cpu}; ${metadata.gpu}.\n\n${report.scope}\n\n${report.results.length} scenarios; ${samples} measured frames and 12 warm-up frames each for baseline and effect. GPU timer support: ${metadata.gpuSupported}. Raw results retain baseline and effect means, p95, sample counts and disjoint events. CPU timers include geometry construction, instrumentation and WebGL submission. GPU timers use asynchronous disjoint queries without gl.finish.\n\n## Highest measured CPU additions\n\n${table(sorted.slice(0,10))}\n\n## All effects\n\n${table(sorted)}\n\n## Interpretation\n\nPrioritize repeatable large CPU additions and geometry/upload growth. Small differences are noisy at browser timer precision. These are single-machine samples, not proof of mobile performance, and not safe to sum across simultaneous effects. Some gameplay effects have no separate visible rendering: locustSpawn, locustBurst and yudaSmoke are deliberately skipped by the renderer; their corresponding swarm or exhaust is measured separately. Some racer special states also have no persistent visual; their world effects appear separately. The 12-frame warm-up does not cover every animation phase; p95 may include phase-specific cache misses. Results do not measure activation spikes, native clip memory, audio, network, simulation, or all lifetime peaks.\n`;
  const gpuTable=table([...report.results].sort((a,b)=>(b.delta.gpuMs??-Infinity)-(a.delta.gpuMs??-Infinity)).slice(0,5));
  await writeFile(output+'.md',markdown.replace('\n## All effects\n',`\n## Highest measured GPU additions\n\n${gpuTable}\n\n## All effects\n`));
  if(errors.length)throw new Error(`Browser reported errors: ${errors.join('; ')}`);
  await writeFile(output+'.html',renderEffectCostReport(report));
  openEffectReport(output+'.html',{disabled:values['no-open']});
  console.log(`Reports: ${output}.{json,md,html}`);
}finally{
  for(const task of pending.values()){clearTimeout(task.timer);task.reject(new Error('Profiler shutting down'));}
  ws?.close();chrome.kill('SIGTERM');server.closeAllConnections();await new Promise(done=>server.close(done));
}
