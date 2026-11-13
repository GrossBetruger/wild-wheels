import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createTunnelControl } from '../../server/tunnel-control.js';

test('only the local game page can start one internet tunnel',async t=>{
  let launches=0;
  const launch=()=>{launches++;const child=new EventEmitter();child.kill=()=>{};return child;};
  const control=createTunnelControl(5173,{launch});
  await new Promise(resolve=>control.server.listen(0,'127.0.0.1',resolve));
  t.after(()=>control.close());
  const url=`http://127.0.0.1:${control.server.address().port}/start`;
  const request=origin=>fetch(url,{method:'POST',headers:{Origin:origin},signal:AbortSignal.timeout(2000)});

  assert.equal(control.server.address().address,'127.0.0.1');
  assert.equal((await request('https://friend.example')).status,403);
  assert.equal(launches,0);
  assert.equal((await request('http://localhost:5173')).status,202);
  assert.equal((await request('http://localhost:5173')).status,202);
  assert.equal(launches,1);
});
