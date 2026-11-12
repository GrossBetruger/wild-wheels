use super::*;
impl Game{
    fn active(&self,id:usize)->bool{let a=&self.actors[id];!self.frozen(id)&&self.combat_active()&&a.destroyed<=0.0&&!a.bomber&&!a.inactive&&!a.afk&&(self.global.finish_countdown.is_none()||self.human_controlled(id))}
    pub(super) fn target(&self,id:usize)->Option<usize>{
        let a=&self.actors[id];self.actors.iter().filter(|b|b.id!=id&&!b.bomber&&!b.inactive&&!b.afk&&b.destroyed<=0.0&&b.shield<=0.0&&distance(a.wx,a.wz,b.wx,b.wz)<100.0&&angle((b.wx-a.wx).atan2(b.wz-a.wz),a.heading).abs()<0.65&&clear(self.global.arena,a.wx,a.wz,b.wx,b.wz)).map(|a|a.id).min_by(|&x,&y|distance(a.wx,a.wz,self.actors[x].wx,self.actors[x].wz).total_cmp(&distance(a.wx,a.wz,self.actors[y].wx,self.actors[y].wz)).then(x.cmp(&y)))
    }
    pub(super) fn fire(&mut self,id:usize,action_id:Option<u32>){
        if !self.active(id)||self.actors[id].fire_cooldown>0.0{return;}
        let target=self.target(id);let root_x=self.actors[0].wx;let root_z=self.actors[0].wz;
        let a=&mut self.actors[id];let missile=a.item=="missile"&&a.missiles>0;let vulcan=!missile&&a.vulcan>0.0;
        if !missile&&!vulcan&&a.ammo==0{return;}
        let kind=match missile{true=>"missile",false=>"hedgehog"};let g=&mut self.global;g.projectile_sequence+=1;
        g.projectiles.push(Shot{id:g.projectile_sequence,owner:id,kind:kind.into(),vulcan,target,wx:a.wx+a.heading.sin()*3.5,wz:a.wz+a.heading.cos()*3.5,heading:a.heading,speed:match(missile,vulcan){(true,_)=>70.0,(_,true)=>125.0,_=>90.0},height:1.3,vy:3.0,life:match(missile,vulcan){(true,_)=>3.0,(_,true)=>1.3,_=>2.5},action_id,..Shot::default()});
        if missile{a.missiles-=1;}if !missile&&!vulcan{a.ammo-=1;}
        a.fire_cooldown=match(missile,vulcan){(true,_)=>0.9,(_,true)=>0.075,_=>0.225};
        if a.item=="missile"&&a.missiles==0{a.item="hedgehog".into();}
        if g.multiplayer||distance(a.wx,a.wz,root_x,root_z)<90.0{sound(g,match(missile,vulcan){(true,_)=>"missile",(_,true)=>"vulcanFire",_=>"fire"},id,a.wx,a.wz,action_id.map(|id|format!("action:{}",id)));}
    }
    pub(super) fn turbo(&mut self,id:usize,action_id:Option<u32>){
        if !self.active(id)||self.actors[id].turbos==0||self.actors[id].boost>0.0{return;}
        let a=&mut self.actors[id];a.turbos-=1;a.boost=boost_duration(a.driver);effect(&mut self.global,"boost",id,a.wx,a.wz,action_id.map(|id|format!("action:{}",id)));
    }
    pub(super) fn flip(&mut self,id:usize){
        if !self.active(id)||self.actors[id].somersault_cooldown>1e-8{return;}
        if self.global.special_abilities&&self.actors[id].driver==5{
            let a=&self.actors[id];let mut seed=(self.global.elapsed*1000000.0)as u64^(a.wx.to_bits().rotate_left(17))^a.wz.to_bits()^((id+1)as u64*7919);
            for _ in 0..128{seed=seed.wrapping_mul(6364136223846793005).wrapping_add(1);let x=((seed>>32)%17000)as f64/100.0-85.0;seed=seed.wrapping_mul(6364136223846793005).wrapping_add(1);let z=((seed>>32)%17000)as f64/100.0-85.0;if blocked(self.global.arena,x,z,4.0)||self.actors.iter().any(|b|b.id!=id&&!b.inactive&&b.destroyed<=0.0&&distance(x,z,b.wx,b.wz)<8.0){continue;}let a=&mut self.actors[id];effect(&mut self.global,"boost",id,a.wx,a.wz,None);a.wx=x;a.wz=z;a.speed=0.0;effect(&mut self.global,"boost",id,x,z,None);break;}
        }
        let a=&mut self.actors[id];a.somersault_camera_start=a.camera_heading;a.heading+=std::f64::consts::PI;a.motion_heading=a.heading;a.drift=0.0;a.was_drifting=false;a.drift_trail=None;a.somersault=0.55;a.somersault_cooldown=1.0;
    }
    pub(super) fn bomb(&mut self,id:usize,action:&Action){
        if self.global.finish_countdown.is_some()&&!self.human_controlled(id){return;}
        let a=&mut self.actors[id];let kind=action.bomb_kind.as_deref().unwrap_or("abomb");
        if !a.bomber||a.inactive||a.afk||self.global.phase!="racing"||!matches!(kind,"stink"|"abomb")||action.wx.abs()>96.0||action.wz.abs()>96.0{return;}
        let ammo=match kind{"stink"=>&mut a.stink_ammo,_=>&mut a.bomb_ammo};if *ammo==0{return;}*ammo-=1;
        let g=&mut self.global;g.bomb_sequence+=1;g.bombs.push(Bomb{id:g.bomb_sequence,kind:kind.into(),owner:id,wx:action.wx,wz:action.wz,color:a.color.clone(),action_id:action.id,..Bomb::default()});
        sound(g,"bombDrop",id,action.wx,action.wz,action.id.map(|id|format!("action:{}",id)));
    }
    fn divert(g:&mut Globals,cloud:&mut Chaff)->usize{
        let mut diverted=0;
        for shot in &mut g.projectiles{
            if shot.kind!="missile"||shot.target!=Some(cloud.owner)||shot.decoy.is_some()||distance(shot.wx,shot.wz,cloud.wx,cloud.wz)>40.0||!clear(g.arena,shot.wx,shot.wz,cloud.wx,cloud.wz){continue;}
            shot.target=None;shot.decoy=Some(cloud.id);shot.decoy_owner=Some(cloud.owner);shot.decoy_center=Some(Point{wx:cloud.wx,wz:cloud.wz});shot.life=shot.life.max(4.5);diverted+=1;
        }
        if diverted>0{cloud.diversions+=diverted as u32;cloud.diverted_at=Some(g.elapsed);sound(g,"chaffDivert",cloud.owner,cloud.wx,cloud.wz,None);}diverted
    }
    pub(super) fn divert_all(&mut self){
        let mut clouds=std::mem::take(&mut self.global.chaff_clouds);
        for cloud in &mut clouds{Self::divert(&mut self.global,cloud);}self.global.chaff_clouds=clouds;
    }
    pub(super) fn chaff(&mut self,id:usize){
        if !self.active(id)||self.actors[id].chaff==0||self.actors[id].chaff_cooldown>0.0{return;}
        let root_x=self.actors[0].wx;let root_z=self.actors[0].wz;let a=&mut self.actors[id];let g=&mut self.global;
        let tx=a.heading.sin();let tz=a.heading.cos();let side=match g.chaff_sequence%2{0=>-1.0,_=>1.0};
        let mut point=Point{wx:a.wx+tx*2.0,wz:a.wz+tz*2.0};let mut found=false;
        for ahead in [18.0,12.0,6.0]{for s in [side,-side]{let p=Point{wx:a.wx+tx*ahead+tz*s*ahead*0.55,wz:a.wz+tz*ahead-tx*s*ahead*0.55};if !blocked(g.arena,p.wx,p.wz,0.5)&&clear(g.arena,a.wx,a.wz,p.wx,p.wz){point=p;found=true;break;}}if found{break;}}
        let mut cloud=Chaff{id:g.chaff_sequence,owner:id,wx:point.wx,wz:point.wz,origin_x:a.wx,origin_z:a.wz,color:a.color.clone(),life:8.0,..Chaff::default()};g.chaff_sequence+=1;a.chaff-=1;a.chaff_cooldown=0.65;
        let diverted=Self::divert(g,&mut cloud);g.chaff_clouds.push(cloud);
        if g.multiplayer||distance(a.wx,a.wz,root_x,root_z)<90.0{sound(g,"chaff",id,a.wx,a.wz,None);}
        a.notice=match diverted{0=>"CHAFF RELEASED".into(),1=>"CHAFF · 1 MISSILE DIVERTED".into(),n=>format!("CHAFF · {} MISSILES DIVERTED",n)};a.notice_time=2.0;
    }
    pub(super) fn damage(&mut self,victim:usize,owner:usize,amount:f64,kind:&str)->bool{
        let a=&self.actors[victim];
        if a.bomber||a.inactive||a.afk||self.global.phase!="racing"||a.destroyed>0.0||a.shield>0.0&&kind!="wall"||a.hedge_shield>0.0&&kind!="missile"&&kind!="wall"||victim==owner{return false;}
        let unscored=self.global.finish_countdown.is_some();
        let root_x=self.actors[0].wx;let g=&mut self.global;let a=&mut self.actors[victim];a.health=(a.health-amount).max(0.0);a.heal_timer=0.0;voice(g,a,"hurt",root_x);if victim==0{g.shake=0.5;}
        if a.health>0.0{
            effect(g,"hit",victim,a.wx,a.wz,None);
            if let Some(attacker)=self.actors.get_mut(owner){attacker.celebrate=1.6;voice(g,attacker,"cheer",root_x);}return true;
        }
        let mut credit=Vec::new();if owner<self.actors.len(){credit.push(owner);}
        let a=&self.actors[victim];
        if a.dizzy>0.0{for(&id,&expires)in &a.credits{if expires>g.elapsed+1e-8&&self.actors.get(id).is_some_and(|b|b.bomber&&!b.inactive)&&id!=victim&&!credit.contains(&id){credit.push(id);}}}
        let a=&mut self.actors[victim];a.credits.clear();a.destroyed=3.0;a.speed=0.0;a.boost=0.0;if !unscored{a.deaths+=1;}effect(g,match kind{"abomb"|"radiation"=>"ash",_=>"explosion"},victim,a.wx,a.wz,None);a.drift=0.0;a.was_drifting=false;a.drift_trail=None;a.kill_streak=0;a.vulcan=0.0;a.hedge_shield=0.0;a.tehilim=0.0;a.somersault=0.0;a.dizzy=0.0;
        if unscored{return true;}
        let victim_name=a.name.clone().unwrap_or_else(||driver_name(a.driver).into());let victim_color=a.color.clone();
        for scorer in credit{
            let a=&mut self.actors[scorer];a.kills+=match scorer==owner||kind=="wall"{true=>1.0,false=>0.5};a.celebrate=1.6;voice(g,a,"cheer",root_x);g.kill_sequence+=1;
            let label=match scorer==0{true=>"YOU".into(),false=>a.name.clone().unwrap_or_else(||driver_name(a.driver).split(' ').next().unwrap_or("RIVAL").into())};
            g.kill_feed.insert(0,Kill{id:g.kill_sequence,attacker:scorer,victim,victim_name:victim_name.clone(),victim_color:victim_color.clone(),text:format!("{} → {}",label,match victim==0{true=>"YOU",false=>&victim_name}),time:g.elapsed,assist:scorer!=owner&&kind!="wall",radiation:kind=="radiation"&&scorer==owner});g.kill_feed.truncate(16);
        }
        if let Some(a)=self.actors.get_mut(owner){if !a.bomber&&a.destroyed<=0.0{a.kill_streak+=1;if a.kill_streak%2==0{a.vulcan=15.0;a.health=a.health.max(4.0);a.item="hedgehog".into();a.fire_cooldown=0.0;effect(g,"vulcanReady",owner,a.wx,a.wz,None);a.notice="2-KILL STREAK · HEDGEHOG VULCAN!".into();a.notice_time=3.0;}}}true
    }
    pub(super) fn advance_shot(&self,shot:&mut Shot,dt:f64)->(bool,Option<usize>,Option<usize>){
        let dt=dt*match self.frozen(shot.owner){true=>0.025,false=>1.0};
        shot.age+=dt;shot.life-=dt;shot.trail.push(Sample{wx:shot.wx,wz:shot.wz,height:shot.height});if shot.trail.len()>24{shot.trail.remove(0);}
        if shot.kind=="missile"&&!shot.reflected&&shot.decoy.is_none(){
            let defender=shot.target.and_then(|id|self.actors.get(id)).filter(|a|a.destroyed<=0.0&&!a.inactive&&!a.afk&&(a.tehilim>0.0||self.global.special_abilities&&a.driver==11));
            let shooter=self.actors.get(shot.owner).filter(|a|a.destroyed<=0.0&&!a.inactive&&!a.afk&&!a.bomber);
            if let (Some(defender),Some(shooter))=(defender,shooter){if distance(shot.wx,shot.wz,defender.wx,defender.wz)<=distance(shot.wx,shot.wz,shooter.wx,shooter.wz){shot.owner=defender.id;shot.target=Some(shooter.id);shot.reflected=true;shot.action_id=None;shot.speed=100.0;shot.life=shot.life.max(6.0);}}
        }
        let decoy=shot.decoy.and_then(|id|self.global.chaff_clouds.iter().find(|c|c.id==id).map(|c|(c.wx,c.wz,c.owner))).or_else(||shot.decoy_center.as_ref().map(|p|(p.wx,p.wz,shot.decoy_owner.unwrap_or(0))));
        let orbit=|shot:&mut Shot,point:(f64,f64,usize),delta:f64|{
            let age=shot.orbit_age.unwrap_or(0.0)+delta;shot.orbit_age=Some(age);let direction=match shot.orbit_direction<0.0{true=>-1.0,false=>1.0};let circling=(age/0.6).min(1.0);let fall=(age-0.6).max(0.0);let angle=shot.orbit_angle+direction*std::f64::consts::TAU*circling;let radius=shot.orbit_radius;let speed=radius*std::f64::consts::TAU/0.6;
            let center=shot.orbit_center.as_ref().map_or((point.0,point.1),|p|(p.wx,p.wz));shot.heading=angle+direction*std::f64::consts::FRAC_PI_2;
            shot.wx=center.0+angle.sin()*radius+shot.heading.sin()*speed*fall;shot.wz=center.1+angle.cos()*radius+shot.heading.cos()*speed*fall;
            let sink=((shot.orbit_height-0.25)/1.2).clamp(0.0,0.75);shot.height=shot.orbit_height-sink*age-7.0*fall*fall;shot.vy=-sink-14.0*fall;
            let impact=shot.height<=0.15||fall>0.0&&blocked(self.global.arena,shot.wx,shot.wz,0.3);if impact{shot.height=shot.height.max(0.15);shot.life=0.0;}(impact,None,Some(point.2))
        };
        if let Some(point)=decoy{if shot.orbit_age.is_some(){return orbit(shot,point,dt);}}
        let target=decoy.map(|p|(p.0,p.1)).or_else(||shot.target.and_then(|id|self.actors.get(id)).filter(|a|a.destroyed<=0.0&&!a.afk).map(|a|{let lead=match shot.reflected{true=>(distance(shot.wx,shot.wz,a.wx,a.wz)/shot.speed).min(0.8),false=>0.0};(a.wx+a.motion_heading.sin()*a.speed*0.085*lead,a.wz+a.motion_heading.cos()*a.speed*0.085*lead)}));
        let mut steering=0.0;
        if shot.kind=="missile"{if let Some((x,z))=target{let rate=match decoy.is_some(){true=>4.5,false=>match shot.reflected{true=>10.0,false=>1.6}};steering=angle((x-shot.wx).atan2(z-shot.wz),shot.heading).clamp(-rate*dt,rate*dt);shot.heading+=steering;}}
        let steps=(shot.speed*dt/1.5).ceil() as usize;
        for step in 0..steps{
            shot.wx+=shot.heading.sin()*shot.speed*dt/steps as f64;shot.wz+=shot.heading.cos()*shot.speed*dt/steps as f64;
            if let Some(point)=decoy{if distance(shot.wx,shot.wz,point.0,point.1)<6.0{shot.orbit_age=Some(0.0);shot.orbit_direction=match steering<0.0{true=>-1.0,false=>1.0};shot.orbit_angle=shot.heading-shot.orbit_direction*std::f64::consts::FRAC_PI_2;shot.orbit_radius=shot.speed*0.6/std::f64::consts::TAU;shot.orbit_height=shot.height;shot.orbit_center=Some(Point{wx:shot.wx-shot.orbit_angle.sin()*shot.orbit_radius,wz:shot.wz-shot.orbit_angle.cos()*shot.orbit_radius});shot.chaffed=true;shot.life=shot.life.max(3.0);return orbit(shot,point,dt*(steps-step-1)as f64/steps as f64);}}
            let victim=match decoy.is_some(){true=>None,false=>self.actors.iter().find(|a|a.id!=shot.owner&&!a.bomber&&!a.afk&&a.destroyed<=0.0&&a.shield<=0.0&&distance(a.wx,a.wz,shot.wx,shot.wz)<2.7).map(|a|a.id)};
            if blocked(self.global.arena,shot.wx,shot.wz,0.3)||victim.is_some(){shot.life=0.0;return(true,victim,decoy.map(|p|p.2));}
        }(false,None,decoy.map(|p|p.2))
    }
}
