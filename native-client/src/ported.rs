//! Plays the graphics pack that `build.rs` ports from the browser renderer.
//! Nothing here is drawn by hand: models, animation frames and arenas all come
//! from the JavaScript client. See docs/native-graphics-port.md.
use bevy::{asset::RenderAssetUsages, mesh::PrimitiveTopology, prelude::*};
use std::collections::HashMap;

static PACK: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/graphics.wwgp"));
const VERSION: u32 = 1;
const TRIANGLE_BYTES: usize = 20;
/// The browser shader pitches models about this height and rolls them about `ROLL_PIVOT`.
const PITCH_PIVOT: f32 = 2.0;
const ROLL_PIVOT: f32 = 0.9;

pub type Tint = [u8; 3];

struct Reader<'a>(&'a [u8]);
impl<'a> Reader<'a> {
    fn take(&mut self, count: usize) -> Option<&'a [u8]> {
        let (head, tail) = self.0.split_at_checked(count)?;
        self.0 = tail;
        Some(head)
    }
    fn u16(&mut self) -> Option<usize> {
        Some(u16::from_le_bytes(self.take(2)?.try_into().ok()?) as usize)
    }
    fn u32(&mut self) -> Option<u32> {
        Some(u32::from_le_bytes(self.take(4)?.try_into().ok()?))
    }
    fn f32(&mut self) -> Option<f32> {
        Some(f32::from_le_bytes(self.take(4)?.try_into().ok()?))
    }
}

/// The browser's yaw, pitch and roll model placement as one transform.
pub fn placement(position: Vec3, angle: f32, pitch: f32, roll: f32) -> Transform {
    let about = |pivot: f32, rotation: Quat| {
        Mat4::from_translation(Vec3::Y * pivot)
            * Mat4::from_quat(rotation)
            * Mat4::from_translation(Vec3::Y * -pivot)
    };
    Transform::from_matrix(
        Mat4::from_translation(position)
            * Mat4::from_rotation_y(angle)
            * about(PITCH_PIVOT, Quat::from_rotation_x(pitch))
            * about(ROLL_PIVOT, Quat::from_rotation_z(roll)),
    )
}

struct MeshData {
    scale: f32,
    triangles: &'static [u8],
}
struct Part {
    mesh: u32,
    glow: bool,
    transform: Transform,
}
struct Clip {
    fps: f32,
    frames: Vec<Vec<Part>>,
}
pub struct Arena {
    pub sky: Color,
    pub mesh: u32,
}

