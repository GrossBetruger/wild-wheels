import {damageBattle,navigate,arenas} from './combat.js';
const eligible=a=>a.driver!==5&&!a.inactive&&!a.afk&&!a.bomber;
const blocked=(arena,x,z,padding=.5)=>Math.abs(x)>96-padding||Math.abs(z)>96-padding||arena.blocks.some(([bx,bz,w,d])=>Math.abs(x-bx)<w/2+padding&&Math.abs(z-bz)<d/2+padding);
const clear=(arena,a,b)=>{const d=Math.hypot(a.wx-b.wx,a.wz-b.wz);for(let t=3;t<d;t+=3)if(blocked(arena,a.wx+(b.wx-a.wx)*t/d,a.wz+(b.wz-a.wz)*t/d,.4))return false;return true;};
export function spawnLocusts(world,owner){
  world.locusts??=[];world.locustSequence??=0;
  const count=[world,...world.bots].filter(eligible).length*2,centers=[[-65,-65],[65,65],[-65,65],[65,-65],[0,78],[78,0],[0,-78],[-78,0]],offset=Math.floor(world.locustSequence/4);
  for(let i=0;i<count;i++){
    const [x,z]=centers[(offset+Math.floor(i/4))%centers.length];
    if(i%4===0)world.effects.push({type:'locustSpawn',wx:x,wz:z,age:0,life:1.2});
    world.locusts.push({id:++world.locustSequence,owner:owner.id,wx:x+(i%2-.5)*3,wz:z+(Math.floor(i/2)%2-.5)*3,heading:0,age:0,jump:0,brain:0,path:[]});
  }
}
export function tickLocusts(world,dt){
  if(world.specialAbilities===false){world.locusts=[];return;}
  const arena=arenas[world.arena],actors=[world,...world.bots],remaining=[];
  for(const bug of world.locusts??[]){
    const delta=dt*(world.timeStop>0&&world.timeOwner!==bug.owner ? .025 : 1);bug.age+=delta;
    if(bug.age<.6){remaining.push(bug);continue;}
    const target=actors.filter(a=>eligible(a)&&!a.destroyed).sort((a,b)=>Math.hypot(a.wx-bug.wx,a.wz-bug.wz)-Math.hypot(b.wx-bug.wx,b.wz-bug.wz)||a.id-b.id)[0];
    if(!target){remaining.push(bug);continue;}
    const d=Math.hypot(target.wx-bug.wx,target.wz-bug.wz),visible=clear(arena,bug,target);bug.brain=(bug.brain??0)-delta;
    if(!visible&&bug.brain<=0){bug.path=navigate(arena,bug,target);bug.brain=.4;}
    bug.path??=[];while(bug.path.length&&Math.hypot(bug.path[0].wx-bug.wx,bug.path[0].wz-bug.wz)<3)bug.path.shift();
    const point=!visible&&bug.path.length?bug.path[0]:target;
    if(bug.jump<=0&&d<14&&visible)bug.jump=.7;
    bug.heading=Math.atan2(point.wx-bug.wx,point.wz-bug.wz);
    const step=Math.min((bug.jump>0?38:22)*delta,Math.hypot(point.wx-bug.wx,point.wz-bug.wz)),x=bug.wx+Math.sin(bug.heading)*step,z=bug.wz+Math.cos(bug.heading)*step;
    if(!blocked(arena,x,z)){bug.wx=x;bug.wz=z;}bug.jump=Math.max(0,bug.jump-delta);
    if(bug.jump>0&&Math.hypot(bug.wx-target.wx,bug.wz-target.wz)<2.7){damageBattle(world,target,bug.owner,1,'locust');world.effects.push({type:'locustBurst',wx:bug.wx,wz:bug.wz,age:0,life:.7});continue;}
    remaining.push(bug);
  }
  world.locusts=remaining;
}
