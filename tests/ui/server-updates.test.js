import test from 'node:test';
import assert from 'node:assert/strict';
import {NetworkGame} from '../../networking/network.js';

function panel(){
  const classes=new Set(['hidden']);
  return {token:'player-session',checkUpdatesButton:{disabled:false},updateStatus:{textContent:''},updateServerButton:{classList:{add:name=>classes.add(name),toggle:(name,hidden)=>hidden?classes.add(name):classes.delete(name),contains:name=>classes.has(name)}}};
}
test('a newer server commit offers an update and displays its commit description as text',async t=>{
  const network=panel();
  t.mock.method(globalThis,'fetch',async()=>({ok:true,json:async()=>({available:true,latest:'new-commit',description:'abc123 Add arena'})}));
  await NetworkGame.prototype.checkServerUpdates.call(network);
  assert.equal(network.updateServerButton.classList.contains('hidden'),false);
  assert.equal(network.updateStatus.textContent,'Available: abc123 Add arena');
  assert.equal(network.checkUpdatesButton.disabled,false);
});
test('an up-to-date server offers no update',async t=>{
  const network=panel();
  t.mock.method(globalThis,'fetch',async()=>({ok:true,json:async()=>({available:false,latest:'installed-commit'})}));
  await NetworkGame.prototype.checkServerUpdates.call(network);
  assert.equal(network.updateServerButton.classList.contains('hidden'),true);
  assert.equal(network.updateStatus.textContent,'Server is up to date.');
});
test('a failed update check removes any stale offer and displays the server error',async t=>{
  const network=panel();network.serverUpdate={available:true};network.updateServerButton.classList.toggle('hidden',false);
  t.mock.method(globalThis,'fetch',async()=>({ok:false,json:async()=>({error:'The checkout has local changes.'})}));
  await NetworkGame.prototype.checkServerUpdates.call(network);
  assert.equal(network.updateServerButton.classList.contains('hidden'),true);
  assert.equal(network.serverUpdate,null);
  assert.equal(network.updateStatus.textContent,'The checkout has local changes.');
});
test('updating waits for a new server build and reloads even if main advanced beyond the checked commit',async t=>{
  const network=panel();network.serverUpdate={available:true,current:'old-build',latest:'checked-commit'};network.keys=new Set(['w']);network.request=async()=>({updating:true});
  let reloads=0,requests=0;
  const previous=globalThis.location;globalThis.location={reload(){reloads++;}};
  t.after(()=>{if(previous===undefined)delete globalThis.location;else globalThis.location=previous;});
  t.mock.method(globalThis,'setTimeout',callback=>{queueMicrotask(callback);return 0;});
  t.mock.method(globalThis,'fetch',async()=>({ok:true,json:async()=>({revision:++requests===1?'old-build':'even-newer-commit'})}));
  await NetworkGame.prototype.updateServer.call(network);
  assert.equal(reloads,1);assert.equal(network.keys.size,0);assert.equal(network.updateServerButton.disabled,true);
});
