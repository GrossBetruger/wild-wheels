// One forged tread block and one bank of exhaust fire per sector. All motion
// repeats in four seconds, including the sparks, for the recorded native loop.
const TAU = Math.PI * 2;
const sectors = Array.from({length: 36}, (_, i) => {
  const angle = i * TAU / 36;
  return {x: Math.sin(angle), z: Math.cos(angle), phase: angle * 3, seed: (i * .61803399) % 1};
});
const orange = {shadow:'#801623', flame:'#ff4911', core:'#ffb324', tip:'#fff1ad', light:[1,.19,.015]};
const blue = {shadow:'#26286d', flame:'#216aef', core:'#50dfff', tip:'#e6ffff', light:[.06,.42,1]};
const palette = effect => effect.color === '#4abaff' ? blue : orange;

export function drawFireRing(mesh, glow, effect, time, collapse = 1) {
  mesh.at(effect.wx, 0, effect.wz);
  glow.at(effect.wx, 0, effect.wz);
  const radius = effect.radius ?? 10, width = radius * Math.tan(Math.PI / sectors.length);
  const fire = palette(effect), direction = fire === blue ? -1 : 1;
  const turn = direction * time * TAU / 4;
  for (const [i, {x, z, phase, seed}] of sectors.entries()) {
    // Tangential offsets are measured in half-blocks, so adjacent tread faces meet.
    const point = (along, up, out = 0) => [
      x * (radius + out) + z * along * width * direction,
      .09 + up * collapse,
      z * (radius + out) - x * along * width * direction,
    ];
    const pulse = .5 + .5 * Math.cos(phase - turn * 3);
    const flicker = Math.sin(turn * 7 + i * 2.4);
    const height = (3.4 + seed * 2.8 + pulse * 2.9 + flicker * .65);
    const shoulder = Math.min(1.3, width * .72) * collapse;
    // Black rubber with an angled steel lug and a molten bevel at the crown.
    mesh.quad(point(-1,0,shoulder), point(1,0,shoulder), point(1,.8,shoulder), point(-1,.8,shoulder), '#32282d');
    mesh.quad(point(-1,.8,shoulder), point(1,.8,shoulder), point(1,.8,-shoulder), point(-1,.8,-shoulder), '#17151c');
    mesh.quad(point(-.85,.83,-shoulder), point(-.44,.83,-shoulder), point(.48,.83,shoulder), point(.08,.83,shoulder), '#988580');
    mesh.quad(point(.09,0,shoulder+.01), point(.4,0,shoulder+.01), point(.48,.8,shoulder+.01), point(.08,.8,shoulder+.01), fire.core);

    // Offset ribs fold each hooked flame around a bright hot face, giving it
    // a silhouette from inside, outside and overhead.
    const heel = point(-.97,.84), toe = point(.94,.84), ridge = point(.02,height*.37,shoulder*.9);
    const elbow = point(.55,height*.65,-shoulder*.5), hook = point(1.7+.46*flicker,height,shoulder*.7);
    mesh.tri(heel,toe,ridge,fire.core);
    mesh.tri(heel,ridge,elbow,fire.flame);
    mesh.tri(ridge,toe,elbow,fire.shadow);
    mesh.tri(ridge,hook,elbow,fire.flame);
    mesh.tri(heel,elbow,hook,fire.shadow);
    mesh.tri(toe,point(.21,1,shoulder*.3),point(1.35,height*.46,shoulder*1.4),fire.tip);

    const [gx,gy,gz] = point(0,1.1);
    glow.particle(gx,gy,gz,(1.4+pulse)*collapse,fire.light);
    for (let j=0;j<2;j++) {
      const age = (time*.75+seed+j*.5)%1, fade = 1-age;
      const [sx,sy,sz] = point(.5+age*(2+seed),1+height*.55+age*(8-3*age),age*(1+seed));
      glow.particle(sx,sy,sz,(.12+.22*fade)*collapse,fire.light);
    }
  }
}

export function drawFireRingOut(mesh, glow, smoke, effect, time) {
  const {age,life} = effect;
  if (age >= life) return;
  const radius = effect.radius ?? 10, fire = palette(effect);
  if (age < .55) drawFireRing(mesh,glow,effect,time,(1-age/.55)**2);
  glow.at(effect.wx,0,effect.wz);
  smoke.at(effect.wx,0,effect.wz);
  const fade = 1-age/life;
  for (const {x,z,seed} of sectors) {
    const r = radius+age*(1+seed*2);
    smoke.particle(x*r,.6+age*(1.7+seed),z*r,(1+age)*(1+seed)*Math.sqrt(fade),[.32,.29,.31]);
    if (age >= 1.4) continue;
    const sparkRadius = radius + age*(3+seed*3);
    glow.particle(x*sparkRadius,.22+Math.max(0,age*(5+seed*2-age*5)),z*sparkRadius,.36*(1-age/1.4),fire.light);
  }
}
