//! Plays every ported animation transition in isolation and checks that each one
//! really runs. `cargo test` builds the client and runs a showcase for each, one
//! at a time and offscreen, so nothing appears on the screen; the whole file takes
//! about 6 minutes. Run part of it by name, such as
//! `cargo test --test animations knowitowl`. To watch one live, run the client
//! with `--showcase SCENE`.
//!
//! The showcase cycles a racer through a state change with no server and saves
//! screenshots at fixed moments, holding steady loops still so only the transition
//! changes between them. It runs only on macOS, where it was written.
#![cfg(target_os = "macos")]

use std::{
    collections::BTreeSet,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Condvar, Mutex},
    thread::sleep,
    time::{Duration, Instant},
};

/// Showcases run one at a time, most interesting first. Tests start in name order,
/// and their names begin with their rank, so the lowest-ranked waiting test goes
/// next; this holds when only some tests are selected by name.
struct Queue {
    waiting: BTreeSet<u32>,
    busy: bool,
}
static QUEUE: Mutex<Queue> = Mutex::new(Queue {
    waiting: BTreeSet::new(),
    busy: false,
});
static NEXT: Condvar = Condvar::new();
struct Turn;
fn take_turn(rank: u32) -> Turn {
    let mut queue = QUEUE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    queue.waiting.insert(rank);
    while queue.busy || queue.waiting.first() != Some(&rank) {
        queue = NEXT
            .wait(queue)
            .unwrap_or_else(|poisoned| poisoned.into_inner());
    }
    queue.waiting.remove(&rank);
    queue.busy = true;
    Turn
}
impl Drop for Turn {
    fn drop(&mut self) {
        QUEUE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .busy = false;
        NEXT.notify_all();
    }
}