#[derive(Resource)]
pub struct Graphics {
    palette: Vec<Tint>,
    meshes: Vec<MeshData>,
    clips: Vec<Clip>,
    names: HashMap<String, usize>,
    arenas: Vec<Arena>,
    built: HashMap<(u32, Tint), Handle<Mesh>>,
    solid: Handle<StandardMaterial>,
    glow: Handle<StandardMaterial>,
}
impl Graphics {
    fn parse(bytes: &'static [u8]) -> Option<Self> {
        let mut r = Reader(bytes);
        if r.take(4)? != b"WWGP" || r.u32()? != VERSION {
            return None;
        }
        let palette = (0..r.u32()?)
            .map(|_| r.take(3)?.try_into().ok())
            .collect::<Option<Vec<Tint>>>()?;
        let mut meshes = Vec::new();
        for _ in 0..r.u32()? {
            let scale = r.f32()?;
            let count = r.u32()? as usize;
            let triangles = r.take(count.checked_mul(TRIANGLE_BYTES)?)?;
            let valid = triangles
                .chunks_exact(TRIANGLE_BYTES)
                .all(|t| usize::from(u16::from_le_bytes([t[18], t[19]])) < palette.len());
            if !valid {
                return None;
            }
            meshes.push(MeshData { scale, triangles });
        }
        let mut clips = Vec::new();
        for _ in 0..r.u32()? {
            let fps = r.f32()?;
            let mut frames = Vec::new();
            for _ in 0..r.u32()? {
                let mut parts = Vec::new();
                for _ in 0..r.u16()? {
                    let mesh = r.u32()?;
                    let glow = r.u32()? == 1;
                    let position = Vec3::new(r.f32()?, r.f32()?, r.f32()?);
                    let transform = placement(position, r.f32()?, r.f32()?, r.f32()?);
                    if mesh as usize >= meshes.len() {
                        return None;
                    }
                    parts.push(Part {
                        mesh,
                        glow,
                        transform,
                    });
                }
                frames.push(parts);
            }
            if frames.is_empty() || !fps.is_finite() || fps <= 0.0 {
                return None;
            }
            clips.push(Clip { fps, frames });
        }
        let mut names = HashMap::new();
        for _ in 0..r.u32()? {
            let size = r.u16()?;
            let name = std::str::from_utf8(r.take(size)?).ok()?;
            let clip = r.u32()? as usize;
            if clip >= clips.len() {
                return None;
            }
            names.insert(name.to_owned(), clip);
        }
        let mut arenas = Vec::new();
        for _ in 0..r.u32()? {
            let sky = r.take(3)?;
            let mesh = r.u32()?;
            if mesh as usize >= meshes.len() {
                return None;
            }
            arenas.push(Arena {
                sky: Color::srgb_u8(sky[0], sky[1], sky[2]),
                mesh,
            });
        }
        Some(Self {
            palette,
            meshes,
            clips,
            names,
            arenas,
            built: HashMap::new(),
            solid: Handle::default(),
            glow: Handle::default(),
        })
    }
    pub fn clip(&self, name: &str) -> Option<usize> {
        self.names.get(name).copied()
    }
    pub fn arena(&self, index: usize) -> Option<&Arena> {
        self.arenas.get(index)
    }
    pub fn solid(&self) -> Handle<StandardMaterial> {
        self.solid.clone()
    }
    /// Triangles with palette entry 0 follow the racer's color.
    fn geometry(&self, mesh: u32, tint: Tint) -> Mesh {
        let data = &self.meshes[mesh as usize];
        let count = data.triangles.len() / TRIANGLE_BYTES * 3;
        let mut positions = Vec::with_capacity(count);
        let mut normals = Vec::with_capacity(count);
        let mut colors = Vec::with_capacity(count);
        for triangle in data.triangles.chunks_exact(TRIANGLE_BYTES) {
            let number = |i: usize| i16::from_le_bytes([triangle[i * 2], triangle[i * 2 + 1]]);
            let corner = |i: usize| {
                Vec3::new(
                    f32::from(number(i * 3)),
                    f32::from(number(i * 3 + 1)),
                    f32::from(number(i * 3 + 2)),
                ) * data.scale
            };
            let (a, b, c) = (corner(0), corner(1), corner(2));
            let normal = (b - a).cross(c - a).normalize_or_zero().to_array();
            let [red, green, blue] = match u16::from_le_bytes([triangle[18], triangle[19]]) {
                0 => tint,
                index => self.palette[usize::from(index)],
            };
            let color = Color::srgb_u8(red, green, blue).to_linear().to_f32_array();
            for point in [a, b, c] {
                positions.push(point.to_array());
                normals.push(normal);
                colors.push(color);
            }
        }
        Mesh::new(
            PrimitiveTopology::TriangleList,
            RenderAssetUsages::RENDER_WORLD,
        )
        .with_inserted_attribute(Mesh::ATTRIBUTE_POSITION, positions)
        .with_inserted_attribute(Mesh::ATTRIBUTE_NORMAL, normals)
        .with_inserted_attribute(Mesh::ATTRIBUTE_COLOR, colors)
    }
    pub fn mesh(&mut self, mesh: u32, tint: Tint, meshes: &mut Assets<Mesh>) -> Handle<Mesh> {
        if let Some(handle) = self.built.get(&(mesh, tint)) {
            return handle.clone();
        }
        let handle = meshes.add(self.geometry(mesh, tint));
        self.built.insert((mesh, tint), handle.clone());
        handle
    }
}

/// `#rrggbb` as sent by the server.
pub fn tint(color: &str) -> Option<Tint> {
    let digits = color.strip_prefix('#').filter(|d| d.len() == 6)?;
    let channel = |i: usize| u8::from_str_radix(digits.get(i..i + 2)?, 16).ok();
    Some([channel(0)?, channel(2)?, channel(4)?])
}

/// Plays one ported clip beneath this entity. `None` draws nothing.
#[derive(Component, Default)]
pub struct Ported {
    pub clip: Option<usize>,
    pub tint: Tint,
    parts: Vec<Entity>,
}
impl Ported {
    pub fn new(clip: Option<usize>, tint: Tint) -> Self {
        Self {
            clip,
            tint,
            parts: Vec::new(),
        }
    }
}

pub struct PortedGraphicsPlugin;
impl Plugin for PortedGraphicsPlugin {
    fn build(&self, app: &mut App) {
        let mut graphics = Graphics::parse(PACK).expect("the ported graphics pack is valid");
        let mut materials = app.world_mut().resource_mut::<Assets<StandardMaterial>>();
        // The browser paints every face, whichever way it winds.
        graphics.solid = materials.add(StandardMaterial {
            perceptual_roughness: 1.0,
            reflectance: 0.0,
            double_sided: true,
            cull_mode: None,
            ..default()
        });
        graphics.glow = materials.add(StandardMaterial {
            unlit: true,
            alpha_mode: AlphaMode::Add,
            double_sided: true,
            cull_mode: None,
            ..default()
        });
        app.insert_resource(graphics);
    }
}

