import { drivers } from './engine.js';
import {ArenaClient} from './arena-core.js';
import {createBinaryEncoder} from './binary-wire.js';
const bootstrapPacket=createBinaryEncoder();

export function invitationUrl(pageUrl,code,{publicOrigin,lan}={}){
  const page=new URL(pageUrl);
  const origin=['localhost','127.0.0.1'].includes(page.hostname)?publicOrigin??lan??page.origin:page.origin;
  return new URL(`/?room=${encodeURIComponent(code)}`,origin).href;
}

export class PlayRequestPrompt {
  sample(state){
    if(!state?.startRequest||state.host!==state.you||!['ready','finished'].includes(state.world.phase))return [];
    return state.players.filter(player=>player.id!==state.host&&player.wantsToPlay);
  }
}

export class NetworkGame {
  playRequestPrompt=new PlayRequestPrompt();
  token=null;state=null;paused=false;sequence=0;actions=[];client=null;rtt=0;lastPing=-Infinity;
  constructor({anchor,keys,driver,arena,onState,onLeave,unlock,sound=()=>{},role='driver'}){
    Object.assign(this,{keys,driver,arena,onState,onLeave,unlock,sound,role});
    this.panel=document.createElement('section');this.panel.className='network-panel';this.panel.setAttribute('aria-label','Multiplayer arena lobby');
    const title=document.createElement('strong');title.textContent='PLAY TOGETHER · UP TO 6 PLAYERS';
    this.name=document.createElement('input');this.name.placeholder='Your name';this.name.value='Player';this.name.maxLength=24;this.name.setAttribute('aria-label','Player name');
    this.saveNameButton=this.button('SAVE NAME',()=>this.saveName());this.saveNameButton.classList.add('hidden');this.saveNameButton.disabled=true;
    this.nameFeedback=document.createElement('span');this.nameFeedback.className='network-name-status';this.nameFeedback.setAttribute('role','status');
    this.name.oninput=()=>{this.nameDirty=true;this.nameFeedback.textContent='';this.saveNameButton.disabled=!this.name.value.trim()||this.namePending||this.name.value.trim()===this.state?.world.name;};
    this.name.onkeydown=event=>{if(event.key==='Enter'&&this.active){event.preventDefault();event.stopPropagation();this.saveName();}};
    this.invitation=new URL(location.href).searchParams.get('room')??'';
    this.botCount=document.createElement('select');this.botCount.setAttribute('aria-label','Number of multiplayer bots');for(let count=0;count<=5;count++){const option=document.createElement('option');option.value=String(count);option.textContent=`${count} BOT${count===1?'':'S'}`;this.botCount.append(option);}this.botCount.value='1';this.botCount.onchange=()=>{if(this.active)this.control('bots',undefined,Number(this.botCount.value));};
    this.animalChoice=document.createElement('select');this.animalChoice.className='hidden';this.animalChoice.setAttribute('aria-label','Your multiplayer character');for(const [index,animal] of drivers.entries()){const option=document.createElement('option');option.value=String(index);option.textContent=`${animal.emoji} ${animal.name}`;this.animalChoice.append(option);}this.animalChoice.onchange=()=>this.chooseDriver(Number(this.animalChoice.value));
    this.hostButton=this.button('HOST ARENA',()=>this.connect('/api/rooms'));
    this.leaveButton=this.button('LEAVE ROOM',()=>this.leave());this.leaveButton.classList.add('hidden');
    this.status=document.createElement('p');this.status.setAttribute('role','status');this.status.textContent='Host an arena and share the link. Opening it joins the game automatically.';
    this.players=document.createElement('div');this.players.className='network-players';
    this.share=document.createElement('input');this.share.className='hidden';this.share.setAttribute('aria-label','Room invitation link');this.share.addEventListener('input',()=>{this.shareEdited=true;});
    this.internetButton=this.button('START INTERNET LINK',()=>this.startInternetLink());this.internetButton.classList.add('hidden');
    this.copyButton=this.button('COPY INVITE',async()=>{try{await navigator.clipboard.writeText(this.share.value);this.status.textContent='Invitation copied.';}catch{this.share.focus();this.share.select();this.status.textContent='Copy the selected invitation link.';}});this.copyButton.classList.add('hidden');
    const row=document.createElement('div');row.className='network-controls';row.append(this.name,this.saveNameButton,this.nameFeedback,this.animalChoice,this.botCount,this.hostButton,this.leaveButton);
    const invite=document.createElement('div');invite.className='network-invite';invite.append(this.share,this.internetButton,this.copyButton);
    this.help=document.createElement('p');this.help.className='network-help hidden';
    this.panel.append(title,row,this.status,this.players,invite,this.help);anchor.before(this.panel);
    this.readyDialog=document.createElement('dialog');this.readyDialog.id='play-request-popup';this.readyDialog.className='play-request-popup';this.readyDialog.setAttribute('aria-labelledby','play-request-title');
    const art=document.createElement('div');art.className='play-request-art';art.textContent='🏁';art.setAttribute('aria-hidden','true');
    this.readyTitle=document.createElement('h2');this.readyTitle.id='play-request-title';
    const detail=document.createElement('p');detail.textContent='Starts automatically unless you refuse. You can also start now.';
    this.readyCountdown=document.createElement('strong');this.readyCountdown.id='play-request-countdown';this.readyCountdown.className='play-request-countdown';this.readyCountdown.setAttribute('aria-live','polite');
    this.readyPeople=document.createElement('div');this.readyPeople.className='play-request-people';
    this.readyError=document.createElement('p');this.readyError.setAttribute('role','status');
    this.readyStartButton=this.button('START NOW ↗',async()=>{
      if(!this.isHost||this.readyStartButton.disabled)return;
      this.readyStartButton.disabled=true;this.readyError.textContent='';
      try{await this.request('/api/control',{action:'start'});this.paused=false;this.dismissPlayRequest();}
      catch(error){this.readyError.textContent=error.message;}
      finally{this.readyStartButton.disabled=false;}
    });this.readyStartButton.className='primary';this.readyStartButton.autofocus=true;
    this.readyLaterButton=this.button('REFUSE',()=>this.refusePlayRequest());
    const actions=document.createElement('div');actions.className='play-request-actions';actions.append(this.readyStartButton,this.readyLaterButton);
    this.readyDialog.append(art,this.readyTitle,detail,this.readyCountdown,this.readyPeople,actions,this.readyError);document.querySelector('.viewport').append(this.readyDialog);
    this.readyDialog.addEventListener('cancel',event=>{event.preventDefault();this.refusePlayRequest();});
    this.readyDialog.addEventListener('keydown',event=>event.stopPropagation());
    this.refreshInfo();
    this.infoTimer=setInterval(()=>{if(this.active&&this.isHost)this.refreshInfo();},5000);
    this.timer=setInterval(()=>this.input(),1000/30);
    if(this.invitation)queueMicrotask(()=>this.connect('/api/join'));
  }
  get active(){return Boolean(this.token);}
  get isHost(){return this.state?.host===this.state?.you;}
  get wantsToPlay(){return Boolean(this.state?.players.find(player=>player.id===this.state.you)?.wantsToPlay);}
  get playRequestRefused(){return Boolean(this.state?.players.find(player=>player.id===this.state.you)?.playRequestRefused);}
  dismissPlayRequest(){this.readyDialog.close();}
  async refusePlayRequest(){
    if(!this.isHost||!this.state?.startRequest||this.readyLaterButton.disabled)return;
    const requestId=this.state.startRequest.id;this.readyLaterButton.disabled=true;this.readyError.textContent='';
    try{await this.request('/api/control',{action:'refuse-start',requestId});this.dismissPlayRequest();}
    catch(error){this.readyError.textContent=error.message;}
    finally{this.readyLaterButton.disabled=false;}
  }
  updatePlayRequest(){
    const waiting=this.playRequestPrompt.sample(this.state);
    if(!waiting.length){this.readyDialog.close();return;}
    const title=waiting.length===1?`${waiting[0].name} wants to play!`:`${waiting.length} players are ready!`;
    if(this.readyTitle.textContent!==title)this.readyTitle.textContent=title;
    const seconds=Math.ceil(this.state.startRequest.remainingMs/1000),countdown=seconds>0?`AUTO-START IN ${seconds}…`:'STARTING…';
    if(this.readyCountdown.textContent!==countdown)this.readyCountdown.textContent=countdown;
    const key=JSON.stringify(waiting.map(player=>[player.id,player.name,player.driver,player.color]));
    if(key!==this.readyPeopleKey){
      this.readyPeopleKey=key;this.readyPeople.replaceChildren(...waiting.map(player=>{
        const chip=document.createElement('div');chip.className='play-request-person';chip.style.borderColor=player.color;
        const animal=document.createElement('span'),name=document.createElement('strong');animal.textContent=drivers[player.driver].emoji;animal.setAttribute('aria-hidden','true');name.textContent=player.name;chip.append(animal,name);return chip;
      }));
    }
    if(!this.readyDialog.open){this.readyError.textContent='';this.readyDialog.showModal();}
  }
  async saveName(){
    if(!this.active||this.namePending||!this.name.value.trim())return;
    const token=this.token;this.namePending=true;this.saveNameButton.disabled=true;this.name.disabled=true;this.nameFeedback.textContent='Saving…';
    try{
      const reply=await this.request('/api/name',{name:this.name.value.trim()});
      if(this.token!==token)return;
      this.name.value=reply.name;this.nameDirty=false;this.nameFeedback.textContent='Name saved.';
    }catch(error){if(this.token===token)this.nameFeedback.textContent=error.message;}
    finally{if(this.token===token){this.namePending=false;this.name.disabled=false;this.saveNameButton.disabled=this.name.value.trim()===this.state?.world.name;}}
  }
  async requestPlay(){
    if(!this.active||this.isHost||this.readyPending||this.wantsToPlay||!['ready','finished'].includes(this.state.world.phase))return;
    this.readyPending=true;
    try{await this.request('/api/ready',{ready:true});}catch(error){this.status.textContent=error.message;}finally{this.readyPending=false;}
  }
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
      this.unlock().catch(()=>{});if(path==='/api/rooms')await this.refreshInfo();const reply=await this.request(path,{name:this.name.value.trim(),driver:path==='/api/join'?null:this.driver(),role:this.role,arena:this.arena(),bots:Number(this.botCount.value),code:this.invitation.toUpperCase()});
      this.token=reply.token;this.nameDirty=false;this.namePending=false;this.sequence=0;this.pending=null;this.failures=0;this.shareEdited=false;this.actions=[];this.keys.clear();this.paused=false;this.client=new ArenaClient();this.accept(bootstrapPacket(reply));this.stream();
    }catch(error){this.status.textContent=error.message;}
    this.hostButton.disabled=this.active;this.name.disabled=false;
  }
  accept(packet){
    if(!this.active)return;
    const now=performance.now()/1000;this.client.accept(packet,now);this.client.frame(0,this.paused?0:this.keys,now);this.client.peek();
    const state=this.client.state();
    const rosterKey=JSON.stringify([state.host,state.you,state.players]);
    this.state=state;this.leaveButton.classList.remove('hidden');this.share.classList.remove('hidden');this.copyButton.classList.remove('hidden');this.animalChoice.classList.remove('hidden');
    this.saveNameButton.classList.remove('hidden');
    if(!this.nameDirty&&!this.namePending&&this.name.value!==state.world.name)this.name.value=state.world.name;
    this.saveNameButton.disabled=this.namePending||!this.name.value.trim()||this.name.value.trim()===state.world.name;
    this.updateShare();this.help.classList.remove('hidden');
    this.botCount.value=String(state.bots);this.botCount.disabled=!this.isHost||!['ready','finished'].includes(state.world.phase);for(const option of this.botCount.options)option.disabled=Number(option.value)>6-state.players.length;
    this.animalChoice.value=String(state.world.driver);this.animalChoice.disabled=!['ready','finished'].includes(state.world.phase);
    this.status.textContent=`${state.players.length} PLAYER${state.players.length===1?'':'S'} · ${state.bots} BOT${state.bots===1?'':'S'} · ${this.isHost?'Share the link, then press Let’s Battle.':'Choose your racer; the host starts the match.'}`;
    if(['ready','finished'].includes(state.world.phase)){
      const waiting=state.players.filter(player=>player.id!==state.host&&player.wantsToPlay).map(player=>player.name);
      const seconds=Math.ceil((state.startRequest?.remainingMs??0)/1000);
      if(this.isHost&&waiting.length)this.status.textContent=`${waiting.join(', ')} ${waiting.length===1?'wants':'want'} to play. Auto-start in ${seconds}s unless you refuse.`;
      if(!this.isHost&&this.wantsToPlay)this.status.textContent=`Starting in ${seconds}s unless the host refuses.`;
      if(!this.isHost&&this.playRequestRefused)this.status.textContent='The host refused your play request. You can ask again.';
    }
    if(['countdown','racing'].includes(state.world.phase))this.status.textContent=`MATCH LIVE · ${state.players.length} players + ${state.bots} bots`;
    if(rosterKey!==this.rosterKey){this.rosterKey=rosterKey;this.players.replaceChildren(...state.players.map(player=>{const label=document.createElement('span');label.textContent=`${player.role==='bomber'?'✈':drivers[player.driver].emoji} ${player.name}${player.role==='bomber'?' · BOMBER':''}${player.id===state.host?' · HOST':''}${player.id===state.you?' · YOU':''}${player.wantsToPlay?' · READY ✓':''}`;label.style.borderLeft=`4px solid ${player.color}`;return label;}));}
    this.updatePlayRequest();
    this.onState(this.view());
  }
  view(){if(!this.state)return null;this.client.view.paused=this.paused;return this.client.view.world;}
  render(dt,keys=this.keys){
    if(!this.client||!this.state)return null;
    this.client.view.paused=this.paused;this.client.frame(dt,this.paused?0:keys,performance.now()/1000);
    return this.client.present();
  }
  action(type,item){
    if(!this.active||this.paused||!this.client.action(type,item,performance.now()/1000))return;
    this.input();return true;
  }
  input(){
    const now=performance.now()/1000;
    if(!this.active||!this.client||this.socket?.readyState!==WebSocket.OPEN||this.socket.bufferedAmount>16384)return;
    if(now-this.lastPing>=1){this.lastPing=now;this.socket.send(JSON.stringify({type:'ping',sent:now}));}
    this.socket.send(this.client.outboundText(this.paused?0:this.keys));
  }
  stream(){
    const token=this.token,url=new URL('/api/socket',location.href);url.protocol=location.protocol==='https:'?'wss:':'ws:';const socket=this.socket=new WebSocket(url);
    socket.binaryType='arraybuffer';
    socket.onopen=()=>{if(this.token===token){this.client.resend();socket.send(JSON.stringify({type:'authenticate',token}));}};
    socket.onmessage=event=>{try{if(this.token!==token)return;if(event.data instanceof ArrayBuffer){this.accept(event.data);return;}if(typeof event.data!=='string'||event.data.length>2048)throw new Error();const state=JSON.parse(event.data);if(state.type!=='pong')throw new Error();if(state.sent===this.lastPing)this.rtt=Math.max(0,Math.min(.3,performance.now()/1000-state.sent));}catch{socket.close();}};
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
    this.readyDialog.close();this.playRequestPrompt=new PlayRequestPrompt();
    this.saveNameButton.classList.add('hidden');this.nameFeedback.textContent='';this.nameDirty=false;this.namePending=false;
    this.request('/api/leave',{}).catch(()=>{});this.token=null;this.socket?.close();this.state=null;this.pending=null;this.actions=[];this.keys.clear();this.client=null;this.rtt=0;this.lastPing=-Infinity;
    this.internetError=false;this.hostButton.disabled=false;this.name.disabled=false;this.botCount.disabled=false;for(const option of this.botCount.options)option.disabled=false;this.leaveButton.classList.add('hidden');this.copyButton.classList.add('hidden');this.internetButton.classList.add('hidden');this.animalChoice.classList.add('hidden');this.share.classList.add('hidden');this.help.classList.add('hidden');this.players.replaceChildren();this.status.textContent=message;this.onLeave();
  }
}
