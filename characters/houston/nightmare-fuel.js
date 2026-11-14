import {damageBattle,arenas,blocked} from '../../gameplay/combat.js';
import {frozen} from '../../gameplay/special-abilities.js';
export const NIGHTMARE_DURATION=12,NIGHTMARE_COOLDOWN=30,NIGHTMARE_LENGTH=29;
export function activateNightmare(world,actor=world){
  if(world.specialAbilities===false||world.phase!=='racing'||world.finishCountdown!==null||actor.driver!==7||actor.destroyed>0||actor.inactive||actor.afk||actor.bomber||frozen(world,actor.id)||(actor.nightmareCooldown??0)>1e-8)return false;
  actor.nightmareActive=NIGHTMARE_DURATION;actor.nightmareCooldown=NIGHTMARE_COOLDOWN;actor.boost=NIGHTMARE_DURATION;
  actor.notice='NIGHTMARE FUEL';actor.noticeTime=2.4;return true;
}
export function tapNightmare(world,actor=world){
  if(actor.driver!==7||world.specialAbilities===false)return false;
  const previous=actor.nightmareTap;delete actor.nightmareTap;
  const double=previous!==undefined&&world.elapsed>=previous&&world.elapsed-previous<=.35;
  if(!double)actor.nightmareTap=world.elapsed;
  return double&&activateNightmare(world,actor);
}
export function tickNightmare(world,dt){
  const actors=[world,...world.bots];
  if(world.specialAbilities===false){for(const actor of actors){if(actor.nightmareActive>0)actor.boost=0;actor.nightmareActive=0;}return;}
  const hits=[];
  for(const source of actors){
    if(source.driver!==7||!(source.nightmareActive>0)||source.boost<=0||source.destroyed>0||source.inactive||source.afk||frozen(world,source.id))continue;
    for(const target of actors){
      if(target.id===source.id||target.destroyed>0||target.inactive||target.afk||target.bomber)continue;
      const dx=target.wx-source.wx,dz=target.wz-source.wz,behind=-dx*Math.sin(source.heading)-dz*Math.cos(source.heading),side=Math.abs(dx*Math.cos(source.heading)-dz*Math.sin(source.heading));
      if(behind<3.5||behind>3.5+NIGHTMARE_LENGTH||side>3)continue;
      const distance=Math.hypot(dx,dz);let clear=true;
      for(let along=3;along<distance;along+=3){if(blocked(arenas[world.arena],source.wx+dx*along/distance,source.wz+dz*along/distance,.4)){clear=false;break;}}
      if(clear)hits.push([target,source.id,Math.max(target.health,1)]);
    }
  }
  for(const [target,owner,health]of hits)damageBattle(world,target,owner,health,'nightmare');
  for(const actor of actors){
    if(frozen(world,actor.id))continue;
    actor.nightmareCooldown=Math.max(0,(actor.nightmareCooldown??0)-dt);
    actor.nightmareActive=actor.destroyed>0||actor.inactive||actor.afk||actor.boost<=0?0:Math.max(0,(actor.nightmareActive??0)-dt);
  }
}

