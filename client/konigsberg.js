// The fronts face the river. Solid roof pitches give the skyline depth in the
// chase camera, while windows and gable ornaments need only a few flat faces.
const plaster = ['#d6b598', '#c59379', '#e0cbaa', '#bfaa92', '#d9ba86'];
const tile = ['#a35643', '#864c42', '#ac6650', '#79534c'];
const glass = '#525d60';

function panel(m, x, y, z, width, height, color) {
  const l = x - width / 2, r = x + width / 2;
  m.quad([l,y,z], [l,y+height,z], [r,y+height,z], [r,y,z], color);
}

function gabledHall(m, w, d, eave, rise, wall, roof) {
  const l = -w / 2, r = w / 2, f = -d / 2, b = d / 2, peak = eave + rise;
  m.box(0, 0, 0, w, eave, d, wall);
  m.tri([l,eave,f], [0,peak,f], [r,eave,f], wall);
  m.tri([r,eave,b], [0,peak,b], [l,eave,b], wall);
  m.quad([l,eave,b], [0,peak,b], [0,peak,f], [l,eave,f], roof);
  m.quad([0,peak,b], [r,eave,b], [r,eave,f], [0,peak,f], roof);
}

function merchantHouse(m, variation) {
  const w = 10 + variation % 4, d = 13 + variation % 5;
  const eave = 10 + variation % 6, rise = w * .62, front = -d/2 - .06;
  const wall = plaster[variation % plaster.length];
  gabledHall(m, w, d, eave, rise, wall, tile[variation % tile.length]);
  for (const x of [-w*.27, 0, w*.27]) panel(m, x, eave-3.8, front, 1.25, 2.45, glass);
  panel(m, 0, eave+.7, front, 1.4, 2, glass);
  panel(m, 0, eave-.45, front, w+.3, .45, '#eed4ae');
  if (variation % 3 === 0) {
    for (let tier=0; tier<3; tier++) {
      const width = w*(1-tier/3);
      panel(m, 0, eave+tier*rise/3, front-.06, width, rise/3, wall);
      panel(m, 0, eave+(tier+1)*rise/3, front-.09, width+.3, .3, '#edd3b1');
    }
    panel(m, 0, eave+1, front-.12, 1.4, 2.5, glass);
  }
  if (variation % 4 === 1) m.box(w*.27, eave+rise*.45, 3, 1.3, 3.4, 1.4, '#975e4d');
}

function cathedral(m) {
  const brick = '#b97c64', copper = '#567872';
  gabledHall(m, 17, 36, 21, 10, brick, '#7b5953');
  for (const side of [-1,1]) {
    const x = side*6, tower = side < 0 ? 34 : 24;
    m.box(x, 0, -17, 7, tower, 7, brick);
    m.box(x, tower-1, -17, 7.5, 1, 7.5, '#dbc7a7');
    for (const offset of [-1.4,1.4]) panel(m, x+offset, tower-6, -20.6, 1.1, 3.8, glass);
    m.cone(x, tower, -17, 5.25, side < 0 ? 18 : 7, copper, 8);
  }
  for (const z of [-10,-3,4,11]) {
    for (const side of [-1,1]) m.box(side*8.5, 0, z, 1.4, 16, 1.4, '#ca9379');
  }
}

export function drawKonigsberg(m, radius) {
  for (let bank=0; bank<4; bank++) {
    const angle = bank*Math.PI/2, s = Math.sin(angle), c = Math.cos(angle);
    // Break the terraces at the ends of the river, leaving open water sightlines.
    for (let lot=-6; lot<=6; lot++) {
      if (bank % 2 && Math.abs(lot) <= 1) continue;
      const variation = (lot+6)*7 + bank*11;
      const along = lot*15*radius/96, depth = radius+16+variation%4;
      m.at(along*c+depth*s, 0, depth*c-along*s, angle);
      merchantHouse(m, variation);
    }
  }
  m.at(-39*radius/96, 0, -radius-44, Math.PI*.78);
  cathedral(m);
  m.at(0,0,0);
}
