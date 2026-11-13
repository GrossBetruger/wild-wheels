// Procedural, cached motorcycle parts. Combat still uses the shared kart rules.
const chrome = '#c1d5db', leather = '#222631', brown = '#95643f', lightBrown = '#bc8a59', cyan = '#6af3ed';
function tube(m, a, b, r, color) {
  const steps = Math.max(2, Math.ceil(Math.hypot(...a.map((v, i) => v - b[i])) / .15));
  for (let i = 0; i <= steps; i++) { const t = i / steps; m.ball(...a.map((v, j) => v + (b[j] - v) * t), r, r, r, color, 6, 4); }
}
export function drawMotorcycle(m, color) {
  // Two narrow wheels, exposed V-twin, swept forks and a low saddle.
  for (const z of [-1.65, 1.8]) {
    m.ball(0, .92, z, .39, .92, .92, '#151b25', 16, 9);
    for (const side of [-1, 1]) {
      m.ball(side * .35, .92, z, .055, .63, .63, chrome, 14, 7);
      m.ball(side * .41, .92, z, .025, .46, .46, '#293745', 12, 7);
      m.ball(side * .44, .92, z, .05, .14, .14, '#f4c77a', 8, 5);
    }
  }
  for (const side of [-1, 1]) {
    tube(m, [side * .45, .92, -1.65], [side * .48, 1.5, .2], .1, chrome);
    tube(m, [side * .45, .92, 1.8], [side * .42, 2.15, 1.1], .095, chrome);
    tube(m, [side * .48, 1.5, .2], [side * .42, 2.15, 1.1], .1, leather);
    for (let i = 0; i < 6; i++)m.box(side * .32, .9 + i * .12, 0, .55, .045, .85, chrome);
    m.ball(side * .43, 1.16, -.24, .25, .3, .33, '#59636c', 8, 5);
    tube(m, [side * .5, 1.12, .1], [side * .65, .65, -1.25], .14, chrome);
    m.ball(side * .65, .67, -1.65, .21, .21, .75, '#6f8794', 10, 5);
    m.ball(side * .65, .67, -2.3, .15, .15, .06, '#112334', 8, 5);
    tube(m, [side * .15, 2.13, 1.05], [side * .85, 2.4, 1.28], .075, chrome);
    m.box(side * .91, 2.33, 1.28, .38, .14, .18, leather);
    tube(m, [side * .75, 2.4, 1.25], [side * .98, 2.9, 1.35], .035, chrome);
    m.ball(side * 1.02, 2.9, 1.36, .2, .13, .055, chrome, 8, 5);
    m.ball(side * 1.02, 2.9, 1.42, .15, .09, .015, '#8dcad8', 7, 4);
    m.box(side * .68, .78, -.32, .5, .12, .35, leather);
  }
  m.ball(0, 1.75, .35, .65, .43, .9, color, 12, 7);
  m.box(0, 2.13, .3, .16, .03, 1.15, '#f3cb80');
  m.ball(0, 1.67, -.69, .6, .18, .64, leather, 12, 6);
  m.ball(0, 1.65, -1.65, .46, .17, .75, color, 12, 5);
  m.ball(0, 1.9, 1.9, .34, .32, .2, chrome, 10, 6);
  m.ball(0, 1.9, 2.08, .26, .25, .045, '#fff1c5', 10, 6);
  m.box(0, 1.57, -2.19, .43, .13, .08, '#ff6551');
}
export function drawYuda(m, phase = 0, tuck = false, clothed = true, dressing = -1, lounge = 0) {
  const originalPoint = m.point; let upper = true;
  m.point = function (p) { if (!upper || !lounge) return originalPoint.call(this, p); const a = -lounge * 1.05, c = Math.cos(a), s = Math.sin(a), y = p[1] - 1.9, z = p[2] + .55; return originalPoint.call(this, [p[0], 1.9 + y * c - z * s, -.55 + y * s + z * c]); };
  const salute = Math.sin(phase * Math.PI / 8), reach = tuck ? .2 : 0;
  const body = clothed ? leather : brown;
  m.ball(0, 2.32, -.52, .62, .7, .46, body, 12, 7);
  if (!clothed) { m.ball(0, 2.08, -.13, .38, .32, .1, lightBrown, 10, 5); m.ball(0, 2.28, -.035, .045, .05, .025, '#684831', 6, 4); }
  for (const side of [-1, 1]) {
    // Folded riding legs and chunky boots, one hand stays on the bars.
    upper = false;
    const knee = [side * (.76 - .4 * lounge), 1.43 + .9 * lounge, .05 + .7 * lounge], ankle = [side * (.69 - .45 * lounge), 1.03 + 1.4 * lounge, -.28 + 1.6 * lounge];
    tube(m, [side * .4, 1.9, -.55], knee, .23, body); tube(m, knee, ankle, .19, body);
    m.ball(ankle[0], ankle[1] - .07, ankle[2] + .23, .26, .2, .48, clothed ? '#161d29' : brown, 9, 5);
    upper = true;
    if (clothed) m.tri([side * .08, 2.95, -.11], [side * .42, 2.74, -.14], [side * .12, 2.38, .01], chrome);
    const pull = dressing >= 0 ? Math.sin(dressing / 7 * Math.PI) : 0;
    const hand = dressing >= 0 ? [side * (.65 + pull * .45), 2.4 + pull * 1.35, .5 - pull * .6] : side === 1 ? [.91 - salute * .25, 2.4 + salute * 1.15, 1.28 - salute * .78] : [-.91, 2.4, 1.28];
    if (lounge) { hand[0] += (side * .75 - hand[0]) * lounge; hand[1] += (3.35 - hand[1]) * lounge; hand[2] += (-.7 - hand[2]) * lounge; }
    tube(m, [side * .52, 2.65, -.25], hand, .19, body); m.ball(...hand, .22, .19, .21, brown, 9, 5);
    if (clothed) for (let i = 0; i < 3; i++)m.ball(side * .5, 2.73 - i * .12, -.05, .04, .04, .035, chrome, 5, 3);
  }
  // Brown elder face, expressive pointed ears and unmistakable aviator shades.
  m.ball(0, 3.38, -.32 + reach, .81, .72, .68, brown, 14, 8);
  for (const side of [-1, 1]) {
    m.tri([side * .55, 3.67, -.22], [side * 2.05, 3.78, -.38], [side * .72, 3.12, -.02], brown);
    m.tri([side * .72, 3.56, -.12], [side * 1.8, 3.7, -.32], [side * .78, 3.25, .015], lightBrown);
    m.tri([side * .55, 3.67, -.5], [side * .72, 3.12, -.32], [side * 2.05, 3.78, -.38], brown);
    m.ball(side * .36, 3.52, .29 + reach, .37, .27, .095, chrome, 10, 6);
    m.ball(side * .36, 3.52, .37 + reach, .32, .22, .055, '#111c2a', 10, 6);
    m.box(side * .35, 3.59, .425 + reach, .25, .025, .015, cyan);
    tube(m, [side * .7, 3.55, .31 + reach], [side * .79, 3.53, -.3], .035, chrome);
    tube(m, [side * .12, 3.94, -.02 + reach], [side * .48, 3.83, .08 + reach], .026, lightBrown);
  }
  m.box(0, 3.51, .37 + reach, .19, .045, .055, chrome);
  m.ball(0, 3.27, .38 + reach, .19, .16, .24, lightBrown, 10, 6);
  m.ball(0, 3.02, .19 + reach, .35, .13, .23, lightBrown, 10, 5);
  m.box(.08, 3.1, .4 + reach, .3, .028, .03, '#493428');
  // Tiny silver hoop and a winged patch on the back of the jacket.
  m.ball(-1.06, 3.35, -.09, .1, .14, .04, '#f2d6a5', 8, 5);
  if (clothed) { for (const side of [-1, 1]) for (let i = 0; i < 4; i++)m.box(side * (.13 + i * .09), 2.49 + i * .045, -.97, .14, .06, .03, chrome); m.ball(0, 2.5, -.98, .12, .16, .025, cyan, 7, 4); }
  m.point = originalPoint;
}
export class YudaStunts {
  riders = new Map();
  update(id, time, boost, celebrate, blocked = false, dressing = false) {
    let state = this.riders.get(id);
    if (!state || time < state.time) { state = { time, wheelie: 0, lounge: 0 }; this.riders.set(id, state); }
    const dt = Math.min(.05, Math.max(0, time - state.time)); state.time = time;
    const relaxing = !blocked && !boost && !dressing && celebrate > 0;
    state.wheelie += (Number(boost && !blocked) - state.wheelie) * (1 - Math.exp(-dt * 12));
    state.lounge += (Number(relaxing) - state.lounge) * (1 - Math.exp(-dt * 16));
    if (blocked) { state.wheelie = 0; state.lounge = 0; }
    const pitch = -.62 * state.wheelie;
    // Rotate around the rear axle even though cached models pivot at y=2.
    return { ...state, pitch, y: 1.08 * (Math.cos(pitch) - 1) - 1.65 * Math.sin(pitch), z: -1.65 + 1.08 * Math.sin(pitch) + 1.65 * Math.cos(pitch) };
  }
}
export function drawYudaJacket(m, flutter = 0) {
  // Open leather shell with loose sleeves, lapels and the winged back patch.
  m.box(0, -.55, -.2, 1.2, 1.15, .15, leather);
  for (const side of [-1, 1]) {
    m.box(side * .46, -.55, .15, .32, 1.15, .32, leather);
    tube(m, [side * .55, .35, 0], [side * (1.1 + flutter * .12), -.25 + flutter * .15, .3], .23, leather);
    m.tri([side * .12, .65, .33], [side * .49, .4, .36], [side * .13, .1, .34], chrome);
    for (let i = 0; i < 4; i++)m.box(side * (.13 + i * .09), .12 + i * .045, -.29, .14, .06, .03, chrome);
  }
  m.ball(0, .14, -.3, .12, .16, .025, cyan, 7, 4);
}
export class YudaJackets {
  riders = new Map();
  update(id, time, active, pose) {
    let state = this.riders.get(id);
    if (!state || time < state.time) { state = { active: false, bare: false, time, flight: null, dressStart: null }; this.riders.set(id, state); }
    state.time = time;
    if (active && !state.active) { state.bare = true; state.dressStart = null; state.flight = { ...pose, start: time }; }
    if (!active && state.active) state.dressStart = time;
    state.active = active;
    if (state.flight && time - state.flight.start >= 1.2) state.flight = null;
    const dressing = state.dressStart === null ? null : Math.min(1, (time - state.dressStart) / .85);
    if (dressing === 1) { state.bare = false; state.dressStart = null; }
    return { bare: state.bare, flight: state.flight, dressing: dressing === 1 ? null : dressing };
  }
}
export function drawBikerBadge(m) {
  m.ball(0, 0, 0, .23, .26, .07, chrome, 9, 5);
  m.box(0, .015, .07, .33, .065, .03, '#172331');
  for (const side of [-1, 1]) for (let i = 0; i < 4; i++) {
    const x = side * (.29 + i * .14), y = .12 + i * .07;
    m.tri([side * .2, -.1, 0], [x, y + .15, 0], [x + side * .12, y, 0], i % 2 ? chrome : cyan);
  }
}
export class YudaExhaust {
  clouds = []; emitters = new Map(); scene = null; time = 0; sequence = 0;
  update(scene, time) {
    if (scene !== this.scene || time < this.time) { this.clouds = []; this.emitters.clear(); this.scene = scene; }
    this.time = time; this.clouds = this.clouds.filter(p => time - p.born < 3);
    for (const [id, e] of this.emitters) if (time - e.time > .2) this.emitters.delete(id);
  }
  emit(id, point, time) {
    const last = this.emitters.get(id), gap = last ? time - last.time : 1;
    if (gap < .05 - 1e-8) return;
    const distance = last ? Math.hypot(point.x - last.x, point.z - last.z) : 0, from = last && gap < .2 && distance < 18 ? last : point;
    const steps = Math.min(3, Math.max(1, Math.ceil(Math.hypot(point.x - from.x, point.z - from.z) / 1.5)));
    for (let i = 1; i <= steps; i++) { const t = i / steps; this.clouds.push({ owner: id, x: from.x + (point.x - from.x) * t, y: from.y + (point.y - from.y) * t, z: from.z + (point.z - from.z) * t, born: time, seed: this.sequence++ }); }
    this.emitters.set(id, { ...point, time }); this.clouds = this.clouds.slice(-1080);
  }
  draw(smoke, time) {
    for (const cloud of this.clouds) {
      const age = Math.max(0, time - cloud.born), fade = Math.min(1, (3 - age) / .45), size = (2.4 + Math.min(age, 1.8) * 2) * Math.sqrt(Math.max(0, fade));
      smoke.at(cloud.x, cloud.y + age * .7, cloud.z);
      for (let i = 0; i < 6; i++) { const a = i * 2.399 + cloud.seed * .7, r = .25 + age * .55, gray = .13 + Math.min(age, 2) * .075 + (i % 2) * .045; smoke.particle(Math.cos(a) * r, .3 + Math.sin(a) * r * .5, Math.sin(a) * r, size, [gray, gray * .98, gray * .94]); }
    }
  }
}
export function drawMotorcycleBoost(glow, smoke, p, angle, clock, jump = null) {
  // Preview plume; arena exhaust uses the same clouds with persistent world positions.
  const exhaust = new YudaExhaust();
  for (let i = 0; i < 24; i++) { const age = i / 12; exhaust.clouds.push({ x: p.x - Math.sin(angle) * (2.4 + age * 5), y: .5 + (jump?.height ?? 0), z: p.z - Math.cos(angle) * (2.4 + age * 5), born: clock - age, seed: i }); }
  exhaust.draw(smoke, clock);
}
