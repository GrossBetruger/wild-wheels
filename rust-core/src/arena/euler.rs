//! Easter egg on Bridges of Königsberg: tracks continuous non-repeating bridge
//! crossings per life. Crossing 6/7 distinct bridges hits Euler's mathematical
//! limit; crossing all 7 distinct bridges in one life without repeating any
//! bridge (possible by breaking the graph with Tammy's Cricket's Jump) triggers
//! the "EULERIAN PATH!" Easter egg. Death or repeating a bridge resets the path.
use super::*;

/// Königsberg bridge graph: 0=North Bank, 1=South Bank, 2=Kneiphof, 3=Lomse.
const EDGES: [(usize, usize); 7] = [
    (0, 2), // 0: Krämerbrücke
    (0, 2), // 1: Schmiedebrücke
    (0, 3), // 2: Holzbrücke
    (1, 2), // 3: Grüne Brücke
    (1, 2), // 4: Köttelbrücke
    (1, 3), // 5: Hohe Brücke
    (2, 3), // 6: Honigbrücke
];

fn landmass(wx: f64, wz: f64) -> usize {
    if (-50.0..=15.0).contains(&wx) && wz.abs() <= 24.0 {
        2 // Kneiphof
    } else if wx > 15.0 && wz.abs() <= 31.0 + ((wx - 20.0).max(0.0) * 0.25) {
        3 // Lomse
    } else if wz < 0.0 {
        0 // North Bank
    } else {
        1 // South Bank
    }
}

fn longest_trail(land: usize, mask: u16) -> (usize, Option<usize>) {
    let mut best_len = 0usize;
    let mut best_bridge = None;
    for (idx, &(a, b)) in EDGES.iter().enumerate() {
        let bit = 1u16 << idx;
        if mask & bit != 0 {
            continue;
        }
        let next = if a == land {
            b
        } else if b == land {
            a
        } else {
            continue;
        };
        let (sub_len, _) = longest_trail(next, mask | bit);
        if 1 + sub_len > best_len {
            best_len = 1 + sub_len;
            best_bridge = Some(idx);
        }
    }
    (best_len, best_bridge)
}

/// Returns the next unvisited bridge index on a longest non-repeating trail from
/// `(wx, wz)` (reaching 6/7 continuously, then pointing to the 7th bridge).
pub fn next_euler_bridge(wx: f64, wz: f64, visited: u16) -> Option<usize> {
    if visited.count_ones() >= 7 {
        return None;
    }
    if visited.count_ones() == 6 {
        return (0..7).find(|i| visited & (1u16 << i) == 0);
    }
    let land = landmass(wx, wz);
    longest_trail(land, visited)
        .1
        .or_else(|| (0..7).find(|i| visited & (1u16 << i) == 0))
}

fn bridge_axis_delta(b: &[f64; 5], wx: f64, wz: f64) -> f64 {
    if b[4] == 1.0 {
        wx - b[0]
    } else {
        wz - b[1]
    }
}

fn on_bridge(b: &[f64; 5], wx: f64, wz: f64) -> bool {
    if b[4] == 1.0 {
        (wx - b[0]).abs() <= b[2] / 2.0 + 0.6 && (wz - b[1]).abs() <= b[3] / 2.0
    } else {
        (wx - b[0]).abs() <= b[2] / 2.0 && (wz - b[1]).abs() <= b[3] / 2.0 + 0.6
    }
}

