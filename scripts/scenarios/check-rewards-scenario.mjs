export async function checkRewards(evaluate,app,room,id,sleep,capture){
  const wait=async(predicate,message)=>{for(let i=0;i<100;i++){if(await predicate())return;await sleep(50);}throw new Error(message);};
  await evaluate('__game.network.chooseDriver(1)');
  await wait(()=>evaluate('__game.race.driver===1'),'Intelligence-five character did not arrive');
  Object.assign(room.world,{phase:'racing',supplies:[],duration:3600});
  const actor=[room.world,...room.world.bots].find(a=>a.id===id);
  Object.assign(actor,{wx:65,wz:0,speed:0,health:3,intelligenceBonus:0,bicyclesStolen:0});app.broadcast(room);
  await wait(()=>evaluate('__game.race.phase==="racing"&&__game.race.intelligenceBonus===0'),'Reward baseline was not ready');
  room.world.supplies=[{id:1001,kind:'bicycle',owner:id===0?1:0,age:1.2,wx:65,wz:0,cooldown:0,version:0}];
  await wait(()=>evaluate('!document.getElementById("reward-notice").classList.contains("hidden")&&document.getElementById("reward-notice").getAttribute("aria-label").includes("5 to 6")'),'Bicycle did not announce intelligence five to six');
  const start=await evaluate('getComputedStyle(document.querySelector(".reward-roll")).transform');await sleep(600);
  const rolling=await evaluate('getComputedStyle(document.querySelector(".reward-roll")).transform');
  if(start===rolling)throw new Error('Intelligence counter did not visibly roll');
  await sleep(600);if(capture)await capture();
  if(actor.bicyclesStolen!==1)throw new Error('The stolen bicycle was not counted once');
  await sleep(2100);
  if(!await evaluate('document.getElementById("reward-notice").classList.contains("hidden")'))throw new Error('The confirmed pickup replayed its animation');
  room.world.supplies=[{id:1002,kind:'bicycle',owner:id,age:1.2,wx:65,wz:0,cooldown:0,version:0}];
  await wait(()=>evaluate('document.getElementById("reward-notice").getAttribute("aria-label").includes("6 to 7")'),'Second bicycle did not tick intelligence to seven');
  if(actor.bicyclesStolen!==1)throw new Error('Recovering your own bicycle counted as theft');
  Object.assign(room.world,{phase:'finished',finishRank:1,finishTime:room.world.elapsed,finishCountdown:0});app.broadcast(room);
  await wait(()=>evaluate('!document.getElementById("bicycle-results").classList.contains("hidden")&&document.querySelector("#bicycle-results tr td:last-child")?.textContent==="1"'),'Final results did not list the bicycle thief');
  const table=await evaluate('document.getElementById("bicycle-results").textContent');actor.bicyclesStolen=0;app.broadcast(room);
  await wait(()=>evaluate('document.getElementById("bicycle-results").classList.contains("hidden")'),'Empty theft results were shown');
  return {fiveToSix:true,animatedCounter:true,secondPickup:true,noReplay:true,stolenCount:1,ownBicycleExcluded:true,results:table,emptyResultsHidden:true,pass:true};
}
