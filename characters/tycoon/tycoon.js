// Tai-Coon — super cute Tyrolean she-raccoon of Tai Chi, healing, spirituality, and relaxation,
// driving a cozy alpine village pickup truck with Karmic Raccooning effects.

function flower(m, x, y, z, r, petalColor, centerColor = '#f7d96c') {
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3;
    m.ball(x + Math.cos(a) * r, y + Math.sin(a) * r, z, r * .68, r * .55, r * .28, petalColor, 6, 4);
  }
  m.ball(x, y, z + r * .16, r * .52, r * .52, r * .3, centerColor, 6, 4);
}

function lotus(m, x, y, z, scale, color = '#f6b8d0', inner = '#fff4d4') {
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    m.ball(
      x + Math.sin(a) * scale * .75,
      y + scale * .18,
      z + Math.cos(a) * scale * .75,
      scale * .42,
      scale * .22,
      scale * .55,
      i % 2 ? color : '#fbd4e3',
      7,
      4,
    );
  }
  for (let i = 0; i < 5; i++) {
    const a = i * Math.PI * 2 / 5 + .3;
    m.ball(
      x + Math.sin(a) * scale * .36,
      y + scale * .38,
      z + Math.cos(a) * scale * .36,
      scale * .28,
      scale * .32,
      scale * .28,
      inner,
      6,
      4,
    );
  }
  m.ball(x, y + scale * .42, z, scale * .24, scale * .24, scale * .24, '#f8d66b', 7, 4);
}

