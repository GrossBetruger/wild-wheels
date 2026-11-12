export async function checkSpecials(evaluate,app,room,id,sleep,capture){
  const wait=async predicate=>{for(let i=0;i<160;i++){if(await predicate())return true;await sleep(25);}return false;};
  if(room.members.size<2)app.join(room,{name:'Ability opponent',driver:1});
  const peer=[...room.members.values()].find(m=>m.id!==id),member=room.members.get([...room.members.keys()].find(k=>room.members.get(k).id===id));
  member.driver=8;peer.driver=10;app.syncRoom(room);
  const actors=[room.world,...room.world.bots],own=actors.find(a=>a.id===id),other=actors.find(a=>a.id===peer.id);
  Object.assign(room.world,{phase:'racing',duration:3600,supplies:[],projectiles:[]});for(const a of actors)Object.assign(a,{human:true,destroyed:999});
  Object.assign(own,{driver:8,destroyed:0,wx:65,wz:40,heading:0,motionHeading:0,cameraHeading:0,speed:0,specialCooldown:0});
  Object.assign(other,{driver:10,destroyed:0,wx:-65,wz:0,heading:0,motionHeading:0,cameraHeading:0,speed:100});app.broadcast(room);
  const available=await wait(()=>evaluate("__game.race.driver===8&&!document.querySelector('#special-ability').classList.contains('hidden')&&!document.querySelector('#special-ability').disabled"));
  const activate=await evaluate("__game.network.action('special')===true")&&await wait(()=>evaluate('__game.race.timeStop>1.5'));
  app.controls(peer,{sequence:0,keys:['arrowup'],actions:[],epoch:room.world.soundEpoch});
  const stoppedAt=app.snapshot(room,peer).world.wz;
  await evaluate("__game.keys.add('arrowup')");const start=await evaluate('__game.race.wz');await sleep(600);
  const moves=await evaluate(`__game.race.wz>${start}+.1`),frozen=app.snapshot(room,peer).world.wz===stoppedAt;
  const notice=await evaluate("document.querySelector('.special-status').textContent.includes('RELATIVITY')");await capture('relativity');
  await evaluate('__game.keys.clear()');
  const resumed=await wait(()=>evaluate('__game.race.timeStop===0'));app.controls(peer,{sequence:1,keys:['arrowup'],actions:[],epoch:room.world.soundEpoch});
  const movesAgain=await wait(()=>app.snapshot(room,peer).world.wz>stoppedAt+.05);
  const cooldown=await evaluate("__game.race.specialCooldown>15&&__game.network.action('special')!==true");
  Object.assign(room.world,{timeStop:2.5,timeOwner:peer.id});app.broadcast(room);
  const frozenClient=await wait(()=>evaluate("__game.race.timeStop>1&&document.querySelector('.special-status').textContent.includes('TIME FROZEN')"));
  const heldAt=await evaluate('__game.race.wz');await evaluate("__game.keys.add('arrowup')");await sleep(400);
  const clientStaysStill=await evaluate(`Math.abs(__game.race.wz-${heldAt})<.01&&__game.network.action('fire')!==true`);await capture('frozen-opponent');
  await evaluate('__game.keys.clear()');Object.assign(room.world,{timeStop:0,timeOwner:null});app.broadcast(room);
  // Keep the room's canonical actors; reset just the scenario, not the connection.
  Object.assign(own,{driver:11,wx:65,wz:40,speed:0,tehilim:0});other.speed=0;app.broadcast(room);
  const holy=await wait(()=>evaluate("__game.race.driver===11&&document.querySelector('.special-status').textContent==='HOLY AURA'"));await capture('holy-aura');
  Object.assign(own,{driver:12,health:5,healTimer:3.9});app.broadcast(room);
  const heal=await wait(()=>evaluate('__game.race.driver===12&&__game.race.health===6'));
  Object.assign(own,{driver:10,wx:65,wz:40,heading:0,boost:1});Object.assign(other,{wx:65,wz:35,boost:0,dizzy:0});app.broadcast(room);
  const smoke=await wait(()=>app.snapshot(room,peer).world.dizzy>7);
  member.driver=10;room.specialAbilities=false;app.syncRoom(room);app.broadcast(room);
  const disabled=await wait(()=>evaluate("__game.race.specialAbilities===false&&__game.network.abilities.textContent.includes('OFF')&&document.querySelector('.special-status').classList.contains('hidden')"));
  return {available,activate,moves,frozen,notice,resumed,movesAgain,cooldown,frozenClient,clientStaysStill,holy,heal,smoke,disabled,pass:available&&activate&&moves&&frozen&&notice&&resumed&&movesAgain&&cooldown&&frozenClient&&clientStaysStill&&holy&&heal&&smoke&&disabled};
}
