export async function checkMobile(evaluate,app,room,id,sleep,capture){
  await evaluate("document.getElementById('auto-fire').click();document.getElementById('start').click()");
  const host=room.members.get(room.host);
  if(id!==room.host)await evaluate(`fetch('/api/control',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer ${host.token}'},body:JSON.stringify({action:'start'})})`);
  for(let i=0;i<100;i++){if(room.world.phase==='countdown')break;await sleep(25);}
  const fullscreen=await evaluate(`(()=>{const panel=document.querySelector('.race-panel'),r=panel.getBoundingClientRect();return panel.classList.contains('mobile-fullscreen')&&Math.abs(r.width-innerWidth)<2&&Math.abs(r.height-innerHeight)<2&&panel.contains(document.querySelector('.touch-controls'));})()`);
  const enemy=id===host.id?app.join(room,{name:'Far <img>',driver:1}):host;
  const actor=[room.world,...room.world.bots][id],other=[room.world,...room.world.bots][enemy.id];
  Object.assign(room.world,{phase:'racing',supplies:[],projectiles:[]});
  const reset=()=>{Object.assign(actor,{wx:-65,wz:0,heading:0,motionHeading:0,cameraHeading:0,speed:0,shield:0,health:6,ammo:5,reload:0,vulcan:0,item:'hedgehog',fireCooldown:0});Object.assign(other,{wx:-65,wz:60,heading:Math.PI,motionHeading:Math.PI,cameraHeading:Math.PI,speed:0,shield:0,health:6,destroyed:0,name:'Far <img>'});};
  reset();enemy.name='Far <img>';
  for(let i=0;i<100;i++){if(await evaluate("[...document.querySelectorAll('.kart-nameplate')].some(node=>node.textContent==='Far <img>')"))break;await sleep(25);}
  const farName=await evaluate("[...document.querySelectorAll('.kart-nameplate')].some(node=>node.textContent==='Far <img>')&&!document.querySelector('.kart-nameplates img')");
  other.wz=15;await sleep(350);const nearHidden=await evaluate("![...document.querySelectorAll('.kart-nameplate')].some(node=>node.textContent==='Far <img>')");other.wz=60;
  await evaluate("document.getElementById('enable-tilt').click()");
  for(let i=0;i<100;i++){if(await evaluate("document.querySelector('.mobile-panel').textContent.includes('declined')"))break;await sleep(10);}
  const denied=await evaluate("document.querySelector('.mobile-panel').textContent.includes('declined')&&document.getElementById('enable-tilt').textContent==='ENABLE TILT'");
  await evaluate("__motionPermission='granted';document.getElementById('enable-tilt').click()");
  for(let i=0;i<100;i++){if(await evaluate("document.getElementById('enable-tilt').textContent==='TILT: ON'"))break;await sleep(10);}
  await evaluate("window.dispatchEvent(new DeviceOrientationEvent('deviceorientation',{beta:35,gamma:0}));window.dispatchEvent(new DeviceOrientationEvent('deviceorientation',{beta:35,gamma:14}))");
  for(let i=0;i<100;i++){if(actor.heading<-.02)break;await sleep(10);}
  const steering=actor.heading<-.02&&actor.speed>0;
  await evaluate("document.getElementById('enable-tilt').click()");await sleep(200);reset();
  for(let i=0;i<100;i++){if(await evaluate("Math.abs(__game.race.heading)<.05&&__game.network.state.world.ammo===5"))break;await sleep(25);}
  await evaluate("document.getElementById('auto-fire').click()");
  for(let i=0;i<100;i++){if(actor.ammo<5)break;await sleep(25);}
  const autoShot=actor.ammo<5&&await evaluate("!document.getElementById('mobile-lock').classList.contains('hidden')");
  if(capture)await capture();
  await evaluate("document.getElementById('auto-fire').click()");await sleep(300);reset();other.wz=-65;room.world.projectiles=[];
  for(let i=0;i<100;i++){if(await evaluate("__game.network.state.world.bots.some(p=>p.wz===-65)&&__game.network.state.world.ammo===5"))break;await sleep(25);}
  await evaluate("document.getElementById('auto-fire').click()");await sleep(650);
  const noBlindFire=actor.ammo===5&&await evaluate("document.getElementById('mobile-lock').classList.contains('hidden')");
  await evaluate("document.getElementById('auto-fire').click();document.getElementById('mobile-fullscreen').click()");
  const exited=await evaluate("!document.querySelector('.race-panel').classList.contains('mobile-fullscreen')");
  return {fullscreen,farName,nearHidden,denied,steering,autoShot,noBlindFire,noTargetAmmo:actor.ammo,exited,pass:fullscreen&&farName&&nearHidden&&denied&&steering&&autoShot&&noBlindFire&&exited};
}
