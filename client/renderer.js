import {darkBombLights,lightUniforms} from '../characters/knowitowl/dark-bomb-light.js';
import {drawFireRing,drawFireRingOut} from '../characters/master-yuda/fire-ring-visual.js';
import {bicyclePose} from '../gameplay/bicycle-pickup.js';
import {arrivalScale,departurePose,drawTeleportHaze} from '../characters/tammy/cricket-teleport.js';
import {batAim,drawBat} from '../characters/knowitowl/bat-companion.js';
import {OwlFlight,drawBicycle} from '../characters/knowitowl/knowitowl.js';
import {DarkFog,darkHumorState,drawXrayArena} from '../characters/knowitowl/dark-humor.js';
import {drawCalculator,drawAnt,drawTaxAudit,ReceiptRolls,drawXylophone} from '../characters/fourmidable/fourmidable.js';
import { sampleTrack, branches } from '../gameplay/track.js';
import { LENGTH, drivers, pickupType } from '../gameplay/engine.js';
import { arenas, combatPose, somersaultPose, BOMB_FALL_TIME, BOMB_RADIUS, BOMB_OUTER_RADIUS, STINK_RADIUS, DIZZY_DURATION, VULCAN_DURATION } from '../gameplay/combat.js';
import { kartNameplates } from '../ui/nameplates.js';
import { bomberCamera } from '../ui/mobile.js';
import {drawAmbulance,drawNurseButterfly,drawButterflyWings} from '../characters/catheterpillar/catheterpillar.js';
import {drawNewDriver,drawRoadster,drawRoadsterJets,drawCricketHaze,drawCricketProjectile,drawHoustonHelmet,drawDollarBundle,drawCessna,drawCessnaPropeller,drawCessnaBoost,drawElectron,drawPilotWorm,drawStarship,drawStarshipThrust} from './characters.js';
import {previewPose} from './preview-pose.js';
import {drawRococoChariot,drawPearococo,drawPeacockFeather,drawRoyalWing,drawBalletPump,drawFairyStar,drawFairyBoost} from '../characters/pearococo/pearococo.js';
import {drawMotorcycle,drawYuda,drawYudaJacket,YudaJackets,YudaStunts,YudaExhaust,drawBikerBadge,drawMotorcycleBoost} from '../characters/master-yuda/master-yuda.js';
import {YudaDrift} from '../characters/master-yuda/yuda-drift.js';
import {drawArchangel,drawJetRanger,miniJetRanger,hangingLion,drawChopperVulcan,drawLionPilot,drawLionMane,drawJetRangerRotors,drawRotorWash} from '../characters/r-yeah/r-yeah.js';
const rgb=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm=a=>{const l=Math.hypot(...a)||1;return a.map(v=>v/l);};
const dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0);
class Mesh {
  data=[];sprites=[];origin=[0,0,0];angle=0;pitch=0;pivot=0;roll=0;
  at(x,y,z,angle=0){this.origin=[x,y,z];this.angle=angle;this.pitch=0;this.pivot=0;this.roll=0;return this;}
  point(p){
    let x=p[0],y=p[1],z=p[2];
    if(this.roll){const c=Math.cos(this.roll),s=Math.sin(this.roll),xx=x*c-(y-.9)*s;y=x*s+(y-.9)*c+.9;x=xx;}
    if(this.pitch){const c=Math.cos(this.pitch),s=Math.sin(this.pitch),dy=y-this.pivot;y=dy*c-z*s+this.pivot;z=dy*s+z*c;}
    const c=Math.cos(this.angle),s=Math.sin(this.angle);return [this.origin[0]+x*c+z*s,this.origin[1]+y,this.origin[2]-x*s+z*c];
  }
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
    this.tailFolds=new Map();
    this.yudaDrift=new YudaDrift();
    this.chopperTilts=new Map();this.receiptRolls=new ReceiptRolls();this.owlFlight=new OwlFlight();this.batSummons=new Map();
    this.yudaJackets=new YudaJackets();this.yudaStunts=new YudaStunts();this.yudaExhaust=new YudaExhaust();
    this.lastBodies=new Map();this.ashBodies=new Map();
    const debug=gl.getExtension('WEBGL_debug_renderer_info');this.gpuName=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):'WebGL';this.softwareGPU=/swiftshader|llvmpipe|software/i.test(this.gpuName);if(this.softwareGPU)this.resolution=.75;
    this.program=gl.createProgram();
    gl.attachShader(this.program,shader(gl,gl.VERTEX_SHADER,`
      attribute vec3 position;attribute vec3 normal;attribute vec3 color;
      uniform mat4 matrix;uniform vec3 eye;uniform vec3 origin;
      uniform vec2 rotation;uniform vec2 pitch;uniform vec2 roll;uniform vec4 plumage;
      uniform float emission;uniform float fogScale;uniform float xray;
      varying vec3 shade;varying float distanceToEye;varying vec3 worldPosition;
      vec3 tilt(vec3 v){return vec3(v.x,v.y*pitch.x-v.z*pitch.y,v.y*pitch.y+v.z*pitch.x);}
      void main(){
        vec3 local=position,localNormal=normal,tint=color;
        if(plumage.x>.5){
          float reach=clamp((position.y-1.75)/3.8,0.,1.);
          float slope=position.y>1.75&&position.y<5.55?1./3.8:0.;
          float wave=plumage.y*1.15+position.x*.85+position.y*.45;
          local+=vec3(sin(wave*.7)*.16,cos(wave)*.14,sin(wave)*.55)*reach;
          // Bend the surface normals with the feathers so their sheen follows the motion.
          vec3 dx=vec3(1.+cos(wave*.7)*.16*reach*.7*.85,-sin(wave)*.14*reach*.85,cos(wave)*.55*reach*.85);
          vec3 dy=vec3(.16*(slope*sin(wave*.7)+reach*cos(wave*.7)*.7*.45),1.+.14*(slope*cos(wave)-reach*sin(wave)*.45),.55*(slope*sin(wave)+reach*cos(wave)*.45));
          vec3 dz=vec3(0.,0.,1.);
          localNormal=cross(dy,dz)*normal.x+cross(dz,dx)*normal.y+cross(dx,dy)*normal.z;
          // Each complete feather pivots inward without shrinking its blade or eyes.
          float fold=plumage.z,turn=plumage.w*fold*.86,c=cos(turn),s=sin(turn);
          vec3 root=vec3(0.,1.75,-1.05),offset=local-root;
          offset.xy=vec2(offset.x*c-offset.y*s,offset.x*s+offset.y*c);
          localNormal.xy=vec2(localNormal.x*c-localNormal.y*s,localNormal.x*s+localNormal.y*c);
          offset.z-=abs(plumage.w)*fold*.12;
          c=cos(-fold*.95);s=sin(-fold*.95);
          offset.yz=vec2(offset.y*c-offset.z*s,offset.y*s+offset.z*c);
          localNormal.yz=vec2(localNormal.y*c-localNormal.z*s,localNormal.y*s+localNormal.z*c);
          local=root+offset;
        }
        local.xy=vec2(local.x*roll.x-(local.y-.9)*roll.y,local.x*roll.y+(local.y-.9)*roll.x+.9);
        localNormal.xy=vec2(localNormal.x*roll.x-localNormal.y*roll.y,localNormal.x*roll.y+localNormal.y*roll.x);
        vec3 a=tilt(local-vec3(0.,2.,0.))+vec3(0.,2.,0.),b=tilt(localNormal);
        vec3 p=vec3(a.x*rotation.x+a.z*rotation.y,a.y,-a.x*rotation.y+a.z*rotation.x)+origin;
        vec3 n=normalize(vec3(b.x*rotation.x+b.z*rotation.y,b.y,-b.x*rotation.y+b.z*rotation.x));
        vec3 lamp=normalize(vec3(-.5,1.,.3));
        float light=.62+.38*max(0.,dot(n,lamp));
        if(plumage.x>.5&&color.b>color.r*.85&&color.g>color.r*1.1){
          // Iridescence depends on light/view angles, never a timed hue cycle.
          vec3 sight=normalize(eye-p),halfway=normalize(lamp+sight);
          float facing=abs(dot(n,sight)),reflection=abs(dot(n,halfway));
          float grazing=1.-(.7*facing+.3*reflection);
          vec3 silk=mix(vec3(.12,.52,.43),vec3(.17,.3,.7),smoothstep(.12,.72,grazing));
          silk=mix(silk,vec3(.51,.24,.64),smoothstep(.6,.95,grazing)*.7);
          float sheen=pow(reflection,22.);
          tint=mix(mix(color,silk,.85),vec3(.85,.94,.72),sheen*.55);
          light=.62+.38*abs(dot(n,lamp));
        }
        if(xray>0.){float rim=pow(1.-abs(dot(normalize(n),normalize(eye-p))),2.);tint=vec3(.12,.6,.7)+vec3(.4,.4,.25)*rim;}
        gl_Position=matrix*vec4(p,1.0);worldPosition=p;shade=tint*mix(light,1.,emission);distanceToEye=length(p-eye)*fogScale;
      }
    `));
    gl.attachShader(this.program,shader(gl,gl.FRAGMENT_SHADER,`precision mediump float;varying vec3 shade;varying float distanceToEye;varying vec3 worldPosition;uniform vec3 fog;uniform float darkness;uniform vec4 bombLights[4];void main(){float amount=smoothstep(130.,950.,distanceToEye);float nearby=mix(1.,.12,smoothstep(20.,85.,distanceToEye));vec3 lit=mix(shade,fog,amount*.92)*mix(1.,nearby,darkness);float illumination=0.;if(darkness>0.){for(int i=0;i<4;i++){if(bombLights[i].w>0.)illumination+=bombLights[i].w/sqrt(max(1.,distance(worldPosition,bombLights[i].xyz)));}}lit+=vec3(1.,.75,.18)*(.12+shade*.7)*(1.65*illumination/(1.+illumination))*darkness;gl_FragColor=vec4(lit,1.);}`));
    gl.linkProgram(this.program);if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(this.program));gl.useProgram(this.program);
    this.attributes=['position','normal','color'].map(n=>gl.getAttribLocation(this.program,n));this.matrix=gl.getUniformLocation(this.program,'matrix');this.eyeUniform=gl.getUniformLocation(this.program,'eye');this.fog=gl.getUniformLocation(this.program,'fog');this.emission=gl.getUniformLocation(this.program,'emission');this.xray=gl.getUniformLocation(this.program,'xray');this.staticBuffer=gl.createBuffer();this.dynamicBuffer=gl.createBuffer();this.glowBuffer=gl.createBuffer();gl.enable(gl.DEPTH_TEST);this.track=-1;this.eye=null;
    this.originUniform=gl.getUniformLocation(this.program,'origin');this.rotationUniform=gl.getUniformLocation(this.program,'rotation');gl.uniform3f(this.originUniform,0,0,0);gl.uniform2f(this.rotationUniform,1,0);
    this.pitchUniform=gl.getUniformLocation(this.program,'pitch');gl.uniform2f(this.pitchUniform,1,0);
    this.rollUniform=gl.getUniformLocation(this.program,'roll');gl.uniform2f(this.rollUniform,1,0);
    this.fogScale=gl.getUniformLocation(this.program,'fogScale');this.darknessUniform=gl.getUniformLocation(this.program,'darkness');this.bombLightsUniform=gl.getUniformLocation(this.program,'bombLights[0]');
    this.plumageUniform=gl.getUniformLocation(this.program,'plumage');gl.uniform4f(this.plumageUniform,0,0,0,0);
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
  model(key,x,y,z,angle,build,pitch=0,plumage=null,roll=0){
    let model=this.models.get(key);
    if(!model){const mesh=new Mesh();this.buildingModel=true;try{build(mesh);}finally{this.buildingModel=false;}const buffer=this.gl.createBuffer();this.gl.bindBuffer(this.gl.ARRAY_BUFFER,buffer);this.gl.bufferData(this.gl.ARRAY_BUFFER,new Float32Array(mesh.data),this.gl.STATIC_DRAW);model={buffer,count:mesh.data.length/9,rubble:this.rubbleSamples(mesh.data)};this.models.set(key,model);}
    this.instances.push({...model,x,y,z,angle,pitch,plumage,roll});
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
  kart(m,p,color,driver,yaw=0,spin=0,boost=false,clock=0,celebrate=0,jump=null,helmet=true,gesture=null){
    if(driver===14){this.owlFlight.draw(this,m,p,color,yaw,spin,boost,clock,celebrate,jump,gesture);return;}
    if(driver===13){const angle=Math.atan2(p.tx,p.tz)-yaw+spin,height=jump?.height??0,pitch=jump?.pitch??0,phase=Math.floor(clock*8)%8,wave=celebrate>0||(gesture?.right??0)>0;this.model('kart:13:'+color,p.x,height,p.z,angle,mesh=>drawCalculator(mesh,color),pitch);this.model('fourmidable:'+phase+':'+wave,p.x,height+(gesture?.bounce??0),p.z,angle+(gesture?.yaw??0),mesh=>drawAnt(mesh,phase,wave),pitch);this.receiptRolls.draw(m,p,angle,clock,jump,boost||Boolean(jump));return;}
    if(driver===12){this.nurseAmbulance(m,p,color,yaw,spin,boost,clock,celebrate,jump,gesture);return;}
    if(driver===11){this.lionChopper(m,p,color,yaw,spin,boost,clock,celebrate,jump,gesture);return;}
    if(driver===10){this.yudaMotorcycle(m,p,color,yaw,spin,boost,clock,celebrate,jump,gesture);return;}
    if(driver===9){this.royalChariot(m,p,color,yaw,spin,boost,clock,celebrate,jump,gesture);return;}
    if(driver===8&&!this.buildingModel){this.pilotPlane(m,p,color,yaw,spin,boost,clock,celebrate,jump,gesture);return;}
    if(driver===6)color='#e8edf2';
    if(!gesture&&!this.buildingModel&&(celebrate<=0||jump)){const angle=Math.atan2(p.tx,p.tz)-yaw+spin;m.at(p.x,.13,p.z,angle);m.disc(.2,0,.25,2.3,3,'#3a4147');this.model(`kart:${driver}:${color}${driver===7&&!helmet?':bare':''}`,p.x,jump?.height??0,p.z,angle,mesh=>this.kart(mesh,{x:0,z:0,tx:0,tz:1},color,driver,0,0,false,0,0,null,helmet),jump?.pitch??0);if(driver===7){this.starshipEngines(p,angle,clock,jump,boost);return;}if(boost||jump)this.afterburner(p,angle,clock,jump,driver);return;}
    const angle=Math.atan2(p.tx,p.tz)-yaw+spin;m.at(p.x,.13,p.z,angle);if(!this.buildingModel)m.disc(.2,0,.25,2.3,3,'#3a4147');
    if(driver===6)drawRoadster(m);
    if(driver===7)drawStarship(m,color);
    if(driver!==6&&driver!==7){
    for(const x of [-1.6,1.6])for(const z of [-1.5,1.4]){m.ball(x,.65,z,.58,.68,.7,'#202534',8,5);m.box(x+Math.sign(x)*.5,.38,z,.08,.52,.6,'#b9b9b7');for(let t=0;t<3;t++)m.box(x,.7,z-.4+t*.3,1.05,.06,.08,'#343a45');}
    m.box(0,.5,0,3.2,.65,4.4,color);m.box(0,1.1,.9,2.7,.35,1.8,color);m.box(0,.55,2.2,3.5,.3,.35,'#c5c9c4');m.box(0,.5,-2.3,3.7,.3,.35,'#30384b');
    m.box(0,1,-.4,1.8,1.2,1.5,'#333445');m.box(0,1.2,-1.4,2.4,.6,.6,color);
    }
    // Rotate only the driver, leaving the chassis, wheels and steering untouched.
    const progress=1.6-celebrate,envelope=celebrate>0?Math.min(1,progress/.25,celebrate/.4):0;
    const turn=envelope*envelope*(3-2*envelope),bounce=turn*Math.sin(progress*15)*.1;
    m.at(p.x,.13+bounce+(gesture?.bounce??0),p.z,angle+Math.PI*turn+(gesture?.yaw??0));m.pitch=gesture?.lean??0;m.pivot=2;
    if(!drawNewDriver(m,driver,turn,progress,helmet,gesture)){
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
      const lift=(side>0?gesture?.right:gesture?.left)??0,handY=2.1+turn*(2.1+Math.sin(progress*18+side)*.22)+lift,handX=side*(.85+turn*.5+lift*.16),handZ=1-turn*.7;
      m.ball(side*(.85+turn*.2),(2.1+handY)/2,(handZ+.3)/2,.24,.3+turn*.55+lift*.35,.24,fur,8,5);
      m.ball(handX,handY,handZ,.32,.32,.32,fur);
    }
    m.ball(0,3.35,1.02,.43,.3,.3,'#f3dfb6');m.ball(0,3.45,1.3,.17,.12,.1,'#252a32');
    if(turn>.2)m.ball(0,3.2,1.28,.19,.08+turn*.06,.04,'#3f2936',8,4);
    if(driver===1)for(let i=0;i<5;i++)m.ball(0,1.2+i*.2,-1.1-i*.15,.32,.3,.3,i%2?'#3a3c45':'#a6a3a0');
    if(driver===2)m.ball(.1,1.5,-1.1,.5,.6,.7,'#f1b15c');
    }
    m.at(p.x,.13,p.z,angle);
    if(turn>.7){this.glow.at(p.x,.13,p.z,angle);for(let i=0;i<3;i++){const a=progress*3+i*2.1;this.glow.particle(Math.cos(a)*1.9,5+Math.sin(a)*.25,Math.sin(a)*.5,.45,[.55,.35,.07]);}}
    if(driver===6){if(boost)this.afterburner(p,angle,clock,null,driver);return;}
    if(driver===7){if(!this.buildingModel)this.starshipEngines(p,angle,clock,null,boost);return;}
    m.box(-1,1.15,-2.1,.55,.3,.12,'#ff765a');m.box(1,1.15,-2.1,.55,.3,.12,'#ff765a');
    m.box(0,1.2,-2.25,.8,.35,.12,'#f7edce');m.box(0,1.26,-2.33,.12,.25,.03,'#33364b');
    for(const side of [-1,1]){m.ball(side*1.2,.75,-2.45,.31,.31,.5,'#69788b',10,5);m.ball(side*1.2,.75,-2.85,.24,.24,.08,'#161d2a',10,4);}
    if(boost)this.afterburner(p,angle,clock,null,driver);
  }
  nurseAmbulance(m,p,color,yaw,spin,boost,clock,celebrate,jump,gesture=null){
    const angle=Math.atan2(p.tx,p.tz)-yaw+spin,height=.13+(jump?.height??0),pitch=jump?.pitch??0;
    m.at(p.x,.05,p.z,angle);m.disc(0,0,0,2.1,2.8,'#3a4147');
    this.model(`kart:12:${color}`,p.x,height,p.z,angle,mesh=>drawAmbulance(mesh,color),pitch);
    const phase=Math.floor(clock*6)%8,waving=celebrate>0||(gesture?.right??0)>0;
    // Pitch the entire butterfly forward together, keeping the wing hinges attached.
    const hover=height+1.7+Math.sin(clock*3)*.06+(gesture?.bounce??0),facing=angle+(gesture?.yaw??0),lean=pitch+.78+(gesture?.lean??0);
    this.model(`catheterpillar:nurse:${phase}:${waving}`,p.x,hover,p.z,facing,mesh=>drawNurseButterfly(mesh,phase,waving),lean);
    const wingPhase=Math.floor(clock*(boost?96:72))%24;
    this.model(`catheterpillar:wings:${wingPhase}`,p.x,hover,p.z,facing,mesh=>drawButterflyWings(mesh,wingPhase),lean);
    if(boost||jump)this.afterburner(p,angle,clock,jump,12);
  }
  lionChopper(m,p,color,yaw,spin,boost,clock,celebrate,jump,gesture=null){
    const angle=Math.atan2(p.tx,p.tz)-yaw+spin,height=(jump?.height??0)+.18+Math.sin(clock*3)*.08,pitch=jump?.pitch??0;
    m.at(p.x,.05,p.z,angle);m.disc(0,0,-.5,2.4,4,'#3b4247');
    this.model(`kart:11:${color}`,p.x,height,p.z,angle,mesh=>miniJetRanger(mesh,m=>drawJetRanger(m,color)),pitch);
    const waving=!boost&&(celebrate>0||(gesture?.right??0)>0),phase=waving?Math.floor(clock*6)%8:0,roaring=celebrate>0||gesture?.id==='cheer';
    const lion=p;
    this.model(`r-yeah:lion:${phase}:${roaring}:${boost}`,lion.x,height,lion.z,angle,mesh=>hangingLion(mesh,m=>drawLionPilot(m,phase,roaring,boost?2:true)),pitch);
    this.lionMane(lion,height,angle,pitch,clock,boost);
    this.chopperRotors(p,height,angle,pitch,clock,boost);
    if(boost||jump)drawRotorWash(this.glow,this.smoke,p,angle,clock,{height,pitch});
  }
  chopperVulcan(p,actor,time,jump){
    const angle=Math.atan2(p.tx,p.tz),height=(jump?.height??0)+.18+Math.sin(time*3)*.08,pitch=jump?.pitch??0,phase=Math.floor(time*36)%8;
    this.model(`r-yeah:vulcan:${phase}`,p.x,height,p.z,angle,mesh=>drawChopperVulcan(mesh,phase),pitch);
    if(actor.item!=='hedgehog'||actor.fireCooldown<=.035)return;
    this.glow.at(p.x,height,p.z,angle);this.glow.pitch=pitch;this.glow.pivot=2;
    this.glow.particle(1.3,4.56,3.2,1,[1,.55,.08]);this.glow.particle(1.3,4.56,3.6,.5,[1,.85,.4]);
  }
  fashionSnap(m,effect,time){
    const t=effect.age,fade=Math.max(0,1-t/effect.life),snap=Math.min(1,t/.18),x=effect.wx,z=effect.wz;
    m.at(x,7.4+t*.8,z,time*.25);
    // A pink opera glove: poised thumb and middle finger flick apart on the snap.
    m.ball(0,0,0,.45,.58,.23,'#efb4d2',10,6);m.box(0,-.95,0,.65,.55,.36,'#f8d1e3');m.box(0,-.5,0,.69,.12,.4,'#ecc16e');
    for(let i=0;i<3;i++)m.ball(-.26+i*.24,.64+i*.06,0,.12,.42,.13,'#f4c5dc',8,5);
    m.ball(.4+snap*.35,.28-snap*.32,.18,.16,.35,.13,'#efb4d2',8,5);
    m.ball(.18-snap*.2,.4+snap*.5,.25,.13,.36,.13,'#f8d1e3',8,5);
    this.glow.at(x,8,z);
    for(let i=0;i<44;i++){const a=i*2.399,r=.3+t*(3+i%5),y=Math.sin(i*3.1)*t*3;this.glow.particle(Math.cos(a)*r,y,Math.sin(a)*r,(.25+(i%3)*.08)*fade,i%3?[.85*fade,.12*fade,.4*fade]:[.8*fade,.55*fade,.1*fade]);}
    this.glow.particle(0,0,0,Math.max(0,1-t/.25)*3,[.9,.65,.35]);
  }
  bicycleDrop(supply,time,pose=bicyclePose(supply)){
    const t=Math.max(0,Math.min(1,supply.age/1.2)),phase=Math.floor(32*(1-(1-t)**3))%16;
    this.model('owl:bicycle-pickup:'+phase,pose.x,pose.height,pose.z,pose.angle,mesh=>drawBicycle(mesh,phase*Math.PI/8),pose.pitch,null,pose.roll);
    if(pose.glow>0){this.glow.at(pose.x,.12,pose.z);const glow=pose.glow*(.8+.2*Math.sin(time*3));for(let i=0;i<32;i++){const a=i*Math.PI/16,b=(i+1)*Math.PI/16;this.glow.quad([Math.sin(a)*2.7,0,Math.cos(a)*2.7],[Math.sin(b)*2.7,0,Math.cos(b)*2.7],[Math.sin(b)*2.85,0,Math.cos(b)*2.85],[Math.sin(a)*2.85,0,Math.cos(a)*2.85],[.3*glow,.12*glow,.65*glow]);}for(let i=0;i<10;i++){const t=(time*.5+i/10)%1,a=i*2.4;this.glow.particle(Math.sin(a)*2,t*3,Math.cos(a)*2,.12*(1-t),[.35*glow,.16*glow,.6*glow]);}}
  }
  batBuddy(p,actor,world,time,jump){
    let state=this.batSummons.get(actor.id);if(!state||time<state.time){state={time,amount:0};this.batSummons.set(actor.id,state);}
    const dt=Math.min(.05,Math.max(0,time-state.time));state.time=time;state.amount+=(Number(actor.vulcan>0)-state.amount)*(1-Math.exp(-dt*12));
    if(state.amount<.01)return;
    const aim=batAim(world,actor,arenas[world.arena]),x=p.x+(aim.origin.wx-p.x)*state.amount,z=p.z+(aim.origin.wz-p.z)*state.amount,height=3.8+(actor.boost>0?2.4:0)+(jump?.height??0)+(1-state.amount)*1.5,phase=Math.floor(time*18)%16;
    const firing=actor.vulcan>0&&world.projectiles.some(s=>s.owner===actor.id&&s.vulcan&&s.age<.09);
    this.model('owl:bat:'+phase+':'+firing,x,height,z,aim.heading,mesh=>drawBat(mesh,phase,firing));
    if(firing){this.glow.at(x,height-.3,z,aim.heading);this.glow.particle(0,0,1.55,.7,[.7,.35,.05]);}
    if(state.amount<.95){this.glow.at(x,height,z);for(let i=0;i<10;i++){const a=time*5+i*2.399;this.glow.particle(Math.cos(a)*.9,i*.2,Math.sin(a)*.9,.15,[.3,.1,.4]);}}
  }
  teleportKart(p,color,heading,scale,height=0,pitch=0){
    const step=Math.round(scale*12)/12;if(step<=0)return;
    this.model('teleport:tammy:'+color+':'+step,p.x,height,p.z,heading,mesh=>{
      const point=mesh.point;mesh.point=function(v){return point.call(this,v.map(n=>n*step));};
      this.kart(mesh,{x:0,z:0,tx:0,tz:1},color,5);
    },pitch);
  }
  holyArchangels(p,actor,time,jump){
    const age=Math.max(0,8-actor.specialActive),presence=Math.min(1,age/.65,actor.specialActive/.7),smooth=presence*presence*(3-2*presence),stage=Math.round(smooth*12)/12,angle=Math.atan2(p.tx,p.tz),phase=Math.floor(time*8)%8;
    for(const side of [-1,1]){
      const x=p.x+Math.cos(angle)*side*4.5,z=p.z-Math.sin(angle)*side*4.5,height=(jump?.height??0)+1.3+Math.sin(time*2+side)*.16+(1-smooth)*2.5;
      const role=side<0?'michael':'gabriel';
      this.model(`r-yeah:archangel:${role}:${phase}:${stage}`,x,height,z,angle,mesh=>drawArchangel(mesh,phase,stage,role));
      this.glow.at(x,height,z,angle);
      const flare=1-smooth;
      for(let i=0;i<48;i++){const a=i*2.399+time*.7,t=(time*.6+i/48)%1,radius=.65+flare*1.8+t*.5;this.glow.particle(Math.cos(a)*radius,t*4.4,Math.sin(a)*radius,(.09+flare*.23)*(1-t*.5),side<0?[.65,.44,.1]:[.2,.42,.7]);}
      for(let i=0;i<32;i++){const a=i*Math.PI/16,b=(i+1)*Math.PI/16,r=1+flare*1.4;this.glow.quad([Math.cos(a)*r,-.4,Math.sin(a)*r],[Math.cos(b)*r,-.4,Math.sin(b)*r],[Math.cos(b)*(r+.08),-.4,Math.sin(b)*(r+.08)],[Math.cos(a)*(r+.08),-.4,Math.sin(a)*(r+.08)],[.5,.3,.04]);}
      this.glow.particle(0,3.36*stage,0,.75,[.4,.25,.045]);
      if(flare>.02)for(let i=0;i<10;i++)this.glow.particle(0,i*.6,0,flare*.65,[.36*flare,.28*flare,.11*flare]);
    }
  }
  lionMane(p,height,angle,pitch,time,boost){
    const phase=Math.floor(time*(boost?24:8))%12;
    this.model(`r-yeah:mane:${phase}:${boost}`,p.x,height,p.z,angle,mesh=>hangingLion(mesh,m=>drawLionMane(m,phase,boost)),pitch);
  }
  chopperRotors(p,height,angle,pitch,time,boost){
    const key=p.id??'preview';let state=this.chopperTilts.get(key);
    if(!state||time<state.time){state={time,amount:0};this.chopperTilts.set(key,state);}
    const dt=Math.min(.05,Math.max(0,time-state.time));state.time=time;state.amount+=(Number(boost)-state.amount)*(1-Math.exp(-dt*12));
    const tilt=Math.round(state.amount*5)/5*.28,phase=Math.floor(time*(boost?80:42))%8;
    this.model(`r-yeah:rotors:${phase}:${tilt}`,p.x,height,p.z,angle,mesh=>miniJetRanger(mesh,m=>drawJetRangerRotors(m,phase,tilt)),pitch);
  }
  yudaMotorcycle(m,p,color,yaw,spin,boost=false,clock=0,celebrate=0,jump=null,gesture=null){
    const angle=Math.atan2(p.tx,p.tz)-yaw+spin+(jump?.yaw??0),roll=jump?.roll??p.bikeRoll??0;
    p={...p,bikeRoll:roll};
    const outfit=this.yudaJackets.update(p.id??'preview',clock,boost||p.vulcan>0,{x:p.x,z:p.z,height:jump?.height??0,angle});
    const stunt=this.yudaStunts.update(p.id??'preview',clock,boost,gesture?.id==='cheer'?1:celebrate,Boolean(jump)||Math.abs(roll)>.2,outfit.dressing!==null);
    const height=(jump?.height??0)+stunt.y,pitch=(jump?.pitch??0)+stunt.pitch;
    p={...p,x:p.x+Math.sin(angle)*stunt.z,z:p.z+Math.cos(angle)*stunt.z};
    const visualJump={height,pitch};
    m.at(p.x,.08,p.z,angle);m.disc(0,0,0,1.1,2.8,'#343b43');
    this.model(`kart:10:${color}`,p.x,height,p.z,angle,mesh=>drawMotorcycle(mesh,color),pitch,null,roll);
    const saluting=!jump&&Math.abs(roll)<.2&&(boost||(gesture?.right??0)>0),phase=saluting?Math.floor(clock*5)%8:0;
    const tuck=Boolean(jump)||Math.abs(roll)>.2;
    const dressing=outfit.dressing===null?-1:Math.min(7,Math.floor(outfit.dressing*8));
    const lounge=Math.round(stunt.lounge*8)/8;
    this.model(`yuda:rider:${phase}:${tuck}:${!outfit.bare}:${dressing}:${lounge}`,p.x,height,p.z,angle+(gesture?.yaw??0)*.35,mesh=>drawYuda(mesh,phase,tuck,!outfit.bare,dressing,lounge),pitch+(tuck?.18:0),null,roll);
    // Detached clothing is cosmetic and does not become part of his ashes.
    if(outfit.flight){const f=outfit.flight,t=(clock-f.start)/1.2,distance=t*9;
      this.model(`yuda:jacket:${Math.floor(t*8)%4}`,f.x-Math.sin(f.angle)*distance,f.height+2.5+Math.sin(t*Math.PI)*4+t*2,f.z-Math.cos(f.angle)*distance,f.angle+t*7,mesh=>drawYudaJacket(mesh,Math.sin(Math.floor(t*8)%4*Math.PI/2)),t*5);this.instances.at(-1).detached=true;
    }
    if(outfit.dressing!==null){const t=outfit.dressing,lift=Math.sin(t*Math.PI);
      this.model(`yuda:dressing:${dressing}`,p.x,height+2.35+lift*1.5,p.z,angle,mesh=>{mesh.at(0,0,-.52);drawYudaJacket(mesh,Math.sin(dressing*Math.PI/7));},pitch+lift*.4,null,roll);
    }
    // Restrained neon underglow is always present; protection adds winged badges.
    this.bikerAura(m,p,angle,clock,visualJump);
    if(boost||jump)this.afterburner(p,angle,clock,visualJump,10);
  }
  bikerAura(m,p,angle,time,jump=null,strength=0){
    const height=jump?.height??0,g=this.glow;g.at(p.x,height,p.z,angle);g.pitch=jump?.pitch??0;g.pivot=2;g.roll=p.bikeRoll??0;
    for(const side of [-1,1])for(let i=0;i<8;i++)g.particle(side*.5,.35,-1.4+i*.4,.32,[.015,.12,.16]);
    if(strength<=0)return;
    g.at(p.x,height+.1,p.z);
    for(let i=0;i<36;i++){const a=i*Math.PI/18+time*.7;g.particle(Math.sin(a)*3.4,.15,Math.cos(a)*3.4,.42*strength,[.04,.48,.65]);}
    for(let i=0;i<6;i++){
      const a=time*.8+i*Math.PI/3;
      this.model('yuda:winged-badge',p.x+Math.sin(a)*3.4,height+1.8+Math.sin(a*2)*.4,p.z+Math.cos(a)*3.4,a,drawBikerBadge);
    }
  }
  laserBolt(m,x,y,z,angle){
    this.model('yuda:laser',x,y,z,angle,mesh=>{mesh.ball(0,0,0,.1,.1,1.15,'#d9fffc',8,5);});
    this.glow.at(x,y,z,angle);this.glow.ball(0,0,0,.18,.18,1.4,[.03,.75,.65],8,5);
    for(let i=0;i<5;i++)this.glow.particle(0,0,-.9+i*.45,.42,[.025,.38,.32]);
  }
  laserMount(m,pose,actor,time,jump){
    const facing=actor.heading+(jump?.yaw??0),roll=jump?.roll??pose.bikeRoll??0;
    const wheelie=this.yudaStunts.riders.get(actor.id)?.wheelie??0,pitch=-.62*wheelie;
    const height=(jump?.height??0)+1.08*(Math.cos(pitch)-1)-1.65*Math.sin(pitch),behind=-1.65+1.08*Math.sin(pitch)+1.65*Math.cos(pitch);
    pose={...pose,x:pose.x+Math.sin(facing)*behind,z:pose.z+Math.cos(facing)*behind};
    jump={height,pitch:(jump?.pitch??0)+pitch};
    m.at(pose.x,height,pose.z,facing);m.pitch=jump?.pitch??0;m.pivot=2;
    this.glow.at(pose.x,height,pose.z,facing);this.glow.pitch=jump?.pitch??0;this.glow.pivot=2;
    m.roll=roll;this.glow.roll=roll;
    for(const side of [-1,1]){m.box(side*.57,1.65,1.45,.25,.23,1.5,'#273a43');m.ball(side*.57,1.77,2.22,.12,.12,.04,'#8dfff0',8,4);if(actor.item==='hedgehog'&&actor.fireCooldown>.035)this.glow.particle(side*.57,1.77,2.4,.9,[.15,.8,.65]);}
  }
  starshipEngines(p,angle,clock,jump=null,boost=false){
    drawStarshipThrust(this.glow,this.smoke,p,angle,clock,jump,boost);
  }
  houstonHelmet(p,actor,time,jump){
    if(actor.vulcan<=0){this.helmetFlights.delete(actor.id);return;}
    let flight=this.helmetFlights.get(actor.id);
    if(!flight||actor.vulcan>flight.remaining+.05){flight={start:time-Math.max(0,VULCAN_DURATION-actor.vulcan),remaining:actor.vulcan};this.helmetFlights.set(actor.id,flight);}
    flight.remaining=actor.vulcan;
    const age=Math.max(0,time-flight.start);if(age>=1.1)return;
    const progress=age/1.1,behind=progress*3;
    this.model('houston:helmet',p.x-Math.sin(actor.heading)*behind,.13+(jump?.height??0)+progress*6+progress*progress*4,p.z-Math.cos(actor.heading)*behind,actor.heading+progress*Math.PI*2,drawHoustonHelmet);
  }
  royalChariot(m,p,color,yaw,spin,boost,clock,celebrate,jump,gesture=null){
    const angle=Math.atan2(p.tx,p.tz)-yaw+spin,pitch=jump?.pitch??0,height=jump?.height??0;
    m.at(p.x,.13,p.z,angle);m.disc(0,0,0,2.5,3,'#3a4147');
    this.model(`kart:9:${color}`,p.x,height,p.z,angle,mesh=>{mesh.at(0,.13,0);drawRococoChariot(mesh,color);},pitch);
    const facing=angle+(gesture?.yaw??0),lean=pitch+(gesture?.lean??0);
    this.model('pearococo:queen',p.x,height,p.z,facing,drawPearococo,lean);
    const fold=gesture?.tailFold??this.boostTailFold(p.id??color,boost,clock);
    this.royalTail(p,height,facing,lean,clock,fold);
    this.royalWave(p,height,facing,lean,clock,celebrate>0||(gesture?.right??0)>0);
    if(boost||jump)this.afterburner(p,angle,clock,jump,9);
  }
  boostTailFold(id,boost,clock){
    let state=this.tailFolds.get(id);
    if(!state||clock<state.time||clock-state.time>1){state={amount:boost?1:0,time:clock};this.tailFolds.set(id,state);}
    const dt=clock-state.time;state.time=clock;
    state.amount=boost?Math.min(1,state.amount+dt/.35):Math.max(0,state.amount-dt/.55);
    return state.amount*state.amount*(3-2*state.amount);
  }
  royalTail(p,height,angle,pitch,clock,fold=0){
    for(let i=0;i<11;i++)this.model(`pearococo:feather:${i}`,p.x,height,p.z,angle,mesh=>drawPeacockFeather(mesh,i),pitch,{clock,fold,angle:(i-5)*.23});
  }
  royalWave(p,height,angle,pitch,clock,waving){
    const phase=waving?Math.floor(clock*6)%8:-1;
    this.model(`pearococo:wave:${phase}`,p.x,height,p.z,angle,mesh=>drawRoyalWing(mesh,phase),pitch);
  }
  pilotPlane(m,p,color,yaw,spin,boost,clock,celebrate,jump,gesture=null){
    const angle=Math.atan2(p.tx,p.tz)-yaw+spin;
    m.at(p.x,.13,p.z,angle);m.disc(.2,0,.25,2.3,3,'#3a4147');
    this.model(`kart:8:${color}`,p.x,jump?.height??0,p.z,angle,mesh=>{mesh.at(0,.13,0);drawCessna(mesh,color);},jump?.pitch??0);
    this.wormPilot(p,angle,clock,celebrate,jump,gesture);
    this.planePropeller(p,angle,clock,jump,boost);
    if(boost||jump)this.afterburner(p,angle,clock,jump,8);
  }
  wormPilot(p,angle,clock,celebrate,jump,gesture=null){
    const phase=Math.floor(clock*8)%8,progress=1.6-celebrate,envelope=celebrate>0?Math.min(1,progress/.25,celebrate/.4):0,turn=envelope*envelope*(3-2*envelope);
    this.model(`avita:worm:${phase}`,p.x,(jump?.height??0)+(gesture?.bounce??0),p.z,angle+Math.PI*turn+(gesture?.yaw??0),mesh=>{mesh.at(0,.13,0);drawPilotWorm(mesh,0,0,Math.sin(phase*Math.PI/4));},(jump?.pitch??0)+(gesture?.lean??0));
  }
  planePropeller(p,angle,clock,jump=null,boost=false){
    const phase=Math.floor(clock*(boost||jump?50:20))%8;
    this.model(`cessna:propeller:${phase}`,p.x,jump?.height??0,p.z,angle,mesh=>{mesh.at(0,.13,0);drawCessnaPropeller(mesh,phase);},jump?.pitch??0);
  }
  afterburner(p,angle,clock,jump=null,driver=0){
    if(driver===10){
      if(!this.arenaExhaust){drawMotorcycleBoost(this.glow,this.smoke,p,angle,clock,jump);return;}
      this.smoke.at(p.x,jump?.height??0,p.z,angle);this.smoke.pitch=jump?.pitch??0;this.smoke.pivot=2;this.smoke.roll=p.bikeRoll??0;
      const [x,y,z]=this.smoke.point([0,.67,-2.5]);this.yudaExhaust.emit(p.id,{x,y:Math.max(.2,y),z},clock);return;
    }
    if(driver===7){this.starshipEngines(p,angle,clock,jump,true);return;}
    if(driver===9){drawFairyBoost(this.glow,this.smoke,p,angle,clock,jump);return;}
    if(driver===5){drawCricketHaze(this.glow,this.smoke,p,angle,clock,jump);return;}
    if(driver===6){drawRoadsterJets(this.glow,this.smoke,p,angle,clock,jump);return;}
    if(driver===8){drawCessnaBoost(this.glow,this.smoke,p,angle,clock,jump);return;}
    const g=this.glow;g.at(p.x,.13+(jump?.height??0),p.z,angle);g.pitch=jump?.pitch??0;g.pivot=1.87;
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
  cricket(m,x,y,z,angle,clock){const phase=Math.floor(clock*20)%4;this.model(`cricket:${phase}`,x,y,z,angle,mesh=>drawCricketProjectile(mesh,phase));}
  dollarBundle(m,x,y,z,angle,clock){this.model('dollar-bundle',x,y,z,angle+clock*9,drawDollarBundle);}
  electron(m,x,y,z,angle,clock){
    this.model('electron',x,y,z,angle+clock*6,drawElectron);
    this.glow.at(x,y,z);this.glow.particle(0,0,0,.6,[.18,.65,1]);this.glow.particle(0,0,0,1.1,[.02,.12,.25]);
  }
  balletPump(m,x,y,z,angle,clock){
    this.model('ballet-pump',x,y,z,angle+Math.sin(clock*8)*.35,drawBalletPump);
    this.glow.at(x,y,z);this.glow.particle(0,0,0,1,[.38,.12,.2]);
    this.smoke.at(x,y,z);this.smoke.particle(0,0,0,1.2,[.98,.62,.76]);
  }
  fairyProtection(m,pose,time,strength=1,jump=null){
    const height=jump?.height??0;
    this.glow.at(pose.x,height,pose.z);
    for(let i=0;i<42;i++){
      const a=time*.8+i*2.399,radius=3.5+Math.sin(i*7+time)*.35,y=.4+(i%7)*.65+Math.sin(time*2+i)*.3,fade=strength*(.4+.6*Math.sin(time*4+i)**2);
      this.glow.particle(Math.sin(a)*radius,y,Math.cos(a)*radius,.2+fade*.3,i%2?[fade*.9,fade*.58,fade*.18]:[fade*.8,fade*.2,fade*.48]);
    }
    for(let i=0;i<6;i++){const a=time*.9+i*Math.PI/3;this.model('fairy-star',pose.x+Math.sin(a)*3.6,height+1.5+Math.sin(a*2)*.7,pose.z+Math.cos(a)*3.6,a,drawFairyStar);}
  }
  hedgeguardIcon(x,y,z,angle){this.model('hedgeguard:shield',x,y,z,angle,mesh=>{
    mesh.quad([-.85,.65,0],[.85,.65,0],[.6,-.4,0],[0,-1,0],'#67e8da');
    mesh.quad([-.85,.65,0],[0,-1,0],[-.6,-.4,0],[-.85,.65,0],'#67e8da');
    mesh.box(0,.03,.06,.17,.8,.12,'#e5fff6');mesh.box(0,.2,.07,.65,.16,.12,'#e5fff6');
  });}
  tehilimBook(x,y,z,angle){this.model('tehilim:book',x,y,z,angle,mesh=>{
    mesh.box(0,-.65,0,.95,1.3,.34,'#f0dfb5');
    for(const side of [-1,1])mesh.box(0,-.73,side*.21,1.1,1.46,.08,'#183b70');
    mesh.box(-.53,-.73,0,.12,1.46,.5,'#254b82');
    for(const side of [-1,1]){mesh.box(side*.46,-.6,.26,.035,1.2,.025,'#efc66b');mesh.box(0,side*.6,.26,.95,.035,.025,'#efc66b');}
    // Gold Hebrew lettering: תהילים, right to left across the front cover.
    const glyphs=['111/101/101/101/101','111/101/001/101/101','010/010/000/000/000','101/101/101/111/001','010/010/000/000/000','111/101/101/101/111'];
    for(const [letter,glyph]of glyphs.entries())for(const [row,line]of glyph.split('/').entries())for(let col=0;col<3;col++)if(line[col]==='1')mesh.box(.4-letter*.145+col*.03,.14-row*.045,.27,.027,.04,.025,'#ffe0a0');
    for(let i=0;i<5;i++)mesh.box(0,-.4+i*.055,.18,.84,.013,.025,'#bca77e');
    mesh.box(.2,-.85,0,.12,.4,.06,'#ba4358');
  });}
  tehilimAura(pose,time,remaining,jump){
    const strength=Math.min(1,remaining/1.5),height=jump?.height??0;
    for(let i=0;i<6;i++){const a=time*1.2+i*Math.PI/3,x=pose.x+Math.sin(a)*3.6,z=pose.z+Math.cos(a)*3.6,y=height+2.1+Math.sin(a*2)*.55;
      this.tehilimBook(x,y,z,a+Math.PI/2);this.glow.at(x,y,z);this.glow.particle(0,0,0,.7*strength,[.16*strength,.24*strength,.5*strength]);
      for(let j=0;j<3;j++){const t=(time*1.2+j/3)%1,r=3.6+t*4,fade=(1-t)*strength;this.glow.at(pose.x+Math.sin(a)*r,height+1.7+t*.6,pose.z+Math.cos(a)*r);this.glow.particle(0,0,0,.15+fade*.18,[.1*fade,.18*fade,.45*fade]);}
    }
  }
  hedgeguard(m,pose,actor,time,jump){
    if(actor.driver===10){this.bikerAura(m,pose,actor.heading,time,jump,Math.min(1,actor.hedgeShield/1.5));return;}
    if(actor.driver===9){this.fairyProtection(m,pose,time,Math.min(1,actor.hedgeShield/1.5),jump);return;}
    const strength=Math.min(1,actor.hedgeShield/1.5),pulse=(.75+.25*Math.sin(time*5))*strength,color=actor.driver===5?[.12,.7,.14]:actor.driver===6?[.5,.65,.08]:[.06,.65,.58];
    this.glow.at(pose.x,.15+(jump?.height??0),pose.z);
    for(let i=0;i<48;i++){
      const a=i*Math.PI/24+time*.6,b=(i+.75)*Math.PI/24+time*.6,inner=3.5,outer=3.8;
      this.glow.quad([Math.sin(a)*inner,0,Math.cos(a)*inner],[Math.sin(a)*outer,0,Math.cos(a)*outer],[Math.sin(b)*outer,0,Math.cos(b)*outer],[Math.sin(b)*inner,0,Math.cos(b)*inner],color.map(v=>v*pulse));
      if(i%4===0)this.glow.particle(Math.sin(a)*3.6,1.2+Math.sin(time*2+a)*.8,Math.cos(a)*3.6,.55,color.map(v=>v*pulse));
    }
    // Cached orbiting models keep the aura inexpensive for remote karts too.
    if(strength<1&&Math.sin(time*24)<0)return;
    for(let i=0;i<6;i++){
      const a=time*1.7+i*Math.PI/3,x=pose.x+Math.sin(a)*3.6,z=pose.z+Math.cos(a)*3.6,y=2.2+Math.sin(a*2+time)*.65+(jump?.height??0);
      switch(actor.driver){
        case 5:this.cricket(m,x,y,z,a+Math.PI/2,time);break;
        case 6:this.dollarBundle(m,x,y,z,a,time*.3);break;
        default:this.hedgeguardIcon(x,y,z,-a);break;
      }
    }
  }
  drawPreview(driver,color,time){
    this.arenaExhaust=false;
    const gl=this.gl,canvas=this.canvas,width=Math.max(1,Math.round(canvas.clientWidth*this.pixelRatio())),height=Math.max(1,Math.round(canvas.clientHeight*this.pixelRatio()));
    if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}gl.viewport(0,0,width,height);
    this.instances=[];this.glow=new Mesh();this.smoke=new Mesh();
    const tall=driver===11||driver===12||driver===14;
    const pose=previewPose(driver,time),orbit=time*.28+.35,radius=tall?15:12,eye=[Math.sin(orbit)*radius,tall?9.5:7.4,Math.cos(orbit)*radius],view=cameraMatrix(eye,[0,tall?4:2.55,0],width/height,.8),sky=rgb('#e5deef');
    gl.clearColor(...sky,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.matrix,false,view);gl.uniform3fv(this.eyeUniform,eye);gl.uniform3fv(this.fog,sky);gl.uniform1f(this.fogScale,1);gl.uniform1f(this.darknessUniform,0);gl.uniform1f(this.emission,0);
    const m=new Mesh();m.disc(0,-.22,0,40,40,'#e5deef',48);m.disc(0,-.12,0,4.7,4.7,'#c6bad6',48);m.disc(0,-.08,0,4.5,4.5,'#f8f3e5',48);
    for(let i=0;i<24;i++){const a=i*Math.PI/12;m.at(Math.sin(a)*4.58,-.06,Math.cos(a)*4.58,a);m.box(0,0,0,.1,.025,.14,color);}
    this.kart(m,{x:0,z:0,tx:0,tz:1},color,driver,0,0,pose.boost,time,0,null,true,pose);this.owlFlight.trail(m);this.flush(m,view,height);
    return {...pose,cameraAngle:orbit};
  }
  draw(r,time){
    this.instances=[];
    this.nameplates=[];this.gl.useProgram(this.program);this.gl.uniform1f(this.darknessUniform,0);
    if(r.mode==='combat'){this.drawBattle(r,time);return;}
    if(this.track!==r.track)this.scenery(r.track);
    const gl=this.gl,canvas=this.canvas;const width=Math.round(canvas.clientWidth*this.pixelRatio()),height=Math.round(canvas.clientHeight*this.pixelRatio());if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}gl.viewport(0,0,width,height);
    const sky=rgb(r.track?'#e4b0a3':'#a0d6e5');gl.clearColor(...sky,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.useProgram(this.program);
    const player=sampleTrack(r.s/LENGTH,r.x,r.route),ahead=sampleTrack((r.s+220)/LENGTH,r.x*.6,r.route);
    const shake=r.shake*Math.sin(time*79)*.3,eye=[player.x-player.tx*17+shake,8.5+(r.boost>0?.7:0),player.z-player.tz*17];
    const view=cameraMatrix(eye,[ahead.x,2.5,ahead.z],width/height,r.boost>0?1.2:1.07);
    gl.uniform1f(this.fogScale,1);
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
    this.activeArena=r.arena;this.arenaExhaust=true;this.yudaExhaust.update(`${r.arena}:${r.soundEpoch}:${r.id}`,time);
    this.yudaDrift.update(r,time);
    const helmetScene=`${r.arena}:${r.soundEpoch}:${r.id}`;
    if(this.helmetScene!==helmetScene||time<(this.helmetTime??0)){this.helmetScene=helmetScene;this.helmetFlights=new Map();this.tailFolds.clear();this.receiptRolls.rolls.clear();this.owlFlight.riders.clear();this.batSummons.clear();this.owlFlight.feathers=[];this.yudaJackets.riders.clear();this.yudaStunts.riders.clear();this.lastBodies.clear();this.ashBodies.clear();}this.helmetTime=time;
    if(this.track!==`arena-${r.arena}`)this.arenaScenery(r.arena);
    const gl=this.gl,canvas=this.canvas,width=Math.round(canvas.clientWidth*this.pixelRatio()),height=Math.round(canvas.clientHeight*this.pixelRatio());if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}gl.viewport(0,0,width,height);
    const sky=rgb(arenas[r.arena].sky);gl.clearColor(...sky,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.useProgram(this.program);
    if(r.bomber){
      const scene=`${r.arena}:${r.id}:${r.soundEpoch??0}`;
      if(scene!==this.bomberScene||r.elapsed<(this.bomberElapsed??0)){this.bomberScene=scene;this.bomberFocus=null;}
      const target=r.bots.find(actor=>!actor.bomber&&!actor.inactive&&!actor.destroyed);
      this.bomberFocus??={wx:target?.wx??0,wz:target?.wz??0};this.bomberElapsed=r.elapsed;
    }
    const wobble=r.dizzy>0&&!matchMedia('(prefers-reduced-motion: reduce)').matches?Math.sin((DIZZY_DURATION-r.dizzy)*(r.boost>0?14:10))*(r.boost>0?.24:.14):0;
    const p=combatPose(r),cx=Math.sin(r.cameraHeading+wobble),cz=Math.cos(r.cameraHeading+wobble),overview=r.bomber?bomberCamera(width,height,arenas[r.arena].size,this.bomberView??'3d',this.bomberFocus,this.bomberZoom??1):null,eye=overview?.eye??[p.x-cx*17,10+(r.destroyed?5:0),p.z-cz*17],view=overview?.matrix??cameraMatrix(eye,[p.x+cx*18,1.5,p.z+cz*18],width/height,r.boost>0?1.2:r.wasDrifting?1.13:1.07);
    this.bicycleDrops=new Map();this.drawnBicycles=new Set();for(const s of r.supplies)if(s.kind==='bicycle'&&s.cooldown<=0&&s.age<2)this.bicycleDrops.set(s.owner,s);
    this.bomberMatrix=overview?.matrix??null;
    gl.uniform1f(this.fogScale,overview?.fogScale??1);const dark=darkHumorState(r),bombLights=darkBombLights(r,dark.strength);gl.uniform1f(this.darknessUniform,dark.strength);gl.uniform4fv(this.bombLightsUniform,lightUniforms(bombLights));
    this.nameplates=kartNameplates(r,view,eye);
    gl.uniformMatrix4fv(this.matrix,false,view);gl.uniform3fv(this.eyeUniform,eye);gl.uniform3fv(this.fog,sky);gl.uniform1f(this.emission,0);this.drawBuffer(this.staticBuffer,this.staticCount);
    const m=new Mesh();this.glow=new Mesh();this.smoke=new Mesh();
    for(const skid of r.skids){
      const dx=skid.bx-skid.ax,dz=skid.bz-skid.az,length=Math.hypot(dx,dz);if(length<.01)continue;
      const nx=-dz/length*.24,nz=dx/length*.24,fade=Math.min(1,(r.elapsed-skid.time)/6),ground=rgb(arenas[r.arena].ground),color=ground.map(c=>c*(.28+fade*.65));
      m.quad([skid.ax+nx,.025,skid.az+nz],[skid.bx+nx,.025,skid.bz+nz],[skid.bx-nx,.025,skid.bz-nz],[skid.ax-nx,.025,skid.az-nz],color);
    }
    if(r.timeStop>0){
      const caster=[r,...r.bots].find(a=>a.id===r.timeOwner)??r,phase=(2.5-r.timeStop)*3;
      this.glow.at(caster.wx,0,caster.wz);
      for(let ring=0;ring<7;ring++)for(let i=0;i<96;i++){const a=i*Math.PI/48+phase*(ring%2?1:-1),radius=4+((phase*6+ring*7)%48),b=a+Math.PI/48,y=2+Math.sin(a*3+phase)*1.5+ring*.5;this.glow.quad([Math.cos(a)*radius,y,Math.sin(a)*radius],[Math.cos(b)*radius,y,Math.sin(b)*radius],[Math.cos(b)*(radius+.16),y+.15,Math.sin(b)*(radius+.16)],[Math.cos(a)*(radius+.16),y+.15,Math.sin(a)*(radius+.16)],ring%2?[.08,.45,.7]:[.4,.08,.65]);}
      for(let i=0;i<80;i++){const a=i*2.399+phase*.3,rad=6+(i%20)*2;this.glow.particle(Math.cos(a)*rad,1+(i%9)*1.4,Math.sin(a)*rad,.28,[.18,.6,.8]);}
    }
    const ashKeys=new Set(r.effects.filter(f=>f.type==='ash').map(f=>`${f.wx}:${f.wz}`));for(const key of this.ashBodies.keys())if(!ashKeys.has(key))this.ashBodies.delete(key);
    for(const actor of [r,...r.bots]){
      if(actor.destroyed||actor.bomber||actor.inactive||actor.afk)this.batSummons.delete(actor.id);
      if(actor.bomber||actor.inactive||actor.afk)continue;
      const pose={...combatPose(actor),id:actor.id,vulcan:actor.vulcan,specialActive:actor.specialActive,bikeRoll:this.yudaDrift.roll(actor.id)};if(actor.destroyed){
        const ash=r.effects.find(f=>f.type==='ash'&&Math.hypot(f.wx-pose.x,f.wz-pose.z)<.1),key=`${pose.x}:${pose.z}`;
        if(ash&&(!this.ashBodies.has(key)||ash.age<this.ashBodies.get(key).age)){
          if(!this.lastBodies.has(actor.id)){
            const start=this.instances.length,glow=this.glow.sprites.length,smoke=this.smoke.sprites.length,ghost=new Mesh();
            this.kart(ghost,pose,actor.color??drivers[actor.driver].color,actor.driver,0,0,false,time);
            this.rememberBody(actor,this.instances.slice(start),ghost.data);this.instances.length=start;this.glow.sprites.length=glow;this.smoke.sprites.length=smoke;
          }
          this.ashBodies.set(key,{age:ash.age,points:this.bodyRubble(this.lastBodies.get(actor.id))});
        }
        m.at(pose.x,.1,pose.z);m.disc(0,0,0,2,3,'#343344');continue;
      }
      if(overview){m.at(pose.x,.08,pose.z);m.disc(0,0,0,3.6,3.6,actor.color??drivers[actor.driver].color);}
      const jump=somersaultPose(actor);
      const bodyStart=this.instances.length,dataStart=m.data.length;
      const arrival=actor.driver===5&&actor.id!==r.id?r.effects.find(e=>e.type==='teleportIn'&&e.owner===actor.id&&e.age<.52):null;
      if(arrival)this.teleportKart(pose,actor.color??drivers[5].color,actor.heading,arrivalScale(arrival.age),jump?.height??0,jump?.pitch??0);
      if(!arrival)this.kart(m,pose,actor.color??drivers[actor.driver].color,actor.driver,0,0,actor.boost>0,time,actor.celebrate,jump,actor.driver!==7||actor.vulcan<=0);
      if(actor.driver===14)this.batBuddy(pose,actor,r,time,jump);
      const parts=this.instances.slice(bodyStart);this.rememberBody(actor,parts,parts.length?[]:m.data.slice(dataStart));
      if(r.specialAbilities!==false&&[r,...r.bots].some(a=>a.id!==actor.id&&a.driver===13&&a.specialActive>0)){
        const facing=actor.cameraHeading??actor.heading,phase=Math.floor(time*8)%8;
        this.model('xylophone:'+phase,pose.x+Math.sin(facing)*5,0,pose.z+Math.cos(facing)*5,facing,mesh=>drawXylophone(mesh,phase));
      }
      if(actor.driver===7)this.houstonHelmet(pose,actor,time,jump);
      if(actor.hedgeShield>0)this.hedgeguard(m,pose,actor,time,jump);
      if(r.specialAbilities!==false&&actor.driver===7&&actor.specialActive>0){
        m.at(pose.x,.06,pose.z);m.disc(0,0,0,8,8,'#140e28',64);m.disc(0,.02,0,2.1,2.1,'#03040d',48);
        this.glow.at(pose.x,.1,pose.z);
        for(let arm=0;arm<5;arm++)for(let i=0;i<80;i++){const t=i/80,u=(i+1)/80,r=1.8+t*6.2,rr=1.8+u*6.2,a=arm*Math.PI*2/5+t*7-time*2.4,b=arm*Math.PI*2/5+u*7-time*2.4,y=t*t*1.7,yy=u*u*1.7,w=.12+t*.22;this.glow.quad([Math.cos(a)*r,y,Math.sin(a)*r],[Math.cos(b)*rr,yy,Math.sin(b)*rr],[Math.cos(b)*(rr+w),yy+.06,Math.sin(b)*(rr+w)],[Math.cos(a)*(r+w),y+.06,Math.sin(a)*(r+w)],arm%2?[.12,.32,.8]:[.5,.13,.7]);}
        for(let i=0;i<60;i++){const t=(i/60-time*.24)%1+1,f=t%1,r=2+f*6,a=i*2.399-time*3-f*4;this.glow.particle(Math.cos(a)*r,f*f*1.8,Math.sin(a)*r,.12+f*.15,[.25,.45,.85]);}
        for(let i=0;i<64;i++){const a=i*Math.PI/32,b=(i+1)*Math.PI/32;this.glow.quad([Math.cos(a)*2,.04,Math.sin(a)*2],[Math.cos(b)*2,.04,Math.sin(b)*2],[Math.cos(b)*2.12,.1,Math.sin(b)*2.12],[Math.cos(a)*2.12,.1,Math.sin(a)*2.12],[.35,.55,.9]);}
        for(const s of r.supplies){if(s.cooldown>0||Math.hypot(s.wx-pose.x,s.wz-pose.z)>80)continue;this.glow.at(s.wx,1.8,s.wz);for(let i=0;i<8;i++){const t=(time*.7+i/8)%1,a=t*10+time*3;this.glow.particle((pose.x-s.wx)*t+Math.cos(a)*.4,Math.sin(t*Math.PI)*2,(pose.z-s.wz)*t+Math.sin(a)*.4,.13,[.12,.35,.7]);}}
      }
      if(r.specialAbilities!==false&&actor.driver===11&&actor.specialActive>0)this.holyArchangels(pose,actor,time,jump);

      if(actor.tehilim>0)this.tehilimAura(pose,time,actor.tehilim,jump);
      if(actor.dizzy>0)for(let i=0;i<6;i++){const angle=time*(actor.boost>0?9:5)+i*Math.PI/3;m.at(pose.x+Math.sin(angle)*3.2,6.8+Math.sin(angle*2)*.5,pose.z+Math.cos(angle)*3.2,angle);m.box(0,0,0,1.2,.22,.3,'#fff08b');m.box(0,0,0,.3,.22,1.2,'#fff08b');this.glow.at(m.origin[0],m.origin[1],m.origin[2]);this.glow.particle(0,0,0,.8,[.7,.6,.05]);}
      if(actor.vulcan>0&&actor.driver===10)this.laserMount(m,pose,actor,time,jump);
      if(actor.vulcan>0&&actor.driver!==10&&actor.driver!==14){
        const pulse=.8+.2*Math.sin(time*4);this.glow.at(pose.x,.15,pose.z);
        for(let i=0;i<32;i++){const a=i/32*Math.PI*2,b=(i+1)/32*Math.PI*2;this.glow.quad([Math.cos(a)*3.3,0,Math.sin(a)*3.3],[Math.cos(b)*3.3,0,Math.sin(b)*3.3],[Math.cos(b)*3.65,0,Math.sin(b)*3.65],[Math.cos(a)*3.65,0,Math.sin(a)*3.65],[.55*pulse,.23*pulse,.02]);}
        for(let i=0;i<8;i++){const a=time*1.5+i*Math.PI/4;this.glow.particle(Math.cos(a)*3.5,.3+Math.sin(a*2)*.12,Math.sin(a)*3.5,.8,[.8*pulse,.35*pulse,.03]);}
        if(actor.driver===11)this.chopperVulcan(pose,actor,time,jump);
        if(actor.driver!==11){
          m.at(pose.x,.85,pose.z,actor.heading);for(const side of [-1,1])m.box(side*1.72,0,0,.12,.24,3.7,'#ffd066');
          m.at(pose.x,1.6,pose.z,actor.heading);m.box(0,0,1.4,1,.55,1.2,actor.driver===9?'#ffd2df':'#3e4251');
          for(let i=0;i<3;i++){const a=time*35+i*Math.PI*2/3;m.box(Math.sin(a)*.25,.28+Math.cos(a)*.25,2.3,.18,.18,1.4,actor.driver===9?'#e9bc65':'#b3b9c6');}
          if(actor.item==='hedgehog'&&actor.fireCooldown>.035){this.glow.at(pose.x,1.9,pose.z,actor.heading);this.glow.particle(0,0,3.2,1.4,[1,.55,.08]);this.glow.particle(0,0,3.7,.65,[1,.85,.4]);}
        }
      }
      m.at(pose.x,6,pose.z,r.heading);for(let i=0;i<actor.health;i++)m.box((i-(actor.health-1)/2)*.6,0,0,.5,.25,.15,i>=3?'#ffe095':'#b8ef8e');
      if(actor.shield>0&&actor.driver===9)this.fairyProtection(m,pose,time,Math.min(1,actor.shield),jump);
      if(actor.shield>0&&actor.driver===10)this.bikerAura(m,pose,actor.heading,time,jump,Math.min(1,actor.shield));
      if(actor.shield>0&&actor.driver!==9&&actor.driver!==10){this.glow.at(pose.x,.12,pose.z);for(let i=0;i<18;i++){const a=i/18*Math.PI*2+time;this.glow.particle(Math.cos(a)*3,1,Math.sin(a)*3,.4,[.05,.25,.4]);}}
    }
    for(const supply of r.supplies){if(supply.cooldown>0)continue;if(supply.kind==='bicycle'){if(!this.drawnBicycles.has(supply.id))this.bicycleDrop(supply,time);continue;}const pose={x:supply.wx,z:supply.wz,tx:0,tz:1},bob=Math.sin(time*2)*.3;m.at(pose.x,.1,pose.z);m.disc(0,0,0,3,3,{missile:'#c65d51',hedgehog:'#bb9c68',boost:'#d4bc55',health:'#78b88c',hedgeproof:'#52c9bc',tehilim:'#6388cf'}[supply.kind]);switch(supply.kind){case 'tehilim':this.tehilimBook(pose.x,2+bob,pose.z,time);this.glow.at(pose.x,2,pose.z);this.glow.particle(0,0,0,2.5,[.08,.15,.4]);break;case 'hedgeproof':this.hedgeguardIcon(pose.x,2+bob,pose.z,time);this.glow.at(pose.x,1.8+bob,pose.z);this.glow.particle(0,0,0,2.8,[.08,.45,.38]);break;case 'missile':this.missile(m,pose,2+bob,time,1.5);break;case 'hedgehog':this.hedgehog(m,pose.x,1.5+bob,pose.z,1.1,time);break;case 'boost':m.at(pose.x,1+bob,pose.z,time);m.box(0,0,0,1.2,2,.8,'#f1cc62');break;case 'health':m.at(pose.x,1+bob,pose.z,time);m.box(0,.7,0,2.4,.7,.5,'#d6f4c6');m.box(0,0,0,.7,2.4,.5,'#d6f4c6');break;}}
    for(const shot of r.projectiles){
      const pose={x:shot.wx,z:shot.wz,tx:Math.sin(shot.heading),tz:Math.cos(shot.heading)},owner=shot.vulcan?(shot.owner===r.id?r:r.bots.find(actor=>actor.id===shot.owner)):null,cricket=shot.kind==='hedgehog'&&owner?.driver===5,dollars=shot.kind==='hedgehog'&&owner?.driver===6,electrons=shot.kind==='hedgehog'&&owner?.driver===8,pumps=shot.kind==='hedgehog'&&owner?.driver===9,laser=shot.kind==='hedgehog'&&owner?.driver===10;
      if(shot.kind==='missile'){this.missile(m,pose,shot.height);this.glow.at(shot.wx,shot.height,shot.wz,shot.heading);this.glow.flame(0,0,-1,.25,2,[.5,.17,.03],time);}
      if(shot.kind==='hedgehog'){
        if(cricket)this.cricket(m,shot.wx,shot.height,shot.wz,shot.heading,time);
        if(dollars)this.dollarBundle(m,shot.wx,shot.height,shot.wz,shot.heading,time);
        if(electrons)this.electron(m,shot.wx,shot.height,shot.wz,shot.heading,time);
        if(pumps)this.balletPump(m,shot.wx,shot.height,shot.wz,shot.heading,time);
        if(laser)this.laserBolt(m,shot.wx,shot.height,shot.wz,shot.heading);
        if(!cricket&&!dollars&&!electrons&&!pumps&&!laser)this.hedgehog(m,shot.wx,shot.height,shot.wz,shot.vulcan?.45:.6,time*15);
      }
      for(let i=0;i<shot.trail.length;i+=3){const t=shot.trail[i],size=.12+(1-i/shot.trail.length)*.5;if(shot.vulcan){this.glow.at(t.wx,t.height,t.wz);this.glow.particle(0,0,0,.32,cricket?[.12,.6,.035]:dollars?[.2,.55,.06]:electrons?[.04,.35,.8]:laser?[.025,.65,.45]:pumps?(i%2?[.8,.46,.12]:[.7,.16,.38]):[.7,.35,.03]);continue;}m.at(t.wx,t.height,t.wz);m.ball(0,0,0,size,size,size,shot.kind==='missile'?'#c5c6c8':'#d7bf85',5,3);}
    }
    for(const bomb of r.bombs??[]){
      const progress=Math.min(1,bomb.age/BOMB_FALL_TIME),height=65*(1-progress*progress),stink=bomb.kind==='stink',radius=stink?STINK_RADIUS:BOMB_OUTER_RADIUS;
      m.at(bomb.wx,.15,bomb.wz);for(let i=0;i<40;i++){const a=i/40*Math.PI*2,b=(i+.65)/40*Math.PI*2,inner=radius-.7,outer=radius;m.quad([Math.sin(a)*inner,0,Math.cos(a)*inner],[Math.sin(a)*outer,0,Math.cos(a)*outer],[Math.sin(b)*outer,0,Math.cos(b)*outer],[Math.sin(b)*inner,0,Math.cos(b)*inner],stink?'#a8db63':'#ff6848');}
      if(!stink)for(let i=0;i<40;i++){const a=i*Math.PI/20,b=(i+.7)*Math.PI/20;m.quad([Math.sin(a)*(BOMB_RADIUS-.5),.02,Math.cos(a)*(BOMB_RADIUS-.5)],[Math.sin(a)*BOMB_RADIUS,.02,Math.cos(a)*BOMB_RADIUS],[Math.sin(b)*BOMB_RADIUS,.02,Math.cos(b)*BOMB_RADIUS],[Math.sin(b)*(BOMB_RADIUS-.5),.02,Math.cos(b)*(BOMB_RADIUS-.5)],'#ff453b');}
      m.box(0,0,0,4,.15,.5,'#fff0b3');m.box(0,0,0,.5,.15,4,'#fff0b3');
      const scale=overview?.halfHeight?1+(1-progress)*.8:1;
      if(stink){m.at(bomb.wx,height,bomb.wz,bomb.age*3);m.box(0,-1.8,0,2.7*scale,3.6*scale,2.7*scale,'#83ae4f');m.box(0,1.8*scale,0,1.8*scale,.6,1.8*scale,'#dedb88');continue;}
      m.at(bomb.wx,height,bomb.wz,bomb.age*3);m.ball(0,0,0,2.2*scale,3.4*scale,2.2*scale,'#39334e',10,6);m.box(0,2.3*scale,0,5*scale,.5,.7*scale,'#ffdb69');m.box(0,2.3*scale,0,.7*scale,.5,5*scale,'#ffdb69');
      this.glow.at(bomb.wx,height+3,bomb.wz);this.glow.particle(0,0,0,3,[.8,.35,.03]);
    }
    for(const effect of r.effects){if(effect.type==='teleportOut'||effect.type==='teleportIn'){
      if(effect.type==='teleportOut'){const pose=departurePose(effect.age);this.teleportKart({x:effect.wx,z:effect.wz},effect.color??drivers[5].color,effect.heading??0,pose.scale,pose.height,pose.pitch);}
      drawTeleportHaze(this,effect,time);continue;
    }if(effect.type==='taxAudit'){drawTaxAudit(m,effect,r.cameraHeading);continue;}if(effect.type==='heartbeat'){const actor=[r,...r.bots].find(a=>a.id===effect.owner),x=actor?.wx??effect.wx,z=actor?.wz??effect.wz,t=effect.age,fade=1-t/effect.life,size=(1+.35*Math.exp(-t*18)+.3*Math.exp(-(((t-.18)*20)**2)))*fade;m.at(x,7+t*.6,z,r.cameraHeading);m.ball(-.28*size,.18*size,0,.38*size,.38*size,.24*size,'#ff779d',10,6);m.ball(.28*size,.18*size,0,.38*size,.38*size,.24*size,'#ff779d',10,6);m.cone(0,.1*size,0,.6*size,-.85*size,'#e94c7f',12);this.glow.at(x,7,z);this.glow.particle(0,0,0,size*1.4,[.5*fade,.08*fade,.17*fade]);continue;}if(effect.type==='fashionSnap'){this.fashionSnap(m,effect,time);continue;}if(effect.type==='fireRingOut'){drawFireRingOut(m,this.glow,this.smoke,effect,time);continue;}if(effect.type==='fireRing'){drawFireRing(m,this.glow,effect,time);continue;}if(effect.type==='yudaSmoke')continue;if(effect.type==='radiation'){this.radiationZone(m,effect,time);continue;}if(effect.type==='ash'){this.ashRemains(m,effect);continue;}if(effect.type==='abomb'){this.atomicExplosion(m,effect);continue;}if(effect.type==='explosion'){this.explosion(m,effect);continue;}for(let i=0;i<10;i++){const a=i*2.4,t=effect.age;m.at(effect.wx+Math.cos(a)*t*8,1+t*4,effect.wz+Math.sin(a)*t*8);m.ball(0,0,0,.12,.12,.12,'#f4dc8b',5,3);}}
    for(const cloud of r.stinkClouds??[]){const fade=Math.min(1,(cloud.life-cloud.age)/.7);for(let i=0;i<15;i++){const angle=i*2.399+cloud.age*.2,radius=2+(i%5)*2.6,x=cloud.wx+Math.sin(angle)*radius,z=cloud.wz+Math.cos(angle)*radius,y=1+(i%3)+Math.sin(cloud.age*2+i)*.7;this.smoke.at(x,y,z);this.smoke.particle(0,0,0,(7+cloud.age*2)*Math.sqrt(fade),[.5,.7,.23]);this.glow.at(x,y+.4,z);this.glow.particle(0,0,0,.25*fade,[.15,.3,.04]);}}
    for(const cloud of r.chaffClouds){
      const t=cloud.age,fade=Math.min(1,(cloud.life-t)/1.4),expansion=1-Math.exp(-t*2.5);
      const fairy=[r,...r.bots].some(actor=>actor.id===cloud.owner&&actor.driver===9);
      const tint=rgb(cloud.color??'#a8cde1'),flake=tint.map(c=>.15+c*.85),highlight=tint.map(c=>.65+c*.35),smoke=tint.map(c=>.45+c*.45);
      for(let i=0;i<96;i++){
        const a=i*2.399,spread=(2+expansion*3.5)*(1+i%5*.16),x=cloud.wx+Math.cos(a)*spread+Math.sin(t*.7+i)*.4,z=cloud.wz+Math.sin(a)*spread+Math.cos(t*.6+i)*.4,y=2.5+(i%7)*.55+Math.sin(t*1.8+i)*.7-(1-fade);
        m.at(x,y,z,a+t*4);
        if(fairy&&i%8===0)this.model('fairy-star',x,y,z,a+t,drawFairyStar);
        if(!fairy)m.box(0,0,0,.22+fade*.2,.04,.6,i%3?flake:highlight);
        this.glow.at(x,y,z);const sparkle=(.55+.45*Math.sin(i*3+t*12)**2)*fade;this.glow.particle(0,0,0,(i%3===0?1.8:.8)*fade,(fairy&&i%2?[.95,.62,.22]:flake).map(c=>c*sparkle));
      }
      this.smoke.at(cloud.wx,3+Math.sin(t)*.3,cloud.wz);this.smoke.particle(0,0,0,(fairy?5:10+expansion*8)*Math.sqrt(fade),fairy?[.98,.65,.81]:smoke);
      if(t<.45){this.glow.at(cloud.wx,2.5,cloud.wz);this.glow.particle(0,0,0,9*(1-t/.45),flake);for(let i=0;i<16;i++){const f=i/15;this.glow.at(cloud.originX+(cloud.wx-cloud.originX)*f,1.5+Math.sin(f*Math.PI)*2,cloud.originZ+(cloud.wz-cloud.originZ)*f);this.glow.particle(0,0,0,1.2*(1-t/.45),flake);}}
    }
    const bikers=new Set([r,...r.bots].filter(actor=>actor.driver===10).map(actor=>actor.id));
    for(const particle of r.driftParticles){
      if(bikers.has(particle.owner))continue;
      const fade=1-particle.age/particle.life;
      if(particle.kind==='smoke'){const size=(1.5+particle.age*6)*Math.sqrt(fade);this.smoke.at(particle.wx,particle.height,particle.wz);this.smoke.particle(0,0,0,size,[.74,.77,.8]);continue;}
      const tint=[[.9,.35,.04],[.05,.55,1],[.65,.15,1]][particle.level].map(c=>c*fade);
      this.glow.at(particle.wx,particle.height,particle.wz);this.glow.particle(0,0,0,.42*fade,tint);this.glow.particle(-particle.vx*.025,-particle.vy*.025,-particle.vz*.025,.2*fade,tint);
    }
    this.bikerSparks();this.yudaExhaust.draw(this.smoke,time);
    if(r.wasDrifting&&r.driver!==10){this.glow.at(p.x,.25,p.z,r.heading);const color=r.drift>=.85?[.5,.08,.9]:r.drift>=.45?[0,.4,.9]:[.6,.2,.02];for(const side of [-1,1])this.glow.particle(side*1.65,0,-1.4,1,color);}
    this.owlFlight.trail(m);this.flush(m,view,overview?.halfHeight?height/(2*overview.halfHeight):height);
    this.darkState=dark;
    if(dark.strength>0){
      this.darkFog??=new DarkFog(gl);this.darkFog.draw(this,time,dark.strength,bombLights,view,eye);
      this.nameplates=[];
      if(dark.xray){
        gl.disable(gl.DEPTH_TEST);gl.uniform1f(this.emission,1);gl.uniform1f(this.fogScale,0);
        // Amber geometry outlines stay distinct from the cyan racer silhouettes.
        this.model('dark:arena:'+r.arena,0,0,0,0,mesh=>drawXrayArena(mesh,arenas[r.arena]));
        const navigation=this.instances.pop();this.drawBuffer(navigation.buffer,navigation.count);
        gl.uniform1f(this.xray,1);
        for(const actor of [r,...r.bots]){if(actor.destroyed||actor.inactive||actor.afk||actor.bomber)continue;
          for(const instance of this.lastBodies.get(actor.id)?.parts??[]){gl.uniform3f(this.originUniform,instance.x,instance.y,instance.z);gl.uniform2f(this.rotationUniform,Math.cos(instance.angle),Math.sin(instance.angle));gl.uniform2f(this.pitchUniform,Math.cos(instance.pitch),Math.sin(instance.pitch));gl.uniform2f(this.rollUniform,Math.cos(instance.roll),Math.sin(instance.roll));this.drawBuffer(instance.buffer,instance.count);}
        }
        gl.uniform3f(this.originUniform,0,0,0);gl.uniform2f(this.rotationUniform,1,0);gl.uniform2f(this.pitchUniform,1,0);gl.uniform2f(this.rollUniform,1,0);gl.uniform1f(this.xray,0);
        const signals=new Mesh();
        for(const shot of r.projectiles){
          if(shot.life<=0)continue;const color=shot.owner===r.id?'#a4ffb6':'#ff709d',length=shot.kind==='missile'?1.6:.55,width=shot.kind==='missile'?.38:.2;
          signals.at(shot.wx,shot.height,shot.wz,shot.heading);signals.tri([-width,0,-length],[width,0,-length],[0,0,length],color);signals.tri([0,-width,-length],[0,width,-length],[0,0,length],color);signals.ball(0,0,0,width,width,width,color,7,4);
          for(let i=0;i<shot.trail.length;i+=3){const trail=shot.trail[i];signals.at(trail.wx,trail.height,trail.wz);signals.ball(0,0,0,.075,.075,.075,color,5,3);}
        }
        for(const bomb of r.bombs??[]){const progress=Math.min(1,bomb.age/BOMB_FALL_TIME),color=bomb.owner===r.id?'#a4ffb6':'#ff709d';signals.at(bomb.wx,65*(1-progress*progress),bomb.wz);signals.ball(0,0,0,1.6,2.4,1.6,color,10,6);}
        gl.bindBuffer(gl.ARRAY_BUFFER,this.dynamicBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(signals.data),gl.DYNAMIC_DRAW);this.drawBuffer(this.dynamicBuffer,signals.data.length/9);
        gl.uniform1f(this.xray,0);gl.uniform1f(this.emission,0);gl.uniform1f(this.fogScale,overview?.fogScale??1);gl.uniform3f(this.originUniform,0,0,0);gl.uniform2f(this.rotationUniform,1,0);gl.uniform2f(this.pitchUniform,1,0);gl.uniform2f(this.rollUniform,1,0);gl.enable(gl.DEPTH_TEST);
      }
    }
  }
  bikerSparks(){
    for(const rider of this.yudaDrift.riders.values())if(rider.contact){this.glow.at(rider.contact.x,.18,rider.contact.z);this.glow.particle(0,0,0,1,[[.7,.22,.02],[.02,.4,.85],[.6,.08,.9]][rider.level]);}
    for(const spark of this.yudaDrift.sparks){
      const fade=1-spark.age/spark.life,color=spark.hot?[fade,.8*fade,.32*fade]:[fade,.28*fade,.025*fade];
      this.glow.at(spark.x,spark.y,spark.z);this.glow.particle(0,0,0,.24*fade,color);
      this.glow.particle(-spark.vx*.035,Math.max(.04-spark.y,-spark.vy*.035),-spark.vz*.035,.14*fade,color);
    }
  }
  atomicExplosion(m,effect){
    const t=effect.age,fade=Math.max(0,1-t/3),radius=Math.min(BOMB_OUTER_RADIUS,t*48);
    this.glow.at(effect.wx,.3,effect.wz);
    for(let i=0;i<48;i++){const a=i/48*Math.PI*2,b=(i+1)/48*Math.PI*2;this.glow.quad([Math.sin(a)*radius,0,Math.cos(a)*radius],[Math.sin(b)*radius,0,Math.cos(b)*radius],[Math.sin(b)*(radius+1.2),0,Math.cos(b)*(radius+1.2)],[Math.sin(a)*(radius+1.2),0,Math.cos(a)*(radius+1.2)],[fade,.4*fade,.04*fade]);}
    for(let i=0;i<12;i++){
      const a=i*2.399,r=5+t*3,y=6+t*14;
      m.at(effect.wx+Math.sin(a)*r,y+(i%3)*2,effect.wz+Math.cos(a)*r);m.ball(0,0,0,(5+t*2)*fade,(3+t)*fade,(5+t*2)*fade,t<.45?'#fff0a0':t<1.2?'#ff9b48':'#817783',8,5);
    }
    // The translucent lower plume leaves the incinerated character visible.
    for(let i=0;i<5;i++){this.smoke.at(effect.wx,1+i*(2+t*1.7),effect.wz);this.smoke.particle(0,0,0,(4+t*2)*Math.sqrt(fade),t<.5?[.92,.77,.5]:[.61,.57,.56]);}
    this.glow.at(effect.wx,2,effect.wz);this.glow.particle(0,0,0,Math.max(0,24-t*68),[fade,.55*fade,.12*fade]);
  }
  radiationZone(m,zone,time){
    const fade=Math.max(0,Math.min(1,zone.life-zone.age)),pulse=.65+.2*Math.sin(time*5),radius=BOMB_OUTER_RADIUS;
    this.glow.at(zone.wx,.055,zone.wz);
    for(let i=0;i<72;i++){
      const a=i*Math.PI/36,b=(i+.8)*Math.PI/36;
      this.glow.quad([Math.sin(a)*(radius-.45),0,Math.cos(a)*(radius-.45)],[Math.sin(a)*radius,0,Math.cos(a)*radius],[Math.sin(b)*radius,0,Math.cos(b)*radius],[Math.sin(b)*(radius-.45),0,Math.cos(b)*(radius-.45)],[.26*pulse*fade,.65*pulse*fade,.035*fade]);
    }
    const icon=(x,z)=>this.model('radiation:trefoil',x,.07,z,0,mesh=>{
      mesh.disc(0,0,0,2.8,2.8,'#d8e861',24);mesh.disc(0,.015,0,.42,.42,'#263727',14);
      for(let arm=0;arm<3;arm++)for(let i=0;i<7;i++){
        const a=arm*Math.PI*2/3+i*Math.PI/21,b=a+Math.PI/21;
        mesh.quad([Math.sin(a)*.75,.02,Math.cos(a)*.75],[Math.sin(a)*2.25,.02,Math.cos(a)*2.25],[Math.sin(b)*2.25,.02,Math.cos(b)*2.25],[Math.sin(b)*.75,.02,Math.cos(b)*.75],'#263727');
      }
    });
    if(fade>.25||Math.sin(time*14)>0){icon(zone.wx,zone.wz);for(let i=0;i<3;i++){const a=i*Math.PI*2/3;icon(zone.wx+Math.sin(a)*18,zone.wz+Math.cos(a)*18);}}
    this.smoke.at(zone.wx,.3,zone.wz);this.glow.at(zone.wx,.15,zone.wz);
    for(let i=0;i<18;i++){
      const a=i*2.399,r=4+(i%5)*4,t=(time*.35+i*.17)%1;
      this.glow.particle(Math.sin(a)*r,.25+t*.5,Math.cos(a)*r,.35*fade,[.14*fade,.42*fade,.025]);
      if(i%3===0)this.smoke.particle(Math.sin(a)*r,.2+t*.6,Math.cos(a)*r,(3+t*2)*Math.sqrt(fade),[.48,.65,.18]);
    }
  }
  ashRemains(m,effect){
    const t=effect.age,key=`${effect.wx}:${effect.wz}`,fade=Math.max(0,Math.min(1,(effect.life-t)/.6));
    let body=this.ashBodies.get(key);
    if(!body||t<body.age){
      const source=[...this.lastBodies.values()].find(b=>Math.hypot(b.x-effect.wx,b.z-effect.wz)<3);
      body={age:t,points:source?this.bodyRubble(source):[]};this.ashBodies.set(key,body);
    }
    body.age=t;
    for(const [i,point]of body.points.entries()){
      const age=Math.max(0,t-.18-(i%7)*.045),p=Math.min(1,age/(.65+i%5*.04)),fall=p*p*(3-2*p),a=i*2.399,radius=.25+(i%17)/17*1.9;
      const x=point[0]*(1-fall)+Math.sin(a)*radius*fall,z=point[2]*(1-fall)+Math.cos(a)*radius*fall;
      const ground=.08+Math.max(0,1-radius/2.3)*.65,bounce=Math.sin(p*Math.PI)*.12;
      const y=point[1]*(1-fall)+ground*fall+bounce;
      m.at(effect.wx+x,y,effect.wz+z,a*fall);m.pitch=Math.sin(a)*fall*2;
      const size=(.2+i%3*.035)*Math.cbrt(fade);m.box(0,0,0,size,size*.8,size,i%5===0?'#b4b1a8':i%2?'#777b80':'#50565d');
    }
    this.smoke.at(effect.wx,.4,effect.wz);
    const simmer=Math.max(0,t-1.3);
    for(let i=0;i<16;i++){
      const age=(simmer*.55+i/16)%1,a=i*2.399+simmer*.35;
      this.smoke.particle(Math.sin(a)*(.4+age),age*2.6,Math.cos(a)*(.4+age),(.5+age*1.4)*Math.sqrt(fade),[.39,.41,.44]);
      if(t>1.3&&i%4===0){this.glow.at(effect.wx+Math.sin(a)*1.1,.2,effect.wz+Math.cos(a)*1.1);this.glow.particle(0,0,0,.18*fade,[.22*fade,.055*fade,.008]);}
    }
  }
  rubbleSamples(data){
    const points=new Map(),step=Math.max(1,Math.floor(data.length/9/480));
    for(let i=0;i<data.length;i+=9*step){const point=data.slice(i,i+3),key=point.map(v=>Math.round(v/.18)).join(':');if(!points.has(key))points.set(key,point);}
    return [...points.values()];
  }
  rememberBody(actor,parts,dynamic){
    parts=parts.filter(part=>!part.detached);
    this.lastBodies.set(actor.id,{x:actor.wx,z:actor.wz,parts,dynamic:parts.length?[]:this.rubbleSamples(dynamic)});
  }
  bodyRubble({x,z,parts,dynamic}){
    const actor={wx:x,wz:z};
    const count=parts.reduce((n,p)=>n+p.count,0),points=[];
    for(const part of parts){
      const share=Math.max(8,Math.floor(420*part.count/Math.max(1,count))),step=Math.max(1,Math.ceil(part.rubble.length/share));
      for(let i=0;i<part.rubble.length;i+=step){
        let [x,y,z]=part.rubble[i];
        if(part.plumage){
          const {clock,fold,angle}=part.plumage,reach=Math.max(0,Math.min(1,(y-1.75)/3.8)),wave=clock*1.15+x*.85+y*.45;
          x+=Math.sin(wave*.7)*.16*reach;y+=Math.cos(wave)*.14*reach;z+=Math.sin(wave)*.55*reach;
          const c=Math.cos(angle*fold*.86),s=Math.sin(angle*fold*.86),xx=x*c-(y-1.75)*s,yy=x*s+(y-1.75)*c;
          z+=1.05-Math.abs(angle)*fold*.12;x=xx;y=1.75+yy*Math.cos(-fold*.95)-z*Math.sin(-fold*.95);z=yy*Math.sin(-fold*.95)+z*Math.cos(-fold*.95)-1.05;
        }
        const roll=part.roll??0,xx=x*Math.cos(roll)-(y-.9)*Math.sin(roll);y=x*Math.sin(roll)+(y-.9)*Math.cos(roll)+.9;x=xx;
        const yy=(y-2)*Math.cos(part.pitch)-z*Math.sin(part.pitch)+2,zz=(y-2)*Math.sin(part.pitch)+z*Math.cos(part.pitch);
        points.push([part.x+x*Math.cos(part.angle)+zz*Math.sin(part.angle)-actor.wx,part.y+yy,part.z-x*Math.sin(part.angle)+zz*Math.cos(part.angle)-actor.wz]);
      }
    }
    if(!points.length)for(const point of dynamic)points.push([point[0]-actor.wx,point[1],point[2]-actor.wz]);
    return points;
  }
  flush(m,view,height){
    const gl=this.gl;
    for(const instance of this.instances){gl.uniform3f(this.originUniform,instance.x,instance.y,instance.z);gl.uniform2f(this.rotationUniform,Math.cos(instance.angle),Math.sin(instance.angle));gl.uniform2f(this.pitchUniform,Math.cos(instance.pitch),Math.sin(instance.pitch));gl.uniform2f(this.rollUniform,Math.cos(instance.roll),Math.sin(instance.roll));gl.uniform4f(this.plumageUniform,instance.plumage===null?0:1,instance.plumage?.clock??0,instance.plumage?.fold??0,instance.plumage?.angle??0);this.drawBuffer(instance.buffer,instance.count);}
    gl.uniform3f(this.originUniform,0,0,0);gl.uniform2f(this.rotationUniform,1,0);gl.uniform2f(this.pitchUniform,1,0);gl.uniform2f(this.rollUniform,1,0);gl.uniform4f(this.plumageUniform,0,0,0,0);
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
