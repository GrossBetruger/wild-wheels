//! Dynamic Bevy mesh builder for server-defined arenas.
//! Keeps future arena additions and layout tweaks server-side only without
//! requiring native client rebuilds, matching `client/renderer.js` and
//! `characters/knowitowl/dark-humor.js`.
use bevy::{
    asset::RenderAssetUsages,
    mesh::PrimitiveTopology,
    prelude::*,
};
use wild_wheels_core::ArenaDef;

fn hex_linear(hex: &str) -> [f32; 4] {
    let parse = |i: usize| u8::from_str_radix(&hex[i..i + 2], 16).unwrap_or(128);
    if hex.len() == 7 && hex.starts_with('#') {
        let c = Color::srgb_u8(parse(1), parse(3), parse(5)).to_linear();
        [c.red, c.green, c.blue, 1.0]
    } else {
        [0.5, 0.5, 0.5, 1.0]
    }
}

pub fn sky_color(hex: &str) -> Color {
    let parse = |i: usize| u8::from_str_radix(&hex[i..i + 2], 16).unwrap_or(180);
    if hex.len() == 7 && hex.starts_with('#') {
        Color::srgb_u8(parse(1), parse(3), parse(5))
    } else {
        Color::srgb_u8(181, 211, 217)
    }
}

fn lighten(hex: &str, delta: i16) -> [f32; 4] {
    let parse = |i: usize| u8::from_str_radix(&hex[i..i + 2], 16).unwrap_or(128);
    if hex.len() == 7 && hex.starts_with('#') {
        let adj = |v: u8| (i16::from(v) + delta).clamp(0, 255) as u8;
        let c = Color::srgb_u8(adj(parse(1)), adj(parse(3)), adj(parse(5))).to_linear();
        [c.red, c.green, c.blue, 1.0]
    } else {
        [0.55, 0.55, 0.55, 1.0]
    }
}

#[derive(Default)]
struct Builder {
    positions: Vec<[f32; 3]>,
    normals: Vec<[f32; 3]>,
    colors: Vec<[f32; 4]>,
    origin: Vec3,
    angle: f32,
}

impl Builder {
    fn at(&mut self, x: f32, y: f32, z: f32, angle: f32) {
        self.origin = Vec3::new(x, y, z);
        self.angle = angle;
    }
    fn pt(&self, p: [f32; 3]) -> Vec3 {
        let (s, c) = self.angle.sin_cos();
        Vec3::new(
            self.origin.x + p[0] * c + p[2] * s,
            self.origin.y + p[1],
            self.origin.z - p[0] * s + p[2] * c,
        )
    }
    fn tri(&mut self, a: [f32; 3], b: [f32; 3], c: [f32; 3], color: [f32; 4]) {
        let (pa, pb, pc) = (self.pt(a), self.pt(b), self.pt(c));
        let n = (pb - pa).cross(pc - pa).normalize_or_zero();
        for p in [pa, pb, pc] {
            self.positions.push(p.to_array());
            self.normals.push(n.to_array());
            self.colors.push(color);
        }
    }
    fn quad(&mut self, a: [f32; 3], b: [f32; 3], c: [f32; 3], d: [f32; 3], color: [f32; 4]) {
        self.tri(a, b, c, color);
        self.tri(a, c, d, color);
    }
    #[allow(clippy::too_many_arguments)]
    fn box_part(&mut self, x: f32, y: f32, z: f32, w: f32, h: f32, d: f32, color: [f32; 4]) {
        let (hw, hd) = (w * 0.5, d * 0.5);
        let a = [x - hw, y, z - hd];
        let b = [x + hw, y, z - hd];
        let c = [x + hw, y + h, z - hd];
        let e = [x - hw, y + h, z - hd];
        let f = [x - hw, y, z + hd];
        let g = [x + hw, y, z + hd];
        let i = [x + hw, y + h, z + hd];
        let j = [x - hw, y + h, z + hd];
        self.quad(a, e, c, b, color);
        self.quad(f, g, i, j, color);
        self.quad(e, j, i, c, color);
        self.quad(a, f, j, e, color);
        self.quad(b, c, i, g, color);
        self.quad(a, b, g, f, color);
    }
    #[allow(clippy::too_many_arguments)]
    fn cone(&mut self, x: f32, y: f32, z: f32, r: f32, h: f32, color: [f32; 4], n: usize) {
        for i in 0..n {
            let a = i as f32 / n as f32 * std::f32::consts::TAU;
            let b = (i + 1) as f32 / n as f32 * std::f32::consts::TAU;
            self.tri(
                [x + a.sin() * r, y, z + a.cos() * r],
                [x + b.sin() * r, y, z + b.cos() * r],
                [x, y + h, z],
                color,
            );
        }
    }
    fn finish(self) -> Mesh {
        Mesh::new(
            PrimitiveTopology::TriangleList,
            RenderAssetUsages::RENDER_WORLD,
        )
        .with_inserted_attribute(Mesh::ATTRIBUTE_POSITION, self.positions)
        .with_inserted_attribute(Mesh::ATTRIBUTE_NORMAL, self.normals)
        .with_inserted_attribute(Mesh::ATTRIBUTE_COLOR, self.colors)
    }
}

