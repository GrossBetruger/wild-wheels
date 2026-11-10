import test from 'node:test';
import assert from 'node:assert/strict';
import { usesMobileControls, bombTarget, bomberGroundPoint, panBomber } from './mobile.js';

test('touch phones and tablets get bomber controls while desktops keep kart controls',()=>{
  assert.equal(usesMobileControls(1,true),true);assert.equal(usesMobileControls(0,true),false);assert.equal(usesMobileControls(5,false),false);
});
test('portrait and landscape taps hit the same arena location',()=>{
  assert.deepEqual(bombTarget(300,500,{left:0,top:0,width:400,height:800}),{wx:52,wz:52});
  assert.deepEqual(bombTarget(500,300,{left:0,top:0,width:800,height:400}),{wx:52,wz:52});
  assert.deepEqual(bombTarget(510,320,{left:10,top:20,width:800,height:400}),{wx:52,wz:52});
});
test('taps in the arena margins or invalid pointer positions do not spend bombs',()=>{
  const rect={left:0,top:0,width:400,height:800};
  assert.equal(bombTarget(200,10,rect),null);assert.equal(bombTarget(0,400,rect),null);assert.equal(bombTarget(NaN,400,rect),null);
  assert.equal(bombTarget(0,0,{left:0,top:0,width:0,height:0}),null);
});
test('the middle of the 3D bomber view targets the arena center in portrait and landscape',()=>{
  assert.deepEqual(bombTarget(200,400,{left:0,top:0,width:400,height:800},96,'3d'),{wx:0,wz:0});
  assert.deepEqual(bombTarget(400,200,{left:0,top:0,width:800,height:400},96,'3d'),{wx:0,wz:0});
});
test('tapping sky or outside the 3D view does not spend a bomb',()=>{
  const rect={left:0,top:0,width:400,height:800};
  assert.equal(bombTarget(200,1,rect,96,'3d'),null);assert.equal(bombTarget(200,-1,rect,96,'3d'),null);assert.equal(bombTarget(399,1,rect,96,'3d'),null);
});
test('a close camera tap still targets its focus after zooming and moving across the arena',()=>{
  const point=bombTarget(200,400,{left:0,top:0,width:400,height:800},96,'3d',{wx:65,wz:-30},1.35);
  assert.ok(Math.abs(point.wx-65)<1e-9);assert.ok(Math.abs(point.wz+30)<1e-9);
});
test('dragging the camera keeps the ground grabbed by the finger under that finger',()=>{
  const rect={left:0,top:0,width:400,height:800},start={x:200,y:400},end={x:280,y:460};
  const focus=panBomber(start,end,rect,{wx:0,wz:0},1);
  const ground=bomberGroundPoint(end.x,end.y,rect,96,'3d',focus,1);
  assert.ok(Math.abs(ground.wx)<1e-9);assert.ok(Math.abs(ground.wz)<1e-9);
});
test('dragging toward the edge keeps the camera focus within the arena',()=>{
  const focus=panBomber({x:399,y:799},{x:1,y:1},{left:0,top:0,width:400,height:800},{wx:95,wz:95},1);
  assert.deepEqual(focus,{wx:96,wz:96});
});
