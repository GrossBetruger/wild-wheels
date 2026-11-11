import { Multiplayer } from '../multiplayer.js';
import {arenaFixture} from './arena-fixture.mjs';
import {createBinaryEncoder} from '../binary-wire.js';
const encodeSnapshot=createBinaryEncoder();

const scenarios=[
  {name:'driving',players:2,bots:1,drift:false,vulcan:false},
  {name:'drifting',players:2,bots:1,drift:true,vulcan:false},
  {name:'six-player-vulcan',players:6,bots:0,drift:true,vulcan:true}
];
const summarize=values=>{
  if(!values.length)return {samples:0,meanMs:null,p95Ms:null};
  const sorted=[...values].sort((a,b)=>a-b);
  return {samples:values.length,meanMs:values.reduce((sum,n)=>sum+n,0)/values.length,p95Ms:sorted[Math.floor(sorted.length*.95)]??0};
};
function prepare(app,room,scenario){
  room.botCount=scenario.bots;
  while(room.members.size<scenario.players)app.join(room,{name:`Profiler ${room.members.size+1}`,driver:null});
  app.makeWorld(room);
  Object.assign(room.world,{phase:'racing',duration:3600,targetScore:100000,supplies:[]});
  for(const actor of [room.world,...room.world.bots]){actor.shield=3600;if(scenario.vulcan)actor.vulcan=3600;}
}
function controls(app,room,scenario){
  const keys=['arrowup',' ',...(room.world.elapsed%4<3?['arrowleft']:[]),...(scenario.drift?['shift']:[])];
  for(const member of room.members.values()){
    member.lastSeen=member.inputAt=Date.now();
    if(!member.socket)member.keys=new Set(keys);
  }
  return keys;
}
function serverProfile(scenario,MultiplayerType=Multiplayer){
  const app=new MultiplayerType({fixtureWorld:arenaFixture});clearInterval(app.timer);
  // Exclude transport and encoding from simulation measurements; measure them separately.
  app.broadcast=()=>{};
  const room={code:'07',arena:0,botCount:scenario.bots,host:0,members:new Map()};
  app.makeWorld(room);app.rooms.set(room.code,room);
  try{
    prepare(app,room,scenario);
    const simulation=[],snapshot=[],encoding=[];let bytes=0;
    for(let frame=0;frame<2100;frame++){
      controls(app,room,scenario);
      let start=performance.now();app.step(1/60);const tick=performance.now()-start;
      if(frame<300)continue;
      simulation.push(tick);
      if(frame%2)continue;
      // Include every recipient: this is total room work per 30 Hz broadcast.
      let build=0,encode=0;
      for(const member of room.members.values()){
        if(room.core){start=performance.now();const packet=room.core.packetRecord(member.id);encode+=performance.now()-start;bytes+=packet.data.length;continue;}
        start=performance.now();const state=app.snapshot(room,member);build+=performance.now()-start;
        start=performance.now();const packet=encodeSnapshot(state);encode+=performance.now()-start;bytes+=packet.length;
      }
      if(!room.core)snapshot.push(build);encoding.push(encode);
    }
    return {pipeline:room.core?'rust-owned':'javascript',simulation:summarize(simulation),snapshot:summarize(snapshot),encoding:summarize(encoding),uncompressedMbpsPerRecipient:bytes/30/scenario.players*8/1e6};
  }finally{app.close();}
}

