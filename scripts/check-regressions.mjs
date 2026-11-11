import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const args=process.argv.slice(2),functional=args.includes('--functional');
const repeatIndex=args.indexOf('--repeat'),repeat=repeatIndex<0?3:Number(args[repeatIndex+1]);
if(!Number.isInteger(repeat)||repeat<1||repeat>10)throw new Error('Repeat must be 1–10');
const outputIndex=args.indexOf('--output-dir');
const directory=outputIndex<0?await mkdtemp(join(tmpdir(),'wild-wheels-regressions-')):resolve(args[outputIndex+1]);
await mkdir(directory,{recursive:true});
console.log(`Regression results: ${directory}. Frame budget: ${functional?'recorded only (shared runner)':'enforced'}.`);
const results=[];
for(const [name,command] of [
  ['automated',['--test']],
  ...['movement','actions','drift','controls','mobile','characters'].map(name=>[name,['scripts/check-browser-netcode.mjs',...(name==='movement'?[]:[name==='actions'?'--feedback':`--${name}`]),'--repeat',String(repeat),'--output',join(directory,`${name}.json`),...(functional?['--functional']:[])]])
]){
  const status=await new Promise(resolve=>{
    const child=spawn(process.execPath,command,{stdio:'inherit'});
    child.on('error',error=>{console.error(error.message);resolve(1);});
    child.on('exit',code=>resolve(code??1));
  });
  results.push({name,status});
}
await writeFile(join(directory,'summary.json'),JSON.stringify({frameBudgetEnforced:!functional,repeat,results},null,2)+'\n');
console.log(JSON.stringify({directory,results}));
if(results.some(result=>result.status!==0))process.exitCode=1;
