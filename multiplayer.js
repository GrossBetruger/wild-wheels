import { randomBytes, randomInt } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { WebSocketServer } from 'ws';
import { drivers } from './engine.js';
import { ArenaCore, mergeArenaPacket } from './arena-core.js';
import { ngrokOrigin } from './ngrok.js';
import { createBinaryEncoder, decodeBinarySnapshot } from './binary-wire.js';
const encodeBinarySnapshot=createBinaryEncoder();

const KEYS=new Set(['arrowup','arrowdown','arrowleft','arrowright','w','a','s','d','shift',' ']);
const PLAYER_COLORS=['#8456cf','#df7053','#67a99c','#edb84f','#777cbb','#db8daf'];
const problem=(status,message)=>Object.assign(new Error(message),{status});
export function allocateRoomCode(rooms){
  const available=Array.from({length:100},(_,number)=>String(number).padStart(2,'0')).filter(code=>!rooms.has(code));
  if(!available.length)throw problem(503,'All room codes are in use. Try again when a room closes.');
  return available[randomInt(available.length)];
}
const person=body=>{
  if(!body||typeof body.name!=='string'||body.name.trim().length<1||body.name.length>24||(body.driver!==null&&(!Number.isInteger(body.driver)||body.driver<0||body.driver>=drivers.length)))throw problem(400,'Enter a name (1–24 characters) and choose a driver.');
  if(body.role!==undefined&&!['driver','bomber'].includes(body.role))throw problem(400,'Choose a driver or bomber role.');
  return {name:body.name.trim(),driver:body.driver,role:body.role??'driver'};
};
export class Multiplayer {
  rooms=new Map();members=new Map();limits=new Map();
  constructor({startNow=()=>performance.now(),fixtureWorld}={}){this.fixtureWorld=fixtureWorld;this.startNow=startNow;this.lastAdvance=performance.now();this.accumulator=0;this.timer=setInterval(()=>this.advance(performance.now()),1000/60);this.timer.unref();}
  advance(now){this.accumulator=Math.min(.25,this.accumulator+Math.max(0,(now-this.lastAdvance)/1000));this.lastAdvance=now;while(this.accumulator>=1/60){this.step(1/60);this.accumulator-=1/60;}}
  close(){clearInterval(this.timer);for(const socket of this.sockets?.clients??[])socket.terminate();this.sockets?.close();for(const member of this.members.values())member.stream?.end();this.members.clear();this.rooms.clear();}
  attach(server){
    this.sockets=new WebSocketServer({noServer:true,maxPayload:2048,perMessageDeflate:{serverNoContextTakeover:true,clientNoContextTakeover:true,concurrencyLimit:2,threshold:1024,zlibDeflateOptions:{level:1}}});
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
        if(!member){if(message.type!=='authenticate'||typeof message.token!=='string')throw problem(401,'Authenticate first');member=this.members.get(message.token);if(!member)throw problem(401,'Invalid room session');clearTimeout(authTimer);member.socket?.close(1000,'Connection replaced');member.socket=socket;member.lastSeen=Date.now();this.send(member,member.room.core.packetRecord(member.id));return;}
        const now=Date.now();if(now-since>=1000){since=now;count=0;}if(++count>100)throw problem(429,'Too many inputs');
        if(message.type==='ping'){if(!Number.isFinite(message.sent)||message.sent<0)throw problem(400,'Invalid ping');socket.send(JSON.stringify({type:'pong',sent:message.sent}));return;}
        if(message.type!=='input')throw problem(400,'Unknown message');this.controls(member,message);member.lastSeen=now;
      }catch{socket.close(1008,'Invalid controls or session');}
    });
    socket.on('close',()=>{clearTimeout(authTimer);if(member?.socket===socket){member.socket=null;member.keys.clear();}});
  }
  controls(member,body){
    if(!Number.isSafeInteger(body.sequence)||body.sequence<0||!Array.isArray(body.keys)||body.keys.length>10||body.keys.some(k=>!KEYS.has(k))||!Array.isArray(body.actions)||body.actions.length>8)throw problem(400,'Invalid controls.');
    for(const action of body.actions)if(!action||!['fire','turbo','somersault','chaff','cycle','select','bomb'].includes(action.type)||(action.type==='select'&&!['hedgehog','missile'].includes(action.item))||(action.type==='bomb'&&((!Number.isFinite(action.wx)||!Number.isFinite(action.wz)||Math.abs(action.wx)>96||Math.abs(action.wz)>96)||(action.kind!==undefined&&!['abomb','stink'].includes(action.kind)))))throw problem(400,'Invalid action.');
    for(const action of body.actions)if(action.id!==undefined&&(!Number.isSafeInteger(action.id)||action.id<0||action.id>0xffffffff||!Number.isSafeInteger(action.afterMove)||action.afterMove< -1||action.afterMove>(member.acceptedMove??-1)+128))throw problem(400,'Invalid action sequence.');
    if(body.epoch!==undefined&&body.epoch!==member.room.core.status.soundEpoch)return;
    if(body.moves!==undefined){
      if(Array.isArray(body.moves)&&body.moves.some(move=>move?.steer!==undefined&&(!Number.isFinite(move.steer)||Math.abs(move.steer)>1)))throw problem(400,'Invalid steering.');
      if(!Number.isSafeInteger(body.epoch)||!Array.isArray(body.moves)||body.moves.length>8||body.moves.some(move=>!move||!Number.isSafeInteger(move.sequence)||move.sequence<0||!Array.isArray(move.keys)||move.keys.length>9||move.keys.some(key=>!KEYS.has(key)||key===' ')))throw problem(400,'Invalid movement.');
      if(body.epoch===member.room.core.status.soundEpoch){
        member.commandMode=true;member.moveQueue??=[];member.acceptedMove??=-1;
        for(const move of body.moves){
          if(move.sequence<=member.acceptedMove)continue;
          if(move.sequence!==member.acceptedMove+1||member.moveQueue.length>=120)throw problem(400,'Movement out of sequence.');
          member.moveQueue.push(move);member.acceptedMove=move.sequence;
        }
      }
    }
    if(body.sequence>member.sequence){
      member.sequence=body.sequence;member.keys=new Set(body.keys);member.inputAt=Date.now();
      for(const action of body.actions){
        if(action.id!==undefined){if(action.id<=(member.acceptedAction??-1))continue;member.acceptedAction=action.id;member.predictedActions=true;}
        if(member.actions.length>=64)throw problem(429,'Too many pending actions.');
        member.actions.push({type:action.type,...(action.id!==undefined?{id:action.id,afterMove:action.afterMove}:{}),...(action.type==='bomb'?{wx:action.wx,wz:action.wz,...(action.kind!==undefined?{kind:action.kind}:{})}:{}),...(action.type==='select'?{item:action.item}:{})});
      }
    }
  }
  roomConfig(room){return {code:room.code,arena:room.arena,bots:room.botCount,host:room.host,epoch:room.soundEpoch,seed:room.seed??0,players:[...room.members.values()].map(p=>({id:p.id,name:p.name,driver:p.driver,role:p.role,wantsToPlay:Boolean(p.wantsToPlay),playRequestRefused:Boolean(p.playRequestRefused)})),startRequest:room.startRequest?{id:room.startRequest.id,remainingMs:Math.max(0,room.startRequest.deadline-this.startNow())}:null};}
  syncRoom(room){const config=this.roomConfig(room),text=JSON.stringify(config);if(text===room.configText)return;room.core.configure(config);room.configText=text;}
  makeWorld(room){
    room.startRequest=null;room.soundEpoch=(room.soundEpoch??0)+1;room.seed=randomInt(0x100000000);room.botCount=Math.min(room.botCount,6-room.members.size);
    for(const member of room.members.values()){member.wantsToPlay=false;member.playRequestRefused=false;this.assign(room,member);}
    const config=this.roomConfig(room);room.core=ArenaCore.room(config);room.configText=JSON.stringify(config);this.fixtureWorld?.(room);
  }
  armPlayRequest(room){room.startRequest={id:room.startRequestSequence=(room.startRequestSequence??0)+1,deadline:this.startNow()+3000};}
  setReady(member,ready){
    const room=member.room;
    if(!['ready','finished'].includes(room.core.status.phase))throw problem(409,'Match already running.');
    if(member.id===room.host)throw problem(403,'The host can start the match directly.');
    if(typeof ready!=='boolean')throw problem(400,'Choose ready or not ready.');
    member.wantsToPlay=ready;member.playRequestRefused=false;
    if(ready&&!room.startRequest)this.armPlayRequest(room);
    if(![...room.members.values()].some(player=>player.id!==room.host&&player.wantsToPlay))room.startRequest=null;
  }
  refusePlayRequest(member,requestId){
    const room=member.room;
    if(room.host!==member.id)throw problem(403,'Only the host can refuse a play request.');
    if(!Number.isSafeInteger(requestId)||requestId<1)throw problem(400,'Choose a pending play request.');
    if(!room.startRequest||room.startRequest.id!==requestId||!['ready','finished'].includes(room.core.status.phase))throw problem(409,'This play request is no longer pending.');
    room.startRequest=null;
    for(const player of room.members.values()){if(player.wantsToPlay)player.playRequestRefused=true;player.wantsToPlay=false;}
  }
  assign(room,member){member.keys=new Set();member.actions=[];member.sequence=-1;member.inputAt=0;member.moveQueue=[];member.acceptedMove=-1;member.lastMove=-1;member.moveCredit=0;member.acceptedAction=-1;member.actionAck=-1;member.commandMode=false;member.predictedActions=false;}
  roster(room){room.botCount=Math.min(room.botCount,6-room.members.size);this.syncRoom(room);}
  join(room,body){
    const identity=person(body);if(room.members.size>=6)throw problem(409,'This room is full (6 players).');
    const id=[0,1,2,3,4,5].find(slot=>!room.members.has(slot)),token=randomBytes(32).toString('hex');
    const used=new Set([...room.members.values()].map(player=>player.driver));
    const driver=identity.driver??drivers.findIndex((_,index)=>!used.has(index));
    const member={...identity,driver:driver<0?id%drivers.length:driver,color:PLAYER_COLORS[id],name:identity.name==='Player'?`Player ${id+1}`:identity.name,id,token,room,keys:new Set(),actions:[],lastSeen:Date.now(),sequence:-1};room.members.set(id,member);this.members.set(token,member);this.assign(room,member);this.roster(room);this.broadcast(room);return member;
  }
  remove(member){
    const room=member.room;this.members.delete(member.token);room.members.delete(member.id);member.stream?.end();member.socket?.close(1000,'Left room');
    if(!room.members.size){this.rooms.delete(room.code);return;}
    const hostLeft=room.host===member.id;
    if(hostLeft)room.host=room.members.keys().next().value;
    const waiting=[...room.members.values()].some(player=>player.id!==room.host&&player.wantsToPlay);
    if(!waiting)room.startRequest=null;
    if(hostLeft&&waiting&&room.startRequest)this.armPlayRequest(room);
    this.roster(room);
    this.broadcast(room);
  }
  snapshot(room,member){this.syncRoom(room);return decodeBinarySnapshot(room.core.packet(member.id));}
  send(member,data){
    const socket=member.socket;
    if(socket?.readyState===1){
      const packet=data.data instanceof Uint8Array?data:{data:encodeBinarySnapshot(data),epoch:data.world.soundEpoch,events:[...data.world.events],voices:[...data.world.voices]};
      if(member.sendingSocket===socket){
        // Keep one current update behind the active write, preserving bounded sound cues.
        const previous=member.pendingPacket;
        if(previous?.epoch===packet.epoch){packet.events=[...previous.events,...packet.events].slice(-64);packet.voices=[...previous.voices,...packet.voices].slice(-16);packet.merged=true;}
        member.pendingPacket=packet;return;
      }
      member.pendingPacket=null;this.sendPacket(member,socket,packet);return;
    }
    const stream=member.stream;if(!stream||stream.destroyed||stream.writableEnded)return;
    if(stream.writableLength>256*1024){stream.destroy();return;}
    stream.write(`data: ${JSON.stringify(data.data?decodeBinarySnapshot(data.data):data)}\n\n`);
  }
  sendPacket(member,socket,packet){
    member.sendingSocket=socket;
    let data=packet.data;
    if(packet.merged)data=mergeArenaPacket(data,packet.events,packet.voices);
    socket.send(data,error=>{
      if(member.sendingSocket!==socket)return;
      member.sendingSocket=null;
      if(error||member.socket!==socket||socket.readyState!==1){member.pendingPacket=null;return;}
      const next=member.pendingPacket;member.pendingPacket=null;
      if(next)this.sendPacket(member,socket,next);
    });
  }
  broadcast(room){this.syncRoom(room);for(const member of room.members.values())this.send(member,room.core.packetRecord(member.id));}
  step(dt){
    const now=Date.now();
    for(const room of this.rooms.values()){
      for(const member of [...room.members.values()])if(now-member.lastSeen>15000)this.remove(member);
      if(!this.rooms.has(room.code))continue;
      if(room.startRequest){
        const waiting=[...room.members.values()].some(member=>member.id!==room.host&&member.wantsToPlay);
        if(!waiting||!['ready','finished'].includes(room.core.status.phase))room.startRequest=null;
        if(room.startRequest&&this.startNow()>=room.startRequest.deadline){this.makeWorld(room);room.core.start();}
      }
      const inputs=[];
      for(const member of room.members.values()){
        const keys=now-member.inputAt<600?member.keys:new Set();member.moveCredit=Math.min(12,(member.moveCredit??0)+dt*60);
        const input={actor:member.id,keys,actions:member.actions.splice(0,8),actionClock:Boolean(member.predictedActions),sequence:member.sequence};
        if(member.commandMode){input.moves=member.moveQueue.splice(0,Math.min(8,Math.floor(member.moveCredit+1e-8)));member.moveCredit-=input.moves.length;}
        inputs.push(input);
      }
      room.core.step(dt,inputs);
      for(const input of inputs){const last=input.moves?.at(-1);if(last)room.members.get(input.actor).lastMove=last.sequence;}
      room.snapshotClock=(room.snapshotClock??0)+dt;if(room.snapshotClock>=1/30-1e-8){room.snapshotClock=0;this.broadcast(room);room.core.drainEvents();}
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
        case '/api/name':{
          if(typeof body.name!=='string'||!body.name.trim()||body.name.length>24)throw problem(400,'Enter a name (1–24 characters).');
          member.name=body.name.trim();this.syncRoom(room);
          this.broadcast(room);json(200,{ok:true,name:member.name});break;
        }
        case '/api/ready':{
          this.setReady(member,body.ready);this.broadcast(room);json(200,{ok:true});break;
        }
        case '/api/driver':{
          if(!['ready','finished'].includes(room.core.status.phase))throw problem(409,'Choose an animal before the next match.');
          if(!Number.isInteger(body.driver)||body.driver<0||body.driver>=drivers.length)throw problem(400,'Choose an animal.');
          member.driver=body.driver;this.syncRoom(room);
          this.broadcast(room);json(200,{ok:true});break;
        }
        case '/api/input':{
          this.controls(member,body);json(200,{ok:true});break;
        }
        case '/api/control':{
          if(room.host!==member.id)throw problem(403,'Only the room host can start or change the match.');
          switch(body.action){case 'start':if(!['ready','finished'].includes(room.core.status.phase))throw problem(409,'Match already running.');this.makeWorld(room);room.core.start();break;case 'refuse-start':this.refusePlayRequest(member,body.requestId);break;case 'reset':this.makeWorld(room);break;case 'arena':if(!Number.isInteger(body.arena)||body.arena<0||body.arena>1)throw problem(400,'Choose an arena.');room.arena=body.arena;this.makeWorld(room);break;case 'bots':if(!['ready','finished'].includes(room.core.status.phase))throw problem(409,'Change bots before the next match.');if(!Number.isInteger(body.bots)||body.bots<0||body.bots>6-room.members.size)throw problem(400,'Too many bots for this room.');room.botCount=body.bots;this.makeWorld(room);break;default:throw problem(400,'Unknown match control.');}
          this.broadcast(room);json(200,{ok:true});break;
        }
        case '/api/leave':this.remove(member);json(200,{ok:true});break;
        default:throw problem(404,'Not found.');
      }
    }catch(error){if(!res.headersSent)json(error.status??500,{error:error.status?error.message:'Server error.'});}
    return true;
  }
}
