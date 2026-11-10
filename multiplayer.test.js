import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameServer } from './server.js';
import WebSocket from 'ws';
import { allocateRoomCode } from './multiplayer.js';

async function serverFor(t){
  const app=createGameServer();clearInterval(app.multiplayer.timer);await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{app.multiplayer.close();app.server.closeAllConnections();app.server.close();});
  const origin=`http://127.0.0.1:${app.server.address().port}`;
  const post=async(path,body,token,headers={})=>{const response=await fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`} :{}),...headers},body:JSON.stringify(body),signal:AbortSignal.timeout(3000)});return {status:response.status,...await response.json()};};
  return {...app,post,origin};
}
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
  assert.deepEqual(guest5.players.map(player=>player.driver),[0,1,2,3,0,1]);
  assert.equal(new Set(guest5.players.map(player=>player.color)).size,6);
  assert.equal(guest1.world.driver,1);
  assert.equal(guest2.world.driver,2);
  assert.equal(guest3.world.driver,3);
  assert.equal(guest4.world.driver,0);
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
test('guests cannot start or change a match and invalid or cross-origin controls are rejected',async t=>{
  const {post}=await serverFor(t);const host=await post('/api/rooms',{name:'Host',driver:0,arena:0});const guest=await post('/api/join',{name:'Guest',driver:1,code:host.code});
  assert.equal((await post('/api/control',{action:'start'},guest.token)).status,403);assert.equal((await post('/api/control',{action:'arena',arena:1},guest.token)).status,403);
  assert.equal((await post('/api/input',{sequence:0,keys:['teleport'],actions:[]},host.token)).status,400);assert.equal((await post('/api/input',{sequence:0,keys:[],actions:[{type:'set-health',health:99}]},host.token)).status,400);
  assert.equal((await post('/api/control',{action:'start'},host.token,{Origin:'https://example.invalid'})).status,403);assert.equal((await post('/api/control',{action:'start'})).status,401);
});
test('host departure transfers control and a room never accepts more than six players',async t=>{
  const {multiplayer,post}=await serverFor(t);const host=await post('/api/rooms',{name:'Host',driver:0,arena:0});const guests=[];
  for(let index=1;index<6;index++)guests.push(await post('/api/join',{name:`Player ${index}`,driver:index%4,code:host.code}));
  assert.equal((await post('/api/join',{name:'Extra',driver:1,code:host.code})).status,409);await post('/api/leave',{},host.token);
  const room=multiplayer.rooms.get(host.code);assert.equal(room.host,guests[0].you);assert.equal((await post('/api/control',{action:'start'},guests[0].token)).status,200);
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
  const state=()=>new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('No shared state received')),2000);socket.once('message',data=>{clearTimeout(timeout);resolve(JSON.parse(data));});});
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
test('a transferred host can remove all bots and see only their own kart',async t=>{
  const {multiplayer,post}=await serverFor(t);const host=await post('/api/rooms',{name:'Host',driver:0,arena:0});const guest=await post('/api/join',{name:'Guest',driver:1,code:host.code});await post('/api/leave',{},host.token);
  assert.equal((await post('/api/control',{action:'bots',bots:0},guest.token)).status,200);
  const member=multiplayer.members.get(guest.token),snapshot=multiplayer.snapshot(member.room,member);assert.equal(snapshot.bots,0);assert.equal(snapshot.world.bots.length,0);assert.equal(snapshot.world.id,1);assert.equal(snapshot.world.inactive,false);
});
test('room links use unique two-digit codes that other players can join',async t=>{
  const {post}=await serverFor(t);const first=await post('/api/rooms',{name:'First',driver:0,arena:0});const second=await post('/api/rooms',{name:'Second',driver:1,arena:1});
  assert.match(first.code,/^[0-9]{2}$/);assert.match(second.code,/^[0-9]{2}$/);assert.notEqual(first.code,second.code);
  const guest=await post('/api/join',{name:'Guest',driver:2,code:first.code});assert.equal(guest.status,200);assert.equal(guest.code,first.code);assert.equal(guest.players.length,2);
  for(const code of ['7','007','A1','12345678'])assert.equal((await post('/api/join',{name:'Guest',driver:2,code})).status,400);
});
test('two-digit allocation preserves a leading zero and never takes an active code',()=>{
  const occupied=new Map(Array.from({length:100},(_,number)=>[String(number).padStart(2,'0'),{}]));occupied.delete('07');assert.equal(allocateRoomCode(occupied),'07');
  occupied.set('07',{});assert.throws(()=>allocateRoomCode(occupied),error=>error.status===503);
});
test('browsers can compare stable build IDs without receiving cached version information',async t=>{
  const {origin}=await serverFor(t);const first=await fetch(origin+'/build.json'),build=await first.json();const again=await fetch(origin+'/build.json').then(response=>response.json());
  assert.match(build.build,/^[A-F0-9]{10}$/);assert.equal(build.build,again.build);assert.equal(first.headers.get('cache-control'),'no-store');
});
