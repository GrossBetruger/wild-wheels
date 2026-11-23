//! Houston's second ability. Damage is authoritative and independent of rendering.
use super::*;
pub(super) const NIGHTMARE_DURATION: f64 = 13.0;
pub(super) const NIGHTMARE_COOLDOWN: f64 = 30.0;
pub(super) const NIGHTMARE_LENGTH: f64 = 29.0;
impl Game {
    pub(super) fn nightmare(&mut self, id: usize) {
        let a = &self.actors[id];
        if !self.global.special_abilities
            || !self.active(id)
            || self.global.finish_countdown.is_some()
            || a.driver != 7
            || !ability_on(id, 1)
            || a.nightmare_cooldown > 1e-8
        {
            return;
        }
        let a = &mut self.actors[id];
        a.nightmare_active = NIGHTMARE_DURATION;
        a.nightmare_cooldown = NIGHTMARE_COOLDOWN;
        a.boost = NIGHTMARE_DURATION;
        a.notice = "NIGHTMARE FUEL".into();
        a.notice_time = 2.4;
        effect(&mut self.global, "boost", id, a.wx, a.wz, None);
    }
    pub(super) fn nightmare_tick(&mut self, dt: f64) {
        if !self.global.special_abilities {
            for a in &mut self.actors {
                if a.nightmare_active > 0.0 {
                    a.boost = 0.0;
                }
                a.nightmare_active = 0.0;
            }
            return;
        }
        let mut hits = Vec::new();
        for source in &self.actors {
            if source.driver != 7
                || source.nightmare_active <= 0.0
                || source.boost <= 0.0
                || source.destroyed > 0.0
                || source.inactive
                || source.afk
                || self.frozen(source.id)
            {
                continue;
            }
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
                    && wall_clear(
                        self.global.arena,
                        source.wx,
                        source.wz,
                        target.wx,
                        target.wz,
                    )
                {
                    hits.push((target.id, source.id, target.health));
                }
            }
        }
        for (target, source, health) in hits {
            self.damage(target, source, health.max(1.0), "nightmare");
        }
        for id in 0..self.actors.len() {
            if self.frozen(id) {
                continue;
            }
            let a = &mut self.actors[id];
            a.nightmare_cooldown = (a.nightmare_cooldown - dt).max(0.0);
            a.nightmare_active = match a.destroyed > 0.0 || a.afk || a.inactive || a.boost <= 0.0 {
                true => 0.0,
                false => (a.nightmare_active - dt).max(0.0),
            };
        }
    }
}
