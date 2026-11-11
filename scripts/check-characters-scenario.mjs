export async function checkCharacters(evaluate,app,room,id,sleep,capture){
  const wait=async predicate=>{for(let i=0;i<120;i++){if(await predicate())return true;await sleep(25);}return false;};
  const menu=await evaluate("[...document.querySelectorAll('#drivers button')].map(button=>button.getAttribute('aria-label'))");
  const menuPass=['Ellie the Elephant','Tamar the Cricket','Elon Musk'].every(name=>menu.includes(name))&&menu.length===7;
  if(room.members.size<2)app.join(room,{name:'Observer',driver:1});
  const observer=[...room.members.values()].find(member=>member.id!==id),characters=[];
  await evaluate(`{
    __game.characterAngle=Math.PI;
    const renderer=__game.renderer,kart=renderer.kart.bind(renderer);
    const cricket=renderer.cricket.bind(renderer);__game.cricketDraws=0;
    renderer.cricket=(...args)=>{__game.cricketDraws++;return cricket(...args);};
    renderer.kart=(mesh,pose,color,driver,...args)=>{if(!renderer.buildingModel&&driver===__game.race.driver)pose={...pose,tx:Math.sin(__game.characterAngle),tz:Math.cos(__game.characterAngle)};return kart(mesh,pose,color,driver,...args);};
    const draw=renderer.draw.bind(renderer);
    renderer.draw=(...args)=>{const result=draw(...args);if(__game.characterCapture===__game.race.driver){const gl=renderer.gl,w=gl.drawingBufferWidth,h=gl.drawingBufferHeight,width=50,height=Math.floor(h*.3),pixels=new Uint8Array(width*height*4);gl.readPixels(Math.floor(w/2)-25,Math.floor(h*.16),width,height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);const colors=new Set();let white=0;for(let i=0;i<pixels.length;i+=4){colors.add(pixels[i]*65536+pixels[i+1]*256+pixels[i+2]);const low=Math.min(pixels[i],pixels[i+1],pixels[i+2]),high=Math.max(pixels[i],pixels[i+1],pixels[i+2]);if(low>150&&high-low<20)white++;}__game.characterPixels={driver:__game.race.driver,colors:colors.size,white,glError:gl.getError()};__game.characterCapture=null;}return result;};
    __game.keys.clear();
  }`);
  for(const [driver,name,cuteness,recoverySeconds,ammoSeconds]of[[4,'Ellie the Elephant',5,4,1],[5,'Tamar the Cricket',5,4,1],[6,'Elon Musk',1,12,2]]){
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
    await evaluate(`{__game.characterPixels=null;__game.characterCapture=${driver};}`);
    await wait(()=>evaluate(`__game.characterPixels?.driver===${driver}`));
    const pixels=await evaluate('__game.characterPixels');
    const remote=app.snapshot(room,observer).world.bots.find(actor=>actor.id===id);
    await capture(name.split(' ')[0].toLowerCase());
    const paint=driver!==6||remote?.color==='#e8edf2'&&pixels.white>30&&await evaluate("__game.race.color==='#e8edf2'");
    const cutenessStat=await evaluate(`document.querySelectorAll('#cuteness-stat i.on').length===${cuteness}&&document.getElementById('cuteness-stat').parentElement.title.includes('every ${recoverySeconds} seconds')`);
    const recovery=await wait(()=>evaluate("__game.race.health===3&&document.getElementById('lap').textContent==='♥♥♥'"))&&app.snapshot(room,observer).world.bots.find(actor=>actor.id===id)?.health===3;
    const ammoRecovery=await wait(()=>evaluate("__game.race.ammo>=1&&Number(document.getElementById('hedgehog-count').textContent)>=1"))&&app.snapshot(room,observer).world.bots.find(actor=>actor.id===id)?.ammo>=1;
    let boostHaze=true,flipHaze=true,cricketVulcan=true,remoteCrickets=true;
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
    characters.push({driver,name,selected,rendered:pixels.colors>20&&pixels.glError===0,remote:remote?.driver===driver,paint,pixels,cutenessStat,recovery,ammoRecovery,boostHaze,flipHaze,cricketVulcan,remoteCrickets});
  }
  await evaluate('__game.characterAngle=0');
  const boostAccepted=await evaluate("__game.network.action('turbo')===true");
  const vapor=()=>evaluate(`(()=>{const points=__game.renderer.smoke.sprites;let white=0;for(let i=0;i<points.length;i+=7)if(points[i+4]>.8&&points[i+5]>.8&&points[i+6]>=points[i+4])white++;return white>0;})()`);
  const boostVapor=await wait(vapor);await capture('roadster-thrust');
  const flipAccepted=await evaluate("__game.network.action('somersault')===true");
  const flipVapor=await wait(async()=>await evaluate('__game.race.somersault>0')&&await vapor());
  const remoteFlip=await wait(()=>{const actor=app.snapshot(room,observer).world.bots.find(actor=>actor.id===id);return actor?.driver===6&&actor.somersault>0;});
  await capture('roadster-flip');
  const voicePass=await evaluate("[4,5,6].every(driver=>__game.audio.voice({driver,cue:'win'}))");
  return {menuPass,characters,boostAccepted,boostVapor,flipAccepted,flipVapor,remoteFlip,voicePass,pass:menuPass&&characters.every(character=>character.selected&&character.rendered&&character.remote&&character.paint&&character.cutenessStat&&character.recovery&&character.ammoRecovery&&character.boostHaze&&character.flipHaze&&character.cricketVulcan&&character.remoteCrickets)&&boostAccepted&&boostVapor&&flipAccepted&&flipVapor&&remoteFlip&&voicePass};
}
