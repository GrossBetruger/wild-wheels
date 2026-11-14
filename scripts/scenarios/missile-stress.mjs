// Missile stress scenario: a 16-racer match where every shot is a missile and
// special abilities are off, measured by the native client's benchmark. It is
// not part of any test run; start it when missile-heavy play needs measuring:
//
//   npm run scenario:missile-stress -- [--seconds 20] [--runs 2] [--offscreen]
//                                      [--client PATH] [--players 16]
//
// The server and client are built from this checkout with build-time settings
// (WILD_WHEELS_MAX_PLAYERS, WILD_WHEELS_MISSILES_ONLY in rust-core/src/arena/mod.rs)
// into their own target folder, so normal builds are untouched. `--client` runs
// another client binary instead, built with the same settings, to compare
// against; `--offscreen` draws with no window. Without it, the game window is
// brought to the front for each run, since covered windows are throttled.
import {spawn, spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {parseArgs} from 'node:util';

const root = resolve(import.meta.dirname, '../..');
const {values: options} = parseArgs({options: {
  seconds: {type: 'string', default: '20'},
  runs: {type: 'string', default: '1'},
  players: {type: 'string', default: '16'},
  offscreen: {type: 'boolean', default: false},
  client: {type: 'string'},
}});
const seconds = Number(options.seconds), runs = Number(options.runs), players = Number(options.players);
if (!(seconds >= 1 && seconds <= 300) || !(runs >= 1) || !(players >= 8 && players <= 64)) {
  throw new Error('Use --seconds 1–300, --runs 1 or more and --players 8–64.');
}

// One target folder per player count keeps rebuilds incremental.
const target = join(root, 'native-client/target/scenarios', `missiles-${players}`);
const settings = {...process.env, CARGO_TARGET_DIR: target, WILD_WHEELS_MAX_PLAYERS: String(players), WILD_WHEELS_MISSILES_ONLY: '1'};
for (const crate of ['dedicated-server', 'native-client']) {
  console.log(`Building ${crate} for ${players} players, missiles only…`);
  // Run from the crate's folder, so its pinned toolchain is used.
  const build = spawnSync('cargo', ['build', '--release'], {cwd: join(root, crate), env: settings, stdio: 'inherit'});
  if (build.status !== 0) throw new Error(`${crate} did not build`);
}
const server = join(target, 'release/wild-wheels-server');
const client = options.client ? resolve(options.client) : join(target, 'release/wild-wheels-native');

const freePort = () => new Promise((done, fail) => {
  const probe = createServer().once('error', fail).listen(0, '127.0.0.1', () => {
    const {port} = probe.address();
    probe.close(() => done(port));
  });
});
const sleep = milliseconds => new Promise(done => setTimeout(done, milliseconds));
const exited = child => new Promise(done => child.once('exit', code => done(code)));

async function run(index, directory) {
  const port = await freePort(), origin = `http://127.0.0.1:${port}`;
  const host = spawn(server, [], {cwd: directory, stdio: ['ignore', 'ignore', 'pipe'], env: {
    ...process.env, PORT: String(port), BIND: '127.0.0.1', BOTS: String(players - 1), SPECIAL_ABILITIES: 'off',
    PUBLIC_ORIGIN: origin, WILD_WHEELS_SESSION_FILE: join(directory, 'sessions.json'),
    WILD_WHEELS_CHAT_FILE: join(directory, 'chat.json'), WILD_WHEELS_STATS_FILE: join(directory, 'stats.json'),
  }});
  let serverErrors = '';
  host.stderr.on('data', chunk => { serverErrors += chunk; });
  for (let i = 0; i < 50 && !(await fetch(`${origin}/api/info`).then(r => r.ok, () => false)); i++) await sleep(100);

  const args = ['--server', origin, '--name', 'Stress', '--auto-start', '--benchmark', String(seconds)];
  if (options.offscreen) args.push('--offscreen');
  const game = spawn(client, args, {stdio: ['ignore', 'pipe', 'pipe'], env: {...process.env, WILD_WHEELS_NATIVE_DATA_DIR: join(directory, `client-${index}`)}});
  let output = '';
  game.stdout.on('data', chunk => { output += chunk; });
  game.stderr.on('data', chunk => { output += chunk; });
  if (!options.offscreen && process.platform === 'darwin') {
    await sleep(1000);
    spawnSync('osascript', ['-e', `tell application "System Events" to set frontmost of (first process whose unix id is ${game.pid}) to true`]);
  }
  const code = await exited(game);
  host.kill();
  await exited(host);
  if (code !== 0) throw new Error(`The client exited with ${code}:\n${output.slice(-2000)}\n${serverErrors.slice(-2000)}`);

  const events = output.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line));
  const result = events.find(e => e.event === 'benchmark');
  const byMissiles = events.filter(e => e.event === 'by-projectiles');
  if (!result) throw new Error(`The client printed no benchmark:\n${output.slice(-2000)}`);
  if (/protocol error|invalid arena packet/i.test(output)) throw new Error('The client reported a protocol error.');
  const ms = value => value.toFixed(2).padStart(6);
  const frame = result.frameMs;
  console.log(`run ${index + 1}: fps ${result.fps.toFixed(0)}  mean ${ms(frame.mean)}  p50 ${ms(frame.p50)}  p95 ${ms(frame.p95)}  p99 ${ms(frame.p99)}  max ${ms(frame.max)} ms  logic ${ms(result.logicMs)} ms  particle meshes/frame ${result.spriteMeshesPerFrame.toFixed(2)}`);
  for (const bucket of byMissiles) {
    console.log(`  ${String(bucket.projectiles).padStart(2)}${bucket.projectiles === 12 ? '+' : ' '} in flight: ${String(bucket.frames).padStart(5)} frames, mean ${ms(bucket.meanMs)}, max ${ms(bucket.maxMs)} ms`);
  }
  if (!byMissiles.some(bucket => bucket.projectiles >= 3)) console.log('  Warning: never three missiles in flight at once; the match may not have started.');
}

const directory = mkdtempSync(join(tmpdir(), 'wild-wheels-missile-stress-'));
try {
  console.log(`${players} racers (${players - 1} bots), missiles only, specials off, ${seconds} s after a 5 s warm-up, ${options.offscreen ? 'offscreen' : 'in a window'}`);
  for (let index = 0; index < runs; index++) await run(index, directory);
} finally {
  rmSync(directory, {recursive: true, force: true});
}
