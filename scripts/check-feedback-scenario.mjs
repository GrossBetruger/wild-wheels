export function projectileMotion(trace){
  const errors=[];let backwardFrames=0;
  for(let i=1;i<trace.length;i++)for(const shot of trace[i].shots){
    const previous=trace[i-1].shots.find(old=>old.kind===shot.kind);if(!previous)continue;
    // Projectiles use real time, even when gameplay dt is capped at 50 ms.
    const travel=shot.wx-previous.wx,expected=(shot.kind==='missile'?70:90)*(trace[i].time-trace[i-1].time);
    if(travel<-.01)backwardFrames++;
    errors.push(Math.abs(travel-expected));
  }
  errors.sort((a,b)=>a-b);
  return {projectileBackwardFrames:backwardFrames,projectileStepErrorP95:+(errors[Math.floor(errors.length*.95)]??0).toFixed(4)};
}
export async function checkFeedback(evaluate,room,playerId,sleep){
  const actor=[room.world,...room.world.bots][playerId];
  Object.assign(actor,{ammo:5,missiles:0,item:'hedgehog',fireCooldown:0});
  room.world.supplies=[{id:0,version:0,wx:-55,wz:70,kind:'missile',cooldown:0}];
  for(let i=0;i<100;i++){if(await evaluate('__game.network.state.world.missiles===0&&__game.network.state.world.supplies.length===1'))break;await sleep(25);}
  await evaluate(`{
    const game=__game,render=game.network.render.bind(game.network),start=performance.now();
    game.feedbackTrace=[];game.feedbackDone=false;game.feedbackSounds=[];
    const play=game.audio.event.bind(game.audio);game.audio.event=type=>{game.feedbackSounds.push({type,time:(performance.now()-start)/1000});play(type);};
    let fired=false,missile=false,moving=false,contact=null;
    game.feedbackRequests=[];
    game.network.render=dt=>{
      const time=(performance.now()-start)/1000;
      if(!fired&&time>=.2){game.feedbackRequests.push({kind:'hedgehog',time});game.network.action('fire');fired=true;}
      if(!moving&&time>=.6){game.keys.add('arrowup');game.network.input();moving=true;}
      if(contact!==null&&!missile&&time>=contact+.3){game.feedbackRequests.push({kind:'missile',time});game.network.action('fire');missile=true;}
      const view=render(dt);
      if(contact===null&&Math.hypot(view.wx+55,view.wz-70)<4){contact=time;game.keys.clear();game.network.input();}
      game.feedbackTrace.push({time,dt,contact,missiles:view.missiles,hidden:view.supplies[0].cooldown>0,shots:view.projectiles.filter(p=>p.owner===view.id).map(p=>({id:p.id,actionId:p.actionId,kind:p.kind,wx:p.wx,wz:p.wz}))});
      if(time>=3){game.feedbackDone=true;game.network.render=render;game.keys.clear();game.network.input();}
      return view;
    };
  }`);
  for(let i=0;i<100;i++){if(await evaluate('__game.feedbackDone'))break;await sleep(50);}
  const {trace,requests,sounds}=await evaluate('({trace:__game.feedbackTrace,requests:__game.feedbackRequests,sounds:__game.feedbackSounds})');
  const contact=trace.find(frame=>frame.contact!==null)?.contact;
  const delay=(time,start)=>time==null||start==null?null:+(Math.max(0,time-start)*1000).toFixed(2);
  const shotDelays=requests.map(request=>({kind:request.kind,delayMs:delay(trace.find(frame=>frame.time>=request.time&&frame.shots.some(shot=>shot.kind===request.kind))?.time,request.time)}));
  const pickupHiddenMs=delay(trace.find(frame=>frame.hidden)?.time,contact),pickupInventoryMs=delay(trace.find(frame=>frame.missiles===1)?.time,contact),pickupSoundMs=delay(sounds.find(sound=>sound.type==='pickup')?.time,contact);
  const duplicateShots=trace.some(frame=>['hedgehog','missile'].some(kind=>frame.shots.filter(shot=>shot.kind===kind).length>1));
  const {projectileBackwardFrames:backwardFrames,projectileStepErrorP95}=projectileMotion(trace);
  return {shotDelays,pickupHiddenMs,pickupInventoryMs,pickupSoundMs,duplicateShots,projectileBackwardFrames:backwardFrames,projectileStepErrorP95,pickupSounds:sounds.filter(sound=>sound.type==='pickup').length,pass:shotDelays.length===2&&shotDelays.every(shot=>shot.delayMs!==null&&shot.delayMs<=20)&&[pickupHiddenMs,pickupInventoryMs,pickupSoundMs].every(value=>value!==null&&value<=20)&&!duplicateShots&&backwardFrames===0&&projectileStepErrorP95<=.15&&sounds.filter(sound=>sound.type==='pickup').length===1,trace,requests,sounds};
}