export function drawPickupTruck(m, color) {
  const cream = '#fbf4e3', wood = '#b57b4a', lightWood = '#d6a46d', darkWood = '#7d5030';
  const dark = '#333742', chrome = '#dfe7e2', sage = '#7ec4a8', lavender = '#b99be2';

  // Four chunky vintage village wheels with cream hubcaps and golden hubs.
  for (const x of [-1.58, 1.58]) for (const z of [-1.52, 1.48]) {
    m.ball(x, .62, z, .48, .62, .62, dark, 10, 6);
    m.ball(x + Math.sign(x) * .42, .62, z, .08, .35, .35, cream, 10, 5);
    m.ball(x + Math.sign(x) * .49, .62, z, .04, .14, .14, '#e7c46b', 8, 4);
  }

  // Lower chassis & cream side running boards.
  m.box(0, .58, 0, 2.75, .44, 4.75, dark);
  m.box(0, .92, .42, 2.95, .74, 2.65, color);
  // Cute rounded vintage hood & cream wheel fenders.
  m.ball(0, 1.24, 1.65, 1.38, .48, .82, color, 12, 6);
  for (const side of [-1, 1]) {
    m.ball(side * 1.42, 1.02, 1.48, .36, .34, .82, cream, 10, 5);
    m.ball(side * 1.42, 1.02, -1.52, .36, .34, .82, cream, 10, 5);
    m.box(side * 1.48, .72, .05, .24, .12, 1.75, cream);
  }

  // Open-air cozy cab frame & windshield (keeps Tycoon super visible!).
  m.box(0, 1.56, .88, 2.38, .62, .12, '#bfe9ec');
  m.box(0, 1.9, .88, 2.54, .12, .18, cream);
  for (const side of [-1, 1]) {
    m.box(side * 1.22, 1.55, .88, .12, .68, .16, cream);
    // Cute round village side mirrors.
    m.box(side * 1.45, 1.58, .84, .34, .06, .06, chrome);
    m.ball(side * 1.64, 1.58, .84, .14, .14, .07, cream, 8, 5);
  }
  // Cozy warm seat behind Tycoon.
  m.box(0, 1.38, -.46, 2.05, .88, .28, darkWood);
  m.box(0, 1.15, .02, 1.95, .26, .95, '#6b4730');
  // Wooden steering wheel.
  m.box(0, 1.48, .66, .12, .45, .12, darkWood);
  m.ball(0, 1.74, .54, .36, .36, .08, lightWood, 10, 5);

  // Rear village wooden pickup truck bed & slatted rails.
  m.box(0, .92, -1.56, 2.86, .64, 2.02, color);
  m.box(0, 1.26, -1.56, 2.62, .1, 1.88, lightWood);
  for (const side of [-1, 1]) {
    m.box(side * 1.38, 1.52, -1.56, .12, .48, 1.98, wood);
    m.box(side * 1.38, 1.86, -1.56, .11, .16, 1.96, lightWood);
    for (const z of [-2.42, -1.56, -.72]) m.box(side * 1.38, 1.6, z, .14, .68, .14, darkWood);
  }
  // Tailgate with alpine flower accents.
  m.box(0, 1.46, -2.52, 2.82, .56, .14, wood);
  m.box(0, 1.84, -2.52, 2.74, .14, .12, lightWood);
  flower(m, -.82, 1.48, -2.6, .16, '#fffdf7', '#f5ce5b');
  flower(m, .82, 1.48, -2.6, .16, '#fffdf7', '#f5ce5b');
  lotus(m, 0, 1.36, -2.59, .24, '#f5aac6', '#fff2cc');

  // Cozy Tyrolean healing & relaxation cargo inside the pickup bed:
  // 1. Rolled meditation mat on the left side.
  m.box(-.78, 1.54, -1.52, .48, .44, 1.42, sage);
  m.ball(-.78, 1.54, -.82, .24, .22, .08, '#dff5eb', 8, 5);
  m.ball(-.78, 1.54, -2.22, .24, .22, .08, '#dff5eb', 8, 5);
  m.box(-.78, 1.54, -1.52, .52, .48, .14, '#e9c76b');
  // 2. Alpine herb crate with lavender sprigs on the right side.
  m.box(.74, 1.52, -1.55, .82, .48, .92, lightWood);
  m.box(.74, 1.52, -1.55, .86, .1, .96, darkWood);
  for (let i = 0; i < 4; i++) {
    const ox = .5 + (i % 2) * .46, oz = -1.78 + Math.floor(i / 2) * .44;
    m.ball(ox, 1.86, oz, .17, .24, .17, i % 2 ? lavender : '#85c48c', 7, 4);
    m.ball(ox, 2.02, oz, .1, .14, .1, i % 2 ? '#d6bef7' : '#fffdf2', 6, 4);
  }
  // 3. Golden Tibetan singing bowl & glowing lotus blossom in the center of the bed.
  m.ball(0, 1.52, -1.52, .38, .22, .38, '#dfb458', 10, 6);
  m.ball(0, 1.66, -1.52, .31, .08, .31, '#fff1b8', 8, 4);
  lotus(m, 0, 1.68, -1.52, .28, '#f7b6cf', '#fff6d6');

  // Cute friendly front bumper, smiling grille, round headlights & blush cheeks!
  m.box(0, .54, 2.48, 2.84, .22, .24, chrome);
  m.box(0, .92, 2.42, 1.48, .44, .12, cream);
  for (let i = 0; i < 5; i++) m.box(-.54 + i * .27, .92, 2.48, .08, .36, .06, dark);
  for (const side of [-1, 1]) {
    // Big round friendly headlights.
    m.ball(side * 1.02, 1.18, 2.34, .34, .32, .14, '#fff6c6', 10, 6);
    m.ball(side * 1.02, 1.2, 2.46, .1, .13, .04, dark, 8, 5);
    m.ball(side * .97, 1.26, 2.49, .04, .05, .02, '#ffffff', 6, 4);
    // Cute rosy cheeks on the pickup front!
    m.ball(side * 1.26, .95, 2.38, .16, .08, .05, '#f6a8ba', 8, 4);
    // Warm round tail lights.
    m.ball(side * 1.14, 1.16, -2.56, .18, .18, .07, '#ff7868', 8, 4);
  }
  // Battered muffler, clamp and soot-black tailpipe just under the rear bed.
  m.ball(-1.22,.57,-2.28,.23,.21,.53,'#89644e',10,6);
  m.ball(-1.22,.57,-2.42,.25,.23,.07,chrome,10,6);
  m.ball(-1.22,.57,-2.76,.17,.16,.39,'#68635d',10,6);
  m.ball(-1.22,.57,-3.12,.14,.13,.035,'#221f1d',10,6);
  // Friendly tiny smile under the grille.
  for (let i = 0; i < 7; i++) {
    const x = (i - 3) * .09;
    m.ball(x, .7 + x * x * .7, 2.52, .05, .03, .03, dark, 6, 4);
  }
}

