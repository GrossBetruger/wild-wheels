//! Developer frame-time benchmark: `--benchmark SECONDS` runs a match unattended
//! with vertical sync off, then prints where each frame's time went.
use bevy::{app::AppExit, prelude::*};
use std::{
    sync::atomic::{AtomicU64, Ordering},
    time::Instant,
};

/// The stages of one frame's game logic, in the order they run.
pub const STAGES: [&str; 9] = [
    "menus",
    "network+prediction",
    "scene",
    "preview",
    "clips+particles",
    "sound",
    "messages",
    "menu layout",
    "hud",
];
/// Frames before this many seconds are warm-up and are not counted.
const WARMUP: f64 = 5.0;
/// Meshes built from the graphics pack, and the time that took, since launch.
pub static MESHES_BUILT: AtomicU64 = AtomicU64::new(0);
pub static MESH_BUILD_NANOS: AtomicU64 = AtomicU64::new(0);
pub static SPRITE_MESHES: AtomicU64 = AtomicU64::new(0);
/// What the scene showed last frame, for explaining slow frames.
pub static PROJECTILES: AtomicU64 = AtomicU64::new(0);
pub static EFFECTS: AtomicU64 = AtomicU64::new(0);
pub static SPAWNED: AtomicU64 = AtomicU64::new(0);
pub static DESPAWNED: AtomicU64 = AtomicU64::new(0);

/// One measured frame: its time, the logic stages' share, and what happened in it.
#[derive(Clone, Copy, Default)]
struct Frame {
    seconds: f32,
    logic: f32,
    stages: [f32; STAGES.len()],
    built: u64,
    spawned: u64,
    despawned: u64,
    projectiles: u64,
    effects: u64,
}

