//! Ported particles. Each sprite is a quad that `sprite.wesl` turns to face the
//! camera, so a recorded frame's particles are built into a mesh once and shared
//! by every entity showing that frame, however the camera moves.
use bevy::{
    asset::{AssetPath, RenderAssetUsages, embedded_asset, embedded_path},
    mesh::{Indices, MeshVertexBufferLayoutRef, PrimitiveTopology},
    pbr::{MaterialPipeline, MaterialPipelineKey},
    prelude::*,
    reflect::TypePath,
    render::render_resource::{
        AsBindGroup, RenderPipelineDescriptor, SpecializedMeshPipelineError,
    },
    shader::ShaderRef,
};

/// Bytes per recorded sprite: x, y, z, size, red, green, blue.
pub const SPRITE_BYTES: usize = 28;

/// Glow is added to the picture; smoke is blended over it.
#[derive(Asset, TypePath, AsBindGroup, Debug, Clone)]
pub struct SpriteMaterial {
    pub additive: bool,
}

fn shader() -> ShaderRef {
    ShaderRef::Path(AssetPath::from_path_buf(embedded_path!("sprite.wesl")).with_source("embedded"))
}
impl Material for SpriteMaterial {
    fn vertex_shader() -> ShaderRef {
        shader()
    }
    fn fragment_shader() -> ShaderRef {
        shader()
    }
    fn alpha_mode(&self) -> AlphaMode {
        match self.additive {
            true => AlphaMode::Add,
            false => AlphaMode::Blend,
        }
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
            Mesh::ATTRIBUTE_UV_0.at_shader_location(1),
            Mesh::ATTRIBUTE_UV_1.at_shader_location(2),
            Mesh::ATTRIBUTE_COLOR.at_shader_location(3),
        ])?];
        descriptor.primitive.cull_mode = None;
        Ok(())
    }
}

pub fn build(app: &mut App) {
    embedded_asset!(app, "sprite.wesl");
    app.add_plugins(MaterialPlugin::<SpriteMaterial>::default());
}

/// One quad per recorded sprite, each corner at the sprite's centre; the shader
/// spreads the corners towards the camera. Smoke is half transparent and its
/// colors are converted to linear light; glow colors are added as recorded.
pub fn particles(sprites: &[u8], smoke: bool) -> Mesh {
    let count = sprites.len() / SPRITE_BYTES;
    let mut centers = Vec::with_capacity(count * 4);
    let mut corners = Vec::with_capacity(count * 4);
    let mut sizes = Vec::with_capacity(count * 4);
    let mut colors = Vec::with_capacity(count * 4);
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
        let color = match smoke {
            true => {
                let [r, g, b, _] = Color::srgb(value(4), value(5), value(6))
                    .to_linear()
                    .to_f32_array();
                [r, g, b, 0.5]
            }
            false => [value(4), value(5), value(6), 1.0],
        };
        for corner in [[-1.0, -1.0], [1.0, -1.0], [1.0, 1.0], [-1.0, 1.0]] {
            centers.push([value(0), value(1), value(2)]);
            corners.push(corner);
            sizes.push([value(3), f32::from(u8::from(!smoke))]);
            colors.push(color);
        }
        let base = i as u32 * 4;
        indices.extend([base, base + 1, base + 2, base, base + 2, base + 3]);
    }
    Mesh::new(
        PrimitiveTopology::TriangleList,
        RenderAssetUsages::default(),
    )
    .with_inserted_attribute(Mesh::ATTRIBUTE_POSITION, centers)
    .with_inserted_attribute(Mesh::ATTRIBUTE_UV_0, corners)
    .with_inserted_attribute(Mesh::ATTRIBUTE_UV_1, sizes)
    .with_inserted_attribute(Mesh::ATTRIBUTE_COLOR, colors)
    .with_inserted_indices(Indices::U32(indices))
}