type PartQuery<'w, 's> = Query<
    'w,
    's,
    (
        &'static mut Mesh3d,
        &'static mut MeshMaterial3d<StandardMaterial>,
        &'static mut Transform,
        &'static mut Visibility,
    ),
    Without<Ported>,
>;

pub fn animate(
    mut commands: Commands,
    time: Res<Time>,
    mut graphics: ResMut<Graphics>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut players: Query<(Entity, &mut Ported)>,
    mut parts: PartQuery,
) {
    let graphics = &mut *graphics;
    for (entity, mut player) in &mut players {
        let frame = player.clip.map(|clip| {
            let clip = &graphics.clips[clip];
            let index = (time.elapsed_secs() * clip.fps) as usize % clip.frames.len();
            &clip.frames[index]
        });
        let frame = frame.map(Vec::as_slice).unwrap_or_default();
        for (slot, part) in frame.iter().enumerate() {
            let key = (part.mesh, player.tint);
            let mesh = match graphics.built.get(&key) {
                Some(handle) => handle.clone(),
                None => {
                    let handle = meshes.add(graphics.geometry(part.mesh, player.tint));
                    graphics.built.insert(key, handle.clone());
                    handle
                }
            };
            let material = match part.glow {
                true => graphics.glow.clone(),
                false => graphics.solid.clone(),
            };
            match player.parts.get(slot) {
                Some(child) => {
                    let Ok((mut shown, mut surface, mut transform, mut visibility)) =
                        parts.get_mut(*child)
                    else {
                        continue;
                    };
                    if shown.0 != mesh {
                        shown.0 = mesh;
                    }
                    if surface.0 != material {
                        surface.0 = material;
                    }
                    *transform = part.transform;
                    visibility.set_if_neq(Visibility::Inherited);
                }
                None => {
                    let child = commands
                        .spawn((
                            Mesh3d(mesh),
                            MeshMaterial3d(material),
                            part.transform,
                            ChildOf(entity),
                        ))
                        .id();
                    player.parts.push(child);
                }
            }
        }
        for child in player.parts.iter().skip(frame.len()) {
            if let Ok((_, _, _, mut visibility)) = parts.get_mut(*child) {
                visibility.set_if_neq(Visibility::Hidden);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_pack_ports_every_racer_and_arena() {
        let graphics = Graphics::parse(PACK).expect("valid pack");
        assert_eq!(graphics.arenas.len(), 2);
        for driver in 0..15 {
            for state in ["idle", "boost"] {
                let clip = graphics
                    .clip(&format!("driver:{driver}:{state}"))
                    .expect("racer clip");
                assert!(graphics.clips[clip].frames.iter().all(|f| !f.is_empty()));
            }
            assert!(graphics.clip(&format!("shot:vulcan:{driver}")).is_some());
        }
        for name in [
            "shot:missile",
            "shot:hedgehog",
            "wreck",
            "pickup:health",
            "health:3",
        ] {
            assert!(graphics.clip(name).is_some(), "{name}");
        }
    }

    #[test]
    fn racer_color_recolors_only_tinted_triangles() {
        let graphics = Graphics::parse(PACK).expect("valid pack");
        let clip = &graphics.clips[graphics.clip("driver:0:idle").unwrap()];
        let colors = |tint| {
            let mesh = graphics.geometry(clip.frames[0][0].mesh, tint);
            let Some(bevy::mesh::VertexAttributeValues::Float32x4(colors)) =
                mesh.attribute(Mesh::ATTRIBUTE_COLOR)
            else {
                panic!("vertex colors");
            };
            colors.clone()
        };
        let (red, blue) = (colors([255, 0, 0]), colors([0, 0, 255]));
        let changed = red.iter().zip(&blue).filter(|(a, b)| a != b).count();
        assert!(changed > 0 && changed < red.len());
    }

    #[test]
    fn placement_matches_the_browser_shader() {
        // Pitching a quarter turn about y=2 carries the pivot's forward point straight down.
        let moved = placement(
            Vec3::new(5.0, 0.0, 0.0),
            0.0,
            std::f32::consts::FRAC_PI_2,
            0.0,
        )
        .transform_point(Vec3::new(0.0, 2.0, 1.0));
        assert!(moved.distance(Vec3::new(5.0, 1.0, 0.0)) < 1e-5);
        assert_eq!(tint("#8456cf"), Some([0x84, 0x56, 0xcf]));
        assert_eq!(tint("purple"), None);
    }
}