pub fn scenery_mesh(def: &ArenaDef) -> Mesh {
    let mut m = Builder::default();
    let r = def.size as f32;
    let ground = hex_linear(&def.ground);
    let ground_alt = lighten(&def.ground, 11);
    let wall = hex_linear(&def.wall);
    let trim = hex_linear("#eadfb9");
    let post = hex_linear("#4c465b");
    let cap = hex_linear("#c9bfaa");
    let tower = hex_linear("#666377");
    let lamp = hex_linear("#eee1b1");

    if def.is_octagon() {
        let t = std::f32::consts::SQRT_2 - 1.0;
        let wall_depth = 4.0;
        let outer_side = 2.0 * (r + wall_depth) * t;
        let corner = r * t;
        let inner_ring = (r * 0.28).max(8.0);
        let mid_ring = (r * 0.59).max(inner_ring + 6.0);
        let outer_ring = (r * 0.84).max(mid_ring + 6.0);
        let bands = [
            (0.0, inner_ring, ground_alt),
            (inner_ring, inner_ring + 1.4, trim),
            (inner_ring + 1.4, mid_ring, ground),
            (mid_ring, outer_ring, ground_alt),
            (outer_ring, outer_ring + 1.2, wall),
            (outer_ring + 1.2, r + wall_depth, ground),
        ];
        for i in 0..8 {
            m.at(0.0, 0.0, 0.0, i as f32 * std::f32::consts::FRAC_PI_4);
            for (r0, r1, col) in bands {
                let (w0, w1) = (r0 * t, r1 * t);
                if r0 == 0.0 {
                    m.tri([0.0, 0.0, 0.0], [-w1, 0.0, r1], [w1, 0.0, r1], col);
                } else {
                    m.quad(
                        [-w0, 0.0, r0],
                        [-w1, 0.0, r1],
                        [w1, 0.0, r1],
                        [w0, 0.0, r0],
                        col,
                    );
                }
            }
            m.box_part(0.0, 0.0, r + wall_depth * 0.5, outer_side, 5.0, wall_depth, wall);
            m.box_part(
                0.0,
                5.0,
                r + wall_depth * 0.5,
                outer_side,
                0.5,
                wall_depth + 0.2,
                trim,
            );
            let mut s = -corner + 5.0;
            while s <= corner - 5.0 {
                m.box_part(s, 0.2, r - 0.05, 0.25, 4.6, 0.15, post);
                s += 10.0;
            }
            m.box_part(corner + 1.1, 0.0, r + 1.1, 4.6, 6.2, 4.6, post);
            m.box_part(corner + 1.1, 6.2, r + 1.1, 5.0, 0.45, 5.0, trim);
        }
        for i in 0..8 {
            let a = (i as f32 + 0.5) * std::f32::consts::FRAC_PI_4;
            m.at(a.sin() * (r + 20.0), 0.0, a.cos() * (r + 20.0), 0.0);
            m.box_part(0.0, 0.0, 0.0, 1.0, 16.0, 1.0, tower);
            m.box_part(0.0, 15.0, 0.0, 8.0, 1.0, 1.0, lamp);
            m.cone(0.0, 16.0, 0.0, 2.0, 3.0, wall, 4);
        }
    } else {
        let span = ((r + 4.0) / 10.0).ceil() as i32 * 10;
        let cutouts: Vec<[f32; 4]> = def
            .water
            .iter()
            .map(|b| [b[0] as f32, b[1] as f32, b[2] as f32, b[3] as f32])
            .chain(
                def.bridges
                    .iter()
                    .map(|b| [b[0] as f32, b[1] as f32, b[2] as f32, b[3] as f32]),
            )
            .collect();
        let subtract = |rects: Vec<[f32; 4]>, cut: [f32; 4]| {
            let (rx0, rx1, rz0, rz1) = (
                cut[0] - cut[2] * 0.5,
                cut[0] + cut[2] * 0.5,
                cut[1] - cut[3] * 0.5,
                cut[1] + cut[3] * 0.5,
            );
            let mut out = Vec::with_capacity(rects.len());
            for [x0, z0, x1, z1] in rects {
                if x1 <= rx0 || x0 >= rx1 || z1 <= rz0 || z0 >= rz1 {
                    out.push([x0, z0, x1, z1]);
                    continue;
                }
                let (ix0, ix1) = (x0.max(rx0), x1.min(rx1));
                if x0 < ix0 {
                    out.push([x0, z0, ix0, z1]);
                }
                if ix1 < x1 {
                    out.push([ix1, z0, x1, z1]);
                }
                if z0 < rz0 {
                    out.push([ix0, z0, ix1, z1.min(rz0)]);
                }
                if z1 > rz1 {
                    out.push([ix0, z0.max(rz1), ix1, z1]);
                }
            }
            out
        };
        let mut x = -span;
        while x < span {
            let mut z = -span;
            while z < span {
                let col = if (x + z) % 20 != 0 { ground } else { ground_alt };
                if cutouts.is_empty() {
                    m.box_part(x as f32 + 5.0, -0.4, z as f32 + 5.0, 10.0, 0.4, 10.0, col);
                } else {
                    let mut rects = vec![[x as f32, z as f32, (x + 10) as f32, (z + 10) as f32]];
                    for &cut in &cutouts {
                        rects = subtract(rects, cut);
                    }
                    for [x0, z0, x1, z1] in rects {
                        m.box_part(
                            (x0 + x1) * 0.5,
                            -0.4,
                            (z0 + z1) * 0.5,
                            x1 - x0,
                            0.4,
                            z1 - z0,
                            col,
                        );
                    }
                }
                z += 10;
            }
            x += 10;
        }
        if !cutouts.is_empty() {
            let has_river = |px: f32, pz: f32| {
                cutouts
                    .iter()
                    .any(|c| (px - c[0]).abs() < c[2] * 0.5 && (pz - c[1]).abs() < c[3] * 0.5)
            };
            let deep_water = hex_linear("#286187");
            let mid_water = hex_linear("#3579a4");
            let streak = hex_linear("#5ea9ce");
            let quay = hex_linear("#6b686c");
            let coping = hex_linear("#cfc5b4");
            let rail = hex_linear("#535666");
            let bollard = hex_linear("#474957");
            let pier = hex_linear("#756f66");
            let deck = hex_linear("#a57c52");
            let plank = hex_linear("#85613e");
            let curb = hex_linear("#d5cbb8");
            let parapet = hex_linear("#8d8577");
            let iron = hex_linear("#383b4a");
            let baluster = hex_linear("#474a5a");
            let pillar = hex_linear("#7c7468");
            let pillar_cap = hex_linear("#d8ceb8");
            let lantern = hex_linear("#f5dd84");
            let lantern_cap = hex_linear("#363846");

            for &[cx, cz, cw, cd] in &cutouts {
                m.box_part(cx, -0.58, cz, cw, 0.22, cd, deep_water);
                m.box_part(
                    cx,
                    -0.36,
                    cz,
                    (cw - 1.4).max(0.5),
                    0.03,
                    (cd - 1.4).max(0.5),
                    mid_water,
                );
                let horiz = cw >= cd;
                let (len, wid) = if horiz { (cw, cd) } else { (cd, cw) };
                let mut s = -len * 0.5 + 3.0;
                while s <= len * 0.5 - 3.0 {
                    let offset = (((cx + cz + s).round() as i32).rem_euclid(3) - 1) as f32
                        * (wid * 0.22).min(2.2);
                    if horiz {
                        m.box_part(cx + s, -0.33, cz + offset, (len * 0.45).min(3.8), 0.02, 0.45, streak);
                    } else {
                        m.box_part(cx + offset, -0.33, cz + s, 0.45, 0.02, (len * 0.45).min(3.8), streak);
                    }
                    s += 6.5;
                }
            }
            for &[bx, bz, bw, bd] in &def.water {
                let (cx, cz, cw, cd) = (bx as f32, bz as f32, bw as f32, bd as f32);
                let (x0, x1, z0, z1) = (cx - cw * 0.5, cx + cw * 0.5, cz - cd * 0.5, cz + cd * 0.5);
                for (side, z_edge) in [(-1.0_f32, z0), (1.0, z1)] {
                    let mut x = x0;
                    while x < x1 - 0.01 {
                        let seg = (x1 - x).min(2.0);
                        let mx = x + seg * 0.5;
                        if (z_edge + side * 0.8).abs() <= r - 0.5 && !has_river(mx, z_edge + side * 0.8) {
                            m.box_part(mx, -0.45, z_edge + side * 0.25, seg, 0.51, 0.5, quay);
                            m.box_part(mx, 0.06, z_edge + side * 0.35, seg, 0.18, 0.7, coping);
                            m.box_part(mx, 0.68, z_edge + side * 0.5, seg, 0.1, 0.14, rail);
                            if ((mx + 200.0) / 6.0).floor() != ((mx - seg + 200.0) / 6.0).floor() {
                                m.box_part(mx, 0.24, z_edge + side * 0.5, 0.36, 0.58, 0.36, bollard);
                            }
                        }
                        x += 2.0;
                    }
                }
                for (side, x_edge) in [(-1.0_f32, x0), (1.0, x1)] {
                    let mut z = z0;
                    while z < z1 - 0.01 {
                        let seg = (z1 - z).min(2.0);
                        let mz = z + seg * 0.5;
                        if (x_edge + side * 0.8).abs() <= r - 0.5 && !has_river(x_edge + side * 0.8, mz) {
                            m.box_part(x_edge + side * 0.25, -0.45, mz, 0.5, 0.51, seg, quay);
                            m.box_part(x_edge + side * 0.35, 0.06, mz, 0.7, 0.18, seg, coping);
                            m.box_part(x_edge + side * 0.5, 0.68, mz, 0.14, 0.1, seg, rail);
                            if ((mz + 200.0) / 6.0).floor() != ((mz - seg + 200.0) / 6.0).floor() {
                                m.box_part(x_edge + side * 0.5, 0.24, mz, 0.36, 0.58, 0.36, bollard);
                            }
                        }
                        z += 2.0;
                    }
                }
            }
            for &[bx, bz, bw, bd, axis] in &def.bridges {
                let east_west = axis == 1.0;
                let (road_w, span_len) = if east_west {
                    (bd as f32, bw as f32)
                } else {
                    (bw as f32, bd as f32)
                };
                m.at(
                    bx as f32,
                    0.0,
                    bz as f32,
                    if east_west { std::f32::consts::FRAC_PI_2 } else { 0.0 },
                );
                for pz in [-(span_len * 0.5 - 1.1), 0.0, span_len * 0.5 - 1.1] {
                    m.box_part(0.0, -0.45, pz, road_w + 1.2, 0.41, 1.3, pier);
                }
                m.box_part(0.0, -0.08, 0.0, road_w - 0.8, 0.12, span_len + 1.6, deck);
                let mut pz = -span_len * 0.5 - 0.4;
                while pz <= span_len * 0.5 + 0.4 {
                    m.box_part(0.0, 0.04, pz, road_w - 1.2, 0.025, 0.42, plank);
                    pz += 1.8;
                }
                for side in [-1.0_f32, 1.0] {
                    let rx = side * (road_w * 0.5 - 0.25);
                    m.box_part(side * (road_w * 0.5 - 0.55), 0.0, 0.0, 1.1, 0.16, span_len + 1.8, curb);
                    m.box_part(rx, 0.16, 0.0, 0.55, 0.56, span_len + 1.2, parapet);
                    m.box_part(rx, 1.25, 0.0, 0.24, 0.14, span_len + 1.2, iron);
                    let mut bz_i = -span_len * 0.5 + 0.5;
                    while bz_i <= span_len * 0.5 - 0.5 {
                        m.box_part(rx, 0.72, bz_i, 0.18, 0.54, 0.18, baluster);
                        bz_i += 2.0;
                    }
                    for ez in [-1.0_f32, 1.0] {
                        let lz = ez * (span_len * 0.5 + 0.55);
                        m.box_part(rx, 0.0, lz, 0.95, 2.1, 0.95, pillar);
                        m.box_part(rx, 2.1, lz, 1.12, 0.18, 1.12, pillar_cap);
                        m.box_part(rx, 2.28, lz, 0.52, 0.62, 0.52, lantern);
                        m.box_part(rx, 2.9, lz, 0.68, 0.16, 0.68, lantern_cap);
                    }
                }
                m.at(0.0, 0.0, 0.0, 0.0);
            }
        }
        let edge = r + 2.0;
        let full = (r + 4.0) * 2.0;
        for side in [-1.0_f32, 1.0] {
            m.box_part(side * edge, 0.0, 0.0, 4.0, 5.0, full, wall);
            m.box_part(0.0, 0.0, side * edge, full, 5.0, 4.0, wall);
            let mut i = -r + 6.0;
            while i < r {
                m.box_part(side * edge, 5.0, i, 4.0, 0.5, 5.0, trim);
                m.box_part(i, 5.0, side * edge, 5.0, 0.5, 4.0, trim);
                i += 15.0;
            }
        }
        for i in 0..16 {
            let a = i as f32 / 16.0 * std::f32::consts::TAU;
            m.at(a.sin() * (r + 22.0), 0.0, a.cos() * (r + 22.0), 0.0);
            m.box_part(0.0, 0.0, 0.0, 1.0, 16.0, 1.0, tower);
            m.box_part(0.0, 15.0, 0.0, 8.0, 1.0, 1.0, lamp);
            m.cone(0.0, 16.0, 0.0, 2.0, 3.0, wall, 4);
        }
    }

    m.at(0.0, 0.0, 0.0, 0.0);
    for &[bx, bz, bw, bd] in &def.blocks {
        let (x, z, w, d) = (bx as f32, bz as f32, bw as f32, bd as f32);
        m.box_part(x, 0.0, z, w, 6.0, d, wall);
        m.box_part(x, 6.0, z, w + 0.3, 0.35, d + 0.3, cap);
        let mut i = -w * 0.5 + 2.0;
        while i < w * 0.5 {
            m.box_part(x + i, 0.2, z - d * 0.5 - 0.05, 0.25, 5.6, 0.15, post);
            i += 3.0;
        }
    }
    m.finish()
}

