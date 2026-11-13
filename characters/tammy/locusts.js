export function drawLocusts(renderer,m,world,time){
  for(const bug of world.locusts??[]){
    const emerge=Math.min(1,bug.age/.6),height=bug.jump>0?.6+Math.sin(bug.jump/.7*Math.PI)*5:.55+Math.abs(Math.sin(time*13+bug.id))*.18;
    m.at(bug.wx,height-1.2*(1-emerge),bug.wz,bug.heading);m.pitch=bug.jump>0?Math.cos(bug.jump/.7*Math.PI)*.45:0;
    m.ball(0,.25,0,.42,.35,.85,'#72d32e',7,4);m.ball(0,.55,.65,.46,.4,.42,'#a6ef50',7,4);
    for(const side of [-1,1]){
      m.ball(side*.3,.65,.9,.16,.2,.13,'#fff4bc',5,3);m.ball(side*.31,.66,1,.075,.12,.06,'#253827',5,3);
      const kick=bug.jump>0?.7:Math.sin(time*16+bug.id)*.25;
      m.box(side*.52,-.05,-.48,.13,.7+kick,.16,'#3f9634');m.box(side*.6,-.25,-.12,.14,.15,.9,'#93db3e');m.box(side*.38,.85,.77,.06,.65,.06,'#325c35');m.ball(side*.28,.44,-.15,.15,.12,.65,'#c5ed75',6,3);
    }
    renderer.glow.at(bug.wx,.5,bug.wz);renderer.glow.particle(0,0,0,.65,[.08,.28,.015]);
  }
  for(const fx of world.effects){
    if(!['locustSpawn','locustBurst'].includes(fx.type))continue;
    const burst=fx.type==='locustBurst',fade=Math.max(0,1-fx.age/fx.life);renderer.smoke.at(fx.wx,0,fx.wz);renderer.glow.at(fx.wx,0,fx.wz);
    for(let i=0;i<16;i++){const angle=i*2.399,spread=(burst?10:4)*fx.age,r=spread*(.5+i%3*.3),y=(burst?2:1)+fx.age*(burst?7:3);
      renderer.smoke.particle(Math.sin(angle)*r,y,Math.cos(angle)*r,(burst?1.5:3)*fade,[.22,.65,.04]);renderer.glow.particle(Math.sin(angle)*r,y+.4,Math.cos(angle)*r,.3*fade,[.25*fade,.85*fade,.05*fade]);
    }
  }
}
