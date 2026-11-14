export const REVERSE_RADIUS=85;
export const REVERSE_WAVE_LIFE=2.2;

// A suspended cricket, its limbs tugged in opposite directions by a wooden
// control cross. A four-second loop keeps browser and native playback in step.
export function drawCricketPuppet(mesh,glow,pose,time,remaining,heading=0,height=8){
  const phase=time*Math.PI/2,sway=Math.sin(phase*3)*.24,bob=Math.sin(phase*4)*.22;
  const fade=Math.min(1,remaining/.4),body=.5+bob;
  const point=p=>p.map(v=>v*fade);
  const line=(a,b,width,color)=>{a=point(a);b=point(b);const w=width*fade;mesh.quad([a[0]-w,a[1],a[2]],[a[0]+w,a[1],a[2]],[b[0]+w,b[1],b[2]],[b[0]-w,b[1],b[2]],color);mesh.quad([a[0],a[1],a[2]-w],[a[0],a[1],a[2]+w],[b[0],b[1],b[2]+w],[b[0],b[1],b[2]-w],color);};
  mesh.at(pose.x,height,pose.z,heading+sway);glow.at(pose.x,height,pose.z);
  mesh.ball(0,body,0,.48*fade,.8*fade,.35*fade,'#50b42d',10,6);
  mesh.ball(0,body+.95,0,.55*fade,.48*fade,.4*fade,'#93e648',10,6);
  for(const side of [-1,1]){
    mesh.ball(side*.31,body+1.08,.34,.18*fade,.2*fade,.12*fade,'#fff8d0',8,5);
    mesh.ball(side*.31,body+1.08,.44,.07*fade,.1*fade,.03*fade,'#242135',6,4);
    line([side*.23,body+1.3,0],[side*.7,body+2,.03],.025,'#456b22');
    const pull=Math.sin(phase*4+side*Math.PI)*.4;
    const wrist=[side*(1.2+pull*.3),body+.55+pull,0],knee=[side*.95,body-.7,0],foot=[side*1.35,body-1.05-pull,.2];
    line([side*.35,body+.45,0],wrist,.07,'#79ce37');
    line([side*.25,body-.3,0],knee,.12,'#4f9f29');line(knee,foot,.07,'#83d846');
    line([side*1.35,3.7,0],wrist,.016,'#fff0b4');line([side*.7,3.7,-.5],foot,.016,'#fff0b4');
    glow.particle(side*1.35,3.75,0,.24,[.2,.6,.08]);
  }
  line([0,3.7,0],[0,body+1.4,0],.016,'#fff0b4');
  mesh.box(0,3.65,0,3*fade,.16*fade,.24*fade,'#a36b39');mesh.box(0,3.65,0,.24*fade,.16*fade,1.7*fade,'#c59154');
}

// The same expanding haze is recorded for the native client at build time.
export function drawReverseShockwave(glow,smoke,effect){
  const age=effect.age,radius=(effect.radius??REVERSE_RADIUS)*Math.min(1,age/1.05);
  const fade=Math.min(1,age/.12)*Math.max(0,1-age/effect.life);
  if(radius<=0||fade<=0)return;
  glow.at(effect.wx,0,effect.wz);smoke.at(effect.wx,0,effect.wz);
  for(let i=0;i<128;i++){
    const angle=i/128*Math.PI*2,c=Math.cos(angle),s=Math.sin(angle);
    const billow=Math.sin(i*2.4+age*7),height=4+2*billow;
    smoke.particle(c*radius,height,s*radius,(5+radius*.035)*(1+.15*billow),[.18,.66,.12].map(v=>v*fade));
    glow.particle(c*radius,.5,s*radius,2.1,[.12,.9,.08].map(v=>v*fade));
    const next=(i+1)/128*Math.PI*2,inner=Math.max(0,radius-3.5);
    glow.quad([c*inner,.12,s*inner],[c*radius,.12,s*radius],[Math.cos(next)*radius,.12,Math.sin(next)*radius],[Math.cos(next)*inner,.12,Math.sin(next)*inner],[.06,.38,.025].map(v=>v*fade));
    if(i%2===0){const trail=Math.max(0,radius-7-age*3);smoke.particle(c*trail,2+height*.5,s*trail,7,[.1,.4,.06].map(v=>v*fade*.6));}
  }
}
