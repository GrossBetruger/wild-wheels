// Dark Humor's fog: a port of the fragment shader in
// characters/knowitowl/dark-humor.js. Violet clouds drift and fold over the
// arena while pale tendrils pulse through them. The browser also warms the fog
// around falling bombs; that is not ported.

import bevy_render::globals::Globals;
import bevy_ui_render::ui_vertex_output::UiVertexOutput;

@group(0) @binding(1) var<uniform> globals: Globals;
// x: how dark the arena is, 0 to 1.
@group(1) @binding(0) var<uniform> strength: vec4<f32>;

fn hash(p: vec2<f32>) -> f32 {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
fn noise(p: vec2<f32>) -> f32 {
    let i = floor(p);
    var f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
fn fbm(start: vec2<f32>) -> f32 {
    var p = start;
    var n = 0.0;
    var w = 0.5;
    for (var i = 0; i < 4; i++) {
        n += noise(p) * w;
        // GLSL mat2(1.6, 1.2, -1.2, 1.6) * p.
        p = vec2(1.6 * p.x - 1.2 * p.y, 1.2 * p.x + 1.6 * p.y);
        w *= 0.5;
    }
    return n;
}
fn to_linear(c: vec3<f32>) -> vec3<f32> {
    let low = c / 12.92;
    let high = pow((c + 0.055) / 1.055, vec3(2.4));
    return select(high, low, c <= vec3(0.04045));
}

@fragment
fn fragment(in: UiVertexOutput) -> @location(0) vec4<f32> {
    // The browser's uv runs upwards; a node's runs downwards.
    let uv = vec2(in.uv.x, 1.0 - in.uv.y);
    let clock = globals.time;
    let p = (uv - 0.5) * vec2(in.size.x / in.size.y, 1.0) * 3.0;
    let t = clock * 0.22;
    let q = vec2(fbm(p + vec2(t, -t)), fbm(p + vec2(4.1, -t * 0.6)));
    let clouds = fbm(p * 1.8 + q * 3.0 + vec2(-t, t * 0.4));
    let tendrils = pow(max(0.0, 1.0 - abs(clouds - 0.48) * 7.0), 3.0);
    let pulse = 0.72 + 0.28 * sin(clock * 1.7 + clouds * 11.0);
    var color = vec3(0.008, 0.004, 0.022) + vec3(0.09, 0.015, 0.18) * clouds + vec3(0.035, 0.12, 0.13) * tendrils * pulse;
    let vignette = smoothstep(0.1, 1.2, length((uv - 0.5) * vec2(1.1, 1.4)));
    color *= 1.0 - vignette * 0.65;
    // The browser blends as displayed and this blends in linear light, where the
    // same opacity would let far more of the arena show; this hides as much.
    let opacity = strength.x * (0.90 + 0.025 * clouds);
    return vec4(to_linear(color), 1.0 - pow(1.0 - opacity, 2.2));
}
