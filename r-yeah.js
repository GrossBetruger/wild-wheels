const gold='#e2af50',mane='#8f5029',cream='#fff0c9',navy='#243d62';
function strut(m,a,b,r,color){const n=Math.max(2,Math.ceil(Math.hypot(...a.map((v,i)=>v-b[i]))/.2));for(let i=0;i<=n;i++)m.ball(...a.map((v,j)=>v+(b[j]-v)*i/n),r,r,r,color,6,4);}
export function drawJetRanger(m,color){
  // JetRanger silhouette: paired skids, rounded cabin, slim boom and two rotors.
  for(const side of [-1,1]){
    m.ball(side*1.65,.45,-.25,.12,.12,3,navy,10,5);
    strut(m,[side*1.65,.45,2.55],[side*1.65,.8,2.9],.12,navy);
    for(const z of [-1.4,1.2])strut(m,[side*1.65,.5,z],[side*.9,1.6,z],.09,'#cad8dc');
  }
  m.ball(0,1.75,-.15,1.42,.72,2.4,cream,16,8);
  m.ball(0,1.8,1.65,1.2,.45,.8,color,12,6);
  m.ball(0,2.75,-1.3,1.18,.7,1.02,color,12,7);
  for(const side of [-1,1]){
    m.box(side*1.25,2.1,-.35,.1,.16,2.75,gold);
    m.box(side*1.02,2.7,-1.9,.13,.45,.85,'#172e43');
    for(let i=0;i<4;i++)m.box(side*1.18,2.2+i*.12,-1.1,.04,.045,.65,navy);
    // Thin window frames surround a completely open forward cockpit.
    strut(m,[side*1.2,2.1,1.4],[side*1.13,3.65,.65],.055,cream);
    strut(m,[side*1.13,3.65,.65],[side*.95,3.85,-1],.055,cream);
  }
  m.box(0,2.08,1.4,1.9,.3,.3,navy);m.ball(-.4,2.25,1.25,.16,.13,.06,'#8fe7d1',7,4);
  m.ball(0,3.6,-1.05,.88,.48,1.05,cream,12,6);
  m.ball(0,3.7,-1.85,.35,.2,.45,'#54616e',9,5);
  strut(m,[0,2.4,-2],[0,3.05,-6.2],.22,color);
  m.tri([0,2.8,-6.3],[0,4.3,-6.1],[0,3.1,-5.35],color);
  m.box(0,3.05,-5.3,2.6,.1,.6,cream);
  m.ball(0,3.8,-6.1,.15,.15,.13,gold,8,5);
  m.box(0,4,-.2,.13,2.2,.13,'#b9cbd1');
}
export function drawLionPilot(m,phase=0,cheer=false){
  m.ball(0,2.6,.2,.7,.8,.6,gold,12,7);
  for(const side of [-1,1]){
    m.ball(side*.5,2.04,.9,.32,.28,.48,gold,9,5);
    const raised=side>0?Math.max(0,Math.sin(phase*Math.PI/4)):0;
    strut(m,[side*.6,2.8,.3],[side*(.75+raised*.3),2.5+raised*1.3,1.15-raised*.4],.2,gold);
    m.ball(side*(.75+raised*.3),2.5+raised*1.3,1.15-raised*.4,.27,.26,.24,gold,9,5);
  }
  // Oversized mane and head sit above the cabin, visible from the chase camera.
  for(let i=0;i<18;i++){const a=i*Math.PI/9;m.ball(Math.sin(a)*.91,4.05+Math.cos(a)*.91,.45,.35,.43,.44,i%3?mane:'#ad6732',9,5);}
  m.ball(0,4.05,.65,.79,.79,.65,gold,14,8);
  for(const side of [-1,1]){
    m.ball(side*.65,4.75,.47,.28,.3,.19,gold,9,5);m.ball(side*.65,4.75,.63,.15,.17,.05,'#b77d4b',8,4);
    m.ball(side*.3,4.24,1.2,.17,.2,.06,cream,9,5);m.ball(side*.3,4.25,1.26,.07,.11,.03,'#263b38',8,5);
    m.ball(side*.24,3.86,1.26,.29,.23,.23,cream,10,6);
    m.box(side*.32,4.47,1.19,.35,.065,.06,mane);
    for(let i=0;i<3;i++)m.ball(side*(.31+i*.075),3.87+(i%2)*.07,1.48,.02,.02,.015,mane,5,3);
  }
  m.ball(0,4.02,1.43,.16,.11,.11,'#2f2730',9,5);
  m.ball(0,3.63,1.17,.3,cheer?.16:.055,.1,'#633431',10,5);
  if(cheer)for(const side of [-1,1])m.cone(side*.15,3.62,1.24,.045,.14,cream,6);
  // Small, clearly separate black kippah on top of the golden head.
  m.ball(0,4.93,.58,.4,.13,.34,'#151820',12,6);m.ball(0,5.035,.58,.055,.025,.055,'#343941',7,4);
}
export function drawJetRangerRotors(m,phase){
  const a=phase*Math.PI/8,c=Math.cos(a),s=Math.sin(a);
  m.ball(0,6.15,-.2,.28,.16,.28,'#596a78',10,5);
  for(const side of [-1,1]){
    const p=(x,z)=>[x*c+z*s,6.15,-.2-x*s+z*c];
    m.quad(p(side*.25,-.12),p(side*4.7,-.18),p(side*4.7,.16),p(side*.25,.12),navy);
    m.quad(p(side*4.25,-.18),p(side*4.7,-.18),p(side*4.7,.16),p(side*4.25,.16),gold);
    const b=a*3,yy=Math.cos(b)*side,zz=Math.sin(b)*side;
    strut(m,[.26,3.8,-6.1],[.26,3.8+yy,-6.1+zz],.065,cream);
  }
}
export function drawRotorWash(glow,smoke,p,angle,time,jump=null){
  smoke.at(p.x,jump?.height??0,p.z);glow.at(p.x,jump?.height??0,p.z);
  for(let i=0;i<28;i++){
    const t=(time*1.5+i/28)%1,a=i*2.399+time*2,r=1+t*5,fade=1-t;
    smoke.particle(Math.sin(a)*r,.2+t*.5,Math.cos(a)*r,(.6+t*1.8)*fade,[.76,.78,.69]);
    glow.particle(Math.sin(a)*r,.16,Math.cos(a)*r,.16*fade,[.36*fade,.25*fade,.07]);
  }
}
