import { drivers } from './engine.js';
import { standings } from './combat.js';

export function ordinal(place){const teen=place%100;if(teen>=11&&teen<=13)return 'TH';return ({1:'ST',2:'ND',3:'RD'})[place%10]??'TH';}

export function battleTieNotice(world){
  if(world.mode!=='combat'||!world.multiplayer||world.finishRank==null)return '';
  const order=standings(world);
  if(order[0]?.id!==world.host||order.length<2||order[0].kills!==order[1].kills)return '';
  return 'TIE ON POINTS · HOST WINS';
}

export function matchResults(world){
  const name=(actor,you)=>`${actor.name??drivers[actor.driver].name}${you?' · YOU':''}`;
  if(world.mode==='combat')return standings(world).map((actor,index)=>({place:index+1,name:name(actor,actor.id===world.id),you:actor.id===world.id,kills:actor.kills,deaths:actor.deaths}));
  const actors=new Map([['player',world],...world.bots.map((actor,index)=>[index,actor])]);
  const finished=new Map(world.finishOrder.map(entry=>[entry.id,entry.time]));
  const remaining=[...actors].filter(([id])=>!finished.has(id)).sort((a,b)=>b[1].s-a[1].s);
  return [...world.finishOrder.map(entry=>[entry.id,actors.get(entry.id)]),...remaining].map(([id,actor],index)=>({place:index+1,name:name(actor,id==='player'),you:id==='player',time:finished.get(id)??null}));
}
