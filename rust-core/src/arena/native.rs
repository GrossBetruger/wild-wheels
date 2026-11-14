//! Owned native entry point. The movement kernel's scratch memory is serialized
//! across worlds; no global C ABI world or JSON frame bridge is used here.
use super::*;
use serde_json::Value;
use std::sync::Mutex;
pub(super) static KERNEL: Mutex<()> = Mutex::new(());
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
    pub fn player_color(&self, id: usize) -> Option<&str> {
        self.game.actors.get(id).map(|actor| actor.color.as_str())
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

#[cfg(test)]
mod player_color_tests {
    use super::*;
    fn config() -> Value {
        json!({"code":"00","host":null,"dedicated":true,"maxPlayers":8,"arena":0,"bots":7,"epoch":1,
            "players":[{"id":0,"name":"Player","driver":6,"role":"driver"}]})
    }
    fn assert_colors(arena: &NativeArena) {
        let colors = (0..8).map(|id| arena.player_color(id).unwrap()).collect::<std::collections::HashSet<_>>();
        assert_eq!(colors.len(), 8);
        for color in colors { assert!(crate::PLAYER_COLORS.contains(&color)); }
    }
    #[test]
    fn automatic_colors_and_bot_reassignment_use_the_shared_palette() {
        let mut config = config();
        let mut arena = NativeArena::new(config.clone()).unwrap();
        assert_colors(&arena);
        let taken = arena.player_color(1).unwrap().to_owned();
        config["players"][0]["color"] = json!(taken);
        arena.configure(config.clone()).unwrap();
        assert_eq!(arena.player_color(0).unwrap(), taken); assert_colors(&arena);
        let before = (0..8).map(|id| arena.player_color(id).unwrap().to_owned()).collect::<Vec<_>>();
        arena.configure(config).unwrap();
        assert_eq!((0..8).map(|id| arena.player_color(id).unwrap().to_owned()).collect::<Vec<_>>(), before);
    }
    #[test]
    fn duplicate_or_malformed_explicit_colors_are_rejected() {
        let mut config = config();config["bots"] = json!(6);
        config["players"][0]["color"] = json!("#a4198b");
        config["players"].as_array_mut().unwrap().push(json!({"id":1,"name":"Other","driver":6,"role":"driver","color":"#A4198B"}));
        assert!(NativeArena::new(config.clone()).is_err());
        config["players"][1]["color"] = json!("url(https://attacker.invalid)");
        assert!(NativeArena::new(config).is_err());
    }
}
