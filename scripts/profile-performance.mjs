import { Multiplayer } from '../multiplayer.js';
import { encodeSnapshot } from '../wire.js';

const scenarios=[
  {name:'driving',players:2,bots:1,drift:false,vulcan:false},
  {name:'drifting',players:2,bots:1,drift:true,vulcan:false},
  {name:'six-player-vulcan',players:6,bots:0,drift:true,vulcan:true}
];
const summarize=values=>{
  const sorted=[...values].sort((a,b)=>a-b);
  return {samples:values.length,meanMs:values.reduce((sum,n)=>sum+n,0)/values.length,p95Ms:sorted[Math.floor(sorted.length*.95)]??0};
};
function prepare(app,room,scenario){
  room.botCount=scenario.bots;
  while(room.members.size<scenario.players)app.join(room,{name:`Profiler ${room.members.size+1}`,driver:null});
  app.makeWorld(room);
  Object.assign(room.world,{phase:'racing',duration:3600,targetScore:100000,supplies:[]});
  for(const actor of [room.world,...room.world.bots])actor.shield=3600;
}
function controls(app,room,scenario){
  const keys=['arrowup',' ',...(room.world.elapsed%4<3?['arrowleft']:[]),...(scenario.drift?['shift']:[])];
  for(const member of room.members.values()){
    member.lastSeen=member.inputAt=Date.now();
    if(!member.socket)member.keys=new Set(keys);
    if(scenario.vulcan)[room.world,...room.world.bots][member.id].vulcan=15;
  }
  return keys;
}
function serverProfile(scenario){
  const app=new Multiplayer();clearInterval(app.timer);
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
        start=performance.now();const state=app.snapshot(room,member);build+=performance.now()-start;
        start=performance.now();const packet=encodeSnapshot(state);encode+=performance.now()-start;
        bytes+=Buffer.byteLength(packet);
      }
      snapshot.push(build);encoding.push(encode);
    }
    return {simulation:summarize(simulation),snapshot:summarize(snapshot),encoding:summarize(encoding),uncompressedMbpsPerRecipient:bytes/30/scenario.players*8/1e6};
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
    __game.renderer.setQuality('balanced');
  }`);
  const originalMembers=new Set(room.members.keys());
  try{
    for(const scenario of scenarios){
      const server=serverProfile(scenario);
      prepare(app,room,scenario);
      const drive=async()=>{
        const keys=controls(app,room,scenario);
        await evaluate(`{__game.keys.clear();for(const key of ${JSON.stringify(keys)})__game.keys.add(key);}`);
      };
      // Warm shaders, caches, simulation and the JIT before collecting browser samples.
      for(let i=0;i<30;i++){await drive();await sleep(100);}
      await evaluate(`{Object.assign(__perf,{enabled:true,render:[],network:[],frame:[],intervals:[],last:null});}`);
      for(let i=0;i<60;i++){await drive();await sleep(100);}
      const browser=await evaluate(`(()=>{
        __perf.enabled=false;
        const {render,network,frame,intervals}=__perf;
        return {render,network,frame,intervals,gpu:__game.renderer.gpuName,softwareGPU:__game.renderer.softwareGPU,width:__game.renderer.canvas.width,height:__game.renderer.canvas.height,pixelRatio:__game.renderer.pixelRatio(),projectiles:__game.race.projectiles.length};
      })()`);
      const result={scenario:scenario.name,server,browser:{...browser,render:summarize(browser.render),network:summarize(browser.network),frame:summarize(browser.frame),intervals:summarize(browser.intervals)},pass:browser.render.length>60&&browser.frame.length>60};
      results.push(result);
      for(const member of [...room.members.values()])if(!originalMembers.has(member.id))app.remove(member);
    }
    return results;
  }finally{await evaluate('__perf.enabled=false;__game.keys.clear()');}
}
