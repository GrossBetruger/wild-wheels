// Procedural models share the game's existing GPU model cache and kart physics.
export function drawCessna(m,color){
  const white='#edf0e5',dark='#354451';
  m.ball(0,1.3,-.35,.8,.68,2.85,white,12,7);
  m.ball(0,1.55,1.82,.78,.63,1.12,white,12,7);
  m.box(0,1.07,.6,1.47,.24,3.8,color);
  m.box(0,1.85,-.4,1.23,.65,1.4,dark);
  m.box(0,2.04,.73,1.3,.5,.14,'#87b7c3');
  // High wing and supporting struts leave the open cockpit and worm visible.
  m.box(0,3.13,-.8,7.4,.16,1.45,white);
  for(const side of [-1,1]){
    m.box(side*3.4,3.23,-.8,.52,.07,1.5,color);
    for(let i=0;i<8;i++)m.ball(side*(.7+i*.32),1.15+i*.25,-.65,.055,.16,.06,dark,5,3);
    m.box(side*1.1,.75,-.3,.12,1.15,.12,dark);
    m.ball(side*1.1,.46,-.3,.24,.46,.46,'#242d37',10,5);
    m.ball(side*1.3,.46,-.3,.04,.22,.22,'#b8c7cb',8,4);
    m.box(side*.81,1.52,.6,.06,.15,1.6,color);
  }
  m.box(0,.72,2.05,.12,.85,.12,dark);m.ball(0,.38,2.05,.19,.36,.36,'#242d37',8,5);
  m.box(0,1.48,-2.8,3.05,.13,.85,white);
  m.box(0,2.07,-2.95,.14,1.35,.8,color);
  m.box(0,2.77,-2.95,.16,.1,.8,white);
  m.ball(0,1.65,2.98,.31,.31,.3,color,10,6);
  for(const side of [-1,1])m.ball(side*.52,1.38,2.71,.16,.12,.06,dark,7,4);
}

export function drawPilotWorm(m,turn,progress,wiggle=0){
  // The worm curls out beside the cockpit, then bends back above the wing.
  const body=[[0,1.75,-.15],[-.35,1.95,-.08],[-.7,2.15,0],[-1.02,2.4,.05],[-1.28,2.65,.1],[-1.43,2.95,.13],[-1.4,3.25,.16],[-1.22,3.53,.18],[-.95,3.72,.2],[-.62,3.8,.23],[-.28,3.84,.26],[.05,3.97,.28],[.23,4.2,.31],[.23,4.45,.33]];
  for(const [i,[x,y,z]]of body.entries()){
    const bend=wiggle*.22*i/(body.length-1),radius=.34+i*.004;
    m.ball(x+bend,y,z,radius,.28,radius,i%2?'#efa5a8':'#e695a0',9,5);
    m.ball(x+bend,y-.1,z,radius+.012,.035,radius+.012,'#bd6c85',9,3);
    m.ball(x+bend,y,z+radius*.86,.22,.18,.06,'#ffc7b5',7,4);
  }
  const x=.15+wiggle*.22,y=4.7;
  m.ball(x,y,.4,.64,.6,.58,'#f4b3ad',12,7);
  m.box(x,y-.34,.97,.31,.055,.045,'#a65371');
  for(const side of [-1,1])m.ball(x+side*.43,y-.18,.88,.15,.09,.045,'#e57e98',7,4);
  // A leather flying cap with shearling trim, long ear flaps and visible seams.
  m.ball(x,y+.36,.27,.76,.43,.69,'#a66c35',12,7);
  m.box(x,y+.75,-.23,.09,.055,1,'#f4deb2');
  for(let i=0;i<13;i++){
    const a=i*Math.PI/12;
    m.ball(x+Math.cos(a)*.69,y+.2,.3+Math.sin(a)*.6,.13,.1,.1,'#f4deb2',7,4);
  }
  m.box(x,y+.01,-.37,1.36,.17,.12,'#4a352e');
  for(const side of [-1,1]){
    m.box(x+side*.68,y-.55,.25,.24,.79,.38,'#a66c35');
    m.box(x+side*.78,y-.54,.28,.07,.7,.36,'#f4deb2');
    m.box(x+side*.69,y-.51,.63,.22,.16,.06,'#e8bd63');
    // Oversized brass-rimmed goggles sit on the face, rather than on the cap.
    m.ball(x+side*.34,y+.05,.94,.37,.32,.18,'#e8bd63',12,7);
    m.ball(x+side*.34,y+.05,1.08,.28,.24,.09,'#55b9dd',10,6);
    m.ball(x+side*.34,y+.04,1.16,.08,.11,.025,'#23475d',7,4);
    m.ball(x+side*.26,y+.14,1.17,.09,.055,.025,'#ecffff',7,4);
    m.box(x+side*.65,y-.03,.59,.16,.18,.45,'#4a352e');
  }
  m.box(x,y+.06,1.1,.19,.1,.1,'#e8bd63');
  m.box(x,y-.48,.8,.62,.1,.12,'#4a352e');
  for(let i=0;i<7;i++)m.ball(x-.55-i*.09,4.03-i*.09,.05-i*.17,.18-i*.014,.08,.16,'#f4d473',7,4);
}

