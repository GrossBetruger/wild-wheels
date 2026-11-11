use super::*;
use std::collections::VecDeque;
use std::collections::{BTreeMap,BTreeSet};
mod feedback;
#[derive(Clone)]struct Received{time:f64,offset:f64,game:Game}
pub struct Client{
    viewer:usize,pred:Game,display:Game,frames:VecDeque<Received>,history:Vec<Move>,
    next_sequence:i64,last_sent:i64,accumulator:f64,received:f64,
    error:[f64;4],offset:f64,presented:f64,last_now:f64,packet_sequence:u64,
    ops:Vec<feedback::Op>,local_shots:Vec<feedback::LocalShot>,next_action:u32,last_sent_action:i64,fire_tick:i64,chaff_tick:i64,
    rejected:BTreeSet<String>,pending_sounds:Vec<feedback::PendingSound>,seen:BTreeSet<String>,seen_order:VecDeque<String>,cue_times:BTreeMap<String,f64>,audio:Vec<serde_json::Value>,voice_output:Vec<serde_json::Value>,
    local_drift:Globals,emitter:Option<Actor>,emitter_level:u32,drift_last:Option<f64>,drift_previous:Option<(f64,f64,f64)>,
}
fn pose_copy(target:&mut Actor,source:&Actor){
    target.wx=source.wx;target.wz=source.wz;target.heading=source.heading;target.motion_heading=source.motion_heading;target.camera_heading=source.camera_heading;target.speed=source.speed;target.drift=source.drift;target.was_drifting=source.was_drifting;target.boost=source.boost;target.yaw=source.yaw;target.somersault=source.somersault;target.somersault_cooldown=source.somersault_cooldown;target.dizzy=source.dizzy;
}
fn move_one(game:&mut Game,id:usize,command:&Move){
    if game.global.phase!="racing"||game.global.finish_countdown.is_some()||game.actors[id].destroyed>0.0||game.actors[id].bomber{return;}
    let steer=command.steer.unwrap_or(f64::from(u8::from(command.keys&4!=0))-f64::from(u8::from(command.keys&8!=0)));
    game.move_cart(id,steer,command.keys,1.0/60.0,true);
}
impl Client{
    fn new(game:Game,viewer:usize,now:f64)->Self{
        let sequence=game.movement_ack[viewer];let time=game.network_time;let action=game.action_ack[viewer];
        let mut client=Self{viewer,pred:game.clone(),display:game.clone(),frames:VecDeque::from([Received{time,offset:now-time,game:game.clone()}]),history:Vec::new(),next_sequence:sequence+1,last_sent:sequence,accumulator:0.0,received:now,error:[0.0;4],offset:now-time,presented:time-0.1,last_now:now,packet_sequence:0,
            ops:Vec::new(),local_shots:Vec::new(),next_action:(action+1)as u32,last_sent_action:action,fire_tick:sequence,chaff_tick:sequence,rejected:BTreeSet::new(),pending_sounds:Vec::new(),seen:BTreeSet::new(),seen_order:VecDeque::new(),cue_times:BTreeMap::new(),audio:Vec::new(),voice_output:Vec::new(),local_drift:Globals::default(),emitter:None,emitter_level:0,drift_last:None,drift_previous:None};
        client.feedback_accept(&game,now,true);client
    }
    fn accept(&mut self,game:Game,viewer:usize,now:f64){
        let previous=&self.frames.back().unwrap().game;
        let identity=viewer!=self.viewer||game.global.arena!=previous.global.arena||game.global.sound_epoch!=previous.global.sound_epoch||game.global.elapsed<previous.global.elapsed;
        let reset=identity||game.global.phase!=previous.global.phase||(game.actors[viewer].destroyed>0.0)!=(previous.actors[viewer].destroyed>0.0);
        if identity{*self=Self::new(game,viewer,now);return;}
        let old=&self.pred.actors[viewer];let old_pose=[old.wx+self.error[0],old.wz+self.error[1],old.heading+self.error[2],old.camera_heading+self.error[3]];
        let acknowledged=game.movement_ack[viewer];self.history.retain(|command|command.sequence>acknowledged);
        self.feedback_accept(&game,now,reset);
        self.pred=game.clone();self.pred.actors[viewer].drift_trail=None;self.pred.actors[viewer].drift_emit=0.0;
        self.replay_maneuvers(acknowledged,true);
        for command in self.history.clone(){move_one(&mut self.pred,viewer,&command);self.replay_maneuvers(command.sequence,false);}
        self.pred.global.events.clear();
        let new=&self.pred.actors[viewer];
        self.error=match reset||distance(old_pose[0],old_pose[1],new.wx,new.wz)>18.0{true=>[0.0;4],false=>[old_pose[0]-new.wx,old_pose[1]-new.wz,angle(old_pose[2],new.heading),angle(old_pose[3],new.camera_heading)]};
        self.received=now;self.display=game.clone();let time=game.network_time;
        if reset{self.frames.clear();self.presented=time-0.1;self.offset=now-time;}
        if self.frames.back().is_some_and(|f|f.time==time){self.frames.pop_back();}
        self.frames.push_back(Received{time,offset:now-time,game});while self.frames.len()>32{self.frames.pop_front();}
    }
    fn frame(&mut self,dt:f64,keys:u32,steer:Option<f64>,now:f64){
        let fresh=now-self.received<0.5;
        if fresh&&self.pred.global.phase=="racing"&&self.history.len()<120&&!self.pred.actors[self.viewer].bomber{
            self.accumulator+=dt.clamp(0.0,0.05);
            while self.accumulator>=1.0/60.0-1e-8&&self.history.len()<120{
                let command=Move{sequence:self.next_sequence,keys:keys&31,steer};self.next_sequence+=1;
                self.pred.global.events.clear();move_one(&mut self.pred,self.viewer,&command);self.replay_maneuvers(command.sequence,false);
                for cue in std::mem::take(&mut self.pred.global.events){let kind=cue.as_str().or_else(||cue["type"].as_str()).unwrap_or("");self.emit(kind,now,None,false);}
                self.history.push(command);self.accumulator-=1.0/60.0;
            }
        }
        let elapsed=(now-self.last_now).clamp(0.0,0.25);self.last_now=now;
        let best=self.frames.iter().map(|f|f.offset).fold(f64::INFINITY,f64::min);self.offset+=(best-self.offset).clamp(-elapsed*0.1,elapsed*0.1);
        let latest=self.frames.back().unwrap();let target=latest.time.min(now-self.offset-0.1);self.presented=latest.time.min(self.presented.max(target));
        let index=self.frames.iter().position(|f|f.time>=self.presented).unwrap_or(self.frames.len()-1);let before=&self.frames[index.saturating_sub(1)];let after=&self.frames[index];
        let fraction=match after.time==before.time{true=>1.0,false=>((self.presented-before.time)/(after.time-before.time)).clamp(0.0,1.0)};
        for a in &mut self.display.actors{
            let old=&before.game.actors[a.id];let new=&after.game.actors[a.id];
            if a.destroyed>0.0||old.destroyed>0.0||new.destroyed>0.0||old.inactive||new.inactive||distance(old.wx,old.wz,new.wx,new.wz)>18.0||distance(a.wx,a.wz,new.wx,new.wz)>18.0{continue;}
            a.wx=old.wx+(new.wx-old.wx)*fraction;a.wz=old.wz+(new.wz-old.wz)*fraction;a.heading=old.heading+angle(new.heading,old.heading)*fraction;a.camera_heading=old.camera_heading+angle(new.camera_heading,old.camera_heading)*fraction;
            if old.somersault>0.0&&new.somersault>0.0{a.somersault=old.somersault+(new.somersault-old.somersault)*fraction;}
        }
        for shot in &mut self.display.global.projectiles{
            let a=before.game.global.projectiles.iter().find(|s|s.id==shot.id);let b=after.game.global.projectiles.iter().find(|s|s.id==shot.id);
            if let(Some(a),Some(b))=(a,b){shot.wx=a.wx+(b.wx-a.wx)*fraction;shot.wz=a.wz+(b.wz-a.wz)*fraction;shot.height=a.height+(b.height-a.height)*fraction;shot.heading=a.heading+angle(b.heading,a.heading)*fraction;}
        }
        self.display.global.elapsed=match latest.game.global.phase.as_str(){"racing"=>(latest.game.global.elapsed-(latest.time-self.presented).max(0.0)).max(0.0),_=>latest.game.global.elapsed};
        let id=self.viewer;pose_copy(&mut self.display.actors[id],&self.pred.actors[id]);
        if fresh&&self.accumulator>1e-8&&!self.pred.actors[id].bomber{
            // Preview inside Wasm. No temporary JS actors or boundary round trips.
            let command=Move{sequence:self.next_sequence,keys:keys&31,steer};let old=self.pred.actors[id].clone();
            let lengths=(self.pred.global.events.len(),self.pred.global.effects.len(),self.pred.global.skids.len(),self.pred.global.drift_particles.len());let shake=self.pred.global.shake;move_one(&mut self.pred,id,&command);
            let future=&self.pred.actors[id];let fraction=(self.accumulator*60.0).min(1.0);let a=&mut self.display.actors[id];
            a.wx+=(future.wx-old.wx)*fraction;a.wz+=(future.wz-old.wz)*fraction;a.heading+=angle(future.heading,old.heading)*fraction;a.motion_heading+=angle(future.motion_heading,old.motion_heading)*fraction;a.camera_heading+=angle(future.camera_heading,old.camera_heading)*fraction;
            a.somersault=old.somersault+(future.somersault-old.somersault)*fraction;a.somersault_cooldown=old.somersault_cooldown+(future.somersault_cooldown-old.somersault_cooldown)*fraction;a.dizzy=old.dizzy+(future.dizzy-old.dizzy)*fraction;self.pred.actors[id]=old;
            self.pred.global.events.truncate(lengths.0);self.pred.global.effects.truncate(lengths.1);self.pred.global.skids.truncate(lengths.2);self.pred.global.drift_particles.truncate(lengths.3);self.pred.global.shake=shake;
        }
        let decay=(-dt.max(0.0)*15.0).exp();for error in &mut self.error{*error*=decay;}
        let a=&mut self.display.actors[id];a.wx+=self.error[0];a.wz+=self.error[1];a.heading+=self.error[2];a.camera_heading+=self.error[3];
        self.feedback_render(now);
        if keys&32!=0{let action=Action{kind:"fire".into(),after_move: -1,..Action::default()};if self.do_action(action,now){self.feedback_render(now);}}
        self.feedback_drift(now,fresh);
        if self.audio.len()>64{self.audio.drain(..self.audio.len()-64);}self.display.global.events=self.audio.clone();self.display.global.voices=self.voice_output.clone();
    }
    fn outbound(&mut self,keys:u32)->serde_json::Value{
        let names=|mask:u32|[(1,"arrowup"),(2,"arrowdown"),(4,"arrowright"),(8,"arrowleft"),(16,"shift")].into_iter().filter(|(bit,_)|mask&bit!=0).map(|(_,name)|name).collect::<Vec<_>>();
        let moves:Vec<_>=self.history.iter().filter(|c|c.sequence>self.last_sent).take(8).map(|c|{let mut value=json!({"sequence":c.sequence,"keys":names(c.keys)});if let Some(steer)=c.steer{value["steer"]=json!(steer);}value}).collect();
        if let Some(last)=moves.last(){self.last_sent=last["sequence"].as_i64().unwrap();}
        let sequence=self.packet_sequence;self.packet_sequence+=1;
        let actions=self.feedback_commands();json!({"type":"input","sequence":sequence,"keys":names(keys),"actions":actions,"epoch":self.pred.global.sound_epoch,"moves":moves})
    }
}
static mut CLIENT:Option<Client>=None;
#[no_mangle]pub extern "C" fn client_accept(len:usize,now:f64)->u32{
    if len>super::IO_MAX||!now.is_finite(){return 0;}
    let input=unsafe{core::slice::from_raw_parts(super::game_io_ptr(),len)};
    let Ok((game,viewer))=super::packet::decode_packet(input) else{return 0;};
    let client=unsafe{&mut *core::ptr::addr_of_mut!(CLIENT)};
    match client{Some(client)=>client.accept(game,viewer,now),None=>*client=Some(Client::new(game,viewer,now))}1
}
#[no_mangle]pub extern "C" fn client_frame(dt:f64,keys:u32,steer:f64,now:f64)->u32{
    if !dt.is_finite()||!(0.0..=0.05).contains(&dt)||keys&!63!=0||!now.is_finite()||!steer.is_finite()||!(steer.abs()<=1.0||steer==2.0){return 0;}
    let Some(client)=(unsafe{&mut *core::ptr::addr_of_mut!(CLIENT)}) else{return 0;};
    client.frame(dt,keys,match steer==2.0{true=>None,false=>Some(steer)},now);1
}
#[no_mangle]pub extern "C" fn client_outbound(keys:u32)->usize{
    let Some(client)=(unsafe{&mut *core::ptr::addr_of_mut!(CLIENT)}) else{return 0;};
    let output=unsafe{&mut *core::ptr::addr_of_mut!(super::OUTPUT)};output.clear();
    match serde_json::to_writer(&mut *output,&client.outbound(keys)){Ok(())=>output.len(),Err(_)=>0}
}
#[no_mangle]pub extern "C" fn client_snapshot()->usize{
    let Some(client)=(unsafe{&*core::ptr::addr_of!(CLIENT)}) else{return 0;};
    let output=unsafe{&mut *core::ptr::addr_of_mut!(super::OUTPUT)};output.clear();
    match serde_json::to_writer(&mut *output,&client.display.view(client.viewer)){Ok(())=>output.len(),Err(_)=>0}
}
#[no_mangle]pub extern "C" fn client_resend(){if let Some(client)=unsafe{&mut *core::ptr::addr_of_mut!(CLIENT)}{client.last_sent= -1;client.last_sent_action= -1;}}
#[no_mangle]pub extern "C" fn client_present()->usize{
    let Some(client)=(unsafe{&*core::ptr::addr_of!(CLIENT)})else{return 0;};super::presentation::present(&client.display,client.viewer)
}
#[no_mangle]pub extern "C" fn client_action(len:usize,now:f64)->u32{
    if len>2048||!now.is_finite(){return 0;}
    let input=unsafe{core::slice::from_raw_parts(super::game_io_ptr(),len)};
    let Ok(action)=serde_json::from_slice::<Action>(input) else{return 0;};
    let Some(client)=(unsafe{&mut *core::ptr::addr_of_mut!(CLIENT)})else{return 0;};
    u32::from(client.do_action(action,now))
}
#[no_mangle]pub extern "C" fn client_drain(){if let Some(client)=unsafe{&mut *core::ptr::addr_of_mut!(CLIENT)}{client.audio.clear();client.voice_output.clear();client.display.global.events.clear();client.display.global.voices.clear();}}
