#!/usr/bin/env node
// Writes the native client's sound pack. native-client/build.rs runs this
// whenever the browser audio changes; see docs/native-sound-port.md.
import {writeFileSync} from 'node:fs';
import {buildSoundPack} from './sound-port.mjs';

const output=process.argv[2];
if(!output){console.error('Usage: node scripts/build/port-sounds.mjs <output file>');process.exit(1);}
const pack=await buildSoundPack();
writeFileSync(output,pack);
console.log(`Ported browser sounds to ${output} (${(pack.length/1048576).toFixed(1)} MiB).`);
