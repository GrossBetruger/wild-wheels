import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {appendFileSync, cpSync, mkdirSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

test('scenery, recordings and Rust-generated palette changes invalidate their respective builds', t => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const repo = mkdtempSync(join(tmpdir(), 'ww-cache-'));
  t.after(() => rmSync(repo, {recursive:true, force:true}));
  for (const path of ['scripts/build', 'client', 'characters', 'ui', 'gameplay', 'audio', 'style.css',
    'assets/audio', 'rust-core.wasm', 'wasm/Cargo.toml', 'wasm/Cargo.lock', 'wasm/src',
    'bevy-render/Cargo.toml', 'bevy-render/src',
    'rust-core/Cargo.toml', 'rust-core/build.rs', 'rust-core/src']) {
    mkdirSync(dirname(join(repo, path)), {recursive:true});
    cpSync(join(root, path), join(repo, path), {recursive:true});
  }
  const stages = ['wasm', 'graphics', 'sounds', 'ui'];
  const keys = () => execFileSync(process.execPath, ['--no-warnings', '--experimental-vm-modules',
    'scripts/build/experimental-cache-keys.mjs', '1.97.1', 'wasm32-unknown-unknown'],
  {cwd:repo, encoding:'utf8'}).trim().split('\n');
  let before = keys();
  for (const [file, expected] of [
    ['client/konigsberg.js', ['graphics']],
    ['assets/audio/dark-humor-crowd.ogg', ['sounds']],
    ['style.css', ['ui']],
    ['rust-core/build.rs', ['wasm']],
    ['gameplay/player-colors.js', ['wasm']],
    ['scripts/build/build-status.sh', []],
    ['gameplay/unrelated.test.js', []],
  ]) {
    appendFileSync(join(repo, file), '\n');
    const after = keys();
    assert.deepEqual(stages.filter((_, i) => before[i] !== after[i]), expected, file);
    before = after;
  }
});
