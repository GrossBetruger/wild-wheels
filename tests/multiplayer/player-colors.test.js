import test from 'node:test';
import assert from 'node:assert/strict';
import {createGameServer} from '../../server.js';
import {playerColors} from '../../gameplay/player-colors.js';
import {ArenaCore} from '../../gameplay/arena-core.js';

const palette = new Set(playerColors.map(([, color]) => color));
async function setup(t) {
  const app = createGameServer(); clearInterval(app.multiplayer.timer);
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => { app.multiplayer.close(); app.server.closeAllConnections(); app.server.close(); });
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  const post = async (path, body, token) => {
    const response = await fetch(origin + path, {
      method: 'POST', headers: {'Content-Type': 'application/json', ...(token ? {Authorization: `Bearer ${token}`} : {})},
      body: JSON.stringify(body), signal: AbortSignal.timeout(4000)
    });
    return {status: response.status, ...await response.json()};
  };
  return {...app, post};
}
function distinctColors(world) {
  const actors = [world, ...world.bots].filter(actor => !actor.inactive);
  for (const actor of actors) assert.ok(palette.has(actor.color), `Not a palette color: ${actor.color}`);
  assert.equal(new Set(actors.map(actor => actor.color)).size, actors.length);
}

test('players who never choose get distinct palette colors, including identical names and driver 6', async t => {
  const {post} = await setup(t);
  const host = await post('/api/rooms', {name: 'Same name', driver: 6, arena: 0, bots: 5});
  assert.equal(host.status, 200); distinctColors(host.world);
  let latest = host;
  for (let n = 0; n < 5; n++) {
    latest = await post('/api/join', {name: 'Same name', driver: 6, code: host.code});
    assert.equal(latest.status, 200); distinctColors(latest.world);
  }
  assert.equal(new Set(latest.players.map(player => player.color)).size, 6);
  const ownColor = host.players.find(player => player.id === host.you).color;
  assert.equal(host.world.color, ownColor);
  const chat = await post('/api/chat', {text: 'Automatically colored'}, host.token);
  assert.equal(chat.messages[0].color, ownColor);
  assert.equal(chat.players.find(player => player.id === host.you).color, ownColor);
});

test('humans can take bot colors and later joins cannot reuse a human color', async t => {
  const {post, multiplayer} = await setup(t);
  const host = await post('/api/rooms', {name: 'Host', driver: 0, arena: 0, bots: 5});
  const botColor = host.world.bots[0].color;
  assert.equal((await post('/api/color', {color: botColor}, host.token)).status, 200);
  const member = multiplayer.members.get(host.token);
  const state = multiplayer.snapshot(member.room, member);
  assert.equal(state.world.color, botColor); distinctColors(state.world);
  const guest = await post('/api/join', {name: 'Guest', driver: null, code: host.code});
  assert.equal(guest.status, 200); assert.notEqual(guest.world.color, botColor); distinctColors(guest.world);
  assert.equal((await post('/api/color', {color: botColor}, guest.token)).status, 409);
  const after = multiplayer.snapshot(member.room, member);
  assert.equal(after.world.color, botColor); distinctColors(after.world);
});

test('automatic colors survive resume, character changes, and rematches; released colors can be reused', async t => {
  const {post, multiplayer} = await setup(t);
  let host = await post('/api/rooms', {name: 'Host', driver: 0, arena: 0, bots: 0});
  const originalColor = host.world.color;
  const guest = await post('/api/join', {name: 'Guest', driver: null, code: host.code});
  assert.equal((await post('/api/driver', {driver: 6}, host.token)).status, 200);
  host = await post('/api/session', {}, host.token);
  assert.equal(host.world.color, originalColor);
  assert.equal((await post('/api/control', {action: 'start'}, host.token)).status, 200);
  const member = multiplayer.members.get(host.token);
  assert.equal(multiplayer.snapshot(member.room, member).world.color, originalColor);
  assert.equal((await post('/api/kick', {id: guest.you}, host.token)).status, 200);
  const replacement = await post('/api/join', {name: 'Replacement', driver: null, code: host.code});
  assert.equal(replacement.world.color, guest.world.color);
  assert.notEqual(replacement.world.color, originalColor);
});

