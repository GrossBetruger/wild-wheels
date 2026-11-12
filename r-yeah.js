const gold='#e2af50',mane='#8f5029',cream='#fff0c9',navy='#243d62';
export function drawArchangel(m,phase,manifest){
  const point=m.point,scale=.12+.88*manifest;
  m.point=function(p){return point.call(this,[p[0]*scale,p[1]*scale,p[2]*scale]);};
  try{
    const white='#fff7db',light='#e6eaf3',metal='#ecc36b',skin='#dba878',wing=Math.sin(phase*Math.PI/4)*.23;
    // Layered flight feathers spread from the shoulder, with raised golden leading edges.
    for(const side of [-1,1]){
      for(let i=0;i<9;i++){
        const t=i/8,x=side*(.55+t*1.7),y=2.2+Math.sin(t*Math.PI*.8)*1.15,z=-.2-wing*t;
        m.ball(x,y-.25,z,.17,.65-t*.16,.12,i%3===0?white:light,7,5);
        strut(m,[side*.45,2.15,-.18],[x,y+.32,z],.065,metal);
        m.cone(x,y-.97+t*.15,z,.14,.5,white,7);
      }
      // Armored shoulders and a relaxed, open guarding hand.
      m.ball(side*.56,1.94,.1,.28,.26,.28,metal,9,5);
      strut(m,[side*.56,1.85,.1],[side*.83,1.2,.35],.13,white);
      m.ball(side*.84,1.16,.36,.16,.19,.14,skin,8,5);
    }
    // Flowing ivory robes and engraved gold breastplate.
    m.cone(0,0,0,.72,2.2,white,12);
    m.ball(0,1.75,0,.48,.52,.31,metal,12,7);
    m.box(0,1.35,.3,.12,.8,.08,white);m.box(0,1.72,.3,.55,.1,.08,white);
    for(const x of [-.42,-.21,0,.21,.42])m.tri([x,0,.58],[x+.07,0,.58],[x*.3,1.5,.25],metal);
    m.ball(0,2.67,.06,.4,.44,.35,skin,12,7);
    m.ball(0,2.91,-.03,.44,.3,.36,'#79512e',10,6);
    for(const x of [-.14,.14])m.ball(x,2.72,.39,.045,.07,.025,'#433636',6,4);
    m.box(0,2.49,.39,.17,.035,.025,'#fff6da');
    // Flaming ceremonial sword, held outside the robe.
    m.box(.85,.48,.4,.085,.95,.085,white);m.cone(.85,.35,.4,.12,.3,metal,6);
    m.box(.85,1.02,.4,.48,.08,.12,metal);m.box(.85,1.1,.4,.09,.33,.09,metal);
    for(let i=0;i<32;i++){const a=i*Math.PI/16,b=(i+1)*Math.PI/16;m.quad([Math.cos(a)*.53,3.36,Math.sin(a)*.53],[Math.cos(b)*.53,3.36,Math.sin(b)*.53],[Math.cos(b)*.65,3.36,Math.sin(b)*.65],[Math.cos(a)*.65,3.36,Math.sin(a)*.65],metal);}
  }finally{m.point=point;}
}
function strut(m,a,b,r,color){const n=Math.max(2,Math.ceil(Math.hypot(...a.map((v,i)=>v-b[i]))/.2));for(let i=0;i<=n;i++)m.ball(...a.map((v,j)=>v+(b[j]-v)*i/n),r,r,r,color,6,4);}
function iaiLogo(m,side){
  // Procedural decal based on the IAI mark shown at space.gov.il/node/134091.
  const blue='#3c96d6',point=(u,v)=>[side*1.245,2.28+v*.92,-1.2-side*(u-.5)*2.05];
  const quad=(a,b,c,d,color=blue)=>m.quad(point(...a),point(...b),point(...c),point(...d),color);
  const line=(a,b,width=.012)=>{const dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy),x=-dy/length*width,y=dx/length*width;quad([a[0]+x,a[1]+y],[b[0]+x,b[1]+y],[b[0]-x,b[1]-y],[a[0]-x,a[1]-y]);};
  // Slightly raised cream mounting plate, with the mark readable on each side.
  m.quad([side*1.24,2.2,-2.38],[side*1.24,3.28,-2.38],[side*1.24,3.28,-.02],[side*1.24,2.2,-.02],cream);
  for(let i=0;i<40;i++){
    const a=i*Math.PI/20,b=(i+1)*Math.PI/20;
    quad([.235+Math.cos(a)*.19,.35+Math.sin(a)*.23],[.235+Math.cos(b)*.19,.35+Math.sin(b)*.23],[.235+Math.cos(b)*.168,.35+Math.sin(b)*.203],[.235+Math.cos(a)*.168,.35+Math.sin(a)*.203]);
    if(i<33){const c=1.55+i*.15,d=c+.15;line([.235+Math.cos(c)*.23,.35+Math.sin(c)*.3],[.235+Math.cos(d)*.23,.35+Math.sin(d)*.3],.015);}
  }
  for(const stretch of [.07,.135])for(let i=0;i<24;i++){const a=i*Math.PI/12,b=(i+1)*Math.PI/12;line([.235+Math.cos(a)*stretch,.35+Math.sin(a)*.2],[.235+Math.cos(b)*stretch,.35+Math.sin(b)*.2],.003);}
  for(const v of [.25,.35,.45])line([.075,v],[.395,v],.003);
  for(let i=0;i<12;i++){const a=i*Math.PI/6,b=(i+1)*Math.PI/6,r=i%2?.07:.135,s=(i+1)%2?.07:.135;m.tri(point(.235,.35),point(.235+Math.sin(a)*r,.35+Math.cos(a)*r),point(.235+Math.sin(b)*s,.35+Math.cos(b)*s),blue);}
  m.tri(point(.055,.71),point(.32,1),point(.13,.66),blue);
  quad([.17,.025],[.35,.025],[.36,.085],[.13,.085]);
  for(const u of [.43,.82])quad([u,0],[u+.09,0],[u+.205,.66],[u+.115,.66]);
  quad([.55,0],[.63,0],[.775,.66],[.68,.66]);quad([.71,0],[.8,0],[.84,.66],[.765,.66]);quad([.63,.18],[.77,.18],[.78,.27],[.65,.27]);
}
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
  for(const side of [-1,1])iaiLogo(m,side);
}
export function miniJetRanger(m,build){
  const point=m.point;m.point=function(p){return point.call(this,[1.3+p[0]*.6,4.5+p[1]*.6,-.4+p[2]*.6]);};build(m);m.point=point;
}
// Lean inward and trail backward around the gripping paw, beneath the same skid.
function hangingPoint([x,y,z],inverse=false){
  const c=Math.cos(.27),s=Math.sin(.27),cp=Math.cos(.18),sp=Math.sin(.18);
  if(inverse){x-=.31;y-=4.77;z-=.1;const yy=y*cp+z*sp,zz=-y*sp+z*cp;return [x*c+yy*s-.85,-x*s+yy*c+5.15,zz];}
  x+=.85;y-=5.15;const xx=x*c-y*s,yy=x*s+y*c;return [.31+xx,4.77+yy*cp-z*sp,.1+yy*sp+z*cp];
}
export function hangingLion(m,build){
  const point=m.point;m.point=function(p){return point.call(this,hangingPoint(p));};
  try{build(m);}finally{m.point=point;}
}
export function drawChopperVulcan(m,phase=0){
  // Belly-mounted gimbal and six-barrel rotary cannon, ahead of the hanging lion.
  for(const side of [-1,1])strut(m,[1.3+side*.33,5.45,.8],[1.3+side*.33,4.65,1.15],.09,navy);
  m.ball(1.3,4.65,1.15,.43,.32,.4,'#566472',10,6);
  m.box(1.3,4.32,1.35,.65,.48,.9,'#293541');
  m.box(1.85,4.35,1,.42,.4,.65,navy);
  for(let i=0;i<6;i++){
    const a=phase*Math.PI/12+i*Math.PI/3,x=1.3+Math.sin(a)*.23,y=4.56+Math.cos(a)*.23;
    strut(m,[x,y,1.65],[x,y,2.9],.075,'#9caeb7');m.ball(x,y,2.96,.055,.055,.025,'#15212b',6,4);
  }
  for(const z of [1.8,2.65])m.ball(1.3,4.56,z,.32,.32,.08,'#455766',12,5);
}
export function drawLionPilot(m,phase=0,cheer=false,hanging=false){
  m.ball(0,2.6,.2,.7,.8,.6,gold,12,7);
  for(const side of [-1,1]){
    const swing=Math.sin(phase*Math.PI/4+side)*.15;
    if(hanging){strut(m,[side*.4,2.2,.2],[side*.45,1.15,.35+swing],.22,gold);m.ball(side*.45,1,.5+swing,.3,.24,.42,gold,9,5);}
    if(!hanging)m.ball(side*.5,2.04,.9,.32,.28,.48,gold,9,5);
    const raised=side>0?Math.max(0,Math.sin(phase*Math.PI/4)):0;
    const holding=hanging&&(side<0||hanging===2);
    const grip=[.31,4.77,side<0?.7:-.2];
    const hand=holding?hangingPoint(grip,true):[side*(.75+raised*.3),2.5+raised*1.3,1.15-raised*.4];
    strut(m,[side*.6,2.8,.3],hand,.2,gold);m.ball(...hand,.27,.26,.24,gold,9,5);
    if(holding)for(let finger=0;finger<3;finger++)m.ball(...hangingPoint([grip[0]+(finger-1)*.1,4.88,grip[2]+.07],true),.06,.1,.09,'#f4c46b',6,4);
  }
  // Oversized mane and head sit above the cabin, visible from the chase camera.
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
export function drawLionMane(m,phase,boost){
  const time=phase*Math.PI/6;
  const lock=(x,y,z,i,edge=false)=>{
    const wave=Math.sin(time+i*1.7),length=(edge?.5:.8)+(boost?.85:0),color=['#8b461f','#a95b29','#bc7434','#d49245'][i%4];
    const centers=[];
    for(let j=0;j<=4;j++){const t=j/4;centers.push([x+Math.sin(time+i*.9+t*3)*t*(boost?.23:.13),y+wave*t*.12-t*t*.12,z-t*length]);}
    for(let j=0;j<4;j++){
      const width=(edge?.29:.32)*(1-j/4),next=(edge?.29:.32)*(1-(j+1)/4),a=centers[j],b=centers[j+1];
      const ring=(p,r,k)=>[p[0]+Math.cos(k*Math.PI/2)*r,p[1]+Math.sin(k*Math.PI/2)*r,p[2]];
      for(let k=0;k<4;k++)m.quad(ring(a,width,k),ring(a,width,k+1),ring(b,next,k+1),ring(b,next,k),k===1?'#df9c4e':color);
    }
  };
  // A complete, layered mane covers the back of the head rather than a flat ring.
  for(let row=0;row<4;row++)for(let i=0;i<16;i++){
    const r=.15+row*.25,a=i*Math.PI/8+row*.35;
    lock(Math.sin(a)*r,4.02+Math.cos(a)*r,.12-Math.sqrt(1-r*r)*.54,i+row*16);
  }
  for(let i=0;i<24;i++){const a=i*Math.PI/12;lock(Math.sin(a)*.95,4.02+Math.cos(a)*.98,.57,i,true);}
}
export function drawJetRangerRotors(m,phase,tilt=0){
  const originalPoint=m.point;
  m.point=function(p){if(p[1]<5)return originalPoint.call(this,p);const y=p[1]-6.15,z=p[2]+.2,c=Math.cos(tilt),s=Math.sin(tilt);return originalPoint.call(this,[p[0],6.15+y*c-z*s,-.2+y*s+z*c]);};
  const a=phase*Math.PI/8,c=Math.cos(a),s=Math.sin(a);
  m.ball(0,6.15,-.2,.28,.16,.28,'#596a78',10,5);
  for(const side of [-1,1]){
    const p=(x,z)=>[x*c+z*s,6.15,-.2-x*s+z*c];
    m.quad(p(side*.25,-.12),p(side*4.7,-.18),p(side*4.7,.16),p(side*.25,.12),navy);
    m.quad(p(side*4.25,-.18),p(side*4.7,-.18),p(side*4.7,.16),p(side*4.25,.16),gold);
    const b=a*3,yy=Math.cos(b)*side,zz=Math.sin(b)*side;
    strut(m,[.26,3.8,-6.1],[.26,3.8+yy,-6.1+zz],.065,cream);
  }
  m.point=originalPoint;
}
export function drawRotorWash(glow,smoke,p,angle,time,jump=null){
  smoke.at(p.x,jump?.height??0,p.z);glow.at(p.x,jump?.height??0,p.z);
  for(let i=0;i<28;i++){
    const t=(time*1.5+i/28)%1,a=i*2.399+time*2,r=1+t*5,fade=1-t;
    smoke.particle(Math.sin(a)*r,.2+t*.5,Math.cos(a)*r,(.6+t*1.8)*fade,[.76,.78,.69]);
    glow.particle(Math.sin(a)*r,.16,Math.cos(a)*r,.16*fade,[.36*fade,.25*fade,.07]);
  }
}
