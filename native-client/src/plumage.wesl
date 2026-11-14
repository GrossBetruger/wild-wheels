// Pearococo's tail feathers.
//
// The first half of each stage is a port of the plumage branch of the browser's
// vertex shader in client/renderer.js: the feathers' sway, their bent normals and
// an iridescence that depends only on light and view angles. The browser shades
// per vertex; here it is per pixel.
//
// The rest is native only and is marked as such: flutter at the tips, the tail
// swinging behind her turns and pressed back by speed, barbs along each blade
// that each sit at their own point on the iridescent palette, glints, bronze and
// green rings around the eyes, gleaming gold, and the gold beads along each shaft
// cut as jewels that mirror the sky and flash under the lamp. None of it cycles hue with
// time, in keeping with the browser's rule; the shimmer comes from motion.

import bevy_pbr::render::{
    mesh_functions,
    mesh_view_bindings::{view, globals},
    view_transformations::position_world_to_clip,
};

struct Vertex {
    @builtin(instance_index) instance_index: u32,
    @location(0) position: vec3<f32>,
    @location(1) normal: vec3<f32>,
    // Distance along the feather from its root and across it from its shaft.
    @location(2) feather: vec2<f32>,
    // Offset from the centre of the feather's eye, in the feather's plane.
    @location(3) eye: vec2<f32>,
    // The browser's color, as it writes it to the screen.
    @location(4) color: vec4<f32>,
}

struct Plume {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) world_position: vec3<f32>,
    @location(1) world_normal: vec3<f32>,
    @location(2) color: vec3<f32>,
    @location(3) feather: vec4<f32>,
}

// How the racer's movement acts on her tail, unpacked from the mesh tag that
// native-client/src/plumage.rs packs.
struct Wind {
    // Sideways swing of the tips, -1 to 1, towards +X.
    swing: f32,
    // How far speed presses the tail back, 0 to 1.
    press: f32,
    clock: f32,
}

fn wind_of(tag: u32) -> Wind {
    var wind: Wind;
    wind.swing = f32(tag & 0x7ffu) / 1023.5 - 1.0;
    wind.press = f32((tag >> 11u) & 0xffu) / 255.0;
    // Bit 31 holds the tail still, for screenshots that must not change.
    wind.clock = select(globals.time, 0.0, (tag >> 31u) == 1u);
    return wind;
}

fn bend(p: vec3<f32>, wind: Wind) -> vec3<f32> {
    // The browser's sway: nothing at the root, most at the tips.
    let reach = clamp((p.y - 1.75) / 3.8, 0.0, 1.0);
    let wave = wind.clock * 1.15 + p.x * 0.85 + p.y * 0.45;
    var bent = p + vec3(sin(wave * 0.7) * 0.16, cos(wave) * 0.14, sin(wave) * 0.55) * reach;

    // Native only. Tips flutter, more so at speed.
    let tip = reach * reach;
    let flutter = 1.0 + 2.5 * wind.press;
    bent.x += sin(wind.clock * 2.9 + p.x * 2.3 + p.y * 0.6) * 0.035 * tip * flutter;
    bent.z += cos(wind.clock * 3.7 + p.x * 1.7 - p.y * 0.9) * 0.06 * tip * flutter;
    // The tail lags behind a turn and is swept back by speed.
    bent.x += wind.swing * 1.1 * tip;
    bent.z -= (abs(wind.swing) * 0.25 + wind.press * 0.8) * tip;
    bent.y -= wind.press * 0.22 * tip;
    return bent;
}