export function drawTycoon(m, phase, wave) {
  const fur = '#a8a59e', belly = '#f6eedb', mask = '#474143', dark = '#262328';
  const tunic = '#5c937c', hatGreen = '#4a7856', gold = '#f0cc6c', cheek = '#f3a3b5';
  const sway = Math.sin(phase * Math.PI / 4);
  const breathe = Math.sin(phase * Math.PI / 4) * .04;

  // Cozy round raccoon torso in a peaceful alpine sage tunic.
  m.ball(0, 2.15 + breathe, .02, .72, .82, .62, tunic, 12, 7);
  m.ball(0, 2.12 + breathe, .34, .48, .62, .34, belly, 10, 6);

  // Wooden mala prayer beads around neck + tiny lotus at collar.
  for (let i = 0; i < 11; i++) {
    const t = (i / 10 - .5) * Math.PI * 1.05;
    m.ball(Math.sin(t) * .52, 2.66 + breathe - Math.cos(t) * .22, .16 + Math.cos(t) * .42, .09, .09, .09, i % 2 ? '#c98e4e' : '#e6be70', 7, 4);
  }
  lotus(m, 0, 2.48 + breathe, .58, .18, '#f6b3cc', '#fff6d8');

  // Fluffy ringed raccoon tail curling cheerfully behind the seat.
  for (let i = 0; i < 7; i++) {
    const t = i / 6;
    const tx = sway * (.12 + t * .38);
    const ty = 1.65 + t * .82 + Math.sin(t * Math.PI) * .22;
    const tz = -.62 - t * .78;
    const r = .24 + Math.sin(t * Math.PI) * .16;
    m.ball(tx, ty, tz, r, r * .95, r, i % 2 ? mask : (i === 6 ? '#f5edda' : fur), 8, 5);
  }

  // Arms: holding steering wheel peacefully, or waving happily on celebrate!
  for (const side of [-1, 1]) {
    const waving = side > 0 && wave;
    const lift = waving ? .82 + sway * .18 : 0;
    const handX = side * (waving ? .82 : .54);
    const handY = 2.08 + breathe + lift;
    const handZ = waving ? .34 : .56;
    m.ball(side * .64, 2.22 + breathe + lift * .42, .26, .21, .28 + lift * .24, .22, fur, 8, 5);
    m.ball(handX, handY, handZ, .2, .2, .2, mask, 8, 5);
  }

  // Super cute big round raccoon head!
  const hy = 3.32 + breathe;
  m.ball(0, hy, .14, .96, .88, .84, fur, 14, 8);
  // Fluffy white cheek tufts on both sides.
  for (const side of [-1, 1]) {
    m.ball(side * .78, hy - .16, .26, .34, .28, .28, belly, 9, 5);
    // Rounded fluffy raccoon ears with cream interior.
    m.ball(side * .66, hy + .74, .06, .32, .38, .22, fur, 10, 6);
    m.ball(side * .66, hy + .72, .16, .2, .24, .12, belly, 8, 5);
    m.ball(side * .66, hy + .7, .22, .11, .14, .06, '#f2b8c4', 6, 4);
    // Soft cocoa-charcoal raccoon bandit mask.
    m.ball(side * .36, hy + .04, .82, .34, .28, .14, mask, 10, 6);
    // Huge sparkling super-cute eyes with delicate eyelashes!
    m.ball(side * .34, hy + .06, .92, .21, .24, .08, '#ffffff', 10, 6);
    m.ball(side * .33, hy + .06, .97, .14, .17, .05, dark, 10, 6);
    m.ball(side * .28, hy + .13, 1.01, .065, .075, .025, '#ffffff', 7, 4);
    m.ball(side * .38, hy, 1.0, .035, .035, .02, '#ffffff', 6, 4);
    m.ball(side * .54, hy + .21, .94, .09, .03, .03, dark, 6, 4);
    m.ball(side * .58, hy + .15, .93, .08, .028, .03, dark, 6, 4);
    // Cute rosy cheeks!
    m.ball(side * .58, hy - .2, .84, .19, .11, .06, cheek, 8, 4);
  }
  // Pink alpine lotus blossom tucked sweetly beside her left ear.
  flower(m, -.64, hy + .52, .34, .14, '#f7b2cc', '#fff2b0');
  // Soft cream forehead stripe & muzzle.
  m.ball(0, hy + .18, .88, .15, .32, .1, belly, 8, 5);
  m.ball(0, hy - .2, .9, .4, .28, .28, belly, 10, 6);
  // Tiny cute nose & serene happy smile.
  m.ball(0, hy - .1, 1.15, .14, .1, .09, dark, 8, 5);
  m.ball(-.03, hy - .06, 1.21, .04, .03, .02, '#ffffff', 6, 4);
  for (let i = 0; i < 7; i++) {
    const x = (i - 3) * .06;
    m.ball(x, hy - .31 + x * x * 1.4, 1.11, .04, .026, .026, dark, 6, 4);
  }

  // Adorable Tyrolean alpine hat (Seppelhut) with gold band, edelweiss & feather!
  const hatY = hy + .82;
  // Slightly tilted alpine brim & crown.
  m.ball(.04, hatY, .06, .92, .14, .88, hatGreen, 14, 6);
  m.cone(.05, hatY + .06, .05, .64, .78, hatGreen, 14);
  // Golden braided Tyrolean hatband.
  for (let i = 0; i < 14; i++) {
    const a = i * Math.PI / 7;
    m.ball(.05 + Math.cos(a) * .56, hatY + .14, .05 + Math.sin(a) * .56, .085, .085, .085, i % 2 ? gold : '#d75c54', 6, 4);
  }
  // Tiny white Tyrolean edelweiss on the front-left of the hatband.
  flower(m, -.38, hatY + .24, .46, .12, '#fffef7', '#f4cf58');
  // Jaunty little alpine feather tucked into the right side of the hatband!
  for (let i = 0; i < 6; i++) {
    const f = i / 5;
    m.ball(.52 + f * .34, hatY + .24 + f * .62, .1 - f * .16, .09 - f * .03, .13, .05, f > .55 ? '#fff8e5' : '#e08956', 7, 4);
  }
}

