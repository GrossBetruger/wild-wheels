// Measure the lavender upper wings in the race camera. Translation, hovering,
// particles and HUD changes cannot make a stationary pair grow wider.
async function wingSpan(png) {
  const img = new Image();
  img.src = 'data:image/png;base64,' + png;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const {data} = ctx.getImageData(0, 0, img.width, img.height);
  let left = img.width, right = -1;
  for (let i = 0; i < data.length; i += 4) {
    const [r,g,b] = data.subarray(i, i+3);
    if (b <= r+8 || r <= g+7 || g <= 55) continue;
    const x = i/4 % img.width;
    left = Math.min(left,x);
    right = Math.max(right,x);
  }
  return right-left+1;
}

export async function checkCatheterpillarWings(evaluate, capture, sleep) {
  for (let i=0; i<450; i++) {
    if (await evaluate("Boolean(document.querySelector('.viewport.bevy-active'))")) break;
    await sleep(100);
  }
  await evaluate(`(()=>{
    const race=__game.race;
    Object.assign(race,{driver:12,phase:'racing',wx:0,wz:25,heading:0,cameraHeading:0});
    for (const bot of race.bots) bot.inactive=true;
  })()`);
  await sleep(1800);
  const clip = await evaluate(`(()=>{
    const rect=document.querySelector('.viewport.bevy-active').getBoundingClientRect();
    return {x:scrollX+rect.x+rect.width*.39,y:scrollY+rect.y+rect.height*.45,
      width:rect.width*.22,height:rect.height*.14,scale:1};
  })()`);
  const states = [];
  for (const state of ['cruise','boost','special']) {
    await evaluate(`Object.assign(__game.race,{boost:${state==='boost'?20:0},specialActive:${state==='special'?20:0}})&&true`);
    await sleep(350);
    const spans = [];
    for (let frame=0; frame<24; frame++) {
      const png = await capture(clip);
      spans.push(await evaluate(`(${wingSpan})(${JSON.stringify(png)})`));
      await sleep(17 + frame%5*7);
    }
    const visible = spans.filter(x=>x>0).sort((a,b)=>a-b);
    const narrow=visible[2], wide=visible.at(-3);
    states.push({state,narrow,wide,pass:visible.length>=20 && wide>=narrow*1.15});
  }
  return {states,pass:states.every(state=>state.pass)};
}
