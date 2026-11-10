import { arenas, somersaultPose } from './combat.js';
import { drivers } from './engine.js';

function visibleBody(arena,eye,actor,height){
  const distance=Math.hypot(actor.wx-eye[0],actor.wz-eye[2]);
  for(let step=1;step<distance;step+=2){
    const t=step/distance,x=eye[0]+(actor.wx-eye[0])*t,z=eye[2]+(actor.wz-eye[2])*t,y=eye[1]+(height-eye[1])*t;
    if(y<6&&arena.blocks.some(([bx,bz,w,d])=>Math.abs(x-bx)<w/2&&Math.abs(z-bz)<d/2))return false;
    if(y<5&&(Math.abs(x)>96||Math.abs(z)>96))return false;
  }
  return true;
}
export function kartNameplates(world,matrix,eye){
  if(world.mode!=='combat'||!['racing','paused'].includes(world.phase))return [];
  const labels=[];
  for(const actor of world.bots){
    if(actor.bomber||actor.destroyed||actor.inactive||!world.bomber&&Math.hypot(actor.wx-world.wx,actor.wz-world.wz)<28)continue;
    const jump=somersaultPose(actor)?.height??0;
    if(!visibleBody(arenas[world.arena],eye,actor,2+jump))continue;
    const point=[actor.wx,7.2+jump,actor.wz,1],clip=[0,1,2,3].map(row=>point.reduce((sum,value,column)=>sum+matrix[column*4+row]*value,0));
    if(clip[3]<=0||Math.abs(clip[0])>clip[3]||Math.abs(clip[1])>clip[3]||Math.abs(clip[2])>clip[3])continue;
    labels.push({id:actor.id,name:actor.name??drivers[actor.driver].name,color:actor.color??drivers[actor.driver].color,x:(clip[0]/clip[3]+1)*50,y:(1-clip[1]/clip[3])*50});
  }
  return labels;
}
