import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Read the exported animation samples and vertex weights that Bevy actually consumes.
function model(path) {
  const bytes = readFileSync(new URL('../assets/'+path, import.meta.url));
  const end = 20 + bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.subarray(20, end));
  const binary = bytes.subarray(end + 8);
  function samples(index) {
    const a = gltf.accessors[index], view = gltf.bufferViews[a.bufferView];
    const width = {VEC3:3,VEC4:4}[a.type];
    const size = {5121:1,5123:2,5126:4}[a.componentType];
    const read = {5121:'readUInt8',5123:'readUInt16LE',5126:'readFloatLE'}[a.componentType];
    const start = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
    return Array.from({length:a.count}, (_,i)=>Array.from({length:width}, (_,j)=>
      binary[read](start+i*(view.byteStride ?? width*size)+j*size)));
  }
  const weighted = new Set();
  for (const node of gltf.nodes.filter(n=>n.skin!==undefined)) {
    for (const primitive of gltf.meshes[node.mesh].primitives) {
      const joints = samples(primitive.attributes.JOINTS_0);
      samples(primitive.attributes.WEIGHTS_0).forEach((weights,i)=>weights.forEach((w,j)=>{
        if (w>0) weighted.add(gltf.skins[node.skin].joints[joints[i][j]]);
      }));
    }
  }
  return (clip, joint)=>{
    const anim = gltf.animations.find(a=>a.name===clip);
    const channel = anim?.channels.find(({target})=>target.path==='rotation' &&
      gltf.nodes[target.node].name===joint && weighted.has(target.node));
    assert.ok(channel, clip+' must animate vertices attached to '+joint);
    const [first,...frames] = samples(anim.samplers[channel.sampler].output);
    // Quaternions q and -q describe the same orientation.
    assert.ok(frames.some(q=>Math.abs(q.reduce((sum,v,i)=>sum+v*first[i],0))<.99999),
      clip+' must change the orientation of '+joint);
  };
}

for(const [rider,path,joints] of [
  ['Tammy','models/tammy.glb',['feeler_l','thigh_r','shin_l']],
  ['Houston','houston_pilot.glb',['head','aerial','wrist_r']],
  ['Catheterpillar','models/catheterpillar.glb',['wing_l','wing_r','arm_r']],
  ['Fourmidable','models/fourmidable.glb',['feeler_r','leg_l','middle_r']],
  ['Tai-Coon','taicoon.glb',['ear_l','tail_tip','arm_r']],
]){
  test(rider+' moves skinned body parts while cruising, boosting and using a special',()=>{
    const moves=model(path);
    ['cruise','boost','special'].forEach((clip,i)=>moves(clip,joints[i]));
  });
}
