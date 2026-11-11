// Procedural models share the game's existing GPU model cache and kart physics.
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

export function drawNewDriver(m,driver,turn,progress){
  if(driver<4)return false;
  const skin=['#91a9bc','#78ad41','#edc5ab'][driver-4];
  m.ball(0,2.2,0,driver===4?1.05:.78,1,.72,driver===6?'#20232d':skin);
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
  }
  for(const side of [-1,1]){
    const y=2.12+turn*(2.1+Math.sin(progress*18+side)*.22),x=side*(.83+turn*.5),z=1-turn*.7;
    m.ball(side*(.85+turn*.2),(2.12+y)/2,(z+.3)/2,.23,.31+turn*.55,.23,driver===6?'#20232d':skin,8,5);
    m.ball(x,y,z,.29,.29,.29,skin,8,5);
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
