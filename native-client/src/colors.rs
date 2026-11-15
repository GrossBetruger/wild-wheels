//! Color choices use the browser's palette; the server owns room assignments.
#[cfg(test)]
mod integration;
use std::sync::OnceLock;
use wild_wheels_core::ClientView;

pub struct Swatch {
    pub name: &'static str,
    pub hex: &'static str,
    pub rgb: [u8; 3],
}
pub fn palette() -> &'static [Swatch] {
    static PALETTE: OnceLock<Vec<Swatch>> = OnceLock::new();
    PALETTE.get_or_init(|| {
        include_str!("../../gameplay/player-colors.js")
            .lines()
            .filter_map(|line| {
                let mut quoted = line.split('\'');
                quoted.next()?;
                let name = quoted.next()?;
                quoted.next()?;
                let hex = quoted.next()?;
                if hex.len() != 7 || !hex.starts_with('#') {
                    return None;
                }
                let number = u32::from_str_radix(&hex[1..], 16).ok()?;
                Some(Swatch {
                    name,
                    hex,
                    rgb: [(number >> 16) as u8, (number >> 8) as u8, number as u8],
                })
            })
            .collect()
    })
}
pub fn valid(hex: &str) -> bool {
    palette().iter().any(|s| s.hex == hex)
}
pub fn editable(phase: &str) -> bool {
    matches!(phase, "ready" | "finished")
}
pub fn occupied(view: &ClientView, hex: &str) -> bool {
    view.actors
        .iter()
        .any(|a| a.id != view.you && a.human && !a.inactive && a.color == hex)
}
#[derive(Default)]
pub struct Selection {
    pub preferred: Option<String>,
    pub pending: bool,
    pub message: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn choices_match_the_shared_palette_and_reject_arbitrary_colors() {
        assert_eq!(palette().len(), 14);
        assert!(valid("#e72845"));
        assert_eq!(
            palette().iter().find(|s| s.hex == "#e72845").unwrap().rgb,
            [231, 40, 69]
        );
        assert!(!valid("#ffffff"));
        assert!(!valid("<script>"));
    }
    #[test]
    fn colors_can_change_only_between_matches() {
        assert!(editable("ready"));
        assert!(editable("finished"));
        for phase in ["countdown", "racing", "paused"] {
            assert!(!editable(phase));
        }
    }
    #[test]
    fn humans_reserve_colors_but_the_player_can_choose_a_bots_color() {
        use serde_json::json;
        use wild_wheels_core::{NativeArena, NativeClient};
        let arena=NativeArena::new(json!({"code":"00","maxPlayers":8,"arena":0,"bots":1,"dedicated":true,"host":null,"epoch":1,"seed":0,"players":[{"id":0,"name":"You","driver":0,"role":"driver"},{"id":1,"name":"Friend","driver":1,"role":"driver"}]})).unwrap();
        let client = NativeClient::from_packet(&arena.packet(0), 0.0).unwrap();
        let view = client.view();
        assert!(occupied(&view, &view.actors[1].color));
        assert!(!occupied(&view, &view.actors[0].color));
        assert!(!occupied(&view, &view.actors[2].color));
    }
}
