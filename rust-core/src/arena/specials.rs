use super::*;
impl Game{
    pub(super) fn frozen(&self,id:usize)->bool{self.global.special_abilities&&self.global.time_stop>0.0&&self.global.time_owner!=Some(id)}
    pub(super) fn special(&mut self,id:usize){
        let a=&self.actors[id];
        if !self.global.special_abilities||!self.combat_active()||self.global.finish_countdown.is_some()||!matches!(a.driver,8|9|11|12)||a.special_cooldown>0.0||a.destroyed>0.0||a.inactive||a.afk||a.bomber||self.global.time_stop>0.0{return;}
        match a.driver{8=>{self.global.time_stop=2.5;self.global.time_owner=Some(id);},9=>{let(x,z)=(a.wx,a.wz);self.actors[id].special_active=1.6;self.global.effects.push(Effect{kind:"fashionSnap".into(),wx:x,wz:z,owner:Some(id),life:1.2,..Effect::default()});for victim in 0..self.actors.len(){let a=&self.actors[victim];if victim==id||distance(x,z,a.wx,a.wz)>35.0{continue;}let(wx,wz)=(a.wx,a.wz);let amount=(5.0-f64::from(DRIVER_CUTENESS[a.driver])).max(1.0);if self.damage(victim,id,amount,"fashion"){self.global.effects.push(Effect{kind:"fashionSnap".into(),wx,wz,owner:Some(id),life:1.2,..Effect::default()});}}},11=>self.actors[id].special_active=8.0,12=>{if a.health>=6.0{return;}self.actors[id].health=6.0;self.actors[id].heal_timer=0.0;self.actors[id].special_active=1.5;},_=>return}self.actors[id].special_cooldown=20.0;
    }
    pub(super) fn special_tick(&mut self,dt:f64){
        if !self.global.special_abilities{return;}
        self.global.time_stop=(self.global.time_stop-dt).max(0.0);
        if self.global.time_stop<=0.0{self.global.time_owner=None;}
        for a in &mut self.actors{if self.global.time_stop<=0.0||self.global.time_owner==Some(a.id){a.special_cooldown=(a.special_cooldown-dt).max(0.0);a.special_active=(a.special_active-dt).max(0.0);}}
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
