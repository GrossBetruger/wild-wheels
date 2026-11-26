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
    blend: [f32; 3],
}

impl Rider {
    pub fn new(id: usize, driver: usize) -> Self {
        Self {
            id,
            driver,
            player: None,
            blend: [1., 0., 0.],
        }
    }
}

#[derive(Default)]
pub struct RigAssets {
    models: HashMap<usize, Handle<Gltf>>,
    graphs: HashMap<usize, (Handle<AnimationGraph>, [AnimationNodeIndex; 3])>,
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
            let [Some(cruise), Some(boost), Some(special)] =
                ["cruise", "boost", "special"].map(|name| model.named_animations.get(name))
            else {
                continue;
            };
            let nodes =
                [cruise, boost, special].map(|clip| graph.add_clip(clip.clone(), 1., graph.root));
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
            (true, _) => 2,
            (_, true) => 1,
            _ => 0,
        };
        let ease = 1. - (-15. * time.delta_secs()).exp();
        for (i, node) in nodes.iter().enumerate() {
            let target = if i == active { 1. } else { 0. };
            rider.blend[i] += (target - rider.blend[i]) * ease;
            player.play(*node).repeat().set_weight(rider.blend[i]);
        }
    }
}
