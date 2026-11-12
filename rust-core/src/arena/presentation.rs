use super::*;
static mut NUMBERS:Vec<f64>=Vec::new();
static mut TEXT:Vec<u8>=Vec::new();
static mut TEXT_VERSION:u32=0;
fn rgb(hex:&str)->f64{u32::from_str_radix(hex.strip_prefix('#').unwrap_or(hex),16).unwrap_or(0x8456cf)as f64}
pub(super) fn present(game:&Game,viewer:usize)->usize{
    let g=&game.global;let order=game.order();let rank=order.iter().position(|&id|id==viewer).map_or(0,|i|i+1);
    let data=unsafe{&mut *core::ptr::addr_of_mut!(NUMBERS)};data.clear();
    let phase=match g.phase.as_str(){"ready"=>0.0,"countdown"=>1.0,"racing"=>2.0,"paused"=>3.0,"finished"=>4.0,_=>0.0};
    data.extend_from_slice(&[1.0,game.actors.len()as f64,g.skids.len()as f64,g.drift_particles.len()as f64,g.projectiles.len()as f64,g.supplies.len()as f64,g.bombs.len()as f64,g.chaff_clouds.len()as f64,g.stink_clouds.len()as f64,g.effects.len()as f64,phase,g.arena as f64,g.elapsed,g.countdown,g.duration,g.target_score,g.finish_rank.map_or(-1.0,|_|rank as f64),g.finish_time.unwrap_or(-1.0),g.finish_countdown.unwrap_or(-1.0),rank as f64,g.shake,viewer as f64,g.sound_epoch as f64,game.movement_ack[viewer]as f64,game.action_ack[viewer]as f64,0.0,0.0,0.0,0.0,0.0,0.0,0.0]);
    for a in &game.actors{
        data.extend_from_slice(&[a.id as f64,a.driver as f64,a.wx,a.wz,a.heading,a.motion_heading,a.camera_heading,a.speed,a.health,a.kills,a.deaths as f64,a.shield,a.destroyed,a.boost,a.drift,f64::from(a.was_drifting),a.yaw,a.spin,a.celebrate,a.stun,a.vulcan,a.chaff as f64,a.chaff_cooldown,a.ammo as f64,a.missiles as f64,a.turbos as f64,a.fire_cooldown,a.somersault,a.somersault_cooldown,a.somersault_camera_start,a.dizzy,f64::from(a.bomber),f64::from(a.inactive),f64::from(a.human),a.bomb_ammo as f64,a.stink_ammo as f64,a.bomb_reload,a.notice_time,a.wall_cooldown,a.voice_cooldown,match a.item.as_str(){"missile"=>1.0,"hedgehog"=>0.0,_=>-1.0},rgb(&a.color),f64::from(a.afk),a.heal_timer,a.hedge_shield,a.tehilim,a.special_cooldown,a.special_active]);
    }
    for s in &g.skids{data.extend_from_slice(&[s.owner as f64,s.ax,s.az,s.bx,s.bz,s.time]);}
    for p in &g.drift_particles{data.extend_from_slice(&[p.owner as f64,p.wx,p.wz,p.height,p.vx,p.vz,p.vy,p.age,p.life,match p.kind.as_str(){"spark"=>1.0,_=>0.0},p.level as f64,0.0]);}
    for s in &g.projectiles{
        data.extend_from_slice(&[s.id as f64,s.owner as f64,match s.kind.as_str(){"missile"=>1.0,_=>0.0},s.wx,s.wz,s.heading,s.speed,s.height,s.vy,s.life,s.age,f64::from(s.vulcan),s.action_id.map_or(-1.0,|id|id as f64),s.target.map_or(-1.0,|id|id as f64),s.decoy.map_or(-1.0,|id|id as f64),s.orbit_age.unwrap_or(-1.0),s.orbit_angle,s.orbit_radius,s.orbit_height,f64::from(s.chaffed),s.trail.len()as f64,s.orbit_direction,s.orbit_center.as_ref().map_or(0.0,|p|p.wx),s.orbit_center.as_ref().map_or(0.0,|p|p.wz)]);
        for i in 0..24{match s.trail.get(i){Some(p)=>data.extend_from_slice(&[p.wx,p.wz,p.height]),None=>data.extend_from_slice(&[0.0;3])}}
    }
    for s in &g.supplies{data.extend_from_slice(&[s.id as f64,s.wx,s.wz,match s.kind.as_str(){"missile"=>1.0,"boost"=>2.0,"health"=>3.0,"hedgeproof"=>4.0,"tehilim"=>5.0,_=>0.0},s.cooldown,s.version as f64,s.collector.map_or(-1.0,|id|id as f64),0.0]);}
    for b in &g.bombs{data.extend_from_slice(&[b.id as f64,b.owner as f64,match b.kind.as_str(){"stink"=>1.0,_=>0.0},b.wx,b.wz,b.age,b.action_id.map_or(-1.0,|id|id as f64),rgb(&b.color),0.0,0.0]);}
    for c in &g.chaff_clouds{data.extend_from_slice(&[c.id as f64,c.owner as f64,c.wx,c.wz,c.origin_x,c.origin_z,c.age,c.life,c.diversions as f64,c.diverted_at.unwrap_or(-1.0),rgb(&c.color),0.0,0.0,0.0,0.0,0.0]);}
    for c in &g.stink_clouds{data.extend_from_slice(&[c.id as f64,c.owner as f64,c.wx,c.wz,c.age,c.life,0.0,0.0]);}
    for fx in &g.effects{data.extend_from_slice(&[match fx.kind.as_str(){"explosion"=>1.0,"abomb"=>2.0,"boost"=>3.0,"pickup"=>4.0,"hit"=>5.0,"crash"=>6.0,"fire"=>7.0,"vulcanReady"=>8.0,"ash"=>9.0,"yudaSmoke"=>11.0,"radiation"=>10.0,_=>0.0},fx.wx,fx.wz,fx.age,fx.life,fx.color.as_deref().map_or(0.0,rgb),fx.owner.map_or(-1.0,|id|id as f64),match fx.kind.as_str(){"radiation"=>28.0,_=>0.0}]);}
    let text=json!({"actors":game.actors.iter().map(|a|json!({"name":a.name,"notice":a.notice})).collect::<Vec<_>>(),"killFeed":g.kill_feed,"events":g.events,"voices":g.voices,"room":game.room,"winner":g.winner,"host":g.host,"multiplayer":g.multiplayer,"specialAbilities":g.special_abilities,"timeStop":g.time_stop,"timeOwner":g.time_owner});
    let encoded=serde_json::to_vec(&text).unwrap_or_default();let previous=unsafe{&mut *core::ptr::addr_of_mut!(TEXT)};
    if *previous!=encoded{*previous=encoded;unsafe{*core::ptr::addr_of_mut!(TEXT_VERSION)=(*core::ptr::addr_of!(TEXT_VERSION)).wrapping_add(1);}}
    data.len()
}
#[no_mangle]pub extern "C" fn presentation_ptr()->*const f64{unsafe{(&*core::ptr::addr_of!(NUMBERS)).as_ptr()}}
#[no_mangle]pub extern "C" fn presentation_text_ptr()->*const u8{unsafe{(&*core::ptr::addr_of!(TEXT)).as_ptr()}}
#[no_mangle]pub extern "C" fn presentation_text_len()->usize{unsafe{(&*core::ptr::addr_of!(TEXT)).len()}}
#[no_mangle]pub extern "C" fn presentation_text_version()->u32{unsafe{*core::ptr::addr_of!(TEXT_VERSION)}}
#[no_mangle]pub extern "C" fn game_present(viewer:usize)->usize{if viewer>=6{return 0;}let Some(game)=(unsafe{&*core::ptr::addr_of!(super::WORLD)})else{return 0;};present(game,viewer)}
