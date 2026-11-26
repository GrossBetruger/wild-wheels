import test from 'node:test';
import assert from 'node:assert/strict';
import {inflateSync} from 'node:zlib';
import {buildUiPack, cardCatalog, findChrome, UI_PACK_VERSION} from '../../scripts/build/ui-port.mjs';

function readUiPack(pack) {
  assert.equal(pack.toString('latin1', 0, 4), 'WWUP');
  assert.equal(pack.readUInt32LE(4), UI_PACK_VERSION);
  const count = pack.readUInt32LE(8);
  let at = 12;
  const cards = new Map();
  for (let i = 0; i < count; i++) {
    const keyLen = pack.readUInt16LE(at); at += 2;
    const key = pack.toString('utf8', at, at + keyLen); at += keyLen;
    const width = pack.readUInt16LE(at); at += 2;
    const height = pack.readUInt16LE(at); at += 2;
    const logicalW = pack.readUInt16LE(at); at += 2;
    const logicalH = pack.readUInt16LE(at); at += 2;
    const detailLeft = pack.readUInt16LE(at); at += 2;
    const detailTop = pack.readUInt16LE(at); at += 2;
    const detailW = pack.readUInt16LE(at); at += 2;
    const detailH = pack.readUInt16LE(at); at += 2;
    const compLen = pack.readUInt32LE(at); at += 4;
    const rgba = inflateSync(pack.subarray(at, at + compLen)); at += compLen;
    assert.equal(rgba.length, width * height * 4, `RGBA byte size for ${key}`);
    cards.set(key, {width, height, logicalW, logicalH, detailLeft, detailTop, detailW, detailH, rgba});
  }
  assert.equal(at, pack.length);
  return cards;
}

test('HTML announcement cards port from style.css into transparent RGBA textures', {skip: !findChrome()}, async () => {
  const pack = await buildUiPack();
  const cards = readUiPack(pack);
  const catalog = cardCatalog();
  assert.equal(cards.size, catalog.length);
  const mug = cards.get('ability:8:wormhole').rgba;
  const halfway = cards.get('ability:8:wormhole:4').rgba;
  const torus = cards.get('ability:8:wormhole:8').rgba;
  assert.ok(!mug.equals(halfway) && !halfway.equals(torus) && !mug.equals(torus),
    'the wormhole HUD shows distinct mug, intermediate, and torus silhouettes');
  for (const spec of catalog) {
    const card = cards.get(spec.key);
    assert.ok(card, `missing card ${spec.key}`);
    assert.ok(card.width >= 200 && card.height >= 100, `dimensions for ${spec.key}`);
    assert.ok(card.detailW > 40 && card.detailH > 10, `detail slot for ${spec.key}`);
    // Verify the texture has both transparent margins (alpha 0) and opaque card pixels (alpha > 200).
    let opaque = 0, transparent = 0;
    for (let i = 3; i < card.rgba.length; i += 4) {
      if (card.rgba[i] > 200) opaque++;
      else if (card.rgba[i] === 0) transparent++;
    }
    assert.ok(opaque > 2000, `${spec.key} should contain rendered card pixels`);
    assert.ok(transparent > 2000, `${spec.key} should preserve transparent glow margins`);
  }
});
