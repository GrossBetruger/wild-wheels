import test from 'node:test';
import assert from 'node:assert/strict';
import {Multiplayer} from './multiplayer.js';
import {ArenaClient} from './arena-core.js';
import {arenaFixture} from './scripts/arena-fixture.mjs';

test('two Rust clients keep driving and firing across three complete matches with delayed finish packets',t=>{
  const app=new Multiplayer({fixtureWorld:arenaFixture});clearInterval(app.timer);t.after(()=>app.close());
  const room={code:'07',arena:0,botCount:0,host:0,members:new Map()};app.makeWorld(room);app.rooms.set(room.code,room);
  const host=app.join(room,{name:'Host',driver:0}),guest=app.join(room,{name:'Guest',driver:1}),clients=[new ArenaClient(),new ArenaClient()];
  let now=0;
  for(let match=0;match<3;match++){
    app.makeWorld(room);room.core.start();room.world.duration=2;
    const delivery=[];let finishedAt=null,shots=0,moving=false;
    for(const [i,member]of[host,guest].entries())clients[i].accept(room.core.packet(member.id),now);
    for(let frame=0;frame<600;frame++){
      now+=1/60;
      for(const [i,member]of[host,guest].entries()){
        const client=clients[i];client.frame(1/60,['arrowup'],now);const view=client.present();
        if(view.phase==='racing'&&frame%12===0)client.action('fire',undefined,now);
        if(frame%2===0){app.controls(member,client.outbound(['arrowup']));member.inputAt=member.lastSeen=Date.now();}
      }
      app.step(1/60);
      if(room.world.phase==='racing'){shots=Math.max(shots,room.world.projectiles.length);moving||=room.world.speed>5;}
      if(frame%2===0)for(const [i,member]of[host,guest].entries())delivery.push({at:frame+4,client:clients[i],packet:room.core.packet(member.id)});
      while(delivery[0]?.at<=frame){const update=delivery.shift();update.client.accept(update.packet,now);}
      if(room.world.phase==='finished')finishedAt??=frame;
      if(finishedAt!==null&&frame>finishedAt+12)break;
    }
    assert.equal(room.world.phase,'finished',`match ${match+1} reaches its finish screen`);assert.equal(moving,true);assert.ok(shots>0,`match ${match+1} accepts new fire commands`);
  }
});

test('test scenarios can reuse filtered entity lists without replacing their entries with live fixture references',t=>{
  const app=new Multiplayer({fixtureWorld:arenaFixture});clearInterval(app.timer);t.after(()=>app.close());
  const room={code:'07',arena:0,botCount:0,host:0,members:new Map()};app.makeWorld(room);app.rooms.set(room.code,room);app.join(room,{name:'Host',driver:0});
  Object.assign(room.world,{phase:'racing',fireCooldown:0});app.controls(room.members.get(0),{sequence:0,keys:[],actions:[{type:'fire'}]});app.step(1/60);
  room.world.projectiles=room.world.projectiles.filter(shot=>shot.owner===0);
  assert.equal(room.world.projectiles.length,1);assert.equal(room.world.projectiles[0].kind,'hedgehog');app.step(1/60);assert.equal(room.world.ammo,9);
});
