import {botSightRadius} from './dark-humor.js';
export const BAT_NAME="BatYouDidn'tKnow";
function blocked(arena,x,z,padding=.4){return Math.abs(x)>arena.size-padding||Math.abs(z)>arena.size-padding||arena.blocks.some(([bx,bz,w,d])=>Math.abs(x-bx)<w/2+padding&&Math.abs(z-bz)<d/2+padding);}
function clear(arena,a,b){const d=Math.hypot(a.wx-b.wx,a.wz-b.wz);for(let t=0;t<=d;t+=1)if(blocked(arena,a.wx+(b.wx-a.wx)*t/(d||1),a.wz+(b.wz-a.wz)*t/(d||1)))return false;return true;}
export function batOrigin(actor,arena){
  for(const side of [4,-4,2,-2]){const p={wx:actor.wx+Math.cos(actor.heading)*side,wz:actor.wz-Math.sin(actor.heading)*side};if(!blocked(arena,p.wx,p.wz,.8)&&clear(arena,actor,p))return p;}
  return {wx:actor.wx,wz:actor.wz};
}
export function batAim(world,actor,arena){
  const origin=batOrigin(actor,arena),radius=Math.min(100,botSightRadius(world,actor));
  const target=[world,...world.bots].filter(a=>a.id!==actor.id&&!a.bomber&&!a.inactive&&!a.afk&&!a.destroyed&&a.shield<=0&&a.hedgeShield<=0&&Math.hypot(a.wx-actor.wx,a.wz-actor.wz)<=radius&&clear(arena,origin,a)).sort((a,b)=>Math.hypot(a.wx-origin.wx,a.wz-origin.wz)-Math.hypot(b.wx-origin.wx,b.wz-origin.wz)||a.id-b.id)[0];
  if(!target)return {origin,heading:actor.heading,target:null};
  const lead=Math.min(.8,Math.hypot(target.wx-origin.wx,target.wz-origin.wz)/125),motion=target.motionHeading??target.heading,speed=(target.speed??0)*.085;
  const heading=Math.atan2(target.wx+Math.sin(motion)*speed*lead-origin.wx,target.wz+Math.cos(motion)*speed*lead-origin.wz);
  return {origin,heading,target};
}
export function drawBat(m,phase,firing){
  const plum='#47334f',membrane='#775077',bone='#b488a8',flap=Math.sin(phase*Math.PI/8);
  m.ball(0,.5,0,.48,.65,.33,plum,12,8);m.ball(0,1.2,.08,.55,.47,.38,plum,14,8);
  for(const side of [-1,1]){
    m.cone(side*.35,1.4,0,.23,.9,plum,9);m.cone(side*.35,1.43,.11,.13,.64,'#c38c9b',8);
    m.ball(side*.23,1.25,.4,.18,.2,.07,'#f5d77b',10,6);m.ball(side*.21,1.25,.46,.075,.12,.03,'#202d3d',8,5);m.ball(side*.18,1.32,.49,.035,.04,.02,'#ffffff',6,4);
    const root=[side*.33,.85,-.05],wrist=[side*1.25,1.25+flap*.4,-.1];
    for(let i=0;i<5;i++){
      const tip=[side*(1.6+Math.sin(i*.55)*.55),.65-i*.32+flap*.65,-.12-i*.18],next=[side*(1.6+Math.sin((i+1)*.55)*.55),.65-(i+1)*.32+flap*.65,-.12-(i+1)*.18];
      m.tri(root,wrist,tip,membrane);if(i<4){const scallop=tip.map((v,j)=>(v+next[j])*.5+(root[j]-(v+next[j])*.5)*.24);m.tri(root,tip,scallop,membrane);m.tri(root,scallop,next,membrane);}
      m.quad([wrist[0]-.035,wrist[1],wrist[2]],[wrist[0]+.035,wrist[1],wrist[2]],[tip[0]+.035,tip[1],tip[2]],[tip[0]-.035,tip[1],tip[2]],bone);
    }
    m.ball(side*.23,-.1,.12,.12,.35,.12,plum,8,5);m.box(side*.23,-.35,.33,.2,.11,.25,'#d2b57d');
    m.cone(side*.12,.93,.43,.065,-.18,'#fff7df',7);
  }
  m.ball(0,1.08,.47,.17,.09,.07,'#c48f9d',8,5);m.box(0,.9,.4,.28,.035,.025,'#e7d8d6');
  m.box(0,.25,.28,.85,.1,.18,'#a34f69');m.tri([.35,.3,.1],[1.15,.22,-.4],[.8,-.1,-.3],'#a34f69');
  // The gun hangs from his feet and rotates with the bat's aim.
  m.box(0,-.52,.45,.78,.4,1.1,'#303a4e');m.ball(0,-.3,.85,.36,.3,.18,'#7e8a9c',10,6);
  for(let i=0;i<6;i++){const a=phase*Math.PI/8+i*Math.PI/3,x=Math.sin(a)*.23,y=-.3+Math.cos(a)*.23;m.box(x,y,1.5,.12,.12,1.3,'#b7c4cd');m.ball(x,y,2.16,.075,.075,.035,'#202638',6,4);}
  if(firing){m.cone(0,-.42,2.4,.25,.5,'#ffe5a0',7);m.ball(0,-.3,2.4,.25,.2,.45,'#ffbd66',8,5);}
}