export function drawCessnaPropeller(m,phase){
  const angle=phase*Math.PI/8;
  for(const side of [-1,1]){
    const x=Math.sin(angle)*side,y=Math.cos(angle)*side,nx=Math.cos(angle)*.12,ny=-Math.sin(angle)*.12;
    m.quad([x*.2+nx,1.65+y*.2+ny,3.24],[x*1.38+nx,1.65+y*1.38+ny,3.24],[x*1.38-nx,1.65+y*1.38-ny,3.24],[x*.2-nx,1.65+y*.2-ny,3.24],'#364855');
    m.ball(x*1.25,1.65+y*1.25,3.25,.12,.12,.04,'#f8d86e',6,4);
  }
}

export function drawCessnaBoost(glow,smoke,p,angle,clock,jump=null){
  for(const mesh of [glow,smoke]){mesh.at(p.x,.13+(jump?.height??0),p.z,angle);mesh.pitch=jump?.pitch??0;mesh.pivot=1.87;}
  for(let i=0;i<24;i++){const a=i*Math.PI/12+clock*25;glow.particle(Math.sin(a)*1.33,1.65+Math.cos(a)*1.33,3.24,.17,[.1,.2,.28]);}
  for(const side of [-1,1])for(let i=0;i<18;i++){
    const t=(clock*2.7+i/18)%1;
    smoke.particle(side*(3.48+Math.sin(t*9-clock*5)*t*.13),3.15+Math.cos(t*9-clock*5)*t*.13,-.8-t*8,(.14+t*.5)*Math.sqrt(1-t),[.82,.92,.98]);
  }
  for(let ring=0;ring<3;ring++){
    const t=(clock*2+ring/3)%1,radius=.6+t*1.1;
    for(let i=0;i<12;i++){const a=i*Math.PI/6+clock*4;smoke.particle(Math.sin(a)*radius,1.65+Math.cos(a)*radius,2.8-t*7,.16*(1-t),[.65,.8,.87]);}
  }
}

export function drawElectron(m){
  m.ball(0,0,0,.24,.24,.24,'#79dfff',9,5);
  m.box(0,0,.25,.28,.065,.04,'#f3ffff');
}

export function drawDollarBundle(m){
  for(let layer=0;layer<4;layer++)m.box(0,-.18+layer*.12,0,1.3,.09,1.7,layer%2?'#e0e7bd':'#4c8751');
  m.box(0,.28,0,1.16,.015,1.52,'#6ca65d');
  m.box(0,-.19,0,.2,.58,1.75,'#f0e6bc');
  m.disc(.39,.3,0,.16,.28,'#2e623d',10);
  for(const z of [-.33,0,.33])m.box(-.37,.3,z,.33,.025,.055,'#ecf0cf');
  m.box(-.51,.3,.17,.055,.025,.33,'#ecf0cf');m.box(-.23,.3,-.17,.055,.025,.33,'#ecf0cf');m.box(-.37,.31,0,.04,.025,.85,'#ecf0cf');
}

