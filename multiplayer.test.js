import {arenaFixture} from './scripts/arena-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameServer } from './server.js';
import WebSocket from 'ws';
import { allocateRoomCode } from './multiplayer.js';
import { decodeBinarySnapshot } from './binary-wire.js';
import {ArenaClient} from './arena-core.js';
import {savedPlayerName} from './network.js';

async function serverFor(t){
  const app=createGameServer({fixtureWorld:arenaFixture});clearInterval(app.multiplayer.timer);await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{app.multiplayer.close();app.server.closeAllConnections();app.server.close();});
  const origin=`http://127.0.0.1:${app.server.address().port}`;
  const post=async(path,body,token,headers={})=>{const response=await fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`} :{}),...headers},body:JSON.stringify(body),signal:AbortSignal.timeout(3000)});return {status:response.status,cookie:response.headers.get('set-cookie'),...await response.json()};};
  return {...app,post,origin};
}
test('players can rename themselves in a room and names survive the next match',async t=>{
  const {multiplayer,post}=await serverFor(t);
  const host=await post('/api/rooms',{name:'Host',driver:0,arena:0,bots:0});
  const guest=await post('/api/join',{name:'Player',driver:1,code:host.code});
  assert.equal((await post('/api/name',{name:'  Sam  ',id:host.you},guest.token)).status,200);
  const room=multiplayer.rooms.get(host.code),hostMember=multiplayer.members.get(host.token),guestMember=multiplayer.members.get(guest.token);
  assert.equal(multiplayer.snapshot(room,hostMember).players.find(player=>player.id===guest.you).name,'Sam');
  assert.equal(multiplayer.snapshot(room,guestMember).world.name,'Sam');
  assert.equal(hostMember.name,'Host');
  await post('/api/control',{action:'start'},host.token);
  assert.equal(multiplayer.snapshot(room,guestMember).world.name,'Sam');
  room.world.phase='racing';assert.equal((await post('/api/name',{name:'Sammy'},guest.token)).status,200);
  assert.equal(multiplayer.snapshot(room,hostMember).world.bots.find(actor=>actor.id===guest.you).name,'Sammy');
  for(const name of ['', '   ', 'x'.repeat(25), null])assert.equal((await post('/api/name',{name},guest.token)).status,400);
  assert.equal(guestMember.name,'Sammy');
  assert.equal((await post('/api/name',{name:'Intruder'})).status,401);
});
test('a guest request arms auto-start, both players see it, and the host can still start immediately',async t=>{
  const {multiplayer,post}=await serverFor(t);
  const host=await post('/api/rooms',{name:'Host',driver:0,arena:0,bots:0});
  const guest=await post('/api/join',{name:'Friend',driver:1,code:host.code});
  assert.equal((await post('/api/ready',{ready:true},guest.token)).status,200);
  const room=multiplayer.rooms.get(host.code);
  const hostView=multiplayer.snapshot(room,multiplayer.members.get(host.token));
  const guestView=multiplayer.snapshot(room,multiplayer.members.get(guest.token));
  assert.equal(hostView.players.find(player=>player.name==='Friend').wantsToPlay,true);
  assert.equal(guestView.players.find(player=>player.id===guest.you).wantsToPlay,true);
  assert.equal(hostView.players.find(player=>player.name==='Host').wantsToPlay,false);
  assert.equal(hostView.startRequest.id,guestView.startRequest.id);assert.ok(hostView.startRequest.remainingMs>0&&hostView.startRequest.remainingMs<=3000);
  assert.equal(room.world.phase,'ready');
  assert.equal((await post('/api/control',{action:'start'},guest.token)).status,403);
  assert.equal((await post('/api/control',{action:'start'},host.token)).status,200);
  assert.equal(room.world.phase,'countdown');
  assert.ok(multiplayer.snapshot(room,multiplayer.members.get(host.token)).players.every(player=>!player.wantsToPlay));
  assert.equal((await post('/api/ready',{ready:true},guest.token)).status,409);
});
test('only the host can refuse the pending request and stale refusals do not cancel a new request',async t=>{
  const {multiplayer,post}=await serverFor(t);
  const host=await post('/api/rooms',{name:'Host',driver:0,arena:0,bots:0}),guest=await post('/api/join',{name:'Guest',driver:1,code:host.code});
  await post('/api/ready',{ready:true,deadline:0},guest.token);const room=multiplayer.rooms.get(host.code),requestId=room.startRequest.id;
  assert.equal((await post('/api/control',{action:'refuse-start',requestId},guest.token)).status,403);
  assert.equal((await post('/api/control',{action:'refuse-start'},host.token)).status,400);
  assert.equal((await post('/api/control',{action:'refuse-start',requestId},host.token)).status,200);
  const view=multiplayer.snapshot(room,multiplayer.members.get(guest.token));assert.equal(view.startRequest,null);assert.equal(view.players.find(player=>player.id===guest.you).playRequestRefused,true);
  await post('/api/ready',{ready:true},guest.token);assert.equal((await post('/api/control',{action:'refuse-start',requestId},host.token)).status,409);assert.ok(room.startRequest);
});
test('two browser players join one room, control separate karts, and see their own perspectives',async t=>{
  const {multiplayer,post}=await serverFor(t);
  const host=await post('/api/rooms',{name:'Oren',driver:0,arena:0});const guest=await post('/api/join',{name:'Friend',driver:2,code:host.code});
  assert.equal(host.status,200);assert.equal(guest.status,200);assert.equal(guest.you,1);assert.equal(guest.players.length,2);assert.equal(guest.world.driver,2);assert.equal(guest.world.bots.find(k=>k.id===0).name,'Oren');
  await post('/api/control',{action:'start'},host.token);const room=multiplayer.rooms.get(host.code);for(let frame=0;frame<100;frame++)multiplayer.step(1/30);
  const before0={wx:room.world.wx,wz:room.world.wz},before1={wx:room.world.bots[0].wx,wz:room.world.bots[0].wz};
  await post('/api/input',{sequence:0,keys:['arrowup'],actions:[]},host.token);await post('/api/input',{sequence:0,keys:['arrowup','arrowleft'],actions:[]},guest.token);
  for(let frame=0;frame<20;frame++)multiplayer.step(1/30);
  assert.ok(Math.hypot(room.world.wx-before0.wx,room.world.wz-before0.wz)>2);assert.ok(Math.hypot(room.world.bots[0].wx-before1.wx,room.world.bots[0].wz-before1.wz)>2);
  const view=multiplayer.snapshot(room,multiplayer.members.get(guest.token));assert.equal(view.world.id,1);assert.equal(view.world.wx,room.world.bots[0].wx);assert.equal(view.world.bots.find(k=>k.id===0).wx,room.world.wx);
});
test('joining players get different default animals and distinct kart colors',async t=>{
  const {post}=await serverFor(t);
  const host=await post('/api/rooms',{name:'Host',driver:0,arena:0,bots:5});
  assert.equal(new Set([host.world.color,...host.world.bots.map(bot=>bot.color)]).size,6);
  const guest1=await post('/api/join',{name:'One',driver:null,code:host.code});
  const guest2=await post('/api/join',{name:'Two',driver:null,code:host.code});
  const guest3=await post('/api/join',{name:'Three',driver:null,code:host.code});
  const guest4=await post('/api/join',{name:'Four',driver:null,code:host.code});
  const guest5=await post('/api/join',{name:'Five',driver:null,code:host.code});
  assert.deepEqual(guest5.players.map(player=>player.driver),[0,1,2,3,4,5]);
  assert.equal(new Set(guest5.players.map(player=>player.color)).size,6);
  assert.equal(guest1.world.driver,1);
  assert.equal(guest2.world.driver,2);
  assert.equal(guest3.world.driver,3);
  assert.equal(guest4.world.driver,4);
});
test('a player can choose an animal in the lobby and keep it for the next match',async t=>{
  const {multiplayer,post}=await serverFor(t);
  const host=await post('/api/rooms',{name:'Host',driver:0,arena:0});
  const guest=await post('/api/join',{name:'Guest',driver:null,code:host.code});
  const color=guest.players.find(player=>player.id===guest.you).color;
  assert.equal((await post('/api/driver',{driver:3},guest.token)).status,200);
  const room=multiplayer.rooms.get(host.code);
  const chosen=multiplayer.snapshot(room,multiplayer.members.get(guest.token));
  assert.equal(chosen.world.driver,3);
  assert.equal(chosen.world.color,color);
  assert.equal(chosen.players.find(player=>player.id===guest.you).driver,3);
  assert.equal(multiplayer.snapshot(room,multiplayer.members.get(host.token)).world.bots.find(actor=>actor.id===guest.you).driver,3);
  await post('/api/control',{action:'start'},host.token);
  const started=multiplayer.snapshot(room,multiplayer.members.get(guest.token));
  assert.equal(started.world.driver,3);
  assert.equal(started.world.color,color);
  assert.equal((await post('/api/driver',{driver:2},guest.token)).status,409);
});
test('a remote player can hit and kill another human with server-scored missiles',async t=>{
  const {multiplayer,post}=await serverFor(t);const host=await post('/api/rooms',{name:'Defender',driver:0,arena:0});const guest=await post('/api/join',{name:'Attacker',driver:1,code:host.code});
  const room=multiplayer.rooms.get(host.code),r=room.world,attacker=r.bots[0];Object.assign(r,{phase:'racing',wx:-65,wz:0,heading:0,health:6,shield:0,supplies:[]});Object.assign(attacker,{wx:-65,wz:-20,heading:0,motionHeading:0,shield:0,fireCooldown:0,missiles:3});for(const bot of r.bots.slice(1))bot.destroyed=100;
  await post('/api/input',{sequence:0,keys:[],actions:[{type:'select',item:'missile'},{type:'fire'}]},guest.token);for(let frame=0;frame<30;frame++)multiplayer.step(1/30);assert.equal(r.health,3);assert.equal(attacker.kills,0);
  await post('/api/input',{sequence:1,keys:[],actions:[{type:'select',item:'missile'},{type:'fire'}]},guest.token);for(let frame=0;frame<30;frame++)multiplayer.step(1/30);assert.equal(r.health,0);assert.equal(r.deaths,1);assert.equal(attacker.kills,1);
  for(let frame=0;frame<100;frame++)multiplayer.step(1/30);assert.equal(r.health,3);assert.equal(r.chaff,4);
});
test('a distant guest receives their own shot sound even when the host cannot hear it',async t=>{
  const {multiplayer,post}=await serverFor(t);
  const host=await post('/api/rooms',{name:'Host',driver:0,arena:0,bots:0});
  const guest=await post('/api/join',{name:'Guest',driver:1,code:host.code});
  const room=multiplayer.rooms.get(host.code);Object.assign(room.world,{phase:'racing',wx:-65,wz:-65});
  Object.assign(room.world.bots[0],{wx:65,wz:65,fireCooldown:0,item:'hedgehog'});
  await post('/api/input',{sequence:0,keys:[],actions:[{type:'fire'}]},guest.token);multiplayer.step(1/60);
  const guestView=multiplayer.snapshot(room,multiplayer.members.get(guest.token));
  const hostView=multiplayer.snapshot(room,multiplayer.members.get(host.token));
  assert.equal(guestView.world.events.find(event=>event.type==='fire').owner,guest.you);
  assert.equal(hostView.world.events.some(event=>event.type==='fire'),false);
});
test('guests cannot start or change a match and invalid or cross-origin controls are rejected',async t=>{
  const {post}=await serverFor(t);const host=await post('/api/rooms',{name:'Host',driver:0,arena:0});const guest=await post('/api/join',{name:'Guest',driver:1,code:host.code});
  assert.equal((await post('/api/control',{action:'start'},guest.token)).status,403);assert.equal((await post('/api/control',{action:'arena',arena:1},guest.token)).status,403);
  assert.equal((await post('/api/input',{sequence:0,keys:['teleport'],actions:[]},host.token)).status,400);assert.equal((await post('/api/input',{sequence:0,keys:[],actions:[{type:'set-health',health:99}]},host.token)).status,400);
  assert.equal((await post('/api/control',{action:'start'},host.token,{Origin:'https://example.invalid'})).status,403);assert.equal((await post('/api/control',{action:'start'})).status,401);
});
test('host AFK preserves host control and a room never accepts more than six players',async t=>{
  const {multiplayer,post}=await serverFor(t);const host=await post('/api/rooms',{name:'Host',driver:0,arena:0});const guests=[];
  for(let index=1;index<6;index++)guests.push(await post('/api/join',{name:`Player ${index}`,driver:index%4,code:host.code}));
  assert.equal((await post('/api/join',{name:'Extra',driver:1,code:host.code})).status,409);await post('/api/leave',{},host.token);
  const room=multiplayer.rooms.get(host.code);assert.equal(room.host,host.you);assert.equal(room.members.size,6);assert.equal(room.members.get(host.you).afk,true);assert.equal((await post('/api/control',{action:'start'},guests[0].token)).status,403);assert.equal((await post('/api/control',{action:'start'},host.token)).status,200);
  for(let frame=0;frame<120;frame++)multiplayer.step(1/30);assert.ok(Number.isFinite(room.world.wx));assert.ok(Number.isFinite(room.world.heading));
});
test('stale input stops accelerating and duplicate messages cannot spend chaff twice',async t=>{
  const {multiplayer,post}=await serverFor(t);const host=await post('/api/rooms',{name:'Host',driver:0,arena:0});const room=multiplayer.rooms.get(host.code);room.world.phase='racing';
  const input={sequence:0,keys:['arrowup'],actions:[{type:'chaff'}]};await post('/api/input',input,host.token);await post('/api/input',input,host.token);multiplayer.step(1/30);assert.equal(room.world.chaff,3);
  room.world.speed=400;multiplayer.members.get(host.token).inputAt=Date.now()-1000;multiplayer.step(1/30);assert.ok(room.world.speed<400);
});
test('new rooms default to one bot and the host can choose zero or more bots',async t=>{
  const {post}=await serverFor(t);const host=await post('/api/rooms',{name:'Host',driver:0,arena:0});assert.equal(host.bots,1);assert.equal(host.world.bots.length,1);
  await post('/api/control',{action:'bots',bots:0},host.token);const guest=await post('/api/join',{name:'Guest',driver:1,code:host.code});assert.equal(guest.bots,0);assert.equal(guest.world.bots.length,1);assert.equal(guest.world.bots[0].human,true);
  assert.equal((await post('/api/control',{action:'bots',bots:4},host.token)).status,200);assert.equal((await post('/api/control',{action:'bots',bots:5},host.token)).status,400);assert.equal((await post('/api/control',{action:'bots',bots:0},guest.token)).status,403);
});
test('additional humans replace bot slots without exceeding six active karts',async t=>{
  const {post}=await serverFor(t);const host=await post('/api/rooms',{name:'Host',driver:0,arena:0,bots:5});assert.equal(host.world.bots.length,5);
  const guest=await post('/api/join',{name:'Guest',driver:1,code:host.code});assert.equal(guest.bots,4);assert.equal(guest.players.length,2);assert.equal(guest.world.bots.length,5);assert.equal(guest.world.bots.filter(k=>!k.human).length,4);
});
test('an invitation can join a live match with fresh health and equipment',async t=>{
  const {multiplayer,post}=await serverFor(t);const host=await post('/api/rooms',{name:'Host',driver:0,arena:0,bots:0});const room=multiplayer.rooms.get(host.code);Object.assign(room.world,{phase:'racing',elapsed:30,kills:2});
  const guest=await post('/api/join',{name:'Guest',driver:2,code:host.code});assert.equal(guest.status,200);assert.equal(guest.world.phase,'racing');assert.equal(guest.world.elapsed,30);assert.equal(guest.world.health,3);assert.equal(guest.world.chaff,4);assert.equal(guest.world.kills,0);assert.equal(guest.world.bots[0].kills,2);
});
test('a delayed server frame catches up simulation time instead of slowing the match',async t=>{
  const {multiplayer,post}=await serverFor(t);const host=await post('/api/rooms',{name:'Host',driver:0,arena:0,bots:0});const room=multiplayer.rooms.get(host.code);room.world.phase='racing';multiplayer.lastAdvance=1000;multiplayer.accumulator=0;
  multiplayer.advance(1120);assert.ok(room.world.elapsed>.11&&room.world.elapsed<.13);
  multiplayer.advance(1200);assert.ok(room.world.elapsed>.18&&room.world.elapsed<.21);
});
test('persistent socket controls deploy chaff and move a kart without an HTTP input request',async t=>{
  const {multiplayer,post,origin}=await serverFor(t);const host=await post('/api/rooms',{name:'Host',driver:0,arena:0,bots:0});const room=multiplayer.rooms.get(host.code);room.world.phase='racing';
  const socket=new WebSocket(origin.replace('http:','ws:')+'/api/socket',{origin});t.after(()=>socket.terminate());socket.on('error',()=>{});
  await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});
  assert.equal(socket.extensions,'permessage-deflate');
  const state=()=>new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('No shared state received')),2000);socket.once('message',(data,binary)=>{clearTimeout(timeout);if(binary){resolve(decodeBinarySnapshot(data));return;}const message=JSON.parse(data);assert.equal(message.type,'pong');resolve(message);});});
  const joined=state();socket.send(JSON.stringify({type:'authenticate',token:host.token}));assert.equal((await joined).you,0);
  const ping=state();socket.send(JSON.stringify({type:'ping',sent:12.5}));assert.deepEqual(await ping,{type:'pong',sent:12.5});
  socket.send(JSON.stringify({type:'input',sequence:0,keys:['arrowup'],actions:[{type:'chaff'}]}));await new Promise(resolve=>setTimeout(resolve,20));const next=state();multiplayer.step(.05);const update=await next;
  assert.equal(update.world.chaff,3);assert.ok(update.world.speed>0);assert.equal(update.players.length,1);
});
test('socket connections with an invalid room token are closed',async t=>{
  const {origin}=await serverFor(t);const socket=new WebSocket(origin.replace('http:','ws:')+'/api/socket',{origin});t.after(()=>socket.terminate());socket.on('error',()=>{});
  await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});
  const closed=new Promise(resolve=>socket.once('close',code=>resolve(code)));socket.send(JSON.stringify({type:'authenticate',token:'invalid'}));assert.equal(await closed,1008);
});
test('irrelevant action fields cannot corrupt a match and action identifiers stay in range',async t=>{
  const {multiplayer,post}=await serverFor(t);const host=await post('/api/rooms',{name:'Host',driver:0,arena:0,bots:0});const room=multiplayer.rooms.get(host.code);
  Object.assign(room.world,{phase:'racing',fireCooldown:0});
  assert.equal((await post('/api/input',{sequence:0,keys:[],actions:[{type:'fire',wx:'unused',wz:{},item:42}]},host.token)).status,200);
  multiplayer.step(1/60);assert.equal(room.world.ammo,9);assert.equal(room.world.projectiles.length,1);
  assert.equal((await post('/api/input',{sequence:1,keys:[],actions:[{type:'fire',id:4294967296,afterMove:-1}]},host.token)).status,400);
  multiplayer.step(1/60);assert.equal(room.world.ammo,9);
});
test('a rematch accepts the new client command sequence immediately after the previous game',async t=>{
  const {multiplayer,post}=await serverFor(t);const host=await post('/api/rooms',{name:'Host',driver:0,arena:0,bots:0});const room=multiplayer.rooms.get(host.code);
  await post('/api/input',{sequence:150,keys:[],actions:[]},host.token);room.world.phase='finished';
  assert.equal((await post('/api/control',{action:'start'},host.token)).status,200);
  for(let i=0;i<181;i++)multiplayer.step(1/60);
  room.world.fireCooldown=0;
  const epoch=room.world.soundEpoch;
  assert.equal((await post('/api/input',{sequence:0,epoch,keys:['arrowup'],moves:[{sequence:0,keys:['arrowup']}],actions:[{type:'fire',id:0,afterMove:0}]},host.token)).status,200);
  multiplayer.step(1/60);
  assert.equal(room.world.ammo,9);assert.equal(room.world.projectiles.length,1);assert.equal(multiplayer.snapshot(room,multiplayer.members.get(host.token)).movementSequence,0);
});
test('a guest cannot change bots while the original host is AFK',async t=>{
  const {multiplayer,post}=await serverFor(t);const host=await post('/api/rooms',{name:'Host',driver:0,arena:0});const guest=await post('/api/join',{name:'Guest',driver:1,code:host.code});await post('/api/leave',{},host.token);
  assert.equal((await post('/api/control',{action:'bots',bots:0},guest.token)).status,403);
  const back=await post('/api/afk',{afk:false},host.token);assert.equal((await post('/api/control',{action:'bots',bots:0},back.token)).status,200);
  const member=multiplayer.members.get(guest.token),snapshot=multiplayer.snapshot(member.room,member);assert.equal(snapshot.bots,0);assert.equal(snapshot.world.bots.length,1);assert.equal(snapshot.world.id,1);assert.equal(snapshot.world.inactive,false);
});
test('hosting again replaces the only room and invalidates old invitations and sessions',async t=>{
  const {post,multiplayer}=await serverFor(t);const first=await post('/api/rooms',{name:'First',driver:0,arena:0});const oldGuest=await post('/api/join',{name:'Friend',driver:2,code:first.code});
  assert.equal((await post('/api/rooms',{name:'Intruder',driver:0,arena:0})).status,403);assert.equal((await post('/api/rooms',{name:'Guest',driver:0,arena:0},oldGuest.token)).status,403);
  const second=await post('/api/rooms',{name:'Second',driver:1,arena:1},first.token);
  assert.match(first.code,/^[0-9]{2}$/);assert.match(second.code,/^[0-9]{2}$/);assert.notEqual(first.code,second.code);
  assert.equal(multiplayer.rooms.size,1);assert.equal(multiplayer.members.size,1);assert.equal((await post('/api/session',{},first.token)).status,401);assert.equal((await post('/api/session',{},oldGuest.token)).status,401);assert.equal((await post('/api/join',{name:'Guest',driver:2,code:first.code})).status,404);
  const guest=await post('/api/join',{name:'Guest',driver:2,code:second.code});assert.equal(guest.status,200);assert.equal(guest.code,second.code);assert.equal(guest.players.length,2);
  for(const code of ['7','007','A1','12345678'])assert.equal((await post('/api/join',{name:'Guest',driver:2,code})).status,400);
});
test('two-digit allocation preserves a leading zero and never takes an active code',()=>{
  const occupied=new Map(Array.from({length:100},(_,number)=>[String(number).padStart(2,'0'),{}]));occupied.delete('07');assert.equal(allocateRoomCode(occupied),'07');
  occupied.set('07',{});assert.throws(()=>allocateRoomCode(occupied),error=>error.status===503);
});
test('a host resumes from an HttpOnly cookie after going offline without losing the room, scores or input sequencing',async t=>{
  const {multiplayer,post}=await serverFor(t);
  const host=await post('/api/rooms',{name:'Oren',driver:5,arena:0,bots:0});const guest=await post('/api/join',{name:'Friend',driver:1,code:host.code});
  assert.match(host.cookie,/HttpOnly/);assert.match(host.cookie,/SameSite=Lax/);
  const room=multiplayer.rooms.get(host.code);Object.assign(room.world,{phase:'racing',kills:4,deaths:2,wx:-65,wz:0,heading:0,motionHeading:0,cameraHeading:0,supplies:[]});
  await post('/api/input',{sequence:40,epoch:room.soundEpoch,keys:['arrowup'],moves:[{sequence:0,keys:['arrowup']}],actions:[]},host.token);multiplayer.step(1/60);
  await post('/api/input',{sequence:41,epoch:room.soundEpoch,keys:[],moves:[],actions:[{type:'chaff',id:0,afterMove:1}]},host.token);multiplayer.step(1/60);
  multiplayer.members.get(host.token).lastSeen=Date.now()-16000;multiplayer.step(1/60);
  assert.equal(room.host,host.you);assert.equal(room.members.size,2);assert.equal(room.members.get(host.you).afk,true);
  const resumed=await post('/api/session',{},undefined,{Cookie:host.cookie.split(';')[0]});
  assert.equal(resumed.status,200);assert.notEqual(resumed.token,host.token);assert.equal(resumed.code,host.code);assert.equal(resumed.you,host.you);assert.equal(resumed.host,host.you);
  assert.deepEqual([resumed.world.name,resumed.world.driver,resumed.world.kills,resumed.world.deaths],['Oren',5,4,2]);assert.equal(resumed.players.length,2);assert.equal(resumed.world.afk,false);
  assert.equal((await post('/api/control',{action:'reset'},host.token)).status,401);assert.equal((await post('/api/control',{action:'reset'},guest.token)).status,403);
  const client=new ArenaClient();client.accept(room.core.packet(host.you),0);client.frame(1/60,new Set(['arrowup']),1/60);assert.equal(client.action('chaff',undefined,1/60),true);
  assert.equal((await post('/api/input',client.outbound(['arrowup']),resumed.token)).status,200);multiplayer.step(1/60);
  const state=multiplayer.snapshot(room,multiplayer.members.get(resumed.token));assert.equal(state.movementSequence,1);assert.ok(state.world.speed>0);assert.equal(state.world.chaff,3);assert.equal(multiplayer.rooms.size,1);
});
test('AFK keeps a player and their scores in the room, prevents combat, and allows returning to the same kart',async t=>{
  const {multiplayer,post}=await serverFor(t);
  const host=await post('/api/rooms',{name:'Host',driver:0,arena:0,bots:0}),guest=await post('/api/join',{name:'Sam',driver:1,code:host.code});
  const room=multiplayer.rooms.get(host.code);Object.assign(room.world,{phase:'racing',wx:-65,wz:0,heading:0,motionHeading:0,cameraHeading:0,shield:0,health:3,fireCooldown:0,supplies:[]});Object.assign(room.world.bots[0],{wx:-65,wz:20,heading:Math.PI,motionHeading:Math.PI,cameraHeading:Math.PI,shield:0,health:3,kills:2,deaths:1});
  const away=await post('/api/afk',{afk:true},guest.token);assert.equal(away.status,200);assert.equal(away.world.afk,true);assert.equal(away.players.find(player=>player.id===guest.you).afk,true);
  await post('/api/input',{sequence:0,keys:['arrowup',' '],actions:[{type:'fire'}]},away.token);
  await post('/api/input',{sequence:0,keys:[],actions:[{type:'select',item:'missile'},{type:'fire'}]},host.token);
  for(let i=0;i<60;i++)multiplayer.step(1/60);
  const waiting=multiplayer.snapshot(room,multiplayer.members.get(away.token));assert.deepEqual([waiting.world.wx,waiting.world.wz,waiting.world.health,waiting.world.kills,waiting.world.deaths],[-65,20,3,2,1]);assert.equal(waiting.players.length,2);assert.ok(waiting.world.projectiles.every(shot=>shot.owner!==guest.you));
  const back=await post('/api/afk',{afk:false},away.token);assert.equal(back.you,guest.you);assert.equal(back.world.afk,false);assert.equal(back.world.kills,2);
  await post('/api/input',{sequence:0,keys:['arrowup'],actions:[]},back.token);multiplayer.step(1/60);assert.ok(multiplayer.snapshot(room,multiplayer.members.get(back.token)).world.speed>0);
});
test('a saved room cookie rejoins the same player rather than allocating a second seat',async t=>{
  const {post}=await serverFor(t);const host=await post('/api/rooms',{name:'Host',driver:0,arena:0,bots:0},undefined,{'X-Forwarded-Proto':'https'});
  assert.match(host.cookie,/; Secure/);
  const joined=await post('/api/join',{name:'Other name',driver:1,code:host.code},undefined,{Cookie:host.cookie.split(';')[0]});
  assert.equal(joined.you,host.you);assert.equal(joined.world.name,'Host');assert.equal(joined.players.length,1);assert.equal(joined.host,joined.you);
});
test('saved name cookies preserve names and treat malformed cookies as an empty preference',()=>{
  assert.equal(savedPlayerName('other=1; wild-wheels-name=Tamar%20%F0%9F%A6%97'),'Tamar 🦗');
  assert.equal(savedPlayerName('wild-wheels-name=Sam%20%3Cb%3E'),'Sam <b>');
  assert.equal(savedPlayerName('wild-wheels-name=%invalid'),'Player');assert.equal(savedPlayerName(''),'Player');assert.equal(savedPlayerName(`wild-wheels-name=${'x'.repeat(25)}`),'Player');
});
test('browsers can compare stable build IDs without receiving cached version information',async t=>{
  const {origin}=await serverFor(t);const first=await fetch(origin+'/build.json'),build=await first.json();const again=await fetch(origin+'/build.json').then(response=>response.json());
  assert.match(build.build,/^[A-F0-9]{10}$/);assert.equal(build.build,again.build);assert.equal(first.headers.get('cache-control'),'no-store');
});
