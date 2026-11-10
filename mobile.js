export const usesMobileControls=(touchPoints,coarse)=>touchPoints>0&&coarse;

// One orthographic view drives rendering and tap coordinates in either orientation.
export function arenaOverview(width,height,size=96){
  const extent=size+8,halfWidth=extent*Math.max(1,width/height),halfHeight=extent*Math.max(1,height/width);
  return {halfWidth,halfHeight,eye:[0,140,0],matrix:new Float32Array([1/halfWidth,0,0,0,0,0,-.008,0,0,-1/halfHeight,0,0,0,0,.12,1])};
}
const dot=(a,b)=>a.reduce((sum,value,index)=>sum+value*b[index],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const normalize=vector=>{const length=Math.hypot(...vector);return vector.map(value=>value/length);};

export function bomberCamera(width,height,size=96,view='3d'){
  if(view==='map')return {...arenaOverview(width,height,size),fogScale:1};
  const aspect=width/height,f=1/Math.tan(.9/2),back=normalize([.75,1,1.1]),right=normalize(cross([0,1,0],back)),up=cross(back,right),extent=size+8;
  let distance=180;
  for(const x of [-extent,extent])for(const z of [-extent,extent])for(const y of [0,8]){
    const point=[x,y,z],depth=dot(back,point);
    distance=Math.max(distance,depth+Math.abs(dot(right,point))*f/(aspect*.9),depth+Math.abs(dot(up,point))*f/.9);
  }
  const eye=back.map(value=>value*distance),near=.3,far=1600,a=(far+near)/(near-far),b=2*far*near/(near-far);
  const matrix=new Float32Array([
    f/aspect*right[0],f*up[0],a*back[0],-back[0],
    f/aspect*right[1],f*up[1],a*back[1],-back[1],
    f/aspect*right[2],f*up[2],a*back[2],-back[2],
    -f/aspect*dot(right,eye),-f*dot(up,eye),-a*dot(back,eye)+b,dot(back,eye)
  ]);
  return {eye,matrix,back,right,up,f,aspect,fogScale:Math.min(1,160/distance)};
}

export function bombTarget(clientX,clientY,rect,size=96,view='map'){
  if(!Number.isFinite(clientX)||!Number.isFinite(clientY)||!(rect.width>0)||!(rect.height>0))return null;
  const nx=(clientX-rect.left)/rect.width*2-1,ny=1-(clientY-rect.top)/rect.height*2;
  if(Math.abs(nx)>1||Math.abs(ny)>1)return null;
  const camera=bomberCamera(rect.width,rect.height,size,view);
  let wx=nx*camera.halfWidth,wz=-ny*camera.halfHeight;
  if(view!=='map'){
    const ray=camera.back.map((value,index)=>-value+camera.right[index]*nx*camera.aspect/camera.f+camera.up[index]*ny/camera.f);
    if(ray[1]>=0)return null;
    const distance=-camera.eye[1]/ray[1];
    wx=camera.eye[0]+ray[0]*distance;wz=camera.eye[2]+ray[2]*distance;
  }
  if(Math.abs(wx)>size||Math.abs(wz)>size)return null;
  return {wx,wz};
}
