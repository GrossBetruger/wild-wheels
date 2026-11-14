export const SUPPLY_WALL_CLEARANCE=8, SUPPLY_ACTOR_CLEARANCE=12, SUPPLY_SPACING=16;
function random(world){let state=(world.supplySeed??1)>>>0||1;state^=state<<13;state^=state>>>17;state^=state<<5;world.supplySeed=state>>>0;return world.supplySeed/4294967296;}
export function safeSupplyPosition(world,arena,index,x,z){
  if(Math.abs(x)>arena.size-8||Math.abs(z)>arena.size-8||arena.blocks.some(([bx,bz,w,d])=>Math.abs(x-bx)<w/2+8&&Math.abs(z-bz)<d/2+8))return false;
  if([world,...world.bots].some(actor=>!actor.inactive&&!actor.afk&&!actor.bomber&&!(actor.destroyed>0)&&Math.hypot(actor.wx-x,actor.wz-z)<12))return false;
  return !world.supplies.some((s,i)=>i!==index&&Math.hypot((s.homeWx??s.wx)-x,(s.homeWz??s.wz)-z)<16);
}
export function placeSupply(world,arena,index){
  const limit=arena.size-8,accept=(x,z)=>{
    if(!safeSupplyPosition(world,arena,index,x,z))return false;
    const supply=world.supplies[index];Object.assign(supply,{wx:x,wz:z,version:(supply.version??0)+1});delete supply.homeWx;delete supply.homeWz;delete supply.collector;return true;
  };
  for(let attempt=0;attempt<128;attempt++)if(accept((random(world)*2-1)*limit,(random(world)*2-1)*limit))return true;
  const cells=Math.floor(limit*2/8)+1,start=Math.floor(random(world)*cells*cells);
  for(let offset=0;offset<cells*cells;offset++){const cell=(start+offset)%(cells*cells);if(accept(-limit+(cell%cells)*8,-limit+Math.floor(cell/cells)*8))return true;}
  return false;
}
export function tickSupplySpawns(world,arena,dt){
  for(const [index,supply] of world.supplies.entries()){
    const before=supply.cooldown;supply.cooldown=Math.max(0,before-dt);
    if(dt>0&&before>0&&supply.cooldown===0&&supply.randomSpawn&&!placeSupply(world,arena,index))supply.cooldown=.25;
  }
}
