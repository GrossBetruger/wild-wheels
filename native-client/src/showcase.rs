//! `--showcase SCENE` plays one racer's ported animations in isolation, with no
//! server, cycling through a state change so its transition can be watched live.
//! B toggles blending between recorded frames; Escape quits. With `--capture DIR`
//! it saves screenshots at fixed moments for `tests/animations.rs`,
//! holding steady loops still so only the transition changes between them.
use crate::{
    config::Config,
    ported::{BLENDING, Graphics, Ported, PortedGraphicsPlugin},
    scene::FollowCamera,
};
use bevy::{
    app::AppExit,
    core_pipeline::tonemapping::Tonemapping,
    prelude::*,
    render::view::screenshot::{Screenshot, save_to_disk},
    text::FontSize,
};
use std::{error::Error, path::PathBuf, sync::atomic::Ordering};

/// One step of a scene's cycle: what the racer and the layer over it play.
struct Step {
    label: String,
    seconds: f32,
    racer: &'static str,
    overlay: Option<String>,
    /// Transitions play once from their start; steady states loop.
    once: bool,
}
impl Step {
    fn new(
        label: &str,
        seconds: f32,
        racer: &'static str,
        overlay: Option<&str>,
        once: bool,
    ) -> Self {
        Self {
            label: label.to_owned(),
            seconds,
            racer,
            overlay: overlay.map(str::to_owned),
            once,
        }
    }
}
/// A racer cycling through a steady state, a recorded transition, and the state
/// it leads to, usually followed by the way back.
pub struct Scene {
    driver: usize,
    steps: Vec<Step>,
}
/// Matches `ENDINGS` in scripts/build/graphics-port.mjs.
const FADES: [(&str, f32); 3] = [("shield", 1.0), ("hedge", 1.5), ("tehilim", 1.5)];
impl Scene {
    /// `boost:N`, `rapid-fire:N`, `fade:STATE:N` (shield, hedge or tehilim),
    /// `special-start:N` or `special-end:N`, for racer N; `boost` and
    /// `rapid-fire` alone show Pearococo and KnowItOwl.
    pub fn parse(name: &str) -> Option<Self> {
        let parts: Vec<&str> = name.split(':').collect();
        let racer = |text: &str| text.parse::<usize>().ok().filter(|driver| *driver < 15);
        let (kind, driver, state) = match parts.as_slice() {
            ["boost"] => ("boost", 9, None),
            ["rapid-fire"] => ("rapid-fire", 14, None),
            [kind, driver] => (*kind, racer(driver)?, None),
            ["fade", state, driver] => ("fade", racer(driver)?, Some(*state)),
            _ => return None,
        };
        let step = Step::new;
        let steps = match (kind, state) {
            ("boost", None) => vec![
                step("idle", 2.0, "idle", None, false),
                step("boost in", 1.0, "boost:in", None, true),
                step("boost", 2.0, "boost", None, false),
                step("boost out", 1.0, "boost:out", None, true),
            ],
            ("rapid-fire", None) => vec![
                step("idle", 2.0, "idle", None, false),
                step("rapid fire in", 1.0, "idle", Some("vulcan:in"), true),
                step("rapid fire", 2.0, "idle", Some("vulcan"), false),
                step("rapid fire out", 1.0, "idle", Some("vulcan:out"), true),
            ],
            ("fade", Some(state)) => {
                let (_, length) = FADES.iter().find(|(name, _)| *name == state)?;
                let end = format!("{state}:end");
                vec![
                    step(state, 2.0, "idle", Some(state), false),
                    step(
                        &format!("{state} fading"),
                        *length,
                        "idle",
                        Some(&end),
                        true,
                    ),
                    step("faded", 2.0, "idle", None, false),
                ]
            }
            ("special-start", None) => vec![
                step("idle", 2.0, "idle", None, false),
                step("special starting", 1.0, "idle", Some("special:start"), true),
                step("special", 2.0, "idle", Some("special"), false),
                step("special ending", 1.0, "idle", Some("special:end"), true),
            ],
            ("special-end", None) => vec![
                step("special", 2.0, "idle", Some("special"), false),
                step("special ending", 1.0, "idle", Some("special:end"), true),
                step("idle", 2.0, "idle", None, false),
                step("special starting", 1.0, "idle", Some("special:start"), true),
            ],
            _ => return None,
        };
        Some(Self { driver, steps })
    }
    fn cycle(&self) -> f32 {
        self.steps.iter().map(|step| step.seconds).sum()
    }
    /// Screenshots taken in the second cycle, by seconds into it: twice in the
    /// steady state, a third of the way into the transition, and after it.
    pub fn captures(&self) -> [(&'static str, f32); 4] {
        let (steady, transition) = (self.steps[0].seconds, self.steps[1].seconds);
        [
            ("steady-a", 0.8),
            ("steady-b", 1.4),
            ("transition", steady + 0.35 * transition),
            ("changed", steady + transition + 1.0),
        ]
    }
    /// The clip names the transition under test needs.
    fn required(&self) -> String {
        let step = &self.steps[1];
        match &step.overlay {
            Some(overlay) => format!("overlay:{}:{overlay}", self.driver),
            None => format!("driver:{}:{}", self.driver, step.racer),
        }
    }
}
/// Seconds shown idle first, while the first meshes are built.
const WARMUP: f32 = 2.0;

#[derive(Resource)]
struct Show {
    scene: Scene,
    capture: Option<PathBuf>,
    taken: Vec<&'static str>,
    seconds: f32,
}
#[derive(Component)]
struct Racer;
#[derive(Component)]
struct Layer;
#[derive(Component)]
struct Caption;

pub fn run(config: Config, name: &str) -> Result<(), Box<dyn Error>> {
    let scene = Scene::parse(name).ok_or_else(|| {
        format!("Unknown showcase \"{name}\"; try boost:9, rapid-fire:14, fade:hedge:0, special-start:11 or special-end:11")
    })?;
    let capturing = config.capture.is_some();
    App::new()
        .insert_resource(Show {
            scene,
            capture: config.capture.map(PathBuf::from),
            taken: Vec::new(),
            seconds: match config.timed {
                true => config.seconds as f32,
                false => f32::INFINITY,
            },
        })
        .insert_resource(ClearColor(Color::srgb_u8(0xe5, 0xde, 0xef)))
        .add_plugins(DefaultPlugins.set(WindowPlugin {
            primary_window: Some(Window {
                title: format!("Wild Wheels showcase: {name}"),
                resolution: (1000, 700).into(),
                // Covered windows capture as black on macOS; a capture run stays on top,
                // so it can be captured without taking focus from other work.
                window_level: match capturing {
                    true => bevy::window::WindowLevel::AlwaysOnTop,
                    false => bevy::window::WindowLevel::Normal,
                },
                ..default()
            }),
            ..default()
        }))
        .add_plugins(PortedGraphicsPlugin)
        .add_systems(Startup, setup)
        .add_systems(
            Update,
            (play, crate::ported::animate, capture, controls).chain(),
        )
        .run();
    Ok(())
}

fn setup(
    mut commands: Commands,
    show: Res<Show>,
    graphics: Res<Graphics>,
    mut exit: MessageWriter<AppExit>,
) {
    let required = show.scene.required();
    if graphics.clip(&required).is_none() {
        eprintln!("The graphics pack has no {required} clip to show.");
        exit.write(AppExit::from_code(2));
    }
    let tall = matches!(show.scene.driver, 11 | 12 | 14);
    let (eye, focus) = match tall {
        true => (Vec3::new(9.0, 9.5, 12.0), Vec3::Y * 4.0),
        false => (Vec3::new(7.5, 7.4, 9.5), Vec3::Y * 2.55),
    };
    commands.insert_resource(GlobalAmbientLight {
        brightness: 783.0,
        ..default()
    });
    commands.spawn((
        DirectionalLight {
            illuminance: 1920.0,
            ..default()
        },
        Transform::from_xyz(-50.0, 100.0, 30.0).looking_at(Vec3::ZERO, Vec3::Y),
    ));
    commands.spawn((
        Camera3d::default(),
        Tonemapping::None,
        Transform::from_translation(eye).looking_at(focus, Vec3::Y),
        FollowCamera,
    ));
    let tint = graphics
        .racers()
        .get(show.scene.driver)
        .map_or([255; 3], |racer| racer.color);
    commands.spawn((
        Transform::default(),
        Visibility::default(),
        Ported::new(None, tint, None),
        Racer,
    ));
    commands.spawn((
        Transform::default(),
        Visibility::default(),
        Ported::new(None, tint, None),
        Layer,
    ));
    commands.spawn((
        Text::default(),
        TextFont {
            font_size: FontSize::Px(20.0),
            ..default()
        },
        TextColor(Color::srgb(0.2, 0.16, 0.3)),
        Node {
            position_type: PositionType::Absolute,
            left: px(16),
            top: px(12),
            ..default()
        },
        Caption,
    ));
}

/// Where in its cycle a scene is: the step and seconds into it.
fn step_at(scene: &Scene, seconds: f32) -> (&Step, f32) {
    if seconds < WARMUP {
        return (&scene.steps[0], seconds);
    }
    let mut left = (seconds - WARMUP) % scene.cycle();
    for step in &scene.steps {
        if left < step.seconds {
            return (step, left);
        }
        left -= step.seconds;
    }
    (&scene.steps[0], 0.0)
}

fn play(
    show: Res<Show>,
    time: Res<Time>,
    graphics: Res<Graphics>,
    mut racers: Query<&mut Ported, (With<Racer>, Without<Layer>)>,
    mut layers: Query<&mut Ported, (With<Layer>, Without<Racer>)>,
    mut captions: Query<&mut Text, With<Caption>>,
) {
    let (step, into) = step_at(&show.scene, time.elapsed_secs());
    let driver = show.scene.driver;
    let racer = graphics.clip(&format!("driver:{driver}:{}", step.racer));
    let layer = step
        .overlay
        .as_ref()
        .and_then(|overlay| graphics.clip(&format!("overlay:{driver}:{overlay}")));
    // When capturing, steady loops hold still so screenshots differ only by the
    // transition under test; transitions always play.
    let held = show.capture.is_some().then_some(0.0);
    let at = |transition: bool| match transition {
        true => Some(into),
        false => held,
    };
    for mut player in &mut racers {
        (player.clip, player.time) = (racer, at(step.once && step.overlay.is_none()));
    }
    for mut player in &mut layers {
        (player.clip, player.time) = (layer, at(step.once));
    }
    let name = graphics
        .racers()
        .get(driver)
        .map_or("", |racer| racer.name.as_str());
    let blending = match BLENDING.load(Ordering::Relaxed) {
        true => "on",
        false => "off (24 recorded frames a second)",
    };
    for mut caption in &mut captions {
        caption.0 = format!(
            "{name}: {}  {into:.1}s\nBlending between recorded frames: {blending}\nB toggles blending   Esc quits",
            step.label
        );
    }
}

fn capture(
    mut commands: Commands,
    mut show: ResMut<Show>,
    time: Res<Time>,
    windows: Query<&Window>,
) {
    let Some(directory) = show.capture.clone() else {
        return;
    };
    let since = time.elapsed_secs() - WARMUP - show.scene.cycle();
    // The window stays on top while capturing; it still has to be shown.
    let visible = windows.iter().any(|window| window.visible);
    for (label, at) in show.scene.captures() {
        if since >= at && visible && !show.taken.contains(&label) {
            let path = directory.join(format!("{label}.png"));
            commands
                .spawn(Screenshot::primary_window())
                .observe(save_to_disk(path));
            show.taken.push(label);
        }
    }
}

fn controls(
    keys: Res<ButtonInput<KeyCode>>,
    show: Res<Show>,
    time: Res<Time>,
    mut exit: MessageWriter<AppExit>,
) {
    if keys.just_pressed(KeyCode::KeyB) {
        BLENDING.fetch_xor(true, Ordering::Relaxed);
    }
    // Capture runs end once their last screenshot has had a moment to save.
    let last = show.scene.captures()[3].1;
    let done =
        show.capture.is_some() && time.elapsed_secs() > WARMUP + show.scene.cycle() + last + 0.5;
    if keys.just_pressed(KeyCode::Escape) || done || time.elapsed_secs() > show.seconds {
        exit.write(AppExit::Success);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scenes_cycle_through_their_transitions_after_warming_up() {
        let boost = Scene::parse("boost").unwrap();
        assert_eq!(boost.driver, 9);
        assert_eq!(step_at(&boost, 1.0).0.label, "idle");
        assert_eq!(step_at(&boost, WARMUP + 2.5).0.label, "boost in");
        let (step, into) = step_at(&boost, WARMUP + 6.0 + 3.5);
        assert_eq!((step.label.as_str(), (into * 10.0).round()), ("boost", 5.0));
        // Each capture lands inside the step it is meant to show, for every kind.
        for name in [
            "boost:0",
            "rapid-fire:14",
            "fade:hedge:3",
            "fade:shield:9",
            "special-start:11",
            "special-end:11",
        ] {
            let scene = Scene::parse(name).unwrap();
            let label = |at: f32| step_at(&scene, WARMUP + scene.cycle() + at).0.label.clone();
            let [a, b, transition, changed] = scene.captures();
            assert_eq!(label(a.1), scene.steps[0].label, "{name}");
            assert_eq!(label(b.1), scene.steps[0].label, "{name}");
            assert_eq!(label(transition.1), scene.steps[1].label, "{name}");
            assert_eq!(label(changed.1), scene.steps[2].label, "{name}");
        }
        assert_eq!(
            Scene::parse("fade:hedge:3").unwrap().required(),
            "overlay:3:hedge:end"
        );
        assert!(Scene::parse("fade:dizzy:3").is_none());
        assert!(Scene::parse("boost:15").is_none());
    }
}