#[derive(Resource)]
pub struct Bench {
    /// Seconds to measure after the warm-up; `None` when not benchmarking.
    pub seconds: Option<f64>,
    started: Instant,
    last: Instant,
    frame: Instant,
    stage_seconds: [f64; STAGES.len()],
    frames: Vec<f32>,
    details: Vec<Frame>,
    current: Frame,
    counted: (u64, u64, u64),
    baseline: (u64, u64, u64),
}
impl Bench {
    pub fn new(seconds: Option<f64>) -> Self {
        let now = Instant::now();
        Self {
            seconds,
            started: now,
            last: now,
            frame: now,
            stage_seconds: [0.0; STAGES.len()],
            frames: Vec::new(),
            details: Vec::new(),
            current: Frame::default(),
            counted: (0, 0, 0),
            baseline: (0, 0, 0),
        }
    }
    fn measuring(&self) -> bool {
        self.seconds.is_some() && self.started.elapsed().as_secs_f64() >= WARMUP
    }
}
fn counters() -> (u64, u64, u64) {
    (
        MESHES_BUILT.load(Ordering::Relaxed),
        MESH_BUILD_NANOS.load(Ordering::Relaxed),
        SPRITE_MESHES.load(Ordering::Relaxed),
    )
}
/// Marks the start of a frame's game logic.
pub fn begin(mut bench: ResMut<Bench>) {
    let now = Instant::now();
    if bench.measuring() {
        if bench.frames.is_empty() {
            bench.baseline = counters();
        }
        let frame = now.duration_since(bench.frame).as_secs_f32();
        bench.frames.push(frame);
        let counts = (
            MESHES_BUILT.load(Ordering::Relaxed),
            SPAWNED.load(Ordering::Relaxed),
            DESPAWNED.load(Ordering::Relaxed),
        );
        let mut detail = bench.current;
        detail.seconds = frame;
        detail.logic = detail.stages.iter().sum();
        detail.built = counts.0 - bench.counted.0;
        detail.spawned = counts.1 - bench.counted.1;
        detail.despawned = counts.2 - bench.counted.2;
        detail.projectiles = PROJECTILES.load(Ordering::Relaxed);
        detail.effects = EFFECTS.load(Ordering::Relaxed);
        bench.details.push(detail);
        bench.counted = counts;
    }
    bench.current = Frame::default();
    bench.frame = now;
    bench.last = now;
}
/// Charges the time since the previous mark to one stage.
pub fn mark(stage: usize) -> impl FnMut(ResMut<Bench>) {
    move |mut bench: ResMut<Bench>| {
        let now = Instant::now();
        if bench.measuring() {
            let spent = now.duration_since(bench.last).as_secs_f64();
            bench.stage_seconds[stage] += spent;
            bench.current.stages[stage] += spent as f32;
        }
        bench.last = now;
    }
}
pub fn finish(
    bench: Res<Bench>,
    entities: Query<Entity>,
    meshes: Query<&Mesh3d>,
    mesh_assets: Res<Assets<Mesh>>,
    mut exit: MessageWriter<AppExit>,
) {
    let Some(seconds) = bench.seconds else {
        return;
    };
    if bench.started.elapsed().as_secs_f64() < WARMUP + seconds || bench.frames.len() < 2 {
        return;
    }
    let mut frames = bench.frames[1..].to_vec();
    frames.sort_by(f32::total_cmp);
    let count = frames.len() as f64;
    let at = |fraction: f64| f64::from(frames[((count - 1.0) * fraction) as usize]) * 1000.0;
    let mean = frames.iter().map(|f| f64::from(*f)).sum::<f64>() / count * 1000.0;
    let stages: serde_json::Map<_, _> = STAGES
        .iter()
        .zip(bench.stage_seconds)
        .map(|(name, total)| ((*name).to_owned(), (total / count * 1000.0).into()))
        .collect();
    let logic: f64 = bench.stage_seconds.iter().sum::<f64>() / count * 1000.0;
    let (built, nanos, sprites) = counters();
    println!(
        "{}",
        serde_json::json!({
            "event": "benchmark",
            "frames": frames.len(),
            "fps": 1000.0 / mean,
            "frameMs": {"mean": mean, "p50": at(0.5), "p95": at(0.95), "p99": at(0.99), "max": at(1.0)},
            "logicMs": logic,
            "renderAndWaitMs": mean - logic,
            "stagesMs": stages,
            "entities": entities.iter().count(),
            "meshEntities": meshes.iter().count(),
            "meshAssets": mesh_assets.len(),
            "meshesBuiltPerSecond": (built - bench.baseline.0) as f64 / seconds,
            "meshBuildMsPerFrame": (nanos - bench.baseline.1) as f64 / 1e6 / count,
            "spriteMeshesPerFrame": (sprites - bench.baseline.2) as f64 / count,
        })
    );
    // The slowest frames, with what the scene was doing in the frame before.
    let mut slow: Vec<(usize, Frame)> = bench.details.iter().copied().enumerate().skip(1).collect();
    slow.sort_by(|a, b| b.1.seconds.total_cmp(&a.1.seconds));
    for (index, frame) in slow.iter().take(25) {
        let previous = bench.details[index - 1];
        let stage = STAGES
            .iter()
            .zip(frame.stages)
            .max_by(|a, b| a.1.total_cmp(&b.1))
            .map_or("", |(name, _)| name);
        println!(
            "{}",
            serde_json::json!({
                "event": "slow-frame",
                "ms": frame.seconds * 1000.0,
                "logicMs": frame.logic * 1000.0,
                "slowestStage": stage,
                "slowestStageMs": frame.stages.iter().copied().fold(0.0, f32::max) * 1000.0,
                "meshesBuilt": frame.built,
                "spawned": previous.spawned,
                "despawned": previous.despawned,
                "projectiles": frame.projectiles,
                "effects": frame.effects,
            })
        );
    }
    // Mean frame time by how many projectiles were in flight.
    let mut buckets = std::collections::BTreeMap::<u64, (f64, u32, f32)>::new();
    for frame in &bench.details[1..] {
        let bucket = buckets.entry(frame.projectiles.min(12)).or_default();
        bucket.0 += f64::from(frame.seconds);
        bucket.1 += 1;
        bucket.2 = bucket.2.max(frame.seconds);
    }
    for (projectiles, (total, count, max)) in buckets {
        println!(
            "{}",
            serde_json::json!({
                "event": "by-projectiles",
                "projectiles": projectiles,
                "frames": count,
                "meanMs": total / f64::from(count) * 1000.0,
                "maxMs": max * 1000.0,
            })
        );
    }
    exit.write(AppExit::Success);
}
