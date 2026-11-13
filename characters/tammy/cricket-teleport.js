const clamp = x => Math.max(0, Math.min(1, x));
const smooth = x => { x = clamp(x); return x * x * (3 - 2 * x); };
export const arrivalScale = age => smooth((age - .35) / .2);
export function departurePose(age) { return { height: 5 * smooth(age / .35), scale: 1 - smooth((age - .12) / .22), pitch: -Math.PI * smooth(age / .4) }; }
export function drawTeleportHaze(renderer, e, time) {
  const arrival = e.type === 'teleportIn', t = e.age, life = e.life, expand = smooth(t / .55), fade = 1 - smooth((t - .55) / (life - .55)), anchor = arrival ? 3.8 * Math.sin(clamp(t / .6) * Math.PI) : 3.3 * smooth(t / .35), lift = anchor + 1.4, smoke = renderer.smoke, g = renderer.glow;
  smoke.at(e.wx, 0, e.wz); g.at(e.wx, 0, e.wz);
  // A thick, rising cloud and loose green motes linger after the racer vanishes.
  for (let i = 0; i < 34; i++) {
    const a = i * 2.399 + t * (i % 2 ? .6 : -.6), radius = (.4 + (i % 7) * .37) * (.35 + expand), y = anchor + .4 + (i % 5) * .65 + Math.sin(i * 3.7 + t * 4) * .22;
    smoke.particle(Math.cos(a) * radius, y, Math.sin(a) * radius, (1.6 + (i % 4) * .45) * fade, [.19, .56, .07]);
    const drift = (.4 + t * 1.8), r = (1 + i % 4) * drift; g.particle(Math.cos(a) * r, anchor + .4 + (i % 6) * .4 + t * (1 + i % 3), Math.sin(a) * r, .13 * fade, [.18 * fade, .65 * fade, .025 * fade]);
  }
  for (let ring = 0; ring < 3; ring++) {
    const radius = (1.8 + ring * .7) * (.3 + expand), y = ring * .85 + Math.sin(t * 5 + ring) * .12;
    for (let i = 0; i < 48; i++) { const a = i * Math.PI / 24, b = (i + 1) * Math.PI / 24, w = .07 * fade; g.quad([Math.cos(a) * radius, y, Math.sin(a) * radius], [Math.cos(b) * radius, y, Math.sin(b) * radius], [Math.cos(b) * (radius + w), y + .04, Math.sin(b) * (radius + w)], [Math.cos(a) * (radius + w), y + .04, Math.sin(a) * (radius + w)], [.07 * fade, .48 * fade, .025 * fade]); }
  }
  const flash = Math.sin(clamp(t / .55) * Math.PI) * fade; g.particle(0, lift, 0, 3.8 * flash, [.3 * flash, .65 * flash, .04 * flash]);
}
