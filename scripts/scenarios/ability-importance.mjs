// Ability importance scenario: every racer with abilities plays bot matches
// with each subset of its abilities switched on, against racers with none
// (plain field) and against the other racers with abilities (mixed field), and
// Markdown and HTML reports give each ability's contribution (its Shapley value) to
// kills, deaths and wins. It is not part of any test run; start it when the
// abilities need comparing:
//
//   npm run scenario:ability-importance -- [--matches 40] [--minutes 4]
//                         [--field plain|mixed|both] [--out FILE] [--no-open]
//
// The simulation is rust-core/src/arena/importance.rs: the real rules and bot
// AI with no rendering. The report goes to .wild-wheels/reports/ by default.
import {spawnSync} from 'node:child_process';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, extname, join, resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {renderAbilityReport} from './ability-report.mjs';

const root = resolve(import.meta.dirname, '../..');
const {values: options} = parseArgs({options: {
  matches: {type: 'string', default: '40'},
  minutes: {type: 'string', default: '4'},
  field: {type: 'string', default: 'both'},
  out: {type: 'string', default: join(root, '.wild-wheels/reports/ability-importance.md')},
  'no-open': {type: 'boolean', default: false},
}});
const matches = Number(options.matches), minutes = Number(options.minutes);
if (!(Number.isInteger(matches) && matches >= 2) || !(minutes > 0 && minutes <= 60)) {
  throw new Error('Use --matches as a whole number of 2 or more and --minutes up to 60.');
}
if (!['plain', 'mixed', 'both'].includes(options.field)) throw new Error('Use --field plain, mixed or both.');
const out = resolve(options.out);
const markdown = extname(out) === '.html' ? `${out.slice(0, -5)}.md` : out;
const html = extname(out) === '.html' ? out : `${out.slice(0, out.length - extname(out).length)}.html`;
mkdirSync(dirname(out), {recursive: true});
const run = spawnSync('cargo', ['test', '--release', '--quiet', '--lib', 'arena::importance', '--', '--ignored', '--nocapture'], {
  cwd: join(root, 'rust-core'),
  env: {...process.env, ABILITY_MATCHES: String(matches), ABILITY_MINUTES: String(minutes), ABILITY_FIELD: options.field, ABILITY_REPORT: markdown},
  stdio: 'inherit',
});
if (run.error) console.error(run.error.message);
if (run.status !== 0) process.exit(run.status ?? 1);
writeFileSync(html, renderAbilityReport(readFileSync(markdown, 'utf8'), {matches, minutes}));
console.log(`HTML report: ${html}`);
if (!options['no-open']) {
  const command = new Map([['darwin', 'open'], ['linux', 'xdg-open'], ['win32', 'explorer.exe']]).get(process.platform);
  if (!command) {
    console.warn('Automatic opening is unavailable on this platform. Open the HTML report manually.');
    process.exit(0);
  }
  const opened = spawnSync(command, [html], {stdio: 'ignore'});
  if (opened.error || opened.status !== 0) console.warn('Could not open the browser. Open the HTML report manually.');
}
