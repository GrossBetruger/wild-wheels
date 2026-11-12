use super::*;
use serde::{Serialize,Serializer,Deserialize};
use serde::ser::SerializeMap;

struct ShotMeta<'a>(&'a Shot);
impl Serialize for ShotMeta<'_>{fn serialize<S:Serializer>(&self,serializer:S)->Result<S::Ok,S::Error>{
    let s=self.0;let mut map=serializer.serialize_map(None)?;
    macro_rules! e{($key:literal,$value:expr)=>{map.serialize_entry($key,&$value)?;};}
    e!("id",s.id);e!("owner",s.owner);e!("kind",s.kind);e!("wx",s.wx);e!("wz",s.wz);e!("heading",s.heading);e!("speed",s.speed);e!("height",s.height);e!("vy",s.vy);e!("life",s.life);e!("age",s.age);e!("bounces",s.bounces);e!("target",s.target);e!("vulcan",s.vulcan);e!("trail",[0u8;0]);
    if let Some(id)=s.action_id{e!("actionId",id);}if let Some(id)=s.decoy{e!("decoy",id);}if let Some(id)=s.decoy_owner{e!("decoyOwner",id);}if let Some(p)=&s.decoy_center{e!("decoyCenter",p);}if let Some(age)=s.orbit_age{e!("orbitAge",age);e!("orbitAngle",s.orbit_angle);e!("orbitRadius",s.orbit_radius);e!("orbitHeight",s.orbit_height);e!("orbitDirection",s.orbit_direction);if let Some(center)=&s.orbit_center{e!("orbitCenter",center);}}if s.reflected{e!("reflected",true);}if let Some(id)=s.repelled_from{e!("repelledFrom",id);}if s.chaffed{e!("chaffed",true);}map.end()
}}
struct GlobalMeta<'a>{game:&'a Game,viewer:usize}
impl Serialize for GlobalMeta<'_>{fn serialize<S:Serializer>(&self,serializer:S)->Result<S::Ok,S::Error>{
    let g=&self.game.global;let mut map=serializer.serialize_map(None)?;
    macro_rules! e{($key:literal,$value:expr)=>{map.serialize_entry($key,&$value)?;};}
    e!("mode",g.mode);e!("phase",g.phase);e!("arena",g.arena);e!("elapsed",g.elapsed);e!("countdown",g.countdown);e!("duration",g.duration);e!("targetScore",g.target_score);e!("finishTime",g.finish_time);e!("finishCountdown",g.finish_countdown);e!("winner",g.winner);e!("multiplayer",g.multiplayer);e!("soundEpoch",g.sound_epoch);e!("soundSequence",g.sound_sequence);e!("shake",g.shake);e!("projectileSequence",g.projectile_sequence);e!("bombSequence",g.bomb_sequence);e!("chaffSequence",g.chaff_sequence);e!("killSequence",g.kill_sequence);
    e!("specialAbilities",g.special_abilities);e!("timeStop",g.time_stop);e!("timeOwner",g.time_owner);
    e!("host",g.host);e!("bombs",g.bombs);e!("chaffClouds",g.chaff_clouds);e!("stinkClouds",g.stink_clouds);e!("supplies",g.supplies);e!("effects",g.effects);e!("voices",g.voices);e!("killFeed",self.game.viewer_feed(self.viewer));
    let events=self.game.viewer_events(self.viewer);
    e!("events",events);e!("skids",[0u8;0]);e!("driftParticles",[0u8;0]);e!("projectiles",g.projectiles.iter().map(ShotMeta).collect::<Vec<_>>());map.end()
}}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
struct WorldMeta<'a>{#[serde(flatten)]global:GlobalMeta<'a>,#[serde(flatten)]player:&'a Actor,bots:Vec<&'a Actor>,rank:usize,finish_rank:Option<usize>}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
struct State<'a>{#[serde(rename="type")]kind:&'static str,wire_version:u32,time:f64,you:usize,input_sequence:i64,movement_sequence:i64,action_sequence:i64,#[serde(flatten)]room:&'a std::collections::BTreeMap<String,serde_json::Value>,world:WorldMeta<'a>}
#[derive(Serialize)]
struct Layout{skids:usize,particles:usize,trails:Vec<usize>}
#[derive(Serialize)]
struct Envelope<'a>{layout:Layout,state:State<'a>}
impl Game{
    pub(super) fn viewer_feed(&self,viewer:usize)->Vec<Kill>{
        let label=|id:usize|match id==viewer{true=>"YOU".into(),false=>self.actors.get(id).map(|a|a.name.clone().unwrap_or_else(||driver_name(a.driver).split(' ').next().unwrap_or("Player").into())).unwrap_or_else(||"Player".into())};
        self.global.kill_feed.iter().map(|entry|{let mut entry=entry.clone();entry.text=format!("{} → {}",label(entry.attacker),label(entry.victim));entry}).collect()
    }
    pub(super) fn viewer_events(&self,viewer:usize)->Vec<serde_json::Value>{
        let actor=&self.actors[viewer];let g=&self.global;
        let mut events:Vec<_>=g.events.iter().filter(|event|event.as_str()!=Some("victory")&&event.as_str()!=Some("finish")).filter(|event|actor.bomber||event.is_string()||event["type"]=="bombExplosion"||event["owner"].as_u64()==Some(viewer as u64)||event["wx"].as_f64().zip(event["wz"].as_f64()).is_some_and(|(x,z)|distance(x,z,actor.wx,actor.wz)<90.0)).cloned().collect();
        if g.events.iter().any(|e|matches!(e.as_str(),Some("victory"|"finish"))){events.push(json!(match self.order().first()==Some(&viewer){true=>"victory",false=>"finish"}));}events
    }
    pub(super) fn encode_packet(&self,viewer:usize,output:&mut Vec<u8>)->Result<(),()>{
        let g=&self.global;
        if g.skids.len()>512||g.drift_particles.len()>512||g.projectiles.len()>512||g.projectiles.iter().any(|s|s.trail.len()>24){return Err(());}
        let order=self.order();let rank=order.iter().position(|&id|id==viewer).map_or(0,|i|i+1);
        let world=WorldMeta{global:GlobalMeta{game:self,viewer},player:&self.actors[viewer],bots:self.actors.iter().filter(|a|a.id!=viewer&&!a.inactive).collect(),rank,finish_rank:g.finish_rank.map(|_|rank)};
        let state=State{kind:"state",wire_version:3,time:self.network_time,you:viewer,input_sequence:self.input_ack[viewer],movement_sequence:self.movement_ack[viewer],action_sequence:self.action_ack[viewer],room:&self.room,world};
        let envelope=Envelope{layout:Layout{skids:g.skids.len(),particles:g.drift_particles.len(),trails:g.projectiles.iter().map(|s|s.trail.len()).collect()},state};
        output.clear();output.extend_from_slice(&[0;16]);serde_json::to_writer(&mut *output,&envelope).map_err(|_|())?;let meta=output.len()-16;while output.len()%4!=0{output.push(0);}let offset=output.len();
        let pack=|out:&mut Vec<u8>,v:f64,scale:f64|->Result<(),()>{let value=v*scale;let floor=value.floor();let rounded=match value-floor<0.5{true=>floor,false=>floor+1.0};if !rounded.is_finite()||rounded< i32::MIN as f64||rounded>i32::MAX as f64{return Err(());}out.extend_from_slice(&(rounded as i32).to_le_bytes());Ok(())};
        for s in &g.skids{for(v,scale)in [s.ax,s.az,s.bx,s.bz,s.time,s.owner as f64].into_iter().zip([100.0,100.0,100.0,100.0,1000.0,1.0]){pack(output,v,scale)?;}}
        for p in &g.drift_particles{for(v,scale)in [p.wx,p.wz,p.height,p.vx,p.vz,p.vy,p.age,p.life,match p.kind.as_str(){"spark"=>1.0,_=>0.0},p.level as f64,p.owner as f64].into_iter().zip([100.0,100.0,100.0,100.0,100.0,100.0,1000.0,1000.0,1.0,1.0,1.0]){pack(output,v,scale)?;}}
        for shot in &g.projectiles{for p in &shot.trail{for value in [p.wx,p.wz,p.height]{pack(output,value,100.0)?;}}}
        let total=output.len();if total>512*1024{return Err(());}output[0..4].copy_from_slice(&0x33535757u32.to_le_bytes());output[4..8].copy_from_slice(&(meta as u32).to_le_bytes());output[8..12].copy_from_slice(&(((total-offset)/4)as u32).to_le_bytes());output[12..16].copy_from_slice(&(total as u32).to_le_bytes());Ok(())
    }
}
#[derive(Deserialize)]struct ReceivedLayout{skids:usize,particles:usize,trails:Vec<usize>}
#[derive(Deserialize)]#[serde(rename_all="camelCase")]struct ReceivedState{
    #[serde(rename="type")]kind:String,wire_version:u32,time:f64,you:usize,
    #[serde(default="negative")]input_sequence:i64,#[serde(default="negative")]movement_sequence:i64,#[serde(default="negative")]action_sequence:i64,
    world:Seed,#[serde(flatten)]room:std::collections::BTreeMap<String,serde_json::Value>,
}
fn negative()->i64{-1}
#[derive(Deserialize)]struct Received{layout:ReceivedLayout,state:ReceivedState}
pub(super) fn decode_packet(input:&[u8])->Result<(Game,usize),()>{
    if input.len()<16||input.len()>512*1024{return Err(());}
    let uint=|at:usize|u32::from_le_bytes(input[at..at+4].try_into().unwrap()) as usize;
    if uint(0)!=0x33535757||uint(12)!=input.len(){return Err(());}
    let meta=uint(4);let n=uint(8);let offset=(16+meta+3)/4*4;
    if offset>input.len()||offset+n*4!=input.len(){return Err(());}
    let Received{layout,state}=serde_json::from_slice::<Received>(&input[16..16+meta]).map_err(|_|())?;
    if layout.skids>512||layout.particles>512||layout.trails.len()>512||layout.trails.iter().any(|&n|n>24)||layout.skids*6+layout.particles*11+layout.trails.iter().sum::<usize>()*3!=n||state.kind!="state"||state.wire_version!=3||state.you>=6||!state.time.is_finite()||state.world.player.id!=state.you||state.world.global.arena>1{return Err(());}
    let Seed{mut global,player,bots}=state.world;
    if !global.skids.is_empty()||!global.drift_particles.is_empty()||global.projectiles.len()!=layout.trails.len()||global.projectiles.iter().any(|s|!s.trail.is_empty()){return Err(());}
    let mut actors:Vec<_>=(0..6).map(|id|Actor{id,inactive:true,destroyed:1e9,..Actor::default()}).collect();let mut seen=[false;6];
    for a in std::iter::once(player).chain(bots){if a.id>=6||seen[a.id]{return Err(());}let id=a.id;seen[id]=true;actors[id]=a;}
    let mut at=offset;
    let mut read=|scale:f64|{let value=i32::from_le_bytes(input[at..at+4].try_into().unwrap()) as f64/scale;at+=4;value};
    for _ in 0..layout.skids{global.skids.push(Skid{ax:read(100.0),az:read(100.0),bx:read(100.0),bz:read(100.0),time:read(1000.0),owner:read(1.0) as usize});}
    for _ in 0..layout.particles{global.drift_particles.push(Particle{wx:read(100.0),wz:read(100.0),height:read(100.0),vx:read(100.0),vz:read(100.0),vy:read(100.0),age:read(1000.0),life:read(1000.0),kind:match read(1.0)==1.0{true=>"spark",false=>"smoke"}.into(),level:read(1.0) as u32,owner:read(1.0) as usize});}
    for(shot,count)in global.projectiles.iter_mut().zip(layout.trails){for _ in 0..count{shot.trail.push(Sample{wx:read(100.0),wz:read(100.0),height:read(100.0)});}}
    let root=actors.remove(0);let mut game=Game::from_seed(Seed{global,player:root,bots:actors})?;
    game.network_time=state.time;game.input_ack[state.you]=state.input_sequence;game.movement_ack[state.you]=state.movement_sequence;game.action_ack[state.you]=state.action_sequence;game.room=state.room;Ok((game,state.you))
}
#[no_mangle]pub extern "C" fn game_cues(viewer:usize)->usize{
    if viewer>=6{return 0;}let Some(game)=(unsafe{&*core::ptr::addr_of!(super::WORLD)})else{return 0;};
    let output=unsafe{&mut *core::ptr::addr_of_mut!(super::OUTPUT)};output.clear();
    match serde_json::to_writer(&mut *output,&json!({"epoch":game.global.sound_epoch,"events":game.viewer_events(viewer),"voices":game.global.voices})){Ok(())=>output.len(),Err(_)=>0}
}
#[no_mangle]pub extern "C" fn packet_merge(packet_len:usize,cues_len:usize)->usize{
    if packet_len<16||packet_len+cues_len>super::IO_MAX{return 0;}
    let input=unsafe{core::slice::from_raw_parts(super::game_io_ptr(),packet_len+cues_len)};
    let Ok((mut game,viewer))=decode_packet(&input[..packet_len])else{return 0;};
    #[derive(Deserialize)]struct Cues{events:Vec<serde_json::Value>,voices:Vec<serde_json::Value>}
    let Ok(cues)=serde_json::from_slice::<Cues>(&input[packet_len..])else{return 0;};
    if cues.events.len()>64||cues.voices.len()>16{return 0;}game.global.events=cues.events;game.global.voices=cues.voices;
    let output=unsafe{&mut *core::ptr::addr_of_mut!(super::OUTPUT)};
    match game.encode_packet(viewer,output){Ok(())=>output.len(),Err(_)=>0}
}
