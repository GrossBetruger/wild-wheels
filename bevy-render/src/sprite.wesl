// Ported particles: the browser's soft round sprites, turned to face the camera
// here on the GPU, so their meshes depend only on the recorded frame and are
// shared by every entity showing it. native-client/src/sprite.rs builds them.

import bevy_pbr::render::{
    mesh_functions,
    mesh_view_bindings::view,
    view_transformations::position_world_to_clip,
};

struct Vertex {
    @builtin(instance_index) instance_index: u32,
    // The sprite's centre in the clip's space.
    @location(0) center: vec3<f32>,
    // Which corner of the sprite this is, from -1 to 1 each way.
    @location(1) corner: vec2<f32>,
    // The sprite's size, and 1 for glow added to the picture or 0 for smoke.
    @location(2) size: vec2<f32>,
    @location(3) color: vec4<f32>,
}

struct Particle {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) corner: vec2<f32>,
    @location(1) color: vec4<f32>,
    @location(2) additive: f32,
}

@vertex
fn vertex(in: Vertex) -> Particle {
    let world_from_local = mesh_functions::get_world_from_local(in.instance_index);
    let center = mesh_functions::mesh_position_local_to_world(world_from_local, vec4(in.center, 1.0));
    // A sprite of size 1 is as tall as the browser draws it at the current field
    // of view: tan(fov / 2) world units at unit distance.
    let reach = 1.0 / view.clip_from_view[1][1];
    let camera = mat3x3<f32>(view.world_from_view[0].xyz, view.world_from_view[1].xyz, view.world_from_view[2].xyz);
    let offset = camera * vec3(in.corner * in.size.x * reach, 0.0);
    // The camera's axes are taken into the clip's space and back out, as the CPU
    // used to do, so a stretched effect such as a fire ring stretches its sprites.
    let linear = mat3x3<f32>(world_from_local[0].xyz, world_from_local[1].xyz, world_from_local[2].xyz);
    let rotation = mat3x3<f32>(normalize(linear[0]), normalize(linear[1]), normalize(linear[2]));
    let world = center.xyz + linear * (transpose(rotation) * offset);

    var out: Particle;
    out.clip_position = position_world_to_clip(world);
    out.corner = in.corner;
    out.color = in.color;
    out.additive = in.size.y;
    return out;
}

@fragment
fn fragment(in: Particle) -> @location(0) vec4<f32> {
    // The browser particle shader's soft disc.
    let r = length(in.corner);
    let edge = clamp((r - 0.65) / 0.35, 0.0, 1.0);
    let disc = exp(-r * r * 3.5) * (1.0 - edge * edge * (3.0 - 2.0 * edge));
    let alpha = in.color.a * disc;
    // Glow is added to the picture; smoke is blended over it.
    return select(vec4(in.color.rgb, alpha), vec4(in.color.rgb * alpha, 0.0), in.additive > 0.5);
}
