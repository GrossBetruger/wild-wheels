export async function checkRoom(evaluate,app,room,id,sleep,reload){
  const wait=async predicate=>{for(let attempt=0;attempt<120;attempt++){if(await predicate())return true;await sleep(25);}return false;};
  if(room.members.size===1)app.join(room,{name:'Friend',driver:1});
  const count=room.members.size,code=room.code,host=room.host,name=id===host?'Oren 🦗':'Sam 🦗';
  const roomUrl=await evaluate(`new URL(location.href).searchParams.get('room')===${JSON.stringify(code)}`);
  await evaluate(`{const input=__game.network.name;input.value=${JSON.stringify(name)};input.dispatchEvent(new Event('input'));}`);
  await evaluate('__game.network.saveName()');
  const nameSaved=await wait(()=>evaluate(`__game.race.name===${JSON.stringify(name)}&&document.cookie.includes('wild-wheels-name=')&&!document.cookie.includes('wild-wheels-session=')`));
  await evaluate('__game.network.leaveButton.click()');
  const away=await wait(()=>evaluate("__game.network.afk&&__game.network.leaveButton.textContent==='BACK TO ARENA'&&__game.network.players.textContent.includes('AFK')"));
  const afkPass=away&&room.members.size===count&&room.host===host&&room.core.snapshot(id).afk;
  await evaluate('__game.network.leaveButton.click()');
  const back=await wait(()=>evaluate("!__game.network.afk&&__game.network.leaveButton.textContent==='AFK'"));
  Object.assign(room.world,{phase:'racing',duration:3600,supplies:[]});
  const actor=[room.world,...room.world.bots].find(actor=>actor.id===id);
  Object.assign(actor,{wx:-65,wz:0,heading:0,motionHeading:0,cameraHeading:0,speed:0,kills:3,deaths:2});app.broadcast(room);
  await wait(()=>evaluate("__game.race.phase==='racing'&&__game.race.kills===3"));
  const before=actor.wz;
  await evaluate("__game.keys.add('arrowup')");await sleep(250);await evaluate('__game.keys.clear()');await sleep(250);
  const droveBefore=actor.wz>before;
  const member=room.members.get(id);member.lastSeen=Date.now()-16000;app.step(1/60);
  const offlineRetained=member.afk&&room.members.size===count&&room.host===host;
  await reload();
  const restored=await wait(()=>evaluate(`__game.network.active&&__game.network.state.code===${JSON.stringify(code)}&&__game.network.state.you===${id}&&__game.race.name===${JSON.stringify(name)}&&!__game.network.afk`));
  const restoredUI=await evaluate("({name:__game.network.name.value,kills:__game.race.kills,deaths:__game.race.deaths,hostDisabled:__game.network.hostButton.disabled})");
  const refreshPass=restored&&room.members.size===count&&room.host===host&&restoredUI.name===name&&restoredUI.kills===3&&restoredUI.deaths===2&&restoredUI.hostDisabled===(id!==host)&&await evaluate(`new URL(location.href).searchParams.get('room')===${JSON.stringify(code)}`);
  const afterRefresh=actor.wz;
  await evaluate("__game.keys.add('arrowup')");await sleep(300);await evaluate('__game.keys.clear()');await sleep(250);
  const controlsPass=droveBefore&&actor.wz>afterRefresh;
  let replacementPass=app.rooms.size===1;
  if(id===host){
    const oldToken=member.token;
    await evaluate('__game.network.hostButton.click()');
    replacementPass &&= await wait(()=>evaluate(`__game.network.active&&__game.network.state.code!==${JSON.stringify(code)}`));
    replacementPass &&= app.rooms.size===1&&!app.rooms.has(code)&&!app.members.has(oldToken)&&app.members.size===1;
    replacementPass &&= await evaluate(`__game.network.isHost&&__game.network.name.value===${JSON.stringify(name)}&&new URL(location.href).searchParams.get('room')===__game.network.state.code`);
  }
  return {roomUrl,nameSaved,afkPass,back,offlineRetained,refreshPass,controlsPass,replacementPass,pass:roomUrl&&nameSaved&&afkPass&&back&&offlineRetained&&refreshPass&&controlsPass&&replacementPass};
}
