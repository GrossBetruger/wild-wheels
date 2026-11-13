export async function checkYuda(evaluate,app,room,id,observer,wait,sleep,capture){
  const own=[room.world,...room.world.bots].find(actor=>actor.id===id),peer=[room.world,...room.world.bots].find(actor=>actor.id===observer.id);
  await evaluate(`{
    const renderer=__game.renderer,bike=renderer.yudaMotorcycle.bind(renderer),laser=renderer.laserBolt.bind(renderer),burner=renderer.afterburner.bind(renderer);
    __game.yudaDressing=new Set();__game.yudaFlips=[];__game.yudaSalutes=new Set();__game.yudaBoosts=[];__game.laserDraws=0;
    renderer.yudaMotorcycle=(m,p,color,yaw,spin,boost,time,celebrate,jump,gesture)=>{const result=bike(m,p,color,yaw,spin,boost,time,celebrate,jump,gesture);if(renderer.yudaJackets.riders.get(p.id)?.dressStart!==null&&renderer.yudaJackets.riders.has(p.id))__game.yudaDressing.add(p.id);if(jump)__game.yudaFlips.push({id:p.id,height:jump.height,pitch:jump.pitch,roll:jump.roll,yaw:jump.yaw});if(celebrate>0)__game.yudaSalutes.add(renderer.instances.at(-1).buffer);return result;};
    renderer.afterburner=(p,angle,time,jump,driver)=>{const result=burner(p,angle,time,jump,driver);if(driver!==10)return result;const smoke=renderer.yudaExhaust.clouds.some(c=>c.owner===p.id);__game.yudaBoosts.push({id:p.id,smoke});return result;};
    renderer.laserBolt=(...args)=>{__game.laserDraws++;return laser(...args);};
  }`);
  Object.assign(own,{celebrate:1.6});app.broadcast(room);
  const salute=await wait(()=>evaluate(`__game.renderer.yudaStunts.riders.get(${id})?.lounge>.9`));await evaluate('__game.characterAngle=Math.PI/2');await capture('yuda-la-vie');
  await evaluate('__game.characterAngle=Math.PI/2');await capture('yuda-motorcycle-side');
  await evaluate('__game.characterAngle=0');
  const boost=await evaluate("__game.network.action('turbo')===true")&&await wait(()=>evaluate(`__game.yudaBoosts.some(p=>p.id===${id}&&p.smoke)`));await capture('yuda-afterburners');
  const jacketFlight=await wait(()=>evaluate(`__game.renderer.yudaJackets.riders.get(${id})?.bare&&__game.renderer.yudaJackets.riders.get(${id})?.flight&&__game.renderer.instances.some(part=>part.detached)`));await capture('yuda-jacket-flight');
  const wheelie=await wait(()=>evaluate(`__game.renderer.yudaStunts.riders.get(${id})?.wheelie>.9`));await evaluate('__game.characterAngle=Math.PI/2');await capture('yuda-wheelie');await evaluate('__game.characterAngle=0');
  const flip=await evaluate("__game.network.action('somersault')===true")&&await wait(()=>evaluate(`__game.yudaFlips.some(p=>p.id===${id}&&p.height>1&&p.height<=2.8&&p.roll>1&&p.roll<5&&Math.abs(p.yaw)>.2)`));await capture('yuda-motorcycle-flip');
  own.boost=0;own.somersault=0;
  Object.assign(peer,{driver:10,human:true,destroyed:0,shield:0,wx:own.wx+7,wz:own.wz+5,boost:1.5,somersault:.55});app.broadcast(room);
  const remoteFlip=await wait(()=>evaluate(`__game.yudaFlips.some(p=>p.id===${observer.id}&&p.height>1&&p.height<=2.8&&p.roll>1&&p.roll<5)&&__game.yudaBoosts.some(p=>p.id===${observer.id}&&p.smoke)`));await capture('yuda-remote-flip');
  const remoteJacket=await wait(()=>evaluate(`__game.renderer.yudaJackets.riders.get(${observer.id})?.bare===true`));
  const remoteWheelie=await wait(()=>evaluate(`__game.renderer.yudaStunts.riders.get(${observer.id})?.wheelie>.9`));await capture('yuda-remote-wheelie');
  peer.boost=0;peer.celebrate=1.6;app.broadcast(room);
  const remoteLounge=await wait(()=>evaluate(`__game.renderer.yudaStunts.riders.get(${observer.id})?.lounge>.9`));await capture('yuda-remote-la-vie');
  const smokeLingers=await wait(()=>evaluate(`__game.race.boost===0&&__game.renderer.yudaExhaust.clouds.some(c=>c.owner===${id}&&__game.renderer.yudaExhaust.time-c.born>1)&&__game.renderer.smoke.sprites.some((v,i)=>i%7===3&&v>4)`));await capture('yuda-lingering-smoke');
  peer.destroyed=999;
  Object.assign(own,{wx:-65,wz:0,heading:0,motionHeading:0,cameraHeading:0,speed:0,boost:0,somersault:0,celebrate:0,vulcan:8,item:'hedgehog',fireCooldown:0});app.broadcast(room);
  await wait(()=>evaluate('__game.race.vulcan>0&&__game.race.somersault===0&&__game.race.fireCooldown===0'));
  const laser=await evaluate("__game.network.action('fire')===true")&&await wait(()=>evaluate("__game.laserDraws>0&&document.querySelector('.vulcan-status strong').textContent.startsWith('LASER VULCAN')"));
  const replicated=await wait(()=>app.snapshot(room,observer).world.projectiles.some(shot=>shot.owner===id&&shot.vulcan));await capture('yuda-laser-vulcan');
  const vulcanBare=await wait(()=>evaluate(`__game.renderer.yudaJackets.riders.get(${id})?.bare===true`));
  own.vulcan=0;room.world.projectiles=[];await sleep(1500);
  const redressed=await wait(()=>evaluate(`__game.yudaDressing.has(${id})&&__game.renderer.yudaJackets.riders.get(${id})?.bare===false`));await capture('yuda-jacket-restored');
  Object.assign(peer,{driver:10,human:true,wx:-58,wz:0,heading:0,motionHeading:0,cameraHeading:0,speed:0,boost:0,somersault:0,shield:0,destroyed:0,vulcan:8,item:'hedgehog',fireCooldown:0});app.broadcast(room);
  await wait(()=>evaluate(`__game.race.vulcan===0&&__game.race.bots.some(actor=>actor.id===${observer.id}&&actor.driver===10&&actor.destroyed===0)`));await evaluate('__game.laserDraws=0');
  app.controls(observer,{sequence:0,keys:[],actions:[{type:'fire',id:0,afterMove:-1}],epoch:room.world.soundEpoch});
  const remoteLaser=await wait(()=>evaluate(`__game.laserDraws>0&&__game.race.projectiles.some(shot=>shot.owner===${observer.id}&&shot.vulcan)`));await capture('yuda-remote-laser');
  return {smokeLingers,wheelie,remoteWheelie,remoteLounge,jacketFlight,remoteJacket,vulcanBare,redressed,salute,boost,flip,remoteFlip,laser,replicated,remoteLaser,pass:smokeLingers&&wheelie&&remoteWheelie&&remoteLounge&&jacketFlight&&remoteJacket&&vulcanBare&&redressed&&salute&&boost&&flip&&remoteFlip&&laser&&replicated&&remoteLaser};
}