@vertex
fn vertex(in: Vertex) -> Plume {
    let wind = wind_of(mesh_functions::get_tag(in.instance_index));
    let p = bend(in.position, wind);
    // The browser bends each normal with the feather so sheen follows the motion.
    // It differentiates its sway by hand; differences cover the additions too.
    let step = 0.01;
    let dx = (bend(in.position + vec3(step, 0.0, 0.0), wind) - p) / step;
    let dy = (bend(in.position + vec3(0.0, step, 0.0), wind) - p) / step;
    let dz = vec3(0.0, 0.0, 1.0);
    let normal = cross(dy, dz) * in.normal.x + cross(dz, dx) * in.normal.y + cross(dx, dy) * in.normal.z;

    var out: Plume;
    let world_from_local = mesh_functions::get_world_from_local(in.instance_index);
    let world = mesh_functions::mesh_position_local_to_world(world_from_local, vec4(p, 1.0));
    out.world_position = world.xyz;
    out.clip_position = position_world_to_clip(world.xyz);
    out.world_normal = mesh_functions::mesh_normal_local_to_world(normal, in.instance_index);
    out.color = in.color.rgb;
    out.feather = vec4(in.feather, in.eye);
    return out;
}

// The browser's lamp: normalize(vec3(-0.5, 1.0, 0.3)).
const LAMP: vec3<f32> = vec3<f32>(-0.43193421, 0.86386843, 0.25916053);
// Barbs per unit of feather length, and how steeply they sweep towards the tip.
const BARBS: f32 = 11.0;
const SWEEP: f32 = 1.3;

