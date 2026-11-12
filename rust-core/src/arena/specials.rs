use super::*;
impl Game{
    pub(super) fn frozen(&self,id:usize)->bool{self.global.special_abilities&&self.global.time_stop>0.0&&self.global.time_owner!=Some(id)}
    pub(super) fn bot_visibility(&self,id:usize,d:f64)->f64{
        if !self.global.special_abilities{return 0.0;}
        let active=|a:&&Actor|a.special_active>0.0&&a.destroyed<=0.0&&!a.inactive&&!a.afk&&!a.bomber;
        if self.actors.iter().filter(active).any(|a|a.driver==13&&a.id!=id){return 1.0;}
        if self.actors[id].driver==14&&self.actors[id].special_active>0.0{return 0.0;}
        let fog=self.actors.iter().filter(active).filter(|a|a.driver==14).map(|a|1.0_f64.min((7.0-a.special_active)/0.4).min(a.special_active/0.6)).fold(0.0_f64,f64::max);
        fog*(0.35+0.65*(d/60.0).min(1.0))
    }
    pub(super) fn special(&mut self,id:usize){
        let a=&self.actors[id];
        if !self.global.special_abilities||!self.combat_active()||self.global.finish_countdown.is_some()||!matches!(a.driver,7|8|9|11|12|13|14)||a.special_cooldown>0.0||a.destroyed>0.0||a.inactive||a.afk||a.bomber||self.global.time_stop>0.0{return;}
        match a.driver{14=>self.actors[id].special_active=7.0,13=>{let count=|a:&Actor|u64::from(a.ammo)+u64::from(a.missiles)+u64::from(a.turbos)+u64::from(a.chaff);let own=count(a);let target=self.actors.iter().filter(|v|!v.inactive&&!v.afk&&!v.bomber&&v.destroyed<=0.0).max_by(|a,b|count(a).cmp(&count(b)).then(b.id.cmp(&a.id)));let Some(v)=target else{return;};if count(v)<=own{self.actors[id].special_active=5.0;self.actors[id].special_cooldown=20.0;return;}let(victim,wx,wz,health)=(v.id,v.wx,v.wz,v.health);self.global.effects.push(Effect{kind:"taxAudit".into(),owner:Some(id),wx,wz,life:2.5,..Effect::default()});self.damage(victim,id,health,"tax");},7=>self.actors[id].special_active=8.0,8=>{self.global.time_stop=2.5;self.global.time_owner=Some(id);},9=>{self.actors[id].special_active=1.6;for victim in 0..self.actors.len(){let a=&self.actors[victim];if victim==id||a.inactive||a.afk||a.bomber||a.destroyed>0.0{continue;}let(wx,wz)=(a.wx,a.wz);let amount=match DRIVER_CUTENESS[a.driver]{5=>1.0,_=>2.0};self.global.effects.push(Effect{kind:"fashionSnap".into(),wx,wz,owner:Some(id),life:1.2,..Effect::default()});self.damage(victim,id,amount,"fashion");}},11=>self.actors[id].special_active=8.0,12=>{if a.health>=6.0{return;}let a=&mut self.actors[id];a.health=(a.health+1.0).min(6.0);a.heal_timer=0.0;a.special_active=match a.health>=6.0{true=>0.0,false=>5.0};self.global.effects.push(Effect{kind:"heartbeat".into(),owner:Some(id),wx:a.wx,wz:a.wz,life:0.7,..Effect::default()});},_=>return}self.actors[id].special_cooldown=20.0;
    }
    pub(super) fn special_tick(&mut self,dt:f64){
        if !self.global.special_abilities{return;}
        self.global.time_stop=(self.global.time_stop-dt).max(0.0);
        if self.global.time_stop<=0.0{self.global.time_owner=None;}
        for a in &mut self.actors{if self.global.time_stop<=0.0||self.global.time_owner==Some(a.id){a.special_cooldown=(a.special_cooldown-dt).max(0.0);let before=a.special_active;a.special_active=(before-dt).max(0.0);if a.driver==12&&before>0.0{if a.health>=6.0||a.destroyed>0.0||a.inactive||a.afk||a.bomber{a.special_active=0.0;continue;}if ((6.0-before+1e-8).floor())<((6.0-a.special_active+1e-8).floor()){a.health=(a.health+1.0).min(6.0);a.heal_timer=0.0;self.global.effects.push(Effect{kind:"heartbeat".into(),owner:Some(a.id),wx:a.wx,wz:a.wz,life:0.7,..Effect::default()});if a.health>=6.0{a.special_active=0.0;}}}}}
        if self.global.time_stop<=0.0{for supply in &mut self.global.supplies{
            if supply.cooldown>0.0{continue;}
            let owner=self.actors.iter().filter(|a|a.driver==7&&a.special_active>0.0&&!a.bomber&&!a.afk&&!a.inactive&&a.destroyed<=0.0&&distance(a.wx,a.wz,supply.wx,supply.wz)<=80.0).min_by(|a,b|distance(a.wx,a.wz,supply.wx,supply.wz).total_cmp(&distance(b.wx,b.wz,supply.wx,supply.wz)).then(a.id.cmp(&b.id)));
            let Some(a)=owner else{supply.restore_home();continue;};supply.home_wx.get_or_insert(supply.wx);supply.home_wz.get_or_insert(supply.wz);let d=distance(a.wx,a.wz,supply.wx,supply.wz);let fraction=match d>0.0{true=>(55.0*dt/d).min(1.0),false=>0.0};supply.wx+=(a.wx-supply.wx)*fraction;supply.wz+=(a.wz-supply.wz)*fraction;
        }}
        // World-space smoke samples persist for the same three seconds as the visual trail.
        for a in &mut self.actors{
            if a.driver!=10||a.boost<=0.0||a.destroyed>0.0||a.inactive||a.afk||a.bomber||self.global.time_stop>0.0&&self.global.time_owner!=Some(a.id){continue;}
            let last=self.global.effects.iter().rev().find(|f|f.kind=="yudaSmoke"&&f.owner==Some(a.id));
            if last.is_some_and(|f|f.age<0.05&&distance(f.wx,f.wz,a.wx,a.wz)<1.5){continue;}
            self.global.effects.push(Effect{kind:"yudaSmoke".into(),owner:Some(a.id),wx:a.wx-a.heading.sin()*2.0,wz:a.wz-a.heading.cos()*2.0,life:3.0,..Effect::default()});
        }
        for a in &mut self.actors{
            if a.bomber||a.inactive||a.afk||a.destroyed>0.0||a.hedge_shield>0.0||self.global.time_stop>0.0&&self.global.time_owner!=Some(a.id){continue;}
            if self.global.effects.iter().any(|f|f.kind=="yudaSmoke"&&f.owner!=Some(a.id)&&f.age<f.life&&distance(a.wx,a.wz,f.wx,f.wz)<4.0){a.dizzy=DIZZY_DURATION;}
        }

    }
}