test('eight-player Wasm rooms give humans priority over bots and keep all colors in the shared palette', () => {
  const config = {code: '00', host: null, dedicated: true, maxPlayers: 8, arena: 0, bots: 7, epoch: 1,
    players: [{id: 0, name: 'Player', driver: 6, role: 'driver', color: playerColors[1][1]}]};
  const core = ArenaCore.room(config);
  let state = core.snapshot(); distinctColors(state);
  assert.equal(state.color, playerColors[1][1]);
  const previousBotColor = state.bots[0].color;
  config.players.push({id: 1, name: 'New player', driver: 6, role: 'driver', color: previousBotColor});
  config.bots = 6; core.configure(config);
  state = core.snapshot(); distinctColors(state);
  assert.equal(state.bots.find(player => player.id === 1).color, previousBotColor);
});

test('pre-join preferences are applied, occupied ones fall back without overwriting the preference', async t => {
  const {post} = await setup(t);
  const preferred = playerColors[12][1];
  const host = await post('/api/rooms', {name:'Host',driver:0,arena:0,bots:5,color:preferred});
  assert.equal(host.world.color,preferred);assert.equal(host.preferredColor,preferred);
  let guest = await post('/api/join', {name:'Guest',driver:null,code:host.code,color:preferred});
  assert.equal(guest.status,200);assert.notEqual(guest.world.color,preferred);
  assert.equal(guest.preferredColor,preferred);distinctColors(guest.world);
  const fallback = guest.world.color;
  guest = await post('/api/session', {}, guest.token);
  assert.equal(guest.world.color,fallback);assert.equal(guest.preferredColor,preferred);
  assert.equal((await post('/api/color', {color:preferred,id:host.you}, guest.token)).status,409);
  const free = playerColors.find(([,color])=>color!==preferred&&color!==fallback)[1];
  const changed = await post('/api/color', {color:free,id:host.you}, guest.token);
  assert.equal(changed.status,200);assert.equal(changed.preferredColor,free);
  guest = await post('/api/session', {}, guest.token);
  assert.equal(guest.world.color,free);assert.equal(guest.preferredColor,free);
  assert.equal((await post('/api/session', {}, host.token)).world.color,preferred);
});

test('invalid preference payloads are rejected before creating or changing a player', async t => {
  const {post} = await setup(t);
  for(const color of [42,{},'<script>alert(1)</script>','#ffffff']){
    assert.equal((await post('/api/rooms', {name:'Host',driver:0,arena:0,color})).status,400);
  }
  let host = await post('/api/rooms', {name:'Host',driver:0,arena:0});
  const original=host.world.color;
  assert.equal((await post('/api/color', {color:'url(https://attacker.invalid)'}, host.token)).status,400);
  assert.equal((await post('/api/session', {color:'not-a-color'}, host.token)).status,400);
  host = await post('/api/session', {}, host.token);assert.equal(host.world.color,original);
});

test('simultaneous explicit color claims have one winner and preserve the losing preference', async t => {
  const {post,multiplayer} = await setup(t);
  const host=await post('/api/rooms',{name:'Host',driver:0,arena:0});
  const guest=await post('/api/join',{name:'Guest',driver:1,code:host.code});
  const color=playerColors[12][1];
  const results=await Promise.all([
    post('/api/color',{color},host.token),post('/api/color',{color},guest.token)
  ]);
  assert.deepEqual(results.map(result=>result.status).sort(),[200,409]);
  const loser=results[0].status===409?host:guest;
  const member=multiplayer.members.get(loser.token);
  assert.equal(member.preferredColor,loser.preferredColor);
  assert.equal(member.color,loser.world.color);
  distinctColors(multiplayer.snapshot(member.room,member).world);
});

