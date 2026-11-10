import { targetAhead } from './combat.js';

export const usesMobileControls=(touchPoints,coarse)=>touchPoints>0&&coarse;
export async function allowTilt({mobile,secure,orientation}){
  if(!mobile)throw new Error('Tilt steering is available on phones and tablets.');
  if(!secure)throw new Error('Open the HTTPS invitation link to enable tilt. Touch controls still work.');
  if(!orientation)throw new Error('Motion sensing is unavailable. Use the touch controls.');
  if(typeof orientation.requestPermission==='function'&&await orientation.requestPermission()!=='granted')throw new Error('Motion permission was declined. Touch controls still work.');
}
export class TiltSteering {
  enabled=false;baseline=null;angle=null;steer=0;
  recenter(){this.baseline=null;this.steer=0;}
  sample(beta,gamma,angle=0){
    if(!this.enabled||!Number.isFinite(beta)||!Number.isFinite(gamma))return;
    if(this.angle!==angle){this.angle=angle;this.recenter();}
    const radians=angle*Math.PI/180,roll=gamma*Math.cos(radians)-beta*Math.sin(radians);
    this.baseline??=roll;
    const delta=roll-this.baseline;
    this.steer=Math.sign(delta)*Math.min(1,Math.max(0,Math.abs(delta)-4)/20);
  }
  keys(physical,active){
    const keys=new Set(physical);
    if(!active||!this.enabled||this.baseline===null)return keys;
    if(!['arrowleft','arrowright','a','d'].some(key=>keys.has(key)))keys.steer=Math.round(this.steer*1000)/1000;
    if(!keys.has('arrowdown')&&!keys.has('s'))keys.add('arrowup');
    return keys;
  }
}
export function mobileLockTarget(world,mobile,enabled=true){
  if(!mobile||!enabled||world.mode!=='combat'||world.phase!=='racing'||world.destroyed>0||world.finishCountdown!==null)return null;
  return targetAhead(world,world,world.item==='missile'?.65:.18);
}
