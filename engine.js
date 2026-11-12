import { trackBend, branches, chooseRoute, routeSpeedScale } from './track.js';
export const LENGTH = 18000;
export const START_HEDGEHOGS=10;
export const drivers = [
  { name: 'Pip the Panda', emoji: '🐼', color: '#8456cf', desc: 'Small paws. Big podium energy.', speed: 4, handling: 5, accel: 4, cuteness: 5, intelligence: 3, fuel: 3 },
  { name: 'Rocco the Raccoon', emoji: '🦝', color: '#df7053', desc: 'Your racing line? Consider it stolen.', speed: 5, handling: 3, accel: 4, cuteness: 3, intelligence: 5, fuel: 2 },
  { name: 'Felix the Fox', emoji: '🦊', color: '#edb84f', desc: 'Quick on the corners. Quicker with trouble.', speed: 4, handling: 4, accel: 5, cuteness: 4, intelligence: 4, fuel: 2 },
  { name: 'Benny the Bear', emoji: '🐻', color: '#67a99c', desc: 'Big bear. Tiny kart. Absolutely no brakes.', speed: 5, handling: 4, accel: 3, cuteness: 4, intelligence: 2, fuel: 3 },
  { name: 'Ellie the Elephant', emoji: '🐘', color: '#81a5bc', desc: 'Big ears. Bigger corner exits.', speed: 4, handling: 4, accel: 5, cuteness: 5, intelligence: 4, fuel: 3 },
  { name: 'Tamar the Cricket', emoji: '🦗', color: '#83b64d', desc: 'chirp chirp', speed: 3, handling: 5, accel: 5, cuteness: 5, intelligence: 3, fuel: 2 },
  { name: 'Elon Musk', emoji: '🚘', color: '#e8edf2', desc: 'New Roadster. Cold-gas thrusters. Zero chill.', speed: 5, handling: 3, accel: 5, cuteness: 1, intelligence: 4, fuel: 3 },
  { name: 'Houston the RTPL', emoji: '🦥', color: '#69a9c7', desc: 'Houston, we have ignition', speed: 2, handling: 4, accel: 2, cuteness: 5, intelligence: 5, fuel: 5 },
  { name: 'Avita-Jas', emoji: '🪱', color: '#e69d52', desc: 'Tiny worm. Trusty Cessna. Express electron delivery.', speed: 4, handling: 3, accel: 4, cuteness: 5, intelligence: 5, fuel: 3 },
  { name: 'Pearococo', emoji: '🦚', color: '#ed9fc5', desc: "If there's no bread let them eat my hedgehogs", speed: 3, handling: 5, accel: 4, cuteness: 5, intelligence: 4, fuel: 3 },
  { name: 'Master-Yuda', emoji: '😎', color: '#a87345', desc: "la vie c'est la vie", speed: 5, handling: 4, accel: 5, cuteness: 3, intelligence: 5, fuel: 3 },
  { name: 'R-yeah', emoji: '🦁', color: '#bc8e38', desc: 'Majestic mane. Black kippah. King of the JetRanger.', speed: 4, handling: 4, accel: 4, cuteness: 5, intelligence: 4, fuel: 3 },
  { name: 'Catheterpillar', emoji: '🦋', color: '#e9a1c3', desc: 'Beautiful wings. Boundless empathy. Your nurse in a tiny ambulance.', speed: 3, handling: 5, accel: 4, cuteness: 5, intelligence: 5, fuel: 3 },
  { name: 'Fourmidable', emoji: '🐜', color: '#c97c69', desc: 'Six little hands. Every decimal checked. Did I forget a receipt?', speed: 3, handling: 5, accel: 4, cuteness: 5, intelligence: 5, fuel: 2 },
];
export function boostDuration(driver){return 2+.8*(drivers[driver].fuel-1);}
export function itemCapacity(driver,kind){
  const intelligence=drivers[driver].intelligence;
  switch(kind){case 'hedgehog':return 10+2*(intelligence-1);case 'missile':case 'boost':case 'abomb':case 'stink':return intelligence+1;default:return 0;}
}
export const tracks = [
  { name: 'Sunny Side Circuit', difficulty: 'ROOKIE', desc: 'Rolling hills. Questionable shortcuts.', sky: '#afdadd', grass: '#91b96d', darkGrass: '#88ad65', mountain: '#8ea69b', curve: 1 },
  { name: 'Sunset Scramble', difficulty: 'WILD', desc: 'Golden skies. A few sharper surprises.', sky: '#e9b6b0', grass: '#b2a574', darkGrass: '#a89a69', mountain: '#ad8fa0', curve: 1.5 },
];
export function curveAt(s, track = 0, route = 0) { return trackBend(s/LENGTH,route) * tracks[track].curve; }
export function pickupType(row,lane){if(lane===0)return 'boost';if(lane>0&&row%2===0)return 'missile';return 'hedgehog';}
export function selectItem(r,item){if(r.phase==='finished')return;const count={hedgehog:r.vulcan>0?1:r.ammo,missile:r.missiles}[item];if(count>0)r.item=item;}
export function cycleItem(r){const items=['hedgehog','missile'].filter(item=>({hedgehog:r.vulcan>0?1:r.ammo,missile:r.missiles}[item])>0);if(items.length)selectItem(r,items[(items.indexOf(r.item)+1)%items.length]);}
export function createRace(driver = 0, track = 0, random = Math.random) {
  // Two front-runners, a competitive midfield and one less consistent driver.
  // Shuffle the tiers so the same character does not always win.
  const skills = [[.94,1],[.86,.93],[.70,.83],[.53,.68],[.35,.51]].map(([low,high])=>low+random()*(high-low));
  for(let i=skills.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[skills[i],skills[j]]=[skills[j],skills[i]];}
  return { phase: 'ready', driver, track, s: 0, x: 0, vx:0, yaw:0, spin:0, shake:0, celebrate:0, events:[], voices:[], effects:[], skids:[], ammo:START_HEDGEHOGS, missiles:0, turbos:0, speed: 0, elapsed: 0, countdown: 3, item: 'hedgehog', boost: 0, drift: 0, wasDrifting: false, stun: 0, pickup: -1, notice: '', noticeTime: 0, rank: 6, finishRank: null, finishTime:null, finishOrder:[], finishCountdown:null, winner:null,
    bots: Array.from({ length: 5 }, (_, i) => ({ s: 140 + i * 170, x: [-.62, .55, -.35, .65, 0][i], vx:0, spin:0, cooldown:0, speed:0, skill:skills[i], laneBias:(random()-.5)*.9, rhythm:random()*Math.PI*2, reaction:.12+(1-skills[i])*.65, decisionIn:0, targetLane:[-.62,.55,-.35,.65,0][i], yaw:0, boost:0, boostCooldown:0, turbo:0, drift:0, driftCooldown:0, pickup:-1, color: ['#edb84f', '#df7053', '#67a99c', '#db8daf', '#777cbb'][i], driver: (i + 1) % drivers.length, stun: 0, finished: false })), projectiles: [] };
}
export function notify(r, text) { r.notice = text; r.noticeTime = 2; }
function effect(r,type,s=r.s,x=r.x,route=r.route){r.events.push(type);r.effects.push({type,s,x,route,age:0,life:type==='explosion'?2.5:type==='hit'?1.1:.65});}
function animalCall(r,kart,cue){
  const important=cue==='win'||cue==='lap',distance=Math.abs(((kart.s-r.s+LENGTH*1.5)%LENGTH)-LENGTH/2);
  if(kart!==r&&distance>1400&&cue!=='win')return;
  if(!important&&(kart.voiceCooldown??0)>0)return;
  kart.voiceCooldown=important?2:1.5;
  r.voices.push({driver:kart.driver,cue,pan:kart===r?0:Math.max(-.8,Math.min(.8,(kart.x-r.x)*.65)),volume:kart===r?1:Math.max(.35,.8-distance/2200)});
}
export function useTurbo(r){
  if(r.phase!=='racing'||r.finishCountdown!==null||r.destroyed>0||r.turbos<=0||r.boost>0)return false;
  r.turbos--;r.boost=boostDuration(r.driver);effect(r,'boost');notify(r,'AFTERBURNERS ENGAGED!');return true;
}
export function useItem(r) {
  if (r.phase !== 'racing' || !r.item) return;
  switch (r.item) {
    case 'hedgehog': if(r.ammo<=0)return;r.projectiles.push({ kind:'hedgehog',route:r.route,s: r.s + 100, x: r.x, vx:r.vx*.3, speed:1300+r.speed*.4, height:1.3, vy:4, bounces:0, life:4, trail:[] }); r.ammo--; effect(r,'fire'); notify(r, 'HEDGEHOG AWAY!'); break;
    case 'missile': {
      if(r.missiles<=0)return;
      const candidates=r.bots.map((bot,i)=>({i,gap:((bot.s-r.s)%LENGTH+LENGTH)%LENGTH})).filter(({i,gap})=>!r.bots[i].destroyed&&(r.bots[i].route||0)===(r.route||0)&&gap>80&&gap<4500).sort((a,b)=>a.gap-b.gap);
      r.projectiles.push({kind:'missile',route:r.route,s:r.s+85,x:r.x,speed:900,height:1.6,life:5,trail:[],target:candidates[0]?.i??null});r.missiles--;effect(r,'missile');notify(r,candidates.length?'MISSILE LOCKED · FOX THREE!':'MISSILE AWAY!');break;
    }
  }
  const remaining={hedgehog:r.ammo,missile:r.missiles}[r.item];
  if(remaining>0)return;
  r.item = r.missiles>0?'missile':r.ammo>0?'hedgehog':null;
}
function explodeMissile(r,shot){
  shot.life=0;effect(r,'explosion',shot.s,shot.x,shot.route);let destroyed=0;
  for(const bot of r.bots){
    const gap=((bot.s-shot.s+LENGTH*1.5)%LENGTH)-LENGTH/2;
    if((bot.route||0)!==(shot.route||0)||bot.destroyed>0||Math.abs(gap)>180||Math.abs(bot.x-shot.x)>.42)continue;
    animalCall(r,bot,'hurt');bot.destroyed=4;bot.speed=0;bot.vx=0;bot.boost=0;bot.turbo=0;bot.drift=0;bot.spin=0;bot.stun=0;destroyed++;
  }
  if(destroyed){r.shake=.8;r.celebrate=1.6;animalCall(r,r,'cheer');notify(r,destroyed>1?`DOUBLE TROUBLE · ${destroyed} KARTS WRECKED!`:'KART DESTROYED!');}
}
function driveOpponent(r, bot, dt) {
  if(bot.destroyed>0){bot.destroyed=Math.max(0,bot.destroyed-dt);bot.speed=0;if(bot.destroyed===0){bot.x=bot.x<0?-.8:.8;bot.cooldown=1;effect(r,'respawn',bot.s,bot.x,bot.route);}return;}
  const skill=bot.skill,driver=drivers[bot.driver],bend=curveAt(bot.s+180,r.track,bot.route),corner=Math.abs(bend);
  bot.boost=Math.max(0,bot.boost-dt);bot.boostCooldown=Math.max(0,bot.boostCooldown-dt);bot.driftCooldown=Math.max(0,bot.driftCooldown-dt);bot.decisionIn-=dt;
  if(bot.decisionIn<=0){
    bot.decisionIn=bot.reaction;
    const nextRow=Math.floor((bot.s-1000)/1800)+1,toPickup=nextRow*1800+1000-bot.s;
    const wobble=Math.sin(r.elapsed*.8+bot.rhythm)*(1-skill)*.28;
    bot.targetLane=Math.sign(bend)*Math.min(.35,corner*.25)+bot.laneBias*(1-skill)+wobble;
    // Good racers plan early enough to line up with the yellow turbo cells.
    if(toPickup<(260+skill*450)&&nextRow>=0)bot.targetLane=bot.laneBias*(1-skill)*1.5+wobble;
    const traffic=[...r.bots.filter(b=>b!==bot&&!b.destroyed),r].find(other=>other.s>bot.s&&other.s-bot.s<130+skill*180&&Math.abs(other.x-bot.x)<.28);
    if(traffic)bot.targetLane=Math.max(-.8,Math.min(.8,traffic.x+(bot.x>=traffic.x?.4:-.4)));
    for(const branch of branches){const distance=(Math.floor(bot.s/LENGTH)+branch.start)*LENGTH-bot.s;if(distance>0&&distance<450&&bot.laneBias*branch.side>0)bot.targetLane=branch.side*.65;}
  }
  if(bot.stun>0){bot.speed=Math.min(bot.speed,130);bot.boost=0;bot.drift=0;}
  if(bot.stun<=0){
    const targetVelocity=Math.max(-1.4,Math.min(1.4,(bot.targetLane-bot.x)*(1.8+skill*2)));
    bot.vx+=(targetVelocity-bot.vx)*Math.min(1,dt*(2+skill*4));
    if(skill>.65&&corner>.30&&bot.speed>300&&bot.driftCooldown===0)bot.drift+=dt;
    if(corner<.22&&bot.drift>0){if(bot.drift>.7&&bot.boostCooldown===0){bot.boost=1.2;bot.boostCooldown=2.4+(1-skill)*10;bot.driftCooldown=4;}bot.drift=0;}
    if(bot.turbo>0&&corner<.65&&bot.boostCooldown===0){bot.boost=bot.turbo;bot.boostCooldown=bot.boost+1.2+(1-skill)*10;bot.turbo=0;}
    const topSpeed=(555+driver.speed*12)*(.84+.16*skill);
    const cornerLoss=Math.min(.9,corner)*(1-skill)*110;
    const hesitation=Math.max(0,Math.sin(r.elapsed*.53+bot.rhythm)-.7)*(1-skill)*190;
    const targetSpeed=bot.boost>0?850:topSpeed-cornerLoss-hesitation;
    const acceleration=(160+driver.accel*22)*(.7+.3*skill)+(bot.boost>0?650:0);
    bot.speed=Math.max(0,bot.speed+Math.max(-350*dt,Math.min(acceleration*dt,targetSpeed-bot.speed)));
  }
  bot.yaw+=(bot.vx*.24-bot.yaw)*Math.min(1,dt*6);
  const before=bot.s;
  bot.s+=bot.speed*dt*routeSpeedScale(bot.s/LENGTH,bot.route);chooseRoute(bot,before,LENGTH);
  const row=Math.floor((bot.s-1000)/1800),rowS=row*1800+1000;
  if(row>=0&&row!==bot.pickup&&before<=rowS&&bot.s>=rowS&&Math.abs(bot.x)<.23){bot.pickup=row;bot.turbo=boostDuration(bot.driver);}
  if(bot.s>=LENGTH*3)bot.finished=true;
}
export function tick(r, keys, dt) {
  dt = Math.min(.05, Math.max(0, dt));
  if (!['countdown', 'racing'].includes(r.phase)) return;
  if (r.phase === 'countdown') { r.countdown -= dt; if (r.countdown <= 0) { r.phase = 'racing'; notify(r, 'GO, GO, GO!'); } return; }
  const racers=[r,...r.bots],previous=racers.map(k=>k.s);
  for(const kart of racers)kart.voiceCooldown=Math.max(0,(kart.voiceCooldown??0)-dt);
  const alreadyFinished=r.finishRank!==null;
  if(alreadyFinished)dt=Math.min(dt,r.finishCountdown);
  r.elapsed += dt;
  r.celebrate=Math.max(0,r.celebrate-dt);
  r.shake=Math.max(0,r.shake-dt*2);r.spin*=Math.exp(-dt*3);
  for(const fx of r.effects)fx.age+=dt;
  r.effects=r.effects.filter(fx=>fx.age<fx.life);
  r.skids=r.skids.filter(s=>r.elapsed-s.time<8);
  r.noticeTime = Math.max(0, r.noticeTime - dt);
  r.boost = Math.max(0, r.boost - dt); r.stun = Math.max(0, r.stun - dt);
  const driver = drivers[r.driver];
  const throttle = keys.has('arrowup') || keys.has('w');
  const brake = keys.has('arrowdown') || keys.has('s');
  const steering = keys.steer ?? (Number(keys.has('arrowright') || keys.has('d')) - Number(keys.has('arrowleft') || keys.has('a')));
  const drifting = keys.has('shift') && steering !== 0 && r.speed > 180;
  r.speed += (throttle ? 160 + driver.accel * 22 : -100) * dt;
  if (brake) r.speed -= 370 * dt;
  const offroad = Math.abs(r.x) > 1;
  const maxSpeed = r.boost > 0 ? 850 : 555 + driver.speed * 12;
  r.speed = Math.max(0, Math.min(maxSpeed, r.speed));
  if (r.boost > 0) r.speed = Math.min(maxSpeed, r.speed + 650 * dt);
  if (offroad && r.speed > 240) r.speed = Math.max(240, r.speed - 430 * dt);
  if (r.stun > 0) r.speed = Math.min(r.speed, 190);
  const grip=drifting?2.5:7;
  const target=steering*(1.05+driver.handling*.07)*Math.min(1,r.speed/260);
  r.vx+=(target-r.vx)*Math.min(1,dt*grip);
  r.vx-=curveAt(r.s,r.track,r.route)*r.speed/620*dt*(drifting?.7:1.4);
  r.x+=r.vx*dt;
  r.yaw+=(steering*(drifting?.55:.23)-r.yaw)*Math.min(1,dt*7);
  if(Math.abs(r.x)>1.22){const side=Math.sign(r.x);r.x=side*1.22;r.vx=-side*Math.max(.9,Math.abs(r.vx)*.65);r.speed*=.68;r.shake=.5;r.spin=-side*.6;effect(r,'crash');animalCall(r,r,'hurt');notify(r,'BARRIER HIT!');}
  if (drifting) r.drift += dt;
  if (!drifting && r.wasDrifting) { if (r.drift > .7) { r.boost = 1.2; effect(r,'boost'); notify(r, 'NICE DRIFT! + TURBO'); } r.drift = 0; }
  r.wasDrifting = drifting;
  if(drifting||brake&&r.speed>180)r.skids.push({s:r.s,x:r.x,route:r.route,time:r.elapsed});
  const before = r.s;
  r.s += r.speed * dt*routeSpeedScale(r.s/LENGTH,r.route);chooseRoute(r,before,LENGTH);
  for (const bot of r.bots) {
    bot.stun = Math.max(0, bot.stun - dt);
    bot.cooldown=Math.max(0,bot.cooldown-dt);bot.spin*=Math.exp(-dt*1.2);
    bot.x+=bot.vx*dt;bot.vx*=Math.exp(-dt*3);bot.x=Math.max(-1.05,Math.min(1.05,bot.x));
    driveOpponent(r,bot,dt);
    const gap = ((bot.s - r.s + LENGTH * 1.5) % LENGTH) - LENGTH / 2;
    if ((bot.route||0)===(r.route||0)&&!bot.destroyed&&Math.abs(gap) < 65 && Math.abs(bot.x - r.x) < .19 && bot.cooldown<=0) {
      const side=Math.sign(r.x-bot.x)||1,impact=Math.max(.7,Math.abs(r.speed-bot.speed)/220);
      r.vx=side*impact;bot.vx=-side*impact;r.x+=side*.07;bot.x-=side*.07;r.speed*=.77;bot.stun=.4;bot.cooldown=.85;r.shake=.45;r.spin=side*.4;effect(r,'crash');animalCall(r,r,'hurt');animalCall(r,bot,'hurt');notify(r,'KART CONTACT!');
    }
  }
  // Pickup geometry and gameplay use the same type mapping.
  const row = Math.floor((r.s - 1000) / 1800);
  const rowS = row * 1800 + 1000;
  if (row >= 0 && before <= rowS && r.s >= rowS && row !== r.pickup && [-.65, 0, .65].some(x => Math.abs(x - r.x) < .23)) {
    r.pickup = row; const lane=[-.65,0,.65].find(x=>Math.abs(x-r.x)<.23),kind=pickupType(row,lane);if(kind!=='boost')r.item=kind;
    switch(kind){case 'hedgehog':r.ammo=Math.min(itemCapacity(r.driver,'hedgehog'),r.ammo+3);notify(r,'+3 HEDGEHOGS · SPACE TO FIRE');break;case 'boost':r.turbos=Math.min(itemCapacity(r.driver,'boost'),r.turbos+1);notify(r,'TURBO CELL · X TO BOOST');break;case 'missile':r.missiles=Math.min(itemCapacity(r.driver,'missile'),r.missiles+1);notify(r,'MISSILE ARMED · SPACE TO DESTROY');break;}effect(r,'pickup');
  }
  for (const shot of r.projectiles) {
    const previous=shot.s;shot.trail.push({s:shot.s,x:shot.x,height:shot.height,route:shot.route});if(shot.trail.length>(shot.kind==='missile'?30:12))shot.trail.shift();
    if(shot.kind==='missile'){
      const target=r.bots[shot.target];
      if(target&&!target.destroyed){shot.x+=Math.max(-1.4*dt,Math.min(1.4*dt,target.x-shot.x));}
      shot.speed=Math.min(2200,shot.speed+1600*dt);shot.s+=shot.speed*dt*routeSpeedScale(shot.s/LENGTH,shot.route);chooseRoute(shot,previous,LENGTH);shot.height=1.6+Math.sin(shot.s*.015)*.12;shot.life-=dt;
      const hit=r.bots.some(bot=>{const gap=((bot.s-previous)%LENGTH+LENGTH)%LENGTH;return !bot.destroyed&&(bot.route||0)===(shot.route||0)&&gap<=shot.s-previous+65&&Math.abs(bot.x-shot.x)<.25;});
      if(hit||shot.life<=0)explodeMissile(r,shot);
      continue;
    }
    shot.s += shot.speed * dt*routeSpeedScale(shot.s/LENGTH,shot.route);chooseRoute(shot,previous,LENGTH);shot.x+=shot.vx*dt;shot.vy-=18*dt;shot.height+=shot.vy*dt;shot.life -= dt;
    if(shot.height<.5){shot.height=.5;shot.vy=Math.abs(shot.vy)*.65;shot.bounces++;}
    if(Math.abs(shot.x)>1.15){shot.x=Math.sign(shot.x)*1.15;shot.vx*=-.8;}
    for (const bot of r.bots) { if ((bot.route||0)===(shot.route||0)&&!bot.destroyed&&bot.s>=previous-80&&bot.s<=shot.s+80 && Math.abs(bot.x - shot.x) < .22 && shot.height<4 && shot.life > 0) { bot.stun = 3;bot.spin=Math.PI*5;bot.vx=(Math.sign(bot.x-shot.x)||1)*1.3;shot.life = 0;r.celebrate=1.6;effect(r,'hit',bot.s,bot.x,bot.route);animalCall(r,r,'cheer');animalCall(r,bot,'hurt');notify(r, 'DIRECT HIT!'); } }
  }
  r.projectiles = r.projectiles.filter(p => p.life > 0);
  for(let i=0;i<racers.length;i++){
    const kart=racers[i],lap=Math.floor(kart.s/LENGTH);
    if(!kart.destroyed&&lap>Math.floor(previous[i]/LENGTH)&&lap<3)animalCall(r,kart,'lap');
    for(let j=i+1;j<racers.length;j++){
      const other=racers[j];if(kart.destroyed||other.destroyed)continue;
      const beforeGap=((previous[i]-previous[j]+LENGTH*1.5)%LENGTH)-LENGTH/2,gap=((kart.s-other.s+LENGTH*1.5)%LENGTH)-LENGTH/2;
      if(Math.abs(beforeGap)>100||Math.abs(gap)>100)continue;
      if(beforeGap<=0&&gap>0)animalCall(r,kart,'pass');
      if(beforeGap>=0&&gap<0)animalCall(r,other,'pass');
    }
  }
  // Record every crossing once. Later overtakes cannot rewrite a finishing position.
  const finish=LENGTH*3;
  const crossings=racers.map((kart,i)=>({id:i===0?'player':i-1,fraction:kart.s>=finish?Math.max(0,(finish-previous[i])/(kart.s-previous[i]||1)):Infinity}))
    .filter(c=>c.fraction!==Infinity&&!r.finishOrder.some(entry=>entry.id===c.id)).sort((a,b)=>a.fraction-b.fraction);
  for(const crossing of crossings){
    const time=r.elapsed-dt*(1-crossing.fraction);
    r.finishOrder.push({id:crossing.id,time});
    r.winner=r.finishOrder[0].id;
    if(r.finishOrder.length===1)animalCall(r,crossing.id==='player'?r:r.bots[crossing.id],'win');
    if(crossing.id!=='player')continue;
    r.finishRank=r.finishOrder.length;r.finishTime=time;r.finishCountdown=3;r.noticeTime=0;
    r.events.push(r.finishRank===1?'victory':'finish');
  }
  r.rank=r.finishRank??(1+r.bots.filter((b,i)=>b.s>r.s||r.finishOrder.some(entry=>entry.id===i)).length);
  if(!alreadyFinished)return;
  r.finishCountdown=Math.max(0,r.finishCountdown-dt);
  if(r.finishCountdown>1e-8)return;
  r.finishCountdown=0;r.phase='finished';r.wasDrifting=false;r.shake=0;r.celebrate=0;r.noticeTime=0;
  for(const kart of racers){kart.speed=0;kart.vx=0;kart.boost=0;kart.drift=0;kart.spin=0;}
}
