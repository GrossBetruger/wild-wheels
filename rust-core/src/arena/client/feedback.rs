use super::*;
#[derive(Clone)]pub(super) enum Op{
    Action{action:Action,kind:String,resource:String,ready:i64,born:f64},
    Pickup{id:u32,version:u32,key:String,kind:String,after:i64},
}
pub(super) struct LocalShot{pub id:u32,pub born:f64,pub updated:f64,pub model:Shot,pub error:[f64;2]}
pub(super) struct PendingSound{pub kind:String,pub time:f64,pub key:Option<String>}
fn grant(a:&mut Actor,kind:&str){match kind{
    "bicycle"=>{a.intelligence_bonus=a.intelligence_bonus.saturating_add(1);a.notice=format!("+1 INTELLIGENCE · {}",a.intelligence());a.notice_time=3.0;},
    "health"=>{a.health=(a.health+1.0).min(6.0);a.notice=format!("+1 HEART · {} / 6",a.health);a.notice_time=2.0;},
    "missile"=>{a.missiles=(a.missiles+1).min(a.item_capacity("missile"));if !(a.vulcan>0.0&&a.item=="hedgehog"){a.item="missile".into();}},
    "hedgeproof"=>a.hedge_shield=25.0,"tehilim"=>a.tehilim=25.0,"hedgehog"=>a.ammo=a.item_capacity("hedgehog"),"boost"=>a.turbos=(a.turbos+1).min(a.item_capacity("boost")),_=>{}
}}
fn select(a:&mut Actor,item:&str){if match item{"hedgehog"=>a.vulcan>0.0||a.ammo>0,"missile"=>a.missiles>0,_=>false}{a.item=item.into();}}
fn spend(a:&mut Actor,resource:&str){let value=match resource{"ammo"=>&mut a.ammo,"missiles"=>&mut a.missiles,"turbos"=>&mut a.turbos,"chaff"=>&mut a.chaff,"bombAmmo"=>&mut a.bomb_ammo,"stinkAmmo"=>&mut a.stink_ammo,_=>return};*value=value.saturating_sub(1);}
fn advance(game:&Game,shot:&mut Shot,seconds:f64){let mut left=seconds.clamp(0.0,0.5);while left>1e-8&&shot.life>0.0{let dt=left.min(1.0/60.0);game.advance_shot(shot,dt);left-=dt;}}
fn actual_model(game:&Game,actual:&Shot,age:f64)->Shot{
    let mut model=actual.clone();let ahead=(model.age-age).max(0.0);
    if ahead>0.0{if let Some(previous)=model.trail.last(){let rewind=ahead.min(1.0/60.0);let fraction=1.0-rewind*60.0;model.wx=previous.wx+(model.wx-previous.wx)*fraction;model.wz=previous.wz+(model.wz-previous.wz)*fraction;model.height=previous.height+(model.height-previous.height)*fraction;model.age-=rewind;model.life+=rewind;return model;}}
    let left=age-model.age;advance(game,&mut model,left);model
}
impl Client{
    pub(super) fn emit(&mut self,kind:&str,now:f64,key:Option<String>,resource:bool){
        if !resource&&matches!(kind,"driftCharge"|"driftChargeMax"|"boost"){
            if self.cue_times.get(kind).is_some_and(|last|now-last<0.3){return;}self.cue_times.insert(kind.into(),now);
        }
        self.pending_sounds.push(PendingSound{kind:kind.into(),time:now,key});self.audio.push(json!(kind));
    }
    pub(super) fn feedback_accept(&mut self,game:&Game,now:f64,reset:bool){
        let id=self.viewer;let ack=game.action_ack[id];let movement=game.movement_ack[id];let actor=&game.actors[id];
        if reset{self.ops.clear();self.local_shots.clear();self.rejected.clear();self.fire_tick=movement;self.chaff_tick=movement;self.pending_sounds.clear();self.cue_times.clear();self.audio.clear();self.voice_output.clear();self.local_drift=Globals::default();self.emitter=None;self.drift_last=None;self.drift_previous=None;}
        self.ops.retain(|op|match op{
            Op::Action{action,..}=>action.id.is_some_and(|id|id as i64>ack),
            Op::Pickup{id,version,key,after,..}=>{let Some(supply)=game.global.supplies.iter().find(|s|s.id==*id)else{return false;};if supply.version!=*version{return false;}if movement<*after{return true;}self.rejected.insert(key.clone());false}
        });
        self.fire_tick=movement+(actor.fire_cooldown*60.0-1e-8).ceil()as i64;self.chaff_tick=movement+(actor.chaff_cooldown*60.0-1e-8).ceil()as i64;
        for op in &self.ops{if let Op::Action{action,ready,..}=op{match action.kind.as_str(){"fire"=>self.fire_tick=self.fire_tick.max(*ready),"chaff"=>self.chaff_tick=self.chaff_tick.max(*ready),_=>{}}}}
        self.pending_sounds.retain(|p|now-p.time<1.0);
        for event in &game.global.events{
            if let Some(cue)=event.as_str(){self.audio.push(json!(cue));continue;}
            let event_id=event["id"].as_str().unwrap_or("").to_string();if self.seen.contains(&event_id){continue;}
            self.seen.insert(event_id.clone());self.seen_order.push_back(event_id);while self.seen_order.len()>256{if let Some(old)=self.seen_order.pop_front(){self.seen.remove(&old);}}
            let kind=event["type"].as_str().unwrap_or("");let key=event["key"].as_str();
            if event["owner"].as_u64()==Some(id as u64){if let Some(index)=self.pending_sounds.iter().position(|p|p.kind==kind&&now-p.time<1.0&&key.is_none_or(|key|p.key.as_deref()==Some(key))){self.pending_sounds.remove(index);continue;}}
            self.audio.push(json!(kind));
        }
        self.voice_output.extend(game.global.voices.iter().cloned());if self.voice_output.len()>16{self.voice_output.drain(..self.voice_output.len()-16);}
        self.local_shots.retain_mut(|entry|{
            let actual=game.global.projectiles.iter().find(|shot|shot.owner==id&&shot.action_id==Some(entry.id));
            let Some(actual)=actual else{return entry.id as i64>ack&&now-entry.born<=3.5;};
            let elapsed=(now-entry.updated).max(0.0);let decay=(-elapsed*20.0).exp();advance(game,&mut entry.model,elapsed);
            let previous=[entry.model.wx+entry.error[0]*decay,entry.model.wz+entry.error[1]*decay];let model=actual_model(game,actual,now-entry.born);
            entry.error=[previous[0]-model.wx,previous[1]-model.wz];entry.model=model;entry.updated=now;true
        });
    }
    fn inventory(&self)->Actor{
        let mut actor=self.frames.back().unwrap().game.actors[self.viewer].clone();pose_copy(&mut actor,&self.display.actors[self.viewer]);
        for op in &self.ops{match op{
            Op::Pickup{kind,..}=>grant(&mut actor,kind),
            Op::Action{action,kind,resource,..}=>match action.kind.as_str(){
                "select"=>select(&mut actor,&action.item),"turbo"|"chaff"|"bomb"=>spend(&mut actor,resource),
                "fire"=>{spend(&mut actor,resource);if kind=="missile"&&actor.missiles==0{actor.item="hedgehog".into();}},_=>{}
            }
        }}actor
    }
    pub(super) fn do_action(&mut self,mut action:Action,now:f64)->bool{
        if self.pred.frozen(self.viewer){return false;}
        if self.ops.len()>=64||self.pred.actors[self.viewer].afk{return false;}let mut actor=self.inventory();let id=self.next_action;action.id=Some(id);let sequence=self.next_sequence-1;
        let after=self.ops.iter().filter_map(|op|match op{Op::Pickup{after,..}=>Some(*after),_=>None}).fold(sequence,i64::max);action.after_move=after;
        if actor.bomber{
            let kind=action.bomb_kind.as_deref().unwrap_or("abomb");let resource=match kind{"stink"=>"stinkAmmo",_=>"bombAmmo"};
            if action.kind!="bomb"||!matches!(kind,"stink"|"abomb")||!self.pred.combat_active()||now-self.received>0.5||!action.wx.is_finite()||!action.wz.is_finite()||action.wx.abs()>96.0||action.wz.abs()>96.0||match kind{"stink"=>actor.stink_ammo==0,_=>actor.bomb_ammo==0}{return false;}
            action.after_move= -1;let kind=kind.to_string();self.next_action+=1;self.ops.push(Op::Action{action,kind,resource:resource.into(),ready:0,born:now});self.emit("bombDrop",now,Some(format!("action:{}",id)),false);return true;
        }
        if matches!(action.kind.as_str(),"select"|"cycle"){
            if action.kind=="select"{select(&mut actor,&action.item);}
            if action.kind=="cycle"{let items:Vec<_>=[("hedgehog",actor.vulcan>0.0||actor.ammo>0),("missile",actor.missiles>0)].into_iter().filter(|(_,ok)|*ok).map(|(s,_)|s).collect();if !items.is_empty(){let next=items.iter().position(|s|*s==actor.item).map_or(0,|i|(i+1)%items.len());actor.item=items[next].into();}}
            action.kind="select".into();action.item=actor.item;self.next_action+=1;self.ops.push(Op::Action{action,kind:String::new(),resource:String::new(),ready:0,born:now});return true;
        }
        if !self.pred.combat_active()||actor.destroyed>0.0||now-self.received>0.5{return false;}
        let pending=|kind:&str|self.ops.iter().any(|op|matches!(op,Op::Action{action,..}if action.kind==kind));
        let (kind,resource,ready)=match action.kind.as_str(){
            "special"=>{if !self.pred.global.special_abilities||!matches!(actor.driver,5|7|8|9|11|12|13|14)||actor.driver==12&&actor.health>=6.0||actor.special_cooldown>0.0||pending("special"){return false;}(String::new(),String::new(),0)},
            "somersault"=>{if actor.somersault_cooldown>1e-8||pending("somersault"){return false;}action.after_move=sequence;{let enabled=self.pred.global.special_abilities;if self.pred.actors[self.viewer].driver==5{self.pred.global.special_abilities=false;}self.pred.flip(self.viewer);self.pred.global.special_abilities=enabled;};self.error[2]=0.0;self.error[3]=0.0;(String::new(),String::new(),0)},
            "turbo"=>{if actor.turbos==0||actor.boost>0.0||pending("turbo"){return false;}if action.after_move<self.next_sequence{self.pred.actors[self.viewer].boost=boost_duration(actor.driver);}self.emit("boost",now,Some(format!("action:{}",id)),true);(String::new(),"turbos".into(),0)},
            "chaff"=>{if sequence<self.chaff_tick||actor.chaff==0{return false;}self.chaff_tick=after+39;self.emit("chaff",now,None,true);(String::new(),"chaff".into(),self.chaff_tick)},
            "fire"=>{
                if sequence<self.fire_tick{return false;}let missile=actor.item=="missile"&&actor.missiles>0;let vulcan=!missile&&actor.vulcan>0.0;if actor.driver==14&&vulcan{return false;}let resource=match(missile,vulcan){(true,_)=>"missiles",(_,true)=>"",_=>"ammo"};if resource=="ammo"&&actor.ammo==0{return false;}
                let kind=match missile{true=>"missile",false=>"hedgehog"};let cooldown=match(missile,vulcan){(true,_)=>0.9,(_,true)=>0.075,_=>0.225};self.fire_tick=after+(cooldown*60.0-1e-8_f64).ceil()as i64;
                let game=&self.frames.back().unwrap().game;
                let target=game.actors.iter().filter(|b|b.id!=self.viewer&&!b.bomber&&!b.inactive&&b.destroyed<=0.0&&b.shield<=0.0&&distance(actor.wx,actor.wz,b.wx,b.wz)<100.0&&angle((b.wx-actor.wx).atan2(b.wz-actor.wz),actor.heading).abs()<0.65&&clear(game.global.arena,actor.wx,actor.wz,b.wx,b.wz)).min_by(|a,b|distance(actor.wx,actor.wz,a.wx,a.wz).total_cmp(&distance(actor.wx,actor.wz,b.wx,b.wz))).map(|a|a.id);
                let model=Shot{id:0x80000000u32.wrapping_add(id),owner:self.viewer,kind:kind.into(),wx:actor.wx+actor.heading.sin()*3.5,wz:actor.wz+actor.heading.cos()*3.5,heading:actor.heading,speed:match(missile,vulcan){(true,_)=>70.0,(_,true)=>125.0,_=>90.0},height:1.3,vy:3.0,life:match(missile,vulcan){(true,_)=>3.0,(_,true)=>1.3,_=>2.5},target,vulcan,action_id:Some(id),..Shot::default()};
                self.local_shots.push(LocalShot{id,born:now,updated:now,model,error:[0.0;2]});self.emit(match(missile,vulcan){(true,_)=>"missile",(_,true)=>"vulcanFire",_=>"fire"},now,Some(format!("action:{}",id)),!resource.is_empty());(kind.into(),resource.into(),self.fire_tick)
            },_=>return false
        };
        self.next_action+=1;self.ops.push(Op::Action{action,kind,resource,ready,born:now});true
    }
    pub(super) fn replay_maneuvers(&mut self,sequence:i64,inclusive:bool){
        for op in &self.ops{if let Op::Action{action,..}=op{if match inclusive{true=>action.after_move<=sequence,false=>action.after_move==sequence}{match action.kind.as_str(){"turbo"=>self.pred.actors[self.viewer].boost=boost_duration(self.pred.actors[self.viewer].driver),"somersault"=>{let enabled=self.pred.global.special_abilities;if self.pred.actors[self.viewer].driver==5{self.pred.global.special_abilities=false;}self.pred.flip(self.viewer);self.pred.global.special_abilities=enabled;},_=>{}}}}}
    }
    pub(super) fn feedback_commands(&mut self)->Vec<serde_json::Value>{
        let mut last=self.last_sent_action;
        let result=self.ops.iter().filter_map(|op|match op{Op::Action{action,..}if action.id.is_some_and(|id|id as i64>self.last_sent_action)=>Some(action),_=>None}).take(8).map(|action|{
            let id=action.id.unwrap();last=id as i64;let mut value=json!({"id":id,"type":action.kind,"afterMove":action.after_move});
            if !action.item.is_empty(){value["item"]=json!(action.item);}if action.kind=="bomb"{value["wx"]=json!(action.wx);value["wz"]=json!(action.wz);value["kind"]=json!(action.bomb_kind.as_deref().unwrap_or("abomb"));}value
        }).collect();self.last_sent_action=last;result
    }
    pub(super) fn feedback_render(&mut self,now:f64){
        let id=self.viewer;let sequence=self.next_sequence-1;let mut actor=self.inventory();
        if actor.bomber{
            self.display.actors[id].bomb_ammo=actor.bomb_ammo;self.display.actors[id].stink_ammo=actor.stink_ammo;
            self.display.global.bombs=self.frames.back().unwrap().game.global.bombs.clone();
            for op in &self.ops{if let Op::Action{action,kind,born,..}=op{if action.kind=="bomb"&&!self.display.global.bombs.iter().any(|b|b.owner==id&&b.action_id==action.id){self.display.global.bombs.push(Bomb{id:0x80000000u32.wrapping_add(action.id.unwrap_or(0)),kind:kind.clone(),owner:id,wx:action.wx,wz:action.wz,age:(now-born).max(0.0),color:actor.color.clone(),action_id:action.id});}}}return;
        }
        if !self.pred.frozen(id)&&self.pred.combat_active()&&actor.destroyed<=0.0&&now-self.received<0.5{
            let supplies=self.frames.back().unwrap().game.global.supplies.clone();
            for s in supplies{
                let key=format!("pickup:{}:{}",s.id,s.version+1);
                if distance(actor.wx,actor.wz,s.wx,s.wz)>=4.0{self.rejected.remove(&key);continue;}
                if s.kind=="bicycle"&&(s.age<1.2){continue;}
                if s.cooldown>0.0||self.rejected.contains(&key)||self.ops.iter().any(|op|matches!(op,Op::Pickup{key:k,..}if *k==key))||s.kind=="health"&&actor.health>=6.0{continue;}
                self.ops.push(Op::Pickup{id:s.id,version:s.version,key:key.clone(),kind:s.kind.clone(),after:sequence+1});grant(&mut actor,&s.kind);self.emit("pickup",now,Some(key),false);
            }
        }
        let a=&mut self.display.actors[id];a.intelligence_bonus=actor.intelligence_bonus;a.ammo=actor.ammo;a.missiles=actor.missiles;a.turbos=actor.turbos;a.health=actor.health;a.hedge_shield=actor.hedge_shield;a.tehilim=actor.tehilim;a.chaff=actor.chaff;a.item=actor.item;a.notice=actor.notice;a.notice_time=actor.notice_time;a.fire_cooldown=((self.fire_tick-sequence)as f64/60.0).max(0.0);
        for supply in &mut self.display.global.supplies{if let Some(actual)=self.frames.back().unwrap().game.global.supplies.iter().find(|s|s.id==supply.id){supply.cooldown=actual.cooldown;}if self.ops.iter().any(|op|matches!(op,Op::Pickup{id,..}if *id==supply.id)){supply.cooldown=match supply.kind.as_str(){"hedgeproof"|"tehilim"=>45.0,_=>8.0};}}
        self.display.global.projectiles.retain(|s|s.owner!=id||s.action_id.is_none_or(|id|!self.local_shots.iter().any(|entry|entry.id==id)));
        let mut models=Vec::new();for entry in &mut self.local_shots{
            let elapsed=(now-entry.updated).max(0.0);advance(&self.display,&mut entry.model,elapsed);entry.updated=now;let decay=(-elapsed*20.0).exp();entry.error[0]*=decay;entry.error[1]*=decay;
            if entry.model.life>0.0{let mut model=entry.model.clone();model.wx+=entry.error[0];model.wz+=entry.error[1];models.push(model);}
        }self.display.global.projectiles.extend(models);
    }
    pub(super) fn feedback_drift(&mut self,now:f64,enabled:bool){
        let id=self.viewer;let a=&self.display.actors[id];
        if self.drift_previous.is_some_and(|(x,z,_)|distance(a.wx,a.wz,x,z)>18.0){self.local_drift=Globals::default();self.emitter=None;self.drift_last=None;self.drift_previous=None;}
        let dt=(now-self.drift_last.unwrap_or(now)).max(0.0);self.drift_last=Some(now);self.local_drift.elapsed+=dt;super::super::movement::age(&mut self.local_drift,dt);
        let active=enabled&&self.display.combat_active()&&a.destroyed<=0.0&&a.was_drifting;
        if active{
            let level=match a.drift{d if d>=0.85=>2,d if d>=0.45=>1,_=>0};
            if self.emitter.is_none(){let(x,z,h)=self.drift_previous.unwrap_or((a.wx,a.wz,a.heading));let(tx,tz)=(h.sin(),h.cos());let wheels=[-1.0,1.0].into_iter().map(|side|Point{wx:x-tx*1.5+tz*side*1.6,wz:z-tz*1.5-tx*side*1.6}).collect();self.emitter=Some(Actor{drift_trail:Some(wheels),drift_emit:0.035,..Actor::default()});self.emitter_level=level;}
            let emitter=self.emitter.as_mut().unwrap();if self.emitter_level!=level{emitter.drift_emit=0.035;}self.emitter_level=level;
            emitter.id=id;emitter.wx=a.wx;emitter.wz=a.wz;emitter.heading=a.heading;emitter.drift=a.drift;super::super::movement::emit(&mut self.local_drift,emitter,dt.min(0.05));
        }
        if !active{self.emitter=None;}
        self.drift_previous=Some((a.wx,a.wz,a.heading));let world=&self.frames.back().unwrap().game;
        self.display.global.skids=world.global.skids.iter().filter(|s|s.owner!=id).cloned().chain(self.local_drift.skids.iter().map(|s|Skid{time:self.display.global.elapsed-(self.local_drift.elapsed-s.time),..s.clone()})).collect();
        self.display.global.drift_particles=world.global.drift_particles.iter().filter(|p|p.owner!=id).cloned().chain(self.local_drift.drift_particles.iter().cloned()).collect();
    }
}