pub fn xray_mesh(def: &ArenaDef) -> Mesh {
    let mut m = Builder::default();
    let wall = hex_linear("#b29a5d");
    let floor = hex_linear("#12313e");
    let th = 0.1_f32;
    let frame = |m: &mut Builder, x: f32, z: f32, w: f32, d: f32, h: f32| {
        for y in [0.08_f32, h] {
            for side in [-1.0_f32, 1.0] {
                m.box_part(x + side * w * 0.5, y, z, th, th, d, wall);
                m.box_part(x, y, z + side * d * 0.5, w, th, th, wall);
            }
        }
        for sx in [-1.0_f32, 1.0] {
            for sz in [-1.0_f32, 1.0] {
                m.box_part(x + sx * w * 0.5, 0.08, z + sz * d * 0.5, th, h, th, wall);
            }
        }
    };
    for &[bx, bz, bw, bd] in &def.blocks {
        frame(&mut m, bx as f32, bz as f32, bw as f32, bd as f32, 6.35);
    }
    let river_line = hex_linear("#4c91b8");
    let bridge_line = hex_linear("#d4b16a");
    for &[bx, bz, bw, bd] in &def.water {
        let (x, z, w, d) = (bx as f32, bz as f32, bw as f32, bd as f32);
        for side in [-1.0_f32, 1.0] {
            m.box_part(x + side * w * 0.5, 0.12, z, th, th, d, river_line);
            m.box_part(x, 0.12, z + side * d * 0.5, w, th, th, river_line);
        }
    }
    for &[bx, bz, bw, bd, axis] in &def.bridges {
        let east_west = axis == 1.0;
        let (road_w, span_len) = if east_west {
            (bd as f32, bw as f32)
        } else {
            (bw as f32, bd as f32)
        };
        m.at(
            bx as f32,
            0.0,
            bz as f32,
            if east_west { std::f32::consts::FRAC_PI_2 } else { 0.0 },
        );
        for side in [-1.0_f32, 1.0] {
            let rx = side * (road_w * 0.5 - 0.25);
            m.box_part(rx, 1.3, 0.0, th, th, span_len + 1.2, bridge_line);
            for ez in [-1.0_f32, 1.0] {
                m.box_part(rx, 0.08, ez * (span_len * 0.5 + 0.55), th, 2.2, th, bridge_line);
            }
        }
        m.at(0.0, 0.0, 0.0, 0.0);
    }
    let r = def.size as f32;
    if def.is_octagon() {
        let t = std::f32::consts::SQRT_2 - 1.0;
        let side = 2.0 * r * t;
        let corner = r * t;
        for i in 0..8 {
            m.at(0.0, 0.0, 0.0, i as f32 * std::f32::consts::FRAC_PI_4);
            for y in [0.08_f32, 5.0] {
                m.box_part(0.0, y, r, side, th, th, wall);
            }
            m.box_part(corner, 0.08, r, th, 5.0, th, wall);
            for ring in [r * 0.28, r * 0.59, r * 0.84] {
                m.box_part(0.0, 0.025, ring, 2.0 * ring * t, 0.025, 0.035, floor);
            }
        }
    } else {
        let full = (r + 4.0) * 2.0;
        for side in [-1.0_f32, 1.0] {
            frame(&mut m, side * (r + 2.0), 0.0, 4.0, full, 5.0);
            frame(&mut m, 0.0, side * (r + 2.0), full, 4.0, 5.0);
        }
        let mut n = -r;
        while n <= r {
            m.box_part(n, 0.025, 0.0, 0.035, 0.025, r * 2.0, floor);
            m.box_part(0.0, 0.025, n, r * 2.0, 0.025, 0.035, floor);
            n += 16.0;
        }
    }
    m.finish()
}

