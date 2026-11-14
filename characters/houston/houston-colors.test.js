import test from 'node:test';
import assert from 'node:assert/strict';
import {drawHoustonHelmet, drawNewDriver} from '../../client/characters.js';
import {Renderer} from '../../client/renderer.js';
import {VULCAN_DURATION} from '../../gameplay/combat.js';

function record(draw) {
  const parts=[];
  const mesh={ball:(...args)=>parts.push({shape:'ball',args}),box:(...args)=>parts.push({shape:'box',args})};
  draw(mesh);
  return parts;
}

test('Houston helmet, ears, antenna, chest and backpack accents follow the vehicle color',()=>{
  const colors=['#a4198b','#3b6329'];
  const models=colors.map(color=>record(mesh=>drawNewDriver(mesh,7,0,0,true,null,color)));
  assert.equal(models[0].length,models[1].length);
  let changed=0;
  for(let i=0;i<models[0].length;i++) {
    const first=models[0][i],second=models[1][i];
    assert.equal(first.shape,second.shape);
    const expected=first.args.map(value=>value===colors[0]?colors[1]:value);
    assert.deepEqual(second.args,expected,'Only player-colored accents may change');
    if(first.args.includes(colors[0]))changed++;
  }
  assert.equal(changed,8);
  for(const oldColor of ['#628798','#86a9b7','#8ca5af','#87acb9','#647d8b','#6b91a4']) {
    assert.ok(!models[0].some(part=>part.args.includes(oldColor)),`Fixed teal accent remains: ${oldColor}`);
  }
  assert.ok(models[0].some(part=>part.args.includes('#f2f3ea')),'Helmet shell should stay white');
});

test('the flying Houston helmet uses the current color and a separate model cache entry for each color',()=>{
  const keys=[],parts=[];
  const renderer={helmetFlights:new Map(),model(key,x,y,z,angle,draw){keys.push(key);parts.push(record(draw));}};
  const actor={id:0,heading:0,vulcan:VULCAN_DURATION,color:'#a4198b'};
  Renderer.prototype.houstonHelmet.call(renderer,{x:0,z:0},actor,0,null);
  actor.color='#3b6329';
  Renderer.prototype.houstonHelmet.call(renderer,{x:0,z:0},actor,.1,null);
  assert.notEqual(keys[0],keys[1]);
  for(const [i,color] of ['#a4198b','#3b6329'].entries()) {
    assert.deepEqual(parts[i],record(mesh=>drawHoustonHelmet(mesh,color)));
    assert.equal(parts[i].filter(part=>part.args.includes(color)).length,4);
  }
});
