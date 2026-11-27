// Fingerprint the modules each exporter actually imports, without running their
// top-level code. Binary inputs read at runtime are listed alongside each entry.
import {createHash} from 'node:crypto';
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {SourceTextModule} from 'node:vm';

function imports(entry, files = new Set()) {
  if (files.has(entry)) return files;
  files.add(entry);
  const mod = new SourceTextModule(readFileSync(entry, 'utf8'));
  for (const dependency of mod.dependencySpecifiers) {
    if (dependency.startsWith('.')) imports(join(dirname(entry), dependency), files);
  }
  return files;
}

function fingerprint(inputs, recipe) {
  const hash = createHash('sha256').update(JSON.stringify(recipe));
  function add(path) {
    if (statSync(path).isDirectory()) {
      for (const entry of readdirSync(path).sort()) add(join(path, entry));
      return;
    }
    const data = readFileSync(path);
    hash.update('\0' + path + '\0' + data.length + '\0').update(data);
  }
  for (const path of [...inputs].sort()) add(path);
  return hash.digest('hex');
}

const [toolchain, target] = process.argv.slice(2);
// Bump the relevant recipe version for changes to output flags or pack format.
console.log(fingerprint([
  'wasm/Cargo.toml', 'wasm/Cargo.lock', 'wasm/src',
  'bevy-render/Cargo.toml', 'bevy-render/src',
  'rust-core/Cargo.toml', 'rust-core/build.rs', 'rust-core/src',
  'gameplay/player-colors.js', 'gameplay/special-abilities.js',
], ['wasm-release-web-v1', toolchain, target, process.env.RUSTFLAGS, process.env.CARGO_ENCODED_RUSTFLAGS]));
console.log(fingerprint([...imports('scripts/build/port-graphics.mjs'), 'rust-core.wasm'], ['graphics-web-v1']));
console.log(fingerprint([...imports('scripts/build/port-sounds.mjs'), 'assets/audio'], ['sounds-v1', process.platform]));
