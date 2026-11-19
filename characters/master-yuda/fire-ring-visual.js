// Master-Yuda's Ring of Fire: a burnout scorched into the ground, hellfire
// licking back from the spin, and laughing skulls riding the crest. It is drawn
// almost entirely in light and smoke, with one small opaque layer for the char
// and the bone. Every motion repeats in four seconds, the length of the native
// client's recorded loop, and each frame draws the same number of particles.
const TAU = Math.PI * 2, TONGUES = 30, TREADS = 24, COLLAPSE = .55;
export const FIRE_RING_RIDERS = 6;
const frac = v => v - Math.floor(v);
const seeds = Array.from({length: TONGUES}, (_, i) => frac(Math.sin(i * 127.1 + 311.7) * 43758.5453));
const scaled = (color, k) => [color[0] * k, color[1] * k, color[2] * k];

// Orange burns as hellfire and spins with a left drift; blue is soul fire and
// spins the other way.
const hellfire = {spin: 1, char: '#170c0d', bone: '#eadbbd', socket: '#1d0909', lava: [1, .3, .03], deep: [.55, .035, .01], fire: [.95, .32, .03], hot: [1, .8, .35], smoke: [.13, .015, .015], soot: [.06, .045, .05], spark: [1, .45, .06]};
const soulfire = {spin: -1, char: '#0c0d18', bone: '#dce8ee', socket: '#090c1f', lava: [.05, .5, 1], deep: [.07, .04, .55], fire: [.05, .38, .95], hot: [.6, .92, 1], smoke: [.025, .025, .15], soot: [.045, .05, .065], spark: [.25, .65, 1]};
const palette = effect => effect.color === '#4abaff' ? soulfire : hellfire;
const fireRingTurn = (c, time) => c.spin * time * TAU / 4;
// Where rider `index` is on the ring. The native client places its recorded
// rider with the same formula, in `native-client/src/scene.rs`.
export const fireRingRiderAngle = (index, spin, time) => (index + spin * time / 2) * TAU / FIRE_RING_RIDERS;

// Maps (along the spin, up, outward) at one angle of the ring to ring space.
function station(angle, radius, spin) {
  const x = Math.sin(angle), z = Math.cos(angle);
  return (along, up, out = 0) => [x * (radius + out) + z * along * spin, up, z * (radius + out) - x * along * spin];
}
// A tapering band of light through pairs of points, closed to a tip.
function ribbon(glow, rows, color) {
  for (let r = 0; r < rows.length - 2; r++) glow.quad(rows[r][0], rows[r][1], rows[r + 1][1], rows[r + 1][0], color);
  glow.tri(rows.at(-2)[0], rows.at(-2)[1], rows.at(-1)[0], color);
}

// The burnout: a charred track with molten tread chevrons running round it.
function drawScorch(mesh, glow, radius, c, turn, width, heat) {
  const reach = 1.6 * width, half = Math.tan(Math.PI / TONGUES);
  for (let i = 0; i < TONGUES; i++) {
    const p = station(i * TAU / TONGUES, radius, 1), inner = (radius - reach) * half, outer = (radius + reach) * half;
    mesh.quad(p(-inner, .05, -reach), p(-outer, .05, reach), p(outer, .05, reach), p(inner, .05, -reach), c.char);
  }
  const unit = radius * TAU / TREADS / 4;
  for (let i = 0; i < TREADS; i++) {
    const angle = i * TAU / TREADS + turn * 4 / TREADS, p = station(angle, radius, c.spin);
    const molten = scaled(c.lava, heat * (.55 + .45 * Math.cos(angle * 3 - turn)));
    glow.quad(p(-unit, .09, -reach * .8), p(-unit * .3, .09, -reach * .8), p(unit * 1.1, .09, 0), p(unit * .4, .09, 0), molten);
    glow.quad(p(unit * .4, .09, 0), p(unit * 1.1, .09, 0), p(-unit * .3, .09, reach * .8), p(-unit, .09, reach * .8), molten);
  }
}

