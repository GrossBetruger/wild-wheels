export const SPECIAL_COOLDOWN=20;
export const TIME_STOP_DURATION=2.5;
export const abilityNames={5:'CRICKET’S JUMP',8:'SPECIAL RELATIVITY',10:'DIZZY SMOKE',11:'HOLY AURA',12:'SIX-HEART RECOVERY'};
export function frozen(world,id){return world.specialAbilities!==false&&world.timeStop>0&&world.timeOwner!==id;}
export function useSpecial(world,actor=world){
  if(world.specialAbilities===false||world.phase!=='racing'||world.finishCountdown!==null||actor.driver!==8||actor.specialCooldown>0||actor.destroyed>0||actor.inactive||actor.afk||actor.bomber||world.timeStop>0)return false;
  world.timeStop=TIME_STOP_DURATION;world.timeOwner=actor.id;actor.specialCooldown=SPECIAL_COOLDOWN;return true;
}
export function tickSpecials(world,dt){
  if(world.specialAbilities===false)return;
  world.timeStop=Math.max(0,(world.timeStop??0)-dt);if(!world.timeStop)world.timeOwner=null;
  const actors=[world,...world.bots];
  for(const a of actors){
    a.specialActive=a.driver===11?1:0;if(frozen(world,a.id))continue;
    a.specialCooldown=Math.max(0,(a.specialCooldown??0)-dt);
    if(a.driver!==10||a.boost<=0||a.destroyed||a.inactive||a.afk||a.bomber)continue;
    const last=world.effects.findLast(f=>f.type==='yudaSmoke'&&f.owner===a.id);
    if(last&&last.age<.05&&Math.hypot(a.wx-last.wx,a.wz-last.wz)<1.5)continue;
    world.effects.push({type:'yudaSmoke',owner:a.id,wx:a.wx-Math.sin(a.heading)*2,wz:a.wz-Math.cos(a.heading)*2,age:0,life:3});
  }
  for(const a of actors){
    if(frozen(world,a.id)||a.bomber||a.inactive||a.afk||a.destroyed||a.hedgeShield>0)continue;
    if(world.effects.some(f=>f.type==='yudaSmoke'&&f.owner!==a.id&&f.age<f.life&&Math.hypot(a.wx-f.wx,a.wz-f.wz)<4))a.dizzy=8;
  }
}
