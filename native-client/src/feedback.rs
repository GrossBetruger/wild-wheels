//! Combat and match presentation. The server remains the authority for outcomes.
use crate::app::GameSession;
use bevy::{prelude::*, text::FontSize};

pub struct FeedbackPlugin;
impl Plugin for FeedbackPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<FeedbackState>()
            .add_systems(Startup, setup);
    }
}
#[derive(Component)]
pub struct MatchPanel;
#[derive(Component)]
pub struct MatchText;
#[derive(Component)]
pub struct DamageFlash;
#[derive(Resource, Default)]
pub struct FeedbackState {
    pieces: Vec<Entity>,
    phase: String,
    go_until: f32,
    health: Option<f64>,
    flash: f32,
}
#[derive(Resource)]
pub struct EffectAssets {
    sphere: Handle<Mesh>,
    debris: Handle<Mesh>,
    ring: Handle<Mesh>,
    fire: Handle<StandardMaterial>,
    ember: Handle<StandardMaterial>,
    smoke: Handle<StandardMaterial>,
}
fn setup(
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
) {
    commands.insert_resource(EffectAssets {
        sphere: meshes.add(Sphere::new(1.0).mesh().uv(10, 8)),
        debris: meshes.add(Cuboid::default()),
        ring: meshes.add(Torus::new(0.92, 1.0)),
        fire: materials.add(StandardMaterial {
            base_color: Color::srgb(1.0, 0.42, 0.03),
            emissive: LinearRgba::rgb(4.0, 1.0, 0.05),
            unlit: true,
            ..default()
        }),
        ember: materials.add(StandardMaterial {
            base_color: Color::srgb(1.0, 0.85, 0.25),
            emissive: LinearRgba::rgb(6.0, 3.0, 0.3),
            unlit: true,
            ..default()
        }),
        smoke: materials.add(Color::srgb(0.12, 0.13, 0.16)),
    });
    commands.spawn((
        Node {
            position_type: PositionType::Absolute,
            width: percent(100),
            height: percent(100),
            ..default()
        },
        BackgroundColor(Color::NONE),
        DamageFlash,
    ));
    let panel = commands
        .spawn((
            Node {
                position_type: PositionType::Absolute,
                left: percent(22),
                right: percent(22),
                top: percent(22),
                padding: UiRect::all(px(24)),
                display: Display::None,
                ..default()
            },
            BackgroundColor(Color::srgba(0.035, 0.025, 0.09, 0.86)),
            MatchPanel,
        ))
        .id();
    commands.spawn((
        Text::default(),
        TextFont {
            font_size: FontSize::Px(36.0),
            ..default()
        },
        TextColor(Color::WHITE),
        TextShadow::default(),
        MatchText,
        ChildOf(panel),
    ));
}

/// Priority rules keep AFK and death visible even while a match is underway.
fn notice(
    phase: &str,
    away: bool,
    destroyed: f64,
    countdown: f64,
    ending: bool,
    go: bool,
) -> Option<String> {
    if away {
        return Some("AFK\nYou are sitting out\nEscape to return\nThe arena keeps running".into());
    }
    match phase {
        "ready" => Some("READY TO RUMBLE?\nEnter to start the match".into()),
        "paused" => Some("PAUSED\nWaiting for the match to resume".into()),
        "countdown" => Some(format!("GET READY\n{}", countdown.ceil().max(1.0))),
        "finished" => Some("MATCH COMPLETE".into()),
        _ if ending => Some("MATCH OVER!\nOne last burst of mayhem...".into()),
        _ if destroyed > 0.0 => Some(format!(
            "WHACKED!\nBack in {}...",
            destroyed.ceil().max(1.0)
        )),
        "racing" if go => Some("GO!".into()),
        _ => None,
    }
}

