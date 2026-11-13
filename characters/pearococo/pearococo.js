// Cached rococo models use the same kart physics and combat rules as other drivers.
const gold = '#e9bc65', cream = '#fff0ce', pink = '#ef91b9', teal = '#287f93';
function scroll(m, x, y, z, side = 1) {
  for (let i = 0; i < 15; i++) { const a = i * .36, r = .48 * (1 - i / 19); m.ball(x + side * Math.cos(a) * r, y + Math.sin(a) * r, z, .075, .075, .075, gold, 5, 3); }
}
function pearl(m, x, y, z) { m.ball(x, y, z, .09, .09, .09, '#fff8ec', 6, 4); }

export function drawRococoChariot(m, color) {
  for (const side of [-1, 1]) for (const z of [-1.55, 1.45]) {
    // Open gold spokes and pearl rims give the wheels a carriage silhouette.
    for (let i = 0; i < 20; i++) {
      const a = i * Math.PI / 10, y = .84 + Math.sin(a) * .74, zz = z + Math.cos(a) * .74;
      m.ball(side * 1.82, y, zz, .14, .14, .14, cream, 6, 4);
      if (i % 2 === 0) for (let j = 1; j <= 4; j++)m.ball(side * 1.86, .84 + Math.sin(a) * j * .16, z + Math.cos(a) * j * .16, .055, .09, .09, gold, 5, 3);
    }
    m.ball(side * 1.88, .84, z, .19, .23, .23, gold, 8, 5); m.ball(side * 2.03, .84, z, .07, .12, .12, pink, 6, 4);
  }
  m.ball(0, .96, 0, 1.62, .5, 2.45, cream, 14, 7);
  m.ball(0, 1.32, -.6, 1.12, .44, 1.15, '#b65487', 12, 6);
  for (const side of [-1, 1]) {
    m.box(side * 1.4, 1.16, 0, .2, .23, 3.45, gold);
    m.ball(side * 1.49, 1.13, .15, .12, .32, 1.25, color, 10, 5);
    for (const z of [-1.8, -.45, 1]) scroll(m, side * 1.58, 1.5, z, side);
    for (let i = 0; i < 9; i++)pearl(m, side * 1.6, 1.83, -1.8 + i * .4);
    m.ball(side * 1.3, 1.46, 2.05, .32, .38, .18, pink, 8, 5);
    scroll(m, side * .8, 1.48, 2.35, side);
  }
  // Scallop-shell prow, a characteristic rococo motif.
  for (let i = 0; i < 9; i++) { const a = (i - 4) * .19; m.ball(Math.sin(a) * .77, 1.55 + Math.cos(a) * .32, 2.4, .11, .48, .12, i % 2 ? gold : cream, 7, 4); }
  m.ball(0, 1.42, 2.52, .19, .2, .1, '#c773b7', 8, 5);
}

export function drawPeacockFeather(m, i) {
  // A real peacock fan: tapered feather blades, gold shafts and jeweled eyes.
  const a = (i - 5) * .23, dx = Math.sin(a), dy = Math.cos(a), length = 3.8 + (i % 2) * .15;
  const point = (t, w, z) => [dx * t + dy * w, 1.75 + dy * t - dx * w, z];
  // Subdivisions let the GPU bend the blade, shaft and eyes together.
  for (let j = 0; j < 12; j++) {
    const t = j / 12, u = (j + 1) / 12, w = Math.sin(t * Math.PI) * .43, v = Math.sin(u * Math.PI) * .43;
    const a = point(t * length, -w, -1.05 - t * .4), b = point(u * length, -v, -1.05 - u * .4), c = point(u * length, v, -1.05 - u * .4), d = point(t * length, w, -1.05 - t * .4);
    m.quad(a, b, c, d, i % 2 ? '#74bfae' : '#60a5b5'); m.quad(d, c, b, a, i % 2 ? '#74bfae' : '#60a5b5');
  }
  for (let j = 1; j <= 9; j++) { const p = point(j * length / 10, 0, -1.34); m.ball(...p, .035, .08, .035, gold, 5, 3); }
  const [x, y] = point(length * .82, 0, 0);
  for (const side of [-1, 1]) {
    m.ball(x, y, -1.45 + side * .1, .28, .4, .08, gold, 9, 5);
    m.ball(x, y, -1.45 + side * .17, .2, .28, .04, teal, 8, 5);
    m.ball(x, y, -1.45 + side * .2, .105, .16, .025, '#d176ae', 7, 4);
    pearl(m, x - .04, y + .08, -1.45 + side * .23);
  }
}

