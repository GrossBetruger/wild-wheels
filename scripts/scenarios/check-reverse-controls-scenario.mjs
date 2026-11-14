export async function checkReverseControls(evaluate,app,room,id,sleep,capture){
  const wait=async(predicate,message)=>{for(let i=0;i<240;i++){if(await predicate())return;await sleep(25);}throw new Error(message);};
  await evaluate('__game.network.chooseDriver(5)');await wait(()=>evaluate('__game.race.driver===5'),'Tammy selection failed');
  while(room.members.size<3)app.join(room,{name:`Reverse rival ${room.members.size}`,driver:0});
  Object.assign(room.world,{phase:'racing',duration:3600,supplies:[],locusts:[]});
  for(const actor of [room.world,...room.world.bots].filter(a=>!a.inactive))Object.assign(actor,{wx:actor.id===id?65:-65,wz:0,health:6,speed:0,heading:0,motionHeading:0,cameraHeading:0,specialCooldown:0,reverseControls:0});
  app.broadcast(room);await wait(()=>evaluate('__game.race.phase==="racing"'),'Battle did not start');
  await evaluate('__game.network.action("special")');
  await wait(()=>evaluate('__game.race.specialCooldown>19&&__game.race.bots.filter(a=>!a.inactive).every(a=>a.reverseControls>4)'),'Reversed controls did not reach opponents');
  if(!await evaluate('__game.race.reverseControls===0&&__game.race.locusts.length===0'))throw new Error('Caster reversed or locusts spawned');
  await wait(()=>evaluate('document.querySelector(".special-status").textContent.includes("REVERSE PSYCHOLOGY")'),'Reverse Psychology announcement missing');
  // Have a different Tammy cast on the browser player; exercise raw keyboard
  // controls through local prediction and the authoritative command stream.
  const other=[room.world,...room.world.bots].find(a=>!a.inactive&&a.id!==id);
  const peer=[...room.members.values()].find(m=>m.id===other.id);peer.driver=5;app.syncRoom(room);
  other.driver=5;other.specialCooldown=0;peer.actions.push({type:'special'});
  app.broadcast(room);
  await wait(()=>evaluate('__game.race.reverseControls>4&&document.querySelector("#dizzy-notice").textContent.includes("CONTROLS REVERSED")'),'Affected player warning missing');
  const start=await evaluate('({z:__game.race.wz,heading:__game.race.heading})');
  await evaluate('__game.keys.add("arrowup");__game.keys.add("arrowright")');await sleep(180);await evaluate('__game.keys.clear()');
  if(!await evaluate(`__game.race.speed<0&&__game.race.wz<${start.z}&&__game.race.heading>${start.heading}`))throw new Error('Browser movement was not reversed on both axes');
  if(capture)await capture();
  await wait(()=>evaluate('__game.race.reverseControls===0'),'Controls did not recover after five seconds');
  if(await evaluate('__game.renderer.gl.getError()')!==0)throw new Error('Reverse Psychology produced a WebGL error');
  return {pass:true,noLocusts:true,casterUnaffected:true,opponentsReversed:true,browserMovementReversed:true,controlsRecovered:true,webgl:true};
}
