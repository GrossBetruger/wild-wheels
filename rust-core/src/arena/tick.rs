use super::*;
impl Game{
    fn acknowledge_idle_commands(&mut self,frame:&Frame){
        // Transport still consumes commands after the simulation stops. Keep its
        // sequence in lockstep so late packets cannot create a gap next frame.
        for input in &frame.inputs{if let Some(last)=input.moves.as_ref().and_then(|moves|moves.last()){self.movement_ack[input.actor]=last.sequence;self.apply_pending(input.actor,last.sequence);}}
    }
    pub fn tick(&mut self,frame:Frame){
        self.network_time+=frame.dt;
        for input in &frame.inputs{
            let id=input.actor;
            if let Some(sequence)=input.sequence{self.input_ack[id]=sequence;}
            for action in &input.actions{
                if action.id.is_some_and(|n|n as i64<=self.accepted_action[id]){continue;}
                if self.pending[id].len()>=64{continue;}
                if let Some(n)=action.id{self.accepted_action[id]=n as i64;}self.pending[id].push(action.clone());
            }self.apply_pending(id,self.movement_ack[id]);
        }
        if !matches!(self.global.phase.as_str(),"racing"|"countdown"){self.acknowledge_idle_commands(&frame);return;}
        let mut dt=frame.dt;
        if self.global.phase=="countdown"{
            self.acknowledge_idle_commands(&frame);
            self.global.countdown-=dt;
            if self.global.countdown<=0.0{self.global.phase="racing".into();self.actors[0].notice="BATTLE ON! · FIRST TO 10 KILLS".into();self.actors[0].notice_time=3.0;}return;
        }
        let ending=self.global.finish_countdown.is_some();if let Some(left)=self.global.finish_countdown{dt=dt.min(left);}
        let g=&mut self.global;g.elapsed+=dt;g.shake=(g.shake-dt*2.0).max(0.0);
        for supply in &mut g.supplies{supply.cooldown=(supply.cooldown-dt).max(0.0);}
        for fx in &mut g.effects{fx.age+=dt;}g.effects.retain(|fx|fx.age<fx.life);
        for c in &mut g.chaff_clouds{c.age+=dt;}g.chaff_clouds.retain(|c|c.age<c.life);
        for c in &mut g.stink_clouds{c.age+=dt;}g.stink_clouds.retain(|c|c.age<c.life);
        super::movement::age(g,dt);
        for id in 0..self.actors.len(){
            let input=frame.inputs.iter().find(|input|input.actor==id);let action_clock=input.is_some_and(|i|i.action_clock);
            let a=&mut self.actors[id];if a.afk{continue;}a.notice_time=(a.notice_time-dt).max(0.0);
            for timer in [&mut a.shield,&mut a.hedge_shield,&mut a.celebrate,&mut a.voice_cooldown,&mut a.wall_cooldown,&mut a.vulcan]{*timer=(*timer-dt).max(0.0);}
            if !action_clock{a.fire_cooldown=(a.fire_cooldown-dt).max(0.0);a.chaff_cooldown=(a.chaff_cooldown-dt).max(0.0);}
            if a.bomber{
                if !a.inactive&&!ending{let before=a.bomb_reload;a.bomb_reload+=dt;if before<5.0-1e-8&&a.bomb_reload>=5.0-1e-8{a.stink_ammo=(a.stink_ammo+1).min(item_capacity(a.driver,"stink"));a.bomb_reload=a.bomb_reload.max(5.0);}if a.bomb_reload>=10.0-1e-8{a.bomb_ammo=(a.bomb_ammo+1).min(item_capacity(a.driver,"abomb"));a.stink_ammo=(a.stink_ammo+1).min(item_capacity(a.driver,"stink"));a.bomb_reload=(a.bomb_reload-10.0).max(0.0);}}continue;
            }
            if a.destroyed>0.0{a.destroyed=(a.destroyed-dt).max(0.0);if a.destroyed==0.0&&!ending{self.spawn(id);}continue;}
            if !ending&&!a.inactive&&a.health>0.0&&a.health<3.0{
                a.heal_timer+=dt;let interval=recovery_interval(a.driver);
                if a.heal_timer>=interval-1e-8{a.health=(a.health+1.0).min(3.0);a.heal_timer=match a.health>=3.0{true=>0.0,false=>(a.heal_timer-interval).max(0.0)};}
            }
            if a.health>=3.0{a.heal_timer=0.0;}
            a.reload+=dt;let reload_interval=hedgehog_recovery_interval(a.driver);if a.reload>=reload_interval-1e-8{a.ammo=(a.ammo+1).min(item_capacity(a.driver,"hedgehog"));a.reload=(a.reload-reload_interval).max(0.0);}
            if id==0&&!self.global.multiplayer||a.human{
                let held=input.map_or(0,|i|i.keys);
                match input.and_then(|i|i.moves.as_ref()){
                    Some(moves)=>for movement in moves{
                        if movement.sequence<=self.movement_ack[id]{continue;}
                        if action_clock{let a=&mut self.actors[id];for timer in [&mut a.fire_cooldown,&mut a.chaff_cooldown]{let left=*timer-1.0/60.0;*timer=match left<1e-8{true=>0.0,false=>left};}}
                        let steer=movement.steer.unwrap_or(f64::from(u8::from(movement.keys&4!=0))-f64::from(u8::from(movement.keys&8!=0)));
                        self.move_cart(id,steer,movement.keys,1.0/60.0,true);self.collect(id);self.movement_ack[id]=movement.sequence;self.apply_pending(id,movement.sequence);
                    },
                    None=>{let steer=input.and_then(|i|i.steer).unwrap_or(f64::from(u8::from(held&4!=0))-f64::from(u8::from(held&8!=0)));self.move_cart(id,steer,held,dt,true);}
                }
                if held&32!=0{self.fire(id,None);}continue;
            }
            if ending{a.speed=0.0;a.boost=0.0;continue;}
            a.dizzy=(a.dizzy-dt).max(0.0);a.somersault=(a.somersault-dt).max(0.0);a.somersault_cooldown=(a.somersault_cooldown-dt).max(0.0);a.boost=(a.boost-dt).max(0.0);
            let target=self.actors.iter().filter(|b|b.id!=id&&!b.bomber&&!b.inactive&&!b.afk&&b.destroyed<=0.0).map(|b|b.id).min_by(|&x,&y|distance(self.actors[id].wx,self.actors[id].wz,self.actors[x].wx,self.actors[x].wz).total_cmp(&distance(self.actors[id].wx,self.actors[id].wz,self.actors[y].wx,self.actors[y].wz)).then(x.cmp(&y)));
            let Some(target)=target else{continue;};let arena=self.global.arena;let visible=clear(arena,self.actors[id].wx,self.actors[id].wz,self.actors[target].wx,self.actors[target].wz);
            self.actors[id].brain-=dt;
            if self.actors[id].brain<=0.0{self.actors[id].path=match visible{true=>Vec::new(),false=>super::movement::navigate(arena,&self.actors[id],&self.actors[target])};self.actors[id].brain=0.4+(1.0-self.actors[id].skill)*0.4;}
            let target_x=self.actors[target].wx;let target_z=self.actors[target].wz;let a=&mut self.actors[id];
            while a.path.first().is_some_and(|p|distance(a.wx,a.wz,p.wx,p.wz)<7.0){a.path.remove(0);}
            let (x,z)=match (visible,a.path.first()){(false,Some(p))=>(p.wx,p.wz),_=>(target_x,target_z)};
            let turn=angle((x-a.wx).atan2(z-a.wz),a.heading);let mut steer=-(turn*1.8).clamp(-1.0,1.0);
            if blocked(arena,a.wx+a.heading.sin()*9.0,a.wz+a.heading.cos()*9.0,3.0)&&steer.abs()<0.4{steer=1.0;}
            let gas=turn.abs()<1.3||a.speed<100.0;self.move_cart(id,steer,u32::from(gas),dt,false);
            let a=&self.actors[id];let aim=angle((target_x-a.wx).atan2(target_z-a.wz),a.heading);
            if visible&&aim.abs()<0.18+(1.0-a.skill)*0.12&&distance(a.wx,a.wz,target_x,target_z)<85.0{self.actors[id].item=match(self.actors[id].vulcan>0.0,self.actors[id].missiles>0){(true,_)=>"hedgehog",(_,true)=>"missile",_=>"hedgehog"}.into();self.fire(id,None);}
        }
        for input in &frame.inputs{if let Some(last)=input.moves.as_ref().and_then(|moves|moves.last()){self.movement_ack[input.actor]=last.sequence;}}
        for i in 0..self.actors.len(){for j in i+1..self.actors.len(){
            let a=&self.actors[i];let b=&self.actors[j];let d=distance(a.wx,a.wz,b.wx,b.wz);
            if a.bomber||b.bomber||a.afk||b.afk||a.destroyed>0.0||b.destroyed>0.0||d>=3.8{continue;}
            let dx=(a.wx-b.wx)/match d==0.0{true=>1.0,false=>d};let dz=match d==0.0{true=>1.0,false=>(a.wz-b.wz)/d};let push=(3.8-d)/2.0;let arena=self.global.arena;
            if !blocked(arena,a.wx+dx*push,a.wz+dz*push,2.0){self.actors[i].wx+=dx*push;self.actors[i].wz+=dz*push;}
            let b=&self.actors[j];if !blocked(arena,b.wx-dx*push,b.wz-dz*push,2.0){self.actors[j].wx-=dx*push;self.actors[j].wz-=dz*push;}
            self.actors[i].speed*=0.8;self.actors[j].speed*=0.8;
            if (i==0||j==0)&&self.actors[0].wall_cooldown<=0.0{let a=&mut self.actors[0];effect(&mut self.global,"crash",0,a.wx,a.wz,None);a.wall_cooldown=0.6;voice(&mut self.global,a,"hurt",a.wx);}
        }}
        for id in 0..self.actors.len(){self.collect(id);}
        self.divert_all();
        let shots=std::mem::take(&mut self.global.projectiles);
        for mut shot in shots{
            let(impact,victim,decoy)=self.advance_shot(&mut shot,dt);
            if let Some(victim)=victim{if shot.kind=="hedgehog"{self.damage(victim,shot.owner,1.0,"hedgehog");}}
            if !impact&&shot.life>0.0{self.global.projectiles.push(shot);continue;}
            shot.life=0.0;
            if shot.kind=="missile"{
                effect(&mut self.global,"explosion",shot.owner,shot.wx,shot.wz,None);
                if shot.chaffed{if let Some(owner)=decoy.and_then(|id|self.actors.get_mut(id)){owner.notice="CHAFF INTERCEPT · MISSILE DESTROYED".into();owner.notice_time=2.0;}if decoy==Some(0){self.global.shake=self.global.shake.max(0.12);}continue;}
                for id in 0..self.actors.len(){let a=&self.actors[id];if distance(a.wx,a.wz,shot.wx,shot.wz)<10.0&&clear(self.global.arena,shot.wx,shot.wz,a.wx,a.wz){self.damage(id,shot.owner,3.0,"missile");}}
            }
        }
        let bombs=std::mem::take(&mut self.global.bombs);
        for mut bomb in bombs{
            bomb.age+=dt;if bomb.age<0.9-1e-8{self.global.bombs.push(bomb);continue;}
            if bomb.kind=="stink"{self.global.stink_clouds.push(Stink{id:bomb.id,owner:bomb.owner,wx:bomb.wx,wz:bomb.wz,life:5.0,..Stink::default()});sound(&mut self.global,"stinkBurst",bomb.owner,bomb.wx,bomb.wz,None);continue;}
            sound(&mut self.global,"bombExplosion",bomb.owner,bomb.wx,bomb.wz,None);self.global.effects.push(Effect{kind:"abomb".into(),wx:bomb.wx,wz:bomb.wz,life:3.0,color:Some(bomb.color),..Effect::default()});
            for id in 0..self.actors.len(){if distance(self.actors[id].wx,self.actors[id].wz,bomb.wx,bomb.wz)<=22.0{self.damage(id,bomb.owner,3.0,"abomb");}}
            if !self.actors[0].bomber&&distance(self.actors[0].wx,self.actors[0].wz,bomb.wx,bomb.wz)<44.0{self.global.shake=self.global.shake.max(0.7);}
        }
        {
            let g=&mut self.global;
            for cloud in &mut g.stink_clouds{for a in &mut self.actors{
                if a.bomber||a.inactive||a.afk||a.destroyed>0.0||a.shield>0.0||cloud.hits.contains(&a.id)||distance(a.wx,a.wz,cloud.wx,cloud.wz)>14.0{continue;}
                cloud.hits.push(a.id);
                if a.dizzy<=0.0{g.sound_sequence+=1;g.events.push(match g.multiplayer{true=>json!({"type":"dizzy","owner":a.id,"wx":a.wx,"wz":a.wz,"id":format!("{}:{}",g.sound_epoch,g.sound_sequence)}),false=>json!("dizzy")});}
                a.dizzy=4.0;a.credits.retain(|_,expires|*expires>g.elapsed+1e-8);if !ending{a.credits.insert(cloud.owner,g.elapsed+4.0);}
            }}
        }
        let order=self.order();let g=&mut self.global;g.rank=order.iter().position(|&id|id==0).map_or(0,|i|i+1);
        if !ending&&order.first().is_some_and(|&id|self.actors[id].kills>=g.target_score||g.elapsed>=g.duration){
            let id=order[0];g.winner=match id{0=>json!("player"),_=>json!(id-1)};g.finish_rank=Some(g.rank);g.finish_time=Some(g.elapsed.min(g.duration));g.finish_countdown=Some(3.0);g.events.push(json!(match g.rank==1{true=>"victory",false=>"finish"}));let root_x=self.actors[0].wx;voice(g,&mut self.actors[id],"win",root_x);
        }
        if g.events.len()>64{g.events.drain(..g.events.len()-64);}if g.voices.len()>16{g.voices.drain(..g.voices.len()-16);}
        if !ending{return;}
        let left=(g.finish_countdown.unwrap_or(0.0)-dt).max(0.0);g.finish_countdown=Some(left);if left>1e-8{return;}
        g.phase="finished".into();g.finish_countdown=Some(0.0);for a in &mut self.actors{a.speed=0.0;a.boost=0.0;a.celebrate=0.0;a.was_drifting=false;a.drift=0.0;a.somersault=0.0;}
    }
}
