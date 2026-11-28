use serde::{Deserialize, Serialize};
use std::sync::{OnceLock, RwLock};

pub const MAX_ARENAS: usize = 32;

fn default_shape() -> String {
    "square".into()
}
fn default_ground() -> String {
    "#8b927d".into()
}
fn default_wall() -> String {
    "#d7794d".into()
}
fn default_sky() -> String {
    "#b5d3d9".into()
}
fn valid_hex(color: &str) -> bool {
    color.len() == 7
        && color.starts_with('#')
        && color.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArenaDef {
    pub name: String,
    pub desc: String,
    pub size: f64,
    #[serde(default = "default_shape")]
    pub shape: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_players: Option<usize>,
    #[serde(default = "default_ground")]
    pub ground: String,
    #[serde(default = "default_wall")]
    pub wall: String,
    #[serde(default = "default_sky")]
    pub sky: String,
    #[serde(default)]
    pub blocks: Vec<[f64; 4]>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub water: Vec<[f64; 4]>,
    /// Bridges spanning water channels: `[x, z, w, d, axis]` where `axis` 0 = spans along Z (N-S),
    /// 1 = spans along X (E-W).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub bridges: Vec<[f64; 5]>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub spawns: Vec<[f64; 2]>,
}

pub const HILL_HEIGHT: f64 = 22.0;
pub const HILL_TOP_R: f64 = 42.0;
pub const HILL_CLIFF_FOOT_R: f64 = 60.0;
pub const HILL_ROAD_END_R: f64 = 112.0;
pub const HILL_ROAD_HALF_W: f64 = 14.0;
pub const HILL_ROAD_SHOULDER: f64 = 8.0;
pub const MAX_CLIMB_SLOPE: f64 = 0.55;
pub const CLIFF_SLIDE_SPEED: f64 = 48.0;

pub fn hill_ground_height(x: f64, z: f64) -> f64 {
    let r = x.hypot(z);
    if r <= HILL_TOP_R {
        return HILL_HEIGHT;
    }
    if r >= HILL_ROAD_END_R {
        return 0.0;
    }
    let cliff_h = if r >= HILL_CLIFF_FOOT_R {
        0.0
    } else {
        HILL_HEIGHT * (1.0 - (r - HILL_TOP_R) / (HILL_CLIFF_FOOT_R - HILL_TOP_R))
    };
    let road_h = HILL_HEIGHT * (1.0 - (r - HILL_TOP_R) / (HILL_ROAD_END_R - HILL_TOP_R));
    let d_road = x.abs().min(z.abs());
    if d_road <= HILL_ROAD_HALF_W {
        return road_h;
    }
    if d_road >= HILL_ROAD_HALF_W + HILL_ROAD_SHOULDER {
        return cliff_h;
    }
    let w = 1.0 - (d_road - HILL_ROAD_HALF_W) / HILL_ROAD_SHOULDER;
    cliff_h + (road_h - cliff_h) * w
}

pub fn hill_gradient(x: f64, z: f64) -> (f64, f64, f64) {
    let gx = (hill_ground_height(x + 1.0, z) - hill_ground_height(x - 1.0, z)) * 0.5;
    let gz = (hill_ground_height(x, z + 1.0) - hill_ground_height(x, z - 1.0)) * 0.5;
    (gx, gz, gx.hypot(gz))
}

/// Returns true if moving from `(x0, z0)` to `(x1, z1)` attempts to climb up an
/// insurmountable cliff face. Driving downhill off a cliff is always allowed so
/// karts slide cleanly to the valley floor.
pub fn hill_step_blocked(x0: f64, z0: f64, x1: f64, z1: f64) -> bool {
    let d = (x1 - x0).hypot(z1 - z0);
    if d <= 1e-9 {
        return false;
    }
    let steps = (d / 2.0).ceil().max(1.0) as usize;
    let mut px = x0;
    let mut pz = z0;
    let mut ph = hill_ground_height(px, pz);
    for i in 1..=steps {
        let u = i as f64 / steps as f64;
        let nx = x0 + (x1 - x0) * u;
        let nz = z0 + (z1 - z0) * u;
        let nh = hill_ground_height(nx, nz);
        if nh > ph + 1e-4 {
            let (_, _, s1) = hill_gradient(nx, nz);
            let (_, _, sm) = hill_gradient((px + nx) * 0.5, (pz + nz) * 0.5);
            if s1 > MAX_CLIMB_SLOPE || sm > MAX_CLIMB_SLOPE {
                return true;
            }
        }
        px = nx;
        pz = nz;
        ph = nh;
    }
    false
}

/// Downhill slide displacement `(dx, dz)` when a kart is on a steep cliff slope.
pub fn hill_slide_delta(x: f64, z: f64, dt: f64) -> (f64, f64) {
    let (gx, gz, slope) = hill_gradient(x, z);
    if slope <= MAX_CLIMB_SLOPE {
        return (0.0, 0.0);
    }
    let step = CLIFF_SLIDE_SPEED * dt;
    (-gx / slope * step, -gz / slope * step)
}

impl ArenaDef {
    pub fn valid(&self) -> bool {
        let name = self.name.trim();
        !name.is_empty()
            && name.encode_utf16().count() <= 48
            && self.desc.encode_utf16().count() <= 160
            && self.size.is_finite()
            && (16.0..=256.0).contains(&self.size)
            && matches!(self.shape.as_str(), "square" | "octagon" | "torus" | "hill")
            && self.max_players.is_none_or(|n| (2..=64).contains(&n))
            && valid_hex(&self.ground)
            && valid_hex(&self.wall)
            && valid_hex(&self.sky)
            && self.blocks.len() + self.water.len() <= 32
            && self
                .blocks
                .iter()
                .all(|b| b.iter().all(|n| n.is_finite()) && b[2] > 0.0 && b[3] > 0.0)
            && self
                .water
                .iter()
                .all(|b| b.iter().all(|n| n.is_finite()) && b[2] > 0.0 && b[3] > 0.0)
            && self.bridges.len() <= 16
            && self.bridges.iter().all(|b| {
                b.iter().all(|n| n.is_finite())
                    && b[2] > 0.0
                    && b[3] > 0.0
                    && (b[4] == 0.0 || b[4] == 1.0)
            })
            && (self.spawns.is_empty()
                || (self.spawns.len() == 8
                    && self
                        .spawns
                        .iter()
                        .all(|p| p.iter().all(|n| n.is_finite()) && !self.blocked(p[0], p[1], 4.0))))
    }
    pub fn is_octagon(&self) -> bool {
        self.shape == "octagon"
    }
    pub fn is_torus(&self) -> bool {
        self.shape == "torus"
    }
    pub fn is_hill(&self) -> bool {
        self.shape == "hill"
    }
    pub fn ground_height(&self, x: f64, z: f64) -> f64 {
        if !self.is_hill() {
            return 0.0;
        }
        hill_ground_height(x, z)
    }
    pub fn cliff_step_blocked(&self, x0: f64, z0: f64, x1: f64, z1: f64) -> bool {
        self.is_hill() && hill_step_blocked(x0, z0, x1, z1)
    }
    pub fn is_on_cliff(&self, x: f64, z: f64) -> bool {
        self.is_hill() && hill_gradient(x, z).2 > MAX_CLIMB_SLOPE
    }
    pub fn wrap(&self, x: f64, z: f64) -> (f64, f64) {
        if !self.is_torus() {
            return (x, z);
        }
        let span = self.size * 2.0;
        (
            (x + self.size).rem_euclid(span) - self.size,
            (z + self.size).rem_euclid(span) - self.size,
        )
    }
    pub fn spawn_radius(&self) -> f64 {
        if self.is_octagon() {
            self.size * 0.75
        } else {
            (self.size - 18.0).max(self.size * 0.65)
        }
    }
    pub fn spawn_points(&self) -> [[f64; 2]; 8] {
        if self.spawns.len() == 8 {
            return std::array::from_fn(|i| self.spawns[i]);
        }
        let radius = self.spawn_radius();
        std::array::from_fn(|i| {
            let a = i as f64 * std::f64::consts::FRAC_PI_4;
            [a.sin() * radius, a.cos() * radius]
        })
    }
    pub fn in_bounds(&self, x: f64, z: f64, padding: f64) -> bool {
        let limit = self.size - padding;
        x.abs() <= limit
            && z.abs() <= limit
            && (!self.is_octagon()
                || (x.abs() + z.abs()) * std::f64::consts::FRAC_1_SQRT_2 <= limit)
    }
    pub fn wall_blocked(&self, x: f64, z: f64, padding: f64) -> bool {
        if self.is_torus() {
            let (wx, wz) = self.wrap(x, z);
            return self.blocks.iter().any(|b| crate::block_overlaps(b, wx, wz, padding));
        }
        !self.in_bounds(x, z, padding)
            || self.blocks.iter().any(|b| crate::block_overlaps(b, x, z, padding))
    }
    pub fn blocked(&self, x: f64, z: f64, padding: f64) -> bool {
        self.wall_blocked(x, z, padding)
            || self.water.iter().any(|b| {
                (x - b[0]).abs() < b[2] / 2.0 + padding && (z - b[1]).abs() < b[3] / 2.0 + padding
            })
    }
}

pub fn default_arenas() -> Vec<ArenaDef> {
    vec![
        ArenaDef {
            name: "Scrapyard".into(),
            desc: "Container cover. Wide flanking lanes.".into(),
            size: 96.0,
            shape: "square".into(),
            max_players: None,
            ground: "#8b927d".into(),
            wall: "#d7794d".into(),
            sky: "#b5d3d9".into(),
            blocks: vec![
                [-40.0, -35.0, 34.0, 10.0],
                [40.0, 35.0, 34.0, 10.0],
                [-35.0, 35.0, 10.0, 34.0],
                [35.0, -35.0, 10.0, 34.0],
                [0.0, 0.0, 14.0, 14.0],
            ],
            water: vec![],
            bridges: vec![],
            spawns: vec![],
        },
        ArenaDef {
            name: "Crossfire Court".into(),
            desc: "A central fortress. Four ways around.".into(),
            size: 96.0,
            shape: "square".into(),
            max_players: None,
            ground: "#8e849b".into(),
            wall: "#8063b2".into(),
            sky: "#c8bbd8".into(),
            blocks: vec![
                [0.0, 0.0, 28.0, 28.0],
                [-55.0, 0.0, 12.0, 36.0],
                [55.0, 0.0, 12.0, 36.0],
                [0.0, -55.0, 36.0, 12.0],
                [0.0, 55.0, 36.0, 12.0],
            ],
            water: vec![],
            bridges: vec![],
            spawns: vec![],
        },
        ArenaDef {
            name: "Octagon".into(),
            desc: "Open eight-sided cage. No cover. Up to 4 players.".into(),
            size: 64.0,
            shape: "octagon".into(),
            max_players: Some(4),
            ground: "#8c8378".into(),
            wall: "#c74c48".into(),
            sky: "#d8cfc4".into(),
            blocks: vec![],
            water: vec![],
            bridges: vec![],
            spawns: vec![],
        },
    ]
}

pub fn default_arena(index: usize) -> Option<ArenaDef> {
    default_arenas().into_iter().nth(index)
}

/// Only the 3 built-in pack arenas (Scrapyard, Crossfire Court, Octagon) may omit
/// inline `arenaDef` in packets so existing native binaries always receive full
/// layout definitions for server-only maps in `dedicated-server/src/arenas.rs`.
pub fn is_default_arena(index: usize, def: &ArenaDef) -> bool {
    index < 3 && default_arena(index).as_ref() == Some(def)
}

#[cfg(test)]
pub(crate) static REGISTRY_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn registry() -> &'static RwLock<Vec<ArenaDef>> {
    static REGISTRY: OnceLock<RwLock<Vec<ArenaDef>>> = OnceLock::new();
    REGISTRY.get_or_init(|| RwLock::new(default_arenas()))
}