impl Game {
    pub(super) fn euler_tick(&mut self) {
        if self.global.phase != "racing" {
            for a in &mut self.actors {
                a.euler_bridges = 0;
                a.euler_on_bridge = None;
                a.euler_hinted = false;
            }
            return;
        }
        let Some(def) = arena_def(self.global.arena) else {
            return;
        };
        if def.bridges.len() != 7 {
            return;
        }
        let bridges = def.bridges;
        let mut sounds_to_play: Vec<(&'static str, usize, f64, f64)> = Vec::new();
        for a in &mut self.actors {
            if a.destroyed > 0.0 || a.inactive || a.afk || a.bomber {
                a.euler_bridges = 0;
                a.euler_on_bridge = None;
                a.euler_hinted = false;
                continue;
            }
            let current = bridges
                .iter()
                .enumerate()
                .find(|(_, b)| on_bridge(b, a.wx, a.wz))
                .map(|(idx, b)| {
                    let side = if bridge_axis_delta(b, a.wx, a.wz) < 0.0 {
                        -1_i8
                    } else {
                        1_i8
                    };
                    (idx, side)
                });
            match (a.euler_on_bridge, current) {
                (None, Some((idx, side))) => {
                    a.euler_on_bridge = Some((idx, side));
                }
                (Some((prev_idx, _)), Some((idx, side))) if prev_idx != idx => {
                    a.euler_on_bridge = Some((idx, side));
                }
                (Some((idx, entry_side)), None) => {
                    a.euler_on_bridge = None;
                    let b = &bridges[idx];
                    // Ignore mid-bridge teleports far from the bridge exit.
                    if distance(a.wx, a.wz, b[0], b[1]) <= b[2].max(b[3]) + 10.0 {
                        let exit_side = if bridge_axis_delta(b, a.wx, a.wz) < 0.0 {
                            -1_i8
                        } else {
                            1_i8
                        };
                        if exit_side == -entry_side {
                            let bit = 1u16 << idx;
                            if a.euler_bridges & bit != 0 {
                                // Repeating a bridge breaks the Eulerian path; start fresh from this bridge.
                                a.euler_bridges = bit;
                                a.euler_hinted = false;
                            } else {
                                a.euler_bridges |= bit;
                                let count = a.euler_bridges.count_ones();
                                if count == 6 && !a.euler_hinted {
                                    a.euler_hinted = true;
                                    a.notice = "6/7 BRIDGES · EULER SMILES".into();
                                    a.notice_time = 2.8;
                                    sounds_to_play.push(("pickup", a.id, a.wx, a.wz));
                                } else if count == 7 {
                                    a.notice = "EULERIAN PATH!".into();
                                    a.notice_time = 4.0;
                                    a.celebrate = 1.6;
                                    a.euler_bridges = 0;
                                    a.euler_hinted = false;
                                    sounds_to_play.push(("victory", a.id, a.wx, a.wz));
                                }
                            }
                        }
                    }
                }
                _ => {}
            }
        }
        for (kind, id, wx, wz) in sounds_to_play {
            sound(&mut self.global, kind, id, wx, wz, None);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn eulerian_path_tracks_seven_bridges_and_resets_on_repeat_or_death() {
        let _reg = super::defs::REGISTRY_LOCK.lock().unwrap();
        let _kernel = native::KERNEL.lock().unwrap();
        let bridges = vec![
            [-35.0, -24.0, 16.0, 10.0, 0.0],
            [-5.0, -24.0, 16.0, 10.0, 0.0],
            [55.0, -32.0, 16.0, 12.0, 0.0],
            [-35.0, 24.0, 16.0, 10.0, 0.0],
            [-5.0, 24.0, 16.0, 10.0, 0.0],
            [55.0, 32.0, 16.0, 12.0, 0.0],
            [15.0, 0.0, 10.0, 18.0, 1.0],
        ];
        let mut def = default_arenas()[0].clone();
        def.name = "Bridges of Königsberg".into();
        def.blocks.clear();
        def.bridges = bridges.clone();
        register_arena_def(5, def).unwrap();
        let room: control::Room = serde_json::from_value(json!({
            "code": "00", "maxPlayers": MAX_PLAYERS, "arena": 5, "bots": 0,
            "dedicated": true, "host": null, "epoch": 1, "seed": 7,
            "players": [{"id": 0, "name": "Tammy", "driver": 5, "role": "driver"}],
            "specialAbilities": true,
        }))
        .unwrap();
        let mut game = Game::create_room(&room).unwrap();
        game.global.phase = "racing".into();

        let cross = |g: &mut Game, idx: usize| {
            let b = bridges[idx];
            let (entry, exit) = if b[4] == 1.0 {
                ((b[0] - b[2] / 2.0 + 1.0, b[1]), (b[0] + b[2] / 2.0 + 3.0, b[1]))
            } else {
                ((b[0], b[1] - b[3] / 2.0 + 1.0), (b[0], b[1] + b[3] / 2.0 + 3.0))
            };
            g.actors[0].wx = entry.0;
            g.actors[0].wz = entry.1;
            g.euler_tick();
            g.actors[0].wx = exit.0;
            g.actors[0].wz = exit.1;
            g.euler_tick();
        };

        // Crossing 6 distinct bridges hits Euler's mathematical ceiling (6/7).
        for idx in 0..6 {
            cross(&mut game, idx);
        }
        assert_eq!(game.actors[0].notice, "6/7 BRIDGES · EULER SMILES");

        // Repeating bridge 0 breaks the streak, so crossing bridge 6 alone does not complete 7/7.
        cross(&mut game, 0);
        cross(&mut game, 6);
        assert_ne!(game.actors[0].notice, "EULERIAN PATH!");

        // Death resets the path completely.
        game.actors[0].destroyed = 2.0;
        game.euler_tick();
        assert_eq!(game.actors[0].euler_bridges, 0);
        game.actors[0].destroyed = 0.0;
        game.actors[0].notice.clear();

        // Crossing all 7 distinct bridges in one life (e.g. via Tammy's Cricket's Jump) triggers EULERIAN PATH!
        for idx in 0..7 {
            cross(&mut game, idx);
        }
        assert_eq!(game.actors[0].notice, "EULERIAN PATH!");
        assert!(game.actors[0].celebrate > 0.0);
        set_arena_defs(default_arenas()).unwrap();
    }

    #[test]
    fn euler_guide_leads_to_six_distinct_bridges_from_every_landmass() {
        for (start_x, start_z) in [(-56.0, -62.0), (-56.0, 62.0), (-20.0, 0.0), (60.0, 0.0)] {
            let mut land = landmass(start_x, start_z);
            let mut visited = 0u16;
            for _ in 0..6 {
                let (wx, wz) = match land {
                    0 => (-20.0, -60.0),
                    1 => (-20.0, 60.0),
                    2 => (-20.0, 0.0),
                    _ => (60.0, 0.0),
                };
                let next = next_euler_bridge(wx, wz, visited).expect("must find next bridge");
                let (a, b) = EDGES[next];
                assert!(a == land || b == land, "suggested bridge must touch current landmass");
                assert_eq!(visited & (1u16 << next), 0, "must not repeat a bridge");
                visited |= 1u16 << next;
                land = if a == land { b } else { a };
            }
            assert_eq!(visited.count_ones(), 6);
            // At 6/7, the guide points to the single remaining 7th bridge for Tammy's jump.
            let seventh = next_euler_bridge(0.0, 0.0, visited).expect("must point to 7th bridge");
            assert_eq!(visited & (1u16 << seventh), 0);
        }
    }
}
