//! Plays the graphics pack that `build.rs` ports from the browser renderer.
//! Nothing here is drawn by hand: models, animation frames, particles and arenas
//! all come from the JavaScript client. See docs/native-graphics-port.md.
use bevy::{
    asset::RenderAssetUsages,
    camera::visibility::{NoFrustumCulling, RenderLayers},
    image::Image,
    mesh::{Indices, PrimitiveTopology},
    prelude::*,
    render::render_resource::{Extent3d, TextureDimension, TextureFormat},
};
use crossbeam_channel::{Receiver, Sender, unbounded};
use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, atomic::Ordering},
};

static PACK: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/graphics.wwgp"));
const VERSION: u32 = 6;
/// Clip frames ahead of the one shown whose meshes are built in advance.
const LOOKAHEAD: usize = 4;
/// Meshes unused for this long are released; one shown again is rebuilt.
const KEEP_SECONDS: f32 = 12.0;
const TRIANGLE_BYTES: usize = 20;
const SPRITE_BYTES: usize = 28;
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
    fn text(&mut self) -> Option<String> {
        let size = self.u16()?;
        Some(std::str::from_utf8(self.take(size)?).ok()?.to_owned())
    }
    fn vec3(&mut self) -> Option<Vec3> {
        Some(Vec3::new(self.f32()?, self.f32()?, self.f32()?))
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

/// One mesh's triangles, compressed; they are inflated only when the mesh is built.
struct MeshData {
    scale: f32,
    count: usize,
    packed: &'static [u8],
}
/// What a mesh is built from. Shared with build tasks on other threads.
struct Source {
    palette: Vec<Tint>,
    meshes: Vec<MeshData>,
}
/// A built mesh: which pack mesh, in which racer color, and how it is shaded.
type Key = (u32, Tint, Look);
/// A mesh built on another thread, waiting to be added to the assets.
type Finished = (Key, Mesh);
struct Built {
    handle: Handle<Mesh>,
    /// Seconds since launch when the mesh was last shown or prefetched.
    used: f32,
}
struct Part {
    mesh: u32,
    glow: bool,
    transform: Transform,
}
/// Sprites are the browser's point particles: x, y, z, size and color as `f32`s.
struct Frame {
    parts: Vec<Part>,
    sprites: [&'static [u8]; 2],
}
struct Clip {
    fps: f32,
    once: bool,
    frames: Vec<Frame>,
}
pub struct Arena {
    pub sky: Color,
    pub mesh: u32,
    /// Outlines of the arena that KnowItOwl sees through Dark Humor.
    pub xray: u32,
    pub name: String,
    pub description: String,
}
pub struct Racer {
    pub name: String,
    pub description: String,
    pub color: Tint,
    /// The special ability's name; empty for racers without one.
    pub ability: String,
    pub intelligence: u8,
    /// Title, line and color of the announcement when the ability is used.
    pub card: (String, String, Tint),
}
/// How a mesh is colored and shaded.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Default)]
pub enum Look {
    /// Lit, in the browser's colors.
    #[default]
    Solid,
    /// Added to the picture unlit, such as flames.
    Glow,
    /// Unlit, in the browser's colors.
    Flat,
    /// One flat color: a racer seen through Dark Humor.
    Silhouette,
}

#[derive(Resource)]
pub struct Graphics {
    source: Arc<Source>,
    clips: Vec<Clip>,
    names: HashMap<String, usize>,
    arenas: Vec<Arena>,
    racers: Vec<Racer>,
    built: HashMap<Key, Built>,
    /// Meshes being built on the async compute pool.
    pending: HashSet<Key>,
    finished: (Sender<Finished>, Receiver<Finished>),
    /// Seconds since launch, as of the last frame.
    now: f32,
    /// One material per `Look`, in declaration order.
    surfaces: [Handle<StandardMaterial>; 4],
    /// Additive sparks and alpha-blended smoke, in the browser's draw order.
    sprites: [Handle<StandardMaterial>; 2],
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
            let size = r.u32()? as usize;
            meshes.push(MeshData {
                scale,
                count,
                packed: r.take(size)?,
            });
        }
        // Clips are one compressed block, inflated once and kept for the whole run.
        let raw = r.u32()? as usize;
        let size = r.u32()? as usize;
        let block =
            miniz_oxide::inflate::decompress_to_vec_zlib_with_limit(r.take(size)?, raw).ok()?;
        if block.len() != raw {
            return None;
        }
        let block: &'static [u8] = Box::leak(block.into_boxed_slice());
        let mut c = Reader(block);
        let mut clips = Vec::new();
        for _ in 0..c.u32()? {
            let fps = c.f32()?;
            let once = c.u32()? == 1;
            let mut frames = Vec::new();
            for _ in 0..c.u32()? {
                let mut parts = Vec::new();
                for _ in 0..c.u16()? {
                    let mesh = c.u32()?;
                    let glow = c.u32()? == 1;
                    let (x, y, z, origin) = (c.vec3()?, c.vec3()?, c.vec3()?, c.vec3()?);
                    if mesh as usize >= meshes.len() {
                        return None;
                    }
                    parts.push(Part {
                        mesh,
                        glow,
                        transform: Transform::from_matrix(Mat4::from_cols(
                            x.extend(0.0),
                            y.extend(0.0),
                            z.extend(0.0),
                            origin.extend(1.0),
                        )),
                    });
                }
                let mut sprites = [&[][..]; 2];
                for layer in &mut sprites {
                    let count = c.u32()? as usize;
                    *layer = c.take(count.checked_mul(SPRITE_BYTES)?)?;
                }
                frames.push(Frame { parts, sprites });
            }
            if frames.is_empty() || !fps.is_finite() || fps <= 0.0 {
                return None;
            }
            clips.push(Clip { fps, once, frames });
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
            let xray = r.u32()?;
            if mesh.max(xray) as usize >= meshes.len() {
                return None;
            }
            arenas.push(Arena {
                sky: Color::srgb_u8(sky[0], sky[1], sky[2]),
                mesh,
                xray,
                name: r.text()?,
                description: r.text()?,
            });
        }
        let mut racers = Vec::new();
        for _ in 0..r.u32()? {
            racers.push(Racer {
                name: r.text()?,
                description: r.text()?,
                color: r.take(3)?.try_into().ok()?,
                ability: r.text()?,
                intelligence: r.take(1)?[0],
                card: (r.text()?, r.text()?, r.take(3)?.try_into().ok()?),
            });
        }
        Some(Self {
            source: Arc::new(Source { palette, meshes }),
            clips,
            names,
            arenas,
            racers,
            built: HashMap::new(),
            pending: HashSet::new(),
            finished: unbounded(),
            now: 0.0,
            surfaces: Default::default(),
            sprites: [Handle::default(), Handle::default()],
        })
    }
    pub fn clip(&self, name: &str) -> Option<usize> {
        self.names.get(name).copied()
    }
    pub fn arena(&self, index: usize) -> Option<&Arena> {
        self.arenas.get(index)
    }
    pub fn arenas(&self) -> &[Arena] {
        &self.arenas
    }
    pub fn racers(&self) -> &[Racer] {
        &self.racers
    }
    pub fn surface(&self, look: Look) -> Handle<StandardMaterial> {
        self.surfaces[look as usize].clone()
    }
    /// Builds a mesh now, on this thread. Used for the arena, which is needed at once.
    pub fn mesh(
        &mut self,
        mesh: u32,
        tint: Tint,
        look: Look,
        meshes: &mut Assets<Mesh>,
    ) -> Handle<Mesh> {
        let key = (mesh, tint, look);
        if let Some(built) = self.built.get_mut(&key) {
            built.used = self.now;
            return built.handle.clone();
        }
        let handle = meshes.add(geometry(&self.source, key));
        let used = self.now;
        self.built.insert(
            key,
            Built {
                handle: handle.clone(),
                used,
            },
        );
        handle
    }
    /// The mesh if it is built; otherwise it is queued for the async compute pool.
    fn ready(&mut self, key: Key) -> Option<Handle<Mesh>> {
        if let Some(built) = self.built.get_mut(&key) {
            built.used = self.now;
            return Some(built.handle.clone());
        }
        if self.pending.insert(key) {
            let (source, done) = (self.source.clone(), self.finished.0.clone());
            bevy::tasks::AsyncComputeTaskPool::get()
                .spawn(async move {
                    let started = std::time::Instant::now();
                    let mesh = geometry(&source, key);
                    crate::bench::MESH_BUILD_NANOS
                        .fetch_add(started.elapsed().as_nanos() as u64, Ordering::Relaxed);
                    let _ = done.send((key, mesh));
                })
                .detach();
        }
        None
    }
    /// Adds meshes finished on other threads and releases ones not shown lately.
    fn collect(&mut self, now: f32, meshes: &mut Assets<Mesh>) {
        self.now = now;
        while let Ok((key, mesh)) = self.finished.1.try_recv() {
            self.pending.remove(&key);
            crate::bench::MESHES_BUILT.fetch_add(1, Ordering::Relaxed);
            let handle = meshes.add(mesh);
            self.built.insert(key, Built { handle, used: now });
        }
        // Entities still showing a released mesh keep it alive until they move on.
        self.built
            .retain(|_, built| now - built.used < KEEP_SECONDS);
    }
}

