export async function checkPearococo(evaluate,app,room,id,observer,wait,sleep,capture){
  const own=[room.world,...room.world.bots].find(actor=>actor.id===id),peer=[room.world,...room.world.bots].find(actor=>actor.id===observer.id);
  await evaluate(`{
    const renderer=__game.renderer,pump=renderer.balletPump.bind(renderer),wave=renderer.royalWave.bind(renderer),tail=renderer.royalTail.bind(renderer);
    __game.pumpDraws=0;__game.royalWaves=[];__game.tailPoses=[];__game.tailLatest={};
    renderer.balletPump=(...args)=>{__game.pumpDraws++;return pump(...args);};
    renderer.royalWave=(p,height,angle,pitch,time,waving)=>{const result=wave(p,height,angle,pitch,time,waving);if(waving)__game.royalWaves.push({x:p.x,angle,pose:renderer.instances.at(-1).buffer});return result;};
    renderer.royalTail=(p,height,angle,pitch,time,fold)=>{const result=tail(p,height,angle,pitch,time,fold);__game.tailLatest[p.id]=fold;__game.tailPoses.push({id:p.id,fold});__game.tailPoses=__game.tailPoses.slice(-240);return result;};
  }`);
  Object.assign(own,{celebrate:1.6});Object.assign(peer,{driver:9,human:true,destroyed:0,shield:0,wx:own.wx+7,wz:own.wz+5,celebrate:1.6});app.broadcast(room);
  const royalWave=await wait(()=>evaluate(`new Set(__game.royalWaves.filter(p=>p.x===${own.wx}).map(p=>p.pose)).size>=3`));
  const remoteWave=await wait(()=>evaluate(`new Set(__game.royalWaves.filter(p=>p.x===${peer.wx}).map(p=>p.pose)).size>=3`));await capture('pearococo-royal-wave');
  peer.boost=0;app.broadcast(room);await evaluate('__game.characterAngle=0');
  const fairyDust=()=>evaluate("(()=>{const p=__game.renderer.smoke.sprites;for(let i=0;i<p.length;i+=7)if(p[i+4]>.9&&p[i+5]>.5&&p[i+5]<.8&&p[i+6]>.7)return true;return false;})()");
  const boost=await evaluate("__game.network.action('turbo')===true")&&await wait(fairyDust);
  const folded=await wait(()=>evaluate(`__game.tailLatest[${id}]>.99&&__game.tailLatest[${observer.id}]<.01&&__game.tailPoses.some(p=>p.id===${id}&&p.fold>.1&&p.fold<.9)`));await capture('pearococo-fairy-boost');
  const flip=await evaluate("__game.network.action('somersault')===true")&&await wait(async()=>await evaluate('__game.race.somersault>0')&&await fairyDust());await capture('pearococo-fairy-flip');
  own.boost=0;own.somersault=0;peer.boost=2.5;app.broadcast(room);
  const reopened=await wait(()=>evaluate(`__game.tailLatest[${id}]<.01`));
  const remoteFold=await wait(()=>evaluate(`__game.tailLatest[${observer.id}]>.99&&__game.tailPoses.some(p=>p.id===${observer.id}&&p.fold>.1&&p.fold<.9)`));await capture('pearococo-remote-fold');
  peer.boost=0;app.broadcast(room);const remoteReopened=await wait(()=>evaluate(`__game.tailLatest[${observer.id}]<.01`));peer.destroyed=999;
  Object.assign(own,{wx:-65,wz:0,heading:0,motionHeading:0,cameraHeading:0,speed:0,boost:0,somersault:0,celebrate:0,vulcan:8,item:'hedgehog',fireCooldown:0});app.broadcast(room);
  await wait(()=>evaluate('__game.race.vulcan>0&&__game.race.somersault===0&&__game.race.fireCooldown===0'));
  const ballet=await evaluate("__game.network.action('fire')===true")&&await wait(()=>evaluate("__game.pumpDraws>0&&document.querySelector('.vulcan-status strong').textContent.startsWith('BALLET VULCAN')"));
  const replicated=await wait(()=>app.snapshot(room,observer).world.projectiles.some(shot=>shot.owner===id&&shot.vulcan));await capture('pearococo-ballet-vulcan');
  const chaff=await evaluate("__game.network.action('chaff')===true")&&await wait(()=>evaluate(`__game.race.chaffClouds.some(cloud=>cloud.owner===${id})&&__game.renderer.instances.some(instance=>instance.buffer===__game.renderer.models.get('fairy-star')?.buffer)`));await capture('pearococo-fairy-chaff');
  own.vulcan=0;room.world.projectiles=[];await sleep(1500);
  Object.assign(peer,{driver:9,human:true,wx:-58,wz:0,heading:0,motionHeading:0,cameraHeading:0,speed:0,shield:0,destroyed:0,vulcan:8,item:'hedgehog',fireCooldown:0});app.broadcast(room);
  await wait(()=>evaluate(`__game.race.vulcan===0&&__game.race.bots.some(actor=>actor.id===${observer.id}&&actor.driver===9&&actor.destroyed===0)`));await evaluate('__game.pumpDraws=0');
  app.controls(observer,{sequence:0,keys:[],actions:[{type:'fire',id:0,afterMove:-1}],epoch:room.world.soundEpoch});
  const remoteBallet=await wait(()=>evaluate(`__game.pumpDraws>0&&__game.race.projectiles.some(shot=>shot.owner===${observer.id}&&shot.vulcan)`));await capture('pearococo-remote-ballet');
  return {royalWave,remoteWave,boost,folded,reopened,remoteFold,remoteReopened,flip,ballet,replicated,chaff,remoteBallet,pass:royalWave&&remoteWave&&boost&&folded&&reopened&&remoteFold&&remoteReopened&&flip&&ballet&&replicated&&chaff&&remoteBallet};
}
