import assert from 'node:assert/strict';
import test from 'node:test';
import {Mesh, Renderer} from '../../client/renderer.js';

test('Avita spins up a swept propeller on casting Wormhole and returns to cruise when it closes', () => {
  function rotor(remaining, seconds, boost=false) {
    const mesh = new Mesh();
    const renderer = {model(_name,_x,_y,_z,_heading,draw) { draw(mesh); }};
    Renderer.prototype.planePropeller.call(renderer,{x:0,z:0,nightmareActive:remaining},0,seconds,null,boost);
    let hasVioletRim = false, bladeWidth = 0;
    for (let i=0; i<mesh.data.length; i+=9) {
      const [red,green,blue] = mesh.data.slice(i+6,i+9);
      if (blue > red && red > green && blue > .9) hasVioletRim = true;
      if (red > .9 && green > .8 && blue < .5) bladeWidth = Math.max(bladeWidth,Math.abs(mesh.data[i]));
    }
    return {hasVioletRim, bladeWidth};
  }
  // At 120 FPS the cruising blades barely move. On the same two frames the
  // charged blades sweep across the disc, including the first frame of the cast.
  const nextFrame=1/120;
  assert.deepEqual(rotor(0,0),rotor(0,nextFrame));
  assert.notDeepEqual(rotor(8,0),rotor(8-nextFrame,nextFrame));
  assert.equal(rotor(8,0).hasVioletRim,true);
  assert.equal(rotor(0,0,true).hasVioletRim,false);
  assert.deepEqual(rotor(.01,0),rotor(8,0));
  assert.equal(rotor(0,8).hasVioletRim,false);
});
