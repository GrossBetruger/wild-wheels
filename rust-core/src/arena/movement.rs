use super::*;
use std::collections::VecDeque;

pub(super) fn emit(g:&mut Globals,a:&mut Actor,dt:f64){
    a.drift_emit+=dt;if a.drift_emit<0.035{return;}a.drift_emit=0.0;
    let tx=a.heading.sin();let tz=a.heading.cos();let level=match a.drift{d if d>=0.85=>2,d if d>=0.45=>1,_=>0};
    let wheels:Vec<_>=[-1.0,1.0].into_iter().map(|side|Point{wx:a.wx-tx*1.5+tz*side*1.6,wz:a.wz-tz*1.5-tx*side*1.6}).collect();
    for (index,wheel) in wheels.iter().enumerate(){
        if let Some(previous)=a.drift_trail.as_ref().and_then(|p|p.get(index)){
            if distance(previous.wx,previous.wz,wheel.wx,wheel.wz)<6.0{g.skids.push(Skid{owner:a.id,ax:previous.wx,az:previous.wz,bx:wheel.wx,bz:wheel.wz,time:g.elapsed});}
        }
        g.drift_particles.push(Particle{owner:a.id,wx:wheel.wx,wz:wheel.wz,height:0.35,vx:-tx*2.0,vz:-tz*2.0,vy:1.8,life:0.9,kind:"smoke".into(),level,..Particle::default()});
        for i in 0..3{let angle=g.elapsed*31.0+i as f64*2.4+index as f64*3.0;g.drift_particles.push(Particle{owner:a.id,wx:wheel.wx,wz:wheel.wz,height:0.2,vx:angle.cos()*(3+i*2) as f64-tx*5.0,vz:angle.sin()*(3+i*2) as f64-tz*5.0,vy:(2+i) as f64,life:0.3+i as f64*0.07,kind:"spark".into(),level,..Particle::default()});}
    }a.drift_trail=Some(wheels);
}
pub fn age(g:&mut Globals,dt:f64){
    g.skids.retain(|s|g.elapsed-s.time<6.0);if g.skids.len()>420{g.skids.drain(..g.skids.len()-420);}
    for p in &mut g.drift_particles{p.age+=dt;p.wx+=p.vx*dt;p.wz+=p.vz*dt;p.height=(p.height+p.vy*dt).max(0.08);if p.kind=="spark"{p.vy-=12.0*dt;}}
    g.drift_particles.retain(|p|p.age<p.life);if g.drift_particles.len()>240{g.drift_particles.drain(..g.drift_particles.len()-240);}
}
pub fn navigate(arena:usize,a:&Actor,b:&Actor)->Vec<Point>{
    let cell=|v:f64|(((v+90.0)/10.0).floor() as i32).clamp(0,17);
    let start=cell(a.wx)+cell(a.wz)*18;let goal=cell(b.wx)+cell(b.wz)*18;
    let mut queue=VecDeque::from([start]);let mut previous=[-2;324];previous[start as usize]=-1;
    while previous[goal as usize]== -2{
        let Some(n)=queue.pop_front() else{return Vec::new();};let x=n%18;let z=n/18;
        for (dx,dz) in [(1,0),(-1,0),(0,1),(0,-1)]{
            let nx=x+dx;let nz=z+dz;if !(0..18).contains(&nx)||!(0..18).contains(&nz){continue;}
            let next=nx+nz*18;if previous[next as usize]!= -2||blocked(arena,(nx*10-85) as f64,(nz*10-85) as f64,3.0){continue;}
            previous[next as usize]=n;queue.push_back(next);
        }
    }
    let mut path=Vec::new();let mut n=goal;
    while n!=start&&n!= -1{path.push(Point{wx:(n%18*10-85) as f64,wz:(n/18*10-85) as f64});n=previous[n as usize];}path.reverse();path
}
impl Game{
    pub(super) fn move_cart(&mut self,id:usize,steer:f64,keys:u32,dt:f64,advance:bool,lethal:bool){
        let dt=dt*match self.frozen(id){true=>0.025,false=>1.0};
        if self.actors[id].destroyed>0.0||self.actors[id].prediction_crash{return;}
        let g=&mut self.global;let a=&mut self.actors[id];let wx=a.wx;let wz=a.wz;
        let data=[a.wx,a.wz,a.heading,a.motion_heading,a.camera_heading,a.speed,a.drift,a.boost,a.somersault,a.somersault_cooldown,a.dizzy,a.somersault_camera_start,a.yaw,f64::from(a.was_drifting),a.wall_cooldown,0.0];
        // This is entirely inside Wasm: no actor objects cross the JS boundary.
        unsafe{(*core::ptr::addr_of_mut!(crate::KARTS).cast::<crate::Kart>().add(id)).data=data;}
        let flags=u32::from(advance)|u32::from(keys&1!=0)*2|u32::from(keys&2!=0)*4|u32::from(keys&16!=0)*8|u32::from(advance||id==0||a.human)*16|u32::from(g.phase=="racing")*32|u32::from(id==0)*64;
        let events=crate::step(id,g.arena,steer,dt,flags);
        let d=unsafe{(*core::ptr::addr_of!(crate::KARTS).cast::<crate::Kart>().add(id)).data};
        a.wx=d[0];a.wz=d[1];a.heading=d[2];a.motion_heading=d[3];a.camera_heading=d[4];a.speed=d[5];a.drift=d[6];a.boost=d[7];a.somersault=d[8];a.somersault_cooldown=d[9];a.dizzy=d[10];a.somersault_camera_start=d[11];a.yaw=d[12];a.was_drifting=d[13]!=0.0;
        if advance{a.human=true;}
        if events&2!=0{sound(g,"driftCharge",id,wx,wz,None);}if events&4!=0{sound(g,"driftChargeMax",id,wx,wz,None);}if events&8!=0{effect(g,"boost",id,wx,wz,None);}if events&1!=0{a.drift_trail=None;}if events&16!=0{emit(g,a,dt);}
        if events&32!=0{effect(g,"crash",id,a.wx,a.wz,None);a.wall_cooldown=0.7;g.shake=0.3;voice(g,a,"hurt",a.wx);}
        if events&crate::DRIFT_WALL!=0&&a.boost>0.0{
            if lethal{self.damage(id,usize::MAX,6.0,"wall");return;}
            a.prediction_crash=true;a.speed=0.0;a.boost=0.0;a.drift=0.0;a.was_drifting=false;a.somersault=0.0;a.dizzy=0.0;
        }
    }
    pub(super) fn spawn(&mut self,id:usize){
        let mut candidates:Vec<_>=(0..8).map(|i|{let angle=i as f64*std::f64::consts::PI/4.0;Point{wx:angle.sin()*78.0,wz:angle.cos()*78.0}}).collect();
        let nearest=|point:&Point|self.actors.iter().filter(|a|a.id!=id&&a.destroyed==0.0).map(|a|distance(a.wx,a.wz,point.wx,point.wz)).fold(999.0,f64::min);
        candidates.sort_by(|a,b|nearest(b).total_cmp(&nearest(a)));let p=&candidates[0];let a=&mut self.actors[id];
        a.wx=p.wx;a.wz=p.wz;a.heading=(-p.wx).atan2(-p.wz);a.speed=0.0;a.health=3.0;a.heal_timer=0.0;a.destroyed=0.0;a.shield=0.0;a.hedge_shield=0.0;a.tehilim=0.0;a.ammo=START_HEDGEHOGS;a.missiles=1;a.turbos=1;a.item="hedgehog".into();a.fire_cooldown=0.5;a.boost=0.0;a.path.clear();
        a.motion_heading=a.heading;a.camera_heading=a.heading;a.drift=0.0;a.was_drifting=false;a.drift_trail=None;a.drift_emit=0.0;a.kill_streak=0;a.vulcan=0.0;a.chaff=4;a.chaff_cooldown=0.0;a.somersault=0.0;a.somersault_cooldown=0.0;a.somersault_camera_start=a.camera_heading;a.dizzy=0.0;a.credits.clear();
    }
    pub(super) fn collect(&mut self,id:usize){
        let a=&mut self.actors[id];if a.bomber||a.afk||a.destroyed>0.0{return;}
        let g=&mut self.global;
        for supply in &mut g.supplies{
            if supply.cooldown>0.0||distance(a.wx,a.wz,supply.wx,supply.wz)>=4.0||supply.kind=="health"&&a.health>=6.0{continue;}
            match supply.kind.as_str(){
                "health"=>{a.health=(a.health+1.0).min(6.0);a.notice=format!("+1 HEART · {} / 6",a.health);a.notice_time=2.0;},
                "missile"=>{a.missiles=(a.missiles+1).min(item_capacity(a.driver,"missile"));if !(a.vulcan>0.0&&a.item=="hedgehog"){a.item="missile".into();}},
                "hedgeproof"=>a.hedge_shield=25.0,"tehilim"=>a.tehilim=25.0,"hedgehog"=>a.ammo=item_capacity(a.driver,"hedgehog"),"boost"=>a.turbos=(a.turbos+1).min(item_capacity(a.driver,"boost")),_=>{}
            }
            supply.cooldown=match supply.kind.as_str(){"hedgeproof"|"tehilim"=>45.0,_=>8.0};supply.version+=1;supply.collector=Some(id);
            if g.multiplayer||id==0{
                let key=format!("pickup:{}:{}",supply.id,supply.version);
                g.sound_sequence+=1;
                g.events.push(match g.multiplayer{true=>json!({"type":"pickup","owner":id,"wx":a.wx,"wz":a.wz,"id":format!("{}:{}",g.sound_epoch,g.sound_sequence),"key":key}),false=>json!("pickup")});
                g.effects.push(Effect{kind:"pickup".into(),wx:a.wx,wz:a.wz,life:0.65,..Effect::default()});
            }
        }
    }
}