pub fn build(def: &ArenaDef, meshes: &mut Assets<Mesh>) -> (Handle<Mesh>, Handle<Mesh>, Color) {
    (
        meshes.add(scenery_mesh(def)),
        meshes.add(xray_mesh(def)),
        sky_color(&def.sky),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_valid_meshes_for_custom_square_and_octagon_arenas() {
        for shape in ["square", "octagon"] {
            let def = ArenaDef {
                name: format!("Custom {shape}"),
                desc: "Dynamic server map".into(),
                size: 56.0,
                shape: shape.into(),
                max_players: Some(4),
                ground: "#708090".into(),
                wall: "#cc5544".into(),
                sky: "#ddeeff".into(),
                blocks: vec![[0.0, 0.0, 10.0, 10.0]],
                water: vec![],
                bridges: vec![],
                spawns: vec![],
            };
            let solid = scenery_mesh(&def);
            let xray = xray_mesh(&def);
            assert!(solid.count_vertices() > 100);
            assert!(xray.count_vertices() > 50);
            assert_eq!(solid.count_vertices() % 3, 0);
            assert_eq!(xray.count_vertices() % 3, 0);
        }
    }

    #[test]
    fn builds_valid_meshes_for_river_and_bridge_arenas() {
        let def = ArenaDef {
            name: "Bridges of Königsberg".into(),
            desc: "River and bridges".into(),
            size: 96.0,
            shape: "square".into(),
            max_players: None,
            ground: "#a89f8d".into(),
            wall: "#7f7264".into(),
            sky: "#c6dce8".into(),
            blocks: vec![],
            water: vec![[-40.0, 0.0, 40.0, 12.0], [40.0, 0.0, 40.0, 12.0]],
            bridges: vec![[0.0, 0.0, 16.0, 12.0, 0.0]],
            spawns: vec![],
        };
        let solid = scenery_mesh(&def);
        let xray = xray_mesh(&def);
        assert!(solid.count_vertices() > 500);
        assert!(xray.count_vertices() > 100);
        assert_eq!(solid.count_vertices() % 3, 0);
        assert_eq!(xray.count_vertices() % 3, 0);
    }
}
