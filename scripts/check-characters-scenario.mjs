export async function checkCharacters(evaluate,app,room,id,sleep,capture){
  const wait=async predicate=>{for(let i=0;i<120;i++){if(await predicate())return true;await sleep(25);}return false;};
  const menu=await evaluate("[...document.querySelectorAll('#drivers button')].map(button=>button.getAttribute('aria-label'))");
  const menuPass=['Ellie the Elephant','Chirp the Cricket','Elon Musk'].every(name=>menu.includes(name))&&menu.length===7;
  if(room.members.size<2)app.join(room,{name:'Observer',driver:1});
  const observer=[...room.members.values()].find(member=>member.id!==id),characters=[];
  await evaluate(`{
    __game.characterAngle=Math.PI;
    const renderer=__game.renderer,kart=renderer.kart.bind(renderer);
    renderer.kart=(mesh,pose,color,driver,...args)=>{if(!renderer.buildingModel&&driver===__game.race.driver)pose={...pose,tx:Math.sin(__game.characterAngle),tz:Math.cos(__game.characterAngle)};return kart(mesh,pose,color,driver,...args);};
    __game.keys.clear();
  }`);
  for(const [driver,name]of[[4,'Ellie the Elephant'],[5,'Chirp the Cricket'],[6,'Elon Musk']]){
    app.makeWorld(room);app.broadcast(room);
    await wait(()=>evaluate("__game.network.state.world.phase==='ready'"));
    await evaluate(`__game.network.chooseDriver(${driver})`);
    const selected=await wait(()=>evaluate(`__game.race.driver===${driver}&&document.getElementById('driver-name').textContent===${JSON.stringify(name)}`));
    Object.assign(room.world,{phase:'racing',duration:3600,supplies:[]});
    for(const actor of [room.world,...room.world.bots])Object.assign(actor,actor.id===id?{wx:-65,wz:70,heading:0,motionHeading:0,cameraHeading:0,speed:0,shield:0,boost:0,somersault:0,somersaultCooldown:0}:{destroyed:999});
    app.broadcast(room);
    await wait(()=>evaluate(`__game.race.phase==='racing'&&__game.race.driver===${driver}`));await sleep(100);
    const rendered=await evaluate(`({cached:[...__game.renderer.models].some(([key,model])=>key.startsWith('kart:${driver}:')&&model.count>0),glError:__game.renderer.gl.getError()})`);
    const remote=app.snapshot(room,observer).world.bots.find(actor=>actor.id===id);
    await capture(name.split(' ')[0].toLowerCase());
    characters.push({driver,name,selected,rendered:rendered.cached&&rendered.glError===0,remote:remote?.driver===driver});
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
  return {menuPass,characters,boostAccepted,boostVapor,flipAccepted,flipVapor,remoteFlip,voicePass,pass:menuPass&&characters.every(character=>character.selected&&character.rendered&&character.remote)&&boostAccepted&&boostVapor&&flipAccepted&&flipVapor&&remoteFlip&&voicePass};
}
