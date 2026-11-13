export async function checkLocusts(evaluate,app,room,id,sleep,capture){
  const wait=async(predicate,message)=>{for(let i=0;i<160;i++){if(await predicate())return;await sleep(25);}throw new Error(message);};
  await evaluate('__game.network.chooseDriver(5)');await wait(()=>evaluate('__game.race.driver===5'),'Tammy selection failed');
  while(room.members.size<4)app.join(room,{name:`Locust rival ${room.members.size}`,driver:0});
  Object.assign(room.world,{phase:'racing',duration:3600,supplies:[],locusts:[],locustSequence:0});
  let opponent=0;for(const actor of [room.world,...room.world.bots].filter(a=>!a.inactive)){
    const own=actor.id===id,[wx,wz]=own?[-65,-30]:[[-65,-55],[65,55],[65,-55]][opponent++];
    Object.assign(actor,{wx,wz,health:6,shield:0,speed:0,heading:Math.PI,motionHeading:Math.PI,cameraHeading:Math.PI,specialCooldown:0});
  }
  app.broadcast(room);await wait(()=>evaluate('__game.race.phase==="racing"'),'Battle did not start');
  await evaluate('document.querySelector(".viewport").scrollIntoView({block:"center"});__game.network.action("special")');
  try{await wait(()=>evaluate('__game.race.locusts.length===6'),'Multiplayer swarm did not contain six locusts');}
  catch(error){throw new Error(error.message+' '+JSON.stringify({serverLocusts:room.world.locusts.length,actors:[room.world,...room.world.bots].map(a=>({id:a.id,driver:a.driver,inactive:a.inactive,afk:a.afk,cooldown:a.specialCooldown})),client:await evaluate('({count:__game.race.locusts.length,driver:__game.race.driver,cooldown:__game.race.specialCooldown,phase:__game.race.phase})')}));}
  await sleep(550);if(capture)await capture();
  await wait(()=>room.world.locusts.length===0,'Locusts did not reach their targets');
  const actors=[room.world,...room.world.bots].filter(a=>!a.inactive),owner=actors.find(a=>a.id===id),rivals=actors.filter(a=>a.id!==id);
  if(owner.health!==6||rivals.reduce((sum,a)=>sum+a.health,0)!==12)throw new Error('Swarm damage was not exactly six hearts with Tammy immune');
  if(await evaluate('__game.renderer.gl.getError()')!==0)throw new Error('Locust rendering produced a WebGL error');
  return {pass:true,locusts:6,clusters:2,totalDamage:6,tammyImmune:true,webgl:true};
}