export function drawCricketProjectile(m,phase){
  m.ball(0,0,-.25,.33,.27,.69,'#659c35',8,5);
  m.ball(0,.12,.43,.36,.33,.34,'#8dc84b',8,5);
  m.ball(0,.18,-.3,.27,.12,.5,'#3f6e28',7,4);
  for(const side of [-1,1]){
    m.ball(side*.23,.24,.67,.12,.16,.09,'#e6efc6',6,4);
    m.ball(side*.23,.24,.74,.055,.09,.035,'#203622',5,3);
    for(let i=0;i<5;i++)m.ball(side*(.16+i*.07),.37+i*.11,.6+i*.1,.035,.065,.035,'#344d26',5,3);
    const kick=Math.sin(phase*Math.PI/2+side)*.2;
    m.ball(side*.55,-.03,-.52,.19,.17,.48,'#8dc84b',7,4);
    m.ball(side*.81,-.21,-.39+kick,.07,.09,.44,'#344d26',6,3);
    for(const z of [-.07,.27])m.ball(side*.48,-.2,z-kick,.27,.045,.055,'#456b2a',6,3);
  }
}

export function drawHoustonHelmet(m){
  m.ball(0,3.71,.03,1.08,1.09,.99,'#f2f3ea',14,8);
  m.ball(0,3.73,.6,.93,.87,.57,'#628798',12,7);
  for(const side of [-1,1])m.ball(side*1.04,3.57,.16,.18,.28,.25,'#86a9b7',8,5);
  m.box(-.45,4.61,.03,.055,.4,.055,'#8ca5af');m.ball(-.45,5.03,.03,.1,.1,.1,'#e79a50',7,4);
}

