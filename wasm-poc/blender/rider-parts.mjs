// Capture the canonical rider primitives before the browser batches them.
import {drawNewDriver} from '../../client/characters.js';
import {drawNurseButterfly, drawButterflyWings} from '../../characters/catheterpillar/catheterpillar.js';
import {drawAnt} from '../../characters/fourmidable/fourmidable.js';

function capture(draw) {
  const parts = [];
  let origin = [0,0,0,0];
  const mesh = {at(x,y,z,yaw=0) { origin = [x,y,z,yaw]; }};
  for (const shape of ['box','ball','tri']) mesh[shape] = (...args) => parts.push({shape,args,origin});
  draw(mesh);
  return parts;
}
console.log(JSON.stringify({
  tammy:capture(m=>drawNewDriver(m,5,0,0)),
  catheterpillar:capture(m=>drawNurseButterfly(m,0,false)),
  wings:capture(m=>drawButterflyWings(m,0)),
  fourmidable:capture(m=>drawAnt(m,0,false)),
}));
