import {Renderer} from '../../client/renderer.js';
import {createBattle,BOMB_FALL_TIME,RADIATION_DURATION} from '../../gameplay/combat.js';
import {drivers} from '../../gameplay/engine.js';

export function effectScenes(){
  const scenes=[];
  const add=(name,driver,apply,group='Racer effects')=>scenes.push({name,driver,apply,group});
  for(let driver=0;driver<drivers.length;driver++){
    const name=drivers[driver].name;
    for(const [state,value] of [['boost',2],['vulcan',3],['shield',2],['hedgeShield',2],['tehilim',2],['dizzy',2],['celebrate',1],['somersault',.5]]){
      add(`${name} / ${state}`,driver,r=>{r[state]=value;if(state==='vulcan')r.fireCooldown=.1;});
    }
    if([5,7,8,9,11,12,13,14].includes(driver))add(`${name} / special`,driver,r=>{
      r.specialActive=3;
      if(driver===8){r.timeStop=2.5;r.timeOwner=r.id;}
    });
    add(`${name} / ashes`,driver,(r,t)=>{r.destroyed=2;r.effects=[{type:'ash',owner:r.id,wx:r.wx,wz:r.wz,age:.2+t*.8,life:4.3}];},'World effects');
    add(`${name} / rapid-fire projectile + 12-point trail`,driver,r=>{r.projectiles=[{id:1,owner:r.id,kind:'hedgehog',vulcan:true,wx:0,wz:65,heading:0,height:2,age:1,life:2,trail:Array.from({length:12},(_,i)=>({wx:0,wz:65-i*.3,height:2}))}];},'Projectiles');
  }
  add('Nightmare Fuel / full plume',7,r=>{r.nightmareActive=13;r.boost=13;});
  add('Nightmare Fuel / half-length ending',7,r=>{r.nightmareActive=.5;r.boost=.5;});
  add('Reverse Psychology / puppet',0,r=>{r.reverseControls=4;});
  add('Xylophone-Attack / victim view',0,r=>{r.bots[0].driver=13;r.bots[0].specialActive=3;});
  add('Dark Humor / victim fog',0,r=>{Object.assign(r.bots[0],{driver:14,specialActive:3,inactive:false,destroyed:0,wx:20,wz:60});});
  scenes.at(-1).baseline=r=>{Object.assign(r.bots[0],{driver:14,specialActive:0,inactive:false,destroyed:0,wx:20,wz:60});};
  add('Dark Humor / caster X-ray',14,r=>{r.specialActive=3;});
  for(const [type,life] of [['reverseShockwave',2.2],['explosion',2.5],['abomb',3],['radiation',RADIATION_DURATION],['fashionSnap',1.2],['heartbeat',.7],['taxAudit',2.5],['teleportOut',1.35],['teleportIn',1.35],['locustSpawn',1.2],['locustBurst',.7],['pickup',.65],['fireRingOut',2.4],['yudaSmoke',3]]){
    add(type,0,(r,t)=>{r.effects=[{type,owner:r.id,wx:r.wx,wz:r.wz+6,heading:0,age:life*(.1+.7*t),life,radius:20,color:'#ff631c'}];},'World effects');
  }
  for(const radius of [10,20,40])for(const color of ['#ff631c','#4abaff'])add(`Fire ring / radius ${radius} / ${color}`,10,r=>{r.effects=[{type:'fireRing',owner:r.id,wx:r.wx,wz:r.wz,age:1,life:20,radius,color}];},'World effects');
  for(const kind of ['missile','hedgehog'])for(const count of [1,20])add(`${kind} / ${count} projectiles + trails`,0,r=>{
    r.projectiles=Array.from({length:count},(_,id)=>({id,owner:r.id,kind,vulcan:false,wx:(id%5-2)*2,wz:65+Math.floor(id/5)*3,heading:0,height:2,age:1,life:2,trail:Array.from({length:12},(_,i)=>({wx:(id%5-2)*2,wz:65+Math.floor(id/5)*3-i*.3,height:2}))}));
  },'Projectiles');
  for(const kind of ['bomb','stink'])add(`Falling ${kind}`,0,(r,t)=>{r.bombs=[{id:1,owner:r.id,kind,wx:0,wz:65,age:BOMB_FALL_TIME*(.1+.8*t),color:r.color}];},'World effects');
  for(const driver of [0,9])add(driver===9?'Fairy chaff cloud':'Chaff cloud',driver,(r,t)=>{r.chaffClouds=[{id:1,owner:r.id,wx:0,wz:65,originX:0,originZ:60,age:.1+t*5,life:8,color:'#a8cde1'}];},'Clouds and trails');
  add('Stink cloud',0,(r,t)=>{r.stinkClouds=[{id:1,owner:r.id,wx:0,wz:65,age:.1+t*3,life:5,hits:[]}];},'Clouds and trails');
  for(const [kind,level] of [['smoke',0],['spark',0],['spark',1],['spark',2]])add(`Drift ${kind} ${level} / 32 particles`,0,(r,t)=>{r.driftParticles=Array.from({length:32},(_,i)=>({owner:99,wx:(i%8-4)*.4,wz:60-Math.floor(i/8),height:.3,vx:0,vy:1,vz:0,age:.05+t*.8,life:1,kind,level}));},'Clouds and trails');
  add('Master-Yuda / drifting sparks and exhaust',10,(r,t)=>{r.speed=400;r.wasDrifting=true;r.drift=.9;r.heading=t*2;r.motionHeading=0;r.wz=60+t*5;},'Clouds and trails');
  add('Skid marks / 32 segments',0,r=>{r.skids=Array.from({length:32},(_,i)=>({owner:99,ax:-2+(i%2)*4,az:50+i*.3,bx:-2+(i%2)*4,bz:51+i*.3,time:r.elapsed-1}));},'Clouds and trails');
  for(const jumping of [false,true])add(`Locust swarm / 14 / ${jumping?'jumping':'running'}`,5,r=>{r.locusts=Array.from({length:14},(_,id)=>({id,owner:99,wx:(id%7-3)*2,wz:65+Math.floor(id/7)*3,heading:0,age:1,jump:jumping?.4:0}));},'World effects');
  for(const kind of ['missile','hedgehog','boost','health','hedgeproof','tehilim','bicycle'])add(`Pickup / ${kind}`,0,r=>{r.supplies=[{id:1,version:0,owner:99,kind,wx:0,wz:65,cooldown:0,age:5,heading:0,dropWx:0,dropWz:65,dropHeight:0}];},'Pickups');
  add('Gravity well / six pickup tethers',7,r=>{r.specialActive=3;r.supplies=Array.from({length:6},(_,id)=>({id,version:0,wx:(id-3)*5,wz:68,kind:'boost',cooldown:0}));});
  scenes.at(-1).baseline=r=>{r.supplies=Array.from({length:6},(_,id)=>({id,version:0,wx:(id-3)*5,wz:68,kind:'boost',cooldown:0}));};
  return scenes;
}

