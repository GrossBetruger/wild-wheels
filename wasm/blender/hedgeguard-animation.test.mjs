import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {abilityNames} from '../../gameplay/special-abilities.js';

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
  return {bytes, gltf, tris};
}

test('hedgeguard_shield.glb is a valid armored PBR heater shield with titanium rim and energy trim', () => {
  const {gltf, tris} = readGlb('../assets/models/hedgeguard_shield.glb');
  const mats = new Set((gltf.materials ?? []).map(m => m.name));
  for (const required of ['ShieldTeal', 'ShieldField', 'ShieldTitanium', 'ShieldRivet', 'ShieldEnergy']) {
    assert.ok(mats.has(required), `missing PBR material ${required}`);
  }
  assert.ok(tris > 500 && tris < 8000, `expected WASM-friendly shield triangle count, got ${tris}`);
});

test('every character with a special ability (plus default) has a dedicated PBR shield emblem GLB', () => {
  const specialDrivers = Object.keys(abilityNames).map(Number).sort((a, b) => a - b);
  for (const key of ['default', ...specialDrivers.map(String)]) {
    const {tris} = readGlb(`../assets/models/hedgeguard_emblem_${key}.glb`);
    assert.ok(tris > 200 && tris < 10000, `emblem ${key} triangle count out of range: ${tris}`);
  }
});

test('bevy-render/src/hedgeguard.rs orbits one shield in a seamless loop and wires every special-ability emblem', () => {
  const src = readFileSync(new URL('../../bevy-render/src/hedgeguard.rs', import.meta.url), 'utf8');
  const scene = readFileSync(new URL('../../bevy-render/src/scene.rs', import.meta.url), 'utf8');
  assert.match(src, /pub const ORBIT_PERIOD: f32 = 2\.4;/);
  assert.match(src, /pub const SPECIAL_EMBLEM_DRIVERS: \[usize; 10\] = \[5, 7, 8, 9, 10, 11, 12, 13, 14, 15\];/);
  assert.match(src, /fn hedgeguard_orbit_is_a_perfect_seamless_loop/);
  assert.match(scene, /\*name == "tehilim" \|\| \*name == "hedge"/);
  assert.match(scene, /"tehilim" \| "hedgeproof"/);
});
