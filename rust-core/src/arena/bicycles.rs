use super::*;
pub(super) const BICYCLE_LANDING:f64=1.2;
pub(super) const BICYCLE_LIFETIME:f64=BICYCLE_LANDING+4.0;
impl Game{
    pub(super) fn bicycle_tick(&mut self,dt:f64){
        for supply in &mut self.global.supplies{if supply.kind=="bicycle"{supply.age+=dt;}}
        self.global.supplies.retain(|s|s.kind!="bicycle"||s.age<BICYCLE_LIFETIME-1e-8);
        for id in 0..self.actors.len(){
            if self.frozen(id){continue;}
            let a=&mut self.actors[id];let boosting=a.driver==14&&a.boost>0.0&&a.destroyed<=0.0&&!a.inactive&&!a.afk&&!a.bomber;
            let drop=boosting&&!a.owl_boosting;a.owl_boosting=boosting;if !drop{continue;}
            let heading=a.heading-a.yaw+a.spin;let mut end=(a.wx,a.wz);
            for reach in [7.0,5.0,3.0,0.0]{let x=a.wx+heading.sin()*reach;let z=a.wz+heading.cos()*reach;if !blocked(self.global.arena,x,z,1.0){end=(x,z);break;}}
            self.global.bicycle_sequence+=1;
            self.global.supplies.push(Supply{id:1000+self.global.bicycle_sequence,wx:end.0,wz:end.1,kind:"bicycle".into(),heading,owner:Some(id),drop_wx:a.wx,drop_wz:a.wz,drop_height:match a.somersault>0.0{true=>(1.0-a.somersault/0.55).clamp(0.0,1.0).mul_add(std::f64::consts::PI,0.0).sin()*5.0,false=>0.0},..Supply::default()});
        }
    }
}