// The wall: licks of fire swept back from the spin over a white-hot bed.
function drawFlames(glow, smoke, radius, c, time, turn, collapse) {
  // Past a mid-sized ring the licks keep their shape and stand apart instead
  // of fattening with the circumference.
  const step = radius * Math.tan(Math.PI / TONGUES), half = Math.min(step, 3);
  for (let i = 0; i < TONGUES; i++) {
    const angle = i * TAU / TONGUES, seed = seeds[i], p = station(angle, radius, c.spin);
    // Three crests of taller fire chase each other round the ring.
    const pulse = .5 + .5 * Math.cos(angle * 3 - turn), flicker = Math.sin(turn * 7 + i * 2.4);
    const height = (3.4 + seed * 2.2 + pulse * 2.6 + flicker * .5) * collapse;
    const whip = turn * 8 - i * 1.7, lean = .5 + .7 * Math.sin(turn * 4 + i);
    const sweep = t => (-1.5 * t ** 1.5 + .4 * Math.sin(t * 5 - whip) * t) * half;
    const row = (t, reach, width, along = 0, out = 0) => {
      const centre = sweep(t) + along, w = width * half, up = .1 + t * reach, curl = t * t * lean + out;
      return [p(centre - w, up, curl), p(centre + w, up, curl)];
    };
    ribbon(glow, [row(0, height, .95), row(.32, height, .78), row(.68, height, .42), row(1, height, 0)], c.deep);
    ribbon(glow, [row(0, height * .66, .5), row(.45, height * .66, .36), row(1, height * .66, 0)], c.fire);
    // A shorter lick stands between each pair, outside the track, for depth.
    const low = height * (.42 + .2 * Math.sin(turn * 5 + i * 3.1));
    ribbon(glow, [row(0, low, .5, step, 1.1), row(.5, low, .32, step, 1.1), row(1, low, 0, step, 1.1)], c.fire);
    // White-hot under orange under deep red, as soft light.
    glow.particle(...p(0, .45 * collapse, 0), 2.1, scaled(c.deep, (1.2 + .2 * flicker) * collapse));
    glow.particle(...p(step, .4 * collapse, 0), 1.8, scaled(c.deep, 1.2 * collapse));
    glow.particle(...p(sweep(.3), .3 * height, .09 * lean), 1.7, scaled(c.fire, collapse));
    glow.particle(...p(0, .7 * collapse, 0), .95, scaled(c.hot, collapse));
    // Black smoke rolls off each tip and trails behind the spin.
    const drift = frac(time * .5 + seed);
    smoke.particle(...p(sweep(1) - drift * 2 * half, height * .9 + drift * 3, drift * 1.5), (2.2 + 2.6 * drift) * Math.sqrt(Math.sin(drift * Math.PI)) * collapse, c.smoke);
    // Sparks torn off the crest, falling behind the spin.
    for (let j = 0; j < 2; j++) {
      const life = frac(time * (.5 + j * .25) + seed + j * .37), fade = (1 - life) * collapse;
      glow.particle(...p((-.3 - life * (2 + 2 * seed)) * half, height * .6 + life * (5 + 4 * seed) - life * life * 3, Math.sin(seed * 40 + life * 5) * life * 1.6), .12 + .2 * fade, scaled(c.spark, fade));
    }
  }
}

// A flat forged skull, read from inside and outside the ring alike, with a jaw
// that drops as it laughs. The eyes are set proud of each face so both burn.
const cranium = [[0, 1.25], [.55, 1.15], [.95, .7], [1, .15], [.72, -.3], [.42, -.5], [-.42, -.5], [-.72, -.3], [-1, .15], [-.95, .7], [-.55, 1.15]];
function drawSkull(mesh, glow, p, c, tilt, laugh, scale) {
  const cos = Math.cos(tilt) * 1.25, sin = Math.sin(tilt) * 1.25;
  const at = (s, u, out = 0) => p(s * cos - u * sin, s * sin + u * cos, out);
  const centre = at(0, .3);
  for (let i = 0; i < cranium.length; i++) {
    const a = cranium[i], b = cranium[(i + 1) % cranium.length];
    mesh.tri(centre, at(a[0], a[1]), at(b[0], b[1]), c.bone);
  }
  for (let tooth = 0; tooth < 4; tooth++) {
    const s = -.4 + tooth * .21;
    mesh.quad(at(s, -.5), at(s + .17, -.5), at(s + .17, -.72), at(s, -.72), c.bone);
  }
  const jaw = -.78 - laugh * .34;
  mesh.quad(at(-.44, jaw), at(.44, jaw), at(.33, jaw - .36), at(-.33, jaw - .36), c.bone);
  for (const face of [-.06, .06]) {
    for (const side of [-1, 1]) {
      mesh.quad(at(side * .16, .3, face), at(side * .74, .5, face), at(side * .64, -.02, face), at(side * .24, -.08, face), c.socket);
      glow.particle(...at(side * .43, .17, face * 6), .95 * scale, c.hot);
    }
    mesh.tri(at(0, -.06, face), at(.15, -.38, face), at(-.15, -.38, face), c.socket);
  }
}

