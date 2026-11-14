import test from 'node:test';
import assert from 'node:assert/strict';
import {buildGraphicsPack,PACK_VERSION} from '../../scripts/build/graphics-port.mjs';

// Minimal reader for the layout documented in docs/native-graphics-port.md.
function read(pack){
  let at=8;const u32=()=>{const value=pack.readUInt32LE(at);at+=4;return value;};
  const palette=u32();at+=palette*3;
  const meshes=[];for(let i=u32();i>0;i--){at+=4;const triangles=u32();let tinted=0;for(let t=0;t<triangles;t++)tinted+=pack.readUInt16LE(at+t*20+18)===0;meshes.push({triangles,tinted});at+=triangles*20;}
  const clips=[];for(let i=u32();i>0;i--){at+=4;const once=u32()===1,frames=[];for(let f=u32();f>0;f--){const parts=[];for(let p=pack.readUInt16LE((at+=2)-2);p>0;p--){parts.push({mesh:pack.readUInt32LE(at),layer:pack.readUInt32LE(at+4)});at+=56;}const sprites=[0,1].map(()=>{const count=u32();at+=count*28;return count;});frames.push({parts,sprites});}clips.push({once,frames});}
  const names=new Map();for(let i=u32();i>0;i--){const size=pack.readUInt16LE(at);names.set(pack.toString('utf8',at+2,at+2+size),clips[pack.readUInt32LE(at+2+size)]);at+=size+6;}
  const text=()=>{const size=pack.readUInt16LE(at),value=pack.toString('utf8',at+2,at+2+size);at+=2+size;return value;};
  const arenas=[];for(let i=u32();i>0;i--){at+=7;arenas.push({name:text(),desc:text()});}
  const racers=[];for(let i=u32();i>0;i--){racers.push({name:text(),desc:text()});at+=3;}
  return {meshes,names,arenas,racers,end:at};
}

test('the browser renderer ports to a native graphics pack',()=>{
  const pack=buildGraphicsPack({only:[0]}),{meshes,names,arenas,racers,end}=read(pack);
  assert.equal(pack.toString('latin1',0,4),'WWGP');assert.equal(pack.readUInt32LE(4),PACK_VERSION);
  assert.equal(end,pack.length);assert.deepEqual(arenas.map(arena=>arena.name),['Scrapyard','Crossfire Court']);
  assert.equal(racers.length,15);assert.equal(racers[0].name,'Pip the Panda');
  for(const name of ['driver:0:idle','driver:0:boost','driver:0:celebrate','shot:vulcan:0','shot:hedgehog','shot:missile','wreck','pickup:boost','pickup:bicycle','health:1','health:6','overlay:0:shield','overlay:0:vulcan','overlay:xylophone','effect:ash:0','effect:explosion','effect:fireRing:blue','bomb:bomb','cloud:chaff','cloud:stink','particle:smoke','locust','timestop','trail:missile','trail:hedgehog','trail:vulcan:0','skid:0','skid:1'])assert.ok(names.has(name),name);
  // Pip's kart follows the player's color, while the panda keeps its own.
  const idle=names.get('driver:0:idle'),boost=names.get('driver:0:boost'),kart=meshes[idle.frames[0].parts[0].mesh];
  assert.ok(kart.tinted>0&&kart.tinted<kart.triangles);
  // Boost flames are an additive layer with glow sprites; idling shows neither.
  assert.ok(boost.frames[0].parts.some(part=>part.layer===1)&&boost.frames[0].sprites[0]>0);
  assert.ok(!idle.frames[0].parts.some(part=>part.layer===1)&&idle.frames[0].sprites[0]===0);
  assert.equal(idle.once,false);assert.equal(names.get('effect:explosion').once,true);
  // Overlays hold only what a state adds: each health pip is one box, and a
  // shield ring never repeats the kart beneath it.
  assert.equal(meshes[names.get('health:3').frames[0].parts[0].mesh].triangles,36);
  assert.equal(meshes[names.get('skid:0').frames[0].parts[0].mesh].triangles,2);
  assert.ok(names.get('overlay:0:shield').frames.every(frame=>frame.parts.length===0&&frame.sprites[0]>0));
  assert.deepEqual(buildGraphicsPack({only:[0]}),pack);
});
