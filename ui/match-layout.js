export const usesMatchLayout=phase=>['countdown','racing','paused'].includes(phase);

export class MatchLayout {
  active=false;
  constructor({layout,sidebar,chat,map,playground,viewport,onChange=()=>{}}){
    Object.assign(this,{layout,sidebar,chat,map,playground,viewport,onChange});
    this.chatHome=document.createComment('Chat position before a match');chat.before(this.chatHome);
    this.mapHome=document.createComment('Playground map position before a match');map.before(this.mapHome);
    this.minimap=document.createElement('section');this.minimap.className='live-minimap hidden';this.minimap.setAttribute('aria-label','Live racer positions');
    viewport.append(this.minimap);
  }
  update(phase,mode){
    const active=usesMatchLayout(phase);
    this.minimap.classList.toggle('combat-minimap',mode==='combat');
    if(active===this.active)return;
    this.active=active;this.layout.classList.toggle('match-layout',active);this.minimap.classList.toggle('hidden',!active);this.playground.classList.toggle('hidden',active);
    if(active){if(this.sidebar.firstElementChild!==this.chat)this.sidebar.prepend(this.chat);this.minimap.append(this.map);}
    else{if(this.chatHome.nextElementSibling!==this.chat)this.chatHome.after(this.chat);this.mapHome.after(this.map);}
    this.onChange(active);
  }
}
