//! Pearococo's tail: the material that sways and shades the models the browser
//! draws with its plumage shader. The shader itself is `plumage.wesl`.
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

/// Every feather grows from this point of the racer's model, as in the browser.
const ROOT: Vec2 = Vec2::new(0.0, 1.75);
/// The eye sits this far along each feather.
const EYE: f32 = 0.82;

/// The plumage shader has no settings: what differs between feathers travels in
/// their vertices and in each one's mesh tag.
#[derive(Asset, TypePath, AsBindGroup, Debug, Clone, Default)]
pub struct PlumageMaterial {}

fn shader() -> ShaderRef {
    ShaderRef::Path(
        AssetPath::from_path_buf(embedded_path!("plumage.wesl")).with_source("embedded"),
    )
}
impl Material for PlumageMaterial {
    fn vertex_shader() -> ShaderRef {
        shader()
    }
    fn fragment_shader() -> ShaderRef {
        shader()
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
            Mesh::ATTRIBUTE_UV_0.at_shader_location(2),
            Mesh::ATTRIBUTE_UV_1.at_shader_location(3),
            Mesh::ATTRIBUTE_COLOR.at_shader_location(4),
        ])?];
        // The browser paints every face, whichever way it winds.
        descriptor.primitive.cull_mode = None;
        Ok(())
    }
}

pub fn build(app: &mut App) {
    embedded_asset!(app, "plumage.wesl");
    app.add_plugins(MaterialPlugin::<PlumageMaterial>::default());
}

/// How a racer's movement acts on her tail.
#[derive(Clone, Copy, Default, PartialEq, Debug)]
pub struct Wind {
    /// Sideways swing of the feather tips, -1 to 1, towards the model's +X.
    pub swing: f32,
    /// How far speed presses the tail back, 0 to 1.
    pub press: f32,
}
impl Wind {
    /// The mesh tag the shader reads. `still` holds the tail's own sway at its
    /// first moment, for screenshots that must not change.
    pub fn tag(self, still: bool) -> u32 {
        let swing = ((self.swing.clamp(-1.0, 1.0) * 0.5 + 0.5) * 2047.0).round() as u32;
        let press = (self.press.clamp(0.0, 1.0) * 255.0).round() as u32;
        swing | press << 11 | u32::from(still) << 31
    }
}

/// Where each vertex of one feather lies along and across it (`UV_0`), and from
/// the centre of its eye (`UV_1`). A feather runs from the root to its farthest
/// vertex, the tip of its blade.
pub fn feather_coordinates(positions: &[[f32; 3]]) -> (Vec<[f32; 2]>, Vec<[f32; 2]>) {
    let flat = |p: &[f32; 3]| Vec2::new(p[0], p[1]) - ROOT;
    let tip = positions
        .iter()
        .map(flat)
        .max_by(|a, b| a.length_squared().total_cmp(&b.length_squared()))
        .unwrap_or(Vec2::Y);
    let axis = tip.normalize_or(Vec2::Y);
    let eye = axis * tip.length() * EYE;
    positions
        .iter()
        .map(|p| {
            let p = flat(p);
            ([p.dot(axis), p.perp_dot(axis)], (p - eye).to_array())
        })
        .unzip()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wind_survives_the_mesh_tag_the_shader_unpacks() {
        // The same arithmetic as `wind_of` in plumage.wesl.
        let unpack = |tag: u32| {
            (
                (tag & 0x7ff) as f32 / 1023.5 - 1.0,
                ((tag >> 11) & 0xff) as f32 / 255.0,
                tag >> 31 == 1,
            )
        };
        for (swing, press, still) in [(0.0, 0.0, false), (-1.0, 1.0, true), (0.37, 0.6, false)] {
            let (s, p, held) = unpack(Wind { swing, press }.tag(still));
            assert!(
                (s - swing).abs() < 0.001 && (p - press).abs() < 0.003,
                "{swing} {press}"
            );
            assert_eq!(held, still);
        }
        // Out-of-range wind is clamped, never spilling into the other fields.
        assert_eq!(
            Wind {
                swing: 9.0,
                press: 9.0
            }
            .tag(false),
            2047 | 255 << 11
        );
    }

    #[test]
    fn a_feather_is_measured_from_root_to_tip_with_its_eye_most_of_the_way_along() {
        // A feather leaning towards +X: root, a point beside the shaft, and the tip.
        let tip = Vec2::new(3.0, 4.0);
        let side = Vec2::new(-0.4, 0.3) + tip * 0.5;
        let positions = [
            [0.0, 1.75, -1.0],
            [side.x, 1.75 + side.y, -1.2],
            [tip.x, 1.75 + tip.y, -1.4],
        ];
        let (feather, eye) = feather_coordinates(&positions);
        assert!(Vec2::from(feather[0]).length() < 1e-6);
        assert!((feather[2][0] - 5.0).abs() < 1e-5 && feather[2][1].abs() < 1e-5);
        // The side point is half way along and half a unit from the shaft.
        assert!((feather[1][0] - 2.5).abs() < 1e-5 && (feather[1][1].abs() - 0.5).abs() < 1e-5);
        // The eye is 82% of the way from root to tip.
        assert!((Vec2::from(eye[2]) - tip * 0.18).length() < 1e-5);
    }
}
