export const REVERSE_RADIUS=85;
export const REVERSE_WAVE_LIFE=2.2;

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
