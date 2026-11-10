export async function checkMobile(evaluate,app,room,id,sleep,capture,rotate,tap){
  const host=room.members.get(room.host),enemy=id===host.id?app.join(room,{name:'Target <img>',driver:1}):host;
  enemy.name='Target <img>';
  await evaluate("document.getElementById('start').click()");
  if(id!==room.host)await evaluate(`fetch('/api/control',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer ${host.token}'},body:JSON.stringify({action:'start'})})`);
  for(let i=0;i<100;i++){if(room.world.phase==='countdown')break;await sleep(25);}
  const actor=[room.world,...room.world.bots][id],other=[room.world,...room.world.bots][enemy.id];
  Object.assign(room.world,{phase:'racing',supplies:[],projectiles:[]});
  Object.assign(other,{wx:-65,wz:30,speed:0,shield:0,health:3,destroyed:0,name:'Target <img>'});
  const initialAmmo=actor.bomber&&actor.bombAmmo===2;
  for(let i=0;i<100;i++){if(await evaluate("__game.race.phase==='racing'&&__game.race.bomber&&document.getElementById('bomb-count').textContent==='2 A-BOMBS'"))break;await sleep(10);}
  const fullscreen=await evaluate(`(()=>{const panel=document.querySelector('.race-panel'),r=panel.getBoundingClientRect();return panel.classList.contains('mobile-fullscreen')&&Math.abs(r.width-innerWidth)<2&&Math.abs(r.height-innerHeight)<2;})()`);
  const overhead=await evaluate("document.querySelector('.viewport').classList.contains('bomber-view')&&!document.getElementById('enable-tilt')&&!document.getElementById('auto-fire')&&getComputedStyle(document.querySelector('.touch-controls')).display==='none'");
  const default3D=await evaluate("__game.renderer.bomberView==='3d'&&document.getElementById('bomber-view-3d').getAttribute('aria-pressed')==='true'");
  for(let i=0;i<100;i++){if(await evaluate("[...document.querySelectorAll('.kart-nameplate')].some(node=>node.textContent==='Target <img>')"))break;await sleep(10);}
  const namedTarget=await evaluate("[...document.querySelectorAll('.kart-nameplate')].some(node=>node.textContent==='Target <img>')&&!document.querySelector('.kart-nameplates img')");
  await evaluate(`{
    __game.bombTrace=[];__game.bombTap=null;
    document.getElementById('game').addEventListener('pointerdown',()=>{__game.bombTap=performance.now();});
    const render=__game.network.render.bind(__game.network);__game.network.render=(...args)=>{const view=render(...args);if(__game.bombTap!==null)__game.bombTrace.push({delay:performance.now()-__game.bombTap,ammo:view.bombAmmo,bombs:view.bombs.map(b=>({wx:b.wx,wz:b.wz,owner:b.owner}))});return view;};
  }`);
  const targetPixel=async(wx,wz)=>evaluate(`(()=>{const r=document.getElementById('game').getBoundingClientRect(),matrix=__game.renderer.bomberMatrix,point=[${wx},0,${wz},1],clip=[0,1,2,3].map(row=>point.reduce((sum,value,column)=>sum+matrix[column*4+row]*value,0));return {x:r.left+(clip[0]/clip[3]+1)*r.width/2,y:r.top+(1-clip[1]/clip[3])*r.height/2};})()`);
  const chooseCamera=async view=>{await evaluate(`document.getElementById('bomber-view-${view}').click();new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);};
  const point=await targetPixel(-65,30);await tap(point.x,point.y);
  for(let i=0;i<100;i++){if(room.world.bombs.length)break;await sleep(10);}
  const dropped=room.world.bombs.find(bomb=>bomb.owner===id),accurate=Boolean(dropped&&Math.abs(dropped.wx+65)<.6&&Math.abs(dropped.wz-30)<.6),spent=actor.bombAmmo===1;
  const desktopSawDrop=app.snapshot(room,enemy).world.bombs.some(bomb=>bomb.owner===id)&&!app.snapshot(room,enemy).world.bomber;
  await tap(point.x,point.y);await tap(point.x,point.y);
  for(let i=0;i<100;i++){if(room.world.bombSequence===2)break;await sleep(10);}
  const boundedDrops=room.world.bombSequence===2&&actor.bombAmmo===0;
  if(capture)await capture('portrait-3d-drop');
  for(let i=0;i<150;i++){if(other.deaths===1)break;await sleep(10);}
  const blast=other.deaths===1&&actor.kills===1&&app.snapshot(room,enemy).world.effects.some(effect=>effect.type==='abomb');
  const killRefill=actor.bombAmmo===1&&room.world.elapsed<5;
  if(capture){await sleep(350);await capture('portrait-3d-blast');}
  const feedback=await evaluate("__game.bombTrace[0]??null");
  const immediate=Boolean(feedback&&feedback.ammo===1&&feedback.bombs.some(bomb=>bomb.owner===id));
  for(let i=0;i<600;i++){if(actor.bombAmmo===2)break;await sleep(10);}
  const refillAt=room.world.elapsed,refill=actor.bombAmmo===2&&refillAt>=4.999;
  const margin=await evaluate("(()=>{const r=document.getElementById('game').getBoundingClientRect();return {x:r.left+2,y:r.top+2};})()");
  const before=room.world.bombSequence;await tap(margin.x,margin.y);await sleep(200);
  const marginsIgnored=room.world.bombSequence===before&&actor.bombAmmo===2;
  await chooseCamera('map');
  const mapOption=await evaluate("__game.renderer.bomberView==='map'&&document.getElementById('bomber-view-map').getAttribute('aria-pressed')==='true'");
  const switchPreservesGame=actor.bombAmmo===2&&actor.kills===1&&room.world.phase==='racing';
  if(capture)await capture('portrait-2d-map');
  const landscape=[];
  for(const angle of [90,270])for(const view of ['3d','map']){
    await rotate(angle);
    for(let i=0;i<100;i++){if(await evaluate(`__game.network.state.actionSequence>=${room.members.get(id).actionAck??-1}`))break;await sleep(10);}
    actor.bombAmmo=1;actor.bombReload=0;await chooseCamera(view);
    for(let i=0;i<100;i++){if(await evaluate('__game.race.bombAmmo===1'))break;await sleep(10);}
    const location=await targetPixel(65,-30),sequence=room.world.bombSequence;
    await tap(location.x,location.y);
    for(let i=0;i<100;i++){if(room.world.bombSequence>sequence)break;await sleep(10);}
    const bomb=room.world.bombs.find(bomb=>bomb.id>sequence);
    const hit=Boolean(bomb&&Math.abs(bomb.wx-65)<.6&&Math.abs(bomb.wz+30)<.6);
    landscape.push({angle,view,hit,ammo:actor.bombAmmo,bomb: bomb?{wx:bomb.wx,wz:bomb.wz}:null});if(capture)await capture(`landscape-${angle}-${view}`);
  }
  const landscapePass=landscape.every(test=>test.hit);
  await chooseCamera('3d');
  await evaluate("document.getElementById('mobile-fullscreen').click()");
  const exited=await evaluate("!document.querySelector('.race-panel').classList.contains('mobile-fullscreen')");
  return {initialAmmo,fullscreen,overhead,default3D,mapOption,switchPreservesGame,namedTarget,accurate,spent,immediate,feedbackDelayMs:feedback?.delay,boundedDrops,desktopSawDrop,blast,killRefill,refill,refillAt,marginsIgnored,landscape,landscapePass,exited,pass:initialAmmo&&fullscreen&&overhead&&default3D&&mapOption&&switchPreservesGame&&namedTarget&&accurate&&spent&&immediate&&boundedDrops&&desktopSawDrop&&blast&&killRefill&&refill&&marginsIgnored&&landscapePass&&exited};
}