export function drawNewDriver(m,driver,turn,progress,helmet=true){
  if(driver<4)return false;
  if(driver===8){drawPilotWorm(m,turn,progress);return true;}
  const skin=['#91a9bc','#78ad41','#edc5ab','#a99074'][driver-4];
  const suit=driver===7?'#eef0e9':driver===6?'#20232d':skin;
  m.ball(0,2.2,0,driver===4?1.05:.78,1,.72,suit);
  switch(driver){
    case 4:
      m.ball(0,3.6,.15,1.12,1.05,.94,skin,12,7);
      for(const side of [-1,1]){
        m.ball(side*1.15,3.65,.06,.83,.96,.25,skin,10,6);m.ball(side*1.25,3.63,.27,.53,.68,.055,'#c5abb0',9,5);
        m.ball(side*.54,3.89,.98,.13,.16,.07,'#202b35');m.ball(side*.55,3.95,1.02,.035,.045,.025,'#ffffff',5,3);
        m.ball(side*.49,3.18,1.08,.11,.13,.48,'#f6e6c3',8,5);
      }
      for(let i=0;i<7;i++){const t=i/6;m.ball(0,3.42-t*.96,1.02+t*.68,.28-t*.07,.24, .27,skin,9,5);}
      m.ball(0,2.49,1.82,.27,.19,.2,skin);for(const side of [-1,1])m.ball(side*.11,2.49,1.99,.055,.06,.025,'#52687c',6,4);
      break;
    case 5:
      m.ball(0,3.5,.14,.82,.9,.72,skin,12,7);m.ball(0,2.15,-.43,.67,.87,.5,'#536d2e');
      for(const side of [-1,1]){
        m.ball(side*.52,3.83,.67,.37,.43,.32,'#e6efc6',10,6);m.ball(side*.52,3.87,.94,.14,.2,.08,'#243a26');
        for(let i=0;i<8;i++)m.ball(side*(.3+i*.055),4.1+i*.14,.1-i*.035,.055,.085,.055,'#344d26',6,4);
        m.ball(side*1.06,1.9,-.58,.24,.72,.35,skin);m.ball(side*1.38,1.17,-.38,.18,.64,.18,'#536d2e');
        m.ball(side*.92,2.7,.27,.19,.23,.3,skin);m.ball(side*1.13,2.55,.6,.18,.18,.34,skin);
      }
      m.box(0,3.31,.82,.48,.055,.05,'#344d26');
      break;
    case 6:
      m.ball(0,3.54,.16,.75,.91,.69,skin,12,8);
      m.ball(0,4.13,.04,.78,.4,.66,'#40322c',12,6);m.ball(-.23,4.29,.27,.48,.22,.4,'#49372e');
      m.ball(.31,4.11,.58,.31,.19,.16,'#40322c');
      for(const side of [-1,1]){
        m.ball(side*.73,3.55,.1,.14,.25,.16,skin,8,5);m.ball(side*.27,3.72,.77,.17,.105,.045,'#edf1ee');
        m.ball(side*.27,3.72,.81,.07,.08,.025,'#66828e',6,4);m.box(side*.27,3.92,.72,.31,.055,.06,'#46342b');
      }
      m.ball(0,3.48,.87,.12,.2,.17,skin);m.box(0,3.2,.76,.35,.04,.035,'#8c6257');
      m.box(0,2.56,.74,.43,.07,.04,'#e9eceb');m.box(0,2.28,.74,.07,.29,.04,'#e9eceb');
      break;
    case 7:
      m.box(0,2.25,-.82,1.32,1.18,.5,'#ced9dc');
      for(const side of [-1,1])m.ball(side*.53,2.42,-1.07,.24,.64,.24,'#87acb9',8,5);
      m.ball(0,2.99,.02,.85,.19,.79,'#647d8b',12,4);
      m.ball(0,3.65,.13,.86,.89,.78,skin,12,7);
      for(const side of [-1,1])m.ball(side*.78,3.67,.14,.23,.25,.2,skin,8,5);
      if(helmet)drawHoustonHelmet(m);
      m.ball(0,3.68,.96,.73,.72,.36,skin,12,7);
      m.ball(0,3.63,1.15,.65,.6,.2,'#e0ceb0',12,7);
      for(const side of [-1,1]){
        m.ball(side*.32,3.77,1.32,.3,.2,.055,'#5c493c',9,5);
        m.box(side*.31,3.82,1.38,.23,.045,.035,'#261f25');
        m.ball(side*.29,3.88,1.38,.055,.035,.025,'#f4ead9',5,3);
        m.ball(side*.44,3.47,1.31,.14,.08,.025,'#cf9e88',7,4);
      }
      m.ball(0,3.57,1.43,.15,.1,.09,'#322a2c');m.box(0,3.35,1.34,.3,.04,.025,'#755b47');
      m.box(0,2.2,.73,.68,.46,.1,'#6b91a4');m.box(-.14,2.53,.76,.24,.1,.035,'#e89a4c');
      m.ball(.19,2.56,.8,.065,.065,.03,'#d7ef8d',6,4);
      break;
  }
  for(const side of [-1,1]){
    const y=2.12+turn*(2.1+Math.sin(progress*18+side)*.22),x=side*(.83+turn*.5),z=1-turn*.7;
    m.ball(side*(.85+turn*.2),(2.12+y)/2,(z+.3)/2,.23,.31+turn*.55,.23,suit,8,5);
    m.ball(x,y,z,.29,.29,.29,driver===7?'#e7e6d7':skin,8,5);
    if(driver===7)for(const claw of [-1,0,1])m.ball(x+claw*.12,y-.09,z+.25,.055,.08,.15,'#a99b82',6,4);
  }
  return true;
}

