use super::*;
impl Game {
    pub(super) fn spawn_locusts(&mut self,owner:usize){
        let count=self.actors.iter().filter(|a|a.driver!=5&&!a.inactive&&!a.afk&&!a.bomber).count()*2;
        let centers=[(-65.0,-65.0),(65.0,65.0),(-65.0,65.0),(65.0,-65.0),(0.0,78.0),(78.0,0.0),(0.0,-78.0),(-78.0,0.0)];
        let offset=self.global.locust_sequence as usize/4;
        for i in 0..count{
            let (x,z)=centers[(offset+i/4)%centers.len()];
            if i%4==0{self.global.effects.push(Effect{kind:"locustSpawn".into(),wx:x,wz:z,life:1.2,..Effect::default()});}
            self.global.locust_sequence+=1;
            self.global.locusts.push(Locust{id:self.global.locust_sequence,owner,wx:x+((i%2)as f64-0.5)*3.0,wz:z+(((i/2)%2)as f64-0.5)*3.0,..Locust::default()});
        }
        sound(&mut self.global,"locustSwarm",owner,self.actors[owner].wx,self.actors[owner].wz,None);
    }
    pub(super) fn locust_tick(&mut self,dt:f64){
        if !self.global.special_abilities{self.global.locusts.clear();return;}
        for mut bug in std::mem::take(&mut self.global.locusts){
            let dt=dt*match self.frozen(bug.owner){true=>0.025,false=>1.0};bug.age+=dt;
            if bug.age<0.6{self.global.locusts.push(bug);continue;}
            let target=self.actors.iter().filter(|a|a.driver!=5&&!a.inactive&&!a.afk&&!a.bomber&&a.destroyed<=0.0)
                .min_by(|a,b|distance(a.wx,a.wz,bug.wx,bug.wz).total_cmp(&distance(b.wx,b.wz,bug.wx,bug.wz)).then(a.id.cmp(&b.id)));
            let Some(target)=target else{self.global.locusts.push(bug);continue;};
            let victim=target.id;let d=distance(target.wx,target.wz,bug.wx,bug.wz);
            let visible=clear(self.global.arena,bug.wx,bug.wz,target.wx,target.wz);bug.brain-=dt;
            if !visible&&bug.brain<=0.0{bug.path=movement::navigate(self.global.arena,&Actor{wx:bug.wx,wz:bug.wz,..Actor::default()},target);bug.brain=0.4;}
            while bug.path.first().is_some_and(|p|distance(p.wx,p.wz,bug.wx,bug.wz)<3.0){bug.path.remove(0);}
            let (x,z)=match (visible,bug.path.first()){(false,Some(p))=>(p.wx,p.wz),_=>(target.wx,target.wz)};
            if bug.jump<=0.0&&d<14.0&&visible{bug.jump=0.7;}
            bug.heading=(x-bug.wx).atan2(z-bug.wz);
            let speed=match bug.jump>0.0{true=>38.0,false=>22.0};let step=(speed*dt).min(distance(x,z,bug.wx,bug.wz));
            let (x,z)=(bug.wx+bug.heading.sin()*step,bug.wz+bug.heading.cos()*step);
            if !blocked(self.global.arena,x,z,0.5){bug.wx=x;bug.wz=z;}
            bug.jump=(bug.jump-dt).max(0.0);
            if bug.jump>0.0&&distance(bug.wx,bug.wz,self.actors[victim].wx,self.actors[victim].wz)<2.7{
                self.damage(victim,bug.owner,1.0,"locust");
                self.global.effects.push(Effect{kind:"locustBurst".into(),wx:bug.wx,wz:bug.wz,life:0.7,..Effect::default()});
                sound(&mut self.global,"locustPop",bug.owner,bug.wx,bug.wz,None);continue;
            }
            self.global.locusts.push(bug);
        }
    }
}
