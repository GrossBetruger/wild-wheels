// Procedural, cached motorcycle parts. Combat still uses the shared kart rules.
const chrome='#c1d5db',leather='#222631',brown='#95643f',lightBrown='#bc8a59',cyan='#6af3ed';
function tube(m,a,b,r,color){
  const steps=Math.max(2,Math.ceil(Math.hypot(...a.map((v,i)=>v-b[i]))/.15));
  for(let i=0;i<=steps;i++){const t=i/steps;m.ball(...a.map((v,j)=>v+(b[j]-v)*t),r,r,r,color,6,4);}
}
export function drawMotorcycle(m,color){
  // Two narrow wheels, exposed V-twin, swept forks and a low saddle.
  for(const z of [-1.65,1.8]){
    m.ball(0,.92,z,.39,.92,.92,'#151b25',16,9);
    for(const side of [-1,1]){
      m.ball(side*.35,.92,z,.055,.63,.63,chrome,14,7);
      m.ball(side*.41,.92,z,.025,.46,.46,'#293745',12,7);
      m.ball(side*.44,.92,z,.05,.14,.14,'#f4c77a',8,5);
    }
  }
  for(const side of [-1,1]){
    tube(m,[side*.45,.92,-1.65],[side*.48,1.5,.2],.1,chrome);
    tube(m,[side*.45,.92,1.8],[side*.42,2.15,1.1],.095,chrome);
    tube(m,[side*.48,1.5,.2],[side*.42,2.15,1.1],.1,leather);
    for(let i=0;i<6;i++)m.box(side*.32,.9+i*.12,0,.55,.045,.85,chrome);
    m.ball(side*.43,1.16,-.24,.25,.3,.33,'#59636c',8,5);
    tube(m,[side*.5,1.12,.1],[side*.65,.65,-1.25],.14,chrome);
    m.ball(side*.65,.67,-1.65,.21,.21,.75,'#6f8794',10,5);
    m.ball(side*.65,.67,-2.3,.15,.15,.06,'#112334',8,5);
    tube(m,[side*.15,2.13,1.05],[side*.85,2.4,1.28],.075,chrome);
    m.box(side*.91,2.33,1.28,.38,.14,.18,leather);
    tube(m,[side*.75,2.4,1.25],[side*.98,2.9,1.35],.035,chrome);
    m.ball(side*1.02,2.9,1.36,.2,.13,.055,chrome,8,5);
    m.ball(side*1.02,2.9,1.42,.15,.09,.015,'#8dcad8',7,4);
    m.box(side*.68,.78,-.32,.5,.12,.35,leather);
  }
  m.ball(0,1.75,.35,.65,.43,.9,color,12,7);
  m.box(0,2.13,.3,.16,.03,1.15,'#f3cb80');
  m.ball(0,1.67,-.69,.6,.18,.64,leather,12,6);
  m.ball(0,1.65,-1.65,.46,.17,.75,color,12,5);
  m.ball(0,1.9,1.9,.34,.32,.2,chrome,10,6);
  m.ball(0,1.9,2.08,.26,.25,.045,'#fff1c5',10,6);
  m.box(0,1.57,-2.19,.43,.13,.08,'#ff6551');
}
export function drawYuda(m,phase=0,tuck=false){
  const salute=Math.sin(phase*Math.PI/8),reach=tuck?.2:0;
  m.ball(0,2.32,-.52,.62,.7,.46,leather,12,7);
  for(const side of [-1,1]){
    // Folded riding legs and chunky boots, one hand stays on the bars.
    tube(m,[side*.4,1.9,-.55],[side*.76,1.43,.05],.23,leather);
    tube(m,[side*.76,1.43,.05],[side*.69,1.03,-.28],.19,leather);
    m.ball(side*.7,.96,-.05,.26,.2,.48,'#161d29',9,5);
    m.tri([side*.08,2.95,-.11],[side*.42,2.74,-.14],[side*.12,2.38,.01],chrome);
    const hand=side===1?[.91-salute*.25,2.4+salute*1.15,1.28-salute*.78]:[-.91,2.4,1.28];
    tube(m,[side*.52,2.65,-.25],hand,.19,leather);m.ball(...hand,.22,.19,.21,brown,9,5);
    for(let i=0;i<3;i++)m.ball(side*.5,2.73-i*.12,-.05,.04,.04,.035,chrome,5,3);
  }
  // Brown elder face, expressive pointed ears and unmistakable aviator shades.
  m.ball(0,3.38,-.32+reach,.81,.72,.68,brown,14,8);
  for(const side of [-1,1]){
    m.tri([side*.55,3.67,-.22],[side*2.05,3.78,-.38],[side*.72,3.12,-.02],brown);
    m.tri([side*.72,3.56,-.12],[side*1.8,3.7,-.32],[side*.78,3.25,.015],lightBrown);
    m.tri([side*.55,3.67,-.5],[side*.72,3.12,-.32],[side*2.05,3.78,-.38],brown);
    m.ball(side*.36,3.52,.29+reach,.37,.27,.095,chrome,10,6);
    m.ball(side*.36,3.52,.37+reach,.32,.22,.055,'#111c2a',10,6);
    m.box(side*.35,3.59,.425+reach,.25,.025,.015,cyan);
    tube(m,[side*.7,3.55,.31+reach],[side*.79,3.53,-.3],.035,chrome);
    tube(m,[side*.12,3.94,-.02+reach],[side*.48,3.83,.08+reach],.026,lightBrown);
  }
  m.box(0,3.51,.37+reach,.19,.045,.055,chrome);
  m.ball(0,3.27,.38+reach,.19,.16,.24,lightBrown,10,6);
  m.ball(0,3.02,.19+reach,.35,.13,.23,lightBrown,10,5);
  m.box(.08,3.1,.4+reach,.3,.028,.03,'#493428');
  // Tiny silver hoop and a winged patch on the back of the jacket.
  m.ball(-1.06,3.35,-.09,.1,.14,.04,'#f2d6a5',8,5);
  for(const side of [-1,1])for(let i=0;i<4;i++)m.box(side*(.13+i*.09),2.49+i*.045,-.97,.14,.06,.03,chrome);
  m.ball(0,2.5,-.98,.12,.16,.025,cyan,7,4);
}
export function drawBikerBadge(m){
  m.ball(0,0,0,.23,.26,.07,chrome,9,5);
  m.box(0,.015,.07,.33,.065,.03,'#172331');
  for(const side of [-1,1])for(let i=0;i<4;i++){
    const x=side*(.29+i*.14),y=.12+i*.07;
    m.tri([side*.2,-.1,0],[x,y+.15,0],[x+side*.12,y,0],i%2?chrome:cyan);
  }
}
export function drawMotorcycleBoost(glow,smoke,p,angle,clock,jump=null){
  for(const mesh of [glow,smoke]){mesh.at(p.x,jump?.height??0,p.z,angle);mesh.pitch=jump?.pitch??0;mesh.pivot=2;}
  for(const side of [-1,1]){
    const x=side*.65,flicker=1+.1*Math.sin(clock*63+side);
    glow.flame(x,.67,-2.3,.23,6*flicker,[.015,.26,.4],clock);
    glow.flame(x,.67,-2.32,.12,3.7*flicker,[.35,.75,.85],clock);
    for(let i=0;i<22;i++){
      const t=(clock*2.4+i/22)%1,fade=1-t;
      glow.particle(x+Math.sin(i*2.4)*t*.5,.67+Math.cos(i*1.7)*t*.4,-2.4-t*8,.24*fade,i%3?[.03,.48*fade,.8*fade]:[fade,.38*fade,.025]);
      if(i%4===0)smoke.particle(x,.65+t*.7,-2.8-t*6,(.5+t)*fade,[.23,.37,.48]);
    }
  }
}
