import { spawn } from 'node:child_process';
import { copyFile, chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url)),target=await mkdtemp(join(tmpdir(),'wild-wheels-core-build-'));
try{
  await new Promise((resolve,reject)=>{
    const child=spawn('cargo',['build','--locked','--offline','--release','--target','wasm32-unknown-unknown','--manifest-path','rust-core/Cargo.toml','--target-dir',target],{cwd:root,stdio:'inherit'});
    child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`Rust core build failed (${code}). Install Rust and run rustup target add wasm32-unknown-unknown.`)));
  });
  await copyFile(join(target,'wasm32-unknown-unknown/release/wild_wheels_core.wasm'),join(root,'rust-core.wasm'));
  await chmod(join(root,'rust-core.wasm'),0o644);
  console.log('Built rust-core.wasm');
}finally{await rm(target,{recursive:true,force:true});}