/// Runs one showcase offscreen and returns its screenshot directory.
fn showcase(scene: &str) -> PathBuf {
    let directory = std::env::temp_dir().join(format!(
        "wild-wheels-showcase-{}-{}",
        scene.replace(':', "-"),
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&directory);
    std::fs::create_dir_all(&directory).expect("screenshot directory");
    let mut child = Command::new(env!("CARGO_BIN_EXE_wild-wheels-native"))
        .args(["--showcase", scene, "--offscreen", "--capture"])
        .arg(&directory)
        .args(["--seconds", "60"])
        .env("WILD_WHEELS_NATIVE_DATA_DIR", &directory)
        .stdout(Stdio::null())
        .stderr(std::fs::File::create(directory.join("errors.log")).expect("error log"))
        .spawn()
        .expect("the native client starts");
    let deadline = Instant::now() + Duration::from_secs(90);
    loop {
        if let Some(status) = child.try_wait().expect("the showcase runs") {
            let errors = std::fs::read_to_string(directory.join("errors.log")).unwrap_or_default();
            let reason = errors
                .lines()
                .rfind(|line| !line.contains(" INFO "))
                .unwrap_or("");
            assert!(
                status.success(),
                "{scene} showcase failed ({status}): {reason}"
            );
            break;
        }
        assert!(Instant::now() < deadline, "{scene} showcase did not finish");
        sleep(Duration::from_millis(1500));
    }
    directory
}

/// Width, height and RGB pixels of a screenshot.
fn pixels(file: &Path) -> (u32, u32, Vec<[u8; 3]>) {
    let bytes = std::fs::read(file).unwrap_or_else(|_| panic!("no {} screenshot", file.display()));
    let mut reader = png::Decoder::new(std::io::Cursor::new(bytes))
        .read_info()
        .expect("a PNG screenshot");
    let mut buffer = vec![0; reader.output_buffer_size().expect("image size")];
    let info = reader.next_frame(&mut buffer).expect("screenshot pixels");
    assert_eq!(info.bit_depth, png::BitDepth::Eight, "8-bit screenshot");
    let channels = info.color_type.samples();
    let rgb = buffer[..info.buffer_size()]
        .chunks_exact(channels)
        .map(|pixel| [pixel[0], pixel[1], pixel[2]])
        .collect::<Vec<_>>();
    // The showcase's sky is light; an all-dark capture means nothing was drawn.
    let dark = rgb.iter().filter(|p| p.iter().all(|c| *c < 24)).count();
    assert!(
        dark < rgb.len() / 2,
        "{} is blank; the showcase drew nothing",
        file.display()
    );
    (info.width, info.height, rgb)
}

/// The share of pixels whose color changed noticeably between two screenshots.
fn difference(a: &Path, b: &Path) -> f64 {
    let (first, second) = (pixels(a), pixels(b));
    assert_eq!((first.0, first.1), (second.0, second.1), "screenshot sizes");
    let changed = first
        .2
        .iter()
        .zip(&second.2)
        .filter(|(x, y)| {
            x.iter()
                .zip(y.iter())
                .map(|(p, q)| p.abs_diff(*q) as u32)
                .sum::<u32>()
                > 36
        })
        .count();
    changed as f64 / first.2.len() as f64
}

/// A state change must be clearly visible and its transition must have begun to
/// change the picture. An eased transition, where the browser moves gradually
/// between the states, must also look unlike the state it leads to.
fn check_transition(rank: u32, scene: &str, eased: bool) {
    let _turn = take_turn(rank);
    let directory = showcase(scene);
    let shot = |label: &str| directory.join(format!("{label}.png"));
    let noise = difference(&shot("steady-a"), &shot("steady-b"));
    let change = difference(&shot("steady-a"), &shot("changed"));
    let from_start = difference(&shot("steady-a"), &shot("transition"));
    let to_end = difference(&shot("transition"), &shot("changed"));
    println!(
        "{scene}: noise {noise:.4}, change {change:.4}, transition from start {from_start:.4}, to end {to_end:.4}"
    );
    let _ = std::fs::remove_dir_all(&directory);
    // Noise is the caption's timer; small effects such as a shield's sparks cover
    // only a fraction of a percent of the window.
    assert!(
        change > (3.0 * noise).max(0.001),
        "{scene}: the state change is not visible ({change} against noise {noise})"
    );
    assert!(
        from_start > (1.5 * noise).max(0.0005),
        "{scene}: the transition looks like the starting state"
    );
    assert!(
        !eased || to_end > (1.5 * noise).max(0.0005),
        "{scene}: the transition looks like the final state, without easing"
    );
}

/// One test per transition worth watching: `name: rank, "scene", eased;`.
macro_rules! animations {
    ($($name:ident: $rank:literal, $scene:literal, $eased:literal;)*) => {
        $(
            #[test]
            fn $name() {
                check_transition($rank, $scene, $eased);
            }
        )*
    };
}

// Racers that draw a transition through the same browser code, differing only in
// color, share one test. The most interesting run first.
animations! {
    // Native only: Pearococo's tail sways, then swings behind turns.
    t00_pearococo_tail_sways_and_swings: 0, "plumage", true;
    // Eased: the browser moves gradually between the states.
    t01_knowitowl_bat_flies_in: 1, "rapid-fire:14", true;
    t02_knowitowl_takes_off: 2, "boost:14", true;
    t03_r_yeah_archangels_descend: 3, "special-start:11", true;
    t04_r_yeah_archangels_rise: 4, "special-end:11", true;
    t05_pearococo_tail_folds: 5, "boost:9", true;
    t06_r_yeah_rotors_tilt: 6, "boost:11", true;
    t07_master_yuda_boost_stunt: 7, "boost:10", true;
    t08_fourmidable_receipts_spring_out: 8, "boost:13", true;
    t09_houston_helmet_flies_off: 9, "rapid-fire:7", true;
    // Distinct rapid-fire weapons.
    t10_r_yeah_chopper_gun: 10, "rapid-fire:11", false;
    t11_master_yuda_laser_mount: 11, "rapid-fire:10", false;
    // Fades as states run out.
    t12_pearococo_fairy_shield_fades: 12, "fade:shield:9", true;
    t13_master_yuda_badge_shield_fades: 13, "fade:shield:10", true;
    t14_pearococo_hedgeguard_fades: 14, "fade:hedge:9", true;
    t15_master_yuda_hedgeguard_fades: 15, "fade:hedge:10", true;
    t16_tammy_cricket_hedgeguard_fades: 16, "fade:hedge:5", true;
    t17_elon_dollar_hedgeguard_fades: 17, "fade:hedge:6", true;
    t18_hedgeguard_fades: 18, "fade:hedge:0", true;
    t19_tehilim_fades: 19, "fade:tehilim:0", true;
    // Plain: the browser switches these at once; Pip stands for every such racer.
    t20_plain_boost: 20, "boost:0", false;
    t21_plain_rapid_fire: 21, "rapid-fire:0", false;
    t22_plain_shield_ends: 22, "fade:shield:0", false;
}
