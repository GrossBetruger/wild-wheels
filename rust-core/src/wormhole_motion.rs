// Bake a radial two-mass spring at compile time. The leading end falls faster
// in the gravity gradient. Each end stays absorbed once it crosses the horizon.
const HZ: usize = 120;
const FRAMES: usize = HZ * 2 + 1;
const fn bake() -> [[f64; 3]; FRAMES] {
    let mut frames = [[0.0; 3]; FRAMES];
    let (mut front, mut back) = (6.0_f64, 7.0_f64);
    let (mut front_speed, mut back_speed) = (0.0, 0.0);
    let mut i = 0;
    while i < FRAMES {
        let length = back - front;
        // The tidal strain thins the body as it stretches. Once the front
        // disappears, the visible cross-section also tapers into the horizon.
        let width = (1.0 / (1.0 + 1.8 * (length - 1.0).max(0.0))) * back.min(1.0);
        frames[i] = [(front + back) / 13.0, length, width];
        let tension = 1.2 * (length - 1.0);
        front_speed += (-250.0 / (1.0 + front * front) + tension) / HZ as f64;
        back_speed += (-250.0 / (1.0 + back * back) - tension) / HZ as f64;
        front = (front + front_speed / HZ as f64).max(0.0);
        back = (back + back_speed / HZ as f64).max(0.0);
        i += 1;
    }
    frames
}

/// A captured racer remains visible along the simulated fall until both ends
/// cross the horizon. Keep following the portable hole while its caster lives.
pub fn wormhole_transform(view: &crate::ClientView, victim: &crate::Actor) -> Option<([f32; 3], f32, [f32; 3])> {
    let fx = view.effects.iter().find(|e| e.kind == "wormholeCapture" && e.owner == Some(victim.id))?;
    let caster = victim.last_killer.and_then(|id| view.actors.iter().find(|a| a.id == id && a.driver == 8 && a.nightmare_active > 0.0));
    let (x,z) = caster.map_or((fx.wx, fx.wz), |a| (a.wx + 14.0*a.heading.sin(), a.wz + 14.0*a.heading.cos()));
    let remaining = wormhole_sample(fx.age, 0);
    let width = wormhole_sample(fx.age, 2) as f32;
    let (dx,dz) = (x-victim.wx,z-victim.wz);
    let toward = if dx.hypot(dz) < 0.01 { fx.heading.unwrap_or(victim.heading) } else { dx.atan2(dz) };
    let turn = toward - victim.heading;
    let heading = victim.heading + turn.sin().atan2(turn.cos())*(fx.age*3.0).min(1.0);
    Some(([(x-dx*remaining) as f32,(2.6*(1.0-remaining)) as f32,(z-dz*remaining) as f32], heading as f32, [width,width,wormhole_sample(fx.age,1) as f32]))
}

const MOTION: [[f64; 3]; FRAMES] = bake();

/// Remaining distance, longitudinal scale and transverse scale, respectively.
#[unsafe(no_mangle)]
pub extern "C" fn wormhole_sample(age: f64, component: usize) -> f64 {
    let frame = (age * HZ as f64).clamp(0.0, (FRAMES - 1) as f64);
    let first = frame as usize;
    let next = (first + 1).min(FRAMES - 1);
    let c = component.min(2);
    MOTION[first][c] + (MOTION[next][c] - MOTION[first][c]) * frame.fract()
}
