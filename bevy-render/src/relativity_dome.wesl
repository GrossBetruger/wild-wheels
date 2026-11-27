// Special Relativity: Expanding Fresnel Doppler light-cone dome.
// Bursts outward from the caster with iridescent cyan-gold-violet rim glow
// and animated Minkowski harmonic bands.

import bevy_pbr::render::{
    mesh_functions,
    mesh_view_bindings::{view, globals},
    view_transformations::position_world_to_clip,
};

// params.x = strength (0..1)
// params.y = age since cast
// params.z = rim_boost (higher during initial burst & release collapse)
// params.w = unused
@group(constants::MATERIAL_BIND_GROUP) @binding(0) var<uniform> params: vec4<f32>;

struct Vertex {
    @builtin(instance_index) instance_index: u32,
    @location(0) position: vec3<f32>,
    @location(1) normal: vec3<f32>,
}

struct DomeOut {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) world_position: vec3<f32>,
    @location(1) world_normal: vec3<f32>,
    @location(2) local_pos: vec3<f32>,
}

@vertex
fn vertex(in: Vertex) -> DomeOut {
    var out: DomeOut;
    let world_from_local = mesh_functions::get_world_from_local(in.instance_index);
    let world = mesh_functions::mesh_position_local_to_world(world_from_local, vec4(in.position, 1.0));
    out.world_position = world.xyz;
    out.clip_position = position_world_to_clip(world.xyz);
    out.world_normal = mesh_functions::mesh_normal_local_to_world(in.normal, in.instance_index);
    out.local_pos = in.position;
    return out;
}

@fragment
fn fragment(in: DomeOut) -> @location(0) vec4<f32> {
    let strength = params.x;
    let age = params.y;
    let rim_boost = params.z;
    if strength <= 0.001 {
        discard;
    }

    let n = normalize(in.world_normal);
    let sight = normalize(view.world_position - in.world_position);
    let ndotv = abs(dot(n, sight));
    let fresnel = pow(1.0 - ndotv, 2.4);

    // Animated latitude light-cone bands rising along the dome
    let lat = in.local_pos.y;
    let bands = pow(0.5 + 0.5 * sin(lat * 26.0 - age * 7.5 + globals.time * 2.0), 6.0);
    // Subtle angular clock-tick shimmer around the azimuth
    let az = atan2(in.local_pos.z, in.local_pos.x);
    let ticks = pow(0.5 + 0.5 * sin(az * 12.0 + age * 1.4), 8.0) * 0.45;

    // Doppler iridescence: cyan-white crest + golden harmonic highlight + violet fringe
    let cyan = vec3(0.32, 0.94, 1.0);
    let gold = vec3(1.0, 0.82, 0.36);
    let violet = vec3(0.46, 0.25, 1.0);
    var col = mix(violet, cyan, clamp(fresnel * 1.35, 0.0, 1.0));
    col = mix(col, gold, clamp(bands * 0.65 + ticks * 0.4, 0.0, 0.85));

    // Fade cleanly near ground horizon
    let floor_fade = smoothstep(-0.08, 0.16, in.local_pos.y);
    let alpha = (fresnel * (0.48 + rim_boost * 0.55) + bands * 0.18 + ticks * 0.10) * floor_fade * strength;
    return vec4(col * alpha * 1.5, clamp(alpha, 0.0, 0.88));
}
