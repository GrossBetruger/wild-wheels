//! Server-only arena catalog.
//! Add new maps here (or provide `WILD_WHEELS_ARENAS_FILE`) so `rust-core`,
//! `gameplay/`, and `native-client/` stay untouched and `run_client.sh` never
//! needs to rebuild when maps are added or edited.
use std::sync::Once;
use wild_wheels_core::{ArenaDef, default_arenas, set_arena_defs};

pub fn extra_arenas() -> Vec<ArenaDef> {
    vec![ArenaDef {
        name: "Maze".into(),
        desc: "Twisting hedge labyrinth. Loops, flanks, and ambushes.".into(),
        size: 96.0,
        shape: "square".into(),
        max_players: None,
        ground: "#958e7c".into(),
        wall: "#4d7c58".into(),
        sky: "#c2dbc8".into(),
        blocks: vec![
            // Inner pinwheel hub (38x38 center with four 18-unit staggered entries)
            [-11.0, 22.0, 24.0, 6.0],
            [22.0, 11.0, 6.0, 24.0],
            [11.0, -22.0, 24.0, 6.0],
            [-22.0, -11.0, 6.0, 24.0],
            // Middle staggered ring walls (20-unit inner ring corridor)
            [-21.0, 47.0, 44.0, 6.0],
            [47.0, 21.0, 6.0, 44.0],
            [21.0, -47.0, 44.0, 6.0],
            [-47.0, -21.0, 6.0, 44.0],
            // Connected L-arms extending from mid-ring
            [-41.0, 32.0, 6.0, 36.0],
            [32.0, 41.0, 36.0, 6.0],
            [41.0, -32.0, 6.0, 36.0],
            [-32.0, -41.0, 36.0, 6.0],
            // Radial maze dividers with wide 17-unit passages on both sides
            [21.0, 60.0, 6.0, 32.0],
            [60.0, -21.0, 32.0, 6.0],
            [-21.0, -60.0, 6.0, 32.0],
            [-60.0, 21.0, 32.0, 6.0],
            // Outer corner L-walls wrapping the perimeter highway
            [-51.0, 73.0, 48.0, 6.0],
            [73.0, 51.0, 6.0, 48.0],
            [51.0, -73.0, 48.0, 6.0],
            [-73.0, -51.0, 6.0, 48.0],
            [-72.0, 58.0, 6.0, 36.0],
            [58.0, 72.0, 36.0, 6.0],
            [72.0, -58.0, 6.0, 36.0],
            [-58.0, -72.0, 36.0, 6.0],
        ],
    }]
}

pub fn server_arenas() -> Vec<ArenaDef> {
    let mut arenas = default_arenas();
    arenas.extend(extra_arenas());
    arenas
}

pub fn init() {
    if let Some(arenas_path) = std::env::var_os("WILD_WHEELS_ARENAS_FILE") {
        let text =
            std::fs::read_to_string(&arenas_path).expect("Unable to read WILD_WHEELS_ARENAS_FILE");
        let defs: Vec<ArenaDef> =
            serde_json::from_str(&text).expect("Invalid WILD_WHEELS_ARENAS_FILE JSON");
        set_arena_defs(defs).expect("Invalid arena definitions in WILD_WHEELS_ARENAS_FILE");
        return;
    }
    set_arena_defs(server_arenas()).expect("built-in server arenas must be valid");
}

/// Ensures built-in server arenas are installed once (used by unit tests and `Room::new`).
pub fn ensure_loaded() {
    static INIT: Once = Once::new();
    INIT.call_once(init);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::room::Room;
    use serde_json::{Value, json};
    use std::collections::{HashSet, VecDeque};
    use wild_wheels_core::{ClientInput, Frame, NativeClient};

    #[test]
    fn maze_has_clear_spawns_connected_corridors_and_supports_full_player_count() {
        ensure_loaded();
        let arenas = server_arenas();
        let maze = &arenas[3];
        assert_eq!(maze.name, "Maze");
        assert!(maze.valid());
        assert_eq!(maze.max_players, None);
        assert_eq!(maze.blocks.len(), 24);

        // Every 8-player spawn point has >= 10 units of wall clearance.
        let radius = maze.spawn_radius();
        for i in 0..8 {
            let a = i as f64 * std::f64::consts::FRAC_PI_4;
            assert!(
                !maze.blocked(a.sin() * radius, a.cos() * radius, 10.0),
                "spawn {i} is too close to a wall"
            );
        }

        // All open cells on the 18x18 bot navigation grid are mutually reachable.
        let mut open = Vec::new();
        for nz in 0..18 {
            for nx in 0..18 {
                if !maze.blocked((nx * 10 - 85) as f64, (nz * 10 - 85) as f64, 3.0) {
                    open.push(nx + nz * 18);
                }
            }
        }
        assert!(open.len() > 200);
        let mut seen = HashSet::from([open[0]]);
        let mut queue = VecDeque::from([open[0]]);
        while let Some(n) = queue.pop_front() {
            let (x, z) = (n % 18, n / 18);
            for (dx, dz) in [(1_i32, 0_i32), (-1, 0), (0, 1), (0, -1)] {
                let (nx, nz) = (x + dx, z + dz);
                if !(0..18).contains(&nx) || !(0..18).contains(&nz) {
                    continue;
                }
                let next = nx + nz * 18;
                if !seen.contains(&next)
                    && !maze.blocked((nx * 10 - 85) as f64, (nz * 10 - 85) as f64, 3.0)
                {
                    seen.insert(next);
                    queue.push_back(next);
                }
            }
        }
        assert_eq!(seen.len(), open.len(), "Maze corridors must be 100% connected");
    }

    #[test]
    fn maze_supports_eight_players_bot_combat_and_streams_inline_def_to_clients() {
        ensure_loaded();
        let mut room = Room::new(3, 7);
        room.join(&json!({"name":"Runner","driver":0})).unwrap();
        room.control(0, "/api/control", &json!({"action":"start"}))
            .unwrap();
        for _ in 0..60 * 35 {
            room.core
                .step(Frame {
                    dt: 1.0 / 60.0,
                    inputs: vec![],
                })
                .unwrap();
        }
        let scores = room.core.scores();
        assert_eq!(scores.len(), 8);
        let total_kills: f64 = scores.iter().map(|(_, kills, _)| *kills).sum();
        assert!(total_kills >= 1.0, "expected active bot kills in Maze, got {total_kills}");

        // Verify the wire packet carries inline `arenaDef` so older clients decode & predict Maze without rebuilding.
        let packet = room.core.packet(0);
        let meta_len = u32::from_le_bytes(packet[4..8].try_into().unwrap()) as usize;
        let meta: Value = serde_json::from_slice(&packet[16..16 + meta_len]).unwrap();
        assert_eq!(meta["state"]["world"]["arenaDef"]["name"], "Maze");
        assert_eq!(
            meta["state"]["world"]["arenaDef"]["blocks"]
                .as_array()
                .unwrap()
                .len(),
            24
        );

        let mut client = NativeClient::from_packet(&packet, 0.0).unwrap();
        assert_eq!(client.view().arena, 3);
        assert_eq!(client.view().arena_def.name, "Maze");
        assert_eq!(client.view().blocks.len(), 24);
        client
            .advance(
                1.0 / 60.0,
                ClientInput {
                    keys: 1,
                    steer: None,
                },
                1.0 / 60.0,
            )
            .unwrap();
    }
}
