import {darkHumorState} from './dark-humor.js';
export class RaceAudio {
  enabled=true;
  async unlock(){
    if(!this.enabled)return;
    if(!this.context){
      const c=this.context=new AudioContext({latencyHint:'interactive'});
      this.master=c.createGain();this.master.gain.value=.4;
      const limiter=c.createDynamicsCompressor();limiter.threshold.value=-10;limiter.knee.value=8;limiter.ratio.value=8;limiter.attack.value=.003;limiter.release.value=.18;this.master.connect(limiter).connect(c.destination);
      this.effects=c.createGain();this.effects.gain.value=.85;this.effects.connect(this.master);
      const reverb=c.createConvolver(),impulse=c.createBuffer(2,c.sampleRate*.8,c.sampleRate);
      for(let ch=0;ch<2;ch++){const data=impulse.getChannelData(ch);for(let i=0;i<data.length;i++)data[i]=(Math.random()*2-1)*Math.pow(1-i/data.length,3)*.3;}
      reverb.buffer=impulse;const wet=c.createGain();wet.gain.value=.16;this.effects.connect(reverb).connect(wet).connect(this.master);
      const filter=c.createBiquadFilter();filter.type='lowpass';filter.frequency.value=180;filter.Q.value=.5;filter.connect(this.master);
      this.engineGain=c.createGain();this.engineGain.gain.value=0;this.engineGain.connect(filter);
      this.engine=c.createOscillator();this.engine.type='triangle';this.engine.frequency.value=28;this.engine.connect(this.engineGain);this.engine.start();
      this.harmonic=c.createOscillator();this.harmonic.type='sine';this.harmonic.frequency.value=56;this.harmonic.connect(this.engineGain);this.harmonic.start();
      this.noise=c.createBuffer(1,c.sampleRate*2,c.sampleRate);const data=this.noise.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=Math.random()*2-1;
      const source=c.createBufferSource();source.buffer=this.noise;source.loop=true;
      const skidFilter=c.createBiquadFilter();skidFilter.type='bandpass';skidFilter.frequency.value=1800;skidFilter.Q.value=2;
      this.skidGain=c.createGain();this.skidGain.gain.value=0;source.connect(skidFilter).connect(this.skidGain).connect(this.master);source.start();
      const jetFilter=c.createBiquadFilter();jetFilter.type='lowpass';jetFilter.frequency.value=850;this.jetGain=c.createGain();this.jetGain.gain.value=0;source.connect(jetFilter).connect(this.jetGain).connect(this.master);
      // One persistent, low-pitched rotor layer; its gain follows the power-up.
      const rotorFilter=c.createBiquadFilter();rotorFilter.type='lowpass';rotorFilter.frequency.value=480;
      const rotorPulse=c.createGain(),modulation=c.createGain();rotorPulse.gain.value=.65;modulation.gain.value=.25;
      this.vulcanGain=c.createGain();this.vulcanGain.gain.value=0;rotorFilter.connect(rotorPulse).connect(this.vulcanGain).connect(this.master);
      this.vulcanRotor=c.createOscillator();this.vulcanRotor.type='triangle';this.vulcanRotor.frequency.value=94;this.vulcanRotor.connect(rotorFilter);this.vulcanRotor.start();
      this.vulcanBass=c.createOscillator();this.vulcanBass.type='sine';this.vulcanBass.frequency.value=47;this.vulcanBass.connect(rotorFilter);this.vulcanBass.start();
      this.vulcanPulse=c.createOscillator();this.vulcanPulse.type='square';this.vulcanPulse.frequency.value=12;this.vulcanPulse.connect(modulation).connect(rotorPulse.gain);this.vulcanPulse.start();
    }
    await this.context.resume();this.master.gain.setTargetAtTime(this.enabled?.4:0,this.context.currentTime,.03);
  }
  toggle(){this.enabled=!this.enabled;if(this.context)this.master.gain.setTargetAtTime(this.enabled?.4:0,this.context.currentTime,.03);if(this.enabled)this.unlock();}
  tone(frequency,duration=.15,type='square',end=frequency){
    this.note(frequency,duration,{type,end});
  }
  note(frequency,duration,{type='triangle',end=frequency,delay=0,volume=.2}={}){
    if(!this.context||!this.enabled)return;const c=this.context,t=c.currentTime+delay,o=c.createOscillator(),g=c.createGain();
    o.type=type;o.frequency.setValueAtTime(frequency,t);o.frequency.exponentialRampToValueAtTime(Math.max(20,end),t+duration);
    g.gain.setValueAtTime(.001,t);g.gain.linearRampToValueAtTime(volume,t+.008);g.gain.exponentialRampToValueAtTime(.001,t+duration);
    o.connect(g).connect(this.effects);o.start(t);o.stop(t+duration+.01);o.onended=()=>{o.disconnect();g.disconnect();};
  }
  burst(duration=.25,frequency=500,volume=.5,delay=0,end=frequency){
    if(!this.context||!this.enabled)return;const c=this.context,t=c.currentTime+delay,s=c.createBufferSource(),f=c.createBiquadFilter(),g=c.createGain();
    s.buffer=this.noise;f.type='lowpass';f.frequency.setValueAtTime(frequency,t);f.frequency.exponentialRampToValueAtTime(Math.max(50,end),t+duration);
    g.gain.setValueAtTime(.001,t);g.gain.linearRampToValueAtTime(volume,t+.006);g.gain.exponentialRampToValueAtTime(.001,t+duration);
    s.connect(f).connect(g).connect(this.effects);s.start(t);s.stop(t+duration+.01);s.onended=()=>{s.disconnect();f.disconnect();g.disconnect();};
  }
  fanfare(){
    for(const [delay,pitch] of [[0,392],[.16,523.25],[.32,659.25],[.55,783.99]]){
      this.note(pitch,.38,{delay,volume:.28});this.note(pitch/2,.4,{delay,volume:.12,type:'sine'});
    }
    for(const pitch of [261.63,329.63,392,523.25])this.note(pitch,1.3,{delay:.85,volume:.15});
    for(const delay of [0,.32,.55,.85]){this.note(125,.2,{delay,type:'sine',end:42,volume:.5});this.burst(.12,2200,.2,delay);}
    this.burst(.9,6500,.25,.85,800);
  }
  voice({driver,cue,pan=0,volume=1}){
    if(!this.context||!this.enabled)return false;
    // Synthesized cartoon calls, including a trumpet, chirps and a human hum.
    const profiles=[{pitch:460,formant:1150,wobble:9,depth:14},{pitch:610,formant:1550,wobble:28,depth:35},{pitch:780,formant:1900,wobble:13,depth:22},{pitch:205,formant:660,wobble:7,depth:9},{pitch:125,formant:720,wobble:6,depth:24},{pitch:1450,formant:3400,wobble:52,depth:90},{pitch:165,formant:1050,wobble:4,depth:3},{pitch:240,formant:820,wobble:3,depth:7},{pitch:920,formant:2100,wobble:17,depth:30},{pitch:720,formant:1700,wobble:6,depth:18},{pitch:135,formant:760,wobble:3,depth:5},{pitch:115,formant:580,wobble:8,depth:16},{pitch:840,formant:1950,wobble:5,depth:12},{pitch:1050,formant:2400,wobble:17,depth:24},{pitch:185,formant:900,wobble:5,depth:9}];
    const profile=profiles[driver];if(!profile)return false;
    const patterns={laugh:[[0,.14,1.25,.75],[.18,.13,1.15,.65],[.36,.19,1.4,.6]],pass:[[0,.14,1,1.25],[.17,.16,1.15,.95]],hurt:[[0,.24,1.5,.65]],cheer:[[0,.13,.9,1.3],[.16,.2,1.1,1.45]],lap:[[0,.16,.9,1.1],[.2,.2,1.15,1.4]],win:[[0,.16,1,1.3],[.2,.17,1.2,1.5],[.43,.32,1.35,1.05]]};
    const pattern=patterns[cue];if(!pattern)return false;
    const c=this.context,important=cue==='win'||cue==='lap'||cue==='laugh';
    if(!important&&(this.voiceUntil??0)-c.currentTime>.35)return false;
    const start=important?c.currentTime+.04:Math.max(c.currentTime,this.voiceUntil??0);
    this.voiceUntil=start+(important?.55:.14);
    for(const [delay,duration,from,to] of pattern){
      const t=start+delay,source=c.createOscillator(),body=c.createOscillator(),vibrato=c.createOscillator(),depth=c.createGain();
      const first=c.createBiquadFilter(),second=c.createBiquadFilter(),soften=c.createBiquadFilter(),envelope=c.createGain(),bodyGain=c.createGain(),panner=c.createStereoPanner();
      source.type='sawtooth';body.type='sine';vibrato.type='sine';vibrato.frequency.value=profile.wobble;depth.gain.value=profile.depth;
      source.frequency.setValueAtTime(profile.pitch*from,t);source.frequency.exponentialRampToValueAtTime(profile.pitch*to,t+duration*.75);
      body.frequency.setValueAtTime(profile.pitch*from/2,t);body.frequency.exponentialRampToValueAtTime(profile.pitch*to/2,t+duration*.75);
      first.type=second.type='bandpass';first.frequency.setValueAtTime(profile.formant*.85,t);first.frequency.linearRampToValueAtTime(profile.formant*1.15,t+duration);first.Q.value=1.8;second.frequency.value=profile.formant*2.1;second.Q.value=2.5;
      soften.type='lowpass';soften.frequency.value=3000;bodyGain.gain.value=.28;panner.pan.value=Math.max(-1,Math.min(1,pan));
      envelope.gain.setValueAtTime(.001,t);envelope.gain.linearRampToValueAtTime(.45*volume,t+.018);envelope.gain.setValueAtTime(.45*volume,t+duration*.5);envelope.gain.exponentialRampToValueAtTime(.001,t+duration);
      vibrato.connect(depth).connect(source.frequency);source.connect(first).connect(soften);source.connect(second).connect(soften);body.connect(bodyGain).connect(soften);soften.connect(envelope).connect(panner).connect(this.effects);
      for(const oscillator of [source,body,vibrato]){oscillator.start(t);oscillator.stop(t+duration+.015);}
      source.onended=()=>{for(const node of [source,body,vibrato,depth,first,second,soften,envelope,bodyGain,panner])node.disconnect();};
    }
    return true;
  }
  event(type){switch(type){
    case 'chaff':this.note(110,.15,{type:'sine',end:45,volume:.4});this.burst(.8,5500,.45,0,900);this.note(880,.2,{type:'sine',end:330,volume:.12,delay:.08});break;
    case 'chaffDivert':this.note(1200,.22,{type:'triangle',end:160,volume:.18});this.burst(.22,3000,.24,0,500);this.note(660,.12,{type:'sine',end:990,volume:.2,delay:.1});this.note(990,.2,{type:'sine',end:1320,volume:.16,delay:.19});break;
    case 'crash':this.note(145,.24,{type:'sine',end:35,volume:.7});this.burst(.2,1800,.75,0,200);this.note(290,.12,{end:100,volume:.12});break;
    case 'fire':this.note(180,.19,{type:'sine',end:45,volume:.65});this.burst(.09,2600,.5,0,400);this.note(850,.16,{end:260,volume:.13});break;
    case 'vulcanFire':this.note(135,.065,{type:'sine',end:48,volume:.3});this.burst(.045,2100,.22,0,500);break;
    case 'vulcanReady':for(const [i,f] of [220,330,440,660].entries())this.note(f,.2,{delay:i*.07,type:'sine',volume:.2});this.note(55,.5,{type:'sine',end:110,volume:.35});this.burst(.3,350,.25,0,1800);break;
    case 'vulcanWarning':this.note(330,.12,{type:'sine',end:220,volume:.2});break;
    case 'vulcanEnd':this.note(140,.5,{type:'sine',end:35,volume:.3});this.burst(.3,600,.15,0,90);break;
    case 'hit':this.note(100,.38,{type:'sine',end:28,volume:.8});this.burst(.4,3200,.8,0,180);this.note(740,.16,{delay:.06,volume:.18});this.note(988,.3,{delay:.17,volume:.18});break;
    case 'pickup':for(const [i,f] of [523.25,659.25,1046.5].entries())this.note(f,.22,{delay:i*.065,type:'sine',volume:.3});break;
    case 'boost':this.note(70,.45,{type:'sine',end:155,volume:.5});this.burst(.7,300,.55,0,2200);this.note(196,.5,{end:392,volume:.16});this.note(294,.5,{end:588,volume:.1,delay:.05});break;
    case 'driftCharge':this.note(392,.16,{type:'sine',end:588,volume:.16});this.note(784,.18,{delay:.08,volume:.1});break;
    case 'driftChargeMax':this.note(588,.2,{type:'sine',end:880,volume:.18});this.note(1175,.2,{delay:.09,volume:.1});break;
    case 'missile':this.burst(.7,600,.65,0,2400);this.note(95,.3,{type:'sine',end:40,volume:.6});this.note(240,.4,{end:900,volume:.14});break;
    case 'bombDrop':this.note(1100,.8,{type:'sine',end:100,volume:.2});this.burst(.6,2000,.12,0,400);break;
    case 'ash':this.burst(.55,1800,.18,0,500);break;
    case 'bombExplosion':this.note(65,1.5,{type:'sine',end:18,volume:1});this.burst(2,2200,.9,0,70);this.burst(.8,5000,.5,.08,200);break;
    case 'stinkBurst':this.note(95,.3,{type:'sawtooth',end:35,volume:.16});this.burst(.8,900,.2,0,160);break;
    case 'dizzy':this.note(620,.35,{type:'triangle',end:180,volume:.12});this.note(400,.45,{type:'sine',end:650,volume:.1,delay:.15});break;
    case 'explosion':this.note(85,.8,{type:'sine',end:22,volume:1});this.burst(1.3,3500,.9,0,90);this.burst(.5,5500,.45,.09,300);this.note(160,.2,{end:38,volume:.4});break;
    case 'respawn':this.note(330,.3,{type:'sine',end:660,volume:.1});break;
    case 'victory':this.fanfare();break;
    case 'finish':for(const [i,f] of [392,493.88,587.33].entries())this.note(f,.4,{delay:i*.12,volume:.2});break;
  }}
  stopTimeWarp(){
    const music=this.warpMusic;if(!music)return;this.warpMusic=null;
    const t=this.context.currentTime;music.gain.gain.cancelScheduledValues(t);music.gain.gain.setTargetAtTime(0,t,.06);
    for(const node of music.sources)node.stop(t+.3);
  }
  timeWarp(seconds){
    if(!this.context||!this.enabled)return;
    this.stopTimeWarp();const c=this.context,t=c.currentTime,duration=Math.min(2.5,Math.max(.1,seconds)),end=t+duration;
    const gain=c.createGain(),filter=c.createBiquadFilter(),pan=c.createStereoPanner(),echo=c.createDelay(.5),feedback=c.createGain();
    gain.gain.setValueAtTime(.001,t);gain.gain.linearRampToValueAtTime(.65,t+.12);gain.gain.setTargetAtTime(.001,end-.15,.08);
    filter.type='lowpass';filter.Q.value=4;filter.frequency.setValueAtTime(4500,t);filter.frequency.exponentialRampToValueAtTime(480,t+duration*.6);filter.frequency.exponentialRampToValueAtTime(6000,end);
    echo.delayTime.setValueAtTime(.17,t);echo.delayTime.linearRampToValueAtTime(.29,end);feedback.gain.value=.28;
    gain.connect(filter).connect(pan).connect(this.effects);pan.connect(echo).connect(feedback).connect(echo);echo.connect(this.effects);
    const sources=[],nodes=[gain,filter,pan,echo,feedback],add=(frequency,when,length,volume,target)=>{const o=c.createOscillator(),g=c.createGain();o.type='sine';o.frequency.setValueAtTime(frequency,when);o.frequency.exponentialRampToValueAtTime(target,when+length);g.gain.setValueAtTime(.001,when);g.gain.linearRampToValueAtTime(volume,when+.025);g.gain.exponentialRampToValueAtTime(.001,when+length);o.connect(g).connect(gain);o.start(when);o.stop(when+length+.02);sources.push(o);nodes.push(o,g);return o;};
    const lfo=c.createOscillator(),depth=c.createGain();lfo.frequency.setValueAtTime(.6,t);lfo.frequency.exponentialRampToValueAtTime(7,end);depth.gain.value=.85;lfo.connect(depth).connect(pan.pan);lfo.start(t);lfo.stop(end+.4);sources.push(lfo);nodes.push(lfo,depth);
    for(const [i,note]of [110,164.81,233.08].entries()){const drone=add(note*4,t,duration,.09,note);const bend=c.createOscillator(),amount=c.createGain();bend.frequency.value=2+i*.7;amount.gain.value=45;bend.connect(amount).connect(drone.detune);bend.start(t);bend.stop(end+.05);sources.push(bend);nodes.push(bend,amount);}
    const scale=[220,277.18,311.13,440,466.16,622.25];for(let i=0;i* .12<duration-.2;i++){const f=scale[i%6]*2**(i%3);add(f,t+i*.12,.24,.09,f*(i%2?.5:2));}
    lfo.onended=()=>{for(const node of nodes)node.disconnect();if(this.warpMusic?.gain===gain)this.warpMusic=null;};
    this.warpMusic={gain,sources};
  }
  update(r){
    if(!this.context)return;
    const dark=darkHumorState(r),laughBeat=Math.floor(r.elapsed/.62);
    if(this.enabled&&dark.strength>0&&this.darkLaughBeat!==laughBeat){
      this.voice({driver:14,cue:'laugh',pan:Math.sin(laughBeat*1.7)*.75,volume:.6});
    }
    this.darkLaughBeat=this.enabled&&dark.strength>0?laughBeat:null;
    const xylophone=this.enabled&&r.phase==='racing'&&r.specialAbilities!==false&&[r,...(r.bots??[])].some(a=>a.driver===13&&a.specialActive>0);
    const xyBeat=Math.floor(r.elapsed*8);
    if(xylophone&&this.xylophoneBeat!==xyBeat){const notes=[1046.5,1318.51,1174.66,1567.98,1396.91,1174.66,1760,1108.73],f=notes[xyBeat%notes.length];this.note(f,.16,{type:'sine',volume:.12});this.note(f*3,.07,{type:'sine',volume:.035});this.note(f*4,.035,{type:'sine',volume:.012});}
    this.xylophoneBeat=xylophone?xyBeat:null;
    const hearts=new Set();for(const fx of r.effects??[]){if(fx.type!=='heartbeat')continue;hearts.add(fx.owner);if(this.heartbeatSeen?.has(fx.owner))continue;this.note(78,.14,{type:'sine',end:42,volume:.24});this.note(66,.16,{type:'sine',end:38,delay:.18,volume:.19});this.note(523.25,.35,{type:'sine',delay:.04,volume:.025});}this.heartbeatSeen=hearts;
    const fashion=new Map();for(const a of [r,...(r.bots??[])]){if(a.driver!==9||!(a.specialActive>0)||r.specialAbilities===false)continue;fashion.set(a.id,a.specialActive);if((this.fashionSeen?.get(a.id)??0)>=a.specialActive)continue;this.burst(.07,4200,.2,0,1600);for(const [i,n]of [880,1108.73,1318.51,1760].entries())this.note(n,.35,{type:'sine',delay:.06+i*.055,volume:.045});}this.fashionSeen=fashion;
    const warp=this.enabled&&r.phase==='racing'?(r.timeStop??0):0;
    if(warp>0&&(!(this.previousWarp>0)||warp>this.previousWarp+.3))this.timeWarp(warp);
    if(warp<=0&&this.previousWarp>0){this.stopTimeWarp();if(this.enabled&&r.phase==='racing'){this.note(440,.45,{type:'sine',end:880,volume:.12});this.note(660,.6,{type:'sine',volume:.08});}}
    this.previousWarp=warp;
    const c=this.context,t=c.currentTime,active=r.phase==='racing';this.engineGain.gain.setTargetAtTime(active&&!r.bomber?.09:0,t,.03);const rpm=28+r.speed*.045+Math.sin(r.elapsed*18)*.6;this.engine.frequency.setTargetAtTime(rpm,t,.03);this.harmonic.frequency.setTargetAtTime(rpm*2,t,.03);this.skidGain.gain.setTargetAtTime(active&&r.wasDrifting?.07:0,t,.02);this.jetGain.gain.setTargetAtTime(active&&(r.boost>0||r.somersault>0)?.18:0,t,.025);
    const remaining=r.vulcan??0,powered=this.enabled&&active&&remaining>0&&!r.destroyed&&r.finishCountdown==null,firing=powered&&r.item==='hedgehog'&&r.fireCooldown>0;
    this.vulcanGain.gain.setTargetAtTime(powered?.18:0,t,.07);this.vulcanRotor.frequency.setTargetAtTime(firing?130:94,t,.1);this.vulcanBass.frequency.setTargetAtTime(firing?65:47,t,.1);this.vulcanPulse.frequency.setTargetAtTime(firing?24:12,t,.1);
    const warning=Math.ceil(remaining);
    if(powered&&warning<=3&&warning!==this.vulcanWarning){this.event('vulcanWarning');this.vulcanWarning=warning;}
    if(remaining>3||remaining<=0)this.vulcanWarning=0;
    if(active&&(this.previousVulcan??0)>0&&remaining<=0)this.event('vulcanEnd');
    this.previousVulcan=remaining;
  }
}
