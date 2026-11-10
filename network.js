export function invitationUrl(pageUrl,code,{publicOrigin,lan}={}){
  const page=new URL(pageUrl);
  const origin=['localhost','127.0.0.1'].includes(page.hostname)?publicOrigin??lan??page.origin:page.origin;
  return new URL(`/?room=${encodeURIComponent(code)}`,origin).href;
}

export class NetworkGame {
  token=null;state=null;paused=false;sequence=0;actions=[];poses=new Map();
  constructor({anchor,keys,driver,arena,onState,onLeave,unlock}){
    Object.assign(this,{keys,driver,arena,onState,onLeave,unlock});
    this.panel=document.createElement('section');this.panel.className='network-panel';this.panel.setAttribute('aria-label','Multiplayer arena lobby');
    const title=document.createElement('strong');title.textContent='PLAY TOGETHER · UP TO 6 PLAYERS';
    this.name=document.createElement('input');this.name.placeholder='Your name';this.name.value='Player';this.name.maxLength=24;this.name.setAttribute('aria-label','Player name');
    this.invitation=new URL(location.href).searchParams.get('room')??'';
    this.botCount=document.createElement('select');this.botCount.setAttribute('aria-label','Number of multiplayer bots');for(let count=0;count<=5;count++){const option=document.createElement('option');option.value=String(count);option.textContent=`${count} BOT${count===1?'':'S'}`;this.botCount.append(option);}this.botCount.value='1';this.botCount.onchange=()=>{if(this.active)this.control('bots',undefined,Number(this.botCount.value));};
    this.hostButton=this.button('HOST ARENA',()=>this.connect('/api/rooms'));
    this.leaveButton=this.button('LEAVE ROOM',()=>this.leave());this.leaveButton.classList.add('hidden');
    this.status=document.createElement('p');this.status.setAttribute('role','status');this.status.textContent='Host an arena and share the link. Opening it joins the game automatically.';
    this.players=document.createElement('div');this.players.className='network-players';
    this.share=document.createElement('input');this.share.className='hidden';this.share.setAttribute('aria-label','Room invitation link');this.share.addEventListener('input',()=>{this.shareEdited=true;});
    this.copyButton=this.button('COPY INVITE',async()=>{try{await navigator.clipboard.writeText(this.share.value);this.status.textContent='Invitation copied.';}catch{this.share.focus();this.share.select();this.status.textContent='Copy the selected invitation link.';}});this.copyButton.classList.add('hidden');
    const row=document.createElement('div');row.className='network-controls';row.append(this.name,this.botCount,this.hostButton,this.leaveButton);
    const invite=document.createElement('div');invite.className='network-invite';invite.append(this.share,this.copyButton);
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
      const info=await response.json();this.lan=info.addresses?.[0];this.publicOrigin=info.publicOrigin;this.updateShare();
    }catch{}
  }
  updateShare(){
    if(!this.state)return;
    const local=['localhost','127.0.0.1'].includes(location.hostname);
    if(!this.shareEdited)this.share.value=invitationUrl(location.href,this.state.code,{publicOrigin:this.publicOrigin,lan:this.lan});
    this.help.textContent=location.protocol==='https:'||local&&this.publicOrigin?'Share this HTTPS link with a friend to play over the internet.':`Same Wi-Fi: share this link. Internet: start ngrok http ${location.port||5173}; the invitation updates automatically.`;
  }
  async request(path,body){
    const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json',...(this.token?{Authorization:`Bearer ${this.token}`}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(3000)});
    const value=await response.json();if(!response.ok)throw new Error(value.error??'Connection failed.');return value;
  }
  async connect(path){
    if(this.active)return;
    this.hostButton.disabled=true;this.status.textContent='Connecting…';
    try{
      this.unlock().catch(()=>{});if(path==='/api/rooms')await this.refreshInfo();const reply=await this.request(path,{name:this.name.value.trim(),driver:this.driver(),arena:this.arena(),bots:Number(this.botCount.value),code:this.invitation.toUpperCase()});
      this.token=reply.token;this.sequence=0;this.pending=null;this.failures=0;this.shareEdited=false;this.actions=[];this.keys.clear();this.paused=false;this.accept(reply);this.stream();
    }catch(error){this.status.textContent=error.message;}
    this.hostButton.disabled=this.active;this.name.disabled=this.active;
  }
  accept(state){
    if(!this.active)return;
    if(this.state&&state.world.elapsed<this.state.world.elapsed)this.poses.clear();
    const rosterKey=JSON.stringify([state.host,state.you,state.players]);
    this.state=state;this.leaveButton.classList.remove('hidden');this.share.classList.remove('hidden');this.copyButton.classList.remove('hidden');
    this.updateShare();this.help.classList.remove('hidden');
    this.botCount.value=String(state.bots);this.botCount.disabled=!this.isHost||!['ready','finished'].includes(state.world.phase);for(const option of this.botCount.options)option.disabled=Number(option.value)>6-state.players.length;
    this.status.textContent=`${state.players.length} PLAYER${state.players.length===1?'':'S'} · ${state.bots} BOT${state.bots===1?'':'S'} · ${this.isHost?'Share the link, then press Let’s Battle.':'The host starts the match.'}`;
    if(['countdown','racing'].includes(state.world.phase))this.status.textContent=`MATCH LIVE · ${state.players.length} players + ${state.bots} bots`;
    if(rosterKey!==this.rosterKey){this.rosterKey=rosterKey;this.name.value=state.world.name;this.players.replaceChildren(...state.players.map(player=>{const label=document.createElement('span');label.textContent=`${player.name}${player.id===state.host?' · HOST':''}${player.id===state.you?' · YOU':''}`;return label;}));}
    this.onState(this.view());
  }
  view(){
    if(!this.state)return null;
    const world=this.state.world;
    if(this.paused&&['countdown','racing'].includes(world.phase))return {...world,phase:'paused',resumePhase:world.phase};
    return world;
  }
  render(dt){
    const view=this.view();if(!view)return null;
    const smooth=actor=>{
      let pose=this.poses.get(actor.id);
      if(!pose||actor.destroyed||Math.hypot(actor.wx-pose.wx,actor.wz-pose.wz)>18)pose={wx:actor.wx,wz:actor.wz,heading:actor.heading,cameraHeading:actor.cameraHeading};
      const factor=1-Math.exp(-dt*45);pose.wx+=(actor.wx-pose.wx)*factor;pose.wz+=(actor.wz-pose.wz)*factor;
      for(const field of ['heading','cameraHeading'])pose[field]+=Math.atan2(Math.sin(actor[field]-pose[field]),Math.cos(actor[field]-pose[field]))*factor;
      this.poses.set(actor.id,pose);return {...actor,...pose};
    };
    return {...smooth(view),bots:view.bots.map(smooth)};
  }
  action(type,item){if(!this.active)return;this.actions.push({type,...(item?{item}:{})});this.actions=this.actions.slice(-8);this.input();}
  input(){
    if(this.active&&this.socket?.readyState===WebSocket.OPEN){
      if(this.socket.bufferedAmount>16384)return;
      this.socket.send(JSON.stringify({type:'input',sequence:this.sequence++,keys:this.paused?[]:[...this.keys].filter(key=>['arrowup','arrowdown','arrowleft','arrowright','w','a','s','d','shift',' '].includes(key)),actions:this.actions.splice(0,8)}));return;
    }
  }
  stream(){
    const token=this.token,url=new URL('/api/socket',location.href);url.protocol=location.protocol==='https:'?'wss:':'ws:';const socket=this.socket=new WebSocket(url);
    socket.onopen=()=>{if(this.token===token)socket.send(JSON.stringify({type:'authenticate',token}));};
    socket.onmessage=event=>{try{if(typeof event.data!=='string'||event.data.length>512*1024)throw new Error();const state=JSON.parse(event.data);if(state.type==='state'&&this.token===token)this.accept(state);}catch{socket.close();}};
    socket.onerror=()=>{};
    socket.onclose=()=>{if(this.token===token){this.keys.clear();this.status.textContent='Reconnecting to the room…';setTimeout(()=>{if(this.token===token)this.stream();},500);}};
  }
  async control(action,arena,bots){try{await this.request('/api/control',{action,arena,bots});this.paused=false;}catch(error){this.status.textContent=error.message;}}
  pause(){this.paused=!this.paused;this.keys.clear();this.actions=[];this.input();this.onState(this.view());}
  leave(message='You left the room.'){
    if(!this.active)return;
    this.request('/api/leave',{}).catch(()=>{});this.token=null;this.socket?.close();this.state=null;this.pending=null;this.actions=[];this.keys.clear();this.poses.clear();
    this.hostButton.disabled=false;this.name.disabled=false;this.botCount.disabled=false;for(const option of this.botCount.options)option.disabled=false;this.leaveButton.classList.add('hidden');this.copyButton.classList.add('hidden');this.share.classList.add('hidden');this.help.classList.add('hidden');this.players.replaceChildren();this.status.textContent=message;this.onLeave();
  }
}
