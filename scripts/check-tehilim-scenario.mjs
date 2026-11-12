export async function checkTehilim(evaluate,app,room,id,sleep,capture){
  const wait=async predicate=>{for(let i=0;i<160;i++){if(await predicate())return true;await sleep(25);}return false;};
  if(room.members.size<2)app.join(room,{name:'Missile sender',driver:1});
  const peer=[...room.members.values()].find(m=>m.id!==id),own=[room.world,...room.world.bots].find(a=>a.id===id),enemy=[room.world,...room.world.bots].find(a=>a.id===peer.id);
  Object.assign(room.world,{phase:'racing',duration:3600,supplies:[{id:9,kind:'tehilim',wx:65,wz:80,cooldown:0,version:0}]});
  for(const a of [room.world,...room.world.bots])Object.assign(a,{human:true,destroyed:999});
  Object.assign(own,{destroyed:0,wx:65,wz:80,heading:Math.PI,motionHeading:Math.PI,cameraHeading:Math.PI,speed:0,health:6});
  Object.assign(enemy,{destroyed:0,wx:65,wz:40,heading:0,motionHeading:0,cameraHeading:0,speed:0,health:3,tehilim:25,fireCooldown:0,item:'missile',missiles:1});
  await evaluate(`{const renderer=__game.renderer,draw=renderer.tehilimAura.bind(renderer);__game.bookOwners=new Set();renderer.tehilimAura=(p,...args)=>{__game.bookOwners.add(p.id);return draw(p,...args);};}`);
  app.broadcast(room);
  const aura=await wait(()=>evaluate(`__game.race.tehilim>24&&document.querySelector('.tehilim-status').textContent.includes('RETURN TO SENDER')&&__game.bookOwners.has(${id})&&__game.bookOwners.has(${peer.id})&&__game.renderer.models.has('tehilim:book')`));await capture('tehilim-books');
  app.controls(peer,{sequence:0,keys:[],actions:[{type:'fire',id:0,afterMove:-1}],epoch:room.world.soundEpoch});
  const returning=await wait(()=>evaluate(`__game.race.projectiles.some(s=>s.kind==='missile'&&s.owner===${id}&&s.target===${peer.id})`));await capture('tehilim-return-to-sender');
  const kill=await wait(()=>evaluate(`__game.race.kills===1&&__game.race.health===6&&__game.race.bots.some(a=>a.id===${peer.id}&&a.destroyed>0)`));
  own.tehilim=.05;app.broadcast(room);const expired=await wait(()=>evaluate("__game.race.tehilim===0&&document.querySelector('.tehilim-status').classList.contains('hidden')"));
  return {aura,returning,kill,expired,pass:aura&&returning&&kill&&expired};
}
