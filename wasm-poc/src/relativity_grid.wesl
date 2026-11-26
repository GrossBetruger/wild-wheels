// Special Relativity: Einstein "rubber-sheet" spacetime floor grid.
// Vertex shader warps a gravity well under the caster and propagates
// relativistic shockwave ripples outward; fragment shader draws crisp
// glowing coordinate lines and Minkowski light-cone rings.

import bevy_pbr::render::{
    mesh_functions,
    mesh_view_bindings::globals,
    view_transformations::position_world_to_clip,
};

// params.x = strength (0..1)
// params.y = elapsed age since cast (0..2.5)
// params.z = remaining time_stop (2.5..0)
// params.w = wave_radius (expanding shockwave radius in world units)
@group(constants::MATERIAL_BIND_GROUP) @binding(0) var<uniform> params: vec4<f32>;

struct Vertex {
    @builtin(instance_index) instance_index: u32,
    @location(0) position: vec3<f32>,
    @location(1) uv: vec2<f32>,
}

struct GridOut {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) local_xz: vec2<f32>,
    @location(1) well_depth: f32,
    @location(2) ripple: f32,
}

@vertex
fn vertex(in: Vertex) -> GridOut {
    var out: GridOut;
    let xz = in.position.xz;
    let r = length(xz);
    let strength = params.x;
    let age = params.y;
    let wave_r = params.w;

    // Classic relativistic gravity well dipping smoothly beneath the caster
    let well = 1.65 * strength / (1.0 + (r * r) / 36.0);
    // Expanding spacetime ripple crest traveling outward on cast
    let wave_band = exp(-pow((r - wave_r) * 0.22, 2.0));
    let ripple = sin((r - wave_r) * 1.15) * wave_band * 0.55 * strength;
    // Subtle standing harmonic shimmer while time is frozen
    let shimmer = sin(r * 0.42 - globals.time * 4.5) * 0.08 * strength * exp(-r * 0.03);

    var displaced = in.position;
    displaced.y = in.position.y + max(0.0, ripple + shimmer) + 0.16 - well * 0.14;
    // Pinch local XZ slightly inward near the gravity well for authentic metric curvature!
    let pinch = 1.0 - 0.12 * strength / (1.0 + (r * r) / 52.0);
    displaced.x *= pinch;
    displaced.z *= pinch;

    let world_from_local = mesh_functions::get_world_from_local(in.instance_index);
    let world = mesh_functions::mesh_position_local_to_world(world_from_local, vec4(displaced, 1.0));
    out.clip_position = position_world_to_clip(world.xyz);
    out.local_xz = xz;
    out.well_depth = well;
    out.ripple = wave_band;
    return out;
}

@fragment
fn fragment(in: GridOut) -> @location(0) vec4<f32> {
    let strength = params.x;
    let age = params.y;
    let wave_r = params.w;
    if strength <= 0.001 {
        discard;
    }

    let r = length(in.local_xz);
    // Radial fade to zero at edge of 55-unit grid
    let edge_fade = smoothstep(54.0, 22.0, r);
    if edge_fade <= 0.001 {
        discard;
    }

    // Crisp anti-aliased Cartesian spacetime grid (spacing = 4.0 world units)
    let cell = in.local_xz / 4.0;
    let grid_uv = abs(fract(cell - 0.5) - 0.5) / max(fwidth(cell), vec2(0.002));
    let line = 1.0 - min(min(grid_uv.x, grid_uv.y), 1.0);
    let grid_glow = pow(clamp(line, 0.0, 1.0), 1.4);

    // Concentric Minkowski light-cone coordinate rings
    let ring_phase = r / 8.0 - age * 0.45;
    let ring_dist = abs(fract(ring_phase - 0.5) - 0.5) / max(fwidth(ring_phase), 0.004);
    let rings = pow(clamp(1.0 - ring_dist, 0.0, 1.0), 1.6) * 0.75;

    // Bright expanding relativistic shockwave ring
    let shock = exp(-pow((r - wave_r) * 0.30, 2.0)) * 1.45;

    // Doppler palette: warm gold-white right under the caster -> electric cyan -> deep indigo
    let near_caster = exp(-r * 0.075);
    let gold = vec3(1.0, 0.86, 0.42);
    let cyan = vec3(0.24, 0.88, 1.0);
    let indigo = vec3(0.32, 0.24, 0.95);
    var col = mix(indigo, cyan, smoothstep(46.0, 10.0, r));
    col = mix(col, gold, near_caster * 0.75);

    let energy = (grid_glow * 0.65 + rings * 0.55 + shock) * edge_fade * strength;
    let out_col = col * (1.2 + shock * 1.6 + near_caster * 0.9);
    return vec4(out_col * energy, clamp(energy * 0.85, 0.0, 0.95));
}