// Repeatable firing cycles let both the live renderer and the graphics pack
// show the same uneven sputter. Vary the phase per pickup in a shared race.
export const EXHAUST_LOOP_SECONDS = 6;
function exhaustNoise(stroke, salt) {
  const value = Math.sin(stroke*127.1 + salt*311.7)*43758.5453;
  return value - Math.floor(value);
}

export function drawTycoonExhaust(glow, smoke, p, angle, clock, jump, boosting) {
  const time = clock + (p.id ?? 0)*.73;
  const rate = boosting ? 9 : 2;
  const life = boosting ? 1.05 : .83;
  const current = Math.floor(time*rate);
  for (const layer of [glow,smoke]) {
    layer.at(p.x,jump?.height ?? 0,p.z,angle);
    layer.pitch = jump?.pitch ?? 0;
  }
  for (let n=current-Math.ceil(rate*life); n<=current; n++) {
    const count = rate*EXHAUST_LOOP_SECONDS;
    const stroke = ((n%count)+count)%count;
    const seed = exhaustNoise(stroke,1);
    const age = time-(n+.53*seed)/rate;
    if (age<0 || age>=life || (!boosting && seed<.20)) continue;
    const t = age/life;
    const x = -1.22 - age*(.35+seed) + age*.32*Math.sin(stroke+t*4);
    const y = .57 + age*(.58+seed) + .55*age*age;
    const z = -3.14 - age*(boosting ? 8+seed*2 : 2.3+seed);
    const size = (.55+1.35*t)*(1-t*t)*(boosting ? 2.1 : 1);
    const grey = .17+.26*t;
    smoke.particle(x,y,z,size,[grey,grey*.91,grey*.83]);
    smoke.particle(x+.27*size,y+.14*size,z+.06,size*.76,[grey+.09,grey+.08,grey+.07]);
    // Unburnt fuel flashes just outside the pipe and kicks out hot embers.
    if (age>.23 || exhaustNoise(stroke,2)>(boosting ? .76 : .22)) continue;
    const flash = 1-age/.23, power = boosting ? 2.6 : 1.1;
    glow.particle(x,y,z,power*flash,[1,.29,.045]);
    glow.particle(x,y,z+.05,power*.55*flash,[1,.88,.39]);
    for (let k=0;k<3;k++) {
      const a = stroke + k*Math.PI*2/3;
      glow.particle(x+Math.cos(a)*age*power,y+Math.sin(a)*age*power,z-age,
                    .28*power*flash,[1,.55,.09]);
    }
  }
}

