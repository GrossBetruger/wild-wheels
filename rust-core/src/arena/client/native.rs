//! Owned native adapter for the same prediction/interpolation used by the browser.
//! No Bevy, networking, global client instance, or ABI scratch buffers live here.
use super::*;
use std::{error::Error, fmt};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClientError {
    InvalidPacket,
    InvalidInput,
    KernelUnavailable,
    Encode,
}
impl fmt::Display for ClientError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::InvalidPacket => "invalid arena packet",
            Self::InvalidInput => "invalid client input",
            Self::KernelUnavailable => "movement kernel unavailable",
            Self::Encode => "could not encode input",
        })
    }
}
impl Error for ClientError {}

/// Same movement bits as the existing wire protocol; optional analog steering.
#[derive(Clone, Copy, Debug, Default)]
pub struct ClientInput {
    pub keys: u32,
    pub steer: Option<f64>,
}
impl ClientInput {
    fn valid(self) -> bool {
        self.keys & !31 == 0 && self.steer.is_none_or(|s| s.is_finite() && s.abs() <= 1.0)
    }
}
#[derive(Clone, Copy, Debug)]
pub enum ClientAction {
    Fire,
    CycleWeapon,
    Boost,
    Chaff,
    Somersault,
    Special,
}

/// A borrowed presentation view. Consumers cannot mutate simulation authority.
pub struct ClientView<'a> {
    pub you: usize,
    pub arena: usize,
    pub phase: &'a str,
    pub elapsed: f64,
    pub countdown: f64,
    pub duration: f64,
    pub finish_countdown: Option<f64>,
    pub winner: Option<usize>,
    pub effects: &'a [Effect],
    pub player: &'a Actor,
    pub actors: &'a [Actor],
    pub projectiles: &'a [Shot],
    pub supplies: &'a [Supply],
    pub bombs: &'a [Bomb],
    pub chaff_clouds: &'a [Chaff],
    pub stink_clouds: &'a [Stink],
    pub drift_particles: &'a [Particle],
    pub locusts: &'a [Locust],
    pub skids: &'a [Skid],
    pub time_stop: f64,
    pub time_owner: Option<usize>,
    pub special_abilities: bool,
    pub blocks: &'static [[f64; 4]],
    pub movement_ack: i64,
    pub action_ack: i64,
}
pub struct NativeClient {
    inner: Client,
    input: ClientInput,
}
impl NativeClient {
    /// Navigation for developer-controlled native sparring; no authority changes.
    pub fn route_to(&self, target: usize) -> Vec<[f64; 2]> {
        let game = &self.inner.display;
        let Some(other) = game.actors.get(target) else {
            return Vec::new();
        };
        let own = &game.actors[self.inner.viewer];
        if super::super::clear(game.global.arena, own.wx, own.wz, other.wx, other.wz) {
            return vec![[other.wx, other.wz]];
        }
        super::super::movement::navigate(game.global.arena, own, other)
            .into_iter()
            .map(|p| [p.wx, p.wz])
            .collect()
    }
    pub fn from_packet(packet: &[u8], now: f64) -> Result<Self, ClientError> {
        if !now.is_finite() {
            return Err(ClientError::InvalidInput);
        }
        let _guard = super::super::native::KERNEL
            .lock()
            .map_err(|_| ClientError::KernelUnavailable)?;
        let (game, viewer) =
            super::super::packet::decode_packet(packet).map_err(|_| ClientError::InvalidPacket)?;
        Ok(Self {
            inner: Client::new(game, viewer, now),
            input: ClientInput::default(),
        })
    }
    pub fn accept(&mut self, packet: &[u8], now: f64) -> Result<(), ClientError> {
        if !now.is_finite() {
            return Err(ClientError::InvalidInput);
        }
        let _guard = super::super::native::KERNEL
            .lock()
            .map_err(|_| ClientError::KernelUnavailable)?;
        let (game, viewer) =
            super::super::packet::decode_packet(packet).map_err(|_| ClientError::InvalidPacket)?;
        self.inner.accept(game, viewer, now);
        Ok(())
    }
    pub fn advance(&mut self, dt: f64, input: ClientInput, now: f64) -> Result<(), ClientError> {
        if !dt.is_finite() || !(0.0..=0.05).contains(&dt) || !now.is_finite() || !input.valid() {
            return Err(ClientError::InvalidInput);
        }
        let _guard = super::super::native::KERNEL
            .lock()
            .map_err(|_| ClientError::KernelUnavailable)?;
        self.inner.frame(dt, input.keys, input.steer, now);
        self.input = input;
        Ok(())
    }
    pub fn action(&mut self, action: ClientAction, now: f64) -> Result<bool, ClientError> {
        if !now.is_finite() {
            return Err(ClientError::InvalidInput);
        }
        let _guard = super::super::native::KERNEL
            .lock()
            .map_err(|_| ClientError::KernelUnavailable)?;
        let kind = match action {
            ClientAction::Fire => "fire",
            ClientAction::CycleWeapon => "cycle",
            ClientAction::Boost => "turbo",
            ClientAction::Chaff => "chaff",
            ClientAction::Somersault => "somersault",
            ClientAction::Special => "special",
        };
        let accepted = self.inner.do_action(
            Action {
                kind: kind.into(),
                ..Action::default()
            },
            now,
        );
        if accepted {
            self.inner
                .frame(0.0, self.input.keys, self.input.steer, now);
        }
        Ok(accepted)
    }
    pub fn last_sent_movement(&self) -> i64 {
        self.inner.last_sent
    }
    /// Call only after reserving transport capacity: this advances send cursors.
    pub fn outbound(&mut self, input: ClientInput) -> Result<Vec<u8>, ClientError> {
        if !input.valid() {
            return Err(ClientError::InvalidInput);
        }
        serde_json::to_vec(&self.inner.outbound(input.keys)).map_err(|_| ClientError::Encode)
    }
    pub fn view(&self) -> ClientView<'_> {
        let game = &self.inner.display;
        let g = &game.global;
        let you = self.inner.viewer;
        ClientView {
            you,
            arena: g.arena,
            phase: &g.phase,
            elapsed: g.elapsed,
            countdown: g.countdown,
            duration: g.duration,
            finish_countdown: g.finish_countdown,
            winner: match &g.winner {
                serde_json::Value::String(s) if s == "player" => Some(0),
                serde_json::Value::Number(n) => n.as_u64().map(|id| id as usize + 1),
                _ => None,
            },
            effects: &g.effects,
            player: &game.actors[you],
            actors: &game.actors,
            projectiles: &g.projectiles,
            supplies: &g.supplies,
            bombs: &g.bombs,
            chaff_clouds: &g.chaff_clouds,
            stink_clouds: &g.stink_clouds,
            drift_particles: &g.drift_particles,
            locusts: &g.locusts,
            skids: &g.skids,
            time_stop: g.time_stop,
            time_owner: g.time_owner,
            special_abilities: g.special_abilities,
            blocks: super::super::blocks(g.arena),
            movement_ack: game.movement_ack[you],
            action_ack: game.action_ack[you],
        }
    }
    /// Prediction-aware sound cues are consumed exactly once, without JSON frame copies.
    pub fn drain_audio(&mut self) -> Vec<String> {
        let events = std::mem::take(&mut self.inner.audio)
            .into_iter()
            .filter_map(|v| v.as_str().map(str::to_owned))
            .collect();
        self.inner.voice_output.clear();
        self.inner.display.global.events.clear();
        self.inner.display.global.voices.clear();
        events
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::NativeArena;
    use serde_json::Value;
    #[test]
    fn two_clients_predict_independently_and_reconcile_with_the_dedicated_arena() {
        let mut server=NativeArena::new(json!({"maxPlayers":8,"code":"00","arena":0,"bots":0,"dedicated":true,"host":null,"epoch":1,"seed":1,"players":[{"id":0,"name":"Native","driver":0,"role":"driver"},{"id":1,"name":"Peer","driver":1,"role":"driver"}]})).unwrap();
        server.start();
        for _ in 0..241 {
            server
                .step(Frame {
                    dt: 1.0 / 60.0,
                    inputs: vec![],
                })
                .unwrap();
        }
        let mut native = NativeClient::from_packet(&server.packet(0), 0.0).unwrap();
        let peer = NativeClient::from_packet(&server.packet(1), 0.0).unwrap();
        assert_eq!(native.view().you, 0);
        assert_eq!(peer.view().you, 1);
        let old = (native.view().player.wx, native.view().player.wz);
        for i in 1..=20 {
            native
                .advance(
                    1.0 / 60.0,
                    ClientInput {
                        keys: 1,
                        steer: None,
                    },
                    i as f64 / 60.0,
                )
                .unwrap();
        }
        assert!(
            distance(
                old.0,
                old.1,
                native.view().player.wx,
                native.view().player.wz
            ) > 0.1
        );
        assert_eq!(peer.view().movement_ack, -1);
        assert!(native.action(ClientAction::Fire, 0.34).unwrap());
        assert_eq!(
            native.view().projectiles.len(),
            1,
            "A local shot must be visible immediately, before another frame or server response"
        );
        let outbound: Value = serde_json::from_slice(
            &native
                .outbound(ClientInput {
                    keys: 1,
                    steer: None,
                })
                .unwrap(),
        )
        .unwrap();
        assert_eq!(outbound["type"], "input");
        assert_eq!(outbound["actions"][0]["type"], "fire");
        assert_eq!(
            native
                .drain_audio()
                .iter()
                .filter(|s| s.as_str() == "fire")
                .count(),
            1
        );
        assert!(native.drain_audio().is_empty());
        native.accept(&server.packet(0), 0.35).unwrap();
        assert_eq!(peer.view().you, 1);
    }
    #[test]
    fn invalid_packets_and_non_finite_clocks_are_errors() {
        assert!(matches!(
            NativeClient::from_packet(&[], 0.0),
            Err(ClientError::InvalidPacket)
        ));
        assert!(matches!(
            NativeClient::from_packet(&[], f64::NAN),
            Err(ClientError::InvalidInput)
        ));
    }
}
