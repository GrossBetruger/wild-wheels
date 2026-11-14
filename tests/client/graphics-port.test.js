import test from 'node:test';
import assert from 'node:assert/strict';
import {buildGraphicsPack,PACK_VERSION} from '../../scripts/build/graphics-port.mjs';

// Minimal reader for the layout documented in docs/native-graphics-port.md.
function read(pack){
  let at=8;const u32=()=>{const value=pack.readUInt32LE(at);at+=4;return value;};
  const palette=u32();at+=palette*3;
  const meshes=[];for(let i=u32();i>0;i--){at+=4;const triangles=u32();let tinted=0;for(let t=0;t<triangles;t++)tinted+=pack.readUInt16LE(at+t*20+18)===0;meshes.push({triangles,tinted});at+=triangles*20;}
  const clips=[];for(let i=u32();i>0;i--){at+=4;const frames=[];for(let f=u32();f>0;f--){const parts=[];for(let p=pack.readUInt16LE((at+=2)-2);p>0;p--){parts.push({mesh:pack.readUInt32LE(at),layer:pack.readUInt32LE(at+4)});at+=32;}frames.push(parts);}clips.push(frames);}
  const names=new Map();for(let i=u32();i>0;i--){const size=pack.readUInt16LE(at);names.set(pack.toString('utf8',at+2,at+2+size),clips[pack.readUInt32LE(at+2+size)]);at+=size+6;}
  const arenas=u32();at+=arenas*7;
  return {meshes,names,arenas,end:at};
}

test('the browser renderer ports to a native graphics pack',()=>{
  const pack=buildGraphicsPack({only:[0]}),{meshes,names,arenas,end}=read(pack);
  assert.equal(pack.toString('latin1',0,4),'WWGP');assert.equal(pack.readUInt32LE(4),PACK_VERSION);
  assert.equal(end,pack.length);assert.equal(arenas,2);
  for(const name of ['driver:0:idle','driver:0:boost','shot:vulcan:0','shot:hedgehog','shot:missile','wreck','pickup:boost','pickup:tehilim','health:1','health:6'])assert.ok(names.has(name),name);
  // Pip's kart follows the player's color, while the panda keeps its own.
  const kart=meshes[names.get('driver:0:idle')[0][0].mesh];
  assert.ok(kart.tinted>0&&kart.tinted<kart.triangles);
  // Boost flames are ported as an additive layer.
  assert.ok(names.get('driver:0:boost')[0].some(part=>part.layer===1));
  assert.ok(!names.get('driver:0:idle')[0].some(part=>part.layer===1));
  // Each health pip is a box, isolated from the kart it floats above.
  assert.equal(meshes[names.get('health:3')[0][0].mesh].triangles,36);
  assert.deepEqual(buildGraphicsPack({only:[0]}),pack);
});
