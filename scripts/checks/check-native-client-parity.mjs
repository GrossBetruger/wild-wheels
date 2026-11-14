import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {ArenaCore,ArenaClient} from '../../gameplay/arena-core.js';

const arg=(name,fallback)=>{const at=process.argv.indexOf(name);return at<0?fallback:process.argv[at+1];};
const binary=resolve(arg('--binary','rust-core/target/debug/examples/replay_native_client'));
const output=arg('--output',join(tmpdir(),'wild-wheels-native-client-parity.json'));
const scenarios=[{name:'local',delay:0,jitter:0},{name:'160ms',delay:.08,jitter:0},{name:'160ms-jitter',delay:.08,jitter:.03}];
const results=[];
const actions=new Map([[20,'fire'],[40,'cycle'],[41,'fire'],[55,'chaff'],[65,'turbo'],[80,'somersault'],[120,'fire'],[180,'fire']]);
for(const profile of scenarios){
  const server=ArenaCore.room({code:'00',maxPlayers:8,arena:0,bots:0,dedicated:true,host:null,epoch:1,seed:1,
    players:Array.from({length:8},(_,id)=>({id,name:`Racer ${id}`,driver:0,role:'driver'}))});
  server.start();for(let i=0;i<241;i++)server.step(1/60);
  const browser=new ArenaClient(),ops=[],expected=[],packets=[];let lastArrival=0;
  const accept=(packet,now)=>{browser.accept(packet,now);ops.push({op:'accept',packet:[...packet],now});};
  accept(server.packet(1),0);
  let acceptedShots=0;
  for(let frame=1;frame<=600;frame++){
    const now=frame/60;
    while(packets.length&&packets[0].at<=now){const message=packets.shift();accept(message.packet,now);}
    const keys=frame<90?1:frame<150?5:frame<210?17:0;
    const steer=frame>=150&&frame<210?.65:null;
    browser.frame(1/60,keys,now,steer??2);ops.push({op:'frame',dt:1/60,keys,steer,now});
    const action=actions.get(frame);
    if(action){const accepted=browser.action(action,undefined,now);ops.push({op:'action',kind:action,now});expected.push({accepted});if(action==='fire'&&accepted)acceptedShots++;}
    let inputs=[];
    if(frame%2===0){const message=browser.outbound(keys);ops.push({op:'outbound',keys});expected.push(message);inputs=[{...message,actor:1}];}
    server.step(1/60,inputs);
    if(frame%2===0){const packet=server.packet(1);lastArrival=Math.max(lastArrival,now+profile.delay+Math.sin(frame*1.7)*profile.jitter);packets.push({at:lastArrival,packet});server.drainEvents();}
    const state=browser.snapshot();
    browser.peek();const status=browser.state();
    expected.push({you:1,phase:state.phase,wx:state.wx,wz:state.wz,heading:state.heading,cameraHeading:state.cameraHeading,
      health:state.health,deaths:state.deaths,ammo:state.ammo,missiles:state.missiles,item:state.item,boost:state.boost,somersault:state.somersault,
      movementAck:status.movementSequence,actionAck:status.actionSequence,
      projectiles:state.projectiles.map(p=>({id:p.id,wx:p.wx,wz:p.wz,height:p.height,owner:p.owner,kind:p.kind})),events:state.events});
    browser.present();ops.push({op:'snapshot'});
  }
  const replay=spawnSync(binary,[],{input:JSON.stringify(ops),encoding:'utf8',maxBuffer:32*1024*1024,timeout:30000});
  assert.equal(replay.status,0,replay.stderr);const native=JSON.parse(replay.stdout);
  assert.equal(native.rows.length,expected.length);
  let maxError=0;
  function compare(actual,wanted,path){
    if(typeof wanted==='number'){assert.equal(typeof actual,'number',path);const error=Math.abs(actual-wanted);maxError=Math.max(maxError,error);assert.ok(error<=1e-6,`${profile.name} ${path}: ${actual} != ${wanted}`);return;}
    if(wanted===null||typeof wanted!=='object'){assert.equal(actual,wanted,`${profile.name} ${path}`);return;}
    assert.deepEqual(Object.keys(actual).sort(),Object.keys(wanted).sort(),`${profile.name} ${path} fields`);
    for(const key of Object.keys(wanted))compare(actual[key],wanted[key],`${path}.${key}`);
  }
  native.rows.forEach((row,i)=>compare(row,expected[i],`row[${i}]`));
  assert.ok(acceptedShots>=2,'The trace must exercise immediate local shots');
  results.push({profile:profile.name,pass:true,frames:600,acceptedShots,maxError});
}
const report={pass:true,criteria:'Owned native and browser/Wasm clients: movement, analog steering, drift, boost, flip, weapons, audio cues and outgoing commands agree to 1e-6 under local and delayed/jittered snapshots.',results};
await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
