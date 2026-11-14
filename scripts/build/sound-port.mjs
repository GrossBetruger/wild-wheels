// Ports the browser client's synthesized sounds to the native Rust client.
//
// The unmodified `RaceAudio` runs in Node against a small offline Web Audio
// implementation, and every cue it schedules is rendered to PCM for the native
// client to play back. See docs/native-sound-port.md for the format and its limits.
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {RaceAudio} from '../../audio/audio.js';
import {createBattle} from '../../gameplay/combat.js';
import {drivers} from '../../gameplay/engine.js';

export const SOUND_PACK_VERSION=1;
export const SAMPLE_RATE=32000;
const TAIL=.25,LOOP=2,SETTLE=1;

// Automation of one audio parameter, as much of the Web Audio rules as the game uses.
class Param {
  events=[];inputs=[];
  constructor(value){this.default=value;}
  get value(){return this.default;}
  set value(value){this.default=value;}
  add(event){this.events.push(event);this.events.sort((a,b)=>a.time-b.time);return this;}
  setValueAtTime(value,time){return this.add({kind:'set',value,time});}
  linearRampToValueAtTime(value,time){return this.add({kind:'linear',value,time});}
  exponentialRampToValueAtTime(value,time){return this.add({kind:'exponential',value,time});}
  setTargetAtTime(value,time,constant){return this.add({kind:'target',value,time,constant});}
  cancelScheduledValues(time){this.events=this.events.filter(event=>event.time<time);return this;}
  at(time,n){
    // `held` is the value when the last passed event began; a target then decays from it.
    let held=this.default,since=0,decay=null;
    const now=at=>decay?decay.value+(held-decay.value)*Math.exp(-(at-since)/decay.constant):held;
    let result=null;
    for(const event of this.events){
      if(event.kind==='linear'||event.kind==='exponential'){
        if(time<event.time){
          const from=now(since),span=event.time-since,t=span>0?(time-since)/span:1;
          result=event.kind==='linear'||from<=0||event.value<=0?from+(event.value-from)*t:from*(event.value/from)**t;break;
        }
        held=event.value;since=event.time;decay=null;continue;
      }
      if(time<event.time)break;
      held=event.kind==='target'?now(event.time):event.value;since=event.time;decay=event.kind==='target'?event:null;
    }
    result??=now(time);
    for(const input of this.inputs)result+=input.sample(n);
    return result;
  }
}
class Node {
  inputs=[];last=-1;value=0;
  constructor(context){this.context=context;context.nodes.push(this);}
  connect(target){(target instanceof Param?target.inputs:target.inputs).push(this);return target;}
  disconnect(){}
  input(n){let sum=0;for(const node of this.inputs)sum+=node.sample(n);return sum;}
  sample(n){if(n!==this.last){this.last=n;this.value=this.process(n,n/this.context.sampleRate);}return this.value;}
  process(n){return this.input(n);}
}
class Gain extends Node {
  gain=new Param(1);
  process(n,time){
    // A layer that is switched off and never automated is not worth evaluating.
    if(this.gain.default===0&&!this.gain.events.length&&!this.gain.inputs.length)return 0;
    return this.input(n)*this.gain.at(time,n);
  }
}
class Scheduled extends Node {
  from=Infinity;until=Infinity;
  start(time=0,offset=0){this.from=time;this.offset=offset;}
  stop(time=0){this.until=time;}
  playing(time){return time>=this.from&&time<this.until;}
}
class Oscillator extends Scheduled {
  type='sine';frequency=new Param(440);detune=new Param(0);phase=0;
  process(n,time){
    if(!this.playing(time))return 0;
    const phase=this.phase;
    this.phase=(phase+this.frequency.at(time,n)*2**(this.detune.at(time,n)/1200)/this.context.sampleRate)%1;
    switch(this.type){
      case 'square':return phase<.5?1:-1;
      case 'sawtooth':return 2*((phase+.5)%1)-1;
      case 'triangle':return 1-4*Math.abs((phase+.25)%1-.5);
      default:return Math.sin(phase*2*Math.PI);
    }
  }
}
class BufferSource extends Scheduled {
  buffer=null;loop=false;playbackRate=new Param(1);
  process(n,time){
    if(!this.playing(time)||!this.buffer)return 0;
    const data=this.buffer.getChannelData(0),index=Math.floor(((time-this.from)*this.playbackRate.value+(this.offset??0))*this.context.sampleRate);
    return this.loop?data[index%data.length]:data[index]??0;
  }
}
// The Web Audio biquad: resonance in decibels for low and high pass, plain Q for band pass.
class Biquad extends Node {
  type='lowpass';frequency=new Param(350);Q=new Param(1);x1=0;x2=0;y1=0;y2=0;tuned=null;
  process(n,time){
    const frequency=this.frequency.at(time,n),q=this.Q.at(time,n),key=frequency+':'+q+this.type;
    if(key!==this.tuned){
      this.tuned=key;
      const w=2*Math.PI*Math.min(frequency,this.context.sampleRate*.49)/this.context.sampleRate,cos=Math.cos(w),sin=Math.sin(w);
      const alpha=this.type==='bandpass'?sin/(2*Math.max(q,1e-4)):sin/(2*10**(q/20));
      const b=this.type==='bandpass'?[alpha,0,-alpha]:this.type==='highpass'?[(1+cos)/2,-(1+cos),(1+cos)/2]:[(1-cos)/2,1-cos,(1-cos)/2];
      const a0=1+alpha;this.b=b.map(v=>v/a0);this.a=[-2*cos/a0,(1-alpha)/a0];
    }
    const x=this.input(n),y=this.b[0]*x+this.b[1]*this.x1+this.b[2]*this.x2-this.a[0]*this.y1-this.a[1]*this.y2;
    this.x2=this.x1;this.x1=x;this.y2=this.y1;this.y1=y;
    return y;
  }
}
// A delay reads only its own past, which lets feedback loops be evaluated sample by sample.
class Delay extends Node {
  delayTime=new Param(0);
  constructor(context,maximum=1){super(context);this.line=new Float32Array(Math.ceil(maximum*context.sampleRate)+2);context.delays.push(this);}
  process(n,time){
    const back=Math.max(1,Math.round(this.delayTime.at(time,n)*this.context.sampleRate));
    return n-back<0?0:this.line[(n-back)%this.line.length];
  }
  record(n){this.line[n%this.line.length]=this.input(n);}
}
// The native pack is mono, so panning passes sound through unchanged.
class Panner extends Node {pan=new Param(0);}
// Limiting is replaced by clipping at full scale when samples are written.
class Compressor extends Node {threshold=new Param(0);knee=new Param(0);ratio=new Param(1);attack=new Param(0);release=new Param(0);}
// Reverb is not ported: its impulse response is random and it adds only a faint tail.
class Convolver extends Node {process(){return 0;}}

