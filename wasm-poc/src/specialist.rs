//! Shared playback for riders whose full-body actions blend as a single layer.
use crate::{app::GameSession, preview::Preview};
use bevy::animation::{AnimatedBy, AnimationTargetId, graph::AnimationNodeIndex};
use bevy::{gltf::Gltf, prelude::*};
use std::collections::HashMap;

pub fn separate_vehicle(driver: usize) -> bool {
    matches!(driver, 5 | 12 | 13)
}

#[derive(Component)]
pub struct Rider {
    id: usize,
    driver: usize,
    player: Option<Entity>,
    blend: [f32; 7],
    boosting: bool,
    hat_age: f32,
}

impl Rider {
    pub fn new(id: usize, driver: usize) -> Self {
        Self {
            id,
            driver,
            player: None,
            blend: [1., 0., 0., 0., 0., 0., 0.],
            boosting: false,
            hat_age: f32::INFINITY,
        }
    }
}

#[derive(Default)]
pub struct RigAssets {
    models: HashMap<usize, Handle<Gltf>>,
    graphs: HashMap<usize, (Handle<AnimationGraph>, Vec<AnimationNodeIndex>)>,
}

pub fn animate(
    mut commands: Commands,
    server: Res<AssetServer>,
    models: Res<Assets<Gltf>>,
    mut graphs: ResMut<Assets<AnimationGraph>>,
    mut cache: Local<RigAssets>,
    mut riders: Query<(Entity, &mut Rider)>,
    family: Query<&Children>,
    targets: Query<Option<&AnimatedBy>, With<AnimationTargetId>>,
    mut players: Query<&mut AnimationPlayer>,
    time: Res<Time>,
    session: Res<GameSession>,
    preview: Res<Preview>,
) {
    let Some(client) = session.client.as_ref() else {
        return;
    };
    let view = preview.on_stage(client.view());
    for (root, mut rider) in &mut riders {
        let Some(actor) = view.actors.iter().find(|a| {
            a.id == rider.id
                && a.driver == rider.driver
                && !a.inactive
                && !a.afk
                && !a.bomber
                && a.destroyed <= 0.
        }) else {
            continue;
        };
        let driver = rider.driver;
        if !cache.graphs.contains_key(&driver) {
            let path = match driver {
                7 => "houston_pilot.glb",
                _ => {
                    crate::BLENDER_MODELS
                        .iter()
                        .find(|(d, _)| *d == driver)
                        .unwrap()
                        .1
                }
            };
            let handle = cache
                .models
                .entry(driver)
                .or_insert_with(|| server.load(path));
            let Some(model) = models.get(&*handle) else {
                continue;
            };
            let mut graph = AnimationGraph::new();
            let names: &[&str] = match driver {
                12 | 13 => &["cruise","boost","special","wave"],
                15 => &["cruise", "boost", "special", "turn_l", "turn_r", "bow", "drift"],
                _ => &["cruise", "boost", "special"],
            };
            let Some(nodes) = names.iter().map(|name| {
                let clip = model.named_animations.get(*name)?;
                Some(graph.add_clip(clip.clone(), 1., graph.root))
            }).collect::<Option<Vec<_>>>() else { continue };
            cache.graphs.insert(driver, (graphs.add(graph), nodes));
        }
        let (graph, nodes) = &cache.graphs[&driver];
        if rider.player.is_none() {
            let Some(player) = family.iter_descendants(root).find(|e| players.contains(*e)) else {
                continue;
            };
            for bone in family.iter_descendants(root) {
                if targets
                    .get(bone)
                    .is_ok_and(|link| link.map(|v| v.0) != Some(player))
                {
                    commands.entity(bone).insert(AnimatedBy(player));
                }
            }
            commands
                .entity(player)
                .insert(AnimationGraphHandle(graph.clone()));
            rider.player = Some(player);
        }
        let Ok(mut player) = players.get_mut(rider.player.unwrap()) else {
            continue;
        };
        let ability = view.special_abilities
            && (actor.special_active > 0. || (driver == 13 && actor.special_cooldown > 29.));
        let active = match (
            ability || actor.celebrate > 0.,
            actor.boost > 0. || actor.nightmare_active > 0.,
        ) {
            _ if matches!(driver, 12 | 13) && actor.celebrate > 0. => 3,
            (true, _) => 2,
            (_, true) => 1,
            _ => 0,
        };
        let mut weights = [0.; 7];
        weights[active] = 1.;
        let mut bow_age = None;
        if driver == 15 {
            let boosting = actor.boost > 0.;
            if boosting && !rider.boosting {
                rider.hat_age = 0.;
            }
            rider.boosting = boosting;
            // A hit also sets celebrate. Only a full KO by this racer earns the bow.
            bow_age = view.kill_feed.iter()
                .filter(|k| k.attacker == rider.id && !k.assist)
                .map(|k| (view.elapsed - k.time) as f32)
                .filter(|age| (0.0..1.6).contains(age))
                .min_by(f32::total_cmp);
            if rider.id == crate::preview::ID && actor.celebrate > 0. {
                bow_age = Some((1.6 - actor.celebrate as f32).clamp(0., 1.6));
            }
            weights = [0.; 7];
            match (bow_age, rider.hat_age < 1.4, ability) {
                (Some(_), _, _) => weights[5] = 1.,
                (_, true, _) => weights[1] = 1.,
                (_, _, true) => weights[2] = 1.,
                _ if actor.was_drifting && actor.somersault <= 0. => weights[6] = 1.,
                _ => {
                    let turn = (actor.yaw as f32 / 0.12).clamp(-1., 1.);
                    weights[0] = 1. - turn.abs();
                    weights[3] = (-turn).max(0.);
                    weights[4] = turn.max(0.);
                }
            }
        }
        let ease = 1. - (-15. * time.delta_secs()).exp();
        for (i, node) in nodes.iter().enumerate() {
            rider.blend[i] += (weights[i] - rider.blend[i]) * ease;
            let animation = player.play(*node).repeat().set_weight(rider.blend[i]);
            if driver == 15 {
                match i {
                    1 => { animation.pause().seek_to(rider.hat_age.min(1.4)); }
                    5 => { animation.pause().seek_to(bow_age.unwrap_or(1.6)); }
                    _ => {}
                }
            }
        }
        rider.hat_age += time.delta_secs();
    }
}
