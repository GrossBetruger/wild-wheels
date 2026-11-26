// Avita-Jas's Wormhole: Swirling relativistic accretion vortex disc shader.
// Pitch-black event horizon core, hot gold-white photon ring, and 5 twisting
// cyan-magenta-violet logarithmic spiral plasma arms pulling inward.

#import bevy_pbr::{
    mesh_functions,
    mesh_view_bindings::globals,
    view_transformations::position_world_to_clip,
}

// params.x = strength (0..1)
// params.y = age since cast
// params.z = remaining duration
// params.w = unused
@group(#{MATERIAL_BIND_GROUP}) @binding(0) var<uniform> params: vec4<f32>;

struct Vertex {
    @builtin(instance_index) instance_index: u32,
    @location(0) position: vec3<f32>,
    @location(1) uv: vec2<f32>,
}

struct VortexOut {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

@vertex
fn vertex(in: Vertex) -> VortexOut {
    var out: VortexOut;
    let world_from_local = mesh_functions::get_world_from_local(in.instance_index);
    let world = mesh_functions::mesh_position_local_to_world(world_from_local, vec4(in.position, 1.0));
    out.clip_position = position_world_to_clip(world.xyz);
    out.uv = in.uv;
    return out;
}

@fragment
fn fragment(in: VortexOut) -> @location(0) vec4<f32> {
    let strength = params.x;
    if strength <= 0.001 {
        discard;
    }

    let p = (in.uv - vec2(0.5, 0.5)) * 2.0;
    let r = length(p);
    if r > 1.0 {
        discard;
    }

    let angle = atan2(p.y, p.x);
    let t = globals.time;

    // 1. Pitch-black event horizon inside r < 0.20
    let horizon_mask = smoothstep(0.18, 0.24, r);

    // 2. Blazing Einstein photon ring right around the event horizon
    let photon_ring = exp(-pow((r - 0.235) * 26.0, 2.0)) * 2.2;

    // 3. Five swirling logarithmic spiral plasma arms accelerating inward
    let twist = log(max(r, 0.08)) * 7.5 + t * 5.2;
    let arm_a = pow(0.5 + 0.5 * sin(angle * 5.0 - twist), 3.0);
    let arm_b = pow(0.5 + 0.5 * sin(angle * 3.0 - twist * 1.35 + 1.4), 4.0);
    // Inward-rushing radial ripples
    let pull_wave = 0.55 + 0.45 * sin(r * 22.0 + t * 11.0);

    let outer_fade = smoothstep(1.0, 0.28, r);
    let inner_glow = exp(-pow((r - 0.34) * 5.0, 2.0));

    // Palette: hot gold-white photon ring -> electric cyan -> cosmic violet -> deep indigo
    let hot_gold = vec3(1.0, 0.90, 0.52);
    let cyan = vec3(0.22, 0.90, 1.0);
    let violet = vec3(0.62, 0.18, 1.0);
    let magenta = vec3(0.95, 0.28, 0.72);

    var col = mix(violet, cyan, clamp(inner_glow + arm_a * 0.65, 0.0, 1.0));
    col = mix(col, magenta, arm_b * 0.55 * (1.0 - inner_glow * 0.5));
    col = mix(col, hot_gold, clamp(photon_ring * 0.75, 0.0, 1.0));

    let swirl = (arm_a * 0.85 + arm_b * 0.55 + inner_glow * 0.65) * pull_wave * outer_fade * horizon_mask;
    let intensity = (swirl + photon_ring) * strength;
    let alpha = clamp(intensity * 0.88, 0.0, 0.96);
    return vec4(col * intensity * 1.45, alpha);
}
