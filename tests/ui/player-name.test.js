import test from 'node:test';
import assert from 'node:assert/strict';
import {NetworkGame,validPlayerName} from '../../networking/network.js';

test('playing requires a nonblank name of at most 24 characters',()=>{
  for(const value of ['', '   ',null,undefined,'x'.repeat(25)])assert.equal(validPlayerName(value),false);
  for(const value of ['Sarah','  Sarah  ','שרה','x'.repeat(24)])assert.equal(validPlayerName(value),true);
});
test('connecting without a name asks for one without creating an anonymous player',async()=>{
  let focused=false,requested=false;
  const network={hasName:false,status:{},hostButton:{},connectionStatus(){},focusName(){focused=true;},request(){requested=true;}};
  await NetworkGame.prototype.connect.call(network,'/api/join');
  assert.equal(focused,true);assert.equal(requested,false);assert.equal(network.hostButton.disabled,true);
});
test('an empty name blocks starting even when the name was not marked dirty',async()=>{
  let focused=false;
  const network={hasName:false,active:true,nameDirty:false,nameFeedback:{},focusName(){focused=true;}};
  assert.equal(await NetworkGame.prototype.saveName.call(network),false);
  assert.equal(focused,true);assert.equal(network.nameFeedback.textContent,'Enter your name before playing.');
});
