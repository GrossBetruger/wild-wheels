import test from 'node:test';
import assert from 'node:assert/strict';
import {YudaStunts} from './master-yuda.js';

test('boost lifts the front wheel while the rear axle stays planted, then lowers it smoothly',()=>{
  const stunts=new YudaStunts();stunts.update(0,0,false,0);let pose;
  for(let frame=1;frame<=60;frame++)pose=stunts.update(0,frame/60,true,0);
  assert.ok(pose.pitch<-.6);
  const rearHeight=2+(.92-2)*Math.cos(pose.pitch)+1.65*Math.sin(pose.pitch)+pose.y;
  const frontHeight=2+(.92-2)*Math.cos(pose.pitch)-1.8*Math.sin(pose.pitch)+pose.y;
  assert.ok(Math.abs(rearHeight-.92)<1e-9);assert.ok(frontHeight>2.8);
  assert.ok(stunts.update(0,61/60,false,0).wheelie>.7);
  for(let frame=62;frame<=120;frame++)pose=stunts.update(0,frame/60,false,0);
  assert.ok(Math.abs(pose.pitch)<.001);
});
test('a whack reclines Yuda; boost, drifting, flips and dressing take priority',()=>{
  for(const [boost,blocked,dressing,expected]of [[false,false,false,true],[true,false,false,false],[false,true,false,false],[false,false,true,false]]){
    const stunts=new YudaStunts();stunts.update(0,0,false,0);let pose;
    for(let frame=1;frame<=30;frame++)pose=stunts.update(0,frame/60,boost,1,blocked,dressing);
    assert.equal(pose.lounge>.9,expected);
    if(blocked)assert.equal(pose.wheelie,0);
  }
});
test('remote riders animate independently and a flip immediately clears a wheelie',()=>{
  const stunts=new YudaStunts();stunts.update(0,0,true,0);stunts.update(1,0,false,1);
  for(let frame=1;frame<=30;frame++){stunts.update(0,frame/60,true,0);stunts.update(1,frame/60,false,1);}
  assert.ok(stunts.riders.get(0).wheelie>.9);assert.ok(stunts.riders.get(1).lounge>.9);
  const flip=stunts.update(0,.51,true,0,true);assert.equal(Math.abs(flip.pitch),0);assert.equal(flip.lounge,0);
});