export const ROADSTER_NOZZLES=[-1.14,-.38,.38,1.14];
export function drawRoadster(m){
  const color='#e8edf2';
  for(const x of [-1.6,1.6])for(const z of [-1.65,1.6]){m.ball(x,.62,z,.56,.63,.65,'#202531',10,5);m.ball(x+Math.sign(x)*.49,.62,z,.08,.43,.44,'#b5c3cb',10,5);m.ball(x+Math.sign(x)*.56,.62,z,.03,.18,.18,'#303a44',8,4);}
  m.box(0,.32,0,3.45,.35,5.2,'#202b36');m.box(0,.62,-.05,3.25,.43,5.05,color);
  m.quad([-1.5,.94,2.64],[1.5,.94,2.64],[1.34,1.39,.65],[-1.34,1.39,.65],color);
  m.quad([-1.34,1.39,.65],[1.34,1.39,.65],[1.17,1.99,.03],[-1.17,1.99,.03],'#365464');
  m.box(0,1.05,-.65,2.1,1.16,1.45,'#242b35');m.box(0,1.13,-1.95,3,.22,1.1,color);
  for(const side of [-1,1]){m.box(side*1.57,.9,-.02,.12,.28,1.1,'#25313b');m.box(side*1.08,1.06,2.6,.62,.11,.07,'#e6f8ff');m.box(side*1.12,1.27,-2.1,.12,.28,.2,'#26303a');}
  m.box(0,1.51,-2.1,3.45,.11,.49,'#26303a');m.box(0,1.13,-2.63,3.0,.1,.07,'#ed4258');m.box(0,.75,2.64,2.25,.13,.08,'#26303a');
  m.box(0,1.12,2.09,.4,.055,.09,'#e2e7e9');m.box(0,1.06,2.14,.08,.08,.21,'#e2e7e9');
  m.box(0,.97,-2.71,.76,.18,.04,'#e9edef');
  for(const x of ROADSTER_NOZZLES){m.ball(x,.68,-2.62,.25,.25,.4,'#5d6c78',10,5);m.ball(x,.68,-3.01,.18,.18,.045,'#17242f',10,5);}
  for(const x of [-1.27,1.27])for(const z of [-1.8,1.8])m.ball(x,.33,z,.18,.055,.18,'#25313b',8,4);
}

// Tesla's Roadster describes rear/perimeter cold-gas jets, not combustion exhaust:
// https://www.tesla.com/roadster . White condensation uses the alpha smoke pass.
export function drawRoadsterJets(glow,smoke,p,angle,clock,jump=null){
  for(const mesh of [glow,smoke]){mesh.at(p.x,.13+(jump?.height??0),p.z,angle);mesh.pitch=jump?.pitch??0;mesh.pivot=1.87;}
  for(const [index,x]of ROADSTER_NOZZLES.entries()){
    glow.particle(x,.68,-3.05,.48,[.28,.36,.4]);
    for(let i=0;i<17;i++){const t=(clock*3+i/17+index*.13)%1,spread=t*.31;smoke.particle(x+Math.sin(i*7+clock*8)*spread,.68+Math.cos(i*9)*spread,-3.05-t*6.8,(.25+t*1.3)*Math.sqrt(1-t),[.86,.92,.98]);}
  }
  if(!jump)return;
  const front=-jump.pitch/(Math.PI*2)<.5,z=front?1.8:-1.8;
  for(const side of [-1,1])for(let i=0;i<12;i++){const t=(clock*4+i/12)%1;smoke.particle(side*(1.27+t*.13),.33-t*3.7,z+Math.sin(i*6)*t*.2,(.23+t)*Math.sqrt(1-t),[.86,.92,.98]);}
}

export function drawCricketHaze(glow,smoke,p,angle,clock,jump=null){
  for(const mesh of [glow,smoke]){mesh.at(p.x,.13+(jump?.height??0),p.z,angle);mesh.pitch=jump?.pitch??0;mesh.pivot=1.87;}
  for(const side of [-1,1]){
    glow.particle(side*1.2,.75,-2.87,.65,[.035,.16,.018]);
    for(let i=0;i<22;i++){
      const t=(clock*1.6+i/22)%1,spread=t*1.1;
      smoke.particle(side*1.2+Math.sin(i*2.399+clock*.6)*spread,.75+t*.8+Math.cos(i*3.7)*spread*.2,-2.9-t*6.5,(.6+t*2.7)*Math.sqrt(1-t),[.24,.64,.14]);
    }
  }
}