pub fn sync_match(
    session: Res<GameSession>,
    time: Res<Time>,
    mut state: ResMut<FeedbackState>,
    mut panels: Query<&mut Node, With<MatchPanel>>,
    mut texts: Query<(&mut Text, &mut TextFont), With<MatchText>>,
    mut flashes: Query<&mut BackgroundColor, With<DamageFlash>>,
) {
    let now = time.elapsed_secs();
    let dt = time.delta_secs().min(0.1);
    let mut message = Some(session.status.clone());
    let mut countdown = false;
    match session.client.as_ref() {
        None => {
            state.health = None;
            state.phase.clear();
        }
        Some(client) => {
            let view = client.view();
            if view.phase == "racing" && state.phase == "countdown" {
                state.go_until = now + 1.2;
            }
            state.phase = view.phase.into();
            if state
                .health
                .is_some_and(|health| view.player.health < health)
            {
                state.flash = 0.35;
            }
            state.health = Some(view.player.health);
            message = notice(
                view.phase,
                session.away || view.player.afk,
                view.player.destroyed,
                view.countdown,
                view.finish_countdown.is_some(),
                now < state.go_until,
            );
            countdown = view.phase == "countdown";
            if view.phase == "finished" && !session.away && !view.player.afk {
                let winner = view
                    .winner
                    .and_then(|id| view.actors.get(id))
                    .and_then(|a| a.name.as_deref())
                    .unwrap_or("Winner");
                let mut racers: Vec<_> = view.actors.iter().filter(|a| !a.inactive).collect();
                racers.sort_by(|a, b| {
                    b.kills
                        .total_cmp(&a.kills)
                        .then_with(|| (Some(b.id) == view.winner).cmp(&(Some(a.id) == view.winner)))
                        .then(a.deaths.cmp(&b.deaths))
                        .then(a.id.cmp(&b.id))
                });
                let mut board = format!("MATCH COMPLETE\n{winner} wins!\n\n");
                for (rank, actor) in racers.iter().take(8).enumerate() {
                    board.push_str(&format!(
                        "{}. {}  {:.1} pts / {} deaths\n",
                        rank + 1,
                        actor.name.as_deref().unwrap_or("Racer"),
                        actor.kills,
                        actor.deaths
                    ));
                }
                board.push_str("\nEnter for another round");
                message = Some(board);
            }
        }
    }
    for mut panel in &mut panels {
        panel.display = match message {
            Some(_) => Display::Flex,
            None => Display::None,
        };
    }
    for (mut text, mut font) in &mut texts {
        text.0 = message.clone().unwrap_or_default();
        font.font_size = FontSize::Px(match countdown {
            true => 48.0 + (now * 7.0).sin() * 5.0,
            false => 30.0,
        });
    }
    state.flash = (state.flash - dt).max(0.0);
    for mut flash in &mut flashes {
        flash.0 = Color::srgba(0.95, 0.04, 0.02, state.flash * 0.7);
    }
}

