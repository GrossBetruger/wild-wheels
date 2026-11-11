const SLOTS: usize = 128;
mod arena;
const FIELDS: usize = 16;
const CLEAR: u32 = 1;
const CHARGE: u32 = 2;
const MAX_CHARGE: u32 = 4;
const BOOST: u32 = 8;
const TRAIL: u32 = 16;
const CRASH: u32 = 32;
#[derive(Clone, Copy)]
#[repr(C)]
struct Kart { data: [f64; FIELDS] }
#[derive(Clone, Copy)]
struct Arena { size: f64, count: usize, blocks: [[f64; 4]; 32] }
static mut KARTS: [Kart; SLOTS] = [Kart { data: [0.0; FIELDS] }; SLOTS];
static mut ARENAS: [Arena; 8] = [Arena { size: 0.0, count: 0, blocks: [[0.0; 4]; 32] }; 8];
static mut CONFIG: [f64; 128] = [0.0; 128];
#[no_mangle]
pub extern "C" fn abi_version() -> u32 { 1 }
#[no_mangle]
pub extern "C" fn state_ptr(slot: usize) -> *mut f64 {
    if slot >= SLOTS { return core::ptr::null_mut(); }
    // The ABI uses fixed allocations. No export grows memory or retains JS pointers.
    unsafe { core::ptr::addr_of_mut!(KARTS).cast::<Kart>().add(slot).cast::<f64>() }
}
#[no_mangle]
pub extern "C" fn config_ptr() -> *mut f64 { core::ptr::addr_of_mut!(CONFIG).cast() }
#[no_mangle]
pub extern "C" fn set_arena(index: usize, size: f64, count: usize) -> u32 {
    if index >= 8 || count > 32 || !size.is_finite() || size <= 2.0 { return 0; }
    let arena = unsafe { &mut *core::ptr::addr_of_mut!(ARENAS).cast::<Arena>().add(index) };
    let config = unsafe { &*core::ptr::addr_of!(CONFIG) };
    for i in 0..count {
        let block = [config[i*4],config[i*4+1],config[i*4+2],config[i*4+3]];
        if !block.iter().all(|n| n.is_finite()) || block[2] <= 0.0 || block[3] <= 0.0 { return 0; }
        arena.blocks[i] = block;
    }
    arena.size = size;arena.count = count;1
}
fn blocked(arena: &Arena, x: f64, z: f64) -> bool {
    if x.abs() > arena.size-2.0 || z.abs() > arena.size-2.0 { return true; }
    arena.blocks[..arena.count].iter().any(|b| (x-b[0]).abs()<b[2]/2.0+2.0 && (z-b[1]).abs()<b[3]/2.0+2.0)
}
fn angle(a: f64, b: f64) -> f64 { (a-b).sin().atan2((a-b).cos()) }
#[no_mangle]
pub extern "C" fn step(slot: usize, arena_index: usize, steer: f64, dt: f64, flags: u32) -> u32 {
    if slot>=SLOTS || arena_index>=8 || !steer.is_finite() || steer.abs()>1.0 || !dt.is_finite() || !(0.0..=0.05).contains(&dt) { return 0x80000000; }
    let arena = unsafe { &*core::ptr::addr_of!(ARENAS).cast::<Arena>().add(arena_index) };
    if arena.size<=2.0 { return 0x80000000; }
    let kart = unsafe { &mut *core::ptr::addr_of_mut!(KARTS).cast::<Kart>().add(slot) };
    if !kart.data.iter().all(|n| n.is_finite()) { return 0x80000000; }
    // wx,wz,heading,motion,camera,speed,drift,boost,somersault,cooldown,dizzy,
    // cameraStart,yaw,wasDrifting,wallCooldown,reserved.
    let [mut x,mut z,mut heading,mut motion,mut camera,mut speed,mut drift,mut boost,mut flip,mut cooldown,mut dizzy,camera_start,mut yaw,was,wall,reserved] = kart.data;
    let advance = flags&1 != 0;
    let gas=flags&2 != 0;let brake=flags&4 != 0;let handbrake=flags&8 != 0;
    let use_motion=flags&16 != 0;let can_boost=flags&32 != 0;let local=flags&64 != 0;
    if advance {
        dizzy=(dizzy-dt).max(0.0);flip=(flip-dt).max(0.0);cooldown=(cooldown-dt).max(0.0);boost=(boost-dt).max(0.0);yaw=steer*0.12;
    }
    let mut turn=steer;
    if dizzy>0.0 { turn=(turn*0.6+((4.0-dizzy)*9.0).sin()*0.4).clamp(-1.0,1.0); }
    let drifting=handbrake && flip<=0.0 && !brake && turn.abs()>0.1 && speed>match was!=0.0 { true=>70.0,false=>110.0 };
    let mut events=0;
    if drifting {
        let before=drift;drift=(drift+dt).min(1.2);
        if before<0.45 && drift>=0.45 { events|=CHARGE; }
        if before<0.85 && drift>=0.85 { events|=MAX_CHARGE; }
    }
    if !drifting && was!=0.0 {
        if !handbrake && !brake && speed>90.0 && drift>=0.45 && can_boost {
            boost=boost.max(match drift>=0.85 { true=>1.35,false=>0.8 });motion=heading;events|=BOOST;
        }
        drift=0.0;events|=CLEAR;
    }
    heading-=turn*match drifting { true=>4.8,false=>1.7+(speed.abs()/300.0).min(1.0)*0.7 }*dt;
    let acceleration=match (gas,drifting) { (true,true)=>100.0,(true,false)=>300.0,(false,true)=>-90.0,(false,false)=>-170.0 };
    let maximum=match (drifting,boost>0.0) { (true,_)=>400.0,(false,true)=>850.0,_=>520.0 };
    speed=(speed+acceleration*dt-match brake { true=>400.0*dt,false=>0.0 }).clamp(match brake { true=>-160.0,false=>0.0 },maximum);
    if boost>0.0 && !drifting { speed=(speed+650.0*dt).min(850.0); }
    motion+=angle(heading,motion)*(1.0-(-match drifting { true=>3.8,false=>14.0 }*dt).exp());
    if flip>0.0 {
        let progress=(1.0-flip/0.55).clamp(0.0,1.0);let smooth=progress*progress*(3.0-2.0*progress);
        camera=camera_start+core::f64::consts::PI*smooth;
    }
    if flip<=0.0 { camera+=angle(heading,camera)*(1.0-(-match drifting { true=>5.0,false=>9.0 }*dt).exp()); }
    let travel=match drifting||use_motion { true=>motion,false=>heading };
    let nx=x+travel.sin()*speed*0.085*dt;let nz=z+travel.cos()*speed*0.085*dt;
    let mut was_drifting=match drifting { true=>1.0,false=>0.0 };
    let collided=blocked(arena,nx,nz);
    if !collided {
        x=nx;z=nz;if drifting { events|=TRAIL; }
    }
    if collided {
        if !blocked(arena,nx,z) { x=nx; }
        if !blocked(arena,x,nz) { z=nz; }
        speed*=0.3;drift=0.0;was_drifting=0.0;motion=heading;events|=CLEAR;
        if local && wall<=0.0 { events|=CRASH; }
    }
    kart.data=[x,z,heading,motion,camera,speed,drift,boost,flip,cooldown,dizzy,camera_start,yaw,was_drifting,wall,reserved];events
}
