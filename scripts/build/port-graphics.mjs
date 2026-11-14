#!/usr/bin/env node
// Writes the native client's graphics pack. native-client/build.rs runs this
// whenever the browser graphics change; see docs/native-graphics-port.md.
import {writeFileSync} from 'node:fs';
import {buildGraphicsPack} from './graphics-port.mjs';

const output=process.argv[2];
if(!output){console.error('Usage: node scripts/build/port-graphics.mjs <output file>');process.exit(1);}
const pack=buildGraphicsPack();
writeFileSync(output,pack);
console.log(`Ported browser graphics to ${output} (${(pack.length/1048576).toFixed(1)} MiB).`);
