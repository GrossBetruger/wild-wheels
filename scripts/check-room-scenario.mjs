export async function checkRoom(evaluate,app,room,id,sleep,reload,capture){
  const wait=async predicate=>{for(let attempt=0;attempt<120;attempt++){if(await predicate())return true;await sleep(25);}return false;};
  if(room.members.size===1)app.join(room,{name:'Friend',driver:1});
  const count=room.members.size,code=room.code,host=room.host,name=room.members.get(id).name==='Tamar 🦗'?'Sam 🦗':'Tamar 🦗';
  const roomUrl=await evaluate(`new URL(location.href).searchParams.get('room')===${JSON.stringify(code)}`);
  await wait(()=>evaluate(`(document.getElementById('restart').getClientRects().length>0)===${id===host}`));
  const lobby=await evaluate(`(()=>{const visible=node=>node.getClientRects().length>0;const n=__game.network;return {hostControls:[n.hostButton,n.botCount,n.animalChoice,n.share.parentElement,n.help,document.querySelector('.mode-switch'),document.querySelector('.map-switch'),document.getElementById('restart'),document.getElementById('change-track')].map(visible),playerControls:[n.name,n.leaveButton,document.getElementById('drivers'),document.getElementById('start'),document.getElementById('fullscreen')].every(visible),noSaveButton:![...n.panel.querySelectorAll('button')].some(button=>button.textContent==='SAVE NAME')};})()`);
  const lobbyPass=lobby.hostControls.every(visible=>visible===(id===host))&&lobby.playerControls&&lobby.noSaveButton;
  if(capture)await capture();
  await evaluate(`{const input=__game.network.name;input.value=${JSON.stringify(name)};input.dispatchEvent(new Event('input'));}`);
  const heldUntilStart=room.members.get(id).name!==name;
  await evaluate(`__game.network.${id===host?"control('start')":"requestPlay()"}`);
  const nameSaved=heldUntilStart&&await wait(()=>evaluate(`__game.race.name===${JSON.stringify(name)}&&document.cookie.includes('wild-wheels-name=')&&!document.cookie.includes('wild-wheels-session=')`));
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
  const liveControlsPass=id===host||await evaluate("document.getElementById('drivers').getClientRects().length===0&&document.getElementById('restart').getClientRects().length===0&&__game.network.leaveButton.getClientRects().length>0");
  return {lobbyPass,lobby,liveControlsPass,roomUrl,nameSaved,afkPass,back,offlineRetained,refreshPass,controlsPass,replacementPass,pass:lobbyPass&&liveControlsPass&&roomUrl&&nameSaved&&afkPass&&back&&offlineRetained&&refreshPass&&controlsPass&&replacementPass};
}
