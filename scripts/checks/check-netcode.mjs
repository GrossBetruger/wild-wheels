import {arenaFixture} from '../helpers/arena-fixture.mjs';
import { pathToFileURL } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { Multiplayer } from '../../server/multiplayer.js';
import { LocalPrediction } from '../../client/prediction.js';
import { createBinaryEncoder, decodeBinarySnapshot } from '../../networking/binary-wire.js';
const encodeSnapshot=createBinaryEncoder();

export const profiles=[
  {name:'local',rtt:0,jitter:0},
  {name:'80ms',rtt:.08,jitter:0},
  {name:'160ms',rtt:.16,jitter:0},
  {name:'160ms-jitter',rtt:.16,jitter:.03},
  {name:'asymmetric-160ms',rtt:.16,up:.12,down:.04,jitter:.02},
  {name:'300ms-upload-stall',rtt:.16,jitter:0,stall:{direction:'up',from:2,to:2.3}},
  {name:'300ms-download-stall',rtt:.16,jitter:0,stall:{direction:'down',from:2,to:2.3}}
];
export const scenarios=[
  {name:'acceleration-braking',seconds:6,keys:t=>t<.5?[]:t<2.2?['arrowup']:t<2.6?['arrowdown']:t<3?[]:t<4.4?['arrowup']:['arrowdown']},
  {name:'turns-and-drift',seconds:8,keys:t=>t<.5?[]:t<1.5?['arrowup']:t<2.5?['arrowup','arrowright']:t<3.3?['arrowup','arrowright','shift']:t<4.8?['arrowup','arrowleft']:t<6?['arrowup','arrowright']:['arrowup','arrowleft','shift']}
];
const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*p))]??0;
const degrees=(a,b)=>Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)))*180/Math.PI;

export function simulate(profile,scenario){
  const app=new Multiplayer({fixtureWorld:arenaFixture});clearInterval(app.timer);
  const room={code:'07',arena:0,botCount:0,host:0,members:new Map()};
  app.makeWorld(room);app.rooms.set(room.code,room);
  if(scenario.guest)app.join(room,{name:'Host',driver:1});
  const member=app.join(room,{name:'Driver',driver:0});
  Object.assign(room.world,{phase:'racing',supplies:[]});
  if(scenario.guest)room.world.destroyed=999;
  Object.assign([room.world,...room.world.bots][member.id],{wx:-65,wz:70,heading:Math.PI/2,motionHeading:Math.PI/2,cameraHeading:Math.PI/2,speed:0});
  const prediction=new LocalPrediction(),up=[],down=[],frames=[];
  let now=0,seed=71,lastUp=0,lastDown=0,sequence=0,previousKeys='',serverClock=0;
  const random=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296);
  const deliverAt=direction=>{
    let due=now+Math.max(0,(profile[direction]??profile.rtt/2)+(random()-.5)*2*profile.jitter);
    if(profile.stall?.direction===direction&&due>=profile.stall.from&&due<profile.stall.to)due=profile.stall.to;
    if(direction==='up')return lastUp=Math.max(lastUp,due);
    return lastDown=Math.max(lastDown,due);
  };
  member.socket={readyState:1,send:(data,done)=>{down.push({at:deliverAt('down'),state:decodeBinarySnapshot(data)});done();}};
  const accept=state=>prediction.accept(state.world,now,prediction.commands?{sequence:state.movementSequence}:profile.rtt/2);
  accept(decodeBinarySnapshot(encodeSnapshot(app.snapshot(room,member))));
  try{
    for(let frame=0;now<scenario.seconds-1e-8;frame++){
      const dt=scenario.renderTimes?.[frame%scenario.renderTimes.length]??1/60;
      const keys=scenario.keys(now),held=new Set(keys),changed=keys.join(',')!==previousKeys;
      prediction.record?.(held,now);
      if(frame%2===0||changed)up.push({at:deliverAt('up'),input:{type:'input',sequence:sequence++,keys,actions:[],...(prediction.commands?{epoch:room.world.soundEpoch,moves:prediction.commands()}:{} )}});
      previousKeys=keys.join(',');
      while(up[0]?.at<=now+1e-8)app.controls(member,up.shift().input);
      member.lastSeen=member.inputAt=Date.now();
      serverClock+=dt;
      while(serverClock>=1/60-1e-8){app.step(1/60);serverClock-=1/60;}
      while(down[0]?.at<=now+1e-8)accept(down.shift().state);
      const view=prediction.sample(held,dt,now);
      frames.push({time:now,wx:view.wx,wz:view.wz,cameraHeading:view.cameraHeading,speed:view.speed});
      now+=dt;
    }
  }finally{app.close();}
  return frames;
}

export function compare(reference,frames){
  const positions=[],cameras=[],steps=[];let freezes=0,backward=0;
  for(let i=30;i<frames.length;i++){
    const a=reference[i],b=frames[i],prior=frames[i-1],priorRef=reference[i-1];
    positions.push(Math.hypot(a.wx-b.wx,a.wz-b.wz));cameras.push(degrees(a.cameraHeading,b.cameraHeading));
    const dx=b.wx-prior.wx,dz=b.wz-prior.wz,rx=a.wx-priorRef.wx,rz=a.wz-priorRef.wz;
    steps.push(Math.hypot(dx-rx,dz-rz));
    if(Math.hypot(rx,rz)>.05&&Math.hypot(dx,dz)<.005)freezes++;
    if(Math.hypot(rx,rz)>.05&&dx*rx+dz*rz<-.001)backward++;
  }
  const round=n=>+n.toFixed(4);
  const result={positionP95:round(percentile(positions,.95)),positionMax:round(Math.max(...positions)),cameraP95Degrees:round(percentile(cameras,.95)),cameraMaxDegrees:round(Math.max(...cameras)),stepErrorP95:round(percentile(steps,.95)),freezeFrames:freezes,backwardFrames:backward};
  result.pass=result.positionP95<=.15&&result.positionMax<=.5&&result.cameraP95Degrees<=1&&result.cameraMaxDegrees<=3&&result.freezeFrames===0&&result.backwardFrames===0;
  return result;
}

export function run(){
  return scenarios.flatMap(scenario=>{
    const reference=simulate(profiles[0],scenario);
    return profiles.slice(1).map(profile=>({scenario:scenario.name,profile:profile.name,...compare(reference,simulate(profile,scenario))}));
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const results=run();console.log(JSON.stringify(results,null,2));
  const output=process.argv.indexOf('--output');
  if(output>=0)await writeFile(process.argv[output+1],JSON.stringify({criteria:{positionP95:.15,positionMax:.5,cameraP95Degrees:1,cameraMaxDegrees:3,freezeFrames:0,backwardFrames:0},results},null,2)+'\n');
  if(results.some(result=>!result.pass))process.exitCode=1;
}