pub fn sync_effects(
    mut commands: Commands,
    session: Res<GameSession>,
    assets: Res<EffectAssets>,
    mut state: ResMut<FeedbackState>,
) {
    let mut pieces = Vec::new();
    if let Some(client) = session.client.as_ref() {
        let view = client.view();
        if view.arena == 0 {
            for fx in view
                .effects
                .iter()
                .filter(|fx| matches!(fx.kind.as_str(), "explosion" | "hit" | "ash" | "abomb"))
                .take(16)
            {
                let age = fx.age as f32;
                let remaining = (1.0 - age / fx.life.max(0.01) as f32).clamp(0.0, 1.0);
                let origin = Vec3::new(fx.wx as f32, 1.3, fx.wz as f32);
                let size = match fx.kind.as_str() {
                    "hit" => 0.4,
                    "abomb" => 5.0,
                    _ => 1.0,
                };
                // Deterministic trajectories, independent of renderer frame rate.
                for i in 0..18 {
                    let angle = i as f32 * 2.399963;
                    let direction = Vec3::new(angle.sin(), 0.0, angle.cos());
                    let (mesh, material, position, scale) = match fx.kind.as_str() {
                        "ash" => {
                            let collapse = (age / 1.3).clamp(0.0, 1.0);
                            let p = Vec3::new(
                                (i % 3) as f32 - 1.0,
                                ((i / 3) % 3) as f32 * (1.0 - collapse) * 0.9 + 0.25,
                                (i / 9) as f32 * 1.8 - 0.9,
                            );
                            (
                                &assets.debris,
                                &assets.smoke,
                                Vec3::new(origin.x, 0.0, origin.z) + p,
                                Vec3::splat(0.65 * remaining.sqrt()),
                            )
                        }
                        _ if i < 8 => {
                            let p = origin
                                + direction * age * (6.0 + i as f32 * 0.5) * size
                                + Vec3::Y
                                    * (age * (5.0 + (i % 3) as f32) - 5.0 * age * age).max(-1.0);
                            (
                                &assets.debris,
                                &assets.ember,
                                p,
                                Vec3::splat(0.3 * remaining * size),
                            )
                        }
                        _ if age < 0.55 => (
                            &assets.sphere,
                            &assets.fire,
                            origin + direction * age * 5.0 * size,
                            Vec3::splat((0.5 + age * 2.5) * remaining * size),
                        ),
                        _ => (
                            &assets.sphere,
                            &assets.smoke,
                            origin + direction * (i % 4) as f32 * size + Vec3::Y * age * 3.0,
                            Vec3::splat((0.4 + age) * remaining * size),
                        ),
                    };
                    pieces.push((
                        mesh.clone(),
                        material.clone(),
                        Transform::from_translation(position)
                            .with_scale(scale)
                            .with_rotation(Quat::from_euler(
                                EulerRot::XYZ,
                                age * 3.0 + angle,
                                angle,
                                age * 2.0,
                            )),
                    ));
                }
                if fx.kind != "ash" && age < 0.7 {
                    pieces.push((
                        assets.ring.clone(),
                        assets.ember.clone(),
                        Transform::from_xyz(origin.x, 0.15, origin.z).with_scale(Vec3::new(
                            (1.0 + age * 12.0) * size,
                            (1.0 - age / 0.7) * 0.6,
                            (1.0 + age * 12.0) * size,
                        )),
                    ));
                }
            }
        }
    }
    // A bounded pool reuses entities and shared GPU assets across explosions.
    for (i, (mesh, material, transform)) in pieces.iter().enumerate() {
        let entity = match state.pieces.get(i) {
            Some(entity) => *entity,
            None => {
                let entity = commands.spawn_empty().id();
                state.pieces.push(entity);
                entity
            }
        };
        commands.entity(entity).insert((
            Mesh3d(mesh.clone()),
            MeshMaterial3d(material.clone()),
            *transform,
            Visibility::Inherited,
        ));
    }
    for entity in state.pieces.iter().skip(pieces.len()) {
        commands.entity(*entity).insert(Visibility::Hidden);
    }
}

#[cfg(test)]
mod tests {
    use super::notice;
    #[test]
    fn racer_sees_countdown_go_death_and_clear_play() {
        assert_eq!(
            notice("countdown", false, 0.0, 2.4, false, false).as_deref(),
            Some("GET READY\n3")
        );
        assert_eq!(
            notice("racing", false, 0.0, 0.0, false, true).as_deref(),
            Some("GO!")
        );
        assert_eq!(
            notice("racing", false, 2.1, 0.0, false, false).as_deref(),
            Some("WHACKED!\nBack in 3...")
        );
        assert_eq!(notice("racing", false, 0.0, 0.0, false, false), None);
    }
    #[test]
    fn afk_does_not_claim_the_shared_server_is_paused() {
        assert_eq!(
            notice("racing", true, 0.0, 0.0, false, false).as_deref(),
            Some("AFK\nYou are sitting out\nEscape to return\nThe arena keeps running")
        );
        assert_eq!(
            notice("racing", false, 0.0, 0.0, true, false).as_deref(),
            Some("MATCH OVER!\nOne last burst of mayhem...")
        );
    }
}
