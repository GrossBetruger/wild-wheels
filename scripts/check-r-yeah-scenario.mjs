export async function checkRyeah(evaluate,app,room,id,observer,wait,sleep,capture){
  const own=[room.world,...room.world.bots].find(a=>a.id===id),peer=[room.world,...room.world.bots].find(a=>a.id===observer.id);
  await evaluate(`{
    const renderer=__game.renderer,rotors=renderer.chopperRotors.bind(renderer);__game.chopperFrames=new Map();__game.chopperFlips=new Set();
    renderer.chopperRotors=(p,height,angle,pitch,...args)=>{const result=rotors(p,height,angle,pitch,...args);if(!__game.chopperFrames.has(p.id))__game.chopperFrames.set(p.id,new Set());__game.chopperFrames.get(p.id).add(renderer.instances.at(-1).buffer);if(Math.abs(pitch)>1)__game.chopperFlips.add(p.id);return result;};
  }`);
  Object.assign(peer,{driver:11,human:true,destroyed:0,shield:0,wx:own.wx+7,wz:own.wz+5,celebrate:1.6});app.broadcast(room);
  const localRotor=await wait(()=>evaluate(`__game.chopperFrames.get(${id})?.size>=4`)),remoteRotor=await wait(()=>evaluate(`__game.chopperFrames.get(${observer.id})?.size>=4`));
  await evaluate('__game.characterAngle=Math.PI');await capture('r-yeah-lion-front');
  await evaluate('__game.characterAngle=Math.PI/2');await capture('r-yeah-jetranger-side');
  await evaluate('__game.characterAngle=0');await capture('r-yeah-lion-chase-view');
  peer.destroyed=999;app.broadcast(room);
  const wash=()=>evaluate("(()=>{const p=__game.renderer.smoke.sprites;for(let i=0;i<p.length;i+=7)if(p[i+4]===.76&&p[i+5]===.78&&p[i+6]===.69)return true;return false;})()");
  const boost=await evaluate("__game.network.action('turbo')===true")&&await wait(wash);await capture('r-yeah-rotor-wash');
  const flip=await evaluate("__game.network.action('somersault')===true")&&await wait(()=>evaluate(`__game.chopperFlips.has(${id})`));await capture('r-yeah-helicopter-flip');
  Object.assign(peer,{destroyed:0,boost:1,somersault:.55});app.broadcast(room);
  const remoteFlip=await wait(()=>evaluate(`__game.chopperFlips.has(${observer.id})`));await capture('r-yeah-remote-flip');
  peer.destroyed=999;return {localRotor,remoteRotor,boost,flip,remoteFlip,pass:localRotor&&remoteRotor&&boost&&flip&&remoteFlip};
}
