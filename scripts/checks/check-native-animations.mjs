// Watches two native animations play live, in isolation, and checks each one's
// transition really runs: `npm run test:native-animations` (macOS, needs a display).
// The native client's showcase mode cycles a racer through a state change with no
// server; screenshots at fixed moments are compared pixel by pixel.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {existsSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

const binary=resolve(process.env.NATIVE_CLIENT??'native-client/target/release/wild-wheels-native');

function front(pid){
  try{execFileSync('osascript',['-e',`tell application "System Events" to set frontmost of (first process whose unix id is ${pid}) to true`],{stdio:'ignore'});}catch{}
}
// Runs a showcase with its window in front and returns the screenshot directory.
async function showcase(scene){
  assert.ok(existsSync(binary),`Build the native client first: cargo build --release --manifest-path native-client/Cargo.toml (looked for ${binary})`);
  const directory=mkdtempSync(join(tmpdir(),`wild-wheels-${scene}-`));
  const child=spawn(binary,['--showcase',scene,'--capture',directory,'--seconds','40'],{env:{...process.env,WILD_WHEELS_NATIVE_DATA_DIR:directory},stdio:['ignore','ignore','pipe']});
  let errors='';child.stderr.on('data',chunk=>{errors=(errors+chunk).slice(-4000);});
  // macOS returns black frames for covered windows; keep the showcase in front.
  const keeper=setInterval(()=>front(child.pid),1500);
  const code=await new Promise(done=>child.on('exit',done));
  clearInterval(keeper);
  assert.equal(code,0,errors);
  return directory;
}
// Decoded pixels of a screenshot, through macOS's image tool.
function pixels(file){
  const bmp=`${file}.bmp`;execFileSync('sips',['-s','format','bmp',file,'--out',bmp],{stdio:'ignore'});
  const data=readFileSync(bmp),offset=data.readUInt32LE(10),width=data.readInt32LE(18),height=Math.abs(data.readInt32LE(22)),depth=data.readUInt16LE(28)/8;
  return {data,offset,width,height,depth,row:Math.ceil(width*depth/4)*4};
}
// The share of pixels whose color changed noticeably between two screenshots.
function difference(a,b){
  const [x,y]=[pixels(a),pixels(b)];
  assert.deepEqual([x.width,x.height],[y.width,y.height]);
  let changed=0;
  for(let r=0;r<x.height;r++)for(let c=0;c<x.width;c++){
    const i=x.offset+r*x.row+c*x.depth,j=y.offset+r*y.row+c*y.depth;
    if(Math.abs(x.data[i]-y.data[j])+Math.abs(x.data[i+1]-y.data[j+1])+Math.abs(x.data[i+2]-y.data[j+2])>36)changed++;
  }
  return changed/(x.width*x.height);
}
function checkTransition(directory,scene){
  const shot=label=>{const file=join(directory,`${label}.png`);assert.ok(existsSync(file),`${scene}: no ${label} screenshot; was the window covered?`);return file;};
  const [a,b,mid,after]=['steady-a','steady-b','transition','changed'].map(shot);
  // Idle animation alone changes some pixels; a state change must change far more.
  const noise=difference(a,b),change=difference(a,after),fromStart=difference(a,mid),toEnd=difference(mid,after);
  console.log(JSON.stringify({scene,noise,change,transitionFromStart:fromStart,transitionToEnd:toEnd}));
  assert.ok(change>Math.max(3*noise,.003),`${scene}: the state change is not visible (${change} vs idle noise ${noise})`);
  assert.ok(fromStart>Math.max(1.5*noise,.002),`${scene}: the transition looks like the starting state`);
  assert.ok(toEnd>Math.max(1.5*noise,.002),`${scene}: the transition looks like the final state`);
}

test('Pearococo boosts in and out: her tail folds through a recorded transition',async()=>{
  const directory=await showcase('boost');
  try{checkTransition(directory,'boost');}finally{rmSync(directory,{recursive:true,force:true});}
});

test('KnowItOwl calls rapid fire: the bat flies in and away',async()=>{
  const directory=await showcase('rapid-fire');
  try{checkTransition(directory,'rapid-fire');}finally{rmSync(directory,{recursive:true,force:true});}
});
