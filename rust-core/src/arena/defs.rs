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

impl ArenaDef {
    pub fn valid(&self) -> bool {
        let name = self.name.trim();
        !name.is_empty()
            && name.encode_utf16().count() <= 48
            && self.desc.encode_utf16().count() <= 160
            && self.size.is_finite()
            && (16.0..=256.0).contains(&self.size)
            && matches!(self.shape.as_str(), "square" | "octagon")
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
        !self.in_bounds(x, z, padding)
            || self.blocks.iter().any(|b| {
                (x - b[0]).abs() < b[2] / 2.0 + padding && (z - b[1]).abs() < b[3] / 2.0 + padding
            })
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
