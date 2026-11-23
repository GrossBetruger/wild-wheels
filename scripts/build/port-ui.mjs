import {writeFileSync} from 'node:fs';
import {buildUiPack} from './ui-port.mjs';

const args = process.argv.slice(2);
const optional = args.includes('--optional');
const output = args.find(arg => !arg.startsWith('--'));
if (!output) {
  console.error('Usage: node scripts/build/port-ui.mjs [--optional] <output-file>');
  process.exit(1);
}
const pack = await buildUiPack({optional});
writeFileSync(output, pack);
