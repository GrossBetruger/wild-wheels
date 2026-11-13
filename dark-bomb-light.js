export function darkBombLights(world,strength){
  if(!(strength>0))return [];
  return [...(world.effects??[])].filter(f=>f.type==='abomb'&&f.age>=0&&f.age<1).sort((a,b)=>a.age-b.age).slice(0,4).map(f=>[f.wx,4,f.wz,16*(1-f.age)**2]);
}
export function bombIllumination(lights,point){return lights.reduce((sum,[x,y,z,power])=>sum+power/Math.sqrt(Math.max(1,Math.hypot(point[0]-x,point[1]-y,point[2]-z))),0);}
export function lightUniforms(lights){const data=new Float32Array(16);lights.forEach((light,i)=>data.set(light,i*4));return data;}
export function fogCamera(matrix,eye){
  const right=[matrix[0],matrix[4],matrix[8]],up=[matrix[1],matrix[5],matrix[9]],forward=[matrix[3],matrix[7],matrix[11]];
  const scaled=row=>{const length=row.reduce((sum,v)=>sum+v*v,0);return row.map(v=>v/Math.max(.00001,length));};
  return {eye,right:scaled(right),up:scaled(up),forward,orthographic:Math.hypot(...forward)<.001};
}
