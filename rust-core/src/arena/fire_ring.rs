use super::*;
const RADIUS:f64=10.0;
impl Game{
    pub(super) fn ring_tick(&mut self,dt:f64){
        self.global.effects.retain(|f|f.kind!="fireRing");
        for id in 0..self.actors.len(){
            if self.frozen(id){let a=&self.actors[id];if a.ring_remaining>0.0&&!a.afk&&!a.inactive&&a.destroyed<=0.0{self.global.effects.push(Effect{kind:"fireRing".into(),owner:Some(id),wx:a.wx,wz:a.wz,life:0.1,..Effect::default()});}continue;}
            let a=&mut self.actors[id];let previous=a.ring_heading.replace(a.heading);let delta=previous.map_or(0.0,|p|angle(a.heading,p));
            let turning=delta.abs()>0.001&&a.speed.abs()>2.0;
            let eligible=self.global.special_abilities&&a.driver==10&&!a.inactive&&!a.afk&&!a.bomber&&a.destroyed<=0.0&&self.global.phase=="racing";
            if !eligible||!turning{a.ring_turn=0.0;a.ring_remaining=0.0;a.ring_spent=false;a.ring_doses.clear();continue;}
            if a.ring_remaining>0.0{a.ring_remaining=(a.ring_remaining-dt).max(0.0);}
            if a.ring_remaining<=0.0&&!a.ring_spent{
                if !a.was_drifting{a.ring_turn=0.0;continue;}
                if a.ring_turn.signum()!=delta.signum(){a.ring_turn=0.0;}
                a.ring_turn+=delta;
                if a.ring_turn.abs()>=std::f64::consts::TAU&&a.drift>=0.85{a.ring_remaining=20.0;a.ring_spent=true;sound(&mut self.global,"boost",id,a.wx,a.wz,None);}
            }
            if a.ring_remaining>0.0{self.global.effects.push(Effect{kind:"fireRing".into(),owner:Some(id),wx:a.wx,wz:a.wz,life:0.1,..Effect::default()});}
        }
        let rings:Vec<_>=self.global.effects.iter().filter(|f|f.kind=="fireRing").map(|f|(f.owner.unwrap(),f.wx,f.wz)).collect();
        for (owner,x,z) in rings{
            for victim in 0..self.actors.len(){
                if victim==owner||self.frozen(victim){continue;}
                let a=&self.actors[victim];let touching=!a.inactive&&!a.afk&&!a.bomber&&a.destroyed<=0.0&&(distance(x,z,a.wx,a.wz)-RADIUS).abs()<=2.5;
                if !touching{self.actors[owner].ring_doses.remove(&victim);continue;}
                let timer=self.actors[owner].ring_doses.entry(victim).or_insert(dt);*timer-=dt;
                if *timer<=1e-8{*timer+=0.3;self.damage(victim,owner,2.0,"fireRing");}
            }
        }
    }
    pub(super) fn ring_blocks(&self,ax:f64,az:f64,bx:f64,bz:f64)->bool{
        if !self.global.special_abilities{return false;}
        self.global.effects.iter().filter(|f|f.kind=="fireRing").any(|f|{
            // Swept segment test catches fast missiles and both crossing directions.
            let dx=bx-ax;let dz=bz-az;let len=dx*dx+dz*dz;
            let t=match len>0.0{true=>(((f.wx-ax)*dx+(f.wz-az)*dz)/len).clamp(0.0,1.0),false=>0.0};
            let near=distance(ax+dx*t,az+dz*t,f.wx,f.wz);
            let far=distance(ax,az,f.wx,f.wz).max(distance(bx,bz,f.wx,f.wz));near<=RADIUS+0.8&&far>=RADIUS-0.8
        })
    }
}
