import { drivers } from './engine.js';
import { standings } from './combat.js';

export function matchResults(world){
  const name=(actor,you)=>`${actor.name??drivers[actor.driver].name}${you?' · YOU':''}`;
  if(world.mode==='combat')return standings(world).map((actor,index)=>({place:index+1,name:name(actor,actor.id===world.id),you:actor.id===world.id,kills:actor.kills,deaths:actor.deaths}));
  const actors=new Map([['player',world],...world.bots.map((actor,index)=>[index,actor])]);
  const finished=new Map(world.finishOrder.map(entry=>[entry.id,entry.time]));
  const remaining=[...actors].filter(([id])=>!finished.has(id)).sort((a,b)=>b[1].s-a[1].s);
  return [...world.finishOrder.map(entry=>[entry.id,actors.get(entry.id)]),...remaining].map(([id,actor],index)=>({place:index+1,name:name(actor,id==='player'),you:id==='player',time:finished.get(id)??null}));
}
