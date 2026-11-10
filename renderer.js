import { sampleTrack, branches } from './track.js';
import { LENGTH, drivers, pickupType } from './engine.js';
import { arenas, combatPose } from './combat.js';
const rgb=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm=a=>{const l=Math.hypot(...a)||1;return a.map(v=>v/l);};
const dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0);
class Mesh {
  data=[];sprites=[];origin=[0,0,0];angle=0;
  at(x,y,z,angle=0){this.origin=[x,y,z];this.angle=angle;return this;}
  point(p){const c=Math.cos(this.angle),s=Math.sin(this.angle);return [this.origin[0]+p[0]*c+p[2]*s,this.origin[1]+p[1],this.origin[2]-p[0]*s+p[2]*c];}
  particle(x,y,z,size,color){this.sprites.push(...this.point([x,y,z]),size,...color);}
  tri(a,b,c,color){const points=[a,b,c].map(p=>this.point(p)),n=norm(cross(sub(points[1],points[0]),sub(points[2],points[0])));const col=typeof color==='string'?rgb(color):color;for(const p of points)this.data.push(...p,...n,...col);}
  quad(a,b,c,d,color){this.tri(a,b,c,color);this.tri(a,c,d,color);}
  box(x,y,z,w,h,d,color){const a=[x-w/2,y,z-d/2],b=[x+w/2,y,z-d/2],c=[x+w/2,y+h,z-d/2],e=[x-w/2,y+h,z-d/2],f=[x-w/2,y,z+d/2],g=[x+w/2,y,z+d/2],i=[x+w/2,y+h,z+d/2],j=[x-w/2,y+h,z+d/2];this.quad(a,e,c,b,color);this.quad(f,g,i,j,color);this.quad(e,j,i,c,color);this.quad(a,f,j,e,color);this.quad(b,c,i,g,color);this.quad(a,b,g,f,color);}
  ball(x,y,z,rx,ry,rz,color,segments=10,rings=6){for(let v=0;v<rings;v++)for(let u=0;u<segments;u++){const p=(i,j)=>{const a=i/segments*Math.PI*2,b=j/rings*Math.PI;return[x+Math.cos(a)*Math.sin(b)*rx,y+Math.cos(b)*ry,z+Math.sin(a)*Math.sin(b)*rz];};this.quad(p(u,v),p(u+1,v),p(u+1,v+1),p(u,v+1),color);}}
  cone(x,y,z,r,h,color,n=9){for(let i=0;i<n;i++){const a=i/n*Math.PI*2,b=(i+1)/n*Math.PI*2;this.tri([x+Math.sin(a)*r,y,z+Math.cos(a)*r],[x+Math.sin(b)*r,y,z+Math.cos(b)*r],[x,y+h,z],color);}}
  disc(x,y,z,rx,rz,color,n=14){for(let i=0;i<n;i++){const a=i/n*Math.PI*2,b=(i+1)/n*Math.PI*2;this.tri([x,y,z],[x+Math.sin(a)*rx,y,z+Math.cos(a)*rz],[x+Math.sin(b)*rx,y,z+Math.cos(b)*rz],color);}}
  flame(x,y,z,r,length,color,clock){
    const p=(ring,side)=>{const t=ring/7,a=side/8*Math.PI*2,radius=r*Math.sin((.16+t*.84)*Math.PI)*(1+.14*Math.sin(clock*43+ring*2+side));return[x+Math.cos(a)*radius+Math.sin(clock*31+ring)*t*.08,y+Math.sin(a)*radius,z-t*length];};
    for(let ring=0;ring<7;ring++)for(let side=0;side<8;side++)this.quad(p(ring,side),p(ring,side+1),p(ring+1,side+1),p(ring+1,side),color);
  }
}
function multiply(a,b){const out=new Float32Array(16);for(let c=0;c<4;c++)for(let r=0;r<4;r++)for(let k=0;k<4;k++)out[c*4+r]+=a[k*4+r]*b[c*4+k];return out;}
function cameraMatrix(eye,target,aspect,fov){const z=norm(sub(eye,target)),x=norm(cross([0,1,0],z)),y=cross(z,x),view=new Float32Array([x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-dot(x,eye),-dot(y,eye),-dot(z,eye),1]);const f=1/Math.tan(fov/2),near=.3,far=1600;return multiply(new Float32Array([f/aspect,0,0,0,0,f,0,0,0,0,(far+near)/(near-far),-1,0,0,2*far*near/(near-far),0]),view);}
function shader(gl,type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;}
export class Renderer {
  constructor(canvas){
    this.canvas=canvas;const gl=this.gl=canvas.getContext('webgl',{antialias:true,alpha:false});if(!gl)throw new Error('This game requires WebGL. Enable hardware acceleration in your browser.');
    this.models=new Map();this.instances=[];this.quality='auto';this.resolution=1.25;this.fps=0;this.fpsStart=0;this.frameCount=0;this.slowWindows=0;this.fastWindows=0;
    const debug=gl.getExtension('WEBGL_debug_renderer_info');this.gpuName=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):'WebGL';this.softwareGPU=/swiftshader|llvmpipe|software/i.test(this.gpuName);if(this.softwareGPU)this.resolution=.75;
    this.program=gl.createProgram();
    gl.attachShader(this.program,shader(gl,gl.VERTEX_SHADER,`attribute vec3 position;attribute vec3 normal;attribute vec3 color;uniform mat4 matrix;uniform vec3 eye;uniform vec3 origin;uniform vec2 rotation;uniform float emission;varying vec3 shade;varying float distanceToEye;void main(){vec3 p=vec3(position.x*rotation.x+position.z*rotation.y,position.y,-position.x*rotation.y+position.z*rotation.x)+origin;vec3 n=vec3(normal.x*rotation.x+normal.z*rotation.y,normal.y,-normal.x*rotation.y+normal.z*rotation.x);gl_Position=matrix*vec4(p,1.0);float light=.62+.38*max(0.,dot(normalize(n),normalize(vec3(-.5,1.,.3))));shade=color*mix(light,1.,emission);distanceToEye=length(p-eye);}`));
    gl.attachShader(this.program,shader(gl,gl.FRAGMENT_SHADER,`precision mediump float;varying vec3 shade;varying float distanceToEye;uniform vec3 fog;void main(){float amount=smoothstep(130.,950.,distanceToEye);gl_FragColor=vec4(mix(shade,fog,amount*.92),1.);}`));
    gl.linkProgram(this.program);if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(this.program));gl.useProgram(this.program);
    this.attributes=['position','normal','color'].map(n=>gl.getAttribLocation(this.program,n));this.matrix=gl.getUniformLocation(this.program,'matrix');this.eyeUniform=gl.getUniformLocation(this.program,'eye');this.fog=gl.getUniformLocation(this.program,'fog');this.emission=gl.getUniformLocation(this.program,'emission');this.staticBuffer=gl.createBuffer();this.dynamicBuffer=gl.createBuffer();this.glowBuffer=gl.createBuffer();gl.enable(gl.DEPTH_TEST);this.track=-1;this.eye=null;
    this.originUniform=gl.getUniformLocation(this.program,'origin');this.rotationUniform=gl.getUniformLocation(this.program,'rotation');gl.uniform3f(this.originUniform,0,0,0);gl.uniform2f(this.rotationUniform,1,0);
    this.particleProgram=gl.createProgram();
    gl.attachShader(this.particleProgram,shader(gl,gl.VERTEX_SHADER,`attribute vec3 position;attribute float size;attribute vec3 color;uniform mat4 matrix;uniform float height;varying vec3 tint;void main(){gl_Position=matrix*vec4(position,1.);gl_PointSize=clamp(size*height/max(.1,gl_Position.w),1.,180.);tint=color;}`));
    gl.attachShader(this.particleProgram,shader(gl,gl.FRAGMENT_SHADER,`precision mediump float;varying vec3 tint;uniform float smoke;void main(){vec2 p=gl_PointCoord*2.-1.;float r=length(p);float glow=exp(-r*r*3.5)*(1.-smoothstep(.65,1.,r));gl_FragColor=smoke>.5?vec4(tint,glow*.5):vec4(tint*glow,1.);}`));
    gl.linkProgram(this.particleProgram);if(!gl.getProgramParameter(this.particleProgram,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(this.particleProgram));
    this.particleBuffer=gl.createBuffer();this.particleAttributes=['position','size','color'].map(n=>gl.getAttribLocation(this.particleProgram,n));this.particleMatrix=gl.getUniformLocation(this.particleProgram,'matrix');this.particleHeight=gl.getUniformLocation(this.particleProgram,'height');this.particleSmoke=gl.getUniformLocation(this.particleProgram,'smoke');
  }
  recordFrame(now){
    if(!this.fpsStart)this.fpsStart=now;this.frameCount++;const elapsed=now-this.fpsStart;if(elapsed<1000)return;
    this.fps=Math.round(this.frameCount*1000/elapsed);this.frameCount=0;this.fpsStart=now;
    if(this.quality!=='auto')return;
    this.slowWindows=this.fps<45?this.slowWindows+1:0;this.fastWindows=this.fps>57?this.fastWindows+1:0;
    if(this.slowWindows>=2){this.resolution=Math.max(.65,this.resolution-.15);this.slowWindows=0;}
    if(this.fastWindows>=8){this.resolution=Math.min(this.softwareGPU?.85:1.25,this.resolution+.1);this.fastWindows=0;}
  }
  setQuality(quality){this.quality=quality;this.resolution=({high:2,balanced:1,low:.65,auto:this.softwareGPU?.75:1.25})[quality];this.slowWindows=0;this.fastWindows=0;}
  pixelRatio(){return Math.min(devicePixelRatio,this.resolution);}
  model(key,x,y,z,angle,build){
    let model=this.models.get(key);
    if(!model){const mesh=new Mesh();this.buildingModel=true;try{build(mesh);}finally{this.buildingModel=false;}const buffer=this.gl.createBuffer();this.gl.bindBuffer(this.gl.ARRAY_BUFFER,buffer);this.gl.bufferData(this.gl.ARRAY_BUFFER,new Float32Array(mesh.data),this.gl.STATIC_DRAW);model={buffer,count:mesh.data.length/9};this.models.set(key,model);}
    this.instances.push({...model,x,y,z,angle});
  }
  scenery(track){
    const m=new Mesh(),sunset=track===1;const grass=sunset?'#91a856':'#6da94d';
    for(let x=-1100;x<1100;x+=80)for(let z=-1100;z<1100;z+=80)m.quad([x,-.2,z],[x,-.2,z+80],[x+80,-.2,z+80],[x+80,-.2,z],grass);
    // The lake, island and distant mountains give the circuit a visible setting.
    m.disc(75,-.12,-30,112,95,sunset?'#dba38c':'#60bac4',48);m.disc(75,-.10,-30,85,69,sunset?'#c7938a':'#58abbf',48);
    for(let i=0;i<22;i++){const a=i/22*Math.PI*2,x=Math.cos(a)*810,z=Math.sin(a)*810;m.cone(x,-2,z,160,130+(i%4)*45,sunset?'#aa8694':'#789c93',6);m.cone(x,125+(i%4)*35,z,30,45,'#e5e6d3',6);}
    const N=720;
    for(let i=0;i<N;i++){
      const a=sampleTrack(i/N),b=sampleTrack((i+1)/N),p=(o,l,y)=>[o.x+o.nx*l,y,o.z+o.nz*l];
      m.quad(p(a,-20,.01),p(b,-20,.01),p(b,20,.01),p(a,20,.01),'#d3bf8a');
      m.quad(p(a,-18,.04),p(b,-18,.04),p(b,18,.04),p(a,18,.04),i%2?'#555a64':'#575c65');
      for(const side of [-1,1]){
        m.quad(p(a,side*17,.07),p(b,side*17,.07),p(b,side*18,.07),p(a,side*18,.07),Math.floor(i/3)%2?'#faf0d6':'#e05e4b');
        if(i%3===0&&!branches.some(f=>Math.abs(i/N-f.start)<.025||Math.abs(i/N-f.end)<.025)){const q=sampleTrack(i/N,side*1.28);m.at(q.x,.1,q.z,Math.atan2(q.tx,q.tz));m.box(0,0,0,1.2,1.4,3.2,i%6?'#fff0cb':'#dd7356');m.at(0,0,0);}
      }
      if(i%10<4)for(const lane of [-6,6])m.quad(p(a,lane-.12,.08),p(b,lane-.12,.08),p(b,lane+.12,.08),p(a,lane+.12,.08),'#c9cbb6');
      if(i<3)for(let j=0;j<18;j++)m.quad(p(a,-17+j*34/18,.09),p(b,-17+j*34/18,.09),p(b,-17+(j+1)*34/18,.09),p(a,-17+(j+1)*34/18,.09),(i+j)%2?'#fff5da':'#252a3a');
    }
    for(const [index,branch] of branches.entries()){
      for(let i=0;i<100;i++){
        const a=sampleTrack(branch.start+(branch.end-branch.start)*i/100,0,index+1),b=sampleTrack(branch.start+(branch.end-branch.start)*(i+1)/100,0,index+1),p=(o,l,y=.12)=>[o.x+o.nx*l,y,o.z+o.nz*l];
        m.quad(p(a,-18),p(b,-18),p(b,18),p(a,18),index?'#6d677c':'#6e7464');
        for(const side of [-1,1])m.quad(p(a,side*16.8,.14),p(b,side*16.8,.14),p(b,side*18,.14),p(a,side*18,.14),i%4<2?'#e8bb61':'#fff1bc');
      }
      const sign=sampleTrack(branch.start-.012,branch.side*1.05);m.at(sign.x,0,sign.z,Math.atan2(sign.tx,sign.tz));m.box(0,0,0,.35,7,.35,'#e4d9bc');m.box(0,5,0,6,3,.3,'#d9ad4d');m.box(0,6,-.2,3,.4,.15,'#343345');m.tri([-branch.side*2.5,6.2,-.3],[-branch.side*.5,7.1,-.3],[-branch.side*.5,5.3,-.3],'#343345');m.at(0,0,0);
    }
    for(let i=0;i<155;i++){
      const side=i%2?1:-1,p=sampleTrack(i/155,side*(1.8+(i%5)*.24));if(branches.some(b=>i/155>b.start-.02&&i/155<b.end+.02&&side===b.side))continue;m.at(p.x,0,p.z);
      m.disc(1,.02,1,4,4,'#578b45');m.box(0,0,0,1,5,1,'#896b43');
      switch(i%3){case 0:m.ball(0,8,0,4,5,4,'#40834a',7,4);m.ball(2,6,0,3,3,3,'#63a24b',7,4);break;default:m.cone(0,3,0,5,9,'#32775b');m.cone(0,7,0,3.8,8,'#439768');break;}
      if(i%4===0){m.at(p.x+5,0,p.z+4);m.ball(0,1.2,0,2.4,1.4,1.8,'#a4aaa0',6,3);}
    }
    for(let i=0;i<110;i++){const p=sampleTrack(i/110,(i%2?1:-1)*1.4);m.at(p.x,.15,p.z);for(let j=0;j<3;j++){m.box(j*.6,0,0,.06,.7,.06,'#4c823d');m.ball(j*.6,.7,0,.22,.14,.22,j%2?'#f4c955':'#f8e5b3',5,3);}}
    // Grandstand and a chequered starting gantry.
    const start=sampleTrack(.002);m.at(start.x,0,start.z,Math.atan2(start.tx,start.tz));
    for(const side of [-1,1])m.box(side*20,0,0,1,13,1,'#e8dfcb');m.box(0,11.5,0,41,3,1,'#282b43');
    for(let i=0;i<20;i++)for(let j=0;j<2;j++)m.box(-19+i*2,12+j, -.55,2,1,.12,(i+j)%2?'#eee8d5':'#33364c');
    m.box(0,10.4,0,8,.7,1,'#e8bb52');
    const stand=sampleTrack(.025,-2.05);m.at(stand.x,0,stand.z,Math.atan2(stand.tx,stand.tz));for(let i=0;i<4;i++){m.box(-i*2,0,0,2,1+i*1.5,24,'#ded3b8');for(let j=0;j<12;j++){m.ball(-i*2,2+i*1.5,-11+j*2,.5,.8,.5,['#edbf60','#865dbc','#e07862','#659fae'][(i+j)%4],6,4);}}
    m.at(0,0,0);this.gl.bindBuffer(this.gl.ARRAY_BUFFER,this.staticBuffer);this.gl.bufferData(this.gl.ARRAY_BUFFER,new Float32Array(m.data),this.gl.STATIC_DRAW);this.staticCount=m.data.length/9;this.track=track;
  }
  kart(m,p,color,driver,yaw=0,spin=0,boost=false,clock=0,celebrate=0){
    if(!this.buildingModel&&celebrate<=0){const angle=Math.atan2(p.tx,p.tz)-yaw+spin;this.model(`kart:${driver}:${color}`,p.x,0,p.z,angle,mesh=>this.kart(mesh,{x:0,z:0,tx:0,tz:1},color,driver));if(boost)this.afterburner(p,angle,clock);return;}
    const angle=Math.atan2(p.tx,p.tz)-yaw+spin;m.at(p.x,.13,p.z,angle);m.disc(.2,0,.25,2.3,3,'#3a4147');
    for(const x of [-1.6,1.6])for(const z of [-1.5,1.4]){m.ball(x,.65,z,.58,.68,.7,'#202534',8,5);m.box(x+Math.sign(x)*.5,.38,z,.08,.52,.6,'#b9b9b7');for(let t=0;t<3;t++)m.box(x,.7,z-.4+t*.3,1.05,.06,.08,'#343a45');}
    m.box(0,.5,0,3.2,.65,4.4,color);m.box(0,1.1,.9,2.7,.35,1.8,color);m.box(0,.55,2.2,3.5,.3,.35,'#c5c9c4');m.box(0,.5,-2.3,3.7,.3,.35,'#30384b');
    m.box(0,1,-.4,1.8,1.2,1.5,'#333445');m.box(0,1.2,-1.4,2.4,.6,.6,color);
    // Rotate only the driver, leaving the chassis, wheels and steering untouched.
    const progress=1.6-celebrate,envelope=celebrate>0?Math.min(1,progress/.25,celebrate/.4):0;
    const turn=envelope*envelope*(3-2*envelope),bounce=turn*Math.sin(progress*15)*.1;
    m.at(p.x,.13+bounce,p.z,angle+Math.PI*turn);
    m.ball(0,2.2,0,1,1.1,.8,driver===0?'#252b36':['#9a9ba0','#d3883f','#8c5f42'][driver-1]);
    const fur=['#eee8d8','#969798','#e69a43','#9b7250'][driver];
    m.ball(0,3.55,.15,1.05,1.05,.94,fur,12,7);
    switch(driver){
      case 2:for(const side of [-1,1]){m.cone(side*.68,4.1,.2,.43,.95,'#d87a32',4);m.cone(side*.68,4.35,.2,.23,.55,'#3c3136',4);}break;
      default:for(const side of [-1,1])m.ball(side*.8,4.3,.15,.4,.43,.3,driver===0?'#242a36':fur,8,5);break;
    }
    // The same face becomes visible when the driver looks back to celebrate.
    for(const side of [-1,1]){
      if(driver===0)m.ball(side*.42,3.65,.91,.29,.32,.11,'#292d39');m.ball(side*.4,3.7,1.01,.1,.13,.05,'#242838');
      const handY=2.1+turn*(2.1+Math.sin(progress*18+side)*.22),handX=side*(.85+turn*.5),handZ=1-turn*.7;
      m.ball(side*(.85+turn*.2),(2.1+handY)/2,(handZ+.3)/2,.24,.3+turn*.55,.24,fur,8,5);
      m.ball(handX,handY,handZ,.32,.32,.32,fur);
    }
    m.ball(0,3.35,1.02,.43,.3,.3,'#f3dfb6');m.ball(0,3.45,1.3,.17,.12,.1,'#252a32');
    if(turn>.2)m.ball(0,3.2,1.28,.19,.08+turn*.06,.04,'#3f2936',8,4);
    if(driver===1)for(let i=0;i<5;i++)m.ball(0,1.2+i*.2,-1.1-i*.15,.32,.3,.3,i%2?'#3a3c45':'#a6a3a0');
    if(driver===2)m.ball(.1,1.5,-1.1,.5,.6,.7,'#f1b15c');
    m.at(p.x,.13,p.z,angle);
    if(turn>.7){this.glow.at(p.x,.13,p.z,angle);for(let i=0;i<3;i++){const a=progress*3+i*2.1;this.glow.particle(Math.cos(a)*1.9,5+Math.sin(a)*.25,Math.sin(a)*.5,.45,[.55,.35,.07]);}}
    m.box(-1,1.15,-2.1,.55,.3,.12,'#ff765a');m.box(1,1.15,-2.1,.55,.3,.12,'#ff765a');
    m.box(0,1.2,-2.25,.8,.35,.12,'#f7edce');m.box(0,1.26,-2.33,.12,.25,.03,'#33364b');
    for(const side of [-1,1]){m.ball(side*1.2,.75,-2.45,.31,.31,.5,'#69788b',10,5);m.ball(side*1.2,.75,-2.85,.24,.24,.08,'#161d2a',10,4);}
    if(boost)this.afterburner(p,angle,clock);
  }
  afterburner(p,angle,clock){
    const g=this.glow;g.at(p.x,.13,p.z,angle);
    for(const side of [-1,1]){
      const x=side*1.2,flicker=1+.15*Math.sin(clock*48+side)+.07*Math.sin(clock*81);
      g.flame(x,.75,-2.85,.35,4.8*flicker,[.07,.018,.003],clock+side);
      g.flame(x,.75,-2.86,.22,2.8*flicker,[.025,.08,.17],clock+side);
      g.flame(x,.75,-2.87,.12,1.7*flicker,[.3,.45,.6],clock);
      for(let i=0;i<18;i++){const t=i/18,jitter=Math.sin(clock*56+i*4)*t*.08;g.particle(x+jitter,.75,-2.9-t*4.8*flicker,(1.0-t*.65)*flicker,[.26*(1-t),.08*(1-t),.008]);if(i<9)g.particle(x,.75,-2.9-t*3, .65-t*.3,[.06,.15,.24]);}
      for(let i=0;i<4;i++)g.ball(x,.75,-3.2-i*.65,.13,.13,.22,[.16,.23,.32],7,4);
      for(let i=0;i<10;i++){const age=(clock*2.8+i*.137)%1;g.ball(x+Math.sin(i*9)*age*.65,.75+Math.cos(i*7)*age*.3,-3-age*7,.035,.035,.15,[.5*(1-age),.17*(1-age),.02],5,3);}
      g.disc(x,.02,-3.7,1.2,2.8,[.08,.035,.008]);
    }
  }
  missile(m,p,height=1.6,angle=Math.atan2(p.tx,p.tz),size=1){
    if(!this.buildingModel){this.model(`missile:${size}`,p.x,height,p.z,angle,mesh=>this.missile(mesh,{x:0,z:0,tx:0,tz:1},0,0,size));return;}
    m.at(p.x,height,p.z,angle);m.ball(0,0,0,.3*size,.3*size,1.1*size,'#e9eef2',10,5);m.ball(0,0,1*size,.3*size,.3*size,.5*size,'#e85c4b',8,5);
    m.box(0,-.04*size,-.65*size,1.4*size,.08*size,.7*size,'#d34d40');m.box(0,-.6*size,-.65*size,.08*size,1.2*size,.7*size,'#d34d40');m.ball(0,0,-1.02*size,.2*size,.2*size,.15*size,'#384654',8,4);
  }
  explosion(m,fx){
    const p=fx.wx!==undefined?{x:fx.wx,z:fx.wz}:sampleTrack(fx.s/LENGTH,fx.x,fx.route),t=fx.age,g=this.glow;
    if(t<.65){const radius=.6+Math.sin(t/.65*Math.PI)*5;g.at(p.x,2,p.z);g.ball(0,0,0,radius,radius*.8,radius,[.3*(1-t),.09*(1-t),.015],12,7);g.ball(0,0,0,radius*.5,radius*.5,radius*.5,[.6,.45,.2],10,5);g.particle(0,0,0,radius*5,[.9,.25,.025]);}
    if(t<1){g.at(p.x,.2,p.z);for(let i=0;i<40;i++){const a=i/40*Math.PI*2,rad=t*15;g.ball(Math.cos(a)*rad,0,Math.sin(a)*rad,.4,.08,.4,[.35*(1-t),.18*(1-t),.03],5,3);}}
    for(let i=0;i<24;i++){
      const a=i*2.399,speed=4+i%6*2,d=t*speed,y=Math.max(.15,1+(7+i%5)*t-7*t*t);
      m.at(p.x+Math.cos(a)*d,y,p.z+Math.sin(a)*d,t*(i%3+2));
      if(i<8){m.box(0,0,0,.35,.25,.65,['#252e3c','#b9c5c9','#e29458'][i%3]);continue;}
      g.at(p.x+Math.cos(a)*d,y,p.z+Math.sin(a)*d);g.ball(0,0,0,.09,.09,.25,[.6*(1-t/fx.life),.18,.01],5,3);
    }
    for(let i=0;i<10;i++){const a=i*2.399,d=t*(1+i%3),size=(.6+t*1.4)*(1-t/fx.life);m.at(p.x+Math.cos(a)*d,1+t*3+(i%3)*.5,p.z+Math.sin(a)*d);m.ball(0,0,0,size,size,size,t<.25?'#dd8443':i%2?'#555967':'#777b83',7,4);}
  }
  hedgehog(m,x,y,z,size,angle=0){if(!this.buildingModel){this.model(`hedgehog:${size}`,x,y,z,angle,mesh=>this.hedgehog(mesh,0,0,0,size));return;}m.at(x,y,z,angle);m.ball(0,0,0,size,size*.8,size,'#79513b',8,5);for(let i=0;i<9;i++){const a=i/9*Math.PI*2;m.cone(Math.cos(a)*size*.6,size*.2,Math.sin(a)*size*.6,size*.25,size*.85,'#dab67f',4);}m.ball(0,-size*.1,size*.85,size*.5,size*.4,size*.4,'#eed1a1',7,4);m.ball(0,0,size*1.2,size*.15,size*.15,size*.15,'#242a34',6,3);}
  draw(r,time){
    this.instances=[];
    if(r.mode==='combat'){this.drawBattle(r,time);return;}
    if(this.track!==r.track)this.scenery(r.track);
    const gl=this.gl,canvas=this.canvas;const width=Math.round(canvas.clientWidth*this.pixelRatio()),height=Math.round(canvas.clientHeight*this.pixelRatio());if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}gl.viewport(0,0,width,height);
    const sky=rgb(r.track?'#e4b0a3':'#a0d6e5');gl.clearColor(...sky,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.useProgram(this.program);
    const player=sampleTrack(r.s/LENGTH,r.x,r.route),ahead=sampleTrack((r.s+220)/LENGTH,r.x*.6,r.route);
    const shake=r.shake*Math.sin(time*79)*.3,eye=[player.x-player.tx*17+shake,8.5+(r.boost>0?.7:0),player.z-player.tz*17];
    const view=cameraMatrix(eye,[ahead.x,2.5,ahead.z],width/height,r.boost>0?1.2:1.07);
    gl.uniformMatrix4fv(this.matrix,false,view);gl.uniform3fv(this.eyeUniform,eye);gl.uniform3fv(this.fog,sky);gl.uniform1f(this.emission,0);
    this.drawBuffer(this.staticBuffer,this.staticCount);
    const m=new Mesh();this.glow=new Mesh();this.smoke=new Mesh();
    for(const skid of r.skids){const p=sampleTrack(skid.s/LENGTH,skid.x,skid.route);m.at(p.x,.1,p.z,Math.atan2(p.tx,p.tz));for(const side of [-1,1])m.box(side*1.5,0,0,.35,.015,1.3,'#353b44');}
    for(let row=Math.max(0,Math.floor((r.s-1000)/1800));row<Math.floor(r.s/1800)+8;row++){
      if(row===r.pickup)continue;const s=row*1800+1000;if(s<r.s-100)continue;
      for(const lane of [-.65,0,.65]){
        const p=sampleTrack(s/LENGTH,lane,r.route),bob=Math.sin(time*2+row)*.3,type=pickupType(row,lane);m.at(p.x,.15,p.z);m.disc(0,0,0,1.7,1.7,type==='missile'?'#de6053':lane===0?'#dfb94b':'#a79c78');
        if(type==='missile'){this.missile(m,p,1.7+bob,time,1.6);continue;}
        if(type==='hedgehog'){this.hedgehog(m,p.x,1.4+bob,p.z,1.0,time);continue;}
        m.at(p.x,1+bob,p.z,time);m.box(0,0,0,1.3,2,.8,'#f5cd55');m.box(0,2,0,.6,.3,.5,'#fff2bb');m.box(0,.2,-.44,.9,1.5,.1,'#fbec9e');m.box(0,.6,-.51,.25,.8,.05,'#de8c38');
      }
    }
    for(const b of r.bots){const p=sampleTrack(b.s/LENGTH,b.x,b.route);if(b.destroyed>0){m.at(p.x,.1,p.z);m.disc(0,0,0,2.2,3,'#333844');continue;}this.kart(m,p,b.color,b.driver,b.yaw,b.spin,b.boost>0,time);if(b.stun>0){for(let i=0;i<3;i++){const a=time*5+i*2.1;m.at(p.x+Math.cos(a)*1.6,5,p.z+Math.sin(a)*1.6);m.ball(0,0,0,.22,.22,.22,'#ffe688',5,3);}}}
    this.kart(m,player,drivers[r.driver].color,r.driver,r.yaw,r.spin,r.boost>0,time,r.celebrate);
    for(const shot of r.projectiles){const p=sampleTrack(shot.s/LENGTH,shot.x,shot.route);
      if(shot.kind==='missile'){
        this.missile(m,p,shot.height);this.glow.at(p.x,shot.height,p.z,Math.atan2(p.tx,p.tz));this.glow.flame(0,0,-1.1,.3,2.2,[.5,.2,.04],time);
        for(let i=0;i<shot.trail.length;i+=2){const trail=shot.trail[i],q=sampleTrack(trail.s/LENGTH,trail.x,trail.route),age=1-i/shot.trail.length;m.at(q.x,trail.height+age*.6,q.z);m.ball(0,0,0,.14+age*.6,.14+age*.6,.14+age*.6,'#b9bec2',6,4);}continue;
      }
      this.hedgehog(m,p.x,shot.height,p.z,.7,shot.s*.04);for(let i=0;i<shot.trail.length;i+=2){const trail=shot.trail[i],q=sampleTrack(trail.s/LENGTH,trail.x,trail.route);m.at(q.x,trail.height,q.z);m.ball(0,0,0,.12+i*.025,.12+i*.025,.12+i*.025,i%4?'#e5c077':'#faf0bc',5,3);}}
    for(const fx of r.effects){if(fx.type==='explosion'){this.explosion(m,fx);continue;}const p=sampleTrack(fx.s/LENGTH,fx.x,fx.route),t=fx.age;for(let i=0;i<18;i++){const a=i*2.399,d=t*(3+i%5*2),y=Math.max(.1,1+t*(4+i%3*2)-8*t*t);m.at(p.x+Math.cos(a)*d,y,p.z+Math.sin(a)*d);const size=(1-t/fx.life)*.4;const color=fx.type==='hit'||fx.type==='crash'?['#ffe79b','#ef9750','#aeb1ae'][i%3]:['#f7e7a0','#b4dce4','#fff6d5'][i%3];m.ball(0,0,0,size,size,size,color,5,3);}}
    if(r.phase==='racing'&&r.speed>100){
      for(let i=0;i<12;i++){const age=(time*3+i*.17)%1,side=i%2?1:-1,p=sampleTrack((r.s-age*110)/LENGTH,r.x+side*.09,r.route);m.at(p.x,age*.8+.3,p.z);const size=.15+age*.6;m.ball(0,0,0,size,size,size,r.wasDrifting?'#bbc5ca':Math.abs(r.x)>1?'#c0ad7a':'#7c8388',5,3);}
      if(r.wasDrifting&&r.drift>.5)for(let i=0;i<8;i++){const p=sampleTrack((r.s-20-i*5)/LENGTH,r.x+(i%2?-.1:.1),r.route);m.at(p.x,.25+(i%3)*.15,p.z);m.ball(0,0,0,.15,.1,.25,r.drift>.9?'#72dcff':'#ffc367',5,3);}
    }
    this.flush(m,view,height);
  }
  arenaScenery(index){
    const arena=arenas[index],m=new Mesh();
    for(let x=-100;x<100;x+=10)for(let z=-100;z<100;z+=10)m.box(x+5,-.4,z+5,10,.4,10,(x+z)%20?arena.ground:index?'#978ca5':'#959d86');
    for(const side of [-1,1]){m.box(side*98,0,0,4,5,200,arena.wall);m.box(0,0,side*98,200,5,4,arena.wall);for(let i=-90;i<100;i+=15){m.box(side*98,5,i,4,.5,5,'#eadfb9');m.box(i,5,side*98,5,.5,4,'#eadfb9');}}
    for(const [x,z,w,d] of arena.blocks){m.box(x,0,z,w,6,d,arena.wall);m.box(x,6,z,w+.3,.35,d+.3,'#c9bfaa');for(let i=-w/2+2;i<w/2;i+=3)m.box(x+i,.2,z-d/2-.05,.25,5.6,.15,'#4c465b');}
    for(let i=0;i<16;i++){const a=i/16*Math.PI*2;m.at(Math.sin(a)*118,0,Math.cos(a)*118);m.box(0,0,0,1,16,1,'#666377');m.box(0,15,0,8,1,1,'#eee1b1');m.cone(0,16,0,2,3,arena.wall,4);}
    m.at(0,0,0);this.gl.bindBuffer(this.gl.ARRAY_BUFFER,this.staticBuffer);this.gl.bufferData(this.gl.ARRAY_BUFFER,new Float32Array(m.data),this.gl.STATIC_DRAW);this.staticCount=m.data.length/9;this.track=`arena-${index}`;
  }
  drawBattle(r,time){
    if(this.track!==`arena-${r.arena}`)this.arenaScenery(r.arena);
    const gl=this.gl,canvas=this.canvas,width=Math.round(canvas.clientWidth*this.pixelRatio()),height=Math.round(canvas.clientHeight*this.pixelRatio());if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}gl.viewport(0,0,width,height);
    const sky=rgb(arenas[r.arena].sky);gl.clearColor(...sky,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.useProgram(this.program);
    const p=combatPose(r),cx=Math.sin(r.cameraHeading),cz=Math.cos(r.cameraHeading),eye=[p.x-cx*17,10+(r.destroyed?5:0),p.z-cz*17],view=cameraMatrix(eye,[p.x+cx*18,1.5,p.z+cz*18],width/height,r.boost>0?1.2:r.wasDrifting?1.13:1.07);
    gl.uniformMatrix4fv(this.matrix,false,view);gl.uniform3fv(this.eyeUniform,eye);gl.uniform3fv(this.fog,sky);gl.uniform1f(this.emission,0);this.drawBuffer(this.staticBuffer,this.staticCount);
    const m=new Mesh();this.glow=new Mesh();this.smoke=new Mesh();
    for(const skid of r.skids){
      const dx=skid.bx-skid.ax,dz=skid.bz-skid.az,length=Math.hypot(dx,dz);if(length<.01)continue;
      const nx=-dz/length*.24,nz=dx/length*.24,fade=Math.min(1,(r.elapsed-skid.time)/6),ground=rgb(arenas[r.arena].ground),color=ground.map(c=>c*(.28+fade*.65));
      m.quad([skid.ax+nx,.025,skid.az+nz],[skid.bx+nx,.025,skid.bz+nz],[skid.bx-nx,.025,skid.bz-nz],[skid.ax-nx,.025,skid.az-nz],color);
    }
    for(const actor of [r,...r.bots]){
      const pose=combatPose(actor);if(actor.destroyed){m.at(pose.x,.1,pose.z);m.disc(0,0,0,2,3,'#343344');continue;}
      this.kart(m,pose,actor.color??drivers[actor.driver].color,actor.driver,0,0,actor.boost>0,time,actor.celebrate);
      if(actor.vulcan>0){
        const pulse=.8+.2*Math.sin(time*4);this.glow.at(pose.x,.15,pose.z);
        for(let i=0;i<32;i++){const a=i/32*Math.PI*2,b=(i+1)/32*Math.PI*2;this.glow.quad([Math.cos(a)*3.3,0,Math.sin(a)*3.3],[Math.cos(b)*3.3,0,Math.sin(b)*3.3],[Math.cos(b)*3.65,0,Math.sin(b)*3.65],[Math.cos(a)*3.65,0,Math.sin(a)*3.65],[.55*pulse,.23*pulse,.02]);}
        for(let i=0;i<8;i++){const a=time*1.5+i*Math.PI/4;this.glow.particle(Math.cos(a)*3.5,.3+Math.sin(a*2)*.12,Math.sin(a)*3.5,.8,[.8*pulse,.35*pulse,.03]);}
        m.at(pose.x,.85,pose.z,actor.heading);for(const side of [-1,1])m.box(side*1.72,0,0,.12,.24,3.7,'#ffd066');
        m.at(pose.x,1.6,pose.z,actor.heading);m.box(0,0,1.4,1,.55,1.2,'#3e4251');
        for(let i=0;i<3;i++){const a=time*35+i*Math.PI*2/3;m.box(Math.sin(a)*.25,.28+Math.cos(a)*.25,2.3,.18,.18,1.4,'#b3b9c6');}
        if(actor.item==='hedgehog'&&actor.fireCooldown>.035){this.glow.at(pose.x,1.9,pose.z,actor.heading);this.glow.particle(0,0,3.2,1.4,[1,.55,.08]);this.glow.particle(0,0,3.7,.65,[1,.85,.4]);}
      }
      m.at(pose.x,6,pose.z,r.heading);for(let i=0;i<actor.health;i++)m.box((i-(actor.health-1)/2)*.6,0,0,.5,.25,.15,i>=3?'#ffe095':'#b8ef8e');
      if(actor.shield>0){this.glow.at(pose.x,.12,pose.z);for(let i=0;i<18;i++){const a=i/18*Math.PI*2+time;this.glow.particle(Math.cos(a)*3,1,Math.sin(a)*3,.4,[.05,.25,.4]);}}
    }
    for(const supply of r.supplies){if(supply.cooldown>0)continue;const pose={x:supply.wx,z:supply.wz,tx:0,tz:1},bob=Math.sin(time*2)*.3;m.at(pose.x,.1,pose.z);m.disc(0,0,0,3,3,{missile:'#c65d51',hedgehog:'#bb9c68',boost:'#d4bc55',health:'#78b88c'}[supply.kind]);switch(supply.kind){case 'missile':this.missile(m,pose,2+bob,time,1.5);break;case 'hedgehog':this.hedgehog(m,pose.x,1.5+bob,pose.z,1.1,time);break;case 'boost':m.at(pose.x,1+bob,pose.z,time);m.box(0,0,0,1.2,2,.8,'#f1cc62');break;case 'health':m.at(pose.x,1+bob,pose.z,time);m.box(0,.7,0,2.4,.7,.5,'#d6f4c6');m.box(0,0,0,.7,2.4,.5,'#d6f4c6');break;}}
    for(const shot of r.projectiles){const pose={x:shot.wx,z:shot.wz,tx:Math.sin(shot.heading),tz:Math.cos(shot.heading)};if(shot.kind==='missile'){this.missile(m,pose,shot.height);this.glow.at(shot.wx,shot.height,shot.wz,shot.heading);this.glow.flame(0,0,-1,.25,2,[.5,.17,.03],time);}if(shot.kind==='hedgehog')this.hedgehog(m,shot.wx,shot.height,shot.wz,shot.vulcan?.45:.6,time*15);for(let i=0;i<shot.trail.length;i+=3){const t=shot.trail[i],size=.12+(1-i/shot.trail.length)*.5;if(shot.vulcan){this.glow.at(t.wx,t.height,t.wz);this.glow.particle(0,0,0,.32,[.7,.35,.03]);continue;}m.at(t.wx,t.height,t.wz);m.ball(0,0,0,size,size,size,shot.kind==='missile'?'#c5c6c8':'#d7bf85',5,3);}}
    for(const effect of r.effects){if(effect.type==='explosion'){this.explosion(m,effect);continue;}for(let i=0;i<10;i++){const a=i*2.4,t=effect.age;m.at(effect.wx+Math.cos(a)*t*8,1+t*4,effect.wz+Math.sin(a)*t*8);m.ball(0,0,0,.12,.12,.12,'#f4dc8b',5,3);}}
    for(const cloud of r.chaffClouds){
      const t=cloud.age,fade=Math.min(1,(cloud.life-t)/1.4),expansion=1-Math.exp(-t*2.5);
      for(let i=0;i<96;i++){
        const a=i*2.399,spread=(2+expansion*3.5)*(1+i%5*.16),x=cloud.wx+Math.cos(a)*spread+Math.sin(t*.7+i)*.4,z=cloud.wz+Math.sin(a)*spread+Math.cos(t*.6+i)*.4,y=2.5+(i%7)*.55+Math.sin(t*1.8+i)*.7-(1-fade);
        m.at(x,y,z,a+t*4);m.box(0,0,0,.22+fade*.2,.04,.6,i%3?'#c9e4ef':'#ffffff');
        this.glow.at(x,y,z);const sparkle=(.55+.45*Math.sin(i*3+t*12)**2)*fade;this.glow.particle(0,0,0,(i%3===0?1.8:.8)*fade,[.55*sparkle,.85*sparkle,1*sparkle]);
      }
      this.smoke.at(cloud.wx,3+Math.sin(t)*.3,cloud.wz);this.smoke.particle(0,0,0,(10+expansion*8)*Math.sqrt(fade),[.75,.85,.9]);
      if(t<.45){this.glow.at(cloud.wx,2.5,cloud.wz);this.glow.particle(0,0,0,9*(1-t/.45),[.5,.75,1]);for(let i=0;i<16;i++){const f=i/15;this.glow.at(cloud.originX+(cloud.wx-cloud.originX)*f,1.5+Math.sin(f*Math.PI)*2,cloud.originZ+(cloud.wz-cloud.originZ)*f);this.glow.particle(0,0,0,1.2*(1-t/.45),[.35,.65,.9]);}}
    }
    for(const particle of r.driftParticles){
      const fade=1-particle.age/particle.life;
      if(particle.kind==='smoke'){const size=(1.5+particle.age*6)*Math.sqrt(fade);this.smoke.at(particle.wx,particle.height,particle.wz);this.smoke.particle(0,0,0,size,[.74,.77,.8]);continue;}
      const tint=[[.9,.35,.04],[.05,.55,1],[.65,.15,1]][particle.level].map(c=>c*fade);
      this.glow.at(particle.wx,particle.height,particle.wz);this.glow.particle(0,0,0,.42*fade,tint);this.glow.particle(-particle.vx*.025,-particle.vy*.025,-particle.vz*.025,.2*fade,tint);
    }
    if(r.wasDrifting){this.glow.at(p.x,.25,p.z,r.heading);const color=r.drift>=.85?[.5,.08,.9]:r.drift>=.45?[0,.4,.9]:[.6,.2,.02];for(const side of [-1,1])this.glow.particle(side*1.65,0,-1.4,1,color);}
    this.flush(m,view,height);
  }
  flush(m,view,height){
    const gl=this.gl;
    for(const instance of this.instances){gl.uniform3f(this.originUniform,instance.x,instance.y,instance.z);gl.uniform2f(this.rotationUniform,Math.cos(instance.angle),Math.sin(instance.angle));this.drawBuffer(instance.buffer,instance.count);}
    gl.uniform3f(this.originUniform,0,0,0);gl.uniform2f(this.rotationUniform,1,0);
    gl.bindBuffer(gl.ARRAY_BUFFER,this.dynamicBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(m.data),gl.DYNAMIC_DRAW);this.drawBuffer(this.dynamicBuffer,m.data.length/9);
    gl.enable(gl.BLEND);gl.depthMask(false);
    if(this.smoke.sprites.length){gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);this.drawParticles(this.smoke.sprites,view,height,true);}
    gl.blendFunc(gl.ONE,gl.ONE);gl.uniform1f(this.emission,1);
    gl.bindBuffer(gl.ARRAY_BUFFER,this.glowBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(this.glow.data),gl.DYNAMIC_DRAW);this.drawBuffer(this.glowBuffer,this.glow.data.length/9);
    if(this.glow.sprites.length)this.drawParticles(this.glow.sprites,view,height);
    gl.depthMask(true);gl.disable(gl.BLEND);gl.uniform1f(this.emission,0);
  }
  drawParticles(sprites,view,height,smoke=false){
    const gl=this.gl;for(const attribute of this.attributes)gl.disableVertexAttribArray(attribute);gl.useProgram(this.particleProgram);gl.uniformMatrix4fv(this.particleMatrix,false,view);gl.uniform1f(this.particleHeight,height);gl.uniform1f(this.particleSmoke,smoke?1:0);
    gl.bindBuffer(gl.ARRAY_BUFFER,this.particleBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(sprites),gl.DYNAMIC_DRAW);
    for(const [i,size,offset] of [[0,3,0],[1,1,12],[2,3,16]]){gl.enableVertexAttribArray(this.particleAttributes[i]);gl.vertexAttribPointer(this.particleAttributes[i],size,gl.FLOAT,false,28,offset);}
    gl.drawArrays(gl.POINTS,0,sprites.length/7);for(const attribute of this.particleAttributes)gl.disableVertexAttribArray(attribute);gl.useProgram(this.program);
  }
  drawBuffer(buffer,count){const gl=this.gl;gl.bindBuffer(gl.ARRAY_BUFFER,buffer);for(let i=0;i<3;i++){gl.enableVertexAttribArray(this.attributes[i]);gl.vertexAttribPointer(this.attributes[i],3,gl.FLOAT,false,36,i*12);}gl.drawArrays(gl.TRIANGLES,0,count);}
}
