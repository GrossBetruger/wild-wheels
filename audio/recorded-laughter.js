// Local CC0 recordings; provenance is documented in docs/audio-credits.md.
const clips=['../assets/audio/dark-humor-crowd.ogg','../assets/audio/dark-humor-solo.flac'];
export class RecordedLaughter{
  constructor(context,destination){this.context=context;this.destination=destination;this.active=null;}
  load(){
    this.loading??=Promise.all(clips.map(async path=>{const response=await fetch(new URL(path,import.meta.url));if(!response.ok)throw Error('Unable to load Dark Humor recording');return this.context.decodeAudioData(await response.arrayBuffer());})).then(buffers=>{this.buffers=buffers;}).catch(error=>{this.loadError=error.message;});
    return this.loading;
  }
  stop(){
    const group=this.active;if(!group)return;this.active=null;
    const t=this.context.currentTime;group.gain.gain.cancelScheduledValues(t);group.gain.gain.setTargetAtTime(.0001,t,.025);
    for(const source of group.sources)try{source.stop(t+.12);}catch{}
  }
  update(remaining,enabled){
    if(!enabled||remaining<=0){this.stop();return;}
    if(!this.buffers)return;
    const c=this.context,t=c.currentTime;
    if(this.active&&Math.abs(this.active.until-(t+remaining))<.4)return;
    this.stop();const gain=c.createGain();gain.gain.setValueAtTime(.001,t);gain.gain.linearRampToValueAtTime(.85,t+.12);gain.connect(this.destination);
    const group={gain,sources:[],until:t+remaining};this.active=group;const elapsed=Math.max(0,7-remaining);
    const play=(buffer,start,offset,rate,pan,volume)=>{
      const when=t+Math.max(0,start-elapsed),skipped=Math.max(0,elapsed-start),seek=offset+skipped*rate;
      const duration=Math.min((buffer.duration-seek)/rate,group.until-when);if(duration<=.02)return;
      const source=c.createBufferSource(),envelope=c.createGain(),panner=c.createStereoPanner();source.buffer=buffer;source.playbackRate.value=rate;panner.pan.value=pan;
      envelope.gain.setValueAtTime(.001,when);envelope.gain.linearRampToValueAtTime(volume,when+Math.min(.07,duration/4));envelope.gain.setValueAtTime(volume,when+Math.max(.07,duration-.2));envelope.gain.linearRampToValueAtTime(.001,when+duration);
      source.connect(envelope).connect(panner).connect(gain);group.sources.push(source);source.start(when,seek);source.stop(when+duration);
      source.onended=()=>{source.disconnect();envelope.disconnect();panner.disconnect();group.sources=group.sources.filter(s=>s!==source);if(!group.sources.length){gain.disconnect();if(this.active===group)this.active=null;}};
    };
    play(this.buffers[0],0,1.6,1,0,.35);
    for(const [start,rate,pan,volume]of [[.15,.97,-.72,.3],[1.8,1.04,.7,.24],[3.6,1,.25,.26],[5.1,1.03,-.4,.23]])play(this.buffers[1],start,0,rate,pan,volume);
  }
}