export async function profilePerformance(evaluate,app,room,sleep){
  const results=[];
  await evaluate(`{
    const metrics=globalThis.__perf;
    for(const [object,method,key] of [[__game.renderer,'draw','render'],[__game.network,'render','network']]){
      const original=object[method].bind(object);
      object[method]=(...args)=>{const start=performance.now();try{return original(...args);}finally{if(metrics.enabled)metrics[key].push(performance.now()-start);}};
    }
    const socket=__game.network.socket,receive=socket.onmessage;
    socket.onmessage=event=>{const start=performance.now();try{return receive.call(socket,event);}finally{if(metrics.enabled&&event.data instanceof ArrayBuffer)metrics.receive.push(performance.now()-start);}};
    __game.renderer.setQuality('balanced');
    const gl=__game.renderer.gl,ext=gl.getExtension('EXT_disjoint_timer_query'),pending=[];
    metrics.gpuTimerSupported=Boolean(ext&&ext.getQueryEXT(ext.TIME_ELAPSED_EXT,ext.QUERY_COUNTER_BITS_EXT)>0);
    metrics.gpuElapsed=[];metrics.gpuDisjoint=0;metrics.generation=0;
    metrics.pollGpu=()=>{
      if(!metrics.gpuTimerSupported)return;
      if(gl.getParameter(ext.GPU_DISJOINT_EXT)){
        for(const item of pending)ext.deleteQueryEXT(item.query);
        pending.length=0;metrics.gpuElapsed=[];metrics.gpuDisjoint++;return;
      }
      while(pending.length&&ext.getQueryObjectEXT(pending[0].query,ext.QUERY_RESULT_AVAILABLE_EXT)){
        const item=pending.shift(),ns=ext.getQueryObjectEXT(item.query,ext.QUERY_RESULT_EXT);
        if(item.generation===metrics.generation)metrics.gpuElapsed.push(ns/1e6);
        ext.deleteQueryEXT(item.query);
      }
    };
    const draw=__game.renderer.draw.bind(__game.renderer);
    __game.renderer.draw=(...args)=>{
      metrics.pollGpu();
      const query=metrics.enabled&&metrics.gpuTimerSupported&&pending.length<8?ext.createQueryEXT():null;
      if(query)ext.beginQueryEXT(ext.TIME_ELAPSED_EXT,query);
      try{return draw(...args);}finally{
        if(query){ext.endQueryEXT(ext.TIME_ELAPSED_EXT);pending.push({query,generation:metrics.generation});}
      }
    };
  }`);
  const originalMembers=new Set(room.members.keys());
  try{
    for(const scenario of scenarios){
      const server=serverProfile(scenario,app.constructor);
      prepare(app,room,scenario);
      const drive=async()=>{
        const keys=controls(app,room,scenario);
        await evaluate(`{__game.keys.clear();for(const key of ${JSON.stringify(keys)})__game.keys.add(key);}`);
      };
      // Warm shaders, caches, simulation and the JIT before collecting browser samples.
      for(let i=0;i<30;i++){await drive();await sleep(100);}
      await evaluate(`{Object.assign(__perf,{enabled:true,render:[],network:[],receive:[],frame:[],intervals:[],last:null,gpuElapsed:[],gpuDisjoint:0,generation:__perf.generation+1});}`);
      for(let i=0;i<60;i++){await drive();await sleep(100);}
      await evaluate('__perf.enabled=false');
      await sleep(200); // Let the last GPU queries complete without forcing a pipeline stall.
      const browser=await evaluate(`(()=>{
        __perf.pollGpu();
        const {render,network,receive,frame,intervals,gpuElapsed,gpuTimerSupported,gpuDisjoint}=__perf;
        return {render,network,receive,frame,intervals,gpuElapsed,gpuTimerSupported,gpuDisjoint,gpu:__game.renderer.gpuName,softwareGPU:__game.renderer.softwareGPU,width:__game.renderer.canvas.width,height:__game.renderer.canvas.height,pixelRatio:__game.renderer.pixelRatio(),projectiles:__game.race.projectiles.length};
      })()`);
      const result={scenario:scenario.name,server,browser:{...browser,gpuElapsed:summarize(browser.gpuElapsed),render:summarize(browser.render),network:summarize(browser.network),receive:summarize(browser.receive),frame:summarize(browser.frame),intervals:summarize(browser.intervals)},pass:browser.render.length>60&&browser.frame.length>60&&browser.receive.length>60&&(!browser.gpuTimerSupported||browser.gpuElapsed.length>60)};
      results.push(result);
      for(const member of [...room.members.values()])if(!originalMembers.has(member.id))app.remove(member);
    }
    return results;
  }finally{await evaluate('__perf.enabled=false;__game.keys.clear()');}
}
