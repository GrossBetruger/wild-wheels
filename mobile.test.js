import test from 'node:test';
import assert from 'node:assert/strict';
import { usesMobileControls, bombTarget } from './mobile.js';

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
  assert.equal(bombTarget(200,1,rect,96,'3d'),null);assert.equal(bombTarget(200,-1,rect,96,'3d'),null);assert.equal(bombTarget(399,799,rect,96,'3d'),null);
});
