import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

function readGlb(relPath) {
  const bytes = readFileSync(new URL(relPath, import.meta.url));
  assert.equal(bytes.subarray(0, 4).toString('latin1'), 'glTF', 'valid GLB header');
  const jsonLen = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLen).toString('utf8'));
  return {bytes, gltf};
}

test('tehilim_book.glb is a valid PBR Sefer Tehilim with navy leather, gold emboss, gilt pages, and crimson ribbon', () => {
  const {gltf} = readGlb('../assets/models/tehilim_book.glb');
  const matNames = new Set((gltf.materials ?? []).map(m => m.name));
  for (const required of ['LeatherNavy', 'SpineNavy', 'GoldFoil', 'GoldEmboss', 'GiltPages', 'SilkRibbon']) {
    assert.ok(matNames.has(required), `missing PBR material ${required}`);
  }
  let tris = 0;
  for (const mesh of gltf.meshes ?? []) {
    for (const prim of mesh.primitives ?? []) {
      const idxAcc = gltf.accessors[prim.indices];
      tris += (idxAcc?.count ?? 0) / 3;
    }
  }
  assert.ok(tris > 1000 && tris < 15000, `expected WASM-friendly triangle count, got ${tris}`);
});

test('build_tehilim.py writes תהילים right-to-left using a Hebrew Bible serif font', () => {
  const src = readFileSync(new URL('./build_tehilim.py', import.meta.url), 'utf8');
  assert.match(src, /NewPeninimMT\.ttc/, 'uses New Peninim MT Hebrew Bible serif font');
  assert.match(src, /"תהילים"\[::-1\]/, 'reverses תהילים into visual LTR order for Blender 3D text');
});

test('bevy-render/src/tehilim.rs orbits one book in a seamless loop and suppresses the legacy 6-book overlay', () => {
  const tehilim = readFileSync(new URL('../../bevy-render/src/tehilim.rs', import.meta.url), 'utf8');
  const scene = readFileSync(new URL('../../bevy-render/src/scene.rs', import.meta.url), 'utf8');
  assert.match(tehilim, /pub const ORBIT_PERIOD: f32 = 2\.4;/);
  assert.match(tehilim, /pub const PICKUP_SPIN_PERIOD: f32 = 3\.6;/);
  assert.match(tehilim, /pub const PICKUP_BOB_PERIOD: f32 = 1\.8;/);
  assert.match(tehilim, /fn tehilim_orbit_is_a_perfect_seamless_loop/);
  assert.match(scene, /if \*name == "tehilim" \{\s*continue;\s*\}/);
  assert.match(scene, /if supply\.kind == "tehilim" \{\s*continue;\s*\}/);
});
