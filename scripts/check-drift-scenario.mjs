export async function checkDrift(evaluate,room,id,sleep,{motorcycle=false,capture=null}={}){
  const actor=[room.world,...room.world.bots][id];
  Object.assign(actor,{wx:-65,wz:70,heading:Math.PI/2,motionHeading:Math.PI/2,cameraHeading:Math.PI/2,speed:250,drift:0,wasDrifting:false,driftTrail:null,driftEmit:0});
  room.world.skids=[];room.world.driftParticles=[];
  await sleep(400);
  if(motorcycle)await evaluate(`{
    const renderer=__game.renderer,draw=renderer.draw.bind(renderer);__game.bikerTrace=[];__game.restoreBikerDraw=()=>renderer.draw=draw;
    renderer.draw=(world,time)=>{const result=draw(world,time),sparks=renderer.yudaDrift.sparks.filter(s=>s.owner===world.id),bike=renderer.instances.find(p=>p.buffer===renderer.models.get('kart:10:'+world.color)?.buffer);
      __game.bikerTrace.push({roll:renderer.yudaDrift.roll(world.id),modelRoll:bike?.roll??0,count:sparks.length,drifting:world.wasDrifting,fresh:sparks.filter(s=>s.age===0).length,spread:sparks.length?Math.max(...sparks.map(s=>Math.hypot(s.x-world.wx,s.z-world.wz))):0,error:renderer.gl.getError()});return result;};
  }`);
  await evaluate(`{
    const game=__game,render=game.network.render.bind(game.network),start=performance.now();
    game.driftTrace=[];game.driftDone=false;let previous='';
    game.network.render=dt=>{
      const time=(performance.now()-start)/1000,keys=time<.3?['arrowup']:time<1.55?['arrowup','arrowright','shift']:[];
      const key=keys.join(',');if(key!==previous){game.keys.clear();for(const k of keys)game.keys.add(k);game.network.input();previous=key;}
      const view=render(dt),tx=Math.sin(view.heading),tz=Math.cos(view.heading);
      const wheels=[-1,1].map(side=>({wx:view.wx-tx*1.5+tz*side*1.6,wz:view.wz-tz*1.5-tx*side*1.6}));
      const own=effect=>effect.owner==null||effect.owner===view.id;
      const sparks=view.driftParticles.filter(p=>own(p)&&p.kind==='spark'),last=sparks.at(-1);
      const newest=view.skids.filter(own).at(-1);
      game.driftTrace.push({time,dt,drifting:view.wasDrifting,charge:view.drift,boost:view.boost,particles:view.driftParticles.filter(own).length,skids:view.skids.filter(own).length,levels:[...new Set(sparks.map(p=>p.level))],sparkAge:last?.age??null,wheelGap:last?Math.min(...wheels.map(w=>Math.hypot(last.wx-w.wx,last.wz-w.wz))):null,skidEnd:newest?{wx:newest.bx,wz:newest.bz}:null,particleOrigin:last?{wx:last.wx-last.vx*last.age,wz:last.wz-last.vz*last.age}:null});
      if(time>=3){game.driftDone=true;game.network.render=render;game.keys.clear();game.network.input();}
      return view;
    };
  }`);
  let captured=false;
  for(let i=0;i<100;i++){
    if(motorcycle&&capture&&!captured&&await evaluate('__game.bikerTrace.some(f=>Math.abs(f.roll)>1&&f.count>80)')){await capture();captured=true;}
    if(await evaluate('__game.driftDone'))break;await sleep(50);
  }
  const trace=await evaluate('__game.driftTrace');
  const start=trace.find(frame=>frame.drifting)?.time,release=trace.find(frame=>frame.time>start&&!frame.drifting)?.time;
  const delay=(time,from)=>time==null||from==null?null:+(Math.max(0,time-from)*1000).toFixed(2);
  const smokeMs=delay(trace.find(frame=>frame.particles>0)?.time,start),skidsMs=delay(trace.find(frame=>frame.skids>0)?.time,start);
  const chargeMs=[1,2].map(level=>delay(trace.find(frame=>frame.levels.includes(level))?.time,trace.find(frame=>frame.charge>=(level===1?.45:.85))?.time));
  let lateEmissions=0;
  for(let i=1;i<trace.length;i++){
    const a=trace[i-1],b=trace[i];if(b.time<=release||!a.skidEnd||!b.skidEnd)continue;
    if(Math.hypot(b.skidEnd.wx-a.skidEnd.wx,b.skidEnd.wz-a.skidEnd.wz)>.03)lateEmissions++;
  }
  const gaps=trace.filter(frame=>frame.drifting&&frame.sparkAge<.001&&frame.wheelGap!==null).map(frame=>frame.wheelGap);
  const freshWheelGapMax=gaps.length?+Math.max(...gaps).toFixed(4):null;
  const frameTimes=trace.map(frame=>frame.dt*1000).sort((a,b)=>a-b),frameP95Ms=+frameTimes[Math.floor(frameTimes.length*.95)].toFixed(2);
  const behaviorPass=[smokeMs,skidsMs,...chargeMs].every(value=>value!==null&&value<=20)&&lateEmissions===0&&freshWheelGapMax!==null&&freshWheelGapMax<=.05;
  const bikerTrace=motorcycle?await evaluate('__game.restoreBikerDraw();__game.bikerTrace'):[];
  const bikerPass=!motorcycle||bikerTrace.some(f=>Math.abs(f.roll)>1.1&&Math.abs(f.modelRoll)>1.1&&f.count>80&&f.spread>4)&&bikerTrace.every(f=>f.error===0)&&bikerTrace.some(f=>!f.drifting&&Math.abs(f.roll)>.3&&f.count>0)&&bikerTrace.at(-1).count===0&&Math.abs(bikerTrace.at(-1).roll)<.01;
  return {smokeMs,skidsMs,chargeMs,lateEmissions,freshWheelGapMax,frameP95Ms,behaviorPass:behaviorPass&&bikerPass,frameBudgetPass:frameP95Ms<=20,bikerPass,bikerTrace,pass:behaviorPass&&bikerPass&&frameP95Ms<=20,trace};
}
