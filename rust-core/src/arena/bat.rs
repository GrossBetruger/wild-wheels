use super::*;
fn origin(a:&Actor,arena:usize)->(f64,f64){
    for side in [4.0,-4.0,2.0,-2.0]{let x=a.wx+a.heading.cos()*side;let z=a.wz-a.heading.sin()*side;if !blocked(arena,x,z,0.8)&&line(arena,a.wx,a.wz,x,z){return(x,z);}}
    (a.wx,a.wz)
}
fn line(arena:usize,x:f64,z:f64,xx:f64,zz:f64)->bool{let d=distance(x,z,xx,zz);let mut t=0.0;while t<=d{if blocked(arena,x+(xx-x)*t/d.max(1e-9),z+(zz-z)*t/d.max(1e-9),0.4){return false;}t+=1.0;}true}
impl Game{
    pub(super) fn bat_fire(&mut self,id:usize){
        let a=&self.actors[id];if (a.driver!=14&&!a.bat_companion)||a.vulcan<=0.0||a.bat_cooldown>0.0||self.frozen(id)||!self.combat_active()||a.destroyed>0.0||a.bomber||a.inactive||a.afk||self.global.finish_countdown.is_some()&&!self.human_controlled(id){return;}
        let (x,z)=origin(a,self.global.arena);let radius=self.bot_sight_radius(id).min(100.0);
        let target=self.actors.iter().filter(|b|b.id!=id&&!b.bomber&&!b.inactive&&!b.afk&&b.destroyed<=0.0&&b.shield<=0.0&&b.hedge_shield<=0.0&&distance(a.wx,a.wz,b.wx,b.wz)<=radius&&line(self.global.arena,x,z,b.wx,b.wz)).min_by(|a,b|distance(x,z,a.wx,a.wz).total_cmp(&distance(x,z,b.wx,b.wz)).then(a.id.cmp(&b.id)));
        let Some(target)=target else{return;};let lead=(distance(x,z,target.wx,target.wz)/125.0).min(0.8);let speed=target.speed*0.085;let heading=(target.wx+target.motion_heading.sin()*speed*lead-x).atan2(target.wz+target.motion_heading.cos()*speed*lead-z);
        let(wx,wz)=(x+heading.sin()*1.4,z+heading.cos()*1.4);if blocked(self.global.arena,wx,wz,0.3){return;}
        let target=Some(target.id);let jump=match a.somersault>0.0{true=>(1.0-a.somersault/0.55).clamp(0.0,1.0).mul_add(std::f64::consts::PI,0.0).sin()*match a.driver==10{true=>2.8,false=>5.0},false=>0.0};
        let height=3.5+match a.boost>0.0{true=>2.4,false=>0.0}+jump;let a=&mut self.actors[id];a.bat_cooldown=0.15;
        let g=&mut self.global;g.projectile_sequence+=1;g.projectiles.push(Shot{id:g.projectile_sequence,owner:id,kind:"hedgehog".into(),vulcan:true,target,wx,wz,heading,speed:125.0,height,vy:3.0,life:1.3,..Shot::default()});
        if g.multiplayer||distance(a.wx,a.wz,self.actors[0].wx,self.actors[0].wz)<90.0{super::sound(g,"vulcanFire",id,wx,wz,None);}
    }
}
