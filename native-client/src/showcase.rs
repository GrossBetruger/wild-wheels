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
    label: &'static str,
    seconds: f32,
    racer: &'static str,
    overlay: Option<&'static str>,
    /// Transitions play once from their start; steady states loop.
    once: bool,
}
pub struct Scene {
    pub name: &'static str,
    driver: usize,
    steps: &'static [Step],
    /// Screenshots taken in the second cycle: label and seconds into the cycle.
    pub captures: &'static [(&'static str, f32)],
}
pub const SCENES: [Scene; 2] = [
    Scene {
        name: "boost",
        driver: 9,
        steps: &[
            Step {
                label: "idle",
                seconds: 2.0,
                racer: "idle",
                overlay: None,
                once: false,
            },
            Step {
                label: "boost in",
                seconds: 1.0,
                racer: "boost:in",
                overlay: None,
                once: true,
            },
            Step {
                label: "boost",
                seconds: 2.0,
                racer: "boost",
                overlay: None,
                once: false,
            },
            Step {
                label: "boost out",
                seconds: 1.0,
                racer: "boost:out",
                overlay: None,
                once: true,
            },
        ],
        captures: &[
            ("steady-a", 0.8),
            ("steady-b", 1.4),
            ("transition", 2.35),
            ("changed", 4.0),
        ],
    },
    Scene {
        name: "rapid-fire",
        driver: 14,
        steps: &[
            Step {
                label: "idle",
                seconds: 2.0,
                racer: "idle",
                overlay: None,
                once: false,
            },
            Step {
                label: "rapid fire in",
                seconds: 1.0,
                racer: "idle",
                overlay: Some("vulcan:in"),
                once: true,
            },
            Step {
                label: "rapid fire",
                seconds: 2.0,
                racer: "idle",
                overlay: Some("vulcan"),
                once: false,
            },
            Step {
                label: "rapid fire out",
                seconds: 1.0,
                racer: "idle",
                overlay: Some("vulcan:out"),
                once: true,
            },
        ],
        captures: &[
            ("steady-a", 0.8),
            ("steady-b", 1.4),
            ("transition", 2.3),
            ("changed", 4.0),
        ],
    },
];
/// Seconds shown idle first, while the first meshes are built.
const WARMUP: f32 = 2.0;

#[derive(Resource)]
struct Show {
    scene: &'static Scene,
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
    let scene = SCENES
        .iter()
        .find(|scene| scene.name == name)
        .ok_or_else(|| format!("Unknown showcase \"{name}\"; choose boost or rapid-fire"))?;
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

fn setup(mut commands: Commands, show: Res<Show>, graphics: Res<Graphics>) {
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
    let cycle: f32 = scene.steps.iter().map(|step| step.seconds).sum();
    let mut left = (seconds - WARMUP) % cycle;
    for step in scene.steps {
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
    let (step, into) = step_at(show.scene, time.elapsed_secs());
    let driver = show.scene.driver;
    let racer = graphics.clip(&format!("driver:{driver}:{}", step.racer));
    let layer = step
        .overlay
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
    let cycle: f32 = show.scene.steps.iter().map(|step| step.seconds).sum();
    let since = time.elapsed_secs() - WARMUP - cycle;
    // The window stays on top while capturing; it still has to be shown.
    let visible = windows.iter().any(|window| window.visible);
    for (label, at) in show.scene.captures {
        if since >= *at && visible && !show.taken.contains(label) {
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
    // Capture runs end once their screenshots have had a moment to save.
    let cycle: f32 = show.scene.steps.iter().map(|step| step.seconds).sum();
    let done = show.capture.is_some() && time.elapsed_secs() > WARMUP + 2.0 * cycle + 0.5;
    if keys.just_pressed(KeyCode::Escape) || done || time.elapsed_secs() > show.seconds {
        exit.write(AppExit::Success);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scenes_cycle_through_their_transitions_after_warming_up() {
        let boost = &SCENES[0];
        assert_eq!(step_at(boost, 1.0).0.label, "idle");
        assert_eq!(step_at(boost, WARMUP + 2.5).0.label, "boost in");
        let (step, into) = step_at(boost, WARMUP + 6.0 + 3.5);
        assert_eq!((step.label, (into * 10.0).round()), ("boost", 5.0));
        // Each capture lands inside the step it is meant to show.
        for scene in &SCENES {
            let cycle: f32 = scene.steps.iter().map(|step| step.seconds).sum();
            let label = |at: f32| step_at(scene, WARMUP + cycle + at).0.label;
            assert_eq!(label(scene.captures[0].1), "idle");
            assert_eq!(label(scene.captures[1].1), "idle");
            assert!(label(scene.captures[2].1).ends_with(" in"));
            assert_eq!(label(scene.captures[3].1), scene.steps[2].label);
        }
    }
}
