//! Dark Humor's two materials, ported by hand from the browser's shaders: the
//! rim-lit X-ray shading of what KnowItOwl sees (`xray.wesl`) and the drifting
//! fog that covers the arena (`fog.wesl`).
use bevy::{
    asset::{AssetPath, embedded_asset, embedded_path},
    mesh::MeshVertexBufferLayoutRef,
    pbr::{MaterialPipeline, MaterialPipelineKey},
    prelude::*,
    reflect::TypePath,
    render::render_resource::{
        AsBindGroup, RenderPipelineDescriptor, SpecializedMeshPipelineError,
    },
    shader::ShaderRef,
};

/// The browser's X-ray color for racers, before the rim light.
pub const RACER: [u8; 3] = [31, 153, 179];
/// Its colors for the viewer's own projectiles and bombs, and for everyone else's.
pub const OWN: [u8; 3] = [0xa4, 0xff, 0xb6];
pub const RIVAL: [u8; 3] = [0xff, 0x70, 0x9d];
/// Solid debris of effects seen in X-ray, such as explosions.
pub const BLAST: [u8; 3] = [0xff, 0xb0, 0x4a];

/// Shapes take their color from their vertices; the shader adds the rim light.
#[derive(Asset, TypePath, AsBindGroup, Debug, Clone, Default)]
pub struct XrayMaterial {}
impl Material for XrayMaterial {
    fn vertex_shader() -> ShaderRef {
        embedded("xray.wesl")
    }
    fn fragment_shader() -> ShaderRef {
        embedded("xray.wesl")
    }
    fn enable_prepass() -> bool {
        false
    }
    fn enable_shadows() -> bool {
        false
    }
    fn specialize(
        _pipeline: &MaterialPipeline,
        descriptor: &mut RenderPipelineDescriptor,
        layout: &MeshVertexBufferLayoutRef,
        _key: MaterialPipelineKey<Self>,
    ) -> Result<(), SpecializedMeshPipelineError> {
        descriptor.vertex.buffers = vec![layout.0.get_layout(&[
            Mesh::ATTRIBUTE_POSITION.at_shader_location(0),
            Mesh::ATTRIBUTE_NORMAL.at_shader_location(1),
            Mesh::ATTRIBUTE_COLOR.at_shader_location(2),
        ])?];
        // The browser paints every face, whichever way it winds.
        descriptor.primitive.cull_mode = None;
        Ok(())
    }
}

/// `strength.x` is how dark the arena is, from 0 to 1.
#[derive(Asset, TypePath, AsBindGroup, Debug, Clone, Default)]
pub struct FogMaterial {
    #[uniform(0)]
    pub strength: Vec4,
}
impl UiMaterial for FogMaterial {
    fn fragment_shader() -> ShaderRef {
        embedded("fog.wesl")
    }
}

fn embedded(file: &str) -> ShaderRef {
    let path = match file {
        "xray.wesl" => embedded_path!("xray.wesl"),
        _ => embedded_path!("fog.wesl"),
    };
    ShaderRef::Path(AssetPath::from_path_buf(path).with_source("embedded"))
}

pub fn build(app: &mut App) {
    embedded_asset!(app, "xray.wesl");
    embedded_asset!(app, "fog.wesl");
    app.add_plugins((
        MaterialPlugin::<XrayMaterial>::default(),
        UiMaterialPlugin::<FogMaterial>::default(),
    ));
}
