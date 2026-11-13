import {fogCamera,lightUniforms} from './dark-bomb-light.js';
export function darkHumorState(world){
  if(world.specialAbilities===false||world.phase!=='racing')return {strength:0,xray:false};
  const active=[world,...world.bots].filter(a=>a.driver===14&&a.specialActive>0&&!a.destroyed&&!a.inactive&&!a.afk&&!a.bomber);
  const strength=active.reduce((best,a)=>Math.max(best,Math.min(1,(7-a.specialActive)/.4,a.specialActive/.6)),0);
  return {strength,xray:active.some(a=>a.id===world.id),remaining:Math.max(0,...active.map(a=>a.specialActive))};
}
function compile(gl,type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;}
export class DarkFog{
  constructor(gl){
    this.gl=gl;this.program=gl.createProgram();
    gl.attachShader(this.program,compile(gl,gl.VERTEX_SHADER,'attribute vec2 position;varying vec2 uv;void main(){uv=position*.5+.5;gl_Position=vec4(position,0.,1.);}'));
    gl.attachShader(this.program,compile(gl,gl.FRAGMENT_SHADER,`precision mediump float;
      varying vec2 uv;uniform float clock;uniform float strength;uniform float aspect;
      uniform vec4 bombLights[4];uniform vec3 cameraEye;uniform vec3 rayRight;uniform vec3 rayUp;uniform vec3 rayForward;uniform float orthographic;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
      float fbm(vec2 p){float n=0.,w=.5;for(int i=0;i<4;i++){n+=noise(p)*w;p=mat2(1.6,1.2,-1.2,1.6)*p;w*=.5;}return n;}
      void main(){
        vec2 p=(uv-.5)*vec2(aspect,1.)*3.;float t=clock*.22;
        vec2 q=vec2(fbm(p+vec2(t,-t)),fbm(p+vec2(4.1,-t*.6)));
        float clouds=fbm(p*1.8+q*3.+vec2(-t,t*.4));
        float tendrils=pow(max(0.,1.-abs(clouds-.48)*7.),3.);
        float pulse=.72+.28*sin(clock*1.7+clouds*11.);
        vec3 color=vec3(.008,.004,.022)+vec3(.09,.015,.18)*clouds+vec3(.035,.12,.13)*tendrils*pulse;
        float vignette=smoothstep(.1,1.2,length((uv-.5)*vec2(1.1,1.4)));
        color*=1.-vignette*.65;
        vec2 ndc=uv*2.-1.;vec3 ray=rayForward+rayRight*ndc.x+rayUp*ndc.y;
        vec3 fogPoint=cameraEye+ray/max(.0001,length(ray))*160.;
        if(orthographic>.5){fogPoint=cameraEye+rayRight*ndc.x+rayUp*ndc.y;fogPoint.y=0.;}
        else if(ray.y<-.001){fogPoint=cameraEye+ray*min(400.,cameraEye.y/max(.02,-ray.y));}
        float illumination=0.;for(int i=0;i<4;i++){if(bombLights[i].w>0.)illumination+=bombLights[i].w/sqrt(max(1.,distance(fogPoint,bombLights[i].xyz)));}
        float warm=illumination/(1.+illumination);
        color+=vec3(.8,.57,.12)*warm*(.45+clouds*.6);
        gl_FragColor=vec4(color,strength*(.90+.025*clouds)*(1.-.35*warm));
      }`));
    gl.linkProgram(this.program);if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(this.program));
    this.position=gl.getAttribLocation(this.program,'position');this.clock=gl.getUniformLocation(this.program,'clock');this.strength=gl.getUniformLocation(this.program,'strength');this.aspect=gl.getUniformLocation(this.program,'aspect');
    this.bombLights=gl.getUniformLocation(this.program,'bombLights[0]');this.cameraEye=gl.getUniformLocation(this.program,'cameraEye');this.rayRight=gl.getUniformLocation(this.program,'rayRight');this.rayUp=gl.getUniformLocation(this.program,'rayUp');this.rayForward=gl.getUniformLocation(this.program,'rayForward');this.orthographic=gl.getUniformLocation(this.program,'orthographic');
    this.buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
  }
  draw(renderer,time,strength,lights,matrix,eye){
    const gl=this.gl;for(const a of renderer.attributes)gl.disableVertexAttribArray(a);
    gl.useProgram(this.program);gl.disable(gl.DEPTH_TEST);gl.depthMask(false);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
    gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.enableVertexAttribArray(this.position);gl.vertexAttribPointer(this.position,2,gl.FLOAT,false,0,0);
    const camera=fogCamera(matrix,eye);gl.uniform4fv(this.bombLights,lightUniforms(lights));gl.uniform3fv(this.cameraEye,camera.eye);gl.uniform3fv(this.rayRight,camera.right);gl.uniform3fv(this.rayUp,camera.up);gl.uniform3fv(this.rayForward,camera.forward);gl.uniform1f(this.orthographic,camera.orthographic?1:0);
    gl.uniform1f(this.clock,time);gl.uniform1f(this.strength,strength);gl.uniform1f(this.aspect,gl.drawingBufferWidth/gl.drawingBufferHeight);gl.drawArrays(gl.TRIANGLES,0,6);
    gl.disableVertexAttribArray(this.position);gl.disable(gl.BLEND);gl.depthMask(true);gl.enable(gl.DEPTH_TEST);gl.useProgram(renderer.program);
  }
}
export function drawXrayArena(m,arena){
  const wall='#b29a5d',floor='#12313e',thickness=.1;
  const frame=(x,z,w,d,h)=>{
    for(const y of [.08,h]){
      for(const side of [-1,1]){m.box(x+side*w/2,y,z,thickness,thickness,d,wall);m.box(x,y,z+side*d/2,w,thickness,thickness,wall);}
    }
    for(const sx of [-1,1])for(const sz of [-1,1])m.box(x+sx*w/2,.08,z+sz*d/2,thickness,h,thickness,wall);
  };
  // Match the solid scenery, including the inner faces of the perimeter walls.
  for(const [x,z,w,d] of arena.blocks)frame(x,z,w,d,6.35);
  for(const side of [-1,1]){frame(side*(arena.size+2),0,4,(arena.size+4)*2,5);frame(0,side*(arena.size+2),(arena.size+4)*2,4,5);}
  // A faint ground reference shows distances and open lanes without revealing the scene.
  for(let n=-arena.size;n<=arena.size;n+=16){m.box(n,.025,0,.035,.025,arena.size*2,floor);m.box(0,.025,n,arena.size*2,.025,.035,floor);}
}
export function botSightRadius(world,actor){
  if(world.specialAbilities===false)return Infinity;
  const active=[world,...world.bots].filter(a=>a.specialActive>0&&!a.destroyed&&!a.inactive&&!a.afk&&!a.bomber);
  const xylophone=active.some(a=>a.driver===13&&a.id!==actor.id)?35:Infinity;
  const fog=active.some(a=>a.driver===14)&&!(actor.driver===14&&actor.specialActive>0)?20:Infinity;
  return Math.min(xylophone,fog);
}
