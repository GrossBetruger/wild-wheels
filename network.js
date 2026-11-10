import { drivers } from './engine.js';
import { NetworkPlayback } from './playback.js';
import { LocalPrediction } from './prediction.js';
import { ActionAudio } from './action-audio.js';
import { decodeSnapshot } from './wire.js';

export function invitationUrl(pageUrl,code,{publicOrigin,lan}={}){
  const page=new URL(pageUrl);
  const origin=['localhost','127.0.0.1'].includes(page.hostname)?publicOrigin??lan??page.origin:page.origin;
  return new URL(`/?room=${encodeURIComponent(code)}`,origin).href;
}

export class NetworkGame {
  token=null;state=null;paused=false;sequence=0;actions=[];playback=new NetworkPlayback();prediction=new LocalPrediction();rtt=0;lastPing=-Infinity;
  constructor({anchor,keys,driver,arena,onState,onLeave,unlock,sound=()=>{}}){
    Object.assign(this,{keys,driver,arena,onState,onLeave,unlock,sound});this.actionAudio=new ActionAudio(sound);
    this.panel=document.createElement('section');this.panel.className='network-panel';this.panel.setAttribute('aria-label','Multiplayer arena lobby');
    const title=document.createElement('strong');title.textContent='PLAY TOGETHER · UP TO 6 PLAYERS';
    this.name=document.createElement('input');this.name.placeholder='Your name';this.name.value='Player';this.name.maxLength=24;this.name.setAttribute('aria-label','Player name');
    this.invitation=new URL(location.href).searchParams.get('room')??'';
    this.botCount=document.createElement('select');this.botCount.setAttribute('aria-label','Number of multiplayer bots');for(let count=0;count<=5;count++){const option=document.createElement('option');option.value=String(count);option.textContent=`${count} BOT${count===1?'':'S'}`;this.botCount.append(option);}this.botCount.value='1';this.botCount.onchange=()=>{if(this.active)this.control('bots',undefined,Number(this.botCount.value));};
    this.animalChoice=document.createElement('select');this.animalChoice.className='hidden';this.animalChoice.setAttribute('aria-label','Your multiplayer animal');for(const [index,animal] of drivers.entries()){const option=document.createElement('option');option.value=String(index);option.textContent=`${animal.emoji} ${animal.name}`;this.animalChoice.append(option);}this.animalChoice.onchange=()=>this.chooseDriver(Number(this.animalChoice.value));
    this.hostButton=this.button('HOST ARENA',()=>this.connect('/api/rooms'));
    this.leaveButton=this.button('LEAVE ROOM',()=>this.leave());this.leaveButton.classList.add('hidden');
    this.status=document.createElement('p');this.status.setAttribute('role','status');this.status.textContent='Host an arena and share the link. Opening it joins the game automatically.';
    this.players=document.createElement('div');this.players.className='network-players';
    this.share=document.createElement('input');this.share.className='hidden';this.share.setAttribute('aria-label','Room invitation link');this.share.addEventListener('input',()=>{this.shareEdited=true;});
    this.internetButton=this.button('START INTERNET LINK',()=>this.startInternetLink());this.internetButton.classList.add('hidden');
    this.copyButton=this.button('COPY INVITE',async()=>{try{await navigator.clipboard.writeText(this.share.value);this.status.textContent='Invitation copied.';}catch{this.share.focus();this.share.select();this.status.textContent='Copy the selected invitation link.';}});this.copyButton.classList.add('hidden');
    const row=document.createElement('div');row.className='network-controls';row.append(this.name,this.animalChoice,this.botCount,this.hostButton,this.leaveButton);
    const invite=document.createElement('div');invite.className='network-invite';invite.append(this.share,this.internetButton,this.copyButton);
    this.help=document.createElement('p');this.help.className='network-help hidden';
    this.panel.append(title,row,this.status,this.players,invite,this.help);anchor.before(this.panel);
    this.refreshInfo();
    this.infoTimer=setInterval(()=>{if(this.active&&this.isHost)this.refreshInfo();},5000);
    this.timer=setInterval(()=>this.input(),1000/30);
    if(this.invitation)queueMicrotask(()=>this.connect('/api/join'));
  }
  get active(){return Boolean(this.token);}
  get isHost(){return this.state?.host===this.state?.you;}
  button(label,action){const button=document.createElement('button');button.type='button';button.textContent=label;button.onclick=action;return button;}
  async refreshInfo(){
    try{
      const response=await fetch('/api/info',{signal:AbortSignal.timeout(2000)});if(!response.ok)return;
      const info=await response.json();this.lan=info.addresses?.[0];this.publicOrigin=info.publicOrigin;this.controlPort=info.controlPort;this.updateShare();
    }catch{}
  }
  updateShare(){
    if(!this.state)return;
    const local=['localhost','127.0.0.1'].includes(location.hostname);
    if(!this.shareEdited)this.share.value=invitationUrl(location.href,this.state.code,{publicOrigin:this.publicOrigin,lan:this.lan});
    this.internetButton.classList.toggle('hidden',!local||!this.isHost||!this.controlPort||Boolean(this.publicOrigin));
    this.help.textContent=this.internetError?'Could not start ngrok. Install it and sign in once, then try again.':location.protocol==='https:'||local&&this.publicOrigin?'Share this HTTPS link with a friend to play over the internet.':local&&this.controlPort?'To play with a friend elsewhere, click START INTERNET LINK, then COPY INVITE.':'Same Wi-Fi: share this link.';
  }
  async startInternetLink(){
    if(!this.active||!this.isHost||!this.controlPort||!['localhost','127.0.0.1'].includes(location.hostname))return;
    this.internetError=false;this.updateShare();
    this.internetButton.disabled=true;this.internetButton.textContent='STARTING…';
    const base=`http://127.0.0.1:${this.controlPort}`;
    try{
      const response=await fetch(`${base}/start`,{method:'POST',signal:AbortSignal.timeout(3000)});
      if(!response.ok)throw new Error();
      for(let attempt=0;attempt<15;attempt++){
        await new Promise(resolve=>setTimeout(resolve,1000));
        if(!this.active||!this.isHost)return;
        await this.refreshInfo();
        if(this.publicOrigin){this.status.textContent='Internet link ready. Copy the invite and send it to a friend.';return;}
        const status=await fetch(`${base}/status`,{signal:AbortSignal.timeout(2000)}).then(reply=>reply.json());
        if(status.state==='failed')throw new Error();
      }
      throw new Error();
    }catch{
      this.internetError=true;this.updateShare();
    }finally{
      this.internetButton.disabled=false;this.internetButton.textContent='START INTERNET LINK';
    }
  }
  async request(path,body){
    const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json',...(this.token?{Authorization:`Bearer ${this.token}`}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(3000)});
    const value=await response.json();if(!response.ok)throw new Error(value.error??'Connection failed.');return value;
  }
  async connect(path){
    if(this.active)return;
    this.hostButton.disabled=true;this.status.textContent='Connecting…';
    try{
      this.unlock().catch(()=>{});if(path==='/api/rooms')await this.refreshInfo();const reply=await this.request(path,{name:this.name.value.trim(),driver:path==='/api/join'?null:this.driver(),arena:this.arena(),bots:Number(this.botCount.value),code:this.invitation.toUpperCase()});
      this.token=reply.token;this.sequence=0;this.pending=null;this.failures=0;this.shareEdited=false;this.actions=[];this.keys.clear();this.paused=false;this.accept(reply);this.stream();
    }catch(error){this.status.textContent=error.message;}
    this.hostButton.disabled=this.active;this.name.disabled=this.active;
  }
  accept(state){
    if(!this.active)return;
    const now=performance.now()/1000;
    this.actionAudio.accept(state.world,now,state.inputSequence);
    state.world.events=this.actionAudio.confirmations(state.world.events,now);
    if(this.state&&state.world.elapsed<this.state.world.elapsed)this.playback.clear();
    this.playback.push(state.time,state.world);
    this.prediction.accept(state.world,now,{sequence:state.movementSequence??-1});
    const rosterKey=JSON.stringify([state.host,state.you,state.players]);
    this.state=state;this.leaveButton.classList.remove('hidden');this.share.classList.remove('hidden');this.copyButton.classList.remove('hidden');this.animalChoice.classList.remove('hidden');
    this.updateShare();this.help.classList.remove('hidden');
    this.botCount.value=String(state.bots);this.botCount.disabled=!this.isHost||!['ready','finished'].includes(state.world.phase);for(const option of this.botCount.options)option.disabled=Number(option.value)>6-state.players.length;
    this.animalChoice.value=String(state.world.driver);this.animalChoice.disabled=!['ready','finished'].includes(state.world.phase);
    this.status.textContent=`${state.players.length} PLAYER${state.players.length===1?'':'S'} · ${state.bots} BOT${state.bots===1?'':'S'} · ${this.isHost?'Share the link, then press Let’s Battle.':'Choose your animal; the host starts the match.'}`;
    if(['countdown','racing'].includes(state.world.phase))this.status.textContent=`MATCH LIVE · ${state.players.length} players + ${state.bots} bots`;
    if(rosterKey!==this.rosterKey){this.rosterKey=rosterKey;this.name.value=state.world.name;this.players.replaceChildren(...state.players.map(player=>{const label=document.createElement('span');label.textContent=`${drivers[player.driver].emoji} ${player.name}${player.id===state.host?' · HOST':''}${player.id===state.you?' · YOU':''}`;label.style.borderLeft=`4px solid ${player.color}`;return label;}));}
    this.onState(this.view());
  }
  view(){
    if(!this.state)return null;
    const world=this.state.world;
    if(this.paused&&['countdown','racing'].includes(world.phase))return {...world,phase:'paused',resumePhase:world.phase};
    return world;
  }
  render(dt){
    const world=this.playback.sample()??this.view();if(!world)return null;
    const local=this.prediction.sample(this.paused?new Set():this.keys,dt,performance.now()/1000);
    const now=performance.now()/1000;
    for(const type of this.prediction.sounds.splice(0))this.actionAudio.emit(type,now);
    if(!this.paused&&this.keys.has(' '))this.actionAudio.action('fire',undefined,now,this.sequence);
    const view={...world,...local};
    if(this.paused&&['countdown','racing'].includes(world.phase))return {...view,phase:'paused',resumePhase:world.phase};
    return view;
  }
  action(type,item){if(!this.active)return;if(!this.paused)this.actionAudio.action(type,item,performance.now()/1000,this.sequence);this.actions.push({type,...(item?{item}:{})});this.actions=this.actions.slice(-8);this.input();}
  input(){
    const now=performance.now()/1000;
    if(this.active&&this.socket?.readyState===WebSocket.OPEN){
      if(this.socket.bufferedAmount>16384)return;
      if(now-this.lastPing>=1){this.lastPing=now;this.socket.send(JSON.stringify({type:'ping',sent:now}));}
      this.socket.send(JSON.stringify({type:'input',sequence:this.sequence++,keys:this.paused?[]:[...this.keys].filter(key=>['arrowup','arrowdown','arrowleft','arrowright','w','a','s','d','shift',' '].includes(key)),actions:this.actions.splice(0,8),epoch:this.state.world.soundEpoch,moves:this.prediction.commands()}));return;
    }
  }
  stream(){
    const token=this.token,url=new URL('/api/socket',location.href);url.protocol=location.protocol==='https:'?'wss:':'ws:';const socket=this.socket=new WebSocket(url);
    socket.onopen=()=>{if(this.token===token){this.prediction.resend();socket.send(JSON.stringify({type:'authenticate',token}));}};
    socket.onmessage=event=>{try{if(typeof event.data!=='string'||event.data.length>512*1024)throw new Error();const state=JSON.parse(event.data);if(this.token!==token)return;if(state.type==='state')this.accept(decodeSnapshot(state));if(state.type==='pong'&&state.sent===this.lastPing)this.rtt=Math.max(0,Math.min(.3,performance.now()/1000-state.sent));}catch{socket.close();}};
    socket.onerror=()=>{};
    socket.onclose=()=>{if(this.token===token){this.keys.clear();this.status.textContent='Reconnecting to the room…';setTimeout(()=>{if(this.token===token)this.stream();},500);}};
  }
  async control(action,arena,bots){try{await this.request('/api/control',{action,arena,bots});this.paused=false;}catch(error){this.status.textContent=error.message;}}
  async chooseDriver(driver){
    if(!this.active||!['ready','finished'].includes(this.state?.world.phase))return;
    try{await this.request('/api/driver',{driver});}catch(error){this.status.textContent=error.message;}
  }
  pause(){this.paused=!this.paused;this.keys.clear();this.actions=[];this.input();this.onState(this.view());}
  leave(message='You left the room.'){
    if(!this.active)return;
    this.request('/api/leave',{}).catch(()=>{});this.token=null;this.socket?.close();this.state=null;this.pending=null;this.actions=[];this.keys.clear();this.playback.clear();this.prediction.clear();this.actionAudio=new ActionAudio(this.sound);this.rtt=0;this.lastPing=-Infinity;
    this.internetError=false;this.hostButton.disabled=false;this.name.disabled=false;this.botCount.disabled=false;for(const option of this.botCount.options)option.disabled=false;this.leaveButton.classList.add('hidden');this.copyButton.classList.add('hidden');this.internetButton.classList.add('hidden');this.animalChoice.classList.add('hidden');this.share.classList.add('hidden');this.help.classList.add('hidden');this.players.replaceChildren();this.status.textContent=message;this.onLeave();
  }
}
