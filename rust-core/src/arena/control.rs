use super::*;
use serde::{Deserialize,Serialize};

const COLORS:[&str;8]=["#8456cf","#df7053","#67a99c","#edb84f","#777cbb","#db8daf","#56bce0","#b5cc62"];
#[derive(Deserialize,Serialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct Player {
    id:usize,name:String,driver:usize,role:String,
    #[serde(default)]afk:bool,#[serde(default)]wants_to_play:bool,#[serde(default)]play_request_refused:bool,
}
#[derive(Deserialize,Serialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct Request {id:u32,remaining_ms:f64}
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(super) struct Room {
    #[serde(default="default_capacity")]max_players:usize,
    #[serde(default="abilities_default")]special_abilities:bool,
    #[serde(default)]dedicated:bool,
    code:String,host:Option<usize>,arena:usize,bots:usize,epoch:u32,players:Vec<Player>,
    #[serde(default)]start_request:Option<Request>,#[serde(default)]seed:u32,
}
fn default_capacity()->usize{6}
impl Room {
    pub(super) fn valid(&self)->bool {
        if self.code.len()!=2||!self.code.bytes().all(|b|b.is_ascii_digit())||!matches!(self.max_players,6|8)||self.arena>1||self.players.len()>self.max_players||self.bots>self.max_players-self.players.len() {return false;}
        match (self.dedicated,self.host){
            (true,None)=>{if self.start_request.is_some(){return false;}},
            (false,Some(host))=>{if host>=self.max_players||!self.players.is_empty()&&!self.players.iter().any(|p|p.id==host){return false;}},
            _=>return false,
        }
        if self.start_request.as_ref().is_some_and(|r|r.id==0||!r.remaining_ms.is_finite()||!(0.0..=3000.0).contains(&r.remaining_ms)){return false;}
        let mut seen=[false;MAX_PLAYERS];
        for p in &self.players {
            if p.id>=self.max_players||seen[p.id]||p.driver>=DRIVER_NAMES.len()||p.name.trim().is_empty()||p.name.encode_utf16().count()>24||!matches!(p.role.as_str(),"driver"|"bomber"){return false;}seen[p.id]=true;
        }true
    }
}
fn initial_actor(id:usize,skill:f64,capacity:usize)->Actor {
    let angle=(id*8/capacity)as f64*std::f64::consts::FRAC_PI_4;let x=angle.sin()*78.0;let z=angle.cos()*78.0;let heading=(-x).atan2(-z);
    Actor{id,driver:id%DRIVER_NAMES.len(),color:COLORS[id].into(),wx:x,wz:z,heading,motion_heading:heading,camera_heading:heading,somersault_camera_start:heading,
        health:3.0,shield:0.0,ammo:START_HEDGEHOGS,missiles:1,turbos:1,item:"hedgehog".into(),fire_cooldown:0.5,chaff:4,skill,..Actor::default()}
}
impl Game {
    pub(super) fn create_room(room:&Room)->Result<Self,()> {
        let mut state=room.seed.max(1);let mut random=||{state^=state<<13;state^=state>>17;state^=state<<5;state as f64/(u32::MAX as f64+1.0)};
        let mut skills=[0.6;7];for (i,(low,high)) in [(0.94,1.0),(0.86,0.93),(0.70,0.83),(0.53,0.68),(0.35,0.51)].into_iter().enumerate(){skills[i]=low+random()*(high-low);}
        for i in (1..5).rev(){let j=(random()*(i+1)as f64).floor()as usize;skills.swap(i,j);}
        let global=Globals{special_abilities:room.special_abilities,mode:"combat".into(),phase:"ready".into(),arena:room.arena,countdown:3.0,duration:180.0,target_score:10.0,rank:6,multiplayer:true,sound_epoch:room.epoch as u64,
            supplies:[(-70.0,-65.0,"missile"),(70.0,65.0,"missile"),(-65.0,70.0,"hedgehog"),(65.0,-70.0,"hedgehog"),(-12.0,48.0,"boost"),(12.0,-48.0,"boost"),(-70.0,0.0,"health"),(70.0,0.0,"health"),(-50.0,-50.0,"hedgeproof"),(50.0,50.0,"tehilim")].into_iter().enumerate().map(|(id,(wx,wz,kind))|Supply{id:id as u32,wx,wz,kind:kind.into(),cooldown:match kind{"hedgeproof"|"tehilim"=>30.0,_=>0.0},..Supply::default()}).collect(),..Globals::default()};
        let mut game=Self::from_seed(Seed{global,player:initial_actor(0,0.85,room.max_players),bots:(1..room.max_players).map(|id|initial_actor(id,skills[id-1],room.max_players)).collect()})?;
        game.configure_room(room);Ok(game)
    }
    pub(super) fn configure_room(&mut self,room:&Room){
        self.global.host=room.host;self.global.special_abilities=room.special_abilities;if !room.special_abilities{self.global.time_stop=0.0;self.global.time_owner=None;self.global.effects.retain(|f|f.kind!="yudaSmoke");for supply in &mut self.global.supplies{supply.restore_home();}for a in &mut self.actors{a.special_active=0.0;}}
        let mut bots=room.bots;
        for id in 0..room.max_players {
            let person=room.players.iter().find(|p|p.id==id);
            let actor=&mut self.actors[id];let was_human=actor.human;let was_bomber=actor.bomber;
            if person.is_some()&&!was_human{
                *actor=initial_actor(id,actor.skill,room.max_players);actor.joined_after_kill=self.global.kill_sequence;self.pending[id].clear();self.movement_ack[id]= -1;self.action_ack[id]= -1;self.accepted_action[id]= -1;
            }
            let active=person.is_some()||bots>0;
            if person.is_none()&&active{bots-=1;}
            if active&&actor.inactive{actor.destroyed=0.0;actor.health=3.0;actor.shield=0.0;actor.speed=0.0;}
            actor.human=person.is_some();actor.inactive=!active;actor.afk=person.is_some_and(|p|p.afk);if actor.afk{actor.speed=0.0;actor.boost=0.0;actor.was_drifting=false;actor.drift=0.0;actor.somersault=0.0;}actor.color=match person.map_or(actor.driver,|p|p.driver){6=>"#e8edf2",_=>COLORS[id]}.into();
            if !active{actor.destroyed=1e9;actor.speed=0.0;}
            match person {
                Some(p)=>{
                    actor.name=Some(p.name.trim().into());actor.driver=p.driver;actor.bomber=p.role=="bomber";
                    actor.ammo=actor.ammo.min(actor.item_capacity("hedgehog"));actor.missiles=actor.missiles.min(actor.item_capacity("missile"));actor.turbos=actor.turbos.min(actor.item_capacity("boost"));actor.bomb_ammo=actor.bomb_ammo.min(actor.item_capacity("abomb"));actor.stink_ammo=actor.stink_ammo.min(actor.item_capacity("stink"));
                    if !was_human{actor.notice.clear();actor.notice_time=0.0;}
                    if actor.bomber&&(!was_human||!was_bomber){actor.bomb_ammo=2;actor.stink_ammo=2;actor.bomb_reload=0.0;actor.speed=0.0;actor.shield=0.0;actor.destroyed=0.0;actor.dizzy=0.0;}
                },
                None=>{actor.name=None;actor.bomber=false;if was_human{self.pending[id].clear();}}
            }
        }
        self.room.clear();
        if room.dedicated{self.room.insert("dedicated".into(),json!(true));}
        for (key,value) in [("maxPlayers",json!(room.max_players)),("code",json!(room.code)),("host",json!(room.host)),("arena",json!(room.arena)),("bots",json!(room.bots)),("specialAbilities",json!(room.special_abilities)),("startRequest",json!(room.start_request)),("players",json!(room.players.iter().map(|p|json!({"id":p.id,"name":p.name.trim(),"driver":p.driver,"color":self.actors[p.id].color,"role":p.role,"afk":p.afk,"wantsToPlay":p.wants_to_play,"playRequestRefused":p.play_request_refused})).collect::<Vec<_>>()))]{self.room.insert(key.into(),value);}
    }
}
#[no_mangle]pub extern "C" fn game_create(len:usize)->u32 {
    if len>8192{return 0;}
    let input=unsafe{core::slice::from_raw_parts(super::game_io_ptr(),len)};
    let Ok(room)=serde_json::from_slice::<Room>(input)else{return 0;};if !room.valid(){return 0;}
    let Ok(game)=Game::create_room(&room)else{return 0;};unsafe{*core::ptr::addr_of_mut!(super::WORLD)=Some(game);}1
}
#[no_mangle]pub extern "C" fn game_configure(len:usize)->u32 {
    if len>8192{return 0;}
    let input=unsafe{core::slice::from_raw_parts(super::game_io_ptr(),len)};
    let Ok(room)=serde_json::from_slice::<Room>(input)else{return 0;};if !room.valid(){return 0;}
    let Some(game)=(unsafe{&mut *core::ptr::addr_of_mut!(super::WORLD)})else{return 0;};
    if room.max_players!=game.actors.len()||room.arena!=game.global.arena||room.epoch as u64!=game.global.sound_epoch{return 0;}
    // Driver/role changes during a running match are denied before any mutation.
    if !matches!(game.global.phase.as_str(),"ready"|"finished")&&room.players.iter().any(|p|{let a=&game.actors[p.id];a.human&&(a.driver!=p.driver||a.bomber!=(p.role=="bomber"))}){return 0;}
    game.configure_room(&room);1
}
#[no_mangle]pub extern "C" fn game_resume(viewer:usize)->u32 {
    let Some(game)=(unsafe{&mut *core::ptr::addr_of_mut!(super::WORLD)})else{return 0;};
    if viewer>=game.actors.len()||!game.actors[viewer].human{return 0;}
    game.pending[viewer].clear();game.accepted_action[viewer]=game.action_ack[viewer];1
}
#[no_mangle]pub extern "C" fn game_start()->u32 {
    let Some(game)=(unsafe{&mut *core::ptr::addr_of_mut!(super::WORLD)})else{return 0;};
    if game.global.phase!="ready"{return 0;}game.global.phase="countdown".into();game.room.insert("startRequest".into(),json!(null));1
}
static mut STATUS:[f64;5]=[0.0;5];
#[no_mangle]pub extern "C" fn game_status_ptr()->*const f64 {
    if let Some(game)=unsafe{&*core::ptr::addr_of!(super::WORLD)} {
        unsafe{*core::ptr::addr_of_mut!(STATUS)=[match game.global.phase.as_str(){"ready"=>0.0,"countdown"=>1.0,"racing"=>2.0,"paused"=>3.0,"finished"=>4.0,_=>0.0},game.global.sound_epoch as f64,game.global.arena as f64,game.network_time,game.global.elapsed];}
    }core::ptr::addr_of!(STATUS).cast()
}
