import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderEffectCostReport} from '../../scripts/profiling/effect-report.mjs';

test('effect report shows separate CPU and GPU leaders and preserves negative measurements',()=>{
  const report={metadata:{samples:30,width:1280,height:800,softwareGPU:false,gpu:'Test GPU'},machine:{cpu:'Test CPU'},generatedAt:'2026-11-16',revision:'12345678',scope:'Browser only',results:[
    {name:'Fire ring',group:'World effects',delta:{cpuMs:4,gpuMs:.1,draws:0,triangles:5760,points:432,uploadBytes:634176},effect:{cpuMs:{p95:4.5}}},
    {name:'Fog',group:'World effects',delta:{cpuMs:-.1,gpuMs:1.5,draws:3,triangles:0,points:0,uploadBytes:0},effect:{cpuMs:{p95:1}}},
  ]};
  const html=renderEffectCostReport(report);
  assert.ok(html.includes('+4.000 ms'));
  assert.ok(html.includes('+1.500 ms'));
  const data=JSON.parse(html.match(/<script id="measurements" type="application\/json">(.*?)<\/script>/s)[1]);
  assert.equal(data.find(row=>row.name==='Fog').delta.cpuMs,-.1);
});

test('offline effect report displays names safely even when GPU timing is unavailable',()=>{
  const report={metadata:{samples:10,width:1280,height:800,gpu:'Unavailable'},machine:{cpu:'CPU'},results:[
    {name:'</script><img src=x onerror=alert(1)>',group:'Clouds',delta:{cpuMs:1,gpuMs:null},effect:{cpuMs:{p95:2}}},
  ]};
  const html=renderEffectCostReport(report);
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;/script&gt;&lt;img'));
  assert.ok(html.includes('GPU timers were unavailable'));
  const data=JSON.parse(html.match(/<script id="measurements" type="application\/json">(.*?)<\/script>/s)[1]);
  assert.equal(data[0].name,'</script><img src=x onerror=alert(1)>');
});
