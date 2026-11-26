//! Secondary double-tap-X abilities: Houston's Nightmare Fuel (#7) and
//! Avita-Jas's Wormhole (#8). Damage is authoritative and independent of rendering.
use super::*;
pub(super) const NIGHTMARE_DURATION: f64 = 13.0;
pub(super) const NIGHTMARE_COOLDOWN: f64 = 30.0;
pub(super) const NIGHTMARE_LENGTH: f64 = 29.0;

pub(super) const WORMHOLE_DURATION: f64 = 8.0;
pub(super) const WORMHOLE_COOLDOWN: f64 = 24.0;
pub(super) const WORMHOLE_OFFSET: f64 = 14.0;
pub(super) const WORMHOLE_RADIUS: f64 = 20.0;
pub(super) const WORMHOLE_KILL_RADIUS: f64 = 4.6;

impl Game {
    pub(super) fn nightmare(&mut self, id: usize) {
        let a = &self.actors[id];
        if !self.global.special_abilities
            || !self.active(id)
            || self.global.finish_countdown.is_some()
            || !matches!(a.driver, 7 | 8)
            || !ability_on(id, 1)
            || a.nightmare_cooldown > 1e-8
        {
            return;
        }
        let driver = a.driver;
        let a = &mut self.actors[id];
        if driver == 8 {
            a.nightmare_active = WORMHOLE_DURATION;
            a.nightmare_cooldown = WORMHOLE_COOLDOWN;
            a.notice = "WORMHOLE".into();
            a.notice_time = 2.4;
            sound(&mut self.global, "teleportOut", id, a.wx, a.wz, None);
        } else {
            a.nightmare_active = NIGHTMARE_DURATION;
            a.nightmare_cooldown = NIGHTMARE_COOLDOWN;
            a.boost = NIGHTMARE_DURATION;
            a.notice = "NIGHTMARE FUEL".into();
            a.notice_time = 2.4;
            effect(&mut self.global, "boost", id, a.wx, a.wz, None);
        }
    }
    pub(super) fn nightmare_tick(&mut self, dt: f64) {
        if !self.global.special_abilities {
            for a in &mut self.actors {
                if a.driver == 7 && a.nightmare_active > 0.0 {
                    a.boost = 0.0;
                }
                a.nightmare_active = 0.0;
            }
            return;
        }
        let mut hits: Vec<(usize, usize, f64, &'static str)> = Vec::new();
        let mut pulls: Vec<(usize, f64, f64)> = Vec::new();
        let arena = self.global.arena;
        for source in &self.actors {
            if source.nightmare_active <= 0.0
                || source.destroyed > 0.0
                || source.inactive
                || source.afk
                || self.frozen(source.id)
            {
                continue;
            }
            if source.driver == 7 && source.boost > 0.0 {
                for target in &self.actors {
                    if source.id == target.id
                        || target.destroyed > 0.0
                        || target.inactive
                        || target.afk
                        || target.bomber
                    {
                        continue;
                    }
                    let dx = target.wx - source.wx;
                    let dz = target.wz - source.wz;
                    let behind = -dx * source.heading.sin() - dz * source.heading.cos();
                    let side = (dx * source.heading.cos() - dz * source.heading.sin()).abs();
                    let strength = source.nightmare_active.clamp(0.0, 1.0);
                    if (3.5..=3.5 + NIGHTMARE_LENGTH * strength).contains(&behind)
                        && side <= 3.0 * strength.sqrt()
                        && wall_clear(arena, source.wx, source.wz, target.wx, target.wz)
                    {
                        hits.push((target.id, source.id, target.health, "nightmare"));
                    }
                }
            } else if source.driver == 8 {
                let wx = source.wx + source.heading.sin() * WORMHOLE_OFFSET;
                let wz = source.wz + source.heading.cos() * WORMHOLE_OFFSET;
                for target in &self.actors {
                    if source.id == target.id
                        || target.destroyed > 0.0
                        || target.inactive
                        || target.afk
                        || target.bomber
                    {
                        continue;
                    }
                    let dx = wx - target.wx;
                    let dz = wz - target.wz;
                    let dist = dx.hypot(dz);
                    if dist >= WORMHOLE_RADIUS {
                        continue;
                    }
                    if dist <= WORMHOLE_KILL_RADIUS {
                        hits.push((target.id, source.id, target.health, "wormhole"));
                    } else {
                        // Tidal gravity pull: gentle enough at the outer rim to escape with turbo,
                        // rapidly accelerating into inescapable spaghettification near the center!
                        let t = 1.0 - dist / WORMHOLE_RADIUS;
                        let pull = (16.0 + 48.0 * t * t) * dt;
                        let step = pull.min(dist - WORMHOLE_KILL_RADIUS * 0.5);
                        pulls.push((target.id, dx / dist * step, dz / dist * step));
                    }
                }
            }
        }
        for (target_id, px, pz) in pulls {
            let a = &mut self.actors[target_id];
            let nx = a.wx + px;
            let nz = a.wz + pz;
            if !blocked(arena, nx, nz, 1.8) {
                a.wx = nx;
                a.wz = nz;
            }
        }
        for (target, source, health, kind) in hits {
            self.damage(target, source, health.max(1.0), kind);
        }
        for id in 0..self.actors.len() {
            if self.frozen(id) {
                continue;
            }
            let a = &mut self.actors[id];
            a.nightmare_cooldown = (a.nightmare_cooldown - dt).max(0.0);
            let ended = a.destroyed > 0.0
                || a.afk
                || a.inactive
                || (a.driver == 7 && a.boost <= 0.0);
            a.nightmare_active = match ended {
                true => 0.0,
                false => (a.nightmare_active - dt).max(0.0),
            };
        }
    }
}
