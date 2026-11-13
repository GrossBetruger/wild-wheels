// Presentation events are independent of game rules: other rewards can call show().
export class RewardQueue {
  pending=[];seen=new Set();active=null;
  show(event){
    if(this.seen.has(event.id))return;
    this.seen.add(event.id);if(this.seen.size>256)this.seen.delete(this.seen.values().next().value);
    this.pending.push({...event});this.pending=this.pending.slice(-8);
  }
  sample(now){
    if(this.active&&now>=this.active.until)this.active=null;
    if(!this.active&&this.pending.length)this.active={...this.pending.shift(),started:now,until:now+3};
    return this.active;
  }
  reset(){this.pending=[];this.seen.clear();this.active=null;}
}

// For permanent upgrades, ignore prediction rollbacks and initial restored values.
export class PermanentStatGains {
  stats=new Map();
  observe(stat,epoch,value,total){
    const previous=this.stats.get(stat);
    if(!previous||previous.epoch!==epoch){this.stats.set(stat,{epoch,value});return null;}
    if(value<=previous.value)return null;
    const from=total-(value-previous.value);previous.value=value;
    return {id:`${epoch}:${stat}:${value}`,from,to:total};
  }
}

export class RewardNotice extends RewardQueue {
  constructor(parent){
    super();this.node=document.createElement('div');this.node.className='reward-notice hidden';this.node.id='reward-notice';
    this.node.setAttribute('role','status');this.node.setAttribute('aria-live','polite');parent.append(this.node);
  }
  render(now){
    const event=this.sample(now);this.node.classList.toggle('hidden',!event);
    if(!event){this.rendered=null;return;}
    if(this.rendered===event.id)return;
    this.rendered=event.id;this.node.style.setProperty('--reward-color',event.color??'#d5b4ff');
    const card=document.createElement('div');card.className='reward-card';
    const icon=document.createElement('span'),title=document.createElement('strong'),detail=document.createElement('small');
    icon.className='reward-icon';icon.textContent=event.icon??'✦';title.textContent=event.title;detail.textContent=event.detail??'';
    card.append(icon,title);
    const numeric=Number.isFinite(event.from)&&Number.isFinite(event.to);
    this.node.setAttribute('aria-label',`${event.title}${numeric?` ${event.from} to ${event.to}`:''}${event.detail?`. ${event.detail}`:''}`);
    if(numeric){
      const counter=document.createElement('div'),before=document.createElement('span'),arrow=document.createElement('span'),window=document.createElement('span'),roll=document.createElement('span');
      counter.className='reward-counter';counter.setAttribute('aria-hidden','true');before.className='reward-before';before.textContent=String(event.from);arrow.className='reward-arrow';arrow.textContent='➜';window.className='reward-window';roll.className='reward-roll';
      const steps=Math.max(1,Math.min(20,Math.abs(event.to-event.from)));
      for(let i=0;i<=steps;i++){const number=document.createElement('span');number.textContent=String(Math.round(event.from+(event.to-event.from)*i/steps));roll.append(number);}
      roll.style.setProperty('--reward-steps',steps);window.append(roll);counter.append(before,arrow,window);card.append(counter);
    }
    card.append(detail);
    for(let i=0;i<10;i++){const spark=document.createElement('i');spark.className='reward-spark';spark.style.setProperty('--spark-angle',`${i*36}deg`);card.append(spark);}
    this.node.replaceChildren(card);
  }
}
