export function conversationMessages(messages,you,to){
  return messages.filter(message=>to===''?message.to===null:message.to!==null&&((message.from===you&&String(message.to)===to)||(message.to===you&&String(message.from)===to)));
}

export function messageConversation(message,you){return message.to===null?'':String(message.from===you?message.to:message.from);}

export class GameChat {
  sending=false;inFlight=null;unread=new Map();replies=new Map();initialized=false;toastTimer=null;scope='';token=null;cursor=0;busy=false;nextPoll=0;messages=[];drafts=new Map();conversation='';you=null;rosterKey='';
  constructor({network,keys,anchor}){
    Object.assign(this,{network,keys});
    this.panel=document.createElement('section');this.panel.className='chat-panel';this.panel.setAttribute('aria-label','Room chat');
    const header=document.createElement('div');header.className='chat-heading';
    const heading=document.createElement('h2');heading.textContent='Pit stop chat';
    this.room=document.createElement('span');this.room.className='chat-room';header.append(heading,this.room);
    const label=document.createElement('label');label.className='chat-recipient';
    const caption=document.createElement('span');caption.textContent='CONVERSATION';
    this.recipient=document.createElement('select');this.recipient.setAttribute('aria-label','Message recipient');this.recipient.append(new Option('Everyone',''));this.recipient.className='hidden';this.tabs=document.createElement('div');this.tabs.className='chat-tabs';this.tabs.setAttribute('role','tablist');this.tabs.setAttribute('aria-label','Chat conversations');label.append(caption,this.recipient,this.tabs);
    this.context=document.createElement('p');this.context.className='chat-context';
    this.log=document.createElement('ol');this.log.className='chat-messages';this.log.setAttribute('role','log');this.log.setAttribute('aria-label','Chat messages');this.log.setAttribute('aria-live','polite');this.log.setAttribute('aria-relevant','additions');
    this.form=document.createElement('form');this.form.className='chat-compose';
    this.input=document.createElement('input');this.input.type='text';this.input.maxLength=500;this.input.placeholder='Message everyone…';this.input.setAttribute('aria-label','Chat message');this.input.autocomplete='off';this.input.dir='auto';
    this.send=document.createElement('button');this.send.type='submit';this.send.textContent='➤';this.send.setAttribute('aria-label','Send message');this.send.title='Send message';
    this.status=document.createElement('p');this.status.className='chat-status';this.status.setAttribute('role','status');
    this.replyPreview=document.createElement('div');this.replyPreview.className='chat-reply-preview hidden';
    this.notice=document.createElement('button');this.notice.type='button';this.notice.className='chat-notification hidden';this.notice.setAttribute('aria-live','polite');label.append(this.notice);
    for(const event of ['keydown','keyup'])this.notice.addEventListener(event,event=>event.stopPropagation());
    this.form.append(this.input,this.send);this.panel.append(header,label,this.context,this.log,this.replyPreview,this.form,this.status);anchor.after(this.panel);
    this.recipient.addEventListener('change',()=>{
      this.switchConversation(this.recipient.value);
    });
    this.panel.addEventListener('focusin',()=>{keys.clear();if(network.active)network.input();});
    for(const event of ['keydown','keyup'])this.panel.addEventListener(event,event=>event.stopPropagation());
    this.form.addEventListener('submit',event=>{event.preventDefault();if(!this.sending&&this.network.active&&this.input.value.trim()&&!this.recipient.selectedOptions[0]?.disabled)this.sendMessage();});
    this.update();this.timer=setInterval(()=>this.update(),500);
  }
  switchConversation(value){
    if(![...this.recipient.options].some(option=>option.value===value))return;
    this.drafts.set(this.conversation,this.input.value);this.conversation=value;this.recipient.value=value;
    this.input.value=this.drafts.get(value)??'';this.unread.delete(value);this.notice.classList.add('hidden');
    this.updateBadges();this.render(true);this.updateControls();
  }
  roomScope(){return this.network.token?`${this.network.token}:${this.network.state?.code??''}`:'';}
  updateControls(){
    const active=Boolean(this.network.token);
    for(const button of this.tabs.querySelectorAll('button'))button.disabled=!active;
    for(const button of this.log.querySelectorAll('.chat-delete'))button.disabled=this.busy;
    this.input.disabled=!active;this.recipient.disabled=!active;this.send.disabled=!active||this.sending||Boolean(this.recipient.selectedOptions[0]?.disabled);
  }
  update(){
    const scope=this.roomScope();
    if(scope!==this.scope){
      this.unread.clear();this.replies.clear();this.initialized=false;this.notice.classList.add('hidden');clearTimeout(this.toastTimer);this.scope=scope;this.token=this.network.token;this.cursor=0;this.messages=[];this.you=null;this.drafts.clear();this.conversation='';this.rosterKey='';this.input.value='';this.recipient.replaceChildren(new Option('Everyone',''));this.nextPoll=0;this.render(true);
    }
    if(this.isVisible()&&this.unread.has(this.conversation)){this.unread.delete(this.conversation);this.updateBadges();}
    this.updateControls();
    this.updateBadges();
    if(!this.network.token){this.status.textContent='Join a multiplayer room to chat.';return;}
    if(!this.busy&&Date.now()>=this.nextPoll)this.exchange(false);
  }
  isVisible(){const rect=this.log.getBoundingClientRect();return !document.hidden&&rect.bottom>0&&rect.top<innerHeight;}
  updateBadges(){
    const options=[...this.recipient.options];
    const signature=JSON.stringify(options.map(option=>[option.value,option.textContent,option.disabled]));
    if(this.tabs.dataset.roster!==signature){
      this.tabs.dataset.roster=signature;
      this.tabs.replaceChildren(...options.map(option=>{
        const button=document.createElement('button');button.type='button';button.className='chat-tab';button.dataset.conversation=option.value;button.setAttribute('role','tab');
        const name=document.createElement('span');name.textContent=option.textContent;const badge=document.createElement('span');badge.className='chat-unread hidden';button.append(name,badge);
        button.onclick=()=>this.switchConversation(option.value);return button;
      }));
    }
    for(const button of this.tabs.children){
      const value=button.dataset.conversation,count=this.unread.get(value)?.size??0;
      button.setAttribute('aria-selected',String(value===this.conversation));
      button.disabled=!this.network.token;
      const badge=button.querySelector('.chat-unread');badge.textContent=String(count);badge.classList.toggle('hidden',!count);badge.setAttribute('aria-label',`${count} unread messages`);
    }
    const total=[...this.unread.values()].reduce((sum,ids)=>sum+ids.size,0);
    this.room.textContent=this.network.token?`ROOM ${this.network.state?.code??''}${total?` · ${total} NEW`:''}`:'OFFLINE';
  }
  notify(message){
    const conversation=messageConversation(message,this.you);
    if(!this.unread.has(conversation))this.unread.set(conversation,new Set());this.unread.get(conversation).add(message.id);
    this.notice.textContent=message.to===null?`${message.name} posted in Everyone · Open chat ↗`:`New private message from ${message.name} · Open chat ↗`;
    this.notice.classList.remove('hidden');clearTimeout(this.toastTimer);this.toastTimer=setTimeout(()=>this.notice.classList.add('hidden'),7000);
    this.notice.onclick=()=>{this.switchConversation(conversation);this.notice.classList.add('hidden');this.panel.scrollIntoView({behavior:'smooth',block:'center'});this.input.focus({preventScroll:true});};
  }
  renderReply(){
    const reply=this.replies.get(this.conversation);this.replyPreview.replaceChildren();this.replyPreview.classList.toggle('hidden',!reply);
    if(!reply)return;
    const quote=document.createElement('span');quote.textContent=`Replying to ${reply.name}: ${reply.text}`;
    const cancel=document.createElement('button');cancel.type='button';cancel.textContent='×';cancel.setAttribute('aria-label','Cancel reply');cancel.onclick=()=>{this.replies.delete(this.conversation);this.renderReply();};this.replyPreview.append(quote,cancel);
  }
  render(scroll=false){
    const to=this.conversation;
    const name=this.recipient.selectedOptions[0]?.textContent??'Player';
    this.renderReply();
    this.context.textContent=to?`Private conversation with ${name}`:'Everyone in this room';
    this.input.placeholder=to?`Message ${name}…`:'Message everyone…';
    this.log.dataset.empty=to?'Your private conversation starts here.':'Say hello to your room.';
    const visible=conversationMessages(this.messages,this.you,to);
    const rows=visible.map(message=>{
      const own=message.from===this.you;
      const row=document.createElement('li');row.className=own?'chat-own':'chat-other';
      const bubble=document.createElement('div');bubble.className='chat-bubble';
      const meta=document.createElement('div');meta.className='chat-meta';
      const author=document.createElement('strong');author.textContent=own?'You':message.name;
      const time=document.createElement('time');time.dateTime=new Date(message.time).toISOString();time.textContent=new Date(message.time).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});meta.append(author,time);
      const content=document.createElement('span');content.textContent=message.deleted?'Message deleted':message.text;if(message.deleted)content.className='chat-deleted';content.dir='auto';bubble.append(meta);
      if(message.reply){const quote=document.createElement('blockquote');quote.className='chat-quote';quote.textContent=message.reply.deleted?'Message deleted':`${message.reply.name}: ${message.reply.text}`;bubble.append(quote);}
      const replyButton=document.createElement('button');replyButton.type='button';replyButton.className='chat-reply-button';replyButton.textContent='↩ Reply';replyButton.setAttribute('aria-label',`Reply to ${message.name}`);replyButton.onclick=()=>{this.replies.set(this.conversation,message);this.renderReply();this.input.focus();};
      bubble.append(content);
      if(!message.deleted){
        const actions=document.createElement('div');actions.className='chat-message-actions';actions.append(replyButton);
        if(own){const remove=document.createElement('button');remove.type='button';remove.className='chat-delete';remove.title='Delete message';remove.setAttribute('aria-label','Delete message');
          const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('width','16');svg.setAttribute('height','16');svg.setAttribute('aria-hidden','true');const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d','M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7');path.setAttribute('fill','none');path.setAttribute('stroke','currentColor');path.setAttribute('stroke-width','1.6');path.setAttribute('stroke-linecap','round');svg.append(path);remove.append(svg);
          remove.onclick=()=>{if(!this.busy)this.exchange(false,message.id);};actions.append(remove);}
        bubble.append(actions);
      }
      row.append(bubble);return row;
    });
    this.log.replaceChildren(...rows);
    if(scroll)this.log.scrollTop=this.log.scrollHeight;
  }
  async sendMessage(){
    if(this.sending)return;
    const action={scope:this.scope,text:this.input.value,to:this.conversation,replyTarget:this.replies.get(this.conversation)};
    this.sending=true;this.updateControls();
    try{
      await this.inFlight;
      if(action.scope===this.roomScope())await this.exchange(true,undefined,action);
    }finally{this.sending=false;this.updateControls();}
  }
  exchange(sending,deleteId,action){
    const request=this.performExchange(sending,deleteId,action);this.inFlight=request;return request;
  }
  async performExchange(sending,deleteId,action){
    const {scope,text,to,replyTarget}=action??{scope:this.scope,text:this.input.value,to:this.conversation,replyTarget:this.replies.get(this.conversation)};
    this.busy=true;this.updateControls();
    try{
      const reply=await this.network.request('/api/chat',{after:this.cursor,...(deleteId!==undefined?{deleteId}:{}),...(sending?{text,to:to===''?null:Number(to),replyTo:replyTarget?.id??null}:{})});
      if(scope!==this.roomScope())return;
      this.you=reply.you;
      const selected=this.conversation,selectedName=this.recipient.selectedOptions[0]?.textContent;
      const rosterKey=JSON.stringify(reply.players);
      const rosterChanged=rosterKey!==this.rosterKey;
      if(rosterChanged){
        this.rosterKey=rosterKey;
        this.recipient.replaceChildren(new Option('Everyone',''),...reply.players.filter(player=>player.id!==reply.you).map(player=>new Option(player.name,String(player.id))));
        if(selected&&!reply.players.some(player=>String(player.id)===selected)){
          const departed=new Option(`${selectedName} · left room`,selected);departed.disabled=true;this.recipient.append(departed);
        }
        this.recipient.value=selected;
      }
      const nearBottom=this.log.scrollHeight-this.log.scrollTop-this.log.clientHeight<40;
      const known=new Map(this.messages.map(message=>[message.id,message]));
      const added=reply.messages.filter(message=>!known.has(message.id)&&!message.deleted);
      for(const message of reply.messages){
        known.set(message.id,message);
        if(message.deleted){for(const ids of this.unread.values())ids.delete(message.id);for(const [conversation,target] of this.replies)if(target.id===message.id)this.replies.delete(conversation);}
      }
      if(this.initialized)for(const message of added)if(message.from!==this.you&&(messageConversation(message,this.you)!==this.conversation||!this.isVisible()))this.notify(message);
      this.initialized=true;this.updateBadges();
      this.messages=[...known.values()].sort((a,b)=>a.id-b.id);if(this.messages.length>1000)this.messages.splice(0,this.messages.length-1000);
      if(reply.messages.length||rosterKey!==this.renderedRoster){this.render(nearBottom||sending);this.renderedRoster=rosterKey;}
      // Re-fetch retained messages when returning players acquire new slots.
      this.cursor=rosterChanged?0:reply.cursor;
      if(sending){if(this.replies.get(to)===replyTarget)this.replies.delete(to);this.renderReply();if(this.drafts.get(to)===text)this.drafts.delete(to);if(this.conversation===to&&this.input.value===text)this.input.value='';}
      this.status.textContent='Connected';
    }catch(error){if(scope===this.roomScope())this.status.textContent=error.message;}
    finally{this.busy=false;this.nextPoll=Date.now()+1000;this.updateControls();}
  }
}