const summarize=values=>{
  if(!values.length)return {samples:0,mean:null,p95:null};
  const sorted=[...values].sort((a,b)=>a-b);
  return {samples:values.length,mean:values.reduce((a,b)=>a+b,0)/values.length,p95:sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.95))]};
};

export function createEffectProfiler(canvas,{samples=30,warmup=12}={}){
  const renderer=new Renderer(canvas);renderer.setQuality('balanced');
  const gl=renderer.gl,ext=gl.getExtension('EXT_disjoint_timer_query');
  const gpuSupported=Boolean(ext&&ext.getQueryEXT(ext.TIME_ELAPSED_EXT,ext.QUERY_COUNTER_BITS_EXT)>0);
  const counts={draws:0,triangles:0,points:0,uploadBytes:0};let counting=false;
  const drawArrays=gl.drawArrays.bind(gl),bufferData=gl.bufferData.bind(gl);
  gl.drawArrays=(mode,start,count)=>{if(counting){counts.draws++;if(mode===gl.TRIANGLES)counts.triangles+=count/3;if(mode===gl.POINTS)counts.points+=count;}return drawArrays(mode,start,count);};
  gl.bufferData=(target,data,usage)=>{if(counting)counts.uploadBytes+=typeof data==='number'?data:data.byteLength;return bufferData(target,data,usage);};
  let clock=0,epoch=0;
  async function measure(scene,enabled){
    const world=createBattle(scene.driver,0,()=>.5);
    Object.assign(world,{wx:0,wz:60,heading:0,motionHeading:0,cameraHeading:0,health:3,supplies:[],phase:'racing',soundEpoch:++epoch});
    for(const bot of world.bots)bot.inactive=true;
    scene.baseline?.(world);
    // Prime the live body before measuring ashes or any transition.
    renderer.draw(world,clock+=1/60);
    const cpu=[],gpu=[],metrics=[],pending=[];let disjoint=0;
    const poll=()=>{
      if(!gpuSupported)return;
      if(gl.getParameter(ext.GPU_DISJOINT_EXT)){disjoint++;gpu.length=0;for(const q of pending)ext.deleteQueryEXT(q);pending.length=0;return;}
      while(pending.length&&ext.getQueryObjectEXT(pending[0],ext.QUERY_RESULT_AVAILABLE_EXT)){
        const query=pending.shift();gpu.push(ext.getQueryObjectEXT(query,ext.QUERY_RESULT_EXT)/1e6);ext.deleteQueryEXT(query);
      }
    };
    for(let frame=0;frame<warmup+samples;frame++){
      await new Promise(requestAnimationFrame);
      poll();world.elapsed=clock+=1/60;
      if(enabled)scene.apply(world,frame/(warmup+samples-1));
      for(const key of Object.keys(counts))counts[key]=0;
      const collecting=frame>=warmup;
      const query=collecting&&gpuSupported&&pending.length<8?ext.createQueryEXT():null;
      if(query)ext.beginQueryEXT(ext.TIME_ELAPSED_EXT,query);
      counting=collecting;const start=performance.now();
      renderer.draw(world,clock);
      const elapsed=performance.now()-start;counting=false;
      if(query){ext.endQueryEXT(ext.TIME_ELAPSED_EXT);pending.push(query);}
      if(collecting){cpu.push(elapsed);metrics.push({...counts});}
    }
    for(let tries=0;pending.length&&tries<60;tries++){await new Promise(requestAnimationFrame);poll();}
    for(const q of pending)ext.deleteQueryEXT(q);
    return {cpuMs:summarize(cpu),gpuMs:summarize(gpu),gpuDisjoint:disjoint,...Object.fromEntries(Object.keys(counts).map(key=>[key,summarize(metrics.map(m=>m[key]))]))};
  }
  const scenes=effectScenes();
  return {
    metadata:{gpu:renderer.gpuName,softwareGPU:renderer.softwareGPU,gpuSupported,width:canvas.width,height:canvas.height,samples,warmup,userAgent:navigator.userAgent},
    scenes:scenes.map(({name,driver,group})=>({name,driver,group})),
    async run(index){
      const scene=scenes[index],baseline=await measure(scene,false),effect=await measure(scene,true);
      return {name:scene.name,driver:scene.driver,group:scene.group,baseline,effect,delta:Object.fromEntries(['cpuMs','gpuMs','draws','triangles','points','uploadBytes'].map(key=>[key,baseline[key].mean===null||effect[key].mean===null?null:effect[key].mean-baseline[key].mean]))};
    },
  };
}
