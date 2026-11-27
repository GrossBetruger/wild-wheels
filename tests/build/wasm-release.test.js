import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzipSync} from 'node:zlib';

const script = fileURLToPath(new URL('../../scripts/build/wasm-release.mjs', import.meta.url));
test('a matching release restores both browser files and a rejected release preserves the installed pair', t => {
  const dir = mkdtempSync(join(tmpdir(),'ww-release-'));
  t.after(() => rmSync(dir,{recursive:true,force:true}));
  for (const path of ['local/pkg','server/pkg','stage']) mkdirSync(join(dir,path),{recursive:true});
  const source = 'a'.repeat(64);
  const files = {'wild_wheels_wasm.js':'loader', 'wild_wheels_wasm_bg.wasm':'module'};
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(join(dir,'local/pkg',name),contents);
    writeFileSync(join(dir,'local/pkg',name+'.gz'),gzipSync(contents));
  }
  writeFileSync(join(dir,'local/.wasm.sha256'),source);
  const run = (...args) => spawnSync(process.execPath,[script,...args],{cwd:dir,encoding:'utf8'});
  assert.equal(run('publish','local').status,0);
  assert.equal(run('restore','server',source,'stage').status,0);
  for (const [name, contents] of Object.entries(files)) {
    assert.equal(readFileSync(join(dir,'server/pkg',name),'utf8'),contents);
    assert.deepEqual(readFileSync(join(dir,'server/pkg',name+'.gz')),readFileSync(join(dir,'local/pkg',name+'.gz')));
  }
  assert.match(run('restore','server','b'.repeat(64),'stage').stderr,/different inputs/);
  writeFileSync(join(dir,'server/pkg/wild_wheels_wasm.js'),'currently served loader');
  writeFileSync(join(dir,'releases/bevy-web/wild_wheels_wasm_bg.wasm.gz'),'broken module');
  assert.match(run('restore','server',source,'stage').stderr,/checksum mismatch/);
  assert.equal(readFileSync(join(dir,'server/pkg/wild_wheels_wasm.js'),'utf8'),'currently served loader');
  assert.equal(readFileSync(join(dir,'server/pkg/wild_wheels_wasm_bg.wasm'),'utf8'),'module');
});
