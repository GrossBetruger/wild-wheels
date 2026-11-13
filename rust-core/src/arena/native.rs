//! Owned native entry point. The movement kernel's scratch memory is serialized
//! across worlds; no global C ABI world or JSON frame bridge is used here.
use super::*;
use serde_json::Value;
use std::sync::Mutex;
static KERNEL: Mutex<()> = Mutex::new(());
pub struct NativeArena {
    game: Game,
}
impl NativeArena {
    pub fn new(config: Value) -> Result<Self, &'static str> {
        let room: control::Room = serde_json::from_value(config).map_err(|_| "Invalid room")?;
        if !room.valid() {
            return Err("Invalid room");
        }
        let _guard = KERNEL.lock().unwrap();
        Ok(Self {
            game: Game::create_room(&room).map_err(|_| "Invalid arena")?,
        })
    }
    pub fn configure(&mut self, config: Value) -> Result<(), &'static str> {
        let room: control::Room =
            serde_json::from_value(config.clone()).map_err(|_| "Invalid room")?;
        if !room.valid()
            || config["maxPlayers"].as_u64().unwrap_or(6) as usize != self.game.actors.len()
            || config["arena"] != self.game.global.arena
            || config["epoch"] != self.game.global.sound_epoch
        {
            return Err("Invalid room");
        }
        self.game.configure_room(&room);
        Ok(())
    }
    pub fn step(&mut self, frame: Frame) -> Result<(), &'static str> {
        if !self.game.validate(&frame) {
            return Err("Invalid frame");
        }
        let _guard = KERNEL.lock().unwrap();
        self.game.tick(frame);
        Ok(())
    }
    pub fn phase(&self) -> &str {
        &self.game.global.phase
    }
    pub fn elapsed(&self)->f64{self.game.global.elapsed}
    pub fn epoch(&self) -> u64 {
        self.game.global.sound_epoch
    }
    pub fn start(&mut self) {
        if self.game.global.phase == "ready" {
            self.game.global.phase = "countdown".into();
        }
    }
    pub fn resume(&mut self, id: usize) -> (i64, i64) {
        self.game.pending[id].clear();
        self.game.accepted_action[id] = self.game.action_ack[id];
        (self.game.movement_ack[id], self.game.action_ack[id])
    }
    pub fn packet(&self, id: usize) -> Vec<u8> {
        let mut out = Vec::new();
        self.game
            .encode_packet(id, &mut out)
            .expect("valid bounded arena packet");
        out
    }
    pub fn cues(&self, id: usize) -> (Vec<Value>, Vec<Value>) {
        (self.game.viewer_events(id), self.game.global.voices.clone())
    }
    pub fn packet_with_cues(
        &mut self,
        id: usize,
        events: Vec<Value>,
        voices: Vec<Value>,
    ) -> Vec<u8> {
        let old_events = std::mem::replace(&mut self.game.global.events, events);
        let old_voices = std::mem::replace(&mut self.game.global.voices, voices);
        let out = self.packet(id);
        self.game.global.events = old_events;
        self.game.global.voices = old_voices;
        out
    }
    pub fn snapshot(&self, id: usize) -> Value {
        let packet = self.packet(id);
        let size = u32::from_le_bytes(packet[4..8].try_into().unwrap()) as usize;
        // The JSON bootstrap has empty packed trails/skids. They arrive in the
        // first binary update; avoiding a second snapshot serializer keeps parity.
        serde_json::from_slice::<Value>(&packet[16..16 + size]).unwrap()["state"].take()
    }
    pub fn drain(&mut self) {
        self.game.global.events.clear();
        self.game.global.voices.clear();
    }
}