fn hash(p: vec2<f32>) -> f32 {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// Colors are worked out as the browser displays them, then converted for output.
fn to_linear(c: vec3<f32>) -> vec3<f32> {
    let low = c / 12.92;
    let high = pow((c + 0.055) / 1.055, vec3(2.4));
    return select(high, low, c <= vec3(0.04045));
}

@fragment
fn fragment(in: Plume) -> @location(0) vec4<f32> {
    let along = in.feather.x;
    let across = in.feather.y;
    // Native only: which barb this pixel is on. Derivatives are taken here, before
    // any branch, and fade the barbs out where they are too fine to draw.
    let barb = (along - abs(across) * SWEEP) * BARBS + sign(across) * 0.37;
    let fine = clamp(1.4 - fwidth(barb) * 2.2, 0.0, 1.0);
    let barb_x = dpdx(barb);
    let barb_y = dpdy(barb);
    let place_x = dpdx(in.world_position);
    let place_y = dpdy(in.world_position);

    let sight = normalize(view.world_position - in.world_position);
    let halfway = normalize(LAMP + sight);
    var normal = normalize(in.world_normal);
    var tint = in.color;
    // The browser's test for feather colors, and its plain shading for the rest.
    let iridescent = in.color.b > in.color.r * 0.85 && in.color.g > in.color.r * 1.1;
    var light = 0.62 + 0.38 * max(0.0, dot(normal, LAMP));

    if iridescent {
        // Blades are drawn from both sides at once; shade both the same.
        normal = normal * select(-1.0, 1.0, dot(normal, sight) >= 0.0);

        // Native only: each barb is a small ridge, tilting the surface across it.
        let lift = cross(place_y, normal) * barb_x + cross(normal, place_x) * barb_y;
        let facing_side = sign(dot(place_x, cross(place_y, normal)));
        let ridge = fract(barb) - 0.5;
        let across_barb = normalize(lift * facing_side + vec3(1e-6, 0.0, 0.0));
        let surface = normalize(normal + across_barb * ridge * 0.9 * fine);

        // The browser's iridescence: teal face on, blue then violet at a glance,
        // and a pale sheen where the lamp reflects.
        let facing = abs(dot(surface, sight));
        let reflection = abs(dot(surface, halfway));
        var grazing = 1.0 - (0.7 * facing + 0.3 * reflection);
        // Native only: barbs differ a little in where they sit on that palette.
        let seed = hash(vec2(floor(barb), sign(across)));
        grazing += (seed - 0.5) * 0.16 * fine;
        var silk = mix(vec3(0.12, 0.52, 0.43), vec3(0.17, 0.3, 0.7), smoothstep(0.12, 0.72, grazing));
        silk = mix(silk, vec3(0.51, 0.24, 0.64), smoothstep(0.6, 0.95, grazing) * 0.7);
        // Native only: a green-gold flash when a barb is seen square on.
        silk = mix(silk, vec3(0.34, 0.66, 0.26), (1.0 - smoothstep(0.02, 0.16, grazing)) * 0.45);
        let sheen = pow(reflection, 22.0);
        tint = mix(mix(in.color, silk, 0.85), vec3(0.85, 0.94, 0.72), sheen * 0.55);
        light = 0.62 + 0.38 * abs(dot(surface, LAMP));

        // Native only from here. Grooves between barbs, and a blade that deepens
        // towards its root.
        let groove = smoothstep(0.0, 0.2, 0.5 - abs(ridge));
        tint *= mix(1.0, mix(0.78, 1.0, groove), fine);
        tint *= mix(0.88, 1.05, smoothstep(0.0, 3.0, along));
        // Rings of bronze and green around the eye, where the blade shows past it.
        let ring = length(in.feather.zw / vec2(0.28, 0.4));
        let bronze = smoothstep(0.95, 1.15, ring) * (1.0 - smoothstep(1.35, 1.75, ring));
        let green = smoothstep(1.45, 1.8, ring) * (1.0 - smoothstep(2.1, 2.7, ring));
        tint = mix(tint, vec3(0.76, 0.52, 0.2) * (0.8 + 0.5 * reflection), bronze * 0.6);
        tint = mix(tint, vec3(0.3, 0.72, 0.36), green * 0.4);
        // Glints: a few facets along each barb catch the lamp as the tail moves.
        let cell = vec2(floor(barb), floor(along * 4.0) + sign(across) * 31.0);
        let scatter = vec3(hash(cell), hash(cell + 17.3), hash(cell + 41.7)) - 0.5;
        let facet = normalize(surface + scatter * 0.8);
        let glint = pow(abs(dot(facet, halfway)), 120.0) * fine;
        tint += vec3(1.0, 0.97, 0.82) * glint * 0.9;
    } else if abs(across) < 0.07 && length(in.feather.zw / vec2(0.28, 0.4)) > 1.5 {
        // Native only: the beads along the shaft are jewels. Each facet mirrors a
        // pale sky above and warm ground below, turns from gold to rose to mint
        // towards its rim, and flashes when it reflects a lamp, so the beads
        // twinkle one facet at a time as the tail sways.
        normal = normal * select(-1.0, 1.0, dot(normal, sight) >= 0.0);
        let mirrored = reflect(-sight, normal);
        let rim = pow(1.0 - max(dot(normal, sight), 0.0), 2.5);
        let sky = mix(vec3(0.9, 0.66, 0.38), vec3(1.0, 0.98, 1.0), smoothstep(-0.6, 0.5, mirrored.y));
        var film = mix(vec3(1.0, 0.8, 0.42), vec3(1.0, 0.62, 0.74), smoothstep(0.15, 0.6, rim));
        film = mix(film, vec3(0.62, 0.96, 0.82), smoothstep(0.55, 0.95, rim));
        tint = mix(in.color * film * 1.12, sky * film, 0.35 + 0.4 * rim);
        // The lamp, and a second light over the viewer's shoulder so beads also
        // flash when the tail is seen from behind, away from the lamp.
        let shoulder = normalize(sight * 0.55 + vec3(0.0, 0.8, 0.0) + cross(sight, vec3(0.0, 1.0, 0.0)) * 0.3);
        let flash = pow(max(dot(mirrored, LAMP), 0.0), 18.0);
        let wink = pow(max(dot(mirrored, shoulder), 0.0), 14.0);
        tint += vec3(1.0, 0.98, 0.88) * (flash * 1.4 + wink * 1.1);
        light = 0.8 + 0.2 * max(0.0, dot(normal, LAMP));
    } else {
        // Native only: gold shafts, eyes and pearls gleam under the lamp.
        let gleam = pow(max(dot(normal, halfway), 0.0), 36.0);
        tint += vec3(1.0, 0.93, 0.74) * gleam * 0.5;
    }
    return vec4(to_linear(clamp(tint * light, vec3(0.0), vec3(1.0))), 1.0);
}
