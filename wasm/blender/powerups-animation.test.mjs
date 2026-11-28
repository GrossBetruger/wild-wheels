import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

function readGlb(relPath) {
  const bytes = readFileSync(new URL(relPath, import.meta.url));
  assert.equal(bytes.subarray(0, 4).toString('latin1'), 'glTF', `valid GLB header for ${relPath}`);
  const jsonLen = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLen).toString('utf8'));
  let tris = 0;
  for (const mesh of gltf.meshes ?? []) {
    for (const prim of mesh.primitives ?? []) {
      tris += (gltf.accessors[prim.indices]?.count ?? 0) / 3;
    }
  }
  return {gltf, tris};
}

test('all 4 uplifted arena powerup GLBs exist with WASM-friendly triangle counts', () => {
  for (const kind of ['missile', 'hedgehog', 'boost', 'health']) {
    const {tris} = readGlb(`../assets/models/pickup_${kind}.glb`);
    assert.ok(tris >= 300 && tris < 8000, `pickup_${kind}.glb triangle count out of range: ${tris}`);
  }
});

test('bevy-render/src/powerups.rs drives seamless loops and suppresses legacy pickups in scene.rs', () => {
  const powerups = readFileSync(new URL('../../bevy-render/src/powerups.rs', import.meta.url), 'utf8');
  const scene = readFileSync(new URL('../../bevy-render/src/scene.rs', import.meta.url), 'utf8');
  assert.match(powerups, /pub const SPIN_PERIOD: f32 = 3\.2;/);
  assert.match(powerups, /pub const BOB_PERIOD: f32 = 1\.6;/);
  assert.match(powerups, /fn powerup_loops_close_seamlessly/);
  assert.match(scene, /"tehilim" \| "hedgeproof" \| "missile" \| "hedgehog" \| "boost" \| "health"/);
});