export function drawTycoonBoost(glow, smoke, p, angle, clock, jump) {
  const height = jump?.height ?? 0;
  // Gentle alpine-lotus healing wisps and calming golden-mint sparkles.
  glow.at(p.x, height + 1.45, p.z, angle);
  for (let i = 0; i < 5; i++) {
    const phase = (clock * 2.4 + i / 5) % 1;
    const spread = Math.sin(clock * 6 + i * 1.9) * (.4 + phase * .7);
    glow.particle(spread, .35 + phase * .9, -2.5 - phase * 2.4, (.85 - phase * .45), i % 2 ? [.45, .95, .72] : [1.0, .86, .42]);
  }
  smoke.at(p.x, height + 1.55, p.z, angle);
  for (let i = 0; i < 3; i++) {
    const phase = (clock * 1.8 + i / 3) % 1;
    smoke.particle(Math.sin(clock * 4 + i * 2.1) * .45, .4 + phase * 1.1, -2.6 - phase * 2.2, (1.1 + phase * 1.3) * (1 - phase * .6), [.82, .94, .88]);
  }
}

export function drawKarmaAura(m, glow, p, clock, jump) {
  const y = (jump?.height ?? 0) + .18;
  // Radiant lotus ring on the ground around Tycoon.
  glow.at(p.x, y, p.z);
  for (let i = 0; i < 36; i++) {
    const a = i / 36 * Math.PI * 2 + clock * 1.4;
    const b = (i + 1) / 36 * Math.PI * 2 + clock * 1.4;
    const r0 = 3.2, r1 = 3.58;
    const tint = i % 2 ? [.42, .95, .74] : [1.0, .84, .36];
    glow.quad([Math.cos(a) * r0, 0, Math.sin(a) * r0], [Math.cos(b) * r0, 0, Math.sin(b) * r0], [Math.cos(b) * r1, 0, Math.sin(b) * r1], [Math.cos(a) * r1, 0, Math.sin(a) * r1], tint);
  }
  // Six peaceful orbiting lotus petals & golden prayer-bead sparkles.
  for (let i = 0; i < 6; i++) {
    const a = clock * 2.2 + i * Math.PI / 3;
    const px = p.x + Math.cos(a) * 3.1;
    const py = y + 1.8 + Math.sin(clock * 3.5 + i) * .55;
    const pz = p.z + Math.sin(a) * 3.1;
    m.at(px, py, pz, -a);
    m.ball(0, 0, 0, .28, .12, .46, i % 2 ? '#f7b8d2' : '#9ff0cb', 7, 4);
    glow.at(px, py, pz);
    glow.particle(0, 0, 0, .75, i % 2 ? [1.0, .84, .42] : [.45, .95, .74]);
  }
}

