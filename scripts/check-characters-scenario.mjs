import {checkRyeah} from './check-r-yeah-scenario.mjs';
import {checkYuda} from './check-yuda-scenario.mjs';
import {checkPearococo} from './check-pearococo-scenario.mjs';
import {checkPreview} from './check-preview-scenario.mjs';
export async function checkCharacters(evaluate,app,room,id,sleep,capture){
  const wait=async predicate=>{for(let i=0;i<120;i++){if(await predicate())return true;await sleep(25);}return false;};
  const menu=await evaluate("[...document.querySelectorAll('#drivers button')].map(button=>button.getAttribute('aria-label'))");
  const menuPass=['Ellie the Elephant','Tammy the Cricket','Elon Musk','Houston the RTPL','Avita-Jas','Pearococo','Master-Yuda','R-yeah','Catheterpillar','Fourmidable','KnowItOwl'].every(name=>menu.includes(name))&&menu.length===15;
  if(room.members.size<2)app.join(room,{name:'Observer',driver:1});
  const observer=[...room.members.values()].find(member=>member.id!==id),characters=[];
  const preview=await checkPreview(evaluate,app,room,id,sleep,capture);
  await evaluate(`{
    __game.characterAngle=Math.PI;
    const renderer=__game.renderer,kart=renderer.kart.bind(renderer);
    const cricket=renderer.cricket.bind(renderer);__game.cricketDraws=0;
    renderer.cricket=(...args)=>{__game.cricketDraws++;return cricket(...args);};
    const dollars=renderer.dollarBundle.bind(renderer);__game.dollarDraws=0;
    renderer.dollarBundle=(...args)=>{__game.dollarDraws++;return dollars(...args);};
    const electron=renderer.electron.bind(renderer);__game.electronDraws=0;
    renderer.electron=(...args)=>{__game.electronDraws++;return electron(...args);};
    const propeller=renderer.planePropeller.bind(renderer);__game.propellerFrames=new Set();
    renderer.planePropeller=(...args)=>{const result=propeller(...args);__game.propellerFrames.add(renderer.instances.at(-1).buffer);return result;};
    const worm=renderer.wormPilot.bind(renderer);__game.wormPoses=new Set();
    renderer.wormPilot=(...args)=>{const result=worm(...args);__game.wormPoses.add(renderer.instances.at(-1).buffer);return result;};
    const engines=renderer.starshipEngines.bind(renderer);__game.starshipJets=[];
    renderer.starshipEngines=(p,angle,clock,jump,boost)=>{
      const start=renderer.glow.sprites.length,smoke=renderer.smoke.sprites.length,result=engines(p,angle,clock,jump,boost),points=renderer.glow.sprites;let blue=false;
      for(let i=start;i<points.length;i+=7)if(points[i+6]>.4&&points[i+6]>points[i+4]*2)blue=true;
      __game.starshipJets.push({id:p.id,boost,flip:Boolean(jump),blue,vapor:renderer.smoke.sprites.length>smoke});__game.starshipJets=__game.starshipJets.slice(-120);return result;
    };
    const aura=renderer.hedgeguard.bind(renderer);__game.auraDraws=[];
    renderer.hedgeguard=(mesh,pose,actor,...args)=>{const start=renderer.instances.length,result=aura(mesh,pose,actor,...args);__game.auraDraws.push({id:actor.id,driver:actor.driver,icons:renderer.instances.length-start});__game.auraDraws=__game.auraDraws.slice(-80);return result;};
    const helmet=renderer.houstonHelmet.bind(renderer);__game.helmetTrace=[];
    renderer.houstonHelmet=(pose,actor,...args)=>{
      const start=renderer.instances.length,result=helmet(pose,actor,...args);if(actor.id!==__game.helmetTarget)return result;
      const flying=renderer.models.get('houston:helmet'),part=renderer.instances.slice(start).find(instance=>instance.buffer===flying?.buffer),worn=renderer.models.get('kart:7:'+actor.color),bare=renderer.models.get('kart:7:'+actor.color+':bare');
      const body=model=>renderer.instances.some(instance=>instance.buffer===model?.buffer&&Math.abs(instance.x-pose.x)<.01&&Math.abs(instance.z-pose.z)<.01);
      __game.helmetTrace.push({vulcan:actor.vulcan,height:part?.y??null,angle:part?.angle??null,worn:body(worn),bare:body(bare)});__game.helmetTrace=__game.helmetTrace.slice(-180);return result;
    };
    renderer.kart=(mesh,pose,color,driver,...args)=>{if(!renderer.buildingModel&&driver===__game.race.driver)pose={...pose,tx:Math.sin(__game.characterAngle),tz:Math.cos(__game.characterAngle)};return kart(mesh,pose,color,driver,...args);};
    const draw=renderer.draw.bind(renderer);
    renderer.draw=(...args)=>{const result=draw(...args);if(__game.characterCapture===__game.race.driver){const gl=renderer.gl,w=gl.drawingBufferWidth,h=gl.drawingBufferHeight,width=50,height=Math.floor(h*.3),pixels=new Uint8Array(width*height*4);gl.readPixels(Math.floor(w/2)-25,Math.floor(h*.16),width,height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);const colors=new Set();let white=0;for(let i=0;i<pixels.length;i+=4){colors.add(pixels[i]*65536+pixels[i+1]*256+pixels[i+2]);const low=Math.min(pixels[i],pixels[i+1],pixels[i+2]),high=Math.max(pixels[i],pixels[i+1],pixels[i+2]);if(low>150&&high-low<20)white++;}__game.characterPixels={driver:__game.race.driver,colors:colors.size,white,glError:gl.getError()};__game.characterCapture=null;}return result;};
    __game.keys.clear();
  }`);
  for(const [driver,name,cuteness,recoverySeconds,ammoSeconds]of[[4,'Ellie the Elephant',5,4,1],[5,'Tammy the Cricket',5,4,1],[7,'Houston the RTPL',5,4,1],[8,'Avita-Jas',5,4,1],[9,'Pearococo',5,4,1],[10,'Master-Yuda',3,8,1.5],[11,'R-yeah',5,4,1],[12,'Catheterpillar',5,4,1],[13,'Fourmidable',5,4,1],[14,'KnowItOwl',4,6,1.25],[6,'Elon Musk',1,12,2]]){
    await evaluate('__game.characterAngle=Math.PI');
    app.makeWorld(room);app.broadcast(room);
    await wait(()=>evaluate("__game.network.state.world.phase==='ready'"));
    await evaluate(`__game.network.chooseDriver(${driver})`);
    const selected=await wait(()=>evaluate(`__game.race.driver===${driver}&&document.getElementById('driver-name').textContent===${JSON.stringify(name)}`));
    Object.assign(room.world,{phase:'racing',duration:3600,supplies:[]});
    for(const member of room.members.values())member.lastSeen=Date.now();
    for(const actor of [room.world,...room.world.bots])Object.assign(actor,actor.id===id?{wx:-65,wz:70,heading:0,motionHeading:0,cameraHeading:0,speed:0,shield:0,health:2,healTimer:recoverySeconds-.75,ammo:0,reload:ammoSeconds-.75,boost:0,somersault:0,somersaultCooldown:0}:{destroyed:999});
    app.broadcast(room);
    await wait(()=>evaluate(`__game.race.phase==='racing'&&__game.race.driver===${driver}`));await sleep(100);
    const previewFrames=await evaluate('__game.previewDraws');await sleep(100);const previewStopped=await evaluate(`__game.previewDraws===${previewFrames}&&__game.preview.element.classList.contains('hidden')`);
    await evaluate(`{__game.characterPixels=null;__game.characterCapture=${driver};}`);
    await wait(()=>evaluate(`__game.characterPixels?.driver===${driver}`));
    const pixels=await evaluate('__game.characterPixels');
    const remote=app.snapshot(room,observer).world.bots.find(actor=>actor.id===id);
    await capture(name.split(' ')[0].toLowerCase());
    const paint=driver!==6||remote?.color==='#e8edf2'&&pixels.white>30&&await evaluate("__game.race.color==='#e8edf2'");
    const cutenessStat=await evaluate(`document.querySelectorAll('#cuteness-stat i.on').length===${cuteness}&&document.getElementById('cuteness-stat').parentElement.title.includes('every ${recoverySeconds} seconds')`);
    const intelligenceStat=await evaluate(`document.querySelectorAll('#intelligence-stat i.on').length===${({4:4,5:3,7:5,8:5,9:4,10:5,11:4,12:5,13:5,14:5,6:4})[driver]}&&document.getElementById('intelligence-stat').parentElement.title.includes('Carrying limits')`);
    const fuelStat=await evaluate(`document.querySelectorAll('#fuel-stat i.on').length===${driver===7?5:(driver===5||driver===13)?2:3}&&document.getElementById('fuel-stat').parentElement.title.includes('${driver===7?5.2:(driver===5||driver===13)?2.8:3.6} seconds')`);
    const recovery=await wait(()=>evaluate("__game.race.health===3&&document.getElementById('lap').textContent==='♥♥♥'"))&&app.snapshot(room,observer).world.bots.find(actor=>actor.id===id)?.health===3;
    const ammoRecovery=await wait(()=>evaluate("__game.race.ammo>=1&&Number(document.getElementById('hedgehog-count').textContent)>=1"))&&app.snapshot(room,observer).world.bots.find(actor=>actor.id===id)?.ammo>=1;
    const own=[room.world,...room.world.bots].find(actor=>actor.id===id),peer=[room.world,...room.world.bots].find(actor=>actor.id===observer.id);
    room.world.supplies=[{id:8,kind:'hedgeproof',wx:own.wx,wz:own.wz,cooldown:0,version:0}];
    Object.assign(peer,{driver,human:true,inactive:false,destroyed:0,shield:0,wx:own.wx+7,wz:own.wz+5,hedgeShield:25});app.broadcast(room);
    await evaluate('__game.auraDraws=[]');
    const aura=await wait(async()=>await evaluate(`__game.race.hedgeShield>0&&document.querySelector('.hedgeguard-status').textContent.includes('MISSILES STILL HURT')&&__game.auraDraws.some(draw=>draw.id===${id}&&draw.driver===${driver}&&draw.icons===6)&&__game.auraDraws.some(draw=>draw.id===${observer.id}&&draw.driver===${driver}&&draw.icons===6)`)&&app.snapshot(room,observer).world.bots.find(actor=>actor.id===id)?.hedgeShield>0);
    await capture(`${(driver===5||driver===13)?'cricket':driver===6?'money':driver===9?'fairy':driver===10?'biker':'shield'}-hedgeguard`);
    const auraModel=await evaluate((driver===5||driver===13)?"[...__game.renderer.models.keys()].some(key=>key.startsWith('cricket:'))":driver===6?"__game.renderer.models.has('dollar-bundle')":driver===9?"__game.renderer.models.has('fairy-star')":driver===10?"__game.renderer.models.has('yuda:winged-badge')":"__game.renderer.models.has('hedgeguard:shield')");
    own.hedgeShield=.05;peer.hedgeShield=.05;room.world.supplies=[];app.broadcast(room);
    const auraExpired=await wait(()=>evaluate("__game.race.hedgeShield===0&&document.querySelector('.hedgeguard-status').classList.contains('hidden')"));
    peer.destroyed=999;app.broadcast(room);
    let boostHaze=true,flipHaze=true,cricketVulcan=true,remoteCrickets=true,helmetAnimation=true,remoteHelmet=true,helmetRestored=true,dollarVulcan=true,remoteDollars=true,propellerAnimation=true,wormFlex=true,electronVulcan=true,remoteElectrons=true,starshipBoost=true,starshipFlip=true,remoteStarship=true;
    if(driver===8){
      wormFlex=await wait(()=>evaluate('__game.wormPoses.size>=3'));
      await evaluate('__game.characterAngle=Math.PI');await capture('avita-pilot-front');
      await evaluate('__game.characterAngle=Math.PI/2');await capture('avita-pilot-side');
      await evaluate('__game.characterAngle=0');
      propellerAnimation=await wait(()=>evaluate('__game.propellerFrames.size>=3'));await capture('avita-cessna');
      const vapor=()=>evaluate("(()=>{const points=__game.renderer.smoke.sprites;for(let i=0;i<points.length;i+=7)if(points[i+4]>.8&&points[i+5]>.8&&points[i+6]>.8)return true;return false;})()");
      boostHaze=await evaluate("__game.network.action('turbo')===true")&&await wait(vapor);await capture('avita-propwash');
      flipHaze=await evaluate("__game.network.action('somersault')===true")&&await wait(async()=>await evaluate('__game.race.somersault>0')&&await vapor());await capture('avita-loop');
      Object.assign(own,{wx:-65,wz:0,heading:0,motionHeading:0,cameraHeading:0,speed:0,boost:0,somersault:0,vulcan:8,item:'hedgehog',fireCooldown:0});app.broadcast(room);
      await wait(()=>evaluate("__game.race.vulcan>0&&__game.race.somersault===0&&__game.race.fireCooldown===0"));await evaluate('__game.electronDraws=0');
      electronVulcan=await evaluate("__game.network.action('fire')===true")&&await wait(()=>evaluate("__game.electronDraws>0&&document.querySelector('.vulcan-status strong').textContent.startsWith('ELECTRON VULCAN')"));
      electronVulcan &&= await wait(()=>app.snapshot(room,observer).world.projectiles.some(shot=>shot.owner===id&&shot.vulcan));await capture('avita-electron-vulcan');
      own.vulcan=0;room.world.projectiles=[];await sleep(1500);
      Object.assign(peer,{driver:8,human:true,wx:-58,wz:0,heading:0,motionHeading:0,cameraHeading:0,speed:0,shield:0,destroyed:0,vulcan:8,item:'hedgehog',fireCooldown:0});app.broadcast(room);
      await wait(()=>evaluate(`__game.race.vulcan===0&&__game.race.bots.some(actor=>actor.id===${observer.id}&&actor.driver===8&&actor.destroyed===0)`));await evaluate('__game.electronDraws=0');
      app.controls(observer,{sequence:0,keys:[],actions:[{type:'fire',id:0,afterMove:-1}],epoch:room.world.soundEpoch});
      remoteElectrons=await wait(()=>evaluate(`__game.electronDraws>0&&__game.race.projectiles.some(shot=>shot.owner===${observer.id}&&shot.vulcan)`));await capture('avita-remote-electrons');
    }
    if(driver===6){
      const actor=[room.world,...room.world.bots].find(actor=>actor.id===id),other=[room.world,...room.world.bots].find(actor=>actor.id===observer.id);
      await evaluate('__game.characterAngle=0');Object.assign(actor,{wx:-65,wz:0,heading:0,motionHeading:0,cameraHeading:0,speed:0,vulcan:8,item:'hedgehog',fireCooldown:0});app.broadcast(room);
      await wait(()=>evaluate("__game.race.vulcan>0&&__game.race.wz===0&&__game.race.fireCooldown===0"));await evaluate('__game.dollarDraws=0');
      dollarVulcan=await evaluate("__game.network.action('fire')===true")&&await wait(()=>evaluate("__game.dollarDraws>0&&document.querySelector('.vulcan-status strong').textContent.startsWith('DOLLAR VULCAN')"));
      dollarVulcan &&= await wait(()=>app.snapshot(room,observer).world.projectiles.some(shot=>shot.owner===id&&shot.vulcan));
      await capture('elon-dollar-vulcan');actor.vulcan=0;room.world.projectiles=[];await sleep(1500);
      Object.assign(other,{driver:6,human:true,wx:-58,wz:0,heading:0,motionHeading:0,cameraHeading:0,speed:0,shield:0,destroyed:0,vulcan:8,item:'hedgehog',fireCooldown:0});app.broadcast(room);
      await wait(()=>evaluate(`__game.race.vulcan===0&&__game.race.bots.some(actor=>actor.id===${observer.id}&&actor.driver===6&&actor.destroyed===0)`));await evaluate('__game.dollarDraws=0');
      app.controls(observer,{sequence:0,keys:[],actions:[{type:'fire',id:0,afterMove:-1}],epoch:room.world.soundEpoch});
      remoteDollars=await wait(()=>evaluate(`__game.dollarDraws>0&&__game.race.projectiles.some(shot=>shot.owner===${observer.id}&&shot.vulcan)`));await capture('elon-remote-dollars');
    }
    if(driver===7){
      const actor=[room.world,...room.world.bots].find(actor=>actor.id===id),other=[room.world,...room.world.bots].find(actor=>actor.id===observer.id);
      const observe=async target=>evaluate(`{__game.helmetTarget=${target};__game.helmetTrace=[];}`);
      const flew=()=>evaluate("(()=>{const trace=__game.helmetTrace,flight=trace.filter(frame=>frame.height!==null);return flight.length>=3&&flight.at(-1).height>flight[0].height+.5&&Math.abs(flight.at(-1).angle-flight[0].angle)>.5&&trace.some(frame=>frame.vulcan>0&&frame.bare&&frame.height===null);})()");
      await observe(id);Object.assign(actor,{vulcan:15,celebrate:0});app.broadcast(room);
      await wait(()=>evaluate('__game.helmetTrace.some(frame=>frame.height!==null)'));await sleep(250);await capture('houston-helmet-launch');
      helmetAnimation=await wait(flew)&&app.snapshot(room,observer).world.bots.find(actor=>actor.id===id)?.vulcan>0;
      await capture('houston-helmet-off');
      actor.vulcan=0;Object.assign(other,{driver:7,human:true,wx:-58,wz:75,heading:Math.PI,speed:0,health:3,shield:0,destroyed:0,vulcan:15,celebrate:0});
      await observe(observer.id);app.broadcast(room);
      await wait(()=>evaluate('__game.helmetTrace.some(frame=>frame.height!==null)'));await sleep(250);await capture('houston-remote-helmet');
      remoteHelmet=await wait(flew);
      other.vulcan=0;app.broadcast(room);helmetRestored=await wait(()=>evaluate('__game.helmetTrace.some(frame=>frame.vulcan===0&&frame.worn&&!frame.bare)'));
      await evaluate('__game.characterAngle=Math.PI/2');await capture('houston-starship-side');await evaluate('__game.characterAngle=0');
      starshipBoost=await evaluate("__game.network.action('turbo')===true")&&await wait(()=>evaluate(`__game.starshipJets.some(jet=>jet.id===${id}&&jet.boost&&jet.blue&&jet.vapor)`));await capture('houston-starship-boost');
      starshipFlip=await evaluate("__game.network.action('somersault')===true")&&await wait(()=>evaluate(`__game.starshipJets.some(jet=>jet.id===${id}&&jet.flip&&jet.blue&&jet.vapor)`));await capture('houston-starship-flip');
      actor.boost=0;actor.somersault=0;other.boost=2.5;app.broadcast(room);
      remoteStarship=await wait(()=>evaluate(`__game.starshipJets.some(jet=>jet.id===${observer.id}&&jet.boost&&jet.blue&&jet.vapor)`));await capture('houston-remote-starship');
    }
    if(driver===5){
      await evaluate('__game.characterAngle=0');
      const green=()=>evaluate("(()=>{const points=__game.renderer.smoke.sprites;for(let i=0;i<points.length;i+=7)if(points[i+5]>.4&&points[i+5]>points[i+4]*1.5&&points[i+5]>points[i+6]*2)return true;return false;})()");
      boostHaze=await evaluate("__game.network.action('turbo')===true")&&await wait(green);await capture('tamar-haze');
      flipHaze=await evaluate("__game.network.action('somersault')===true")&&await wait(async()=>await evaluate('__game.race.somersault>0')&&await green());await capture('tamar-haze-flip');
      const actor=[room.world,...room.world.bots].find(actor=>actor.id===id);
      Object.assign(actor,{wx:-65,wz:70,heading:0,motionHeading:0,cameraHeading:0,speed:0,boost:0,somersault:0,vulcan:8,item:'hedgehog',fireCooldown:0});app.broadcast(room);
      await wait(()=>evaluate("__game.race.vulcan>0&&__game.race.somersault===0&&__game.race.fireCooldown===0"));
      await evaluate('__game.cricketDraws=0');
      cricketVulcan=await evaluate("__game.network.action('fire')===true")&&await wait(()=>evaluate("__game.cricketDraws>0&&document.querySelector('.vulcan-status strong').textContent.startsWith('CRICKET VULCAN')"));
      cricketVulcan &&= await wait(()=>app.snapshot(room,observer).world.projectiles.some(shot=>shot.owner===id&&shot.vulcan));
      await capture('tamar-cricket-vulcan');
      actor.vulcan=0;room.world.projectiles=[];await sleep(1500);
      const remoteActor=[room.world,...room.world.bots].find(actor=>actor.id===observer.id);
      Object.assign(remoteActor,{driver:5,human:true,wx:-59,wz:70,heading:0,motionHeading:0,cameraHeading:0,speed:0,shield:0,destroyed:0,vulcan:8,item:'hedgehog',fireCooldown:0});app.broadcast(room);
      await wait(()=>evaluate(`__game.race.vulcan===0&&__game.race.bots.some(actor=>actor.id===${observer.id}&&actor.driver===5&&actor.destroyed===0)`));
      await evaluate('__game.cricketDraws=0');
      app.controls(observer,{sequence:0,keys:[],actions:[{type:'fire',id:0,afterMove:-1}],epoch:room.world.soundEpoch});
      remoteCrickets=await wait(()=>evaluate(`__game.cricketDraws>0&&__game.race.projectiles.some(shot=>shot.owner===${observer.id}&&shot.vulcan)`));
      await capture('tamar-remote-crickets');
    }
    const pearococo=driver===9?await checkPearococo(evaluate,app,room,id,observer,wait,sleep,capture):{pass:true};
    const yuda=driver===10?await checkYuda(evaluate,app,room,id,observer,wait,sleep,capture):{pass:true};
    const ryeah=driver===11?await checkRyeah(evaluate,app,room,id,observer,wait,sleep,capture):{pass:true};
    characters.push({ryeah,yuda,fuelStat,starshipBoost,starshipFlip,remoteStarship,pearococo,driver,name,selected,previewStopped,rendered:pixels.colors>20&&pixels.glError===0,remote:remote?.driver===driver,paint,pixels,cutenessStat,intelligenceStat,recovery,ammoRecovery,aura,auraModel,auraExpired,boostHaze,flipHaze,cricketVulcan,remoteCrickets,helmetAnimation,remoteHelmet,helmetRestored,dollarVulcan,remoteDollars,propellerAnimation,wormFlex,electronVulcan,remoteElectrons});
  }
  await evaluate('__game.characterAngle=0');
  const boostAccepted=await evaluate("__game.network.action('turbo')===true");
  const vapor=()=>evaluate(`(()=>{const points=__game.renderer.smoke.sprites;let white=0;for(let i=0;i<points.length;i+=7)if(points[i+4]>.8&&points[i+5]>.8&&points[i+6]>=points[i+4])white++;return white>0;})()`);
  const boostVapor=await wait(vapor);await capture('roadster-thrust');
  const flipAccepted=await evaluate("__game.network.action('somersault')===true");
  const flipVapor=await wait(async()=>await evaluate('__game.race.somersault>0')&&await vapor());
  const remoteFlip=await wait(()=>{const actor=app.snapshot(room,observer).world.bots.find(actor=>actor.id===id);return actor?.driver===6&&actor.somersault>0;});
  await capture('roadster-flip');
  const voicePass=await evaluate("[4,5,6,7,8,9,10,11,12,13,14].every(driver=>__game.audio.voice({driver,cue:'win'}))");
  // Restore the simulated observer's actual selection before room teardown.
  // Mid-match roster updates correctly reject the test's temporary character swap.
  Object.assign([room.world,...room.world.bots].find(actor=>actor.id===observer.id),{driver:observer.driver,bomber:observer.role==='bomber'});
  return {menuPass,preview,characters,boostAccepted,boostVapor,flipAccepted,flipVapor,remoteFlip,voicePass,pass:menuPass&&preview.pass&&characters.every(character=>character.ryeah.pass&&character.yuda.pass&&character.fuelStat&&character.starshipBoost&&character.starshipFlip&&character.remoteStarship&&character.pearococo.pass&&character.selected&&character.previewStopped&&character.rendered&&character.remote&&character.paint&&character.cutenessStat&&character.intelligenceStat&&character.recovery&&character.ammoRecovery&&character.aura&&character.auraModel&&character.auraExpired&&character.boostHaze&&character.flipHaze&&character.cricketVulcan&&character.remoteCrickets&&character.helmetAnimation&&character.remoteHelmet&&character.helmetRestored&&character.dollarVulcan&&character.remoteDollars&&character.propellerAnimation&&character.wormFlex&&character.electronVulcan&&character.remoteElectrons)&&boostAccepted&&boostVapor&&flipAccepted&&flipVapor&&remoteFlip&&voicePass};
}