export function drawPearococo(m) {
  // Pink panniers, ivory lace and strings of pearls.
  m.ball(0, 2.04, 0, 1.36, .78, .86, pink, 12, 7);
  for (const side of [-1, 1]) {
    m.ball(side * .95, 2.1, 0, .55, .61, .73, '#ffd2df', 10, 6);
    for (let i = 0; i < 7; i++) { const a = i * Math.PI / 6; m.ball(side * (.73 + Math.sin(a) * .63), 1.78 + Math.cos(a) * .15, .56, .17, .15, .14, cream, 6, 4); }
  }
  m.ball(0, 2.85, .13, .55, .67, .53, teal, 10, 6);
  m.ball(0, 3.44, .2, .29, .74, .29, '#389cae', 10, 6);
  m.ball(0, 4.18, .35, .53, .58, .49, '#439eb1', 12, 7);
  m.ball(0, 4.04, .85, .21, .14, .4, gold, 8, 5);
  for (const side of [-1, 1]) {
    m.ball(side * .3, 4.3, .73, .14, .19, .08, '#fff5e8', 8, 5);
    m.ball(side * .3, 4.31, .79, .06, .11, .03, '#232d49', 7, 4);
    m.box(side * .31, 4.48, .74, .24, .035, .045, '#283452');
    m.ball(side * .39, 4.06, .7, .13, .065, .035, pink, 7, 4);
    // Powdered curls and dangling pearl earrings.
    for (let i = 0; i < 3; i++)m.ball(side * .49, 4.46 - i * .2, .24, .2, .16, .25, cream, 8, 5);
    pearl(m, side * .55, 3.9, .31);
    for (let i = 0; i < 5; i++)pearl(m, side * (.08 + i * .08), 2.96 - i * .05, .62);
  }
  m.ball(0, 4.7, .26, .42, .18, .38, '#fff3df', 10, 5);
  for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; m.ball(Math.sin(a) * .32, 4.87, .26 + Math.cos(a) * .28, .07, .16, .07, gold, 6, 4); }
  m.ball(0, 5.1, .26, .12, .14, .12, pink, 8, 5);
  // Left wing rests delicately against the chariot rail.
  m.ball(-.64, 2.72, .47, .28, .42, .26, '#ffd2df', 8, 5);
  m.ball(-.88, 2.34, .7, .19, .3, .2, teal, 8, 5); m.ball(-1, 2.17, .87, .21, .13, .22, cream, 8, 5);
}

export function drawRoyalWing(m, phase) {
  const raised = phase >= 0, sway = raised ? Math.sin(phase * Math.PI / 4) * .16 : 0;
  m.ball(.64, 2.72, .47, .3, .38, .27, '#ffd2df', 8, 5);
  m.ball(.88, 2.62, .67, .19, .29, .19, teal, 8, 5);
  const x = raised ? 1.1 : .98, y = raised ? 3.36 : 2.22, z = .85;
  m.ball(1, raised ? 2.98 : 2.4, z, .14, raised ? .44 : .25, .14, cream, 8, 5);
  // Palm stays upright: a small wrist swivel, rather than a full-arm cheer.
  m.ball(x, y, z, .22, .24, .1, cream, 9, 5);
  for (let finger = 0; finger < 4; finger++)m.ball(x + (finger - 1.5) * .105 + sway, y + .28, z, .045, .17, .065, cream, 6, 4);
  m.ball(x - .23, y - .02, z + .035, .1, .12, .075, cream, 7, 4);
  m.ball(1, raised ? 3.12 : 2.02, z, .18, .055, .17, gold, 8, 4);
}

export function drawBalletPump(m) {
  m.ball(0, -.11, .08, .34, .08, .78, gold, 10, 5);
  m.ball(0, .04, .1, .37, .21, .78, '#f5a1c7', 12, 6);
  m.ball(0, .2, -.14, .24, .045, .39, '#a94d79', 10, 4);
  m.ball(0, .13, .64, .32, .15, .25, '#ffcade', 10, 5);
  for (const side of [-1, 1]) {
    m.ball(side * .16, .25, .35, .18, .065, .09, pink, 8, 4);
    m.quad([side * .14, .21, -.32], [side * .24, .23, -.28], [side * .49, .5, -.67], [side * .39, .48, -.71], '#f2a1c2');
  }
  pearl(m, 0, .26, .36);
}

export function drawFairyStar(m) {
  for (const z of [-.035, .035]) for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2, b = a + Math.PI / 4, c = a + Math.PI / 2;
    m.tri([0, 0, z], [Math.sin(a) * .38, Math.cos(a) * .38, z], [Math.sin(b) * .1, Math.cos(b) * .1, z], cream);
    m.tri([0, 0, z], [Math.sin(b) * .1, Math.cos(b) * .1, z], [Math.sin(c) * .38, Math.cos(c) * .38, z], gold);
  }
}

export function drawFairyBoost(glow, smoke, p, angle, clock, jump = null) {
  for (const mesh of [glow, smoke]) { mesh.at(p.x, .13 + (jump?.height ?? 0), p.z, angle); mesh.pitch = jump?.pitch ?? 0; mesh.pivot = 1.87; }
  for (const side of [-1, 1]) for (let i = 0; i < 48; i++) {
    const t = (clock * 1.25 + i / 48) % 1, x = side * 1.3 + Math.sin(i * 2.4 + clock * 2) * t * 1.8, y = 1 + t * 2.2 + Math.cos(i * 1.7) * t * .8, z = -2.3 - t * 11, fade = 1 - t;
    glow.particle(x, y, z, (.24 + .5 * Math.sin(i + clock * 8) ** 2) * Math.sqrt(fade), i % 2 ? [fade, .62 * fade, .2 * fade] : [.9 * fade, .2 * fade, .58 * fade]);
    if (i % 2 === 0) smoke.particle(x, y, z, (1.3 + t * 3.3) * Math.sqrt(fade), i % 4 === 0 ? [.76, .34, .92] : [.98, .52, .77]);
    if (i % 8 === 0) glow.particle(x, y, z, 1.5 * fade, [.19 * fade, .05 * fade, .17 * fade]);
  }
}
