// Explicit, local-only test adapter. Production never reconstructs this mutable JS world.
export function arenaFixture(room){
  let revision=-1,snapshot;
  const read=()=>{if(revision!==room.core.revision){const core=room.core.core,size=core.game_test_snapshot();snapshot=JSON.parse(new TextDecoder().decode(new Uint8Array(core.memory.buffer,core.game_output_ptr(),size)));revision=room.core.revision;}return snapshot;};
  const at=path=>path.reduce((value,key)=>value[key],read());
  const write=(path,value)=>{const world=read();const parent=path.slice(0,-1).reduce((value,key)=>value[key],world);parent[path.at(-1)]=value;room.core.write(world);if(!room.core.core.game_test_edit(room.core.inputLength))throw new Error('Invalid arena test fixture');room.core.revision++;revision=-1;return true;};
  const proxy=path=>new Proxy(Array.isArray(at(path))?[]:{},{get(target,key){const value=at(path)[key];if(value&&typeof value==='object')return proxy([...path,key]);return value;},has(target,key){return Reflect.has(at(path),key);},set(target,key,value){return write([...path,key],value);},ownKeys(){return Reflect.ownKeys(at(path));},getOwnPropertyDescriptor(target,key){return Object.getOwnPropertyDescriptor(at(path),key);}});
  Object.defineProperty(room,'world',{configurable:true,get:()=>proxy([])});
  for(const key of ['events','voices'])Object.defineProperty(room,key,{configurable:true,get:()=>read()[key],set:value=>write([key],value)});
}