pub fn arena_defs() -> Vec<ArenaDef> {
    registry().read().unwrap().clone()
}

pub fn arena_count() -> usize {
    registry().read().unwrap().len()
}

pub fn arena_def(index: usize) -> Option<ArenaDef> {
    registry().read().unwrap().get(index).cloned()
}

pub fn set_arena_defs(defs: Vec<ArenaDef>) -> Result<(), &'static str> {
    if defs.is_empty() || defs.len() > MAX_ARENAS || defs.iter().any(|d| !d.valid()) {
        return Err("Invalid arena definitions");
    }
    *registry().write().unwrap() = defs;
    Ok(())
}

pub fn register_arena_def(index: usize, def: ArenaDef) -> Result<(), &'static str> {
    if index >= MAX_ARENAS || !def.valid() {
        return Err("Invalid arena definition");
    }
    let mut table = registry().write().unwrap();
    if index >= table.len() {
        let defaults = default_arenas();
        let fallback = defaults[0].clone();
        while table.len() <= index {
            let next = defaults
                .get(table.len())
                .cloned()
                .unwrap_or_else(|| fallback.clone());
            table.push(next);
        }
    }
    table[index] = def;
    Ok(())
}

fn with_arena<R>(index: usize, f: impl FnOnce(&ArenaDef) -> R) -> R {
    let table = registry().read().unwrap();
    let def = table.get(index).unwrap_or(&table[0]);
    f(def)
}

