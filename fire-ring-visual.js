// Curved flame ribbons share the renderer's batched meshes and particle pass.
export function drawFireRing(mesh,glow,effect,time){
  mesh.at(effect.wx,0,effect.wz);glow.at(effect.wx,0,effect.wz);
  const ringRadius=effect.radius??10,spread=ringRadius/20,blue=effect.color==='#4abaff',count=144,tau=Math.PI*2;
  for(let i=0;i<count;i++){
    const angle=i*tau/count,wave=Math.sin(time*8-i*1.9),height=6.8+wave*1.4+Math.sin(time*13+i*.83)*1.1;
    const x=Math.sin(angle)*ringRadius,z=Math.cos(angle)*ringRadius;
    // Two crossing planes keep each curling tongue visible from above and inside.
    for(let plane=0;plane<2;plane++)for(let layer=0;layer<2;layer++){
      const orientation=angle+plane*Math.PI/2,hot=layer===1,h=height*(hot?.64:1),width=(hot?.42:.78)*spread;
      const point=(level,side)=>{
        const t=level/5,lean=Math.sin(time*5+i*.79+t*3)*t*t*1.5,swirl=t*t*1.3;
        return [x+Math.cos(orientation)*(side*width*(1-t)+lean)+Math.sin(angle)*swirl,.15+t*h,z-Math.sin(orientation)*(side*width*(1-t)+lean)+Math.cos(angle)*swirl];
      };
      for(let segment=0;segment<5;segment++){
        const color=blue?(hot?(segment<2?'#ebfbff':'#90ecff'):(segment<2?'#79e0ff':segment<4?'#328eff':'#4436d2')):(hot?(segment<2?'#fff0a6':'#ffbf35'):(segment<2?'#ffb12a':segment<4?'#ff5b10':'#cf2810'));
        mesh.quad(point(segment,-1),point(segment,1),point(segment+1,1),point(segment+1,-1),color);
      }
    }
    glow.particle(x,.55,z,1.5*spread,blue?[.045,.24,.8]:[.65,.13,.008]);
    // Bright fragments rise, spiral and fade without maintaining particle objects.
    for(let ember=0;ember<2;ember++){
      const life=((time*(.55+ember*.13)+i*.618+ember*.37)%1+1)%1,a=angle+life*.5;
      const radius=ringRadius+Math.sin(i*2.4+life*4)*life*1.7,fade=1-life;
      glow.particle(Math.sin(a)*radius,1+life*13,Math.cos(a)*radius,.10+fade*.15,blue?[.12*fade,.5*fade,fade]:[fade,.32*fade,.015*fade]);
    }
  }
}
