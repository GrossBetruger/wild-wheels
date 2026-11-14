//! Test adapter for replaying browser-generated traces through the owned client.
//! JSON is used only by this diagnostic process, never by native rendering.
use serde::Deserialize;
use serde_json::json;
use std::{
    error::Error,
    io::{self, Read},
};
use wild_wheels_core::{ClientAction, ClientInput, NativeClient};

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
enum Operation {
    Accept {
        packet: Vec<u8>,
        now: f64,
    },
    Frame {
        dt: f64,
        keys: u32,
        steer: Option<f64>,
        now: f64,
    },
    Action {
        kind: String,
        now: f64,
    },
    Outbound {
        keys: u32,
    },
    Snapshot,
}
fn main() -> Result<(), Box<dyn Error>> {
    let mut bytes = Vec::new();
    io::stdin()
        .lock()
        .take(32 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() > 32 * 1024 * 1024 {
        return Err("Replay exceeds 32 MiB".into());
    }
    let operations: Vec<Operation> = serde_json::from_slice(&bytes)?;
    let mut client = None;
    let mut output = Vec::new();
    for operation in operations {
        match operation {
            Operation::Accept { packet, now } => match client.as_mut() {
                Some(client) => NativeClient::accept(client, &packet, now)?,
                None => client = Some(NativeClient::from_packet(&packet, now)?),
            },
            operation => {
                let client = client.as_mut().ok_or("Replay must start with a packet")?;
                match operation {
                    Operation::Frame {
                        dt,
                        keys,
                        steer,
                        now,
                    } => client.advance(dt, ClientInput { keys, steer }, now)?,
                    Operation::Action { kind, now } => {
                        let action = match kind.as_str() {
                            "fire" => ClientAction::Fire,
                            "cycle" => ClientAction::CycleWeapon,
                            "turbo" => ClientAction::Boost,
                            "chaff" => ClientAction::Chaff,
                            "somersault" => ClientAction::Somersault,
                            _ => return Err("Unsupported replay action".into()),
                        };
                        output.push(json!({"accepted":client.action(action,now)?}));
                    }
                    Operation::Outbound { keys } => output.push(serde_json::from_slice(
                        &client.outbound(ClientInput { keys, steer: None })?,
                    )?),
                    Operation::Snapshot => {
                        let view = client.view();
                        let actor = view.player;
                        let mut state = json!({"you":view.you,"phase":view.phase,"wx":actor.wx,"wz":actor.wz,"heading":actor.heading,"cameraHeading":actor.camera_heading,"health":actor.health,"deaths":actor.deaths,"ammo":actor.ammo,"missiles":actor.missiles,"item":actor.item,"boost":actor.boost,"somersault":actor.somersault,"movementAck":view.movement_ack,"actionAck":view.action_ack,
                            "projectiles":view.projectiles.iter().map(|p|json!({"id":p.id,"wx":p.wx,"wz":p.wz,"height":p.height,"owner":p.owner,"kind":p.kind})).collect::<Vec<_>>()});
                        state["events"] = json!(client.drain_audio());
                        output.push(state);
                    }
                    Operation::Accept { .. } => unreachable!("packets are handled above"),
                }
            }
        }
    }
    println!("{}", json!({"rows":output}));
    Ok(())
}
