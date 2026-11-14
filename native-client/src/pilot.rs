//! Developer sparring controller. Uses ordinary client inputs and actions only.
use wild_wheels_core::{ClientAction, ClientInput, NativeClient};
pub fn drive(client: &mut NativeClient, now: f64) -> ClientInput {
    let view = client.view();
    let own = view.player;
    let Some(target) = view
        .actors
        .iter()
        .filter(|a| a.id != view.you && !a.inactive && !a.bomber && a.destroyed <= 0.0 && !a.afk)
        .min_by(|a, b| {
            ((a.wx - own.wx).hypot(a.wz - own.wz)).total_cmp(&(b.wx - own.wx).hypot(b.wz - own.wz))
        })
    else {
        return ClientInput::default();
    };
    let distance = (target.wx - own.wx).hypot(target.wz - own.wz);
    let route = client.route_to(target.id);
    let goal = route
        .iter()
        .find(|p| (p[0] - own.wx).hypot(p[1] - own.wz) > 5.0)
        .copied()
        .unwrap_or([target.wx, target.wz]);
    let direct = route.len() == 1;
    let lead = match direct {
        true => (distance / 100.0).min(0.25),
        false => 0.0,
    };
    let desired = (goal[0] + target.heading.sin() * target.speed * lead - own.wx)
        .atan2(goal[1] + target.heading.cos() * target.speed * lead - own.wz);
    let difference = desired - own.heading;
    let turn = difference.sin().atan2(difference.cos());
    let input = ClientInput {
        keys: match direct && distance < 20.0 && turn.abs() < 0.3 {
            true => 2,
            false => 1,
        },
        steer: Some((turn * 2.5).clamp(-1.0, 1.0)),
    };
    let cycle = own.missiles > 0 && own.item != "missile";
    let shoot = direct && turn.abs() < 0.32 && distance < 90.0;
    let chaff = view
        .projectiles
        .iter()
        .any(|p| p.kind == "missile" && p.target == Some(view.you));
    if cycle {
        let _ = client.action(ClientAction::CycleWeapon, now);
    }
    if shoot {
        let _ = client.action(ClientAction::Fire, now);
    }
    if chaff {
        let _ = client.action(ClientAction::Chaff, now);
    }
    input
}