pub fn arena_size(arena: usize) -> f64 {
    with_arena(arena, |d| d.size)
}
pub fn arena_max_players(arena: usize) -> Option<usize> {
    with_arena(arena, |d| d.max_players)
}
pub fn arena_spawn_points(arena: usize) -> [[f64; 2]; 8] {
    with_arena(arena, ArenaDef::spawn_points)
}
pub fn in_bounds(arena: usize, x: f64, z: f64) -> bool {
    with_arena(arena, |d| d.in_bounds(x, z, 0.0))
}
pub fn wall_blocked(arena: usize, x: f64, z: f64, padding: f64) -> bool {
    with_arena(arena, |d| d.wall_blocked(x, z, padding))
}
pub fn blocked(arena: usize, x: f64, z: f64, padding: f64) -> bool {
    with_arena(arena, |d| d.blocked(x, z, padding))
}
pub fn wrap_point(arena: usize, x: f64, z: f64) -> (f64, f64) {
    with_arena(arena, |d| d.wrap(x, z))
}
pub fn torus_delta(arena: usize, dx: f64, dz: f64) -> (f64, f64) {
    with_arena(arena, |d| d.wrap(dx, dz))
}
pub fn is_hill_arena(arena: usize) -> bool {
    with_arena(arena, |d| d.is_hill())
}
pub fn ground_height(arena: usize, x: f64, z: f64) -> f64 {
    with_arena(arena, |d| d.ground_height(x, z))
}
pub fn cliff_step_blocked(arena: usize, x0: f64, z0: f64, x1: f64, z1: f64) -> bool {
    with_arena(arena, |d| d.cliff_step_blocked(x0, z0, x1, z1))
}
pub fn is_on_cliff(arena: usize, x: f64, z: f64) -> bool {
    with_arena(arena, |d| d.is_on_cliff(x, z))
}
pub fn is_torus_arena(arena: usize) -> bool {
    with_arena(arena, |d| d.is_torus())
}
