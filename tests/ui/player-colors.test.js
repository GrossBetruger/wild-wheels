import test from 'node:test';
import assert from 'node:assert/strict';
import {playerColors, savedPlayerColor, applyPlayerColors} from '../../gameplay/player-colors.js';
import {createRace} from '../../gameplay/engine.js';
import {createBattle} from '../../gameplay/combat.js';
import {NetworkGame} from '../../networking/network.js';

function browser(t) {
  for (const [name,value] of Object.entries({document:{cookie:''},location:{protocol:'https:'}})) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis,name);
    Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});
    t.after(()=>{if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];});
  }
}
function network(fields={}) {
  return Object.assign(Object.create(NetworkGame.prototype), {
    state:{world:{phase:'ready'}}, token:null, preferredColor:null, colorDirty:false, colorPending:false, colorError:'', ...fields
  });
}

test('saved color cookies accept only palette values and tolerate malformed encoding',()=>{
  const color=playerColors[12][1];
  assert.equal(savedPlayerColor(`other=x; wild-wheels-color=${encodeURIComponent(color)}; another=1`),color);
  for(const value of ['', '%invalid', 'red', '%23ffffff', 'url(https://attacker.invalid)'])assert.equal(savedPlayerColor(`wild-wheels-color=${value}`),null);
});

for(const mode of ['Grand Prix','solo arena'])test(`${mode}: saved colors apply to new races and bots yield human preferences`,()=>{
  const palette=new Set(playerColors.map(([,color])=>color));
  const make=()=>mode==='Grand Prix'?createRace(6):createBattle(6);
  const preferred=playerColors.at(-1)[1];
  const first=applyPlayerColors(make(),preferred);
  assert.equal(first.color,preferred);
  const takenByBot=first.bots[0].color;
  applyPlayerColors(first,takenByBot);
  assert.equal(first.color,takenByBot);
  const colors=[first,...first.bots].map(actor=>actor.color);
  assert.equal(new Set(colors).size,colors.length);
  assert.ok(colors.every(color=>palette.has(color)));
  assert.equal(applyPlayerColors(make(),takenByBot).color,takenByBot);
});

test('pre-join selection saves a browser preference without contacting a server',async t=>{
  browser(t);let requests=0;
  const client=network({request:async()=>{requests++;}});
  const preferred=playerColors[12][1];
  assert.equal(await client.chooseColor(preferred),true);
  assert.equal(requests,0);assert.equal(client.colorDirty,true);
  assert.equal(savedPlayerColor(document.cookie),preferred);
  assert.match(document.cookie,/SameSite=Lax/);assert.match(document.cookie,/; Secure/);
});

test('joining sends the saved pre-join preference',async t=>{
  browser(t);let sent;
  const client=network({preferredColor:playerColors[12][1],name:{value:'Alice'},role:'driver',invitation:'00',invite:'secret',
    botCount:{value:'0'},driver:()=>0,arena:()=>0,unlock:async()=>{},connectionStatus(){},
    hostButton:{},status:{},request:async(path,body)=>{sent={path,body};return {};},adopt(){}});
  await client.connect('/api/join');
  assert.equal(sent.path,'/api/join');assert.equal(sent.body.color,client.preferredColor);
});

test('a rejected occupied-color request preserves the previous saved preference',async t=>{
  browser(t);const original=playerColors[0][1];
  const client=network({token:'session',preferredColor:original,request:async()=>{throw Object.assign(new Error('Taken'),{status:409});}});
  client.rememberColor();const cookie=document.cookie;
  assert.equal(await client.chooseColor(playerColors[1][1]),false);
  assert.equal(client.preferredColor,original);assert.equal(document.cookie,cookie);
  assert.equal(client.colorError,'Taken');assert.equal(client.colorPending,false);
});

test('old-session color responses cannot overwrite another session preference',async t=>{
  browser(t);let finish;
  const client=network({token:'old',preferredColor:playerColors[0][1],request:()=>new Promise(resolve=>finish=resolve)});
  const pending=client.chooseColor(playerColors[1][1]);
  client.token='new';client.preferredColor=playerColors[2][1];client.colorPending=false;
  finish({color:playerColors[1][1]});assert.equal(await pending,false);
  assert.equal(client.preferredColor,playerColors[2][1]);assert.equal(document.cookie,'');
});

for(const phase of ['countdown','racing','paused'])test(`${phase}: online color changes preserve the saved choice without sending a request`,async t=>{
  browser(t);let requests=0;
  const original=playerColors[0][1];
  const client=network({token:'session',state:{world:{phase}},preferredColor:original,request:async()=>{requests++;}});
  client.rememberColor();const cookie=document.cookie;
  assert.equal(await client.chooseColor(playerColors[1][1]),false);
  assert.equal(requests,0);assert.equal(client.preferredColor,original);assert.equal(document.cookie,cookie);
  assert.equal(client.colorError,'Choose your color between matches.');
});

for(const phase of ['ready','finished'])test(`${phase}: online color changes are available between matches`,async t=>{
  browser(t);const color=playerColors[1][1];
  const client=network({token:'session',state:{world:{phase}},request:async()=>({color})});
  assert.equal(await client.chooseColor(color),true);assert.equal(savedPlayerColor(document.cookie),color);
});