class OfflineContext {
  sampleRate=SAMPLE_RATE;currentTime=0;nodes=[];delays=[];
  constructor(){this.destination=new Node(this);}
  createGain(){return new Gain(this);}
  createOscillator(){return new Oscillator(this);}
  createBufferSource(){return new BufferSource(this);}
  createBiquadFilter(){return new Biquad(this);}
  createDelay(maximum){return new Delay(this,maximum);}
  createStereoPanner(){return new Panner(this);}
  createDynamicsCompressor(){return new Compressor(this);}
  createConvolver(){return new Convolver(this);}
  createBuffer(channels,length){const data=Array.from({length:channels},()=>new Float32Array(Math.floor(length)));return{length:Math.floor(length),duration:Math.floor(length)/this.sampleRate,getChannelData:channel=>data[channel]};}
  // Recorded clips are decoded to mono at the pack's rate by the system converter.
  async decodeAudioData(bytes){
    const directory=mkdtempSync(join(tmpdir(),'wild-wheels-sound-'));
    try{
      const source=join(directory,'clip'),decoded=join(directory,'clip.wav');writeFileSync(source,Buffer.from(bytes));
      execFileSync('afconvert',['-f','WAVE','-d',`LEI16@${this.sampleRate}`,'-c','1',source,decoded],{stdio:'ignore'});
      const wav=readFileSync(decoded),at=wav.indexOf('data')+8,buffer=this.createBuffer(1,(wav.length-at)/2),samples=buffer.getChannelData(0);
      for(let i=0;i<samples.length;i++)samples[i]=wav.readInt16LE(at+i*2)/32768;
      return buffer;
    }finally{rmSync(directory,{recursive:true,force:true});}
  }
  async resume(){}
  // Renders [from, from+seconds) of everything scheduled so far.
  render(from,seconds){
    const start=Math.round(from*this.sampleRate),out=new Float32Array(Math.round(seconds*this.sampleRate));
    for(let n=this.rendered??0;n<start+out.length;n++){
      const value=this.destination.sample(n);for(const delay of this.delays)delay.record(n);
      if(n>=start)out[n-start]=value;
    }
    this.rendered=start+out.length;
    return out;
  }
}

// The game seeds its noise with Math.random; a fixed sequence keeps packs reproducible.
function seeded(){let state=0x2545f491;return()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return(state>>>0)/4294967296;};}
async function studio(){
  const audio=new RaceAudio();
  await audio.unlock();
  return audio;
}
// The game fetches its recorded clips by URL; here they are read from the repository.
async function localFetch(url){
  if(new URL(url).protocol!=='file:')throw new Error(`Unexpected request while porting sounds: ${url}`);
  const bytes=readFileSync(fileURLToPath(url));
  return {ok:true,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};
}
function world(change={}){
  const r=createBattle(0,0,()=>.5);
  Object.assign(r,{phase:'racing',elapsed:0,speed:0,finishCountdown:null,...change});
  for(const bot of r.bots)bot.inactive=true;
  return r;
}
const trimmed=samples=>{let end=samples.length;while(end>0&&Math.abs(samples[end-1])<1e-4)end--;return samples.subarray(0,Math.min(samples.length,end+Math.round(.01*SAMPLE_RATE)));};
// How long the sounds scheduled so far keep playing.
const scheduled=context=>Math.max(0,...context.nodes.filter(node=>node instanceof Scheduled&&Number.isFinite(node.until)).map(node=>node.until));