/// Inflates one pack mesh and builds it. Triangles with palette entry 0 follow the
/// racer's color; glow colors are added to the picture as they are, as the
/// browser's additive pass does. A damaged mesh builds empty instead of panicking.
fn geometry(source: &Source, (mesh, tint, look): Key) -> Mesh {
    let data = &source.meshes[mesh as usize];
    let triangles = miniz_oxide::inflate::decompress_to_vec_zlib_with_limit(
        data.packed,
        data.count * TRIANGLE_BYTES,
    )
    .unwrap_or_default();
    let count = triangles.len() / TRIANGLE_BYTES * 3;
    let mut positions = Vec::with_capacity(count);
    let mut normals = Vec::with_capacity(count);
    let mut colors = Vec::with_capacity(count);
    for triangle in triangles.chunks_exact(TRIANGLE_BYTES) {
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
        let [red, green, blue] = match usize::from(u16::from_le_bytes([triangle[18], triangle[19]]))
        {
            0 => tint,
            index => match source.palette.get(index) {
                Some(color) => *color,
                None => continue,
            },
        };
        let color = match look {
            Look::Glow => [red, green, blue, 255].map(|c| f32::from(c) / 255.0),
            Look::Silhouette => [1.0; 4],
            _ => Color::srgb_u8(red, green, blue).to_linear().to_f32_array(),
        };
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

/// Camera-facing quads for one frame's point sprites, in the clip's own space.
/// `right` and `up` are the camera's axes there, scaled by half a unit sprite.
fn billboards(sprites: &[u8], smoke: bool, right: Vec3, up: Vec3) -> Mesh {
    let count = sprites.len() / SPRITE_BYTES;
    let mut positions = Vec::with_capacity(count * 4);
    let mut colors = Vec::with_capacity(count * 4);
    let mut uvs = Vec::with_capacity(count * 4);
    let mut indices = Vec::with_capacity(count * 6);
    for (i, sprite) in sprites.chunks_exact(SPRITE_BYTES).enumerate() {
        let value = |k: usize| {
            f32::from_le_bytes([
                sprite[k * 4],
                sprite[k * 4 + 1],
                sprite[k * 4 + 2],
                sprite[k * 4 + 3],
            ])
        };
        let center = Vec3::new(value(0), value(1), value(2));
        let color = match smoke {
            true => {
                let [r, g, b, _] = Color::srgb(value(4), value(5), value(6))
                    .to_linear()
                    .to_f32_array();
                [r, g, b, 0.5]
            }
            false => [value(4), value(5), value(6), 1.0],
        };
        for (x, y) in [(-1.0, -1.0), (1.0, -1.0), (1.0, 1.0), (-1.0, 1.0)] {
            positions.push((center + (right * x + up * y) * value(3)).to_array());
            colors.push(color);
            uvs.push([x * 0.5 + 0.5, y * 0.5 + 0.5]);
        }
        let base = i as u32 * 4;
        indices.extend([base, base + 1, base + 2, base, base + 2, base + 3]);
    }
    Mesh::new(
        PrimitiveTopology::TriangleList,
        RenderAssetUsages::default(),
    )
    .with_inserted_attribute(Mesh::ATTRIBUTE_NORMAL, vec![[0.0, 1.0, 0.0]; count * 4])
    .with_inserted_attribute(Mesh::ATTRIBUTE_POSITION, positions)
    .with_inserted_attribute(Mesh::ATTRIBUTE_COLOR, colors)
    .with_inserted_attribute(Mesh::ATTRIBUTE_UV_0, uvs)
    .with_inserted_indices(Indices::U32(indices))
}
/// The browser particle shader's soft disc, stored in the alpha channel.
fn sprite_texture() -> Image {
    const SIZE: u32 = 64;
    let mut data = Vec::with_capacity((SIZE * SIZE * 4) as usize);
    for y in 0..SIZE {
        for x in 0..SIZE {
            let p = (Vec2::new(x as f32, y as f32) + 0.5) / SIZE as f32 * 2.0 - 1.0;
            let r = p.length();
            let edge = ((r - 0.65) / 0.35).clamp(0.0, 1.0);
            let glow = (-r * r * 3.5).exp() * (1.0 - edge * edge * (3.0 - 2.0 * edge));
            data.extend([255, 255, 255, (glow * 255.0).round() as u8]);
        }
    }
    Image::new(
        Extent3d {
            width: SIZE,
            height: SIZE,
            depth_or_array_layers: 1,
        },
        TextureDimension::D2,
        data,
        TextureFormat::Rgba8Unorm,
        RenderAssetUsages::RENDER_WORLD,
    )
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
    /// Seconds into the clip; `None` follows the shared animation clock.
    pub time: Option<f32>,
    /// Drawn as a flat silhouette on the X-ray layer instead of in the world.
    pub ghost: bool,
    parts: Vec<Entity>,
    sprites: [Option<(Entity, Handle<Mesh>)>; 2],
    /// What each sprite layer was last built for: clip, frame, facing and field of view.
    built: [Option<(usize, usize, Quat, f32)>; 2],
}
impl Ported {
    pub fn new(clip: Option<usize>, tint: Tint, time: Option<f32>) -> Self {
        Self {
            clip,
            tint,
            time,
            ..default()
        }
    }
}

pub struct PortedGraphicsPlugin;
impl Plugin for PortedGraphicsPlugin {
    fn build(&self, app: &mut App) {
        let mut graphics = Graphics::parse(PACK).expect("the ported graphics pack is valid");
        let texture = app
            .world_mut()
            .resource_mut::<Assets<Image>>()
            .add(sprite_texture());
        let mut materials = app.world_mut().resource_mut::<Assets<StandardMaterial>>();
        // The browser paints every face, whichever way it winds.
        let surface = StandardMaterial {
            perceptual_roughness: 1.0,
            reflectance: 0.0,
            double_sided: true,
            cull_mode: None,
            ..default()
        };
        let glow = materials.add(StandardMaterial {
            unlit: true,
            alpha_mode: AlphaMode::Add,
            ..surface.clone()
        });
        let flat = materials.add(StandardMaterial {
            unlit: true,
            ..surface.clone()
        });
        // The browser's X-ray tint, between its facing and rim colors.
        let silhouette = materials.add(StandardMaterial {
            unlit: true,
            base_color: Color::srgb(0.26, 0.74, 0.79),
            ..surface.clone()
        });
        graphics.sprites = [AlphaMode::Add, AlphaMode::Blend].map(|alpha_mode| {
            materials.add(StandardMaterial {
                unlit: true,
                alpha_mode,
                base_color_texture: Some(texture.clone()),
                ..surface.clone()
            })
        });
        graphics.surfaces = [materials.add(surface), glow, flat, silhouette];
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
    (Without<Ported>, Without<crate::scene::FollowCamera>),
>;
type CameraQuery<'w, 's> = Single<
    'w,
    's,
    (&'static Transform, &'static Projection),
    (With<crate::scene::FollowCamera>, Without<Ported>),
>;

pub fn animate(
    mut commands: Commands,
    time: Res<Time>,
    mut graphics: ResMut<Graphics>,
    mut meshes: ResMut<Assets<Mesh>>,
    camera: CameraQuery,
    mut players: Query<(Entity, &mut Ported, &Transform)>,
    mut parts: PartQuery,
) {
    let graphics = &mut *graphics;
    graphics.collect(time.elapsed_secs(), &mut meshes);
    let (view, projection) = *camera;
    // A sprite of size 1 is as tall as the browser draws it at the current field of view.
    let reach = match projection {
        Projection::Perspective(perspective) => (perspective.fov / 2.0).tan(),
        _ => 0.5,
    };
    for (entity, mut player, root) in &mut players {
        let player = &mut *player;
        let look_of = |glow: bool| match (player.ghost, glow) {
            (_, true) => Look::Glow,
            (true, false) => Look::Silhouette,
            (false, false) => Look::Solid,
        };
        let position = player.clip.map(|clip| {
            let frames = graphics.clips[clip].frames.len();
            let index = (player.time.unwrap_or(time.elapsed_secs()).max(0.0)
                * graphics.clips[clip].fps) as usize;
            let once = graphics.clips[clip].once;
            let at = move |index: usize| match once {
                true => index.min(frames - 1),
                false => index % frames,
            };
            // Build the next few frames' meshes now, so they are ready when shown.
            for ahead in 1..=LOOKAHEAD {
                let parts = graphics.clips[clip].frames[at(index + ahead)].parts.len();
                for slot in 0..parts {
                    let part = &graphics.clips[clip].frames[at(index + ahead)].parts[slot];
                    let key = (part.mesh, player.tint, look_of(part.glow));
                    let _ = graphics.ready(key);
                }
            }
            (clip, at(index))
        });
        let shown = position.map_or(0, |(clip, index)| {
            graphics.clips[clip].frames[index].parts.len()
        });
        for slot in 0..shown {
            let (clip, index) = position.unwrap_or_default();
            let (key, transform) = {
                let part = &graphics.clips[clip].frames[index].parts[slot];
                ((part.mesh, player.tint, look_of(part.glow)), part.transform)
            };
            // Until a mesh is built, a part keeps showing what it showed before.
            let mesh = graphics.ready(key);
            let material = graphics.surface(key.2);
            match player.parts.get(slot) {
                Some(child) => {
                    let Ok((mut shown, mut surface, mut placed, mut visibility)) =
                        parts.get_mut(*child)
                    else {
                        continue;
                    };
                    let Some(mesh) = mesh else {
                        continue;
                    };
                    if shown.0 != mesh {
                        shown.0 = mesh;
                    }
                    if surface.0 != material {
                        surface.0 = material;
                    }
                    *placed = transform;
                    visibility.set_if_neq(Visibility::Inherited);
                }
                None => {
                    let visibility = match mesh.is_some() {
                        true => Visibility::Inherited,
                        false => Visibility::Hidden,
                    };
                    let child = commands
                        .spawn((
                            Mesh3d(mesh.unwrap_or_default()),
                            MeshMaterial3d(material),
                            transform,
                            visibility,
                            RenderLayers::layer(usize::from(player.ghost)),
                            ChildOf(entity),
                        ))
                        .id();
                    player.parts.push(child);
                }
            }
        }
        for child in player.parts.iter().skip(shown) {
            if let Ok((_, _, _, mut visibility)) = parts.get_mut(*child) {
                visibility.set_if_neq(Visibility::Hidden);
            }
        }
        // Billboards face the camera from the clip's own space. They are rebuilt only
        // when the clip frame changes or the view turns, not on every rendered frame.
        let facing = root.rotation.inverse() * view.rotation;
        let (right, up) = (facing * Vec3::X * reach, facing * Vec3::Y * reach);
        for layer in 0..2 {
            let sprites = match (player.ghost, position) {
                (false, Some((clip, index))) => graphics.clips[clip].frames[index].sprites[layer],
                _ => &[][..],
            };
            let stamp = position.map(|(clip, index)| (clip, index, facing, reach));
            let stale = match (player.built[layer], stamp) {
                (Some((clip, index, was, fov)), Some((now_clip, now_index, now, now_fov))) => {
                    clip != now_clip
                        || index != now_index
                        || was.angle_between(now) > 0.01
                        || (fov - now_fov).abs() > 1e-3
                }
                _ => true,
            };
            match &player.sprites[layer] {
                Some((child, handle)) => {
                    // An empty mesh cannot be uploaded, so an idle layer is hidden instead.
                    let wanted = match sprites.is_empty() {
                        true => Visibility::Hidden,
                        false => Visibility::Inherited,
                    };
                    if let Ok((_, _, _, mut visibility)) = parts.get_mut(*child) {
                        visibility.set_if_neq(wanted);
                    }
                    if stale
                        && !sprites.is_empty()
                        && let Some(mut mesh) = meshes.get_mut(handle)
                    {
                        *mesh = billboards(sprites, layer == 1, right, up);
                        player.built[layer] = stamp;
                        crate::bench::SPRITE_MESHES.fetch_add(1, Ordering::Relaxed);
                    }
                }
                None if sprites.is_empty() => {}
                None => {
                    let handle = meshes.add(billboards(sprites, layer == 1, right, up));
                    player.built[layer] = stamp;
                    let child = commands
                        .spawn((
                            Mesh3d(handle.clone()),
                            MeshMaterial3d(graphics.sprites[layer].clone()),
                            Transform::default(),
                            NoFrustumCulling,
                            ChildOf(entity),
                        ))
                        .id();
                    player.sprites[layer] = Some((child, handle));
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_pack_ports_every_racer_state_and_arena() {
        let graphics = Graphics::parse(PACK).expect("valid pack");
        assert_eq!(graphics.arenas.len(), 2);
        assert_eq!(graphics.racers().len(), 15);
        assert_eq!(graphics.racers()[0].name, "Pip the Panda");
        assert_eq!(graphics.racers()[14].ability, "DARK HUMOR");
        assert!(graphics.racers()[0].ability.is_empty());
        assert_eq!(graphics.racers()[14].card.0, "DARK HUMOR");
        assert_eq!(graphics.racers()[0].intelligence, 3);
        for driver in 0..15 {
            for state in ["idle", "boost", "celebrate"] {
                let clip = graphics
                    .clip(&format!("driver:{driver}:{state}"))
                    .expect("racer clip");
                assert!(
                    graphics.clips[clip]
                        .frames
                        .iter()
                        .all(|f| !f.parts.is_empty())
                );
            }
            for state in ["shield", "hedge", "tehilim", "dizzy", "vulcan"] {
                assert!(
                    graphics
                        .clip(&format!("overlay:{driver}:{state}"))
                        .is_some()
                );
            }
            assert!(graphics.clip(&format!("shot:vulcan:{driver}")).is_some());
            assert!(graphics.clip(&format!("effect:ash:{driver}")).is_some());
        }
        for name in [
            "shot:missile",
            "shot:hedgehog",
            "wreck",
            "pickup:health",
            "pickup:bicycle",
            "health:3",
            "effect:explosion",
            "effect:default",
            "effect:fireRing:blue",
            "bomb:stink",
            "cloud:chaff:fairy",
            "particle:spark:2",
            "locust:jump",
            "timestop",
            "overlay:xylophone",
            "trail:missile",
            "trail:hedgehog",
            "trail:vulcan:5",
            "skid:0",
            "skid:1",
            "overlay:7:special",
            "overlay:11:special",
        ] {
            assert!(graphics.clip(name).is_some(), "{name}");
        }
    }

    #[test]
    fn effects_play_once_and_particles_are_ported() {
        let graphics = Graphics::parse(PACK).expect("valid pack");
        let explosion = &graphics.clips[graphics.clip("effect:explosion").unwrap()];
        assert!(explosion.once);
        assert!((explosion.frames.len() as f32 / explosion.fps - 2.5).abs() < 0.1);
        let boost = &graphics.clips[graphics.clip("driver:5:boost").unwrap()];
        assert!(!boost.once);
        // Tammy's boost is drawn entirely with smoke and glow sprites.
        assert!(boost.frames.iter().all(|f| !f.sprites[1].is_empty()));
        let mesh = billboards(boost.frames[0].sprites[1], true, Vec3::X, Vec3::Y);
        assert_eq!(
            mesh.count_vertices(),
            boost.frames[0].sprites[1].len() / SPRITE_BYTES * 4
        );
    }

    #[test]
    fn racer_color_recolors_only_tinted_triangles() {
        let graphics = Graphics::parse(PACK).expect("valid pack");
        let clip = &graphics.clips[graphics.clip("driver:0:idle").unwrap()];
        let colors = |tint| {
            let mesh = geometry(
                &graphics.source,
                (clip.frames[0].parts[0].mesh, tint, Look::Solid),
            );
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
