// Special Relativity: Screen-space relativistic time-freeze overlay.
// Renders an expanding/collapsing radial chromatic shockwave ring, Doppler
// blue/red edge fringes, eerie time-dilation vignette, and subtle clock ticks.

import bevy_render::globals::Globals;
import bevy_ui_render::ui_vertex_output::UiVertexOutput;

@group(0) @binding(1) var<uniform> globals: Globals;
// x: strength (0..1)
// y: age since cast (0..2.5)
// z: remaining time_stop (2.5..0)
// w: is_caster (1.0 if local player cast it, 0.0 if frozen by rival)
@group(1) @binding(0) var<uniform> params: vec4<f32>;

@fragment
fn fragment(in: UiVertexOutput) -> @location(0) vec4<f32> {
    let strength = params.x;
    let age = params.y;
    let remaining = params.z;
    let is_caster = params.w;
    if strength <= 0.001 {
        return vec4(0.0, 0.0, 0.0, 0.0);
    }

    let aspect = in.size.x / max(in.size.y, 1.0);
    let centered = (in.uv - vec2(0.5, 0.5)) * vec2(aspect, 1.0);
    let r = length(centered);
    let angle = atan2(centered.y, centered.x);

    // 1. Expanding activation shockwave ring (0.0 -> 0.55s) with RGB Doppler split
    let cast_p = clamp(age / 0.55, 0.0, 1.0);
    let cast_r = cast_p * 1.15;
    let cast_fade = (1.0 - cast_p) * smoothstep(0.0, 0.04, age);
    let ring_b = exp(-pow((r - (cast_r + 0.018)) * 26.0, 2.0)) * cast_fade;
    let ring_g = exp(-pow((r - cast_r) * 28.0, 2.0)) * cast_fade;
    let ring_r = exp(-pow((r - (cast_r - 0.018)) * 26.0, 2.0)) * cast_fade;

    // 2. Collapsing thaw pulse in final 0.35s
    let thaw_p = clamp(1.0 - remaining / 0.35, 0.0, 1.0);
    let thaw_r = (1.0 - thaw_p) * 0.95;
    let thaw_ring = exp(-pow((r - thaw_r) * 24.0, 2.0)) * sin(thaw_p * 3.14159) * 0.75;

    // 3. Relativistic Doppler edge vignette:
    //    Caster gets a clear center with electric cyan-gold periphery;
    //    Frozen rivals get a deeper cold indigo-cyan freeze atmosphere!
    let edge = smoothstep(0.24, 0.92, r);
    let doppler_blue = smoothstep(0.45, 0.95, r) * max(0.0, -centered.y * 1.2 + 0.5);
    let doppler_red = smoothstep(0.55, 0.98, r) * max(0.0, centered.y * 1.2 + 0.25);

    // 4. Delicate 12-hour relativistic clock-tick hashes around the outer dial
    let dial_band = exp(-pow((r - 0.44) * 32.0, 2.0));
    let ticks = pow(max(0.0, cos(angle * 12.0 + globals.time * 0.35 * is_caster)), 24.0) * dial_band * 0.35;

    let base_tint = mix(vec3(0.04, 0.14, 0.28), vec3(0.02, 0.12, 0.22), is_caster);
    var col = base_tint * edge;
    col += vec3(0.18, 0.72, 1.0) * doppler_blue * 0.32;
    col += vec3(0.55, 0.22, 0.75) * doppler_red * 0.20;
    col += vec3(0.55, 0.92, 1.0) * ticks;
    col += vec3(ring_r * 0.85, ring_g * 0.96, ring_b * 1.25) * 1.35;
    col += vec3(0.95, 0.85, 0.45) * thaw_ring;

    let freeze_alpha = mix(0.30, 0.18, is_caster) * edge * strength;
    let ring_alpha = clamp((ring_r + ring_g + ring_b) * 0.35 + thaw_ring * 0.45 + ticks * 0.5, 0.0, 0.75);
    let alpha = clamp(freeze_alpha + ring_alpha, 0.0, 0.72);
    return vec4(col, alpha);
}
