export function previewPose(driver,time){
  const stage=Math.floor(time/4)%4,age=time%4,ramp=Math.min(1,age/.4,(4-age)/.4),ease=ramp*ramp*(3-2*ramp);
  const pose={id:'hello',label:driver===8?'WORM SALUTE':'WAVING',left:0,right:0,yaw:0,lean:0,bounce:0,boost:false,tailFold:0};
  switch(stage){
    case 0:pose.right=(1.8+Math.sin(time*9)*.3)*ease;pose.lean=driver===8?.24*ease:0;break;
    case 1:pose.id='cheer';pose.label=driver===8?'HAPPY WRIGGLE':'CHEERING';pose.left=pose.right=(2+Math.sin(time*7)*.15)*ease;pose.bounce=Math.abs(Math.sin(time*5))*.18*ease;break;
    case 2:pose.id='look';pose.label='LOOKING AROUND';pose.yaw=Math.sin(age*Math.PI/2)*.7*ease;break;
    case 3:pose.id='rev';pose.label='REVVING';pose.boost=true;pose.tailFold=ease;break;
  }
  if(driver===9&&(stage===0||stage===1)){pose.label='ROYAL WAVE';pose.left=0;pose.right=1.8*ease;pose.bounce=0;}
  if(driver===10){pose.left=0;pose.bounce=0;pose.right=(stage===0||stage===1)?ease:0;pose.label=['SHADES SALUTE','LA VIE','CHECKING THE HORIZON','ONE-HANDED WHEELIE'][stage];}
  if(driver===11)pose.label=['REGAL WAVE','ROYAL ROAR','LOOKING AROUND','ROTOR WASH'][stage];
  if(driver===12)pose.label=['A CARING WAVE','BUTTERFLY JOY','CHECKING ON EVERYONE','CARE ON THE WAY'][stage];
  if(driver===13)pose.label=['NERVOUS HELLO','BOOKS BALANCED!','CHECKING THE TOTALS','CRUNCHING NUMBERS'][stage];
  return pose;
}
