// Arc-length sampled circuit: gameplay, the camera, and the minimap share one road.
const anchors = [[0,260],[220,245],[350,110],[275,-40],[330,-205],[125,-300],[-50,-215],[-190,-265],[-335,-130],[-290,85],[-160,220]];
const raw=[];
for(let i=0;i<anchors.length;i++)for(let j=0;j<70;j++){
  const p0=anchors[(i+anchors.length-1)%anchors.length],p1=anchors[i],p2=anchors[(i+1)%anchors.length],p3=anchors[(i+2)%anchors.length],t=j/70;
  raw.push(p1.map((v,k)=>.5*((2*v)+(-p0[k]+p2[k])*t+(2*p0[k]-5*v+4*p2[k]-p3[k])*t*t+(-p0[k]+3*v-3*p2[k]+p3[k])*t*t*t)));
}
const distances=[0];
for(let i=1;i<=raw.length;i++){const a=raw[i-1],b=raw[i%raw.length];distances.push(distances[i-1]+Math.hypot(b[0]-a[0],b[1]-a[1]));}
export const CIRCUIT_METERS=distances.at(-1);
function sampleMain(progress, lane=0){
  const distance=((progress%1)+1)%1*CIRCUIT_METERS;
  let lo=0,hi=raw.length;
  while(lo+1<hi){const mid=(lo+hi)>>1;if(distances[mid]<=distance){lo=mid;continue;}hi=mid;}
  const a=raw[lo],b=raw[(lo+1)%raw.length],t=(distance-distances[lo])/(distances[lo+1]-distances[lo]);
  const prev=raw[(lo+raw.length-1)%raw.length],next=raw[(lo+2)%raw.length];
  const dx=(b[0]-prev[0])*(1-t)+(next[0]-a[0])*t,dz=(b[1]-prev[1])*(1-t)+(next[1]-a[1])*t,length=Math.hypot(dx,dz),tx=dx/length,tz=dz/length;
  return {x:a[0]+(b[0]-a[0])*t-tz*lane*18,z:a[1]+(b[1]-a[1])*t+tx*lane*18,tx,tz,nx:-tz,nz:tx,y:0};
}
export const branches=[{start:.12,end:.23,side:-1,offset:70,name:'WOODLAND WAY'},{start:.58,end:.71,side:1,offset:80,name:'LAKESIDE LOOP'}];
function branchCenter(progress,route){const p=sampleMain(progress),branch=branches[route-1],f=((progress%1)+1)%1;if(!branch||f<branch.start||f>branch.end)return p;const t=(f-branch.start)/(branch.end-branch.start),offset=branch.side*branch.offset*Math.sin(t*Math.PI)**2;return {...p,x:p.x+p.nx*offset,z:p.z+p.nz*offset};}
export function sampleTrack(progress,lane=0,route=0){
  if(!route)return sampleMain(progress,lane);
  const p=branchCenter(progress,route),a=branchCenter(progress-.0002,route),b=branchCenter(progress+.0002,route),length=Math.hypot(b.x-a.x,b.z-a.z),tx=(b.x-a.x)/length,tz=(b.z-a.z)/length;
  return {...p,x:p.x-tz*lane*18,z:p.z+tx*lane*18,tx,tz,nx:-tz,nz:tx};
}
export function trackBend(progress,route=0){const a=sampleTrack(progress-.003,0,route),b=sampleTrack(progress+.003,0,route);return (a.tx*b.tz-a.tz*b.tx)*6;}
export function routeSpeedScale(progress,route=0){if(!route)return 1;const a=sampleTrack(progress-.001),b=sampleTrack(progress+.001),c=sampleTrack(progress-.001,0,route),d=sampleTrack(progress+.001,0,route);return Math.max(.55,Math.min(1.5,Math.hypot(b.x-a.x,b.z-a.z)/Math.hypot(d.x-c.x,d.z-c.z)));}
export function chooseRoute(kart,before,length){
  const lap=Math.floor(before/length);
  for(const [i,branch] of branches.entries()){const start=(lap+branch.start)*length,end=(lap+branch.end)*length;if(before<start&&kart.s>=start&&!kart.route&&kart.x*branch.side>.3)kart.route=i+1;if(kart.route===i+1&&kart.s>=end)kart.route=0;}
}