test('match colors lock through countdown and racing, including session and rejoin preferences, then unlock at finish', async t => {
  const {post,multiplayer} = await setup(t);
  let host=await post('/api/rooms',{name:'Host',driver:0,arena:0,bots:0,color:playerColors[0][1]});
  const original=host.world.color, requested=playerColors[1][1];
  assert.equal((await post('/api/control',{action:'start'},host.token)).status,200);
  const room=multiplayer.members.get(host.token).room;
  for(const phase of ['countdown','racing']) {
    assert.equal(room.core.status.phase,phase);
    assert.equal((await post('/api/color',{color:requested},host.token)).status,409);
    host=await post('/api/session',{color:requested},host.token);
    assert.equal(host.status,200);assert.equal(host.world.color,original);assert.equal(host.preferredColor,original);
    host=await post('/api/join',{name:'Host',driver:0,code:host.code,color:requested},host.token);
    assert.equal(host.status,200);assert.equal(host.world.color,original);assert.equal(host.preferredColor,original);
    if(phase==='countdown')for(let n=0;n<100 && room.core.status.phase==='countdown';n++)room.core.step(.05);
  }
  for(let n=0;n<4000 && room.core.status.phase!=='finished';n++)room.core.step(.05);
  assert.equal(room.core.status.phase,'finished');
  assert.equal((await post('/api/color',{color:requested},host.token)).status,200);
  assert.equal(multiplayer.members.get(host.token).color,requested);
});

test('chat colors stay fixed and unique across vehicle changes, AFK, refresh and new matches', async t => {
  const {post,multiplayer}=await setup(t);
  const fixed=playerColors[12][1], vehicle=playerColors[6][1];
  let host=await post('/api/rooms',{name:'Host',driver:0,arena:0,bots:0,color:fixed,chatColor:'#000000'});
  assert.equal(host.chatColor,fixed);
  const first=await post('/api/chat',{text:'Before changing vehicle'},host.token);
  assert.equal(first.messages[0].color,fixed);
  assert.equal((await post('/api/color',{color:vehicle,chatColor:vehicle},host.token)).status,200);
  const guest=await post('/api/join',{name:'Guest',driver:1,code:host.code,color:fixed,chatColor:fixed});
  assert.equal(guest.world.color,fixed);assert.notEqual(guest.chatColor,fixed);
  let current=await post('/api/session',{chatColor:vehicle},host.token);host={...host,...current};
  assert.equal(host.world.color,vehicle);assert.equal(host.chatColor,fixed);
  host={...host,...await post('/api/afk',{afk:true},host.token)};
  assert.equal(host.chatColor,fixed);
  host={...host,...await post('/api/afk',{afk:false},host.token)};
  assert.equal((await post('/api/control',{action:'start'},host.token)).status,200);
  const room=multiplayer.members.get(host.token).room;
  for(let n=0;n<4000 && room.core.status.phase!=='finished';n++)room.core.step(.05);
  assert.equal(room.core.status.phase,'finished');
  assert.equal((await post('/api/color',{color:playerColors[4][1]},host.token)).status,200);
  const second=await post('/api/chat',{text:'After the match',chatColor:vehicle,color:vehicle},host.token);
  assert.equal(second.messages.at(-1).color,fixed);
  assert.equal(second.players.find(player=>player.id===host.you).color,fixed);
  assert.equal(new Set(second.players.map(player=>player.color)).size,second.players.length);
  assert.equal(multiplayer.snapshot(room,multiplayer.members.get(host.token)).world.color,playerColors[4][1]);
  const answer=await post('/api/chat',{text:'Reply',replyTo:first.messages[0].id},guest.token);
  assert.equal(answer.messages.at(-1).reply.color,fixed);
});