// A rider: a skull on the crest with its fire streaming out behind. Riders on
// the off beat bob and laugh half a cycle apart, which is also what two thirds
// of a second does, so the native client offsets its one recorded rider by that.
function drawRider(mesh, glow, smoke, p, c, turn, beat, collapse, size) {
  // As the ring dies the riders are let go: they shoot up and gutter out.
  const k = size * collapse, lift = (4.3 + .5 * Math.sin(turn * 3 + beat) * collapse + (1 - collapse) * 7) * size;
  const rider = (along, up, out = 0) => p(along * k, lift + up * k, out * k);
  drawSkull(mesh, glow, rider, c, -.22 * c.spin, Math.max(0, Math.sin(turn * 9 + beat)), k);
  smoke.particle(...rider(-.6, .3), 3.4 * k, c.soot);
  glow.particle(...rider(0, .2), 3.2 * k, c.deep);
  const streak = (d, thick) => {
    const up = .7 + d * .16 + Math.sin(turn * 15 - d * .9 + beat) * d * .07;
    return [rider(-d, up - thick), rider(-d, up + thick)];
  };
  ribbon(glow, [streak(.5, .8), streak(2.4, .62), streak(4.6, .36), streak(7.2, 0)], c.fire);
  ribbon(glow, [streak(.5, .4), streak(2, .28), streak(4, 0)], c.hot);
  for (let j = 1; j <= 3; j++) glow.particle(...streak(j * 1.7, 0)[0], (2.4 - j * .5) * k, scaled(c.fire, .9 - j * .2));
}

// Riders start small, so they do not fill the view of a newly lit ring, and
// reach full size as it passes twenty units.
export const fireRingRiderSize = radius => Math.min(1, .5 + radius / 40);

// The exporter records the ring and one rider apart by setting `effect.part` to
// 'ring' or 'rider': the native client stretches the ring to its radius, which
// a skull must not follow. Unset, everything is drawn.
function drawRiders(mesh, glow, smoke, effect, time, collapse) {
  const c = palette(effect), turn = fireRingTurn(c, time), radius = effect.radius ?? 10;
  if (effect.part === 'rider') { drawRider(mesh, glow, smoke, station(0, 0, c.spin), c, turn, 0, collapse, 1); return; }
  for (let j = 0; j < FIRE_RING_RIDERS; j++) drawRider(mesh, glow, smoke, station(fireRingRiderAngle(j, c.spin, time), radius, c.spin), c, turn, j * Math.PI, collapse, fireRingRiderSize(radius));
}

export function drawFireRing(mesh, glow, smoke, effect, time, collapse = 1) {
  const radius = effect.radius ?? 10, c = palette(effect), turn = fireRingTurn(c, time);
  for (const layer of [mesh, glow, smoke]) layer.at(effect.wx, 0, effect.wz);
  if (effect.part !== 'rider') {
    drawScorch(mesh, glow, radius, c, turn, 1, collapse);
    drawFlames(glow, smoke, radius, c, time, turn, collapse);
  }
  if (effect.part !== 'ring') drawRiders(mesh, glow, smoke, effect, time, collapse);
}

export function drawFireRingOut(mesh, glow, smoke, effect, time) {
  const {age, life} = effect;
  if (age >= life) return;
  if (age < COLLAPSE) { drawFireRing(mesh, glow, smoke, effect, time, (1 - age / COLLAPSE) ** 2); if (effect.part === 'rider') return; }
  if (effect.part === 'rider') return;
  const radius = effect.radius ?? 10, c = palette(effect), fade = 1 - age / life;
  for (const layer of [mesh, glow, smoke]) layer.at(effect.wx, 0, effect.wz);
  // The scorch stays behind, its molten tread cooling as the track closes up.
  if (age >= COLLAPSE) drawScorch(mesh, glow, radius, c, fireRingTurn(c, time), Math.sqrt(fade), fade * fade);
  for (let i = 0; i < TONGUES; i++) {
    const seed = seeds[i], p = station(i * TAU / TONGUES - c.spin * age * .17, radius, c.spin);
    // Smoke rolls outward off the dead fire and lifts away.
    smoke.particle(...p(0, .6 + age * (1.8 + seed), age * 1.8), (2.6 + age * 2.4) * Math.sqrt(fade), c.soot);
    smoke.particle(...p(-age * (2 + seed), 1 + age * (2.8 + seed), age * (1 + seed)), (2.2 + age * 2) * Math.sqrt(fade), scaled(c.soot, 5));
    const cooling = Math.max(0, 1 - age / 1.65), speed = 1.5 + seed * 3;
    glow.particle(...p(-age * speed, Math.max(.15, .6 + age * (4 + seed * 3) - age * age * 2.8), age * speed), .22 * cooling, scaled(c.spark, cooling));
  }
}
