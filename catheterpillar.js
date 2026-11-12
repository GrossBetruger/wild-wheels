// Shared procedural models for the preview, local racer and remote racers.
function heart(m,x,y,z,size,color){
  m.ball(x-size*.28,y+size*.2,z,size*.36,size*.34,size*.12,color,8,5);
  m.ball(x+size*.28,y+size*.2,z,size*.36,size*.34,size*.12,color,8,5);
  m.tri([x-size*.58,y+size*.13,z],[x,y-size*.6,z],[x+size*.58,y+size*.13,z],color);
  m.tri([x+size*.58,y+size*.13,z],[x,y-size*.6,z],[x-size*.58,y+size*.13,z],color);
}

export function drawAmbulance(m,color){
  const cream='#fff7eb',mint='#a6e3d4',dark='#36455b';
  for(const x of [-1.48,1.48])for(const z of [-1.55,1.45]){
    m.ball(x,.6,z,.48,.6,.6,dark,10,6);
    m.ball(x+Math.sign(x)*.44,.6,z,.07,.32,.32,mint,10,5);
    m.ball(x+Math.sign(x)*.51,.6,z,.035,.13,.13,cream,8,4);
  }
  m.box(0,.77,0,2.85,.85,4.8,cream);
  m.ball(0,1.12,1.55,1.43,.55,.9,cream,12,6);
  m.box(0,1.4,-1.3,2.85,1.3,1.75,cream);
  m.box(0,1.07,0,2.91,.25,4.55,color);
  m.box(0,1.52,.68,2.18,.66,.12,'#9bd8e0');
  m.box(0,1.87,.68,2.35,.09,.18,mint);
  m.box(0,1.4,-.25,1.6,.6,1.25,dark);
  m.box(0,.54,2.45,2.7,.22,.25,mint);
  for(const side of [-1,1]){
    m.ball(side*.91,1.23,2.24,.34,.3,.13,'#fff4bd',10,6);
    m.ball(side*.91,1.25,2.36,.1,.14,.035,dark,8,5);
    m.ball(side*1.18,1,2.28,.17,.08,.04,'#f3afbf',8,4);
    m.box(side*1.47,1.55,-1.3,.05,.55,.93,mint);
    m.box(side*1.51,1.55,-1.3,.04,.39,.13,cream);
    m.box(side*1.51,1.55,-1.3,.04,.13,.39,cream);
    m.box(side*.68,1.38,-2.2,1.15,.94,.05,'#d4efe8');
    m.ball(side*1.08,.83,-2.43,.15,.2,.06,color,8,4);
  }
  for(let i=0;i<9;i++){const x=(i-4)*.085;m.ball(x,.9+x*x*.6,2.43,.06,.035,.035,dark,6,4);}
  heart(m,0,1.55,2.23,.4,color);
  heart(m,0,1.51,-2.24,.53,color);
  m.box(0,2.12,-1.43,1.9,.12,.46,dark);
  for(const side of [-1,1])m.ball(side*.62,2.28,-1.43,.35,.23,.23,side<0?'#f49fbd':'#8adce2',10,5);
}

export function drawButterflyWings(m,phase){
  const ink="#514568",mint="#b5e9db",flap=.2+Math.sin(phase*Math.PI/12)*.95;
  for(const side of [-1,1]){
    // Each wing pivots at the shoulder, preserving its shape through the stroke.
    m.at(side*.28,0,-.45,side*flap);
    for(const [y,size,shade]of [[3.45,1.12,"#c7afea"],[2.45,.78,"#f3b5d2"]]){
      const x=side*(.12+size*.75);
      m.ball(x,y,0,size,size,.15,ink,12,8);
      m.ball(x,y,0,size*.92,size*.92,.18,shade,12,8);
      for(const face of [-1,1]){
        m.ball(x,y+.12,face*.18,size*.55,size*.65,.03,mint,10,6);
        for(let i=0;i<5;i++){const a=-1.2+i*.6;m.ball(x+side*Math.cos(a)*size*.76,y+Math.sin(a)*size*.76,face*.17,.065,.065,.035,"#fff5cf",6,4);}
      }
    }
  }
  m.at(0,0,0);
}

export function drawNurseButterfly(m,phase,waving){
  const skin="#f4c4d8",ink="#514568",mint="#b5e9db";
  // Little dangling shoes make the whole airborne silhouette readable.
  for(const side of [-1,1])m.ball(side*.24,1.7,.12,.17,.15,.3,mint,10,5);
  m.ball(0,2.47,0,.58,.78,.46,'#fff7eb',12,7);
  m.box(0,2.12,.42,.73,.35,.08,mint);
  m.ball(0,3.6,.17,.73,.72,.61,skin,14,8);
  for(const side of [-1,1]){
    m.ball(side*.27,3.7,.72,.2,.25,.07,'#fffaf6',10,6);
    m.ball(side*.27,3.69,.78,.105,.15,.04,'#4b7d82',8,5);
    m.ball(side*.24,3.76,.82,.045,.055,.02,'#ffffff',6,4);
    m.ball(side*.48,3.37,.67,.16,.09,.04,'#ec94b5',8,4);
    for(let i=0;i<6;i++)m.ball(side*(.3+i*.065),4.12+i*.12,.1,.035,.08,.035,ink,6,4);
    m.ball(side*.64,4.83,.1,.12,.12,.1,mint,8,5);
    const lift=side>0&&waving?.65+Math.sin(phase*Math.PI/4)*.16:0;
    m.ball(side*.64,2.51+lift*.5,.37,.17,.35+lift*.3,.18,'#fff7eb',8,5);
    m.ball(side*.75,2.3+lift,.65,.2,.2,.18,skin,8,5);
    // Stethoscope earpieces and curved tubing around the uniform collar.
    for(let i=0;i<6;i++)m.ball(side*(.28-i*.025),2.99-i*.1,.47,.035,.06,.035,ink,6,4);
  }
  for(let i=0;i<7;i++){const x=(i-3)*.065;m.ball(x,3.31+x*x*1.2,.76,.047,.027,.025,ink,6,4);}
  m.ball(.12,2.35,.52,.13,.13,.05,'#76bdb6',10,5);
  m.ball(0,4.15,.15,.66,.23,.5,'#fff7eb',12,6);
  m.box(0,4.21,.56,.84,.32,.08,'#fff7eb');
  heart(m,0,4.22,.62,.23,'#e58eae');
}
