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

#[derive(Resource)]
pub struct Bench {
    /// Seconds to measure after the warm-up; `None` when not benchmarking.
    pub seconds: Option<f64>,
    started: Instant,
    last: Instant,
    frame: Instant,
    stage_seconds: [f64; STAGES.len()],
    frames: Vec<f32>,
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
    }
    bench.frame = now;
    bench.last = now;
}
/// Charges the time since the previous mark to one stage.
pub fn mark(stage: usize) -> impl FnMut(ResMut<Bench>) {
    move |mut bench: ResMut<Bench>| {
        let now = Instant::now();
        if bench.measuring() {
            bench.stage_seconds[stage] += now.duration_since(bench.last).as_secs_f64();
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
    exit.write(AppExit::Success);
}
