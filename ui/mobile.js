export const usesMobileControls=(touchPoints,coarse)=>touchPoints>0&&coarse;

// One orthographic view drives rendering and tap coordinates in either orientation.
export function arenaOverview(width,height,size=96){
  const extent=size+8,halfWidth=extent*Math.max(1,width/height),halfHeight=extent*Math.max(1,height/width);
  return {halfWidth,halfHeight,eye:[0,140,0],matrix:new Float32Array([1/halfWidth,0,0,0,0,0,-.008,0,0,-1/halfHeight,0,0,0,0,.12,1])};
}
const dot=(a,b)=>a.reduce((sum,value,index)=>sum+value*b[index],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const normalize=vector=>{const length=Math.hypot(...vector);return vector.map(value=>value/length);};

export function bomberCamera(width,height,size=96,view='3d',focus={wx:0,wz:0},zoom=1){
  if(view==='map')return {...arenaOverview(width,height,size),fogScale:1};
  const aspect=width/height,f=1/Math.tan(.9/2),back=normalize([.75,1,1.1]),right=normalize(cross([0,1,0],back)),up=cross(back,right);
  const distance=130/Math.max(.75,Math.min(2.5,zoom)),target=[focus.wx,0,focus.wz];
  const eye=back.map((value,index)=>value*distance+target[index]),near=.3,far=1600,a=(far+near)/(near-far),b=2*far*near/(near-far);
  const matrix=new Float32Array([
    f/aspect*right[0],f*up[0],a*back[0],-back[0],
    f/aspect*right[1],f*up[1],a*back[1],-back[1],
    f/aspect*right[2],f*up[2],a*back[2],-back[2],
    -f/aspect*dot(right,eye),-f*dot(up,eye),-a*dot(back,eye)+b,dot(back,eye)
  ]);
  return {eye,matrix,back,right,up,f,aspect,fogScale:Math.min(1,160/distance)};
}

export function bomberGroundPoint(clientX,clientY,rect,size=96,view='map',focus={wx:0,wz:0},zoom=1){
  if(!Number.isFinite(clientX)||!Number.isFinite(clientY)||!(rect.width>0)||!(rect.height>0))return null;
  const nx=(clientX-rect.left)/rect.width*2-1,ny=1-(clientY-rect.top)/rect.height*2;
  if(Math.abs(nx)>1||Math.abs(ny)>1)return null;
  const camera=bomberCamera(rect.width,rect.height,size,view,focus,zoom);
  let wx=nx*camera.halfWidth,wz=-ny*camera.halfHeight;
  if(view!=='map'){
    const ray=camera.back.map((value,index)=>-value+camera.right[index]*nx*camera.aspect/camera.f+camera.up[index]*ny/camera.f);
    if(ray[1]>=0)return null;
    const distance=-camera.eye[1]/ray[1];
    wx=camera.eye[0]+ray[0]*distance;wz=camera.eye[2]+ray[2]*distance;
  }
  return {wx,wz};
}
export function bombTarget(clientX,clientY,rect,size=96,view='map',focus={wx:0,wz:0},zoom=1){
  const point=bomberGroundPoint(clientX,clientY,rect,size,view,focus,zoom);
  if(!point||Math.abs(point.wx)>size||Math.abs(point.wz)>size)return null;
  return point;
}
export function panBomber(start,current,rect,focus,zoom=1,size=96){
  const anchor=bomberGroundPoint(start.x,start.y,rect,size,'3d',focus,zoom),point=bomberGroundPoint(current.x,current.y,rect,size,'3d',focus,zoom);
  if(!anchor||!point)return focus;
  return {wx:Math.max(-size,Math.min(size,focus.wx+anchor.wx-point.wx)),wz:Math.max(-size,Math.min(size,focus.wz+anchor.wz-point.wz))};
}