// Shared by the browser renderer and the native graphics exporter. Everything
// repeats every four seconds, the length of the native client's recorded loop.
export function drawNightmareFuel(glow,smoke,p,heading,time,jump=null,ground=null){
  const L=NIGHTMARE_LENGTH,y=1.45,z0=-3.55,height=.13+(jump?.height??0);
  for(const mesh of [glow,smoke]){mesh.at(p.x,height,p.z,heading);mesh.pitch=jump?.pitch??0;mesh.pivot=1.87;}
  const turn=time*Math.PI/2,frac=v=>v-Math.floor(v),hash=(i,k)=>frac(Math.sin(i*127.1+k*311.7)*43758.5453),flicker=time*Math.PI*27/86;
  const around=(a,r)=>[Math.cos(a)*r,Math.max(.15,y+Math.sin(a)*r*.55)];
  // The ground beneath is charred black, so the light burns against any arena.
  if(ground){
    ground.at(p.x,0,p.z,heading);
    ground.disc(0,.03,z0-L*.5,3.1,L*.55,'#2a2136',20);ground.disc(0,.04,z0-L*.48,2,L*.5,'#140d1f',20);
  }
  // The plume: a white-hot core inside magenta inside deep ultraviolet, fed by the side engines.
  const breathe=1+.03*Math.sin(turn*12);
  glow.flame(0,y,z0,1.25,L*breathe,[.13,.01,.36],flicker);
  glow.flame(0,y,z0,.72,L*.94*breathe,[.45,.03,.9],flicker+1);
  glow.flame(0,y,z0,.3,L*.86,[.85,.55,1.3],flicker+2);
  for(const side of [-.55,.55])glow.flame(side,y,z0,.34,L*.3,[.5,.12,1],flicker+side);
  // The char glows ultraviolet.
  glow.disc(0,-.06,z0-L*.5,2.7,L*.53,[.16,.01,.36]);
  glow.disc(0,-.05,z0-L*.45,1.2,L*.45,[.3,.04,.55].map(c=>c*(1+.25*Math.sin(turn*8))));
  // Shock diamonds standing in the exhaust, and pulses racing through them.
  for(let i=0;i<7;i++){
    const t=(i+.6)/7.6,pulse=1+.25*Math.sin(turn*16-i*1.3),fade=1-t*.75;
    glow.particle(0,y,z0-t*L,2.1*pulse*fade,[.22*fade,.06*fade,.5*fade]);
    glow.particle(0,y,z0-t*L,.9*pulse,[.9*fade,.7*fade,1.3*fade]);
  }
  for(let i=0;i<40;i++){
    const t=frac(i/40+time*1.5),fade=1-t;
    glow.particle(Math.sin(turn*20+i)*.2,y,z0-t*L,(1-t*.6)*.9,[.3*fade,.05*fade,.8*fade]);
  }
  // Three plasma strands wound around the plume, streaming backwards.
  const strands=[[.2,.9,1.4],[1.4,.2,.9],[.6,.3,1.5]];
  for(let strand=0;strand<3;strand++)for(let i=0;i<40;i++){
    const t=i/40,fade=(1-t)**.7,[x,up]=around(t*14-turn*8+strand*Math.PI*2/3,.9+t*1.9);
    glow.particle(x,up,z0-t*L,.5*(1-.4*t),strands[strand].map(c=>c*fade));
  }
  // Shock rings swelling as they travel down it.
  for(let ring=0;ring<4;ring++){
    const t=frac(time+ring/4),fade=(1-t)**2;
    for(let i=0;i<16;i++){const [x,up]=around(i/16*Math.PI*2+ring,.6+t*2.6);glow.particle(x,up,z0-t*L,.42,[.9*fade,.5*fade,1.6*fade]);}
  }
  // Lightning grounding out to either side, struck anew twelve times a second.
  const strike=Math.floor(time*12)%48;
  for(let arc=0;arc<3;arc++){
    const t=.1+.8*hash(strike,arc),side=hash(strike,arc+7)<.5?-1:1,reach=1.6+2*hash(strike,arc+13);
    for(let j=0;j<=8;j++){
      const s=j/8,bow=Math.sin(s*Math.PI);
      glow.particle(side*s*reach+(hash(strike*9+j,arc)-.5)*.7*bow,y-1.4*s,z0-t*L+(hash(strike*5+j,arc+3)-.5)*1.2*bow,.28+.25*(1-s),[1.2,1.1,1.6]);
    }
  }
  // Embers thrown clear, arcing up and falling behind.
  for(let i=0;i<36;i++){
    const life=frac(time*.5+hash(i,1)),t=.05+.9*hash(i,2),a=hash(i,3)*Math.PI*2,out=life*(2+3*hash(i,4)),fade=1-life;
    glow.particle(Math.cos(a)*out,Math.max(.1,y+Math.sin(life*Math.PI)*(1+2*hash(i,5))-life*1.3),z0-t*L-life*3,.3*fade+.08,[1.5*fade,.55*fade,.15*fade]);
  }
  // The engines flare where it leaves them.
  const flare=1+.2*Math.sin(turn*24);
  glow.particle(0,y,z0+.1,3.4*flare,[.3,.08,.65]);glow.particle(0,y,z0+.1,1.4*flare,[1.1,.9,1.5]);
  for(const side of [-.55,.55])glow.particle(side,y,z0+.1,1,[.8,.4,1.4]);
  // It ends in rolling dark smoke, and something in the smoke is watching.
  for(let i=0;i<16;i++){
    const life=frac(time*.5+i/16),a=hash(i,6)*Math.PI*2,r=(1+2.2*life)*hash(i,7);
    smoke.particle(Math.cos(a)*r,Math.max(.4,y+Math.sin(a)*r*.6+life*1.5),z0-(.72+.4*life)*L,(2.2+2.6*life)*Math.sqrt(Math.sin(life*Math.PI)),[.15,.04,.24]);
  }
  for(let i=0;i<3;i++){
    const open=Math.sin(turn*(2+i)+i*2.1);if(open<.15)continue;
    const x=(i-1)*1.5+Math.sin(turn*2+i)*.3,up=y+.9+.5*Math.sin(turn*3+i*1.7),z=z0-L*(.86+.05*i);
    for(const side of [-.22,.22])glow.particle(x+side,up,z,.34*Math.min(1,open*2),[1.6,.25,.35]);
  }
}
