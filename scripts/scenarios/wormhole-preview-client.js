import { Renderer } from '/client/renderer.js';
import { createBattle, tickBattle } from '/gameplay/combat.js';
import { activateNightmare } from '/characters/houston/nightmare-fuel.js';

const renderer = new Renderer(document.querySelector('canvas'));
const keys = new Set();
const output = document.querySelector('output');
let world, simTime, accumulator, previous, rate = 1;
function reset() {
  world = Object.assign(createBattle(8), {phase:'racing', human:true, wx:65, wz:40, heading:0, motionHeading:0, cameraHeading:0, supplies:[]});
  for (const bot of world.bots) bot.inactive = true;
  Object.assign(world.bots[0], {driver:0, inactive:false, human:true, wx:74, wz:57, speed:0, health:3, shield:0});
  simTime = 0;
  accumulator = 0;
}
function frame(now) {
  accumulator += Math.min(.1,(now-(previous??now))/1000)*rate;
  previous = now;
  while (accumulator >= 1/120) {
    if (simTime < .75 && simTime+1/120 >= .75) activateNightmare(world);
    tickBattle(world,keys,1/120);
    accumulator -= 1/120;
    simTime += 1/120;
  }
  renderer.draw(world,simTime);
  output.textContent = world.kills ? 'Captured' : world.nightmareActive > 0 ? 'Gravitational pull' : 'Approach';
  if (simTime >= 3.7) reset();
  requestAnimationFrame(frame);
}
document.querySelector('#replay').onclick = reset;
document.querySelector('#speed').onclick = event => {
  rate = rate === 1 ? .25 : 1;
  event.target.textContent = rate === 1 ? 'Slow motion' : 'Normal speed';
};
reset();
requestAnimationFrame(frame);
