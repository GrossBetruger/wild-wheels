import test from 'node:test';
import assert from 'node:assert/strict';
import {createBattle,tickBattle} from './combat.js';
import {ArenaCore,ArenaClient} from './arena-core.js';
import {decodeBinarySnapshot} from './binary-wire.js';
import {matchResults,battleTieNotice} from './results.js';

for(const engine of ['solo reference','Rust multiplayer']){
  test(`${engine}: the actual host wins a top-points tie and scores remain unchanged`,()=>{
    for(const host of [0,1]){
      const seed=createBattle();Object.assign(seed,{phase:'racing',multiplayer:true,host,human:true,elapsed:179.99,kills:7,deaths:host===0?9:1,supplies:[]});
      Object.assign(seed.bots[0],{human:true,kills:7,deaths:host===1?9:1});for(const bot of seed.bots.slice(1))Object.assign(bot,{inactive:true,destroyed:1e9});
      const core=engine==='solo reference'?null:new ArenaCore(seed);if(core)core.step(1/60);if(!core)tickBattle(seed,new Set(),1/60);
      const world=core?core.snapshot():seed;
      assert.equal(world.winner,host===0?'player':0);assert.equal(world.finishTime,180);assert.equal(world.finishRank,host===0?1:2);
      assert.deepEqual([world.kills,world.bots[0].kills],[7,7]);assert.deepEqual([world.deaths,world.bots[0].deaths],host===0?[9,1]:[1,9]);
      assert.equal(battleTieNotice(world),'TIE ON POINTS · HOST WINS');assert.equal(matchResults(world)[0].you,host===0);
      if(core)for(const viewer of [0,1]){
        const packet=decodeBinarySnapshot(core.packet(viewer));assert.equal(packet.world.host,host);assert.equal(packet.world.finishRank,viewer===host?1:2);
        assert.equal(matchResults(packet.world)[0].you,viewer===host);assert.equal(battleTieNotice(packet.world),'TIE ON POINTS · HOST WINS');
        assert.ok(core.packetRecord(viewer).events.includes(viewer===host?'victory':'finish'));
        const client=new ArenaClient();client.accept(core.packet(viewer),0);client.frame(0,[],0);assert.equal(battleTieNotice(client.present()),'TIE ON POINTS · HOST WINS');
      }
    }
  });
}

test('a host strictly ahead wins normally without a tie announcement',()=>{
  const seed=createBattle();Object.assign(seed,{phase:'racing',multiplayer:true,host:0,human:true,elapsed:179.99,kills:8,deaths:9,supplies:[]});
  Object.assign(seed.bots[0],{human:true,kills:7,deaths:0});for(const bot of seed.bots.slice(1))Object.assign(bot,{inactive:true,destroyed:1e9});
  const core=new ArenaCore(seed);core.step(1/60);assert.equal(core.snapshot().winner,'player');assert.equal(battleTieNotice(core.snapshot()),'');
});
