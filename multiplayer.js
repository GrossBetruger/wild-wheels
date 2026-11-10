import { randomBytes, randomInt } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { WebSocketServer } from 'ws';
import { createBattle, tickBattle, fireBattle, releaseChaff, standings } from './combat.js';
import { drivers, selectItem, cycleItem } from './engine.js';
import { ngrokOrigin } from './ngrok.js';

const KEYS=new Set(['arrowup','arrowdown','arrowleft','arrowright','w','a','s','d','shift',' ']);
const PLAYER_COLORS=['#8456cf','#df7053','#67a99c','#edb84f','#777cbb','#db8daf'];
const FIELDS='id driver color wx wz heading motionHeading cameraHeading speed health kills deaths killStreak vulcan chaff chaffCooldown destroyed shield ammo missiles turbos item fireCooldown boost drift wasDrifting yaw spin celebrate stun voiceCooldown human name notice noticeTime inactive'.split(' ');
const actorData=actor=>Object.fromEntries(FIELDS.map(key=>[key,actor[key]]));
const problem=(status,message)=>Object.assign(new Error(message),{status});
export function allocateRoomCode(rooms){
  const available=Array.from({length:100},(_,number)=>String(number).padStart(2,'0')).filter(code=>!rooms.has(code));
  if(!available.length)throw problem(503,'All room codes are in use. Try again when a room closes.');
  return available[randomInt(available.length)];
}
const person=body=>{
  if(!body||typeof body.name!=='string'||body.name.trim().length<1||body.name.length>24||(body.driver!==null&&(!Number.isInteger(body.driver)||body.driver<0||body.driver>=drivers.length)))throw problem(400,'Enter a name (1–24 characters) and choose a driver.');
  return {name:body.name.trim(),driver:body.driver};
};
export class Multiplayer {
  rooms=new Map();members=new Map();limits=new Map();
  constructor(){this.lastAdvance=performance.now();this.accumulator=0;this.timer=setInterval(()=>this.advance(performance.now()),1000/60);this.timer.unref();}
  advance(now){this.accumulator=Math.min(.25,this.accumulator+Math.max(0,(now-this.lastAdvance)/1000));this.lastAdvance=now;while(this.accumulator>=1/60){this.step(1/60);this.accumulator-=1/60;}}
  close(){clearInterval(this.timer);for(const socket of this.sockets?.clients??[])socket.terminate();this.sockets?.close();for(const member of this.members.values())member.stream?.end();this.members.clear();this.rooms.clear();}
  attach(server){
    this.sockets=new WebSocketServer({noServer:true,maxPayload:2048,perMessageDeflate:false});
    server.on('upgrade',(req,socket,head)=>{
      try{if(req.url!=='/api/socket'||!req.headers.origin||new URL(req.headers.origin).host!==req.headers.host||this.sockets.clients.size>=192)throw problem(403,'Denied');this.limit(req,'upgrade',10);this.sockets.handleUpgrade(req,socket,head,ws=>this.openSocket(ws));}catch{socket.destroy();}
    });
  }
  openSocket(socket){
    let member,count=0,since=Date.now();const authTimer=setTimeout(()=>socket.close(1008,'Authentication required'),3000);authTimer.unref();
    socket.on('error',()=>{});
    socket.on('message',(data,binary)=>{
      try{
        if(binary)throw problem(400,'Text messages required');const message=JSON.parse(data.toString());
        if(!member){if(message.type!=='authenticate'||typeof message.token!=='string')throw problem(401,'Authenticate first');member=this.members.get(message.token);if(!member)throw problem(401,'Invalid room session');clearTimeout(authTimer);member.socket?.close(1000,'Connection replaced');member.socket=socket;member.lastSeen=Date.now();this.send(member,this.snapshot(member.room,member));return;}
        const now=Date.now();if(now-since>=1000){since=now;count=0;}if(++count>100)throw problem(429,'Too many inputs');
        if(message.type!=='input')throw problem(400,'Unknown message');this.controls(member,message);member.lastSeen=now;
      }catch{socket.close(1008,'Invalid controls or session');}
    });
    socket.on('close',()=>{clearTimeout(authTimer);if(member?.socket===socket){member.socket=null;member.keys.clear();}});
  }
  controls(member,body){
    if(!Number.isSafeInteger(body.sequence)||body.sequence<0||!Array.isArray(body.keys)||body.keys.length>10||body.keys.some(k=>!KEYS.has(k))||!Array.isArray(body.actions)||body.actions.length>8)throw problem(400,'Invalid controls.');
    for(const action of body.actions)if(!action||!['fire','chaff','cycle','select'].includes(action.type)||(action.type==='select'&&!['hedgehog','missile','boost'].includes(action.item)))throw problem(400,'Invalid action.');
    if(body.sequence>member.sequence){member.sequence=body.sequence;member.keys=new Set(body.keys);member.inputAt=Date.now();member.actions.push(...body.actions);member.actions=member.actions.slice(-16);}
  }
  makeWorld(room){
    room.world=createBattle(0,room.arena);room.world.human=true;room.world.skill=.85;room.world.multiplayer=true;room.events=[];room.voices=[];
    for(const member of room.members.values())this.assign(room,member);
    this.roster(room);
  }
  assign(room,member){const actor=[room.world,...room.world.bots][member.id];if(actor.inactive||actor.destroyed||room.world.phase==='racing'){const fresh=createBattle(member.driver,room.arena);Object.assign(actor,actorData([fresh,...fresh.bots][member.id]),{reload:0,brain:0,path:[]});}Object.assign(actor,{human:true,inactive:false,name:member.name,driver:member.driver,color:member.color,notice:'',noticeTime:0});member.keys=new Set();member.actions=[];}
  roster(room){
    room.botCount=Math.min(room.botCount,6-room.members.size);
    const actors=[room.world,...room.world.bots],bots=actors.filter(actor=>!room.members.has(actor.id)).slice(0,room.botCount);
    for(const actor of actors){const human=room.members.has(actor.id),active=human||bots.includes(actor);if(active&&actor.inactive){actor.destroyed=0;actor.health=3;actor.shield=2;actor.speed=0;}actor.human=human;actor.color=PLAYER_COLORS[actor.id];actor.inactive=!active;if(!active){actor.destroyed=1e9;actor.speed=0;}if(!human)actor.name=undefined;}
  }
  join(room,body){
    const identity=person(body);if(room.members.size>=6)throw problem(409,'This room is full (6 players).');
    const id=[0,1,2,3,4,5].find(slot=>!room.members.has(slot)),token=randomBytes(32).toString('hex');
    const used=new Set([...room.members.values()].map(player=>player.driver));
    const driver=identity.driver??drivers.findIndex((_,index)=>!used.has(index));
    const member={...identity,driver:driver<0?id%drivers.length:driver,color:PLAYER_COLORS[id],name:identity.name==='Player'?`Player ${id+1}`:identity.name,id,token,room,keys:new Set(),actions:[],lastSeen:Date.now(),sequence:-1};room.members.set(id,member);this.members.set(token,member);this.assign(room,member);this.roster(room);this.broadcast(room);return member;
  }
  remove(member){
    const room=member.room;this.members.delete(member.token);room.members.delete(member.id);member.stream?.end();member.socket?.close(1000,'Left room');
    const actor=[room.world,...room.world.bots][member.id];actor.human=false;actor.name=undefined;
    if(!room.members.size){this.rooms.delete(room.code);return;}
    if(room.host===member.id)room.host=room.members.keys().next().value;
    this.roster(room);
    this.broadcast(room);
  }
  snapshot(room,member){
    const world=room.world,actors=[world,...world.bots],actor=actors[member.id],order=standings(world),rank=order.findIndex(k=>k.id===member.id)+1;
    const {bots,...globals}=world;
    const view={...globals,...actorData(actor),bots:actors.filter(k=>k.id!==member.id&&!k.inactive).map(actorData),rank,finishRank:world.finishRank===null?null:rank};
    view.events=room.events.filter(event=>event!=='victory'&&event!=='finish');
    if(room.events.some(event=>event==='victory'||event==='finish'))view.events.push(rank===1?'victory':'finish');
    view.voices=room.voices;view.name=member.name;
    const label=id=>id===member.id?'YOU':actors[id]?.name??drivers[actors[id]?.driver??0].name.split(' ')[0];
    view.killFeed=world.killFeed.map(entry=>({...entry,text:`${label(entry.attacker)} → ${label(entry.victim)}`}));
    return {type:'state',code:room.code,you:member.id,host:room.host,arena:room.arena,bots:room.botCount,players:[...room.members.values()].map(p=>({id:p.id,name:p.name,driver:p.driver,color:p.color})),world:view};
  }
  send(member,data){
    if(member.socket?.readyState===1){if(member.socket.bufferedAmount>256*1024){member.socket.close(1013,'Connection too slow');return;}member.socket.send(JSON.stringify(data));return;}
    const stream=member.stream;if(!stream||stream.destroyed||stream.writableEnded)return;
    if(stream.writableLength>256*1024){stream.destroy();return;}
    stream.write(`data: ${JSON.stringify(data)}\n\n`);
  }
  broadcast(room){for(const member of room.members.values())this.send(member,this.snapshot(room,member));}
  step(dt){
    const now=Date.now();
    for(const room of this.rooms.values()){
      for(const member of [...room.members.values()])if(now-member.lastSeen>15000)this.remove(member);
      if(!this.rooms.has(room.code))continue;
      const actors=[room.world,...room.world.bots],inputs=new Map();
      for(const member of room.members.values()){
        inputs.set(member.id,now-member.inputAt<600?member.keys:new Set());
        const actor=actors[member.id];
        for(const action of member.actions.splice(0))switch(action.type){case 'fire':fireBattle(room.world,actor);break;case 'chaff':releaseChaff(room.world,actor);break;case 'cycle':cycleItem(actor);break;case 'select':selectItem(actor,action.item);break;}
      }
      // Slot zero can become an AI when its player leaves; human clients keep their own slots.
      tickBattle(room.world,new Set(),dt,inputs);
      room.events.push(...room.world.events);room.voices.push(...room.world.voices);room.events=room.events.slice(-64);room.voices=room.voices.slice(-16);room.world.events=[];room.world.voices=[];
      room.snapshotClock=(room.snapshotClock??0)+dt;if(room.snapshotClock>=1/30-1e-8){room.snapshotClock=0;this.broadcast(room);room.events=[];room.voices=[];}
    }
    for(const [key,limit] of this.limits)if(now-limit.since>60000)this.limits.delete(key);
  }
  limit(req,path,max,window=1000){
    const key=`${req.socket.remoteAddress}:${path}`,now=Date.now();let limit=this.limits.get(key);
    if(!limit||now-limit.since>=window){limit={since:now,count:0};this.limits.set(key,limit);}
    if(++limit.count>max)throw problem(429,'Too many requests. Try again shortly.');
  }
  async body(req){
    if(!req.headers['content-type']?.startsWith('application/json'))throw problem(415,'Use JSON.');
    let size=0;const parts=[];for await(const part of req){size+=part.length;if(size>2048)throw problem(413,'Request too large.');parts.push(part);}
    try{const value=JSON.parse(Buffer.concat(parts).toString());if(!value||Array.isArray(value)||typeof value!=='object')throw new Error();return value;}catch{throw problem(400,'Invalid JSON.');}
  }
  async handle(req,res){
    const path=(req.url??'').split('?')[0];if(!path.startsWith('/api/'))return false;
    const json=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
    try{
      if(req.headers['sec-fetch-site']==='cross-site'||(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host))throw problem(403,'Use the game from the same server.');
      if(path==='/api/info'&&req.method==='GET'){
        this.limit(req,'info',20);const port=this.port??5173;
        const addresses=Object.values(networkInterfaces()).flat().filter(n=>n&&!n.internal&&n.family==='IPv4').map(n=>`http://${n.address}:${port}`);
        json(200,{addresses,publicOrigin:await ngrokOrigin(port),controlPort:this.controlPort??null});return true;
      }
      if(path==='/api/rooms'||path==='/api/join'){
        if(req.method!=='POST')throw problem(405,'Use POST.');this.limit(req,'join',20,60000);const body=await this.body(req);person(body);
        let room;
        if(path==='/api/rooms'){
          if(this.rooms.size>=32)throw problem(503,'Server has too many rooms.');
          if(!Number.isInteger(body.arena)||body.arena<0||body.arena>1)throw problem(400,'Choose an arena.');
          if(body.bots!==undefined&&(!Number.isInteger(body.bots)||body.bots<0||body.bots>5))throw problem(400,'Choose 0–5 bots.');
          const code=allocateRoomCode(this.rooms);
          room={code,arena:body.arena,botCount:body.bots??1,host:0,members:new Map()};this.makeWorld(room);this.rooms.set(code,room);
        }
        if(path==='/api/join'){if(typeof body.code!=='string'||! /^[0-9]{2}$/.test(body.code))throw problem(400,'Use a two-digit room code (00–99).');room=this.rooms.get(body.code);if(!room)throw problem(404,'Room not found.');}
        const member=this.join(room,body);json(200,{token:member.token,...this.snapshot(room,member)});return true;
      }
      const token=req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1],member=this.members.get(token);if(!member)throw problem(401,'Rejoin the room to reconnect.');
      member.lastSeen=Date.now();const room=member.room;
      if(path==='/api/events'&&req.method==='GET'){
        this.limit(req,'stream',12);member.stream?.end();res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});res.flushHeaders();member.stream=res;this.send(member,this.snapshot(room,member));req.on('close',()=>{if(member.stream===res){member.stream=null;member.keys.clear();}});return true;
      }
      if(req.method!=='POST')throw problem(405,'Use POST.');
      this.limit(req,path,path==='/api/input'?180:15);const body=await this.body(req);
      switch(path){
        case '/api/driver':{
          if(!['ready','finished'].includes(room.world.phase))throw problem(409,'Choose an animal before the next match.');
          if(!Number.isInteger(body.driver)||body.driver<0||body.driver>=drivers.length)throw problem(400,'Choose an animal.');
          member.driver=body.driver;[room.world,...room.world.bots][member.id].driver=body.driver;
          this.broadcast(room);json(200,{ok:true});break;
        }
        case '/api/input':{
          this.controls(member,body);json(200,{ok:true});break;
        }
        case '/api/control':{
          if(room.host!==member.id)throw problem(403,'Only the room host can start or change the match.');
          switch(body.action){case 'start':if(!['ready','finished'].includes(room.world.phase))throw problem(409,'Match already running.');this.makeWorld(room);room.world.phase='countdown';break;case 'reset':this.makeWorld(room);break;case 'arena':if(!Number.isInteger(body.arena)||body.arena<0||body.arena>1)throw problem(400,'Choose an arena.');room.arena=body.arena;this.makeWorld(room);break;case 'bots':if(!['ready','finished'].includes(room.world.phase))throw problem(409,'Change bots before the next match.');if(!Number.isInteger(body.bots)||body.bots<0||body.bots>6-room.members.size)throw problem(400,'Too many bots for this room.');room.botCount=body.bots;this.makeWorld(room);break;default:throw problem(400,'Unknown match control.');}
          this.broadcast(room);json(200,{ok:true});break;
        }
        case '/api/leave':this.remove(member);json(200,{ok:true});break;
        default:throw problem(404,'Not found.');
      }
    }catch(error){if(!res.headersSent)json(error.status??500,{error:error.status?error.message:'Server error.'});}
    return true;
  }
}
