import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSoundPack,SOUND_PACK_VERSION,SAMPLE_RATE} from '../../scripts/build/sound-port.mjs';

// Minimal reader for the layout documented in docs/native-sound-port.md.
function read(pack){
  let at=16;const sounds=new Map();
  for(let i=pack.readUInt32LE(12);i>0;i--){
    const size=pack.readUInt16LE(at),name=pack.toString('utf8',at+2,at+2+size);at+=2+size;
    const count=pack.readUInt32LE(at);at+=4;
    sounds.set(name,new Int16Array(pack.buffer.slice(pack.byteOffset+at,pack.byteOffset+at+count*2)));at+=count*2;
  }
  return {sounds,end:at};
}
const peak=samples=>samples.reduce((most,value)=>Math.max(most,Math.abs(value)),0)/32767;

test('the browser audio engine ports to a native sound pack',async()=>{
  const random=Math.random,pack=await buildSoundPack({only:[0]}),{sounds,end}=read(pack);
  assert.equal(pack.toString('latin1',0,4),'WWSP');assert.equal(pack.readUInt32LE(4),SOUND_PACK_VERSION);assert.equal(pack.readUInt32LE(8),SAMPLE_RATE);
  assert.equal(end,pack.length);
  // Noise is seeded for reproducible packs, and the game's own randomness is restored.
  assert.equal(Math.random,random);
  // Every case of the browser's event switch is rendered, and none is silent.
  for(const name of ['event:fire','event:explosion','event:pickup','event:victory','voice:0:win','cue:countdown:3','cue:go','cue:xylophone:7','cue:heartbeat','cue:timeWarp','loop:engine','loop:skid','loop:jet','loop:vulcan','loop:vulcan:firing']){
    assert.ok(sounds.has(name),name);assert.ok(peak(sounds.get(name))>.01,name);
  }
  // Dark Humor's recorded laughter is mixed where the system can decode it.
  if(process.platform==='darwin'){assert.ok(peak(sounds.get('cue:darkLaughter'))>.05);assert.ok(sounds.get('cue:darkLaughter').length>6*SAMPLE_RATE);}
  // An explosion is louder and longer than a rapid-fire shot, as in the browser.
  assert.ok(peak(sounds.get('event:explosion'))>peak(sounds.get('event:vulcanFire'))*3);
  assert.ok(sounds.get('event:explosion').length>sounds.get('event:vulcanFire').length*5);
  // Loops last a whole number of engine periods and hold only their own layer.
  assert.equal(sounds.get('loop:engine').length,2*SAMPLE_RATE);
  assert.ok(peak(sounds.get('loop:skid'))<peak(sounds.get('loop:engine')));
});
