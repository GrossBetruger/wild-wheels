// Lethality scenario: bots playing the racers whose special abilities deal
// damage fight full matches, and the kills each ability scores are counted.
// It is not part of any test run; start it when abilities need comparing:
//
//   npm run scenario:lethality -- [--matches 6] [--target 50]
//
// Each match runs until a racer reaches --target kills. The simulation itself
// is rust-core/src/arena/lethality.rs: the real game rules and bot AI, with no
// rendering or network, so a run takes about a second.
import {spawnSync} from 'node:child_process';
import {join, resolve} from 'node:path';
import {parseArgs} from 'node:util';

const root = resolve(import.meta.dirname, '../..');
const {values: options} = parseArgs({options: {
  matches: {type: 'string', default: '6'},
  target: {type: 'string', default: '50'},
}});
const matches = Number(options.matches), target = Number(options.target);
if (!(Number.isInteger(matches) && matches >= 1) || !(Number.isInteger(target) && target >= 1)) {
  throw new Error('Use --matches and --target as whole numbers of 1 or more.');
}
const run = spawnSync('cargo', ['test', '--release', '--quiet', '--lib', 'arena::lethality', '--', '--ignored', '--nocapture'], {
  cwd: join(root, 'rust-core'),
  env: {...process.env, LETHALITY_MATCHES: String(matches), LETHALITY_TARGET: String(target)},
  stdio: 'inherit',
});
process.exit(run.status ?? 1);
