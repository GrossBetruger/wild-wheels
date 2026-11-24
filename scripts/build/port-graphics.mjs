#!/usr/bin/env node
// Writes the native client's graphics pack. native-client/build.rs runs this
// whenever the browser graphics change; see docs/native-graphics-port.md.
import {writeFileSync} from 'node:fs';
import {buildGraphicsPack} from './graphics-port.mjs';

const args=process.argv.slice(2);
const web=args.includes('--web');
const output=args.find(arg=>arg!=='--web');
if(!output){console.error('Usage: node scripts/build/port-graphics.mjs [--web] <output file>');process.exit(1);}
const pack=buildGraphicsPack({web});
writeFileSync(output,pack);
console.log(`Ported browser graphics to ${output} (${(pack.length/1048576).toFixed(1)} MiB${web?', web':''}).`);
