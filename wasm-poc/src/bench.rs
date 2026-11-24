use std::sync::atomic::AtomicU64;

pub static MESHES_BUILT: AtomicU64 = AtomicU64::new(0);
pub static MESH_BUILD_NANOS: AtomicU64 = AtomicU64::new(0);
pub static SPRITE_MESHES: AtomicU64 = AtomicU64::new(0);
pub static PROJECTILES: AtomicU64 = AtomicU64::new(0);
pub static EFFECTS: AtomicU64 = AtomicU64::new(0);
pub static SPAWNED: AtomicU64 = AtomicU64::new(0);
pub static DESPAWNED: AtomicU64 = AtomicU64::new(0);
