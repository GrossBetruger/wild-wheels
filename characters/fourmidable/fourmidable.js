const ink = '#293a42', shell = '#b6634e', pink = '#f2b7a0';
function link(m, a, b, r, color) { for (let i = 0; i <= 8; i++)m.ball(...a.map((v, j) => v + (b[j] - v) * i / 8), r, r, r, color, 6, 4); }
function digit(m, n, x, y, z, size, color) {
  const segments = [[0, 1, .7, .1], [.36, .75, .1, .45], [.36, .25, .1, .45], [0, 0, .7, .1], [-.36, .25, .1, .45], [-.36, .75, .1, .45], [0, .5, .7, .1]];
  for (const k of [[0, 1, 2, 3, 4, 5], [1, 2], [0, 1, 6, 4, 3], [0, 1, 6, 2, 3], [5, 6, 1, 2], [0, 5, 6, 2, 3], [0, 5, 6, 4, 2, 3], [0, 1, 2], [0, 1, 2, 3, 4, 5, 6], [0, 1, 2, 3, 5, 6]][n]) { const [dx, dz, w, d] = segments[k]; m.box(x + dx * size, y, z + dz * size, w * size, .025, d * size, color); }
}
export function drawCalculator(m, color) {
  for (const x of [-1.6, 1.6]) for (const z of [-1.6, 1.6]) { m.ball(x, .6, z, .48, .6, .65, ink, 10, 6); m.ball(x + Math.sign(x) * .4, .6, z, .08, .29, .29, '#dce6d6', 8, 5); }
  m.box(0, .45, 0, 3.15, .7, 4.9, color); m.box(0, 1.15, 0, 2.95, .12, 4.7, '#f1e4cc');
  m.box(0, 1.28, -1.75, 2.5, .08, .75, ink); m.box(0, 1.37, -1.75, 2.25, .025, .57, '#a6d9a0');
  for (let i = 0; i < 5; i++)digit(m, [3, 1, 4, 1, 5][i], -.82 + i * .4, 1.4, -1.97, .33, '#315947');
  for (let row = 0; row < 3; row++)for (let col = 0; col < 3; col++) { const x = (col - 1) * .82, z = .4 + row * .63; m.box(x, 1.28, z, .65, .16, .5, ink); digit(m, 9 - row * 3 - col, x, 1.46, z - .15, .3, '#fff1ce'); }
  m.box(1.25, 1.3, 1.1, .25, .15, 1.7, '#ef9c64');
  m.box(0, 1.2, -2.43, 1.85, .22, .22, ink); m.box(0, 1.31, -2.52, 1.58, .045, .07, '#aaa98b');
  for (const x of [-1.12, 1.12]) { m.ball(x, .95, 2.48, .24, .15, .06, '#fff6b8', 8, 4); m.ball(x, .8, -2.48, .18, .1, .06, '#f86b67', 8, 4); }
}
export function drawAnt(m, phase, wave) {
  const twitch = Math.sin(phase * Math.PI / 4), headX = twitch * .045;
  m.ball(0, 1.85, -.95, .65, .5, .85, shell, 12, 7); m.ball(0, 2.35, -.25, .35, .6, .4, shell, 12, 7);
  // Six limbs: two driving, two checking the figures, two feet beside the calculator.
  for (const side of [-1, 1]) {
    if (!(wave && side === 1)) { link(m, [side * .2, 2.6, -.1], [side * .7, 2.15, .4], .1, shell); link(m, [side * .7, 2.15, .4], [side * .45, 1.7, .7], .1, pink); }
    link(m, [side * .25, 2.2, -.4], [side * .9, 1.8, -.1], .1, shell); link(m, [side * .9, 1.8, -.1], [side * 1.15, 1.5, .5], .1, pink);
    link(m, [side * .35, 1.9, -.9], [side * .95, 1.55, -1.1], .12, shell); m.ball(side * 1.1, 1.5, -.9, .24, .12, .3, ink, 8, 5);
    if (wave && side === 1) { link(m, [.25, 2.6, -.1], [.95, 3.6 + twitch * .12, 0], .13, shell); m.ball(.95, 3.65 + twitch * .12, 0, .17, .2, .15, pink, 8, 5); }
  }
  m.ball(headX, 3.15, .05, .85, .76, .7, shell, 16, 9);
  for (const side of [-1, 1]) {
    m.ball(headX + side * .34, 3.25, .65, .31, .36, .12, '#fff9df', 12, 6); m.ball(headX + side * .31, 3.28, .76, .13, .18, .07, ink, 10, 6); m.ball(headX + side * .27, 3.36, .82, .055, .065, .025, '#ffffff', 8, 4);
    for (let i = 0; i < 24; i++) { const a = i * Math.PI / 12, b = (i + 1) * Math.PI / 12; link(m, [headX + side * .34 + Math.cos(a) * .34, 3.25 + Math.sin(a) * .39, .78], [headX + side * .34 + Math.cos(b) * .34, 3.25 + Math.sin(b) * .39, .78], .025, '#bfa365'); }
    m.ball(side * .58, 2.97, .63, .18, .09, .06, pink, 8, 4);
    link(m, [side * .34, 3.72, 0], [side * (.6 + twitch * .07), 4.25, -.03], .065, shell); link(m, [side * (.6 + twitch * .07), 4.25, -.03], [side * (.88 + twitch * .1), 4.4, .24], .065, shell); m.ball(side * (.88 + twitch * .1), 4.4, .24, .12, .12, .12, pink, 8, 4);
    link(m, [side * .12, 3.76, .6], [side * .5, 3.65, .64], .045, ink);
  }
  m.box(0, 3.26, .79, .13, .035, .04, '#bfa365'); m.ball(0, 2.82, .67, .12, .08, .03, ink, 8, 4);
}
export function drawTaxAudit(m, e, angle) {
  const t = e.age, clamp = v => Math.max(0, Math.min(1, v)), smooth = v => { v = clamp(v); return v * v * (3 - 2 * v); }, impact = .52;
  const rise = smooth((t - .72) / .65), vanish = 1 - smooth((t - 1.12) / .5), drop = 1 - smooth(t / impact), press = Math.sin(clamp((t - impact) / .2) * Math.PI) * .22;
  const height = 6.4 + drop * 7 + rise * 5 - press, scale = smooth(t / .15) * vanish;
  // Turned walnut handle, brass shoulder and a broad rubber stamping face.
  if (scale > 0) {
    m.at(e.wx, height, e.wz, angle + Math.PI); m.roll = drop * .23 - rise * .3;
    const point = m.point; m.point = function ([x, y, z]) { return point.call(this, [x * scale, y * scale, z * scale]); };
    try {
      const profile = [[0, 2.5], [.2, 2.5], [.24, 2.65], [.48, 2.65], [.56, 2.35], [.85, 1.9], [1.05, 1.45], [1.18, .65], [1.4, .48], [2.3, .42], [2.55, .62], [2.72, .94], [3.05, 1.1], [3.4, 1], [3.63, .6], [3.7, 0]];
      for (let j = 0; j < profile.length - 1; j++)for (let i = 0; i < 40; i++) {
        const a = i * Math.PI / 20, b = (i + 1) * Math.PI / 20, [y, r] = profile[j], [yy, rr] = profile[j + 1], color = j < 1 ? '#402831' : j < 5 ? '#c39b53' : i % 7 < 2 ? '#81472f' : '#653824';
        m.quad([Math.cos(a) * r, y, Math.sin(a) * r], [Math.cos(b) * r, y, Math.sin(b) * r], [Math.cos(b) * rr, yy, Math.sin(b) * rr], [Math.cos(a) * rr, yy, Math.sin(a) * rr], color);
      }
      m.disc(0, -.015, 0, 2.48, 2.48, '#522536', 40);
      for (const y of [1.45, 2.35]) m.ball(0, y, 0, .49, .075, .49, '#b48d50', 20, 4);
    } finally { m.point = point; }
  }
  if (t < impact) return;
  // The fresh red impression starts flat at contact, then turns toward the viewer.
  const reveal = smooth((t - impact) / .12), tilt = smooth((t - .78) / .4) * Math.PI / 2, sealScale = reveal * (1 - smooth((t - e.life + .35) / .35));
  m.at(e.wx, 6.4 + smooth((t - .78) / .4) * 1.5, e.wz, angle + Math.PI); m.roll = -.12;
  const point = m.point; m.point = function ([x, y, z]) { return point.call(this, [x * sealScale, (y * Math.sin(tilt) + z * Math.cos(tilt)) * sealScale, (y * Math.cos(tilt) - z * Math.sin(tilt)) * sealScale]); };
  try {
    const red = '#ce304b';
    for (const [radius, width] of [[2.55, .2], [2.23, .07]]) for (let i = 0; i < 96; i++) {
      const a = i * Math.PI / 48, b = (i + 1) * Math.PI / 48, r = radius + Math.sin(i * 7) * .018;
      m.quad([Math.cos(a) * r, Math.sin(a) * r, 0], [Math.cos(b) * r, Math.sin(b) * r, 0], [Math.cos(b) * (r - width), Math.sin(b) * (r - width), 0], [Math.cos(a) * (r - width), Math.sin(a) * (r - width), 0], red);
    }
    m.box(-.65, -1.35, 0, .48, 2.7, .07, red); m.box(.13, .87, 0, 1.65, .48, .07, red); m.box(-.03, -.08, 0, 1.33, .43, .07, red);
  } finally { m.point = point; }
}
export class ReceiptRolls {
  rolls = new Map();
  draw(m, p, angle, clock, jump, boost) {
    const key = p.id ?? 'preview'; let state = this.rolls.get(key);
    if (!state || clock < state.time || clock - state.time > 1) { state = { time: clock, amount: boost ? 1 : 0, velocity: 0, feed: clock * 3 }; this.rolls.set(key, state); }
    const dt = Math.min(.05, Math.max(0, clock - state.time)); state.time = clock;
    // Critically damped feed mechanism: the paper accelerates out and settles back.
    const target = boost ? 1 : 0, decay = Math.exp(-12 * dt), displacement = state.amount - target, c = state.velocity + 12 * displacement;
    state.amount = target + (displacement + c * dt) * decay; state.velocity = (state.velocity - 12 * c * dt) * decay;
    state.feed += dt * 5 * state.amount;
    if (state.amount < .005) return;
    drawReceipt(m, p, angle, clock, jump, state.amount, state.feed);
  }
}
function drawReceipt(m, p, angle, clock, jump, amount, feed) {
  m.at(p.x, jump?.height ?? 0, p.z, angle); m.pitch = jump?.pitch ?? 0;
  const length = 2.5 * amount, radius = 1.05 * amount, turns = Math.PI * 3.25, coilLength = radius * turns, total = length + coilLength, width = 1.5;
  const center = d => {
    const free = Math.min(d, length), f = free / Math.max(.001, length), wave = f * f;
    const x = Math.sin(clock * 2.8 - free * .65) * .22 * wave, y = 1.34 + f * .75 + Math.sin(f * Math.PI) * .55 + Math.sin(clock * 7 - free * 1.5) * .15 * wave, z = -2.5 - free;
    if (d <= length) return [x, y, z];
    // A continuous spiral joins the trailing sheet tangentially, like a real thermal roll.
    const a = (d - length) / Math.max(.001, radius), r = radius * (1 - .065 * a);
    return [x, y + radius - r * Math.cos(a), z - r * Math.sin(a)];
  };
  const surface = (d, u, offset = 0) => {
    const c = center(d), a = center(Math.max(0, d - .005)), b = center(Math.min(total, d + .005)), dy = b[1] - a[1], dz = b[2] - a[2], n = Math.hypot(dy, dz) || 1;
    const bank = Math.sin(clock * 4 - d * .9) * .13 * Math.min(1, d / 3);
    return [c[0] + u * Math.cos(bank), c[1] + u * Math.sin(bank) - dz / n * offset, c[2] + dy / n * offset];
  };
  const strip = (a, b, left, right, color, offset = 0) => m.quad(surface(a, left, offset), surface(a, right, offset), surface(b, right, offset), surface(b, left, offset), color);
  for (let i = 0; i < 150; i++) {
    const a = i / 150 * total, b = (i + 1) / 150 * total;
    strip(a, b, -width / 2, width / 2, i % 17 === 0 ? '#e8dfc4' : '#fff5d8');
    // Subtle side margins make the paper edges readable as the roll twists.
    strip(a, b, -width / 2, -width / 2 + .035, '#d1c7aa', .008); strip(a, b, width / 2 - .035, width / 2, '#d1c7aa', .008);
  }
  // Itemized receipt printing travels with the paper being fed through the slot.
  const spacing = .32, phase = feed % spacing;
  for (let d = phase; d < total - .05; d += spacing) {
    const row = Math.floor((d - feed) / spacing), subtotal = Math.abs(row) % 7 === 0, b = Math.min(total, d + (subtotal ? .055 : .025));
    for (const face of [-.012, .012]) {
      strip(d, b, -.57, subtotal ? .55 : -.08 - (Math.abs(row) % 4) * .075, '#526052', face);
      if (!subtotal) strip(d, b, .27, .56, '#526052', face);
    }
  }
}
export function drawXylophone(m, phase) {
  const colors = ['#ee6b72', '#f59b65', '#f1d66c', '#b6dc72', '#6dd4aa', '#64bcd9', '#8f9de2', '#c993de'];
  m.box(0, 1.5, 0, 15, .4, .8, '#5c3d48'); m.box(0, 7.5, 0, 15, .4, .8, '#5c3d48');
  for (let i = 0; i < 8; i++) {
    const x = (i - 3.5) * 1.8, hit = phase === i ? .35 : 0, h = 6 - i * .3;
    m.box(x, 2 + hit, -.55, 1.65, h, .5, colors[i]);
    for (const y of [2.45 + hit, 1.55 + h + hit]) m.ball(x, y, -.85, .11, .11, .055, '#fff4db', 8, 4);
    const malletY = 8.5 + (phase === i ? -1 : .2); if (i === phase || i === (phase + 3) % 8) { link(m, [x, malletY + 1, -2], [x, malletY, -.9], .1, '#e6c593'); m.ball(x, malletY, -.9, .4, .4, .4, '#fff0c7', 10, 6); }
  }
}
