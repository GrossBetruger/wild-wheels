//! Server-only arena catalog.
//! Add new maps here (or provide `WILD_WHEELS_ARENAS_FILE`) so `rust-core`,
//! `gameplay/`, and `native-client/` stay untouched and `run_client.sh` never
//! needs to rebuild when maps are added or edited.
use std::sync::Once;
use wild_wheels_core::{ArenaDef, default_arenas, set_arena_defs};

pub fn extra_arenas() -> Vec<ArenaDef> {
    vec![
        ArenaDef {
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
        },
        ArenaDef {
            name: "Bridges of Königsberg".into(),
            desc: "Four landmasses, seven bridges. No Eulerian walk, only ambushes.".into(),
            size: 96.0,
            shape: "square".into(),
            max_players: None,
            ground: "#a69d8b".into(),
            wall: "#3b7396".into(),
            sky: "#c6dce8".into(),
            blocks: vec![
                // North Pregel River (z in [-41, -29]): 3 bridges at x = -65, -25 (to Kneiphof) and +55 (to Lomse)
                [-84.5, -35.0, 23.0, 12.0],
                [-45.0, -35.0, 24.0, 12.0],
                [15.0, -35.0, 64.0, 12.0],
                [79.5, -35.0, 33.0, 12.0],
                // South Pregel River (z in [+29, +41]): 3 bridges at x = -65, -25 (to Kneiphof) and +55 (to Lomse)
                [-84.5, 35.0, 23.0, 12.0],
                [-45.0, 35.0, 24.0, 12.0],
                [15.0, 35.0, 64.0, 12.0],
                [79.5, 35.0, 33.0, 12.0],
                // Central Pregel Channel (x in [+9, +21]): 1 bridge at z = 0 (Honigbrücke between Kneiphof and Lomse)
                [15.0, -19.0, 12.0, 20.0],
                [15.0, 19.0, 12.0, 20.0],
            ],
        },
    ]
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

    #[test]
    fn konigsberg_matches_euler_graph_with_clear_spawns_and_connected_bridges() {
        ensure_loaded();
        let arenas = server_arenas();
        let map = &arenas[4];
        assert_eq!(map.name, "Bridges of Königsberg");
        assert!(map.valid());
        assert_eq!(map.max_players, None);
        assert_eq!(map.blocks.len(), 10);

        // Every 8-player spawn point has >= 10 units of wall clearance.
        let radius = map.spawn_radius();
        for i in 0..8 {
            let a = i as f64 * std::f64::consts::FRAC_PI_4;
            assert!(
                !map.blocked(a.sin() * radius, a.cos() * radius, 10.0),
                "spawn {i} is too close to a wall"
            );
        }

        // All open cells on the 18x18 bot navigation grid are mutually reachable.
        let cell_coord = |i: i32| (i * 10 - 85) as f64;
        let is_open = |nx: i32, nz: i32| !map.blocked(cell_coord(nx), cell_coord(nz), 3.0);
        let open: Vec<(i32, i32)> = (0..18)
            .flat_map(|nz| (0..18).map(move |nx| (nx, nz)))
            .filter(|&(nx, nz)| is_open(nx, nz))
            .collect();
        assert!(open.len() > 220);

        let mut seen = HashSet::from([open[0]]);
        let mut queue = VecDeque::from([open[0]]);
        while let Some((x, z)) = queue.pop_front() {
            for (dx, dz) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
                let next = (x + dx, z + dz);
                if (0..18).contains(&next.0)
                    && (0..18).contains(&next.1)
                    && !seen.contains(&next)
                    && is_open(next.0, next.1)
                {
                    seen.insert(next);
                    queue.push_back(next);
                }
            }
        }
        assert_eq!(seen.len(), open.len(), "Bridges of Königsberg must be 100% connected");

        // Excluding the three Pregel river lines (z = -35, z = +35, and x = +15 between them)
        // must partition the arena into exactly 4 landmasses connected by 7 bridges with degrees [3, 3, 3, 5].
        let is_river_band = |nx: i32, nz: i32| {
            let (wx, wz) = (cell_coord(nx), cell_coord(nz));
            wz == -35.0 || wz == 35.0 || (wx == 15.0 && (-25.0..=25.0).contains(&wz))
        };
        let mut land_id = std::collections::HashMap::new();
        let mut num_lands = 0usize;
        for &(nx, nz) in &open {
            if is_river_band(nx, nz) || land_id.contains_key(&(nx, nz)) {
                continue;
            }
            let id = num_lands;
            num_lands += 1;
            let mut q = VecDeque::from([(nx, nz)]);
            land_id.insert((nx, nz), id);
            while let Some((x, z)) = q.pop_front() {
                for (dx, dz) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
                    let next = (x + dx, z + dz);
                    if (0..18).contains(&next.0)
                        && (0..18).contains(&next.1)
                        && !is_river_band(next.0, next.1)
                        && is_open(next.0, next.1)
                        && !land_id.contains_key(&next)
                    {
                        land_id.insert(next, id);
                        q.push_back(next);
                    }
                }
            }
        }
        assert_eq!(num_lands, 4, "expected 4 Königsberg landmasses");

        // Group contiguous open cells inside the river bands into individual bridges.
        let mut bridge_seen = HashSet::new();
        let mut degrees = vec![0usize; num_lands];
        let mut bridge_count = 0usize;
        for &(nx, nz) in &open {
            if !is_river_band(nx, nz) || bridge_seen.contains(&(nx, nz)) {
                continue;
            }
            bridge_count += 1;
            let mut touched = HashSet::new();
            let mut q = VecDeque::from([(nx, nz)]);
            bridge_seen.insert((nx, nz));
            while let Some((x, z)) = q.pop_front() {
                for (dx, dz) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
                    let next = (x + dx, z + dz);
                    if !(0..18).contains(&next.0) || !(0..18).contains(&next.1) {
                        continue;
                    }
                    if let Some(&land) = land_id.get(&next) {
                        touched.insert(land);
                    } else if is_river_band(next.0, next.1)
                        && is_open(next.0, next.1)
                        && bridge_seen.insert(next)
                    {
                        q.push_back(next);
                    }
                }
            }
            assert_eq!(touched.len(), 2, "each bridge must connect exactly 2 landmasses");
            for land in touched {
                degrees[land] += 1;
            }
        }
        degrees.sort();
        assert_eq!(bridge_count, 7, "expected exactly 7 bridges");
        assert_eq!(degrees, vec![3, 3, 3, 5], "expected Euler's Königsberg degree sequence");
    }

    #[test]
    fn konigsberg_supports_eight_players_bot_combat_and_streams_inline_def_to_clients() {
        ensure_loaded();
        let mut room = Room::new(4, 7);
        room.join(&json!({"name":"Euler","driver":0})).unwrap();
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
        assert!(
            total_kills >= 1.0,
            "expected active bot kills on Bridges of Königsberg, got {total_kills}"
        );

        let packet = room.core.packet(0);
        let meta_len = u32::from_le_bytes(packet[4..8].try_into().unwrap()) as usize;
        let meta: Value = serde_json::from_slice(&packet[16..16 + meta_len]).unwrap();
        assert_eq!(meta["state"]["world"]["arenaDef"]["name"], "Bridges of Königsberg");
        assert_eq!(
            meta["state"]["world"]["arenaDef"]["blocks"]
                .as_array()
                .unwrap()
                .len(),
            10
        );

        let mut client = NativeClient::from_packet(&packet, 0.0).unwrap();
        assert_eq!(client.view().arena, 4);
        assert_eq!(client.view().arena_def.name, "Bridges of Königsberg");
        assert_eq!(client.view().blocks.len(), 10);
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
