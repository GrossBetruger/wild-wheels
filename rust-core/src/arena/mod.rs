mod types;
mod movement;
mod weapons;
mod tick;
mod packet;
mod client;
mod presentation;
mod control;
pub use types::*;
use serde_json::json;

pub fn blocks(arena:usize)->&'static [[f64;4]] {
    match arena {
        0=>&[[-40.0,-35.0,34.0,10.0],[40.0,35.0,34.0,10.0],[-35.0,35.0,10.0,34.0],[35.0,-35.0,10.0,34.0],[0.0,0.0,14.0,14.0]],
        _=>&[[0.0,0.0,28.0,28.0],[-55.0,0.0,12.0,36.0],[55.0,0.0,12.0,36.0],[0.0,-55.0,36.0,12.0],[0.0,55.0,36.0,12.0]],
    }
}
pub fn blocked(arena:usize,x:f64,z:f64,padding:f64)->bool {
    x.abs()>96.0-padding||z.abs()>96.0-padding||blocks(arena).iter().any(|b|(x-b[0]).abs()<b[2]/2.0+padding&&(z-b[1]).abs()<b[3]/2.0+padding)
}
pub fn distance(ax:f64,az:f64,bx:f64,bz:f64)->f64 { (ax-bx).hypot(az-bz) }
pub fn angle(a:f64,b:f64)->f64 { (a-b).sin().atan2((a-b).cos()) }
pub fn clear(arena:usize,ax:f64,az:f64,bx:f64,bz:f64)->bool {
    let d=distance(ax,az,bx,bz);let mut t=3.0;
    while t<d {if blocked(arena,ax+(bx-ax)*t/d,az+(bz-az)*t/d,0.4){return false;}t+=3.0;}true
}
pub fn sound(g:&mut Globals,kind:&str,owner:usize,x:f64,z:f64,key:Option<String>){
    if !g.multiplayer {g.events.push(json!(kind));return;}
    g.sound_sequence+=1;
    let mut event=json!({"type":kind,"owner":owner,"wx":x,"wz":z,"id":format!("{}:{}",g.sound_epoch,g.sound_sequence)});
    if let Some(key)=key {event["key"]=json!(key);}g.events.push(event);
}
pub fn effect(g:&mut Globals,kind:&str,owner:usize,x:f64,z:f64,key:Option<String>){
    sound(g,kind,owner,x,z,key);g.effects.push(Effect{kind:kind.into(),wx:x,wz:z,life:match kind {"ash"=>4.3,"explosion"=>2.5,_=>0.65},..Effect::default()});
}
pub fn voice(g:&mut Globals,a:&mut Actor,cue:&str,root_x:f64){
    if a.voice_cooldown>0.0&&cue!="win" {return;}
    a.voice_cooldown=1.5;
    g.voices.push(json!({"driver":a.driver,"cue":cue,"pan":match a.id==0 {true=>0.0,false=>((a.wx-root_x)/70.0).clamp(-0.8,0.8)},"volume":match a.id==0 {true=>1.0,false=>0.6}}));
}
pub const DRIVER_CUTENESS:[u8;12]=[5,3,4,4,5,5,1,5,5,5,3,5];
pub const DRIVER_INTELLIGENCE:[u32;12]=[3,5,4,2,4,3,4,5,5,4,5,4];
pub const START_HEDGEHOGS:u32=10;
pub const DIZZY_DURATION:f64=8.0;
pub const DRIVER_FUEL:[u8;12]=[3,2,2,3,3,2,3,5,3,3,3,3];
pub fn boost_duration(driver:usize)->f64{2.0+0.8*f64::from(DRIVER_FUEL[driver%DRIVER_FUEL.len()]-1)}
pub fn item_capacity(driver:usize,kind:&str)->u32{let intelligence=DRIVER_INTELLIGENCE[driver%DRIVER_INTELLIGENCE.len()];match kind{"hedgehog"=>10+2*(intelligence-1),"missile"|"boost"|"abomb"|"stink"=>intelligence+1,_=>0}}
pub fn recovery_interval(driver:usize)->f64{14.0-2.0*f64::from(DRIVER_CUTENESS[driver%DRIVER_CUTENESS.len()])}
pub fn hedgehog_recovery_interval(driver:usize)->f64{2.25-0.25*f64::from(DRIVER_CUTENESS[driver%DRIVER_CUTENESS.len()])}
pub const DRIVER_NAMES:[&str;12]=["Pip the Panda","Rocco the Raccoon","Felix the Fox","Benny the Bear","Ellie the Elephant","Tamar the Cricket","Elon Musk","Houston the RTPL","Avita-Jas","Pearococo","Master-Yuda","R-yeah"];
pub fn driver_name(driver:usize)->&'static str { DRIVER_NAMES[driver%DRIVER_NAMES.len()] }
impl Game {
    pub fn combat_active(&self)->bool{self.global.phase=="racing"}
    pub fn human_controlled(&self,id:usize)->bool{self.actors[id].human||id==0&&!self.global.multiplayer}
    pub fn from_seed(seed:Seed)->Result<Self,()> {
        if seed.global.arena>1||seed.bots.len()!=5||seed.player.id!=0{return Err(());}
        let mut actors=vec![seed.player];actors.extend(seed.bots);
        if actors.iter().enumerate().any(|(i,a)|a.id!=i||a.driver>=DRIVER_NAMES.len()||!a.wx.is_finite()||!a.wz.is_finite()){return Err(());}
        for i in 0..2 {
            let config=unsafe{&mut *core::ptr::addr_of_mut!(crate::CONFIG)};
            for (j,b) in blocks(i).iter().enumerate(){config[j*4..j*4+4].copy_from_slice(b);}
            if crate::set_arena(i,96.0,blocks(i).len())!=1{return Err(());}
        }
        Ok(Self{global:seed.global,actors,input_ack:[-1;6],movement_ack:[-1;6],action_ack:[-1;6],accepted_action:[-1;6],pending:vec![Vec::new();6],network_time:0.0,room:Default::default()})
    }
    pub fn view(&self,viewer:usize)->View<'_> {
        View{global:&self.global,player:&self.actors[viewer],bots:self.actors.iter().filter(|a|a.id!=viewer&&!a.inactive).collect()}
    }
    pub fn order(&self)->Vec<usize> {
        let mut ids:Vec<_>=self.actors.iter().filter(|a|!a.inactive).map(|a|a.id).collect();
        let top=ids.iter().map(|&id|self.actors[id].kills).fold(f64::NEG_INFINITY,f64::max);
        let host=match self.global.multiplayer{true=>self.global.host.filter(|&id|self.actors.get(id).is_some_and(|a|!a.inactive&&a.kills==top)),false=>None};
        ids.sort_by(|&a,&b|self.actors[b].kills.total_cmp(&self.actors[a].kills).then((Some(b)==host).cmp(&(Some(a)==host))).then(self.actors[a].deaths.cmp(&self.actors[b].deaths)).then(a.cmp(&b)));ids
    }
    pub fn action(&mut self,id:usize,action:&Action){
        if id>=self.actors.len(){return;}
        match action.kind.as_str(){
            "fire"=>{self.fire(id,action.id);},"bomb"=>{self.bomb(id,action);},"turbo"=>{self.turbo(id,action.id);},
            "chaff"=>{self.chaff(id);},"somersault"=>{self.flip(id);},
            "select"=>{let a=&mut self.actors[id];if !a.bomber&&self.global.phase!="finished"&&match action.item.as_str(){"missile"=>a.missiles>0,"hedgehog"=>a.ammo>0||a.vulcan>0.0,_=>false}{a.item=action.item.clone();}},
            "cycle"=>{let a=&mut self.actors[id];if a.bomber||self.global.phase=="finished"{return;}let items:Vec<_>=[("hedgehog",a.ammo>0||a.vulcan>0.0),("missile",a.missiles>0)].into_iter().filter(|(_,ok)|*ok).map(|(s,_)|s).collect();if !items.is_empty(){let next=items.iter().position(|s|*s==a.item).map_or(0,|i|(i+1)%items.len());a.item=items[next].into();}},
            _=>{}
        }
    }
    pub fn apply_pending(&mut self,id:usize,sequence:i64){
        while self.pending[id].first().is_some_and(|a|a.after_move<=sequence){
            let action=self.pending[id].remove(0);self.action(id,&action);if let Some(id_action)=action.id{self.action_ack[id]=id_action as i64;}
        }
    }
    pub fn validate(&self,frame:&Frame)->bool {
        if !frame.dt.is_finite()||frame.dt<0.0||frame.dt>0.05||frame.inputs.len()>6{return false;}
        let mut seen=[false;6];
        for input in &frame.inputs {
            if input.actor>=6||seen[input.actor]||input.keys&!63!=0||input.steer.is_some_and(|s|!s.is_finite()||s.abs()>1.0)||input.actions.len()>8{return false;}seen[input.actor]=true;
            let mut previous=self.movement_ack[input.actor];
            if let Some(moves)=&input.moves {
                if moves.len()>8{return false;}
                for movement in moves {
                    if movement.keys&!31!=0||movement.steer.is_some_and(|s|!s.is_finite()||s.abs()>1.0)||movement.sequence<0{return false;}
                    if movement.sequence<=previous{continue;}if movement.sequence!=previous+1{return false;}previous=movement.sequence;
                }
            }
            for action in &input.actions {
                if !matches!(action.kind.as_str(),"fire"|"turbo"|"chaff"|"somersault"|"cycle"|"select"|"bomb")||!action.wx.is_finite()||!action.wz.is_finite()||action.after_move< -1||action.after_move>previous+128{return false;}
                if action.kind=="bomb"&&(action.wx.abs()>96.0||action.wz.abs()>96.0||action.bomb_kind.as_ref().is_some_and(|s|s!="stink"&&s!="abomb")){return false;}
                if action.kind=="select"&&!matches!(action.item.as_str(),"hedgehog"|"missile"){return false;}
            }
        }true
    }
}
const IO_MAX:usize=512*1024;
static mut IO:[u8;IO_MAX]=[0;IO_MAX];
static mut WORLD:Option<Game>=None;
static mut OUTPUT:Vec<u8>=Vec::new();
#[no_mangle]pub extern "C" fn game_io_ptr()->*mut u8{core::ptr::addr_of_mut!(IO).cast()}
#[no_mangle]pub extern "C" fn game_init(len:usize)->u32{
    if len>IO_MAX{return 0;}
    let input=unsafe{core::slice::from_raw_parts(game_io_ptr(),len)};
    let Ok(seed)=serde_json::from_slice::<Seed>(input) else{return 0;};
    let Ok(game)=Game::from_seed(seed) else{return 0;};
    unsafe{*core::ptr::addr_of_mut!(WORLD)=Some(game);}1
}
#[no_mangle]pub extern "C" fn game_frame(len:usize)->u32{
    if len>16384{return 0;}
    let input=unsafe{core::slice::from_raw_parts(game_io_ptr(),len)};
    let Ok(frame)=serde_json::from_slice::<Frame>(input) else{return 0;};
    let Some(game)=(unsafe{&mut *core::ptr::addr_of_mut!(WORLD)}) else{return 0;};
    if !game.validate(&frame){return 0;}game.tick(frame);1
}
#[no_mangle]pub extern "C" fn game_snapshot(viewer:usize)->usize{
    if viewer>=6{return 0;}
    let Some(game)=(unsafe{&*core::ptr::addr_of!(WORLD)}) else{return 0;};
    let output=unsafe{&mut *core::ptr::addr_of_mut!(OUTPUT)};output.clear();
    match serde_json::to_writer(&mut *output,&game.view(viewer)){Ok(())=>output.len(),Err(_)=>0}
}
#[no_mangle]pub extern "C" fn game_output_ptr()->*const u8{unsafe{(&*core::ptr::addr_of!(OUTPUT)).as_ptr()}}
#[no_mangle]pub extern "C" fn game_drain(){if let Some(game)=unsafe{&mut *core::ptr::addr_of_mut!(WORLD)}{game.global.events.clear();game.global.voices.clear();}}
#[no_mangle]pub extern "C" fn game_packet(viewer:usize)->usize{
    if viewer>=6{return 0;}let Some(game)=(unsafe{&*core::ptr::addr_of!(WORLD)}) else{return 0;};
    let output=unsafe{&mut *core::ptr::addr_of_mut!(OUTPUT)};
    match game.encode_packet(viewer,output){Ok(())=>output.len(),Err(_)=>0}
}
// Local test harness only; no network route can call these fixture operations.
#[no_mangle]pub extern "C" fn game_test_snapshot()->usize{
    let Some(game)=(unsafe{&*core::ptr::addr_of!(WORLD)})else{return 0;};
    let output=unsafe{&mut *core::ptr::addr_of_mut!(OUTPUT)};output.clear();
    let view=View{global:&game.global,player:&game.actors[0],bots:game.actors.iter().skip(1).collect()};
    match serde_json::to_writer(&mut *output,&view){Ok(())=>output.len(),Err(_)=>0}
}
#[no_mangle]pub extern "C" fn game_test_edit(len:usize)->u32{
    if len>IO_MAX{return 0;}let input=unsafe{core::slice::from_raw_parts(game_io_ptr(),len)};
    let Ok(seed)=serde_json::from_slice::<Seed>(input)else{return 0;};let Ok(mut replacement)=Game::from_seed(seed)else{return 0;};
    let Some(game)=(unsafe{&mut *core::ptr::addr_of_mut!(WORLD)})else{return 0;};
    for (old,new) in game.actors.iter().zip(&mut replacement.actors){new.credits=old.credits.clone();}
    game.global=replacement.global;game.actors=replacement.actors;1
}
