// Ship the wasm-bindgen module and its loader as one matching browser release.
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';

const directory = 'releases/bevy-web';
const files = ['wild_wheels_wasm_poc.js', 'wild_wheels_wasm_poc_bg.wasm'];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const asset = name => join(directory, name + '.gz');

function publish(output) {
  const source = readFileSync(join(output, '.wasm.sha256'), 'utf8').trim();
  if (!/^[0-9a-f]{64}$/.test(source)) throw Error('Missing WASM build fingerprint');
  const hashes = {};
  mkdirSync(directory, {recursive:true});
  for (const name of files) {
    const packed = readFileSync(join(output, 'pkg', name + '.gz'));
    if (!gunzipSync(packed).equals(readFileSync(join(output, 'pkg', name)))) throw Error('Mismatched build output for ' + name);
    writeFileSync(asset(name), packed);
    hashes[name] = digest(packed);
  }
  writeFileSync(join(directory, 'manifest.json'), JSON.stringify({source, sha256:hashes}, null, 2) + '\n');
  console.log('Prepared the browser WASM release in ' + directory);
}

function status(state) {
  if (process.env.WILD_WHEELS_BUILD_STATUS_FILE) {
    execFileSync('bash',[fileURLToPath(new URL('./build-status.sh',import.meta.url)),state]);
  }
}

function restore(output, source, staging) {
  const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
  if (manifest.source !== source) throw Error('release was built from different inputs');
  const pointer = Buffer.from('version https://git-lfs.github.com/spec/v1');
  if (files.some(name => readFileSync(asset(name)).subarray(0, pointer.length).equals(pointer))) {
    status('fetching-wasm');
    console.log('Downloading published WASM from Git LFS…');
    execFileSync('git', ['lfs', 'pull', '--include='+directory+'/*.gz', '--exclude='], {
      stdio:'inherit', timeout:60000, env:{...process.env, GIT_TERMINAL_PROMPT:'0'},
    });
  }
  status('unpacking-wasm');
  for (const name of files) {
    const packed = readFileSync(asset(name));
    if (digest(packed) !== manifest.sha256?.[name]) throw Error('checksum mismatch for ' + name);
    writeFileSync(join(staging, name + '.gz'), packed);
    writeFileSync(join(staging, name), gunzipSync(packed, {maxOutputLength:128*1024*1024}));
  }
  // Both files passed verification before replacing any cached output.
  for (const name of files) for (const suffix of ['', '.gz']) {
    renameSync(join(staging, name + suffix), join(output, 'pkg', name + suffix));
  }
  writeFileSync(join(staging, 'wasm.sha256'), source + '\n');
  renameSync(join(staging, 'wasm.sha256'), join(output, '.wasm.sha256'));
  console.log('Reused verified Git LFS WASM release.');
}

const [action, output, source, staging] = process.argv.slice(2);
switch (action) {
  case 'publish': publish(output); break;
  case 'restore':
    try { restore(output, source, staging); }
    catch (error) { console.error('Using WASM source build:', error.message); process.exitCode = 1; }
    break;
  default: throw Error('Expected publish or restore');
}
