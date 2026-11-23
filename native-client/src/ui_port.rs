//! Loads the browser's HTML/CSS announcement cards ported to transparent RGBA
//! textures by `scripts/build/port-ui.mjs`. The browser's `style.css` and
//! `ui/ability-announcements.js` stay the single source of truth.
use bevy::{
    asset::RenderAssetUsages,
    prelude::*,
    render::render_resource::{Extent3d, TextureDimension, TextureFormat},
};
use std::collections::HashMap;

static PACK: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/ui.wwup"));
const VERSION: u32 = 1;

#[derive(Clone)]
pub struct PortedCard {
    pub image: Handle<Image>,
    pub logical_w: f32,
    pub logical_h: f32,
    pub detail_left: f32,
    pub detail_top: f32,
    pub detail_w: f32,
    pub detail_h: f32,
}

#[derive(Resource, Default)]
pub struct UiCards(pub HashMap<String, PortedCard>);

impl UiCards {
    pub fn get(&self, key: &str) -> Option<&PortedCard> {
        self.0.get(key)
    }
}

struct RawCard<'a> {
    key: &'a str,
    width: u16,
    height: u16,
    logical_w: u16,
    logical_h: u16,
    detail_left: u16,
    detail_top: u16,
    detail_w: u16,
    detail_h: u16,
    compressed: &'a [u8],
}

fn u16_at(bytes: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_le_bytes(bytes.get(at..at + 2)?.try_into().ok()?))
}
fn u32_at(bytes: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(bytes.get(at..at + 4)?.try_into().ok()?))
}

fn parse(bytes: &[u8]) -> Option<Vec<RawCard<'_>>> {
    if bytes.get(..4)? != b"WWUP" || u32_at(bytes, 4)? != VERSION {
        return None;
    }
    let count = u32_at(bytes, 8)? as usize;
    let mut at = 12;
    let mut cards = Vec::with_capacity(count);
    for _ in 0..count {
        let key_len = usize::from(u16_at(bytes, at)?);
        at += 2;
        let key = std::str::from_utf8(bytes.get(at..at + key_len)?).ok()?;
        at += key_len;
        let width = u16_at(bytes, at)?;
        let height = u16_at(bytes, at + 2)?;
        let logical_w = u16_at(bytes, at + 4)?;
        let logical_h = u16_at(bytes, at + 6)?;
        let detail_left = u16_at(bytes, at + 8)?;
        let detail_top = u16_at(bytes, at + 10)?;
        let detail_w = u16_at(bytes, at + 12)?;
        let detail_h = u16_at(bytes, at + 14)?;
        let comp_len = u32_at(bytes, at + 16)? as usize;
        at += 20;
        let compressed = bytes.get(at..at + comp_len)?;
        at += comp_len;
        cards.push(RawCard {
            key,
            width,
            height,
            logical_w,
            logical_h,
            detail_left,
            detail_top,
            detail_w,
            detail_h,
            compressed,
        });
    }
    (at == bytes.len()).then_some(cards)
}

pub fn setup(mut commands: Commands, mut images: ResMut<Assets<Image>>) {
    let mut cards = HashMap::new();
    if let Some(raw_cards) = parse(PACK) {
        for raw in raw_cards {
            let Ok(rgba) = miniz_oxide::inflate::decompress_to_vec_zlib(raw.compressed) else {
                continue;
            };
            let expected = usize::from(raw.width) * usize::from(raw.height) * 4;
            if rgba.len() != expected || raw.width == 0 || raw.height == 0 {
                continue;
            }
            let image = Image::new(
                Extent3d {
                    width: u32::from(raw.width),
                    height: u32::from(raw.height),
                    depth_or_array_layers: 1,
                },
                TextureDimension::D2,
                rgba,
                TextureFormat::Rgba8UnormSrgb,
                RenderAssetUsages::RENDER_WORLD,
            );
            cards.insert(
                raw.key.to_owned(),
                PortedCard {
                    image: images.add(image),
                    logical_w: f32::from(raw.logical_w),
                    logical_h: f32::from(raw.logical_h),
                    detail_left: f32::from(raw.detail_left),
                    detail_top: f32::from(raw.detail_top),
                    detail_w: f32::from(raw.detail_w),
                    detail_h: f32::from(raw.detail_h),
                },
            );
        }
    }
    commands.insert_resource(UiCards(cards));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_ui_pack_parses_cleanly() {
        let cards = parse(PACK).expect("embedded WWUP pack must be valid");
        for raw in &cards {
            let rgba = miniz_oxide::inflate::decompress_to_vec_zlib(raw.compressed)
                .expect("valid zlib RGBA payload");
            assert_eq!(
                rgba.len(),
                usize::from(raw.width) * usize::from(raw.height) * 4,
                "RGBA size mismatch for {}",
                raw.key
            );
            assert!(raw.logical_w > 0 && raw.logical_h > 0);
        }
        // When Chrome ported the cards at build time, confirm all key themes exist.
        if !cards.is_empty() {
            for required in ["ability:5", "ability:15", "ability:15:swap", "reward:intelligence"] {
                assert!(
                    cards.iter().any(|c| c.key == required),
                    "missing ported HTML card {required}"
                );
            }
        }
    }
}
