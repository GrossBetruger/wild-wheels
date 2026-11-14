//! Plays the graphics pack that `build.rs` ports from the browser renderer.
//! Nothing here is drawn by hand: models, animation frames, particles and arenas
//! all come from the JavaScript client. See docs/native-graphics-port.md.
use crate::plumage::{PlumageMaterial, Wind};
use bevy::{
    asset::RenderAssetUsages,
    camera::visibility::{NoFrustumCulling, RenderLayers},
    ecs::system::SystemParam,
    mesh::{MeshTag, PrimitiveTopology},
    prelude::*,
};
use crossbeam_channel::{Receiver, Sender, unbounded};
use std::{
    collections::{HashMap, HashSet},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

static PACK: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/graphics.wwgp"));
const VERSION: u32 = 7;
/// Clip frames ahead of the one shown whose meshes are built in advance.
const LOOKAHEAD: usize = 4;
/// Meshes unused for this long are released; one shown again is rebuilt.
const KEEP_SECONDS: f32 = 12.0;
/// Seconds a particle mesh is kept after it was last shown.
const PARTICLE_SECONDS: f32 = 2.0;
/// Between recorded frames a part or particle is blended towards its next
/// position, unless it moves further than this: then it is a different object.
const BLEND_LIMIT: f32 = 2.0;
/// Blended particles are rebuilt at most this many times per recorded frame.
const BLEND_STEPS: f32 = 8.0;
/// Whether frames are blended; the showcase turns it off for comparison.
pub static BLENDING: AtomicBool = AtomicBool::new(true);
/// Holds plumage at the first moment of its sway, so the showcase's screenshots
/// differ only by the transition under test.
pub static STILL: AtomicBool = AtomicBool::new(false);
const TRIANGLE_BYTES: usize = 20;
use crate::sprite::{SPRITE_BYTES, SpriteMaterial};
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
/// How the browser draws a model: lit, added to the picture, or with its plumage shader.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Layer {
    Solid,
    Glow,
    Plumage,
}
struct Part {
    mesh: u32,
    layer: Layer,
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
    /// Pearococo's feathers, swayed and shaded by the plumage material.
    Plumage,
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
    /// Particle meshes, shared by every entity showing the same recorded frame.
    particles: HashMap<ParticleKey, Built>,
    finished: (Sender<Finished>, Receiver<Finished>),
    /// Seconds since launch, as of the last frame.
    now: f32,
    /// One material for each `Look` up to `Silhouette`, in declaration order.
    surfaces: [Handle<StandardMaterial>; 4],
    plumage: Handle<PlumageMaterial>,
    /// Additive sparks and alpha-blended smoke, in the browser's draw order.
    sprites: [Handle<SpriteMaterial>; 2],
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
                    let layer = match c.u32()? {
                        0 => Layer::Solid,
                        1 => Layer::Glow,
                        2 => Layer::Plumage,
                        _ => return None,
                    };
                    let (x, y, z, origin) = (c.vec3()?, c.vec3()?, c.vec3()?, c.vec3()?);
                    if mesh as usize >= meshes.len() {
                        return None;
                    }
                    parts.push(Part {
                        mesh,
                        layer,
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
            particles: HashMap::new(),
            finished: unbounded(),
            now: 0.0,
            surfaces: Default::default(),
            plumage: Handle::default(),
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
    /// The shared particle mesh for one recorded frame, blended `key.2` steps
    /// towards the next, built now if this is its first use.
    fn particles(
        &mut self,
        key: ParticleKey,
        sprites: &[u8],
        after: &[u8],
        meshes: &mut Assets<Mesh>,
    ) -> Handle<Mesh> {
        let now = self.now;
        let built = self.particles.entry(key).or_insert_with(|| {
            let blended;
            let sprites = match key.2 {
                0 => sprites,
                step => {
                    blended = blend_sprites(sprites, after, f32::from(step) / BLEND_STEPS);
                    &blended[..]
                }
            };
            crate::bench::SPRITE_MESHES.fetch_add(1, Ordering::Relaxed);
            Built {
                handle: meshes.add(crate::sprite::particles(sprites, key.3 == 1)),
                used: now,
            }
        });
        built.used = now;
        built.handle.clone()
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
        // Particle meshes are cheap to rebuild and numerous; keep only recent ones.
        self.particles
            .retain(|_, built| now - built.used < PARTICLE_SECONDS);
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
            // Added to the picture, or shaded by the plumage shader, as the browser
            // writes them to the screen.
            Look::Glow | Look::Plumage => [red, green, blue, 255].map(|c| f32::from(c) / 255.0),
            Look::Silhouette => [1.0; 4],
            _ => Color::srgb_u8(red, green, blue).to_linear().to_f32_array(),
        };
        for point in [a, b, c] {
            positions.push(point.to_array());
            normals.push(normal);
            colors.push(color);
        }
    }
    let mut built = Mesh::new(
        PrimitiveTopology::TriangleList,
        RenderAssetUsages::RENDER_WORLD,
    );
    if look == Look::Plumage {
        let (feather, eye) = crate::plumage::feather_coordinates(&positions);
        built.insert_attribute(Mesh::ATTRIBUTE_UV_0, feather);
        built.insert_attribute(Mesh::ATTRIBUTE_UV_1, eye);
    }
    built
        .with_inserted_attribute(Mesh::ATTRIBUTE_POSITION, positions)
        .with_inserted_attribute(Mesh::ATTRIBUTE_NORMAL, normals)
        .with_inserted_attribute(Mesh::ATTRIBUTE_COLOR, colors)
}

/// A part's placement between two recorded frames, `between` of the way along.
fn blend(from: Transform, to: Transform, between: f32) -> Transform {
    if between <= 0.0 || from.translation.distance(to.translation) > BLEND_LIMIT {
        return from;
    }
    Transform {
        translation: from.translation.lerp(to.translation, between),
        rotation: from.rotation.slerp(to.rotation, between),
        scale: from.scale.lerp(to.scale, between),
    }
}
/// Two frames' particles, `between` of the way from the first to the second.
/// A particle that jumps, such as one that wraps around its loop, is not blended.
fn blend_sprites(from: &[u8], to: &[u8], between: f32) -> Vec<u8> {
    let value = |bytes: &[u8], k: usize| {
        f32::from_le_bytes([
            bytes[k * 4],
            bytes[k * 4 + 1],
            bytes[k * 4 + 2],
            bytes[k * 4 + 3],
        ])
    };
    let mut out = Vec::with_capacity(from.len());
    for (a, b) in from
        .chunks_exact(SPRITE_BYTES)
        .zip(to.chunks_exact(SPRITE_BYTES))
    {
        let gap = Vec3::new(
            value(b, 0) - value(a, 0),
            value(b, 1) - value(a, 1),
            value(b, 2) - value(a, 2),
        );
        let along = match gap.length() > BLEND_LIMIT {
            true => 0.0,
            false => between,
        };
        for k in 0..SPRITE_BYTES / 4 {
            let mixed = value(a, k) + (value(b, k) - value(a, k)) * along;
            out.extend_from_slice(&mixed.to_le_bytes());
        }
    }
    out
}
/// `#rrggbb` as sent by the server.
pub fn tint(color: &str) -> Option<Tint> {
    let digits = color.strip_prefix('#').filter(|d| d.len() == 6)?;
    let channel = |i: usize| u8::from_str_radix(digits.get(i..i + 2)?, 16).ok();
    Some([channel(0)?, channel(2)?, channel(4)?])
}

/// A recorded frame's particles: clip, frame, blend step towards the next frame, layer.
type ParticleKey = (usize, usize, u8, usize);
/// Plays one ported clip beneath this entity. `None` draws nothing.
#[derive(Component, Default)]
pub struct Ported {
    pub clip: Option<usize>,
    pub tint: Tint,
    /// Seconds into the clip; `None` follows the shared animation clock.
    pub time: Option<f32>,
    /// Drawn as a flat silhouette on the X-ray layer instead of in the world.
    pub ghost: bool,
    /// How the racer's movement acts on any plumage in the clip.
    pub wind: Wind,
    parts: Vec<Entity>,
    /// Parts drawn by the plumage material, which is a different component.
    plumes: Vec<Entity>,
    /// The child drawing each particle layer, glow then smoke.
    sprites: [Option<Entity>; 2],
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
        crate::plumage::build(app);
        crate::sprite::build(app);
        graphics.plumage = app
            .world_mut()
            .resource_mut::<Assets<PlumageMaterial>>()
            .add(PlumageMaterial::default());
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
        graphics.surfaces = [materials.add(surface), glow, flat, silhouette];
        let mut sprites = app.world_mut().resource_mut::<Assets<SpriteMaterial>>();
        graphics.sprites = [true, false].map(|additive| sprites.add(SpriteMaterial { additive }));
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
    (
        Without<Ported>,
        Without<crate::scene::FollowCamera>,
        Without<MeshMaterial3d<PlumageMaterial>>,
    ),
>;
type PlumeQuery<'w, 's> = Query<
    'w,
    's,
    (
        &'static mut Mesh3d,
        &'static mut Transform,
        &'static mut Visibility,
        &'static mut MeshTag,
    ),
    (
        With<MeshMaterial3d<PlumageMaterial>>,
        Without<Ported>,
        Without<crate::scene::FollowCamera>,
        Without<MeshMaterial3d<StandardMaterial>>,
    ),
>;
type ParticleQuery<'w, 's> = Query<
    'w,
    's,
    (&'static mut Mesh3d, &'static mut Visibility),
    (
        With<MeshMaterial3d<SpriteMaterial>>,
        Without<Ported>,
        Without<crate::scene::FollowCamera>,
        Without<MeshMaterial3d<StandardMaterial>>,
        Without<MeshMaterial3d<PlumageMaterial>>,
    ),
>;
/// The child entities that draw clips: ordinary parts and plumage.
#[derive(SystemParam)]
pub struct Pools<'w, 's> {
    parts: PartQuery<'w, 's>,
    plumes: PlumeQuery<'w, 's>,
    particles: ParticleQuery<'w, 's>,
}

pub fn animate(
    mut commands: Commands,
    time: Res<Time>,
    mut graphics: ResMut<Graphics>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut players: Query<(Entity, &mut Ported)>,
    pools: Pools,
) {
    let Pools {
        mut parts,
        mut plumes,
        mut particles,
    } = pools;
    let still = STILL.load(Ordering::Relaxed);
    let graphics = &mut *graphics;
    graphics.collect(time.elapsed_secs(), &mut meshes);
    for (entity, mut player) in &mut players {
        let player = &mut *player;
        let look_of = |layer: Layer| match (player.ghost, layer) {
            (_, Layer::Glow) => Look::Glow,
            (true, _) => Look::Silhouette,
            (false, Layer::Plumage) => Look::Plumage,
            (false, Layer::Solid) => Look::Solid,
        };
        let tag = player.wind.tag(still);
        // The frame shown, the one after it, and how far between them we are.
        let position = player.clip.map(|clip| {
            let frames = graphics.clips[clip].frames.len();
            let exact =
                player.time.unwrap_or(time.elapsed_secs()).max(0.0) * graphics.clips[clip].fps;
            let index = exact as usize;
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
                    let key = (part.mesh, player.tint, look_of(part.layer));
                    let _ = graphics.ready(key);
                }
            }
            let next = at(index + 1);
            let between = match next == at(index) || !BLENDING.load(Ordering::Relaxed) {
                true => 0.0,
                false => exact.fract(),
            };
            (clip, at(index), next, between)
        });
        let shown = position.map_or(0, |(clip, index, ..)| {
            graphics.clips[clip].frames[index].parts.len()
        });
        // Ordinary parts and plumage are drawn by different materials, so each
        // has its own pool of child entities, filled in the clip's order.
        let (mut drawn, mut feathered) = (0, 0);
        for slot in 0..shown {
            let (clip, index, next, between) = position.unwrap_or_default();
            let (key, transform) = {
                let part = &graphics.clips[clip].frames[index].parts[slot];
                let after = graphics.clips[clip].frames[next].parts.get(slot);
                // Recordings are 24 frames a second; the same mesh moving between
                // frames is blended so it moves at the display's full rate.
                let transform = match after {
                    Some(after) if after.mesh == part.mesh && after.layer == part.layer => {
                        blend(part.transform, after.transform, between)
                    }
                    _ => part.transform,
                };
                ((part.mesh, player.tint, look_of(part.layer)), transform)
            };
            // Until a mesh is built, a part keeps showing what it showed before.
            let mesh = graphics.ready(key);
            let visibility = match mesh.is_some() {
                true => Visibility::Inherited,
                false => Visibility::Hidden,
            };
            if key.2 == Look::Plumage {
                feathered += 1;
                match player.plumes.get(feathered - 1) {
                    Some(child) => {
                        let Ok((mut shown, mut placed, mut visibility, mut wind)) =
                            plumes.get_mut(*child)
                        else {
                            continue;
                        };
                        if wind.value != tag {
                            wind.value = tag;
                        }
                        let Some(mesh) = mesh else {
                            continue;
                        };
                        if shown.0 != mesh {
                            shown.0 = mesh;
                        }
                        *placed = transform;
                        visibility.set_if_neq(Visibility::Inherited);
                    }
                    None => {
                        // The shader moves feathers beyond their meshes' bounds.
                        let child = commands
                            .spawn((
                                Mesh3d(mesh.unwrap_or_default()),
                                MeshMaterial3d(graphics.plumage.clone()),
                                MeshTag::new(tag),
                                transform,
                                visibility,
                                NoFrustumCulling,
                                ChildOf(entity),
                            ))
                            .id();
                        player.plumes.push(child);
                    }
                }
                continue;
            }
            drawn += 1;
            let material = graphics.surface(key.2);
            match player.parts.get(drawn - 1) {
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
        for child in player.parts.iter().skip(drawn) {
            if let Ok((_, _, _, mut visibility)) = parts.get_mut(*child) {
                visibility.set_if_neq(Visibility::Hidden);
            }
        }
        for child in player.plumes.iter().skip(feathered) {
            if let Ok((_, _, mut visibility, _)) = plumes.get_mut(*child) {
                visibility.set_if_neq(Visibility::Hidden);
            }
        }
        // Particles face the camera in the sprite shader, so a recorded frame's
        // particles are one mesh, built once and shared by everything showing it.
        for layer in 0..2 {
            let (sprites, after, key) = match (player.ghost, position) {
                (false, Some((clip, index, next, between))) => {
                    let (sprites, after) = (
                        graphics.clips[clip].frames[index].sprites[layer],
                        graphics.clips[clip].frames[next].sprites[layer],
                    );
                    // Particles blend too when both frames hold the same particles.
                    let blending =
                        after.len() == sprites.len() && after.as_ptr() != sprites.as_ptr();
                    let step = match blending {
                        true => (between * BLEND_STEPS) as u8,
                        false => 0,
                    };
                    (sprites, after, Some((clip, index, step, layer)))
                }
                _ => (&[][..], &[][..], None),
            };
            let handle = match (key, sprites.is_empty()) {
                (Some(key), false) => Some(graphics.particles(key, sprites, after, &mut meshes)),
                _ => None,
            };
            match (player.sprites[layer], handle) {
                (Some(child), handle) => {
                    // An empty mesh cannot be uploaded, so an idle layer is hidden instead.
                    if let Ok((mut mesh, mut visibility)) = particles.get_mut(child) {
                        visibility.set_if_neq(match handle {
                            Some(_) => Visibility::Inherited,
                            None => Visibility::Hidden,
                        });
                        if let Some(handle) = handle
                            && mesh.0 != handle
                        {
                            mesh.0 = handle;
                        }
                    }
                }
                (None, Some(handle)) => {
                    let child = commands
                        .spawn((
                            Mesh3d(handle),
                            MeshMaterial3d(graphics.sprites[layer].clone()),
                            Transform::default(),
                            NoFrustumCulling,
                            ChildOf(entity),
                        ))
                        .id();
                    player.sprites[layer] = Some(child);
                }
                (None, None) => {}
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
        // Pearococo's eleven tail feathers are drawn by the plumage shader; no
        // other racer has any.
        let feathers = |driver: usize| {
            let clip = graphics.clip(&format!("driver:{driver}:idle")).unwrap();
            graphics.clips[clip].frames[0]
                .parts
                .iter()
                .filter(|part| part.layer == Layer::Plumage)
                .count()
        };
        assert_eq!((feathers(9), feathers(0), feathers(14)), (11, 0, 0));
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
            "overlay:11:special:start",
            "overlay:11:special:end",
            "overlay:14:vulcan:in",
            "overlay:14:vulcan:out",
            "overlay:9:hedge:end",
            "driver:9:boost:in",
            "driver:14:boost:out",
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
        let mesh = crate::sprite::particles(boost.frames[0].sprites[1], true);
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
    fn feathers_carry_what_the_plumage_shader_needs() {
        let graphics = Graphics::parse(PACK).expect("valid pack");
        let clip = &graphics.clips[graphics.clip("driver:9:idle").unwrap()];
        let feather = clip.frames[0]
            .parts
            .iter()
            .find(|part| part.layer == Layer::Plumage)
            .expect("a feather");
        let mesh = geometry(&graphics.source, (feather.mesh, [255; 3], Look::Plumage));
        let count = mesh.count_vertices();
        for attribute in [
            Mesh::ATTRIBUTE_UV_0,
            Mesh::ATTRIBUTE_UV_1,
            Mesh::ATTRIBUTE_COLOR,
        ] {
            assert_eq!(
                mesh.attribute(attribute).map(|values| values.len()),
                Some(count)
            );
        }
        // A feather is about 3.8 units long, and its blade under half a unit wide.
        let Some(bevy::mesh::VertexAttributeValues::Float32x2(along)) =
            mesh.attribute(Mesh::ATTRIBUTE_UV_0)
        else {
            panic!("feather coordinates");
        };
        let length = along.iter().map(|uv| uv[0]).fold(0.0, f32::max);
        let width = along.iter().map(|uv| uv[1].abs()).fold(0.0, f32::max);
        assert!(
            (3.7..4.0).contains(&length) && (0.3..0.6).contains(&width),
            "{length} {width}"
        );
        // The same mesh as an ordinary part has no such coordinates.
        let plain = geometry(&graphics.source, (feather.mesh, [255; 3], Look::Solid));
        assert!(plain.attribute(Mesh::ATTRIBUTE_UV_0).is_none());
    }

    #[test]
    fn frames_blend_smoothly_but_not_across_jumps() {
        let from = Transform::from_xyz(0.0, 0.0, 0.0);
        let near = Transform::from_xyz(1.0, 0.0, 0.0).with_rotation(Quat::from_rotation_y(1.0));
        let halfway = blend(from, near, 0.5);
        assert!(halfway.translation.distance(Vec3::new(0.5, 0.0, 0.0)) < 1e-6);
        assert!((halfway.rotation.angle_between(Quat::IDENTITY) - 0.5).abs() < 1e-5);
        let far = Transform::from_xyz(10.0, 0.0, 0.0);
        assert_eq!(blend(from, far, 0.5).translation, Vec3::ZERO);
        let sprite = |x: f32, size: f32| {
            [x, 0.0, 0.0, size, 1.0, 1.0, 1.0]
                .iter()
                .flat_map(|v| v.to_le_bytes())
                .collect::<Vec<u8>>()
        };
        let mixed = blend_sprites(&sprite(0.0, 1.0), &sprite(1.0, 3.0), 0.5);
        assert_eq!(mixed, sprite(0.5, 2.0));
        assert_eq!(
            blend_sprites(&sprite(0.0, 1.0), &sprite(9.0, 3.0), 0.5),
            sprite(0.0, 1.0)
        );
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
