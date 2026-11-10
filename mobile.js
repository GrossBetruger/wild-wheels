export const usesMobileControls=(touchPoints,coarse)=>touchPoints>0&&coarse;

// One orthographic view drives rendering and tap coordinates in either orientation.
export function arenaOverview(width,height,size=96){
  const extent=size+8,halfWidth=extent*Math.max(1,width/height),halfHeight=extent*Math.max(1,height/width);
  return {halfWidth,halfHeight,eye:[0,140,0],matrix:new Float32Array([1/halfWidth,0,0,0,0,0,-.008,0,0,-1/halfHeight,0,0,0,0,.12,1])};
}
export function bombTarget(clientX,clientY,rect,size=96){
  if(!Number.isFinite(clientX)||!Number.isFinite(clientY)||!(rect.width>0)||!(rect.height>0))return null;
  const {halfWidth,halfHeight}=arenaOverview(rect.width,rect.height,size);
  const wx=((clientX-rect.left)/rect.width*2-1)*halfWidth,wz=((clientY-rect.top)/rect.height*2-1)*halfHeight;
  if(Math.abs(wx)>size||Math.abs(wz)>size)return null;
  return {wx,wz};
}
