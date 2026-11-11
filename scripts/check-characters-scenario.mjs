export async function checkCharacters(evaluate,app,room,id,sleep,capture){
  const wait=async predicate=>{for(let i=0;i<120;i++){if(await predicate())return true;await sleep(25);}return false;};
  const menu=await evaluate("[...document.querySelectorAll('#drivers button')].map(button=>button.getAttribute('aria-label'))");
  const menuPass=['Ellie the Elephant','Tamar the Cricket','Elon Musk'].every(name=>menu.includes(name))&&menu.length===7;
  if(room.members.size<2)app.join(room,{name:'Observer',driver:1});
  const observer=[...room.members.values()].find(member=>member.id!==id),characters=[];
  await evaluate(`{
    __game.characterAngle=Math.PI;
    const renderer=__game.renderer,kart=renderer.kart.bind(renderer);
    renderer.kart=(mesh,pose,color,driver,...args)=>{if(!renderer.buildingModel&&driver===__game.race.driver)pose={...pose,tx:Math.sin(__game.characterAngle),tz:Math.cos(__game.characterAngle)};return kart(mesh,pose,color,driver,...args);};
    const draw=renderer.draw.bind(renderer);
    renderer.draw=(...args)=>{const result=draw(...args);if(__game.characterCapture===__game.race.driver){const gl=renderer.gl,w=gl.drawingBufferWidth,h=gl.drawingBufferHeight,width=50,height=Math.floor(h*.3),pixels=new Uint8Array(width*height*4);gl.readPixels(Math.floor(w/2)-25,Math.floor(h*.16),width,height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);const colors=new Set();let white=0;for(let i=0;i<pixels.length;i+=4){colors.add(pixels[i]*65536+pixels[i+1]*256+pixels[i+2]);const low=Math.min(pixels[i],pixels[i+1],pixels[i+2]),high=Math.max(pixels[i],pixels[i+1],pixels[i+2]);if(low>150&&high-low<20)white++;}__game.characterPixels={driver:__game.race.driver,colors:colors.size,white,glError:gl.getError()};__game.characterCapture=null;}return result;};
    __game.keys.clear();
  }`);
  for(const [driver,name]of[[4,'Ellie the Elephant'],[5,'Tamar the Cricket'],[6,'Elon Musk']]){
    app.makeWorld(room);app.broadcast(room);
    await wait(()=>evaluate("__game.network.state.world.phase==='ready'"));
    await evaluate(`__game.network.chooseDriver(${driver})`);
    const selected=await wait(()=>evaluate(`__game.race.driver===${driver}&&document.getElementById('driver-name').textContent===${JSON.stringify(name)}`));
    Object.assign(room.world,{phase:'racing',duration:3600,supplies:[]});
    for(const actor of [room.world,...room.world.bots])Object.assign(actor,actor.id===id?{wx:-65,wz:70,heading:0,motionHeading:0,cameraHeading:0,speed:0,shield:0,boost:0,somersault:0,somersaultCooldown:0}:{destroyed:999});
    app.broadcast(room);
    await wait(()=>evaluate(`__game.race.phase==='racing'&&__game.race.driver===${driver}`));await sleep(100);
    await evaluate(`{__game.characterPixels=null;__game.characterCapture=${driver};}`);
    await wait(()=>evaluate(`__game.characterPixels?.driver===${driver}`));
    const pixels=await evaluate('__game.characterPixels');
    const remote=app.snapshot(room,observer).world.bots.find(actor=>actor.id===id);
    await capture(name.split(' ')[0].toLowerCase());
    const paint=driver!==6||remote?.color==='#e8edf2'&&pixels.white>30&&await evaluate("__game.race.color==='#e8edf2'");
    characters.push({driver,name,selected,rendered:pixels.colors>20&&pixels.glError===0,remote:remote?.driver===driver,paint,pixels});
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
  return {menuPass,characters,boostAccepted,boostVapor,flipAccepted,flipVapor,remoteFlip,voicePass,pass:menuPass&&characters.every(character=>character.selected&&character.rendered&&character.remote&&character.paint)&&boostAccepted&&boostVapor&&flipAccepted&&flipVapor&&remoteFlip&&voicePass};
}
