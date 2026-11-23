import {RewardNotice} from './reward-notice.js';
const formatScore=n=>Number.isInteger(n)?String(n):Number(n).toFixed(1);
export const abilityCards={
  5:{title:'REVERSE PSYCHOLOGY',icon:'⇄',color:'#b7f35b',theme:'locust',detail:'LEFT IS RIGHT · FORWARD IS BACK'},
  7:{title:'REINE DE LA PARESSE',icon:'✺',color:'#ccb5ff',theme:'gravity',detail:'EVERYTHING GRAVITATES TO HER'},
  8:{title:'SPECIAL RELATIVITY',icon:'⏱',color:'#9ffaff',theme:'relativity',detail:'Time is what happens when nothing else happens.'},
  9:{title:'FASHION-STATEMENT',icon:'🫰',color:'#ffd59d',theme:'fashion',detail:'FLORALS? FOR SPRING? GROUNDBREAKING.'},
  10:{title:'REEFER MADNESS',icon:'☁',color:'#c0f1ac',theme:'reefer',detail:'LA VIE C’EST LA VIE'},
  11:{title:'PROVIDENCE',icon:'✧',color:'#ffebac',theme:'providence',detail:'MICHAEL & GABRIEL HAVE ARRIVED'},
  12:{title:'SIX-HEART RECOVERY',icon:'♥',color:'#ffb5c6',theme:'heartbeat',detail:'EVERY HEARTBEAT COUNTS'},
  13:{title:'TAX-AUDIT',icon:'Ⓕ',color:'#ffd1ba',theme:'audit',detail:'YOUR ITEMS HAVE BEEN ACCOUNTED FOR'},
  14:{title:'DARK HUMOR',icon:'◉',color:'#d6a8ff',theme:'darkness',detail:'SOME JOKES ARE BETTER IN THE DARK'},
  15:{title:'KARMIC RACCOONING',icon:'☯',color:'#8ef0c8',theme:'karma',detail:'BALANCE RESTORED FROM TYROL'},
};
export class AbilityUsage {
  previous=new Map();identity=null;elapsed=0;sequence=0;lastKarmaId=null;
  sample(world){
    const identity=[world.mode,world.soundEpoch,world.arena].join(':');
    if(identity!==this.identity||world.elapsed+.5<this.elapsed){this.previous.clear();this.identity=identity;this.lastKarmaId=null;}
    this.elapsed=world.elapsed;
    const events=[];
    const karma=world.lastKarma??null;
    let karmaCaster=null;
    if(this.lastKarmaId===null){
      this.lastKarmaId=karma?.id??0;
    }else if(karma&&karma.id>this.lastKarmaId){
      this.lastKarmaId=karma.id;
      if(world.phase==='racing'&&world.specialAbilities!==false&&world.elapsed-karma.time<3){
        karmaCaster=karma.caster;
        const caster=karma.caster===world.id?'YOU':(karma.casterName||'TAI-COON').toUpperCase();
        const victim=karma.victim===world.id?'YOU':(karma.victimName||'RIVAL').toUpperCase();
        const title=karma.swapped?'KARMIC RACCOONING · SCORES SWAPPED!':'KARMIC RACCOONING';
        const detail=karma.swapped
          ?`${caster} KO’D ${victim} & SWAPPED KILLS · ${caster} ${formatScore(karma.casterAfter)} ⇄ ${victim} ${formatScore(karma.victimAfter)}`
          :`${caster} KO’D ${victim} · KARMA BALANCED (NO SWAP)`;
        events.push({
          ...abilityCards[15],
          id:`karma:${identity}:${karma.id}`,
          owner:karma.caster,
          title,
          detail,
          ...(karma.swapped?{from:karma.casterBefore,to:karma.casterAfter}:{}),
          duration:karma.swapped?3.8:3.2,
        });
      }
    }
    for(const a of [world,...world.bots]){
      const state={driver:a.driver,cooldown:a.specialCooldown??0,boost:a.boost??0,flip:a.somersaultCooldown??0,nightmare:a.nightmareCooldown??0,notice:a.notice??''};
      const before=this.previous.get(a.id);this.previous.set(a.id,state);
      if(!before||world.phase!=='racing'||a.inactive||a.afk||a.destroyed||a.bomber)continue;
      if(state.notice!==before.notice){
        const who=a.id===world.id?'YOU':(a.name??'RIVAL').toUpperCase();
        if(state.notice==='EULERIAN PATH ACHIEVED!'){
          events.push({id:`euler:${identity}:${++this.sequence}`,owner:a.id,title:'EULERIAN PATH ACHIEVED!',icon:'👻',color:'#f5d77f',theme:'euler',detail:`${who} BROKE THE THEOREM · EULER’S GHOST HAUNTS THE ARENA!`,duration:4.2});
          continue;
        }
        if(state.notice==='6/7 bridges, Euler remains confident of his result...'){
          events.push({id:`euler-near:${identity}:${++this.sequence}`,owner:a.id,title:'6/7 BRIDGES',icon:'🌉',color:'#9fd8f5',theme:'euler',detail:'6/7 bridges, Euler remains confident of his result...',duration:3.2});
          continue;
        }
      }
      if(before.driver!==a.driver||world.specialAbilities===false)continue;
      let card;
      if(state.cooldown>before.cooldown+1){
        if(a.driver===15&&karmaCaster===a.id)continue;
        card=abilityCards[a.driver];
      }
      if(a.driver===10&&state.boost>before.boost+.3)card=abilityCards[10];
      if(a.driver===5&&state.flip>before.flip+.3)card={title:'CRICKET’S JUMP',icon:'🦗',color:'#b7f35b',theme:'locust',detail:'NOW YOU SEE HER…'};
      if(a.driver===7&&state.nightmare>(before.nightmare??0)+1)card={title:'NIGHTMARE FUEL',icon:'✺',color:'#d068ff',theme:'gravity',detail:'HOUSTON, WE HAVE A PROBLEM'};
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
