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

// An open steel link with alternating tilt; the empty middle stays visible
// against the fire. The upper rim catches light on the polished steel.
const linkOutline = [[-.94,-.17],[-.7,-.38],[.66,-.38],[.95,-.14],[.95,.14],[.68,.38],[-.7,.38],[-.94,.17]];
function drawLink(mesh, point, tilt) {
  const rim = (scaleX, scaleY) => linkOutline.map(([x,y]) =>
    point(x*scaleX, 1.42+y*scaleY, .18+y*tilt*scaleY));
  const outer = rim(1.12,1.4), inner = rim(.85,.71);
  for (let i=0; i<outer.length; i++) {
    const next = (i+1)%outer.length;
    mesh.quad(outer[i],outer[next],inner[next],inner[i],i<3 ? "#5d5259" : "#d3c2a8");
  }
}

// A cast metal death head with swept horns, open jaw and recessed hot eyes.
// These six badges ride the chain. Their size stays legible as the ring grows.
function drawDeathHead(mesh, glow, angle, radius, lift, size, fire, collapse) {
  const x = Math.sin(angle), z = Math.cos(angle);
  // Rake the badge back like a motorcycle headlamp so its face reads from
  // the chase camera as well as from across the arena.
  const point = (side, up, out) => {
    const r = radius + (out*.8-up*.6)*size;
    return [x*r+z*side*size,(lift+(up*.8+out*.6)*size)*collapse,z*r-x*side*size];
  };
  const crown = point(0,1.12,.05), brow = point(0,.45,.57), nose = point(0,-.12,.63);
  for (const side of [-1,1]) {
    const p = (across,up,out) => point(side*across,up,out);
    const temple = p(.8,.62,.08), cheek = p(.65,-.25,.27), jaw = p(.4,-.5,.31);
    mesh.tri(crown,temple,brow,"#c9baa4");
    mesh.tri(brow,temple,p(.74,.3,.42),"#f7e7c4");
    mesh.tri(temple,cheek,p(.74,.3,.42),"#766976");
    mesh.tri(brow,p(.74,.3,.42),nose,"#30252b");
    mesh.tri(p(.18,.25,.58),p(.62,.32,.46),p(.35,.03,.56),fire.flame);
    mesh.tri(nose,cheek,jaw,"#ccbfa6");
    mesh.quad(nose,jaw,p(.31,-.8,.32),p(.14,-.81,.46),"#efddb7");
    mesh.tri(p(.53,-.29,.37),p(.78,-.26,.24),p(.54,-.96,.34),"#e3ceaa");
    // Two facets along each swept horn keep their hooked profile in side view.
    const root = p(.55,.73,0), joint = p(1.22,1.03,-.16), tip = p(1.43,1.96,-.34);
    const edge = p(1.01,.63,.13);
    mesh.quad(root,joint,edge,temple,"#a69a93");
    mesh.tri(edge,joint,tip,"#ffdfad");
    mesh.tri(crown,p(0,.25,-.59),temple,"#82757a");
    mesh.tri(temple,p(0,.25,-.59),cheek,"#504851");
    glow.particle(...p(.39,.2,.59),size*.25*collapse,fire.light);
  }
}

