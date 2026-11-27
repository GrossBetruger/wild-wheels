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
    const width = {SCALAR:1,VEC3:3,VEC4:4}[a.type];
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
    const sampler = anim.samplers[channel.sampler];
    const [first,...frames] = samples(sampler.output);
    // Quaternions q and -q describe the same orientation.
    assert.ok(frames.some(q=>Math.abs(q.reduce((sum,v,i)=>sum+v*first[i],0))<.99999),
      clip+' must change the orientation of '+joint);
    const values = path=>{
      const c = anim.channels.find(({target})=>target.node===channel.target.node && target.path===path);
      return samples(anim.samplers[c.sampler].output);
    };
    return {rotations:[first,...frames], times:samples(sampler.input).flat(), values};
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


test('both butterfly wings complete three full strokes per second while cruising or healing and four during boost',()=>{
  const moves=model('models/catheterpillar.glb');
  for (const [clip,expectedHz] of [['cruise',3],['boost',4],['special',3]]) {
    for (const wing of ['wing_l','wing_r']) {
      const {rotations,times}=moves(clip,wing);
      // Signed angle around the hinge in the exported joint's local coordinates.
      const angles=rotations.map(([,,z,w])=>2*Math.atan2(z,w));
      const strokes=angles.filter((v,i)=>v>.85 && v>angles[i-1] && v>=angles[i+1]).length;
      assert.ok(Math.min(...angles)<-.85,clip+' must sweep '+wing+' back through its resting pose');
      assert.equal(strokes/(times.at(-1)-times[0]),expectedHz,clip+' '+wing+' wingbeats per second');
    }
  }
});


test('Tai-Coon catches and reseats her hat and sheds one petal on boost',()=>{
  const moves=model('taicoon.glb');
  const hat=moves('boost','hat').values('translation');
  const petal=moves('boost','petal');
  const distance=(a,b)=>Math.hypot(...a.map((x,i)=>x-b[i]));
  assert.ok(hat.some(p=>distance(p,hat[0])>1), 'brim clears her head');
  assert.ok(distance(hat.at(-1),hat[0])<.01, 'hat lands back on her head');
  const scale=petal.values('scale').map(s=>s[0]);
  assert.ok(scale[0]<.01 && Math.max(...scale)>.9 && scale.at(-1)<.01);
  const flight=petal.values('translation');
  assert.ok(distance(flight[0],flight.at(-1))>10, 'petal travels past the chase camera');
  moves('boost','tail_tip');
});

test('Tai-Coon breathes and counterbalances in both turns, then bows before her victory wiggle',()=>{
  const moves=model('taicoon.glb');
  for (const clip of ['cruise','turn_l','turn_r']) {
    for (const joint of ['spine','head','feather','tail_tip']) moves(clip,joint);
  }
  const head=moves('bow','head').rotations;
  const paw=moves('bow','arm_r').rotations;
  const tail=moves('bow','tail_tip').values('translation');
  const angle=(a,b)=>2*Math.acos(Math.min(1,Math.abs(a.reduce((n,x,i)=>n+x*b[i],0))));
  assert.ok(angle(head[9],head[0])>1.3, 'looks back first');
  assert.ok(angle(paw[23],paw[0])>.4, 'paws follow the seated bow');
  assert.ok(angle(paw[35],paw[0])<.01, 'paws return to the wheel before the wiggle ends');
  const excursion=tail.slice(33,46).map(p=>Math.hypot(...p.map((v,i)=>v-tail[0][i])));
  assert.ok(Math.max(...excursion)>.05, 'tail keeps moving after the bow');
});

test('the nurse and accountant wave their right hands while the nurse keeps flying',()=>{
  for(const racer of ['catheterpillar','fourmidable']){
    const moves=model('models/'+racer+'.glb');
    const wave=moves('wave','arm_r').rotations;
    const rest=moves('cruise','arm_r').rotations[0];
    const dot=Math.abs(wave[0].reduce((sum,x,i)=>sum+x*rest[i],0));
    assert.ok(2*Math.acos(Math.min(1,dot))>2,'right hand lifts clear of the wheel');
    if(racer==='catheterpillar')for(const wing of ['wing_l','wing_r'])moves('wave',wing);
  }
});

test('Tai-Coon throws three blossoms above the pickup and they fall away during her KO bow',()=>{
  const moves=model('taicoon.glb');
  const finalX=[];
  for(const name of ['blossom_left','blossom_high','blossom_right']){
    const bloom=moves('bow',name);
    const flight=bloom.values('translation'), scale=bloom.values('scale');
    // In the seat joint's local frame +Z is up.
    assert.ok(flight[30][2]>flight[11][2]+2,'flower rises above its release point');
    assert.ok(flight.at(-1)[2]<flight[30][2]-1,'flower falls after the apex');
    assert.ok(scale[11][0]>.95 && scale.at(-1)[0]<.01,'visible at release and gone at the end');
    finalX.push(flight.at(-1)[0]);
  }
  assert.ok(finalX[0]+2<finalX[1] && finalX[1]+2<finalX[2],'blossoms fan out');
});

test('Tai-Coon circles her right paw with a visible rotating jade seal during a drift',()=>{
  const moves=model('taicoon.glb');
  const loop=moves('drift','arm_r').rotations;
  const dot=(a,b)=>Math.abs(a.reduce((sum,v,i)=>sum+v*b[i],0));
  for(const frame of [13,27,40])assert.ok(dot(loop[0],loop[frame])<.998);
  assert.ok(dot(loop[0],loop.at(-1))>.9999,'paw returns smoothly to its starting pose');
  assert.ok(moves('drift','palm_seal').values('scale').every(s=>s[0]>.99));
});
