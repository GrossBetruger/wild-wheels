use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::VecDeque,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::Notify;
use wild_wheels_core::{Action, Frame, Input, Move, NativeArena};
pub const CAPACITY: usize = 8;
pub type Result<T> = std::result::Result<T, (u16, &'static str)>;
fn bad<T>(message: &'static str) -> Result<T> {
    Err((400, message))
}
pub fn token() -> String {
    let mut bytes = [0; 32];
    getrandom::fill(&mut bytes).expect("OS random source unavailable");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
fn name(value: &Value) -> Result<String> {
    let Some(s) = value.as_str() else {
        return bad("Enter a name (1–24 characters).");
    };
    if s.trim().is_empty() || s.encode_utf16().count() > 24 {
        return bad("Enter a name (1–24 characters).");
    }
    Ok(s.trim().into())
}
fn driver(value: &Value) -> Result<usize> {
    value
        .as_u64()
        .filter(|&v| v < 15)
        .map(|v| v as usize)
        .ok_or((400, "Choose a character."))
}
fn keys(values: &[String], movement: bool) -> Result<u32> {
    if values.len() > 10 {
        return bad("Invalid controls.");
    }
    let mut bits = 0;
    for key in values {
        bits |= match key.as_str() {
            "arrowup" | "w" => 1,
            "arrowdown" | "s" => 2,
            "arrowright" | "d" => 4,
            "arrowleft" | "a" => 8,
            "shift" => 16,
            " " if !movement => 32,
            _ => return bad("Invalid controls."),
        };
    }
    Ok(bits)
}
pub struct Member {
    pub token: String,
    pub name: String,
    pub driver: usize,
    pub role: String,
    pub afk: bool,
    pub ready: bool,
    pub refused: bool,
    pub seen: Instant,
    pub generation: u64,
    pub notify: Arc<Notify>,
    pub connected: bool,
    sequence: i64,
    accepted_move: i64,
    accepted_action: i64,
    keys: u32,
    input_at: Instant,
    moves: VecDeque<Move>,
    actions: Vec<Action>,
    credit: f64,
    command_mode: bool,
    action_clock: bool,
    events: Vec<Value>,
    voices: Vec<Value>,
    cue_epoch: u64,
}
impl Member {
    fn clear(&mut self, movement: i64, action: i64) {
        self.sequence = -1;
        self.accepted_move = movement;
        self.accepted_action = action;
        self.keys = 0;
        self.moves.clear();
        self.actions.clear();
        self.credit = 0.0;
        self.command_mode = false;
        self.action_clock = false;
        self.events.clear();
        self.voices.clear();
    }
}
pub struct Room {
    pub core: NativeArena,
    pub members: [Option<Member>; CAPACITY],
    pub host: usize,
    pub bots: usize,
    pub arena: usize,
    pub abilities: bool,
    request: Option<(u32, Instant)>,
    request_id: u32,
    epoch: u32,
    seed: u32,
    pub ticks: u64,
    pub overruns: u64,
    pub tick_us: Vec<u64>,
}
impl Room {
    pub fn new(arena: usize, bots: usize) -> Self {
        let epoch = 1;
        let seed = 1;
        let config = json!({"maxPlayers":8,"code":"00","arena":arena,"bots":bots,"host":0,"epoch":epoch,"seed":seed,"players":[]});
        Self {
            core: NativeArena::new(config).unwrap(),
            members: std::array::from_fn(|_| None),
            host: 0,
            bots,
            arena,
            abilities: true,
            request: None,
            request_id: 0,
            epoch,
            seed,
            ticks: 0,
            overruns: 0,
            tick_us: Vec::new(),
        }
    }
    pub fn count(&self) -> usize {
        self.members.iter().flatten().count()
    }
    pub fn config(&self) -> Value {
        json!({"maxPlayers":8,"code":"00","arena":self.arena,"bots":self.bots,"host":self.host,"epoch":self.epoch,"seed":self.seed,"specialAbilities":self.abilities,"players":self.members.iter().enumerate().filter_map(|(id,p)|p.as_ref().map(|p|json!({"id":id,"name":p.name,"driver":p.driver,"role":p.role,"afk":p.afk,"wantsToPlay":p.ready,"playRequestRefused":p.refused}))).collect::<Vec<_>>(),"startRequest":self.request.map(|(id,deadline)|json!({"id":id,"remainingMs":deadline.saturating_duration_since(Instant::now()).as_secs_f64()*1000.0}))})
    }
    pub fn sync(&mut self) {
        self.bots = self.bots.min(CAPACITY - self.count());
        self.core
            .configure(self.config())
            .expect("validated room configuration");
    }
    fn waiting(&self) -> bool {
        self.members
            .iter()
            .enumerate()
            .any(|(id, m)| id != self.host && m.as_ref().is_some_and(|p| p.ready && !p.afk))
    }
    pub fn broadcast(&mut self) {
        self.sync();
        for id in 0..CAPACITY {
            let Some(p) = &mut self.members[id] else {
                continue;
            };
            if !p.connected {
                continue;
            }
            let (events, voices) = self.core.cues(id);
            if p.cue_epoch != self.core.epoch() {
                p.events.clear();
                p.voices.clear();
                p.cue_epoch = self.core.epoch();
            }
            p.events.extend(events);
            p.voices.extend(voices);
            if p.events.len() > 64 {
                p.events.drain(..p.events.len() - 64);
            }
            if p.voices.len() > 16 {
                p.voices.drain(..p.voices.len() - 16);
            }
            p.notify.notify_one();
        }
        self.core.drain();
    }
    pub fn packet(&mut self, id: usize, generation: u64) -> Option<Vec<u8>> {
        let p = self.members[id].as_mut()?;
        if p.generation != generation || !p.connected {
            return None;
        }
        Some(self.core.packet_with_cues(
            id,
            std::mem::take(&mut p.events),
            std::mem::take(&mut p.voices),
        ))
    }
    pub fn find(&self, token: &str) -> Option<usize> {
        if token.len() != 64 || !token.bytes().all(|b| b.is_ascii_hexdigit()) {
            return None;
        }
        self.members
            .iter()
            .position(|p| p.as_ref().is_some_and(|p| p.token == token))
    }
    pub fn join(&mut self, body: &Value) -> Result<Value> {
        let name = name(&body["name"])?;
        let role = body["role"].as_str().unwrap_or("driver");
        if !matches!(role, "driver" | "bomber") {
            return bad("Choose a driver or bomber role.");
        }
        let chosen = match body.get("driver") {
            Some(Value::Null) | None => None,
            Some(v) => Some(driver(v)?),
        };
        let Some(id) = self.members.iter().position(Option::is_none) else {
            return Err((409, "This server is full (8 players)."));
        };
        let chosen = chosen.unwrap_or_else(|| {
            (0..15)
                .find(|&d| !self.members.iter().flatten().any(|p| p.driver == d))
                .unwrap_or(id)
        });
        let now = Instant::now();
        let mut p = Member {
            token: token(),
            name,
            driver: chosen,
            role: role.into(),
            afk: false,
            ready: false,
            refused: false,
            seen: now,
            generation: 0,
            notify: Arc::new(Notify::new()),
            connected: false,
            sequence: -1,
            accepted_move: -1,
            accepted_action: -1,
            keys: 0,
            input_at: now,
            moves: VecDeque::new(),
            actions: Vec::new(),
            credit: 0.0,
            command_mode: false,
            action_clock: false,
            events: Vec::new(),
            voices: Vec::new(),
            cue_epoch: self.core.epoch(),
        };
        p.clear(-1, -1);
        if self.count() == 0 {
            self.host = id;
        }
        self.members[id] = Some(p);
        self.sync();
        let (m, a) = self.core.resume(id);
        self.members[id].as_mut().unwrap().clear(m, a);
        self.broadcast();
        Ok(self.reply(id))
    }
    pub fn reply(&self, id: usize) -> Value {
        let mut reply = self.core.snapshot(id);
        reply["token"] = json!(self.members[id].as_ref().unwrap().token);
        reply
    }
    pub fn resume(&mut self, id: usize, afk: bool) -> Value {
        let (m, a) = self.core.resume(id);
        let p = self.members[id].as_mut().unwrap();
        p.token = token();
        p.generation += 1;
        p.connected = false;
        p.notify.notify_one();
        p.clear(m, a);
        p.seen = Instant::now();
        p.afk = afk;
        p.ready = false;
        self.reassign_host();
        self.broadcast();
        self.reply(id)
    }
    fn reassign_host(&mut self) {
        if self.members[self.host].as_ref().is_some_and(|p| !p.afk) {
            return;
        }
        if let Some(id) = self
            .members
            .iter()
            .position(|p| p.as_ref().is_some_and(|p| !p.afk))
        {
            self.host = id;
        }
        if !self.waiting() {
            self.request = None;
        }
    }
    pub fn disconnect(&mut self, id: usize, generation: u64) {
        let Some(p) = &mut self.members[id] else {
            return;
        };
        if p.generation != generation {
            return;
        }
        p.connected = false;
        p.afk = true;
        p.keys = 0;
        p.actions.clear();
        p.ready = false;
        self.reassign_host();
        self.broadcast();
    }
    fn reset(&mut self) {
        self.request = None;
        self.epoch = self.epoch.checked_add(1).expect("epoch exhausted");
        let mut bytes = [0; 4];
        getrandom::fill(&mut bytes).unwrap();
        self.seed = u32::from_le_bytes(bytes);
        for p in self.members.iter_mut().flatten() {
            p.ready = false;
            p.refused = false;
            p.clear(-1, -1);
        }
        self.core = NativeArena::new(self.config()).unwrap();
    }
    pub fn control(&mut self, id: usize, path: &str, b: &Value) -> Result<Value> {
        self.members[id].as_mut().unwrap().seen = Instant::now();
        match path {
            "/api/session" => return Ok(self.resume(id, false)),
            "/api/afk" => {
                let afk = b["afk"]
                    .as_bool()
                    .ok_or((400, "Choose AFK or back in the arena."))?;
                return Ok(self.resume(id, afk));
            }
            "/api/name" => {
                self.members[id].as_mut().unwrap().name = name(&b["name"])?;
                self.broadcast();
                return Ok(json!({"ok":true,"name":self.members[id].as_ref().unwrap().name}));
            }
            "/api/driver" => {
                if !matches!(self.core.phase(), "ready" | "finished") {
                    return Err((409, "Choose a character before the next match."));
                }
                self.members[id].as_mut().unwrap().driver = driver(&b["driver"])?;
            }
            "/api/ready" => {
                if self.host == id {
                    return Err((403, "The host can start the match directly."));
                }
                if !matches!(self.core.phase(), "ready" | "finished")
                    || self.members[id].as_ref().unwrap().afk
                {
                    return Err((409, "Match already running or player AFK."));
                }
                let ready = b["ready"]
                    .as_bool()
                    .ok_or((400, "Choose ready or not ready."))?;
                let p = self.members[id].as_mut().unwrap();
                p.ready = ready;
                p.refused = false;
                if ready && self.request.is_none() {
                    self.request_id += 1;
                    self.request = Some((self.request_id, Instant::now() + Duration::from_secs(3)));
                }
                if !self.waiting() {
                    self.request = None;
                }
            }
            "/api/leave" => {
                let generation = self.members[id].as_ref().unwrap().generation;
                self.disconnect(id, generation);
            }
            "/api/input" => {
                self.controls(id, b.clone())?;
                return Ok(json!({"ok":true}));
            }
            "/api/control" => {
                if id != self.host {
                    return Err((403, "Only the room host can start or change the match."));
                }
                match b["action"].as_str().unwrap_or("") {
                    "special-abilities" => {
                        self.abilities = b["enabled"]
                            .as_bool()
                            .ok_or((400, "Choose abilities on or off."))?
                    }
                    "start" => {
                        if !matches!(self.core.phase(), "ready" | "finished") {
                            return Err((409, "Match already running."));
                        }
                        self.reset();
                        self.core.start();
                    }
                    "reset" => self.reset(),
                    "arena" => {
                        self.arena = b["arena"]
                            .as_u64()
                            .filter(|&a| a < 2)
                            .ok_or((400, "Choose an arena."))?
                            as usize;
                        self.reset();
                    }
                    "bots" => {
                        if !matches!(self.core.phase(), "ready" | "finished") {
                            return Err((409, "Change bots before the next match."));
                        }
                        self.bots = b["bots"]
                            .as_u64()
                            .filter(|&n| n as usize <= CAPACITY - self.count())
                            .ok_or((400, "Too many bots for this room."))?
                            as usize;
                        self.reset();
                    }
                    "refuse-start" => {
                        if self.request.map(|r| r.0 as u64) != b["requestId"].as_u64()
                            || self.request.is_none()
                        {
                            return Err((409, "This play request is no longer pending."));
                        }
                        self.request = None;
                        for p in self.members.iter_mut().flatten() {
                            p.refused = p.ready;
                            p.ready = false;
                        }
                    }
                    _ => return bad("Unknown match control."),
                }
            }
            _ => return Err((404, "Not found.")),
        }
        self.broadcast();
        Ok(json!({"ok":true}))
    }
    pub fn controls(&mut self, id: usize, value: Value) -> Result<()> {
        #[derive(Deserialize)]
        struct Movement {
            sequence: i64,
            keys: Vec<String>,
            steer: Option<f64>,
        }
        #[derive(Deserialize)]
        struct Controls {
            sequence: i64,
            keys: Vec<String>,
            actions: Vec<Action>,
            epoch: Option<u64>,
            moves: Option<Vec<Movement>>,
        }
        let c: Controls = serde_json::from_value(value).map_err(|_| (400, "Invalid controls."))?;
        if c.sequence < 0 || c.sequence > 9_007_199_254_740_991 || c.actions.len() > 8 {
            return bad("Invalid controls.");
        }
        let mask = keys(&c.keys, false)?;
        let p = self.members[id].as_mut().unwrap();
        if p.afk {
            return Ok(());
        }
        if c.epoch.is_some_and(|e| e != self.core.epoch()) {
            return Ok(());
        }
        let mut accepted = p.accepted_move;
        let mut moves = Vec::new();
        if let Some(incoming) = c.moves {
            if c.epoch.is_none() || incoming.len() > 8 {
                return bad("Invalid movement.");
            }
            for m in incoming {
                let mask = keys(&m.keys, true)?;
                if m.sequence < 0
                    || m.sequence > 9_007_199_254_740_991
                    || m.steer.is_some_and(|v| !v.is_finite() || v.abs() > 1.0)
                {
                    return bad("Invalid movement.");
                }
                if m.sequence <= accepted {
                    continue;
                }
                if m.sequence != accepted + 1 || p.moves.len() + moves.len() >= 120 {
                    return bad("Movement out of sequence.");
                }
                accepted = m.sequence;
                moves.push(Move {
                    sequence: m.sequence,
                    keys: mask,
                    steer: m.steer,
                });
            }
            p.command_mode = true;
        }
        // Validate before accepting commands; future actions must refer to received movement.
        let frame = Frame {
            dt: 0.0,
            inputs: vec![Input {
                actor: id,
                keys: mask,
                moves: None,
                actions: c.actions.clone(),
                ..Input::default()
            }],
        };
        for a in &frame.inputs[0].actions {
            if !matches!(
                a.kind.as_str(),
                "fire" | "turbo" | "chaff" | "special" | "somersault" | "cycle" | "select" | "bomb"
            ) || a.after_move < -1
                || a.after_move > accepted
                || !a.wx.is_finite()
                || !a.wz.is_finite()
            {
                return bad("Invalid action.");
            }
            if a.kind == "select" && !matches!(a.item.as_str(), "hedgehog" | "missile") {
                return bad("Invalid weapon.");
            }
            if a.kind == "bomb"
                && (a.wx.abs() > 96.0
                    || a.wz.abs() > 96.0
                    || a.bomb_kind
                        .as_ref()
                        .is_some_and(|s| !matches!(s.as_str(), "stink" | "abomb")))
            {
                return bad("Invalid bomb.");
            }
        }
        p.accepted_move = accepted;
        p.moves.extend(moves);
        if c.sequence > p.sequence {
            if p.actions.len() + c.actions.len() > 64 {
                return Err((429, "Too many pending actions."));
            }
            p.sequence = c.sequence;
            p.keys = mask;
            p.input_at = Instant::now();
            for a in c.actions {
                if let Some(action) = a.id {
                    if action as i64 <= p.accepted_action {
                        continue;
                    }
                    p.accepted_action = action as i64;
                    p.action_clock = true;
                }
                p.actions.push(a);
            }
        }
        Ok(())
    }
    pub fn tick(&mut self) {
        let start = Instant::now();
        let mut changed = false;
        for p in &mut self.members {
            if p.as_ref()
                .is_some_and(|p| !p.connected && p.seen.elapsed() > Duration::from_secs(900))
            {
                *p = None;
                changed = true;
                continue;
            }
            if let Some(p) = p {
                if !p.afk && p.seen.elapsed() > Duration::from_secs(15) {
                    p.afk = true;
                    p.keys = 0;
                    p.ready = false;
                    changed = true;
                }
            }
        }
        if changed {
            self.reassign_host();
            self.sync();
        }
        if self.request.is_some_and(|(_, deadline)| start >= deadline) {
            self.reset();
            self.core.start();
        }
        let mut inputs = Vec::new();
        for (id, p) in self.members.iter_mut().enumerate() {
            let Some(p) = p else {
                continue;
            };
            if p.afk {
                continue;
            }
            p.credit = (p.credit + 1.0).min(12.0);
            let moves = match p.command_mode {
                true => {
                    let n = p.moves.len().min(8).min((p.credit + 1e-8).floor() as usize);
                    p.credit -= n as f64;
                    Some(p.moves.drain(..n).collect())
                }
                false => None,
            };
            let n = p.actions.len().min(8);
            inputs.push(Input {
                actor: id,
                keys: match p.input_at.elapsed() < Duration::from_millis(600) {
                    true => p.keys,
                    false => 0,
                },
                moves,
                actions: p.actions.drain(..n).collect(),
                action_clock: p.action_clock,
                sequence: Some(p.sequence),
                steer: None,
            });
        }
        self.core
            .step(Frame {
                dt: 1.0 / 60.0,
                inputs,
            })
            .expect("validated frame");
        self.ticks += 1;
        if self.ticks % 2 == 0 {
            self.broadcast();
        }
        let us = start.elapsed().as_micros() as u64;
        if self.tick_us.len() == 3600 {
            self.tick_us.drain(..1800);
        }
        self.tick_us.push(us);
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn eight_people_can_join_and_the_ninth_is_rejected() {
        let mut room = Room::new(0, 1);
        for id in 0..8 {
            let reply = room
                .join(&json!({"name":format!("Player {id}"),"driver":null}))
                .unwrap();
            assert_eq!(reply["you"], id);
            assert_eq!(reply["maxPlayers"], 8);
            assert_eq!(reply["world"]["driver"], id);
        }
        assert_eq!(
            room.join(&json!({"name":"Ninth","driver":null}))
                .unwrap_err()
                .0,
            409
        );
        assert_eq!(room.reply(7)["world"]["bots"].as_array().unwrap().len(), 7);
    }
    #[test]
    fn refresh_keeps_identity_character_and_acknowledged_movement() {
        let mut room = Room::new(0, 0);
        let original = room.join(&json!({"name":"Houston","driver":7})).unwrap();
        room.control(0, "/api/control", &json!({"action":"start"}))
            .unwrap();
        room.controls(0,json!({"sequence":0,"epoch":2,"keys":["w"],"moves":[{"sequence":0,"keys":["w"]}],"actions":[]})).unwrap();
        room.tick();
        let refreshed = room.resume(0, false);
        assert_eq!(refreshed["you"], 0);
        assert_eq!(refreshed["world"]["name"], "Houston");
        assert_eq!(refreshed["world"]["driver"], 7);
        assert_eq!(refreshed["movementSequence"], 0);
        assert_ne!(original["token"], refreshed["token"]);
        assert!(room.find(original["token"].as_str().unwrap()).is_none());
    }
    #[test]
    fn captain_disconnect_preserves_match_and_transfers_controls() {
        let mut room = Room::new(0, 0);
        room.join(&json!({"name":"Host","driver":0})).unwrap();
        room.join(&json!({"name":"Friend","driver":1})).unwrap();
        room.control(0, "/api/control", &json!({"action":"start"}))
            .unwrap();
        room.disconnect(0, 0);
        for _ in 0..181 {
            room.tick();
        }
        assert_eq!(room.reply(1)["host"], 1);
        assert_eq!(room.reply(1)["world"]["phase"], "racing");
        assert_eq!(room.reply(0)["players"][0]["afk"], true);
        assert_eq!(
            room.control(0, "/api/control", &json!({"action":"reset"}))
                .unwrap_err()
                .0,
            403
        );
    }
    #[test]
    fn guest_request_starts_after_deadline_and_captain_can_refuse() {
        let mut room = Room::new(0, 0);
        room.join(&json!({"name":"Host","driver":0})).unwrap();
        room.join(&json!({"name":"Friend","driver":1})).unwrap();
        room.control(1, "/api/ready", &json!({"ready":true}))
            .unwrap();
        assert_eq!(room.reply(0)["startRequest"]["id"], 1);
        room.control(
            0,
            "/api/control",
            &json!({"action":"refuse-start","requestId":1}),
        )
        .unwrap();
        assert!(room.reply(1)["startRequest"].is_null());
        assert_eq!(room.reply(1)["players"][1]["playRequestRefused"], true);
        room.control(1, "/api/ready", &json!({"ready":true}))
            .unwrap();
        room.request = Some((2, Instant::now()));
        room.tick();
        assert_eq!(room.core.phase(), "countdown");
    }
    #[test]
    fn movement_gaps_and_actions_beyond_received_movement_are_rejected() {
        let mut room = Room::new(0, 0);
        room.join(&json!({"name":"Player","driver":0})).unwrap();
        assert!(room.controls(0,json!({"sequence":0,"epoch":1,"keys":[],"moves":[{"sequence":1,"keys":["w"]}],"actions":[]})).is_err());
        assert!(room.controls(0,json!({"sequence":0,"epoch":1,"keys":[],"moves":[],"actions":[{"type":"fire","id":0,"afterMove":128}]})).is_err());
        room.controls(0,json!({"sequence":0,"epoch":1,"keys":[],"moves":[{"sequence":0,"keys":["w"]}],"actions":[]})).unwrap();
        room.tick();
        assert_eq!(room.reply(0)["movementSequence"], 0);
    }
}
