import {drivers} from './engine.js';
import {damageBattle} from './combat.js';
export const SPECIAL_COOLDOWN=20;
export const TIME_STOP_DURATION=2.5;
export const abilityNames={7:'REINE DE LA PARESSE',5:'CRICKET’S JUMP',8:'SPECIAL RELATIVITY',9:'FASHION-STATEMENT',10:'DIZZY SMOKE',11:'HOLY AURA',13:'TAX-AUDIT',12:'SIX-HEART RECOVERY'};
export const abilityDetails={
  13:{control:'F · Activate',description:'Instantly defeats the active rival carrying the most hedgehogs, missiles, turbos and chaff, even through shields. If Fourmidable has the most (including a tie), Xylophone-Attack instead blocks every other racer’s view with giant instruments and a frantic tune for 5 seconds. Her own view stays clear.',timing:'Arena-wide · 20-second recharge'},
  5:{control:'Z · Somersault',description:'Cricket’s jump teleports Tamar to a random safe location when she somersaults.',timing:'1-second flip cooldown'},
  7:{control:'F · Activate',description:'Reine de la paresse creates a gravity well that draws available power-ups toward Houston from up to 80 units away.',timing:'8 seconds · 20-second recharge'},
  8:{control:'F · Activate',description:'Special relativity slows other racers and their projectiles to 2.5% speed. Avita-Jas and his projectiles keep their normal speed.',timing:'2.5 seconds · 20-second recharge'},
  9:{control:'F · Activate',description:'Fashion-Statement snaps above every other racer: 2 damage, or 1 damage to characters with cuteness 5.',timing:'Arena-wide · 20-second recharge'},
  10:{control:'Boost · Passive',description:'Yuda’s thick smoke trail makes other racers dizzy for 8 seconds. His own smoke does not affect him.',timing:'Smoke lingers for 3 seconds'},
  11:{control:'F · Activate',description:'Summon two archangels. Holy aura turns locked missiles back toward their shooter.',timing:'8 seconds · 20-second recharge'},
  12:{control:'F · Activate',description:'Heal one heart immediately, then one per heartbeat every second. Healing stops at 6 hearts, with up to 6 beats.',timing:'Heartbeat healing · 20-second recharge'},
};
export const carriedItems=a=>(a.ammo??0)+(a.missiles??0)+(a.turbos??0)+(a.chaff??0);
export function auditTarget(world,actor){const rivals=[world,...world.bots].filter(a=>!a.inactive&&!a.afk&&!a.bomber&&!a.destroyed).sort((a,b)=>carriedItems(b)-carriedItems(a)||a.id-b.id);return rivals.length&&carriedItems(rivals[0])>carriedItems(actor)?rivals[0]:null;}
export function fashionDamage(cuteness){return cuteness===5?1:2;}
export function frozen(world,id){return world.specialAbilities!==false&&world.timeStop>0&&world.timeOwner!==id;}
export function useSpecial(world,actor=world){
  if(world.specialAbilities===false||world.phase!=='racing'||world.finishCountdown!==null||![7,8,9,11,12,13].includes(actor.driver)||actor.specialCooldown>0||actor.destroyed>0||actor.inactive||actor.afk||actor.bomber||world.timeStop>0)return false;
  switch(actor.driver){case 13:{const victim=auditTarget(world,actor);if(!victim){actor.specialActive=5;break;}world.effects.push({type:'taxAudit',owner:actor.id,wx:victim.wx,wz:victim.wz,age:0,life:2.5});damageBattle(world,victim,actor.id,victim.health,'tax');break;}case 7:actor.specialActive=8;break;case 8:world.timeStop=TIME_STOP_DURATION;world.timeOwner=actor.id;break;case 9:actor.specialActive=1.6;for(const victim of [world,...world.bots]){if(victim.id===actor.id||victim.afk||victim.bomber||victim.inactive||victim.destroyed>0)continue;const wx=victim.wx,wz=victim.wz;world.effects.push({type:'fashionSnap',owner:actor.id,wx,wz,age:0,life:1.2});damageBattle(world,victim,actor.id,fashionDamage(drivers[victim.driver].cuteness),'fashion');}break;case 11:actor.specialActive=8;break;case 12:if(actor.health>=6)return false;actor.health=Math.min(6,actor.health+1);actor.healTimer=0;actor.specialActive=actor.health>=6?0:5;world.effects.push({type:'heartbeat',owner:actor.id,wx:actor.wx,wz:actor.wz,age:0,life:.7});break;}actor.specialCooldown=SPECIAL_COOLDOWN;return true;
}
export function restoreSupply(s){if(s.homeWx!==undefined){s.wx=s.homeWx;s.wz=s.homeWz;delete s.homeWx;delete s.homeWz;}}
export function tickSpecials(world,dt){
  if(world.specialAbilities===false){for(const s of world.supplies)restoreSupply(s);return;}
  world.timeStop=Math.max(0,(world.timeStop??0)-dt);if(!world.timeStop)world.timeOwner=null;
  const actors=[world,...world.bots];
  for(const a of actors){
    if(frozen(world,a.id))continue;
    const before=a.specialActive??0;a.specialActive=Math.max(0,before-dt);
    if(a.driver===12&&before>0){if(a.health>=6||a.destroyed||a.inactive||a.afk||a.bomber)a.specialActive=0;else if(Math.floor(6-before+1e-8)<Math.floor(6-a.specialActive+1e-8)){a.health=Math.min(6,a.health+1);a.healTimer=0;world.effects.push({type:'heartbeat',owner:a.id,wx:a.wx,wz:a.wz,age:0,life:.7});if(a.health>=6)a.specialActive=0;}}
    a.specialCooldown=Math.max(0,(a.specialCooldown??0)-dt);
    if(a.driver!==10||a.boost<=0||a.destroyed||a.inactive||a.afk||a.bomber)continue;
    const last=world.effects.findLast(f=>f.type==='yudaSmoke'&&f.owner===a.id);
    if(last&&last.age<.05&&Math.hypot(a.wx-last.wx,a.wz-last.wz)<1.5)continue;
    world.effects.push({type:'yudaSmoke',owner:a.id,wx:a.wx-Math.sin(a.heading)*2,wz:a.wz-Math.cos(a.heading)*2,age:0,life:3});
  }
  if(!world.timeStop)for(const s of world.supplies){if(s.cooldown>0)continue;const owner=actors.filter(a=>a.driver===7&&a.specialActive>0&&!a.bomber&&!a.afk&&!a.inactive&&!a.destroyed&&Math.hypot(a.wx-s.wx,a.wz-s.wz)<=80).sort((a,b)=>Math.hypot(a.wx-s.wx,a.wz-s.wz)-Math.hypot(b.wx-s.wx,b.wz-s.wz)||a.id-b.id)[0];if(!owner){restoreSupply(s);continue;}s.homeWx??=s.wx;s.homeWz??=s.wz;const d=Math.hypot(owner.wx-s.wx,owner.wz-s.wz),fraction=d?Math.min(1,55*dt/d):0;s.wx+=(owner.wx-s.wx)*fraction;s.wz+=(owner.wz-s.wz)*fraction;}
  for(const a of actors){
    if(frozen(world,a.id)||a.bomber||a.inactive||a.afk||a.destroyed||a.hedgeShield>0)continue;
    if(world.effects.some(f=>f.type==='yudaSmoke'&&f.owner!==a.id&&f.age<f.life&&Math.hypot(a.wx-f.wx,a.wz-f.wz)<4))a.dizzy=8;
  }
}