export function drawKarmaRaccoon(m, glow, e, angle) {
  const t = e.age, life = e.life || 2.8;
  const clamp = v => Math.max(0, Math.min(1, v));
  const smooth = v => { v = clamp(v); return v * v * (3 - 2 * v); };
  const fadeIn = smooth(t / .25);
  const fadeOut = 1 - smooth((t - (life - .45)) / .45);
  const env = fadeIn * fadeOut;
  if (env <= .005) return;

  // 1. Serene golden-jade pillar of karmic light & expanding lotus ground ring.
  const ringR = (1.8 + smooth(t / .6) * 4.4) * (1 - (1 - fadeOut) * .25);
  glow.at(e.wx, .12, e.wz);
  for (let i = 0; i < 40; i++) {
    const a = i / 40 * Math.PI * 2 + t * 1.2;
    const b = (i + 1) / 40 * Math.PI * 2 + t * 1.2;
    const col = i % 2 ? [.45 * env, .98 * env, .76 * env] : [1.0 * env, .86 * env, .38 * env];
    glow.quad([Math.cos(a) * ringR, 0, Math.sin(a) * ringR], [Math.cos(b) * ringR, 0, Math.sin(b) * ringR], [Math.cos(b) * (ringR + .48), 0, Math.sin(b) * (ringR + .48)], [Math.cos(a) * (ringR + .48), 0, Math.sin(a) * (ringR + .48)], col);
  }
  // Rising luminous alpine pillar.
  for (let i = 0; i < 8; i++) {
    const p = (t * .9 + i / 8) % 1;
    const a = i * 2.399 + t * 2.4;
    glow.particle(Math.cos(a) * (1.2 + p * 1.6), .8 + p * 9.5, Math.sin(a) * (1.2 + p * 1.6), (1.4 - p * .6) * env, i % 2 ? [.48 * env, .95 * env, .76 * env] : [1.0 * env, .86 * env, .42 * env]);
  }

  // 2. Giant spinning Karmic Yin-Yang Mandala & Lotus Petals facing the viewer.
  const rise = 6.2 + smooth(t / .55) * 1.8;
  const spin = t * 2.6;
  const mandalaScale = env * (1 + Math.sin(clamp(t / .45) * Math.PI) * .18);
  m.at(e.wx, rise, e.wz, angle + Math.PI);
  const point = m.point;
  m.point = function ([x, y, z]) {
    const c = Math.cos(spin), s = Math.sin(spin);
    return point.call(this, [(x * c - y * s) * mandalaScale, (x * s + y * c) * mandalaScale, z * mandalaScale]);
  };
  try {
    // Outer golden karmic halo ring.
    for (let i = 0; i < 36; i++) {
      const a = i / 36 * Math.PI * 2, b = (i + 1) / 36 * Math.PI * 2;
      m.quad(
        [Math.cos(a) * 2.55, Math.sin(a) * 2.55, 0],
        [Math.cos(b) * 2.55, Math.sin(b) * 2.55, 0],
        [Math.cos(b) * 2.9, Math.sin(b) * 2.9, 0],
        [Math.cos(a) * 2.9, Math.sin(a) * 2.9, 0],
        i % 2 ? '#f6d56f' : '#8ef0c8',
      );
    }
    // Eight unfolding sacred lotus petals around the halo.
    const bloom = .35 + smooth(t / .5) * .65;
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      const dist = 2.6 + bloom * 1.1;
      m.ball(Math.cos(a) * dist, Math.sin(a) * dist, -.08, .56, .56, .16, i % 2 ? '#f7b4ce' : '#fff5d8', 8, 5);
    }
    // Yin-Yang halves (alpine jade vs warm golden-cream) + counter-dots.
    for (let i = 0; i < 18; i++) {
      const a = i / 18 * Math.PI, b = (i + 1) / 18 * Math.PI;
      m.tri([0, 0, .02], [Math.cos(a) * 2.42, Math.sin(a) * 2.42, .02], [Math.cos(b) * 2.42, Math.sin(b) * 2.42, .02], '#52a889');
      m.tri([0, 0, .02], [Math.cos(a + Math.PI) * 2.42, Math.sin(a + Math.PI) * 2.42, .02], [Math.cos(b + Math.PI) * 2.42, Math.sin(b + Math.PI) * 2.42, .02], '#fff4d2');
    }
    m.ball(1.2, 0, .06, 1.18, 1.18, .12, '#52a889', 12, 6);
    m.ball(-1.2, 0, .06, 1.18, 1.18, .12, '#fff4d2', 12, 6);
    m.ball(1.2, 0, .16, .38, .38, .1, '#fff4d2', 10, 5);
    m.ball(-1.2, 0, .16, .38, .38, .1, '#52a889', 10, 5);
  } finally {
    m.point = point;
  }

  // 3. Twin swapping karmic orbs spiraling up and trading places around the mandala!
  const swapPhase = t * 4.4;
  for (const side of [-1, 1]) {
    const a = swapPhase + (side < 0 ? 0 : Math.PI);
    const ox = e.wx + Math.cos(a) * 3.4 * env;
    const oy = rise + Math.sin(a * 2) * 1.4;
    const oz = e.wz + Math.sin(a) * 3.4 * env;
    m.at(ox, oy, oz);
    m.ball(0, 0, 0, .52 * env, .52 * env, .52 * env, side < 0 ? '#f7d86c' : '#8ef0c8', 8, 5);
    glow.at(ox, oy, oz);
    glow.particle(0, 0, 0, 2.2 * env, side < 0 ? [1.0 * env, .84 * env, .32 * env] : [.4 * env, .98 * env, .76 * env]);
  }
}
