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
            water: vec![],
            bridges: vec![],
            spawns: vec![],
        },
        ArenaDef {
            name: "Bridges of Königsberg".into(),
            desc: "Pregel River, Kneiphof island, Lomse, both banks, and all seven bridges.".into(),
            size: 96.0,
            shape: "square".into(),
            max_players: None,
            ground: "#a89f8d".into(),
            wall: "#7f7264".into(),
            sky: "#c6dce8".into(),
            blocks: vec![],
            // Exact Pregel River system from Euler's 1736 Königsberg setting (zero overlapping volumes):
            // United western river exiting west along z = 0, splitting around Kneiphof island,
            // merging at Honigbrücke, and flaring into the New Pregel (NE) and Old Pregel (SE) around Lomse.
            water: vec![
                // United Western Pregel exiting west (x in [-96, -58], z in [-7, +7])
                [-77.0, 0.0, 38.0, 14.0],
                // West river prow wrapping Kneiphof's western tip (x in [-58, -48], z in [-18, +18])
                [-53.0, 0.0, 10.0, 36.0],
                // North Kneiphof channel (z in [-29, -19]): Krämerbrücke (x=-35), Schmiedebrücke (x=-5)
                [-47.5, -23.5, 9.0, 11.0],
                [-20.0, -24.0, 14.0, 10.0],
                [11.5, -24.0, 17.0, 10.0],
                // South Kneiphof channel (z in [+19, +29]): Grüne Brücke (x=-35), Köttelbrücke (x=-5)
                [-47.5, 23.5, 9.0, 11.0],
                [-20.0, 24.0, 14.0, 10.0],
                [11.5, 24.0, 17.0, 10.0],
                // Central Pregel channel between Kneiphof and Lomse: Honigbrücke (z in [-9, +9])
                [15.0, -14.0, 10.0, 10.0],
                [15.0, 14.0, 10.0, 10.0],
                // New Pregel (NE branch wrapping north of Lomse): Holzbrücke (x=+55)
                [33.5, -30.0, 27.0, 12.0],
                [70.5, -37.0, 15.0, 12.0],
                [87.0, -45.0, 18.0, 12.0],
                // Old Pregel (SE branch wrapping south of Lomse): Hohe Brücke (x=+55)
                [33.5, 30.0, 27.0, 12.0],
                [70.5, 37.0, 15.0, 12.0],
                [87.0, 45.0, 18.0, 12.0],
            ],
            // The Seven Bridges of Königsberg: [x, z, w, d, axis] (0 = N-S span, 1 = E-W span)
            bridges: vec![
                [-35.0, -24.0, 16.0, 10.0, 0.0], // 1. Krämerbrücke (North Bank <-> Kneiphof)
                [-5.0, -24.0, 16.0, 10.0, 0.0],  // 2. Schmiedebrücke (North Bank <-> Kneiphof)
                [55.0, -32.0, 16.0, 12.0, 0.0],  // 3. Holzbrücke (North Bank <-> Lomse)
                [-35.0, 24.0, 16.0, 10.0, 0.0],  // 4. Grüne Brücke (South Bank <-> Kneiphof)
                [-5.0, 24.0, 16.0, 10.0, 0.0],   // 5. Köttelbrücke (South Bank <-> Kneiphof)
                [55.0, 32.0, 16.0, 12.0, 0.0],   // 6. Hohe Brücke (South Bank <-> Lomse)
                [15.0, 0.0, 10.0, 18.0, 1.0],    // 7. Honigbrücke (Kneiphof <-> Lomse)
            ],
            // Two spawns on each of the four landmasses (North Bank, South Bank, Kneiphof, Lomse)
            spawns: vec![
                [-56.0, -62.0],
                [22.0, -68.0],
                [-34.0, -6.0],
                [-6.0, 6.0],
                [-56.0, 62.0],
                [22.0, 68.0],
                [46.0, -8.0],
                [76.0, 8.0],
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
        assert_eq!(map.blocks.len(), 0);
        assert_eq!(map.water.len(), 16);
        assert_eq!(map.bridges.len(), 7);
        assert_eq!(map.spawns.len(), 8);

        // Water rectangles never overlap in interior volume (prevents coplanar Z-fighting).
        for i in 0..map.water.len() {
            for j in i + 1..map.water.len() {
                let (a, b) = (map.water[i], map.water[j]);
                let ox = (a[0] + a[2] / 2.0).min(b[0] + b[2] / 2.0)
                    - (a[0] - a[2] / 2.0).max(b[0] - b[2] / 2.0);
                let oz = (a[1] + a[3] / 2.0).min(b[1] + b[3] / 2.0)
                    - (a[1] - a[3] / 2.0).max(b[1] - b[3] / 2.0);
                assert!(
                    ox <= 1e-6 || oz <= 1e-6,
                    "water segments {i} and {j} overlap ({ox} x {oz})"
                );
            }
        }

        // Every 8-player spawn point has >= 10 units of clearance from river and outer walls.
        for (i, [sx, sz]) in map.spawn_points().into_iter().enumerate() {
            assert!(
                !map.blocked(sx, sz, 10.0),
                "spawn {i} ({sx}, {sz}) is too close to water or wall"
            );
        }

        // River blocks karts/navigation (`blocked`), while projectiles fly freely over water (`!wall_blocked`).
        assert!(map.blocked(-77.0, 0.0, 2.0));
        assert!(!map.wall_blocked(-77.0, 0.0, 0.3));
        // Kneiphof is a true island enclosed by water to its west (x=-53) before the western Pregel mouth (x=-77).
        assert!(map.blocked(-53.0, 0.0, 2.0));
        assert!(!map.blocked(-20.0, 0.0, 2.0));
        assert!(!map.blocked(60.0, 0.0, 2.0));

        // All open cells on the 18x18 bot navigation grid are mutually reachable.
        let cell_coord = |i: i32| (i * 10 - 85) as f64;
        let is_open = |nx: i32, nz: i32| !map.blocked(cell_coord(nx), cell_coord(nz), 3.0);
        let open: Vec<(i32, i32)> = (0..18)
            .flat_map(|nz| (0..18).map(move |nx| (nx, nz)))
            .filter(|&(nx, nz)| is_open(nx, nz))
            .collect();
        assert!(open.len() > 200);

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
        assert_eq!(
            seen.len(),
            open.len(),
            "Bridges of Königsberg must be 100% connected"
        );

        // Removing the 7 bridge spans on a fine 2-unit grid must partition the arena into
        // EXACTLY 4 landmasses (North Bank, South Bank, Kneiphof Island, Lomse) linked by
        // EXACTLY 7 bridges with Euler's exact degree sequence [3, 3, 3, 5].
        let on_bridge = |wx: f64, wz: f64| {
            map.bridges.iter().position(|b| {
                (wx - b[0]).abs() <= b[2] / 2.0 + 1.0 && (wz - b[1]).abs() <= b[3] / 2.0 + 1.0
            })
        };
        let coord = |i: i32| -94.0 + i as f64 * 2.0;
        let n_cells = 95_i32; // -94..=+94
        let is_land = |ix: i32, iz: i32| {
            let (wx, wz) = (coord(ix), coord(iz));
            !map.blocked(wx, wz, 2.0) && on_bridge(wx, wz).is_none()
        };
        let mut land_id = std::collections::HashMap::new();
        let mut num_lands = 0usize;
        for iz in 0..n_cells {
            for ix in 0..n_cells {
                if !is_land(ix, iz) || land_id.contains_key(&(ix, iz)) {
                    continue;
                }
                let id = num_lands;
                num_lands += 1;
                let mut q = VecDeque::from([(ix, iz)]);
                land_id.insert((ix, iz), id);
                while let Some((x, z)) = q.pop_front() {
                    for (dx, dz) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
                        let next = (x + dx, z + dz);
                        if (0..n_cells).contains(&next.0)
                            && (0..n_cells).contains(&next.1)
                            && is_land(next.0, next.1)
                            && !land_id.contains_key(&next)
                        {
                            land_id.insert(next, id);
                            q.push_back(next);
                        }
                    }
                }
            }
        }
        assert_eq!(num_lands, 4, "expected exactly 4 Königsberg landmasses");

        // Confirm the four named landmarks lie on four distinct landmasses.
        let land_at = |wx: f64, wz: f64| {
            let ix = ((wx + 94.0) / 2.0).round() as i32;
            let iz = ((wz + 94.0) / 2.0).round() as i32;
            *land_id.get(&(ix, iz)).expect("landmark should be on land")
        };
        let north_bank = land_at(-76.0, -40.0);
        let south_bank = land_at(-76.0, 40.0);
        let kneiphof = land_at(-20.0, 0.0);
        let lomse = land_at(64.0, 0.0);
        assert_eq!(
            HashSet::from([north_bank, south_bank, kneiphof, lomse]).len(),
            4,
            "North Bank, South Bank, Kneiphof, and Lomse must be 4 distinct landmasses"
        );
        // Each landmass gets exactly 2 of the 8 spawns.
        let mut spawns_per_land = vec![0usize; 4];
        for [sx, sz] in map.spawn_points() {
            spawns_per_land[land_at(sx, sz)] += 1;
        }
        assert_eq!(spawns_per_land, vec![2, 2, 2, 2]);

        // Verify each of the 7 bridges joins its exact pair of landmasses.
        let mut degrees = vec![0usize; 4];
        let mut pair_counts = std::collections::HashMap::new();
        for (bi, b) in map.bridges.iter().enumerate() {
            let (a, c) = if b[4] == 0.0 {
                (
                    land_at(b[0], b[1] - b[3] / 2.0 - 4.0),
                    land_at(b[0], b[1] + b[3] / 2.0 + 4.0),
                )
            } else {
                (
                    land_at(b[0] - b[2] / 2.0 - 4.0, b[1]),
                    land_at(b[0] + b[2] / 2.0 + 4.0, b[1]),
                )
            };
            assert_ne!(a, c, "bridge {bi} must join two distinct landmasses");
            degrees[a] += 1;
            degrees[c] += 1;
            let edge = if a < c { (a, c) } else { (c, a) };
            *pair_counts.entry(edge).or_insert(0usize) += 1;
        }
        assert_eq!(degrees[north_bank], 3);
        assert_eq!(degrees[south_bank], 3);
        assert_eq!(degrees[kneiphof], 5);
        assert_eq!(degrees[lomse], 3);
        let pair = |u: usize, v: usize| if u < v { (u, v) } else { (v, u) };
        assert_eq!(pair_counts.get(&pair(north_bank, kneiphof)), Some(&2));
        assert_eq!(pair_counts.get(&pair(south_bank, kneiphof)), Some(&2));
        assert_eq!(pair_counts.get(&pair(north_bank, lomse)), Some(&1));
        assert_eq!(pair_counts.get(&pair(south_bank, lomse)), Some(&1));
        assert_eq!(pair_counts.get(&pair(kneiphof, lomse)), Some(&1));
        assert_eq!(pair_counts.get(&pair(north_bank, south_bank)), None);
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
        assert_eq!(
            meta["state"]["world"]["arenaDef"]["name"],
            "Bridges of Königsberg"
        );
        assert_eq!(
            meta["state"]["world"]["arenaDef"]["water"]
                .as_array()
                .unwrap()
                .len(),
            16
        );
        assert_eq!(
            meta["state"]["world"]["arenaDef"]["bridges"]
                .as_array()
                .unwrap()
                .len(),
            7
        );

        let mut client = NativeClient::from_packet(&packet, 0.0).unwrap();
        assert_eq!(client.view().arena, 4);
        assert_eq!(client.view().arena_def.name, "Bridges of Königsberg");
        assert_eq!(client.view().arena_def.water.len(), 16);
        assert_eq!(client.view().arena_def.bridges.len(), 7);
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