export function drawFireRing(mesh, glow, effect, time, collapse = 1) {
  mesh.at(effect.wx, 0, effect.wz);
  glow.at(effect.wx, 0, effect.wz);
  const radius = effect.radius ?? 10, width = radius * Math.tan(Math.PI / sectors.length);
  const fire = palette(effect), direction = fire === blue ? -1 : 1;
  const turn = direction * time * TAU / 4;
  const bands = [fire.core, fire.flame, fire.flame, fire.shadow];
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

    drawLink(mesh,point,i%2 ? 1.3 : -.8);

    // Fold a broad flame around a wandering ridge. The reversed bend near the
    // tip makes tongues peel back while a second, shorter jet splits away.
    const sweep = .45+.26*flicker, twist = Math.sin(turn*5+phase+seed*8);
    let left = point(-.94,.86), right = point(.89,.86), spine = point(-.22,1,shoulder*.75);
    let seam = point(.27,1.01,shoulder*.8);
    for (let band=1; band<=4; band++) {
      const t = band/5, waist = (1-t)*(.94+.24*Math.sin(t*8+turn*5+i));
      const bend = t*t*2.1+sweep*Math.sin(t*6+twist)*t;
      const roll = shoulder*t*(twist+Math.sin(t*6+turn*3+phase));
      const l = point(bend-waist,t*height+.86,roll);
      const r = point(bend+waist,t*height+.86,roll-shoulder*.42);
      const mid = point(bend-waist*.24,t*height+1,roll+waist*shoulder*.84);
      mesh.quad(left,spine,mid,l,bands[band-1]);
      mesh.quad(spine,right,r,mid,band<3 ? fire.flame : fire.shadow);
      const hotEdge = point(bend+waist*.25,t*height+.97,roll+waist*shoulder*.85);
      glow.quad(spine,seam,hotEdge,mid,band<3 ? fire.core : fire.flame);
      seam=hotEdge;
      left=l; right=r; spine=mid;
    }
    const tip = point(2.1+sweep+.55*twist,height+.86,shoulder*(twist-.3));
    mesh.tri(left,spine,tip,fire.flame);
    mesh.tri(spine,right,tip,fire.shadow);
    const split = point(-.61,height*.38,shoulder);
    const fork = point(-.78+twist*.65,height*(.59+.16*pulse),shoulder*1.35);
    mesh.quad(point(.54,1,shoulder*.24),point(-.7,.9),split,point(-.17,height*.32,shoulder*.8),fire.core);
    mesh.tri(split,point(-.17,height*.32,shoulder*.8),fork,fire.flame);
    glow.tri(point(-.49,1.05,shoulder*.3),point(.33,1.04,shoulder*.5),split,fire.light);
    glow.particle(...point(.2,height*.37,shoulder*.7),(1.5+pulse)*collapse,fire.light);
    // Detached wisps roll over the crest and dissolve into flying cinders.
    const wispAge = (time*.75+seed)%1;
    const wisp = (t,side) => point(1.5+t*2.6+side*(1-t)*.46,
      height*(.63+t*.57)+.8,shoulder*(twist+.8*t+side*.2));
    const wispTip = Math.min(1,wispAge+.28), wispMid = (wispTip+wispAge)/2;
    glow.quad(wisp(wispAge,0),wisp(wispMid,1),wisp(wispTip,0),wisp(wispMid,-1),fire.flame);
    glow.particle(...wisp(wispMid,0),(1-wispAge)*1.7*collapse,fire.light);

    const [gx,gy,gz] = point(0,1.1);
    glow.particle(gx,gy,gz,(1.4+pulse)*collapse,fire.light);
    for (let j=0;j<2;j++) {
      const age = (time*.75+seed+j*.5)%1, fade = 1-age;
      const [sx,sy,sz] = point(.5+age*(2+seed),1+height*.55+age*(8-3*age),age*(1+seed));
      glow.particle(sx,sy,sz,(.12+.22*fade)*collapse,fire.light);
    }
    // Grinder sparks leave a short hot streak, alternating between the lugs.
    if (i%3 === 0) {
      const age = (time+seed)%1, arc = age*(1-age);
      const streak = (t,offset) => point(.7+t*3.8,1.2+arc*9+offset,shoulder+t*2.5);
      glow.tri(streak(age-.18,0),streak(age,.13),streak(age,-.08),fire.light);
    }
  }
  for (let i=0; i<6; i++) {
    const angle = i*TAU/6+turn/6;
    const lift = 4.4+.38*Math.sin(turn*3+angle*2);
    drawDeathHead(mesh,glow,angle,radius+width*1.45,lift,Math.min(2.25,1.35+width*.45),fire,collapse);
  }
}

export function drawFireRingOut(mesh, glow, smoke, effect, time) {
  const {age,life} = effect;
  if (age >= life) return;
  const radius = effect.radius ?? 10, fire = palette(effect);
  if (age < .55) drawFireRing(mesh,glow,effect,time,(1-age/.55)**2);
  glow.at(effect.wx,0,effect.wz);
  smoke.at(effect.wx,0,effect.wz);
  const fade = 1-age/life, drift = fire === blue ? -1 : 1;
  for (const {x,z,seed} of sectors) {
    const r = radius+age*(1+seed*2);
    smoke.particle(x*r,.6+age*(1.7+seed),z*r,(1+age)*(1+seed)*Math.sqrt(fade),[.32,.29,.31]);
    const trail = drift*age*(2+seed);
    smoke.particle(x*r+z*trail,.7+age*(2.8+seed),z*r-x*trail,(1+age*.8)*(1+seed)*Math.sqrt(fade),[.44,.39,.37]);
    if (age >= 1.4) continue;
    const sparkRadius = radius + age*(3+seed*3);
    glow.particle(x*sparkRadius+z*trail,.22+Math.max(0,age*(5+seed*2-age*5)),z*sparkRadius-x*trail,.36*(1-age/1.4),fire.light);
  }
}
