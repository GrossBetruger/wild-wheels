export async function checkPreview(evaluate,app,room,id,sleep,capture){
  const wait=async predicate=>{for(let i=0;i<120;i++){if(await predicate())return true;await sleep(25);}return false;};
  await evaluate("document.querySelector('.character-preview').scrollIntoView({block:'center'})");
  const available=await wait(()=>evaluate('Boolean(__game.preview.renderer&&__game.preview.presentation)'));
  if(!available)return {available:false,pass:false};
  const before=await evaluate('__game.preview.presentation.cameraAngle');await sleep(400);
  const orbit=await evaluate(`__game.preview.presentation.cameraAngle>${before}+.05`);
  await evaluate("{if(!__game.preview.paused)document.querySelector('.character-preview button').click();}");
  const frozen=await evaluate('__game.preview.clock');await sleep(150);
  const pause=await evaluate(`__game.preview.clock===${frozen}`);
  await evaluate(`{
    const renderer=__game.preview.renderer,draw=renderer.drawPreview.bind(renderer);__game.previewDraws=0;
    renderer.drawPreview=(driver,...args)=>{const result=draw(driver,...args);__game.previewDraws++;if(!__game.previewPixelsWanted)return result;__game.previewPixelsWanted=false;const gl=renderer.gl,pixels=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4);gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,pixels);const colors=new Set();for(let i=0;i<pixels.length;i+=4)colors.add(pixels[i]*65536+pixels[i+1]*256+pixels[i+2]);__game.previewPixels={driver,colors:colors.size,error:gl.getError()};return result;};
  }`);
  const selections=[];
  for(const [driver,name]of [[0,'Pip the Panda'],[1,'Rocco the Raccoon'],[2,'Felix the Fox'],[3,'Benny the Bear'],[4,'Ellie the Elephant'],[5,'Tamar the Cricket'],[6,'Elon Musk'],[7,'Houston the RTPL'],[8,'Avita-Jas']]){
    await evaluate(`__game.network.chooseDriver(${driver})`);
    const selected=await wait(()=>evaluate(`__game.race.driver===${driver}&&__game.preview.driver===${driver}`));
    await evaluate('{__game.preview.clock=1;__game.preview.dirty=true;__game.previewPixelsWanted=true;}');
    await wait(()=>evaluate(`__game.previewPixels?.driver===${driver}`));
    const pixels=await evaluate('__game.previewPixels'),named=await evaluate(`document.getElementById('character-preview').getAttribute('aria-label').includes(${JSON.stringify(name)})`);
    selections.push({driver,name,selected,named,rendered:pixels?.colors>20&&pixels?.error===0});await capture(`preview-${driver}`,'.character-preview');
  }
  const gestures=[];
  for(const [clock,gesture]of [[1,'hello'],[5,'cheer'],[9,'look'],[13,'rev']]){
    await evaluate(`{__game.preview.clock=${clock};__game.preview.dirty=true;}`);
    const shown=await wait(()=>evaluate(`__game.preview.presentation.id===${JSON.stringify(gesture)}`));gestures.push({gesture,shown});await capture(`preview-avita-${gesture}`,'.character-preview');
  }
  const world=app.snapshot(room,[...room.members.values()].find(member=>member.id===id)).world;
  const noGameActions=world.phase==='ready'&&world.elapsed===0&&world.ammo===10&&world.missiles===1&&world.turbos===1&&world.boost===0&&world.projectiles.length===0;
  await evaluate("{__game.preview.clock=0;document.querySelector('.character-preview button').click();}");
  const resume=await wait(()=>evaluate('__game.preview.clock>.05'));
  return {available,orbit,pause,resume,selections,gestures,noGameActions,pass:orbit&&pause&&resume&&selections.every(s=>s.selected&&s.named&&s.rendered)&&gestures.every(g=>g.shown)&&noGameActions};
}