// `only` limits the racers whose voices are ported; tests use it to stay fast.
export async function buildSoundPack({only=[...drivers.keys()]}={}){
  const random=Math.random,Context=globalThis.AudioContext,request=globalThis.fetch,sounds=new Map();
  globalThis.AudioContext=OfflineContext;globalThis.fetch=localFetch;Math.random=seeded();
  try{
    // A one-shot: whatever `play` schedules, rendered until its last note ends.
    const cue=async(name,play)=>{
      const audio=await studio();if(play(audio)===false)return;
      sounds.set(name,trimmed(audio.context.render(0,scheduled(audio.context)+TAIL)));
    };
    // A sound driven by game state: the difference between two otherwise equal worlds.
    const difference=async(base,changed,from,seconds,prime)=>{
      const [quiet,loud]=await Promise.all([base,changed].map(async state=>{
        const audio=await studio();prime?.(audio,state===changed);audio.update(state);
        return audio.context.render(from,seconds??scheduled(audio.context)+TAIL-from);
      }));
      return loud.map((value,i)=>value-(quiet[i]??0));
    };
    // Every case of the event switch, so a new event type is ported without a change here.
    for(const [,type] of RaceAudio.prototype.event.toString().matchAll(/case '([A-Za-z]+)'/g))await cue(`event:${type}`,audio=>audio.event(type));
    for(const driver of only)for(const name of ['pass','hurt','cheer','lap','win'])await cue(`voice:${driver}:${name}`,audio=>audio.voice({driver,cue:name}));
    // The countdown and start tones are played by the browser's HUD code.
    for(const count of [1,2,3])await cue(`cue:countdown:${count}`,audio=>audio.tone(300+count*100,.1));
    await cue('cue:go',audio=>audio.tone(850,.3));
    // Continuous layers settle first, then loop over a whole number of their periods.
    sounds.set('loop:engine',await difference(world({phase:'ready'}),world(),SETTLE,LOOP));
    sounds.set('loop:skid',await difference(world(),world({wasDrifting:true}),SETTLE,LOOP));
    sounds.set('loop:jet',await difference(world(),world({boost:1}),SETTLE,LOOP));
    sounds.set('loop:vulcan',await difference(world(),world({vulcan:9,item:'missile'}),SETTLE,LOOP));
    sounds.set('loop:vulcan:firing',await difference(world(),world({vulcan:9,item:'hedgehog',fireCooldown:.1}),SETTLE,LOOP));
    const special=(driver,change={})=>{const r=world(change);Object.assign(r.bots[0],{driver,specialActive:3});return r;};
    for(let beat=0;beat<8;beat++)sounds.set(`cue:xylophone:${beat}`,trimmed(await difference(world({elapsed:beat/8}),special(13,{elapsed:beat/8}),0)));
    sounds.set('cue:heartbeat',trimmed(await difference(world(),world({effects:[{type:'heartbeat',owner:1,wx:0,wz:0,age:0,life:.7}]}),0)));
    sounds.set('cue:fashion',trimmed(await difference(world(),special(9),0)));
    sounds.set('cue:timeWarp',trimmed(await difference(world(),world({timeStop:2.5}),0)));
    sounds.set('cue:timeWarpEnd',trimmed(await difference(world(),world(),0,null,(audio,changed)=>{if(changed)audio.previousWarp=1;})));
    // Dark Humor's laughter mixes recorded clips. It needs macOS's afconvert to
    // decode them and is left out of the pack where that is missing.
    const laughing=await studio();await laughing.laughter.loading;
    laughing.laughter.update(7,true);
    if(scheduled(laughing.context)>0)sounds.set('cue:darkLaughter',trimmed(laughing.context.render(0,scheduled(laughing.context)+TAIL)));
  }finally{globalThis.AudioContext=Context;globalThis.fetch=request;Math.random=random;}

  const names=[...sounds.keys()].sort(),u32=value=>{const b=Buffer.alloc(4);b.writeUInt32LE(value);return b;};
  return Buffer.concat([Buffer.from('WWSP'),u32(SOUND_PACK_VERSION),u32(SAMPLE_RATE),u32(names.length),...names.flatMap(name=>{
    const text=Buffer.from(name),size=Buffer.alloc(2),samples=sounds.get(name),pcm=Buffer.alloc(samples.length*2);size.writeUInt16LE(text.length);
    samples.forEach((value,i)=>pcm.writeInt16LE(Math.round(Math.max(-1,Math.min(1,value))*32767),i*2));
    return[size,text,u32(samples.length),pcm];
  })]);
}
