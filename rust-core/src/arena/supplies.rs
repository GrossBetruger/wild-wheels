use super::*;
fn random(g: &mut Globals) -> f64 {
    let mut state = g.supply_seed.max(1);
    state ^= state << 13;
    state ^= state >> 17;
    state ^= state << 5;
    g.supply_seed = state;
    state as f64 / 4294967296.0
}
fn safe(g: &Globals, actors: &[Actor], index: usize, x: f64, z: f64) -> bool {
    !blocked(g.arena, x, z, 8.0)
        && !actors.iter().any(|a| {
            !a.inactive
                && !a.afk
                && !a.bomber
                && a.destroyed <= 0.0
                && (a.wx - x).hypot(a.wz - z) < 12.0
        })
        && !g.supplies.iter().enumerate().any(|(i, s)| {
            i != index
                && (s.home_wx.unwrap_or(s.wx) - x).hypot(s.home_wz.unwrap_or(s.wz) - z) < 16.0
        })
}
pub(super) fn place(g: &mut Globals, actors: &[Actor], index: usize) -> bool {
    let mut candidate = None;
    for _ in 0..128 {
        let x = (random(g) * 2.0 - 1.0) * 88.0;
        let z = (random(g) * 2.0 - 1.0) * 88.0;
        if safe(g, actors, index, x, z) {
            candidate = Some((x, z));
            break;
        }
    }
    if candidate.is_none() {
        let cells = 23;
        let start = (random(g) * (cells * cells) as f64).floor() as usize;
        for offset in 0..cells * cells {
            let cell = (start + offset) % (cells * cells);
            let x = -88.0 + (cell % cells) as f64 * 8.0;
            let z = -88.0 + (cell / cells) as f64 * 8.0;
            if safe(g, actors, index, x, z) {
                candidate = Some((x, z));
                break;
            }
        }
    }
    if let Some((x, z)) = candidate {
        let s = &mut g.supplies[index];
        s.wx = x;
        s.wz = z;
        s.home_wx = None;
        s.home_wz = None;
        s.collector = None;
        s.version += 1;
        return true;
    }
    false
}
pub(super) fn tick(g: &mut Globals, actors: &[Actor], dt: f64) {
    for index in 0..g.supplies.len() {
        let before = g.supplies[index].cooldown;
        g.supplies[index].cooldown = (before - dt).max(0.0);
        if dt > 0.0
            && before > 0.0
            && g.supplies[index].cooldown == 0.0
            && g.supplies[index].random_spawn
            && !place(g, actors, index)
        {
            g.supplies[index].cooldown = 0.25;
        }
    }
}
