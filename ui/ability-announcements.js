import {RewardNotice} from './reward-notice.js';
export const abilityCards={
  5:{title:'LOW-COST LOCUST',icon:'🦗',color:'#b7f35b',theme:'locust',detail:'THE SWARM IS HUNGRY'},
  7:{title:'REINE DE LA PARESSE',icon:'✺',color:'#ccb5ff',theme:'gravity',detail:'EVERYTHING GRAVITATES TO HER'},
  8:{title:'SPECIAL RELATIVITY',icon:'⏱',color:'#9ffaff',theme:'relativity',detail:'TIME IS A MATTER OF PERSPECTIVE'},
  9:{title:'FASHION-STATEMENT',icon:'🫰',color:'#ffd59d',theme:'fashion',detail:'FLORALS? FOR SPRING? GROUNDBREAKING.'},
  10:{title:'REEFER MADNESS',icon:'☁',color:'#c0f1ac',theme:'reefer',detail:'LA VIE C’EST LA VIE'},
  11:{title:'PROVIDENCE',icon:'✧',color:'#ffebac',theme:'providence',detail:'MICHAEL & GABRIEL HAVE ARRIVED'},
  12:{title:'SIX-HEART RECOVERY',icon:'♥',color:'#ffb5c6',theme:'heartbeat',detail:'EVERY HEARTBEAT COUNTS'},
  13:{title:'TAX-AUDIT',icon:'Ⓕ',color:'#ffd1ba',theme:'audit',detail:'YOUR ITEMS HAVE BEEN ACCOUNTED FOR'},
  14:{title:'DARK HUMOR',icon:'◉',color:'#d6a8ff',theme:'darkness',detail:'SOME JOKES ARE BETTER IN THE DARK'},
};
export class AbilityUsage {
  previous=new Map();identity=null;elapsed=0;sequence=0;
  sample(world){
    const identity=[world.mode,world.soundEpoch,world.arena].join(':');
    if(identity!==this.identity||world.elapsed+.5<this.elapsed){this.previous.clear();this.identity=identity;}
    this.elapsed=world.elapsed;
    const events=[];
    for(const a of [world,...world.bots]){
      const state={driver:a.driver,cooldown:a.specialCooldown??0,boost:a.boost??0,flip:a.somersaultCooldown??0};
      const before=this.previous.get(a.id);this.previous.set(a.id,state);
      if(!before||before.driver!==a.driver||world.phase!=='racing'||world.specialAbilities===false||a.inactive||a.afk||a.destroyed||a.bomber)continue;
      let card;
      if(state.cooldown>before.cooldown+1)card=abilityCards[a.driver];
      if(a.driver===10&&state.boost>before.boost+.3)card=abilityCards[10];
      if(a.driver===5&&state.flip>before.flip+.3)card={title:'CRICKET’S JUMP',icon:'🦗',color:'#b7f35b',theme:'locust',detail:'NOW YOU SEE HER…'};
      if(!card)continue;
      if(a.driver===13&&a.specialActive>0)card={title:'XYLOPHONE-ATTACK',icon:'♫',color:'#fff29b',theme:'xylophone',detail:'A VERY TAXING PERFORMANCE'};
      if(a.driver===8&&a.id!==world.id)card={...card,title:'TIME DILATION'};
      events.push({...card,id:`ability:${identity}:${++this.sequence}`,owner:a.id,detail:`${a.id===world.id?'YOU':a.name??'RIVAL'} · ${card.detail}`,duration:2.4});
    }
    return events;
  }
}
export class AbilityAnnouncements extends RewardNotice {
  usage=new AbilityUsage();
  constructor(parent){super(parent);this.node.id='ability-announcement';this.node.classList.add('ability-announcement','special-status');}
  update(world,now){
    const events=this.usage.sample(world);
    if(world.phase!=='racing'||world.specialAbilities===false){this.reset();this.render(now);return;}
    const event=events.find(e=>e.owner===world.id)??events.at(-1);
    if(event){this.pending=[];this.active=null;this.show(event);}
    this.render(now);
  }
}
