//! Watches two ported animations play live, in isolation, and checks that each
//! one's transition really runs. `cargo test` builds the client and opens its
//! showcase window for each; keep the window visible while they run.
//!
//! The showcase cycles a racer through a state change with no server and saves
//! screenshots at fixed moments, holding steady loops still so only the transition
//! changes between them. Screenshots of covered windows come back black on macOS;
//! the showcase window stays on top while capturing, and this runs only there.
#![cfg(target_os = "macos")]

use std::{
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::Mutex,
    thread::sleep,
    time::{Duration, Instant},
};

/// Showcases run one at a time: each window needs to be in front.
static WINDOW: Mutex<()> = Mutex::new(());

/// Runs one showcase in a visible window and returns its screenshot directory.
fn showcase(scene: &str) -> PathBuf {
    let directory = std::env::temp_dir().join(format!(
        "wild-wheels-showcase-{scene}-{}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&directory);
    std::fs::create_dir_all(&directory).expect("screenshot directory");
    let mut child = Command::new(env!("CARGO_BIN_EXE_wild-wheels-native"))
        .args(["--showcase", scene, "--capture"])
        .arg(&directory)
        .args(["--seconds", "60"])
        .env("WILD_WHEELS_NATIVE_DATA_DIR", &directory)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("the native client starts");
    let deadline = Instant::now() + Duration::from_secs(90);
    loop {
        if let Some(status) = child.try_wait().expect("the showcase runs") {
            assert!(status.success(), "{scene} showcase failed: {status}");
            break;
        }
        assert!(Instant::now() < deadline, "{scene} showcase did not finish");
        sleep(Duration::from_millis(1500));
    }
    directory
}

/// Width, height and RGB pixels of a screenshot.
fn pixels(file: &Path) -> (u32, u32, Vec<[u8; 3]>) {
    let bytes = std::fs::read(file)
        .unwrap_or_else(|_| panic!("no {} screenshot; was the window covered?", file.display()));
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
    // The showcase's sky is light; an all-dark capture means the window was hidden.
    let dark = rgb.iter().filter(|p| p.iter().all(|c| *c < 24)).count();
    assert!(
        dark < rgb.len() / 2,
        "{} is blank; the showcase window was hidden when it was captured",
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

/// A state change must be clearly visible, and its transition must look like
/// neither the starting nor the final state.
fn check_transition(scene: &str) {
    let _window = WINDOW
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
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
    assert!(
        change > (3.0 * noise).max(0.003),
        "{scene}: the state change is not visible ({change} against noise {noise})"
    );
    assert!(
        from_start > (1.5 * noise).max(0.002),
        "{scene}: the transition looks like the starting state"
    );
    assert!(
        to_end > (1.5 * noise).max(0.002),
        "{scene}: the transition looks like the final state"
    );
}

#[test]
fn pearococo_boosts_in_and_out_through_her_tail_folding() {
    check_transition("boost");
}

#[test]
fn knowitowls_bat_flies_in_and_away_with_rapid_fire() {
    check_transition("rapid-fire");
}
