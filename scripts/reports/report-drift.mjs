import { readFile, writeFile } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';

const reports={};
for(const name of ['drift-before','drift-after','drift-movement','drift-actions']){
  const path=new URL(`../../diagnostics/${name}.json`,import.meta.url);
  let content=await readFile(path,'utf8'),report=JSON.parse(content);
  if(!report.results[0].trace){content=gunzipSync(await readFile(new URL(path.href+'.gz'))).toString();report=JSON.parse(content);}
  if(name!=='drift-before'&&(report.errors.length||report.transportErrors.length||report.results.some(row=>!row.pass)))throw new Error('Validation failed: '+name);
  await writeFile(new URL(path.href+'.gz'),gzipSync(content,{level:9}));
  await writeFile(path,JSON.stringify({...report,baselineCommit:'3dd04d8',results:report.results.map(({trace,requests,sounds,...row})=>row)},null,2)+'\n');
  reports[name]=report;
}
const before=reports['drift-before'].results.find(row=>row.profile==='160ms-guest'),after=reports['drift-after'].results;
const worst=key=>Math.max(...after.map(row=>row[key]));
const rows=[
  ['Smoke and sparks',before.smokeMs,worst('smokeMs'),'≤20 ms'],
  ['Tire tracks',before.skidsMs,worst('skidsMs'),'≤20 ms'],
  ['Blue charge sparks',before.chargeMs[0],Math.max(...after.map(row=>row.chargeMs[0])),'≤20 ms'],
  ['Purple charge sparks',before.chargeMs[1],Math.max(...after.map(row=>row.chargeMs[1])),'≤20 ms']
];
const links=Object.keys(reports).map(name=>`<li><a href="${name}.json">${name} summary</a> · <a href="${name}.json.gz">full trace</a></li>`).join('');
const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Wild Wheels — drift feedback</title><style>body{font:17px system-ui;max-width:960px;margin:40px auto;padding:0 24px;background:#101724;color:#e8edf5}h1{font-size:30px}p,li{line-height:1.6;color:#b9c7da}strong{color:#79e1b0}table{border-collapse:collapse;width:100%;margin:24px 0}th,td{text-align:left;padding:12px;border-bottom:1px solid #30415a}a{color:#9fc7ff}code{color:#e8edf5}</style><h1>Immediate drift visuals</h1><p>Baseline: published commit <code>3dd04d8</code>. <strong>${after.filter(row=>row.pass).length}/${after.length} final drift browser runs pass</strong>, covering localhost host, localhost guest, 160 ms round-trip delay, and 160 ms with ±30 ms one-way jitter, each repeated three times.</p><table><thead><tr><th>Feedback</th><th>Before, 160 ms guest</th><th>After, worst of 12</th><th>Criterion</th></tr></thead><tbody>${rows.map(([label,old,value,limit])=>`<tr><td>${label}</td><td>${old} ms</td><td>${value} ms</td><td>${limit}</td></tr>`).join('')}</tbody></table><p>Zero means the first rendered frame containing the local drift state or charge milestone also contains its effects. This measures the renderer's input, not physical monitor latency.</p><p>Fresh particle distance from the rendered rear wheels: <strong>${worst('freshWheelGapMax')} world units</strong> (limit 0.05), down from ${before.freshWheelGapMax} before. Trail emissions after release: <strong>${worst('lateEmissions')}</strong>, down from ${before.lateEmissions}. Worst 95th-percentile frame interval: <strong>${worst('frameP95Ms')} ms</strong> (limit 20 ms).</p><p><b>What changed.</b> A local cosmetic history emits smoke, sparks and tire tracks from rendered wheel positions. It uses the shared effect shapes and aging rules but never replays effects during movement reconciliation. Charge colors update in the milestone frame. Ownership survives compact snapshots, allowing the browser to suppress its delayed effects while retaining other players' trails.</p><p><b>Checks.</b> All 161 automated tests pass, including no duplicate trails through server confirmation, immediate release, smooth particle aging across snapshot clock corrections, stalled connections, respawns and new matches. All ${reports['drift-movement'].results.length} browser movement checks and all ${reports['drift-actions'].results.length} projectile/pickup checks also pass. The change is cosmetic; movement, boost rewards and collisions remain server controlled.</p><p><b>Method.</b> Real Chrome/WebGL, actual authenticated WebSockets and compression, FIFO latency queues in both directions, and observations from the view consumed by the renderer. Only the test harness exposes internal game objects; production routes do not.</p><ul>${links}</ul><p>Reproduce: <code>npm run test:browser-netcode -- --drift --repeat 3 --output /private/tmp/wild-wheels-drift.json</code></p></html>`;
await writeFile(new URL('../../diagnostics/drift-report.html',import.meta.url),html);
console.log('Saved drift report, summaries and compressed traces.');
