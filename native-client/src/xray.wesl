// What KnowItOwl sees through Dark Humor: the browser's X-ray shading in
// client/renderer.js. Each shape is one flat color, brightened towards its rim
// where the surface turns away from the eye.

import bevy_pbr::render::{
    mesh_functions,
    mesh_view_bindings::view,
    view_transformations::position_world_to_clip,
};

struct Vertex {
    @builtin(instance_index) instance_index: u32,
    @location(0) position: vec3<f32>,
    @location(1) normal: vec3<f32>,
    // The color as the browser writes it to the screen.
    @location(2) color: vec4<f32>,
}

struct Seen {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) world_position: vec3<f32>,
    @location(1) world_normal: vec3<f32>,
    @location(2) color: vec3<f32>,
}

@vertex
fn vertex(in: Vertex) -> Seen {
    var out: Seen;
    let world_from_local = mesh_functions::get_world_from_local(in.instance_index);
    let world = mesh_functions::mesh_position_local_to_world(world_from_local, vec4(in.position, 1.0));
    out.world_position = world.xyz;
    out.clip_position = position_world_to_clip(world.xyz);
    out.world_normal = mesh_functions::mesh_normal_local_to_world(in.normal, in.instance_index);
    out.color = in.color.rgb;
    return out;
}

fn to_linear(c: vec3<f32>) -> vec3<f32> {
    let low = c / 12.92;
    let high = pow((c + 0.055) / 1.055, vec3(2.4));
    return select(high, low, c <= vec3(0.04045));
}

@fragment
fn fragment(in: Seen) -> @location(0) vec4<f32> {
    let sight = normalize(view.world_position - in.world_position);
    let rim = pow(1.0 - abs(dot(normalize(in.world_normal), sight)), 2.0);
    let tint = in.color + vec3(0.4, 0.4, 0.25) * rim;
    return vec4(to_linear(clamp(tint, vec3(0.0), vec3(1.0))), 1.0);
}
