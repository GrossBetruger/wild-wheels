//! Watches every ported animation transition play live, in isolation, and checks
//! that each one really runs. `cargo test` builds the client and opens a showcase
//! window for each, one at a time; the whole file takes about 14 minutes. Run part
//! of it by name, such as `cargo test --test animations boost_` or `fade_hedge_`.
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
        "wild-wheels-showcase-{}-{}",
        scene.replace(':', "-"),
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

/// A state change must be clearly visible and its transition must have begun to
/// change the picture. An eased transition, where the browser moves gradually
/// between the states, must also look unlike the state it leads to.
fn check_transition(scene: &str, eased: bool) {
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

/// One test per recorded transition: `name: "scene", eased;`.
macro_rules! animations {
    ($($name:ident: $scene:literal, $eased:literal;)*) => {
        $(
            #[test]
            fn $name() {
                check_transition($scene, $eased);
            }
        )*
    };
}

animations! {
    // Boosting in and out: Pip stands for the racers whose boost simply switches on;
    // the rest ease in: Pearococo's tail folds, Master-Yuda's stunts, R-yeah's rotors
    // tilt, Fourmidable's receipts spring out, KnowItOwl takes off.
    boost_00_pip: "boost:0", false;
    boost_09_pearococo: "boost:9", true;
    boost_10_master_yuda: "boost:10", true;
    boost_11_r_yeah: "boost:11", true;
    boost_13_fourmidable: "boost:13", true;
    boost_14_knowitowl: "boost:14", true;
    // Rapid fire starting. Eased: KnowItOwl's bat flies in, and away again after.
    rapid_fire_00_pip: "rapid-fire:0", false;
    rapid_fire_01_rocco: "rapid-fire:1", false;
    rapid_fire_02_felix: "rapid-fire:2", false;
    rapid_fire_03_benny: "rapid-fire:3", false;
    rapid_fire_04_ellie: "rapid-fire:4", false;
    rapid_fire_05_tammy: "rapid-fire:5", false;
    rapid_fire_06_elon: "rapid-fire:6", false;
    rapid_fire_07_houston: "rapid-fire:7", false;
    rapid_fire_08_avita_jas: "rapid-fire:8", false;
    rapid_fire_09_pearococo: "rapid-fire:9", false;
    rapid_fire_10_master_yuda: "rapid-fire:10", false;
    rapid_fire_11_r_yeah: "rapid-fire:11", false;
    rapid_fire_12_catheterpillar: "rapid-fire:12", false;
    rapid_fire_13_fourmidable: "rapid-fire:13", false;
    rapid_fire_14_knowitowl: "rapid-fire:14", true;
    // Timed states fading as they run out. Hedgeguard and tehilim dim for everyone.
    // A shield fades only for Pearococo's fairies and Master-Yuda's badges; Pip
    // stands for the racers whose shield simply ends.
    fade_shield_00_pip: "fade:shield:0", false;
    fade_shield_09_pearococo: "fade:shield:9", true;
    fade_shield_10_master_yuda: "fade:shield:10", true;
    fade_hedge_00_pip: "fade:hedge:0", true;
    fade_hedge_01_rocco: "fade:hedge:1", true;
    fade_hedge_02_felix: "fade:hedge:2", true;
    fade_hedge_03_benny: "fade:hedge:3", true;
    fade_hedge_04_ellie: "fade:hedge:4", true;
    fade_hedge_05_tammy: "fade:hedge:5", true;
    fade_hedge_06_elon: "fade:hedge:6", true;
    fade_hedge_07_houston: "fade:hedge:7", true;
    fade_hedge_08_avita_jas: "fade:hedge:8", true;
    fade_hedge_09_pearococo: "fade:hedge:9", true;
    fade_hedge_10_master_yuda: "fade:hedge:10", true;
    fade_hedge_11_r_yeah: "fade:hedge:11", true;
    fade_hedge_12_catheterpillar: "fade:hedge:12", true;
    fade_hedge_13_fourmidable: "fade:hedge:13", true;
    fade_hedge_14_knowitowl: "fade:hedge:14", true;
    fade_tehilim_00_pip: "fade:tehilim:0", true;
    fade_tehilim_01_rocco: "fade:tehilim:1", true;
    fade_tehilim_02_felix: "fade:tehilim:2", true;
    fade_tehilim_03_benny: "fade:tehilim:3", true;
    fade_tehilim_04_ellie: "fade:tehilim:4", true;
    fade_tehilim_05_tammy: "fade:tehilim:5", true;
    fade_tehilim_06_elon: "fade:tehilim:6", true;
    fade_tehilim_07_houston: "fade:tehilim:7", true;
    fade_tehilim_08_avita_jas: "fade:tehilim:8", true;
    fade_tehilim_09_pearococo: "fade:tehilim:9", true;
    fade_tehilim_10_master_yuda: "fade:tehilim:10", true;
    fade_tehilim_11_r_yeah: "fade:tehilim:11", true;
    fade_tehilim_12_catheterpillar: "fade:tehilim:12", true;
    fade_tehilim_13_fourmidable: "fade:tehilim:13", true;
    fade_tehilim_14_knowitowl: "fade:tehilim:14", true;
    // R-yeah's archangels descending and rising.
    special_start_11_r_yeah: "special-start:11", true;
    special_end_11_r_yeah: "special-end:11", true;
}
