import test from 'node:test';
import assert from 'node:assert/strict';
import { NetworkPlayback } from './playback.js';

test('steady driving stays smooth when network updates arrive in bursts',()=>{
  const playback=new NetworkPlayback();
  // A kart moves one unit per server update; some updates arrive together.
  const deliveries=[
    [0,0,0],[1/30,1,.04],[2/30,2,.095],[3/30,3,.10],
    [4/30,4,.19],[5/30,5,.191],[6/30,6,.20],
    [7/30,7,.28],[8/30,8,.281],[9/30,9,.30]
  ];
  const positions=[];
  for(let frame=0;frame<=12;frame++){
    const now=.1+frame/60;
    while(deliveries.length&&deliveries[0][2]<=now){
      const [time,wx,received]=deliveries.shift();
      playback.push(time,{id:0,arena:0,phase:'racing',wx,wz:0,heading:0,cameraHeading:0,destroyed:0,bots:[]},received);
    }
    positions.push(Number(playback.sample(now).wx.toFixed(4)));
  }
  assert.deepEqual(positions,[0,.5,1,1.5,2,2.5,3,3.5,4,4.5,5,5.5,6]);
});

test('camera turns take the short path across the angle boundary',()=>{
  const playback=new NetworkPlayback();
  playback.push(0,{id:0,arena:0,phase:'racing',wx:0,wz:0,heading:3,cameraHeading:3,destroyed:0,bots:[]},0);
  playback.push(.1,{id:0,arena:0,phase:'racing',wx:2,wz:0,heading:-3,cameraHeading:-3,destroyed:0,bots:[]},.1);
  const view=playback.sample(.15);
  assert.ok(Math.abs(view.cameraHeading-Math.PI)<1e-9);
  assert.ok(Math.abs(view.wx-1)<1e-9);
});

test('a guest sees both karts move smoothly while health comes from the latest update',()=>{
  const playback=new NetworkPlayback();
  playback.push(0,{id:1,arena:0,phase:'racing',wx:10,wz:0,heading:0,cameraHeading:0,health:3,destroyed:0,bots:[{id:0,wx:0,wz:0,heading:0,cameraHeading:0,destroyed:0}]},0);
  playback.push(.1,{id:1,arena:0,phase:'racing',wx:12,wz:0,heading:0,cameraHeading:0,health:2,destroyed:0,bots:[{id:0,wx:4,wz:0,heading:0,cameraHeading:0,destroyed:0}]},.1);
  const view=playback.sample(.15);
  assert.ok(Math.abs(view.wx-11)<1e-9);
  assert.ok(Math.abs(view.bots[0].wx-2)<1e-9);
  assert.equal(view.health,2);
});

test('a respawn appears at the new spawn instead of sliding across the arena',()=>{
  const playback=new NetworkPlayback();
  playback.push(0,{id:0,arena:0,phase:'racing',wx:-65,wz:0,heading:0,cameraHeading:0,destroyed:1,bots:[]},0);
  playback.push(.1,{id:0,arena:0,phase:'racing',wx:65,wz:0,heading:0,cameraHeading:0,destroyed:0,bots:[]},.1);
  assert.equal(playback.sample(.15).wx,65);
});

test('a stalled connection holds the last known position and a new arena clears old movement',()=>{
  const playback=new NetworkPlayback();
  playback.push(0,{id:0,arena:0,phase:'racing',wx:0,wz:0,heading:0,cameraHeading:0,destroyed:0,bots:[]},0);
  playback.push(.1,{id:0,arena:0,phase:'racing',wx:2,wz:0,heading:0,cameraHeading:0,destroyed:0,bots:[]},.1);
  assert.equal(playback.sample(1).wx,2);
  playback.push(.2,{id:0,arena:1,phase:'ready',wx:20,wz:0,heading:0,cameraHeading:0,destroyed:0,bots:[]},1.1);
  assert.equal(playback.sample(1.11).wx,20);
});
