export async function checkControls(evaluate,app,room,id,sleep){
  const host=room.members.get(room.host);
  const guest=id===room.host?app.join(room,{name:'Ready Friend',driver:1}):room.members.get(id);
  const displayName=id===room.host?'Alex <b>':'Sam <b>';
  const editable=await evaluate(`!__game.network.name.disabled`);
  await evaluate(`{const input=__game.network.name;input.value=${JSON.stringify(displayName)};input.dispatchEvent(new Event('input'));}`);
  for(let i=0;i<100;i++){if(await evaluate("document.getElementById('start').disabled===false"))break;await sleep(25);}
  if(id!==room.host)await evaluate("document.getElementById('start').click()");
  if(id===room.host)await evaluate(`fetch('/api/ready',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer ${guest.token}'},body:JSON.stringify({ready:true})})`);
  for(let i=0;i<100;i++){if(await evaluate(`__game.network.state.players.some(p=>p.id===${guest.id}&&p.wantsToPlay)&&(${id===room.host}||document.getElementById('start').textContent.includes('WAITING FOR HOST')&&document.getElementById('start').disabled)`))break;await sleep(25);}
  const readyUI=await evaluate(`({status:__game.network.status.textContent,button:document.getElementById('start').textContent,disabled:document.getElementById('start').disabled,roster:__game.network.players.textContent})`);
  const readyPass=Boolean(guest.wantsToPlay)&&(id===room.host?readyUI.status.includes('Ready Friend')&&readyUI.status.includes('wants to play'):readyUI.status.includes('Waiting for the host')&&readyUI.button.includes('WAITING FOR HOST')&&readyUI.disabled);
  const draftPreserved=await evaluate(`__game.network.name.value===${JSON.stringify(displayName)}`);
  if(id===room.host)await evaluate('__game.network.saveNameButton.click()');
  if(id!==room.host)await evaluate("__game.network.name.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))");
  for(let i=0;i<100;i++){if(await evaluate(`__game.network.state.world.name===${JSON.stringify(displayName)}&&__game.network.nameFeedback.textContent==='Name saved.'`))break;await sleep(25);}
  const namePass=editable&&draftPreserved&&await evaluate(`__game.network.state.world.name===${JSON.stringify(displayName)}&&__game.network.players.textContent.includes(${JSON.stringify(displayName)})&&!__game.network.players.querySelector('b')`);
  await evaluate(`fetch('/api/control',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer ${host.token}'},body:JSON.stringify({action:'start'})})`);
  const readyCleared=[...room.members.values()].every(player=>!player.wantsToPlay)&&room.world.phase==='countdown';
  Object.assign(room.world,{phase:'racing',supplies:[]});
  const actor=[room.world,...room.world.bots][id];
  Object.assign(actor,{wx:-65,wz:70,heading:Math.PI/2,motionHeading:Math.PI/2,cameraHeading:Math.PI/2,speed:300,vulcan:10,item:'hedgehog',missiles:0,ammo:5,turbos:1,boost:0,fireCooldown:0});
  room.world.supplies=[{id:0,version:0,wx:-65,wz:70,kind:'missile',cooldown:0}];
  if(id!==room.host)room.world.destroyed=999;
  for(let i=0;i<100;i++){if(await evaluate('__game.network.state.world.phase==="racing"&&__game.network.state.world.vulcan>9&&__game.network.state.world.missiles===1&&__game.network.state.world.turbos===1'))break;await sleep(25);}
  const pickupKeptVulcan=actor.item==='hedgehog'&&await evaluate("__game.network.state.world.item==='hedgehog'");
  await evaluate(`{
    const game=__game,render=game.network.render.bind(game.network),start=performance.now();let boosted=false,fired=false;
    game.controlsTrace=[];game.controlsDone=false;game.keys.add('arrowup');
    game.network.render=dt=>{
      const time=(performance.now()-start)/1000;let request=false;
      if(!boosted&&time>=.1){window.dispatchEvent(new KeyboardEvent('keydown',{key:'x'}));boosted=true;request=true;}
      if(!fired&&time>=.3){window.dispatchEvent(new KeyboardEvent('keydown',{key:' '}));window.dispatchEvent(new KeyboardEvent('keyup',{key:' '}));fired=true;}
      const view=render(dt);
      game.controlsTrace.push({time,dt,request,boost:view.boost,speed:view.speed,turbos:view.turbos,item:view.item,vulcanShot:view.projectiles.some(p=>p.owner===view.id&&p.vulcan),turboSelected:document.getElementById('ammo-boost').classList.contains('selected')});
      if(time>=1){game.controlsDone=true;game.network.render=render;game.keys.clear();game.network.input();}
      return view;
    };
  }`);
  for(let i=0;i<100;i++){if(await evaluate('__game.controlsDone'))break;await sleep(25);}
  const trace=await evaluate('__game.controlsTrace'),request=trace.find(frame=>frame.request);
  const turboPass=Boolean(request&&request.boost>2.4&&request.turbos===0)&&trace.every(frame=>frame.item==='hedgehog'&&!frame.turboSelected)&&trace.some(frame=>frame.vulcanShot)&&actor.turbos===0;
  const other=[room.world,...room.world.bots].find(player=>!player.inactive&&player.id!==id);
  Object.assign(actor,{wx:-65,wz:0,heading:0,motionHeading:0,cameraHeading:0,speed:0,boost:0,shield:0,chaff:2,chaffCooldown:0});
  Object.assign(other,{wx:-65,wz:-65,heading:0,motionHeading:0,cameraHeading:0,speed:0,boost:0,destroyed:0,shield:0,fireCooldown:0,item:'missile',missiles:1,vulcan:0});
  room.world.projectiles=[];room.world.chaffClouds=[];
  const shooter=room.members.get(other.id);
  app.controls(shooter,{sequence:shooter.sequence+1,keys:[],actions:[{type:'fire'}]});
  for(let i=0;i<100;i++){if(await evaluate("!document.getElementById('incoming-warning').classList.contains('hidden')"))break;await sleep(10);}
  const warning=await evaluate(`(()=>{
    const element=document.getElementById('incoming-warning'),animation=element.getAnimations()[0];
    if(animation)animation.currentTime=0;const first=getComputedStyle(element).backgroundColor;
    if(animation)animation.currentTime=600;const second=getComputedStyle(element).backgroundColor;
    return {visible:!element.classList.contains('hidden'),text:element.textContent,blinks:first!==second};
  })()`);
  await evaluate("window.dispatchEvent(new KeyboardEvent('keydown',{key:'c'}))");
  for(let i=0;i<100;i++){if(actor.chaff===1&&await evaluate("document.getElementById('incoming-warning').classList.contains('hidden')"))break;await sleep(10);}
  const warningPass=warning.visible&&warning.blinks&&warning.text.includes('INCOMING MISSILE')&&warning.text.includes('CHAFF')&&actor.chaff===1&&await evaluate("document.getElementById('incoming-warning').classList.contains('hidden')");
  Object.assign(actor,{kills:3,deaths:4});Object.assign(other,{kills:10,deaths:2});
  Object.assign(room.world,{phase:'finished',finishRank:1,finishTime:20,finishCountdown:0});
  for(let i=0;i<100;i++){if(await evaluate("!document.getElementById('match-results').classList.contains('hidden')&&document.querySelectorAll('#match-results tbody tr').length===2"))break;await sleep(25);}
  const leaderboard=await evaluate("[...document.querySelectorAll('#match-results tbody tr')].map(row=>[...row.cells].map(cell=>cell.textContent))");
  const resultsPass=JSON.stringify(leaderboard)===JSON.stringify([['1',other.name,'10','2'],['2',displayName+' · YOU','3','4']])&&await evaluate("document.querySelectorAll('#match-results tbody .you').length===1&&!document.querySelector('#match-results b')");
  return {readyPass,readyCleared,readyUI,namePass,pickupKeptVulcan,turboPass,warningPass,warning,resultsPass,leaderboard,pass:readyPass&&readyCleared&&namePass&&pickupKeptVulcan&&turboPass&&warningPass&&resultsPass,trace};
}
