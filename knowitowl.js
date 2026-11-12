const white='#f5f4ec',ivory='#e2e4dc',edge='#c1cbd4',gold='#d3ab58',navy='#273b4c';
function rod(m,a,b,r,color){const d=a.map((v,i)=>b[i]-v),l=Math.hypot(...d),n=Math.max(2,Math.ceil(l/.18));for(let i=0;i<=n;i++)m.ball(...a.map((v,j)=>v+d[j]*i/n),r,r,r,color,6,4);}
export function drawBicycle(m,phase){
  for(const z of [-1.9,1.9]){
    for(let i=0;i<36;i++){const a=i*Math.PI/18,b=(i+1)*Math.PI/18;const p=(a,r)=>[0,1.1+Math.cos(a)*r,z+Math.sin(a)*r];m.quad(p(a,1.05),p(b,1.05),p(b,.89),p(a,.89),'#28303c');m.quad([-.055,...p(a,.89).slice(1)],[-.055,...p(b,.89).slice(1)],[.055,...p(b,.89).slice(1)],[.055,...p(a,.89).slice(1)],gold);}
    m.ball(0,1.1,z,.14,.14,.14,gold,8,5);
    for(let i=0;i<12;i++){const a=i*Math.PI/6+phase;rod(m,[0,1.1,z],[0,1.1+Math.cos(a)*.9,z+Math.sin(a)*.9],.025,'#d8dee0');}
  }
  const a=[0,1.1,-1.9],b=[0,.95,0],c=[0,2.35,-.65],d=[0,2.4,1.25],e=[0,1.1,1.9];
  for(const [p,q]of [[a,b],[b,c],[c,a],[c,d],[b,d],[d,e]])rod(m,p,q,.09,navy);
  rod(m,c,[0,2.65,-.72],.07,gold);m.ball(0,2.72,-.72,.47,.1,.32,'#79523f',10,5);
  rod(m,d,[0,3,1.3],.065,gold);rod(m,[-.75,3,1.3],[.75,3,1.3],.07,navy);
  for(const side of [-1,1]){rod(m,[side*.75,3,1.3],[side*.78,2.86,1.5],.09,'#755140');const y=.95+Math.sin(phase)*side*.3,z=Math.cos(phase)*side*.3;rod(m,[0,.95,0],[side*.35,y,z],.045,gold);m.box(side*.48,y,z,.35,.08,.35,navy);}
}
export function drawOwl(m,phase,flight=0,gesture=0){
  const flap=Math.sin(phase*Math.PI/8),bow=gesture===2?.3:0;
  m.ball(0,3.35,-.3,1,.95,.72,white,16,9);
  // Layered breast and shoulder plumage, scalloped rather than a smooth white blob.
  for(let row=0;row<4;row++)for(let i=0;i<7;i++){const a=(i-3)*.32;m.ball(Math.sin(a)*(.9-row*.08),3.8-row*.32,.35+Math.cos(a)*.2,.17,.27,.085,row%2?white:ivory,7,5);}
  for(const side of [-1,1]){
    const point=m.point,wingAngle=flight*(.8+flap*.43)+(gesture===1&&side===1?.7:gesture===2?.8:gesture===4?1.4:0);
    m.point=function([x,y,z]){const xx=x* Math.cos(wingAngle)-y*Math.sin(wingAngle),yy=x*Math.sin(wingAngle)+y*Math.cos(wingAngle);return point.call(this,[side*(.75+xx),3.55+yy,-.35+z]);};
    try{m.ball(.4,-.3,0,.6,.8,.26,ivory,10,6);for(let i=0;i<9;i++){const x=.15+i*.19,y=-.2-i*.1,len=.9+i*.11;m.ball(x,y-len*.45,-.05,.15,len*.58,.14,i%2?white:ivory,8,6);m.box(x,y-len*.55,.095,.018,len*.65,.015,edge);}}finally{m.point=point;}
    const pedal=Math.sin(phase*Math.PI/8)*.22*(1-flight);rod(m,[side*.34,2.75,-.35],[side*.5,2.05+pedal,.1],.13,ivory);m.ball(side*.5,1.98+pedal,.2,.28,.12,.4,gold,8,5);
    for(let i=0;i<4;i++)m.ball(side*(.15+i*.16),2.85,-.98,.15,.4,.13,ivory,8,5);
  }
  const point=m.point;m.point=function([x,y,z]){const c=Math.cos(bow),s=Math.sin(bow);return point.call(this,[x,4.3+y*c-z*s,.05+y*s+z*c]);};
  try{
    m.ball(0,.45,0,1.12,1.05,.83,white,18,11);
    for(const side of [-1,1]){
      m.ball(side*.48,.48,.63,.51,.61,.23,'#e8dfce',14,9);m.ball(side*.46,.48,.8,.36,.4,.07,white,12,7);
      const wink=gesture===3&&side===-1;m.ball(side*.43,.48,.87,.22,wink?.025:.22,.04,'#ddb665',12,6);m.ball(side*.4,.48,.91,.105,wink?.012:.14,.025,'#263749',10,5);m.ball(side*.37,.54,.94,.035,.04,.015,white,7,4);
      m.ball(side*.47,.71,.9,.28,.095,.03,white,10,5);
      for(let i=0;i<4;i++)m.ball(side*(.73+i*.065),1.01+i*.1,-.07,.13,.25-i*.035,.12,white,8,5);
      rod(m,[side*.2,.85,.82],[side*.7,.77,.8],.055,edge);
    }
    m.cone(0,.1,.9,.16,.3,gold,7);
    // Gold monocle, clear eye and a hanging watch-chain.
    for(let i=0;i<40;i++){const a=i*Math.PI/20,b=(i+1)*Math.PI/20;rod(m,[.46+Math.cos(a)*.39,.48+Math.sin(a)*.43,.96],[.46+Math.cos(b)*.39,.48+Math.sin(b)*.43,.96],.025,gold);}
    rod(m,[.8,.32,.8],[.93,-.25,.6],.024,gold);rod(m,[.93,-.25,.6],[.6,-.6,.65],.024,gold);
  }finally{m.point=point;}
  m.box(0,4,.64,.14,.12,.06,gold);for(const side of [-1,1])m.ball(side*.2,4,.64,.22,.13,.08,navy,8,5);
}
export function drawFeather(m,size=1){
  for(let i=0;i<8;i++){const t=i/8,u=(i+1)/8,w=Math.sin(t*Math.PI)*.22*size,ww=Math.sin(u*Math.PI)*.22*size;m.quad([-w,t*size,0],[w,t*size,0],[ww,u*size,.04*Math.sin(u*Math.PI)],[-ww,u*size,.04*Math.sin(u*Math.PI)],i%3?white:edge);}
  m.box(0,0,.015,.022,size,.025,'#c9b986');
}
export class OwlFlight{
  riders=new Map();feathers=[];
  draw(renderer,m,p,color,yaw,spin,boost,time,celebrate,jump,gesture){
    const id=p.id??'preview';let s=this.riders.get(id);if(!s||time<s.time||time-s.time>1){s={time,amount:boost?1:0,drop:boost?time-2:-99,last:0,boost};this.riders.set(id,s);}
    const dt=Math.min(.05,Math.max(0,time-s.time));s.time=time;if(boost&&!s.boost)s.drop=time;s.boost=boost;s.amount+=(Number(boost)-s.amount)*(1-Math.exp(-dt*8));
    const a=s.amount,angle=Math.atan2(p.tx,p.tz)-yaw+spin,height=(jump?.height??0)+a*(2.4+Math.sin(time*5)*.15),phase=Math.floor(time*(boost?18:7))%16;
    const elapsed=time-s.drop,bikeScale=boost?Math.max(0,1-Math.max(0,elapsed-.65)*2):1;
    if(bikeScale>0)renderer.model('owl:bike:'+phase+':'+Math.round(bikeScale*12),p.x,height*(1-a)-(boost?Math.min(.25,elapsed*.3):0),p.z-a*Math.min(2,elapsed*2),angle,mesh=>{const point=mesh.point;mesh.point=function(v){return point.call(this,v.map(n=>n*bikeScale));};drawBicycle(mesh,phase*Math.PI/8);},jump?.pitch??0,null,boost?Math.min(1.4,elapsed*2):0);
    const pose=celebrate>0?1+Math.floor(time*1.3)%4:gesture?.id==='hello'?1:gesture?.id==='cheer'?2:gesture?.id==='look'?3:0;
    renderer.model('owl:body:'+phase+':'+Math.round(a*20)+':'+pose,p.x,height+(gesture?.bounce??0),p.z,angle+(gesture?.yaw??0)+(pose===4?Math.sin(time*4)*.45:0),mesh=>drawOwl(mesh,phase,a,pose),(jump?.pitch??0)+(pose===2?.15:0));
    if(boost&&time-s.last>.055){s.last=time;const side=Math.sin(time*29)>0?1:-1;this.feathers.push({x:p.x+Math.cos(angle)*side*(1.2+a),z:p.z-Math.sin(angle)*side*(1.2+a),y:height+3.5,vx:-Math.sin(angle)*3+side,vz:-Math.cos(angle)*3,age:0,time,seed:time*11});}
    // Update once per rendered timestamp, shared by all owls.
    if(this.time!==time){const delta=this.time===undefined?0:Math.min(.05,Math.max(0,time-this.time));if(time<(this.time??0))this.feathers=[];this.time=time;for(const f of this.feathers){f.age+=delta;f.x+=f.vx*delta;f.z+=f.vz*delta;f.y-=delta*(.6+f.age*.5);}this.feathers=this.feathers.filter(f=>f.age<2.2).slice(-90);}
  }
  trail(m){for(const f of this.feathers){m.at(f.x+Math.sin(f.age*5+f.seed)*.3,Math.max(.15,f.y),f.z,f.seed+f.age*2);m.roll=Math.sin(f.seed+f.age*6)*1.1;m.pitch=f.age*.5;drawFeather(m,(1-f.age/2.2)*.9);}}
}
