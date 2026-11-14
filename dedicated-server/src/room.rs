use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::VecDeque,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::Notify;
use wild_wheels_core::{Action, Frame, Input, Move, NativeArena, PLAYER_COLORS};
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
pub(crate) fn color_preference(body: &Value) -> Result<Option<String>> {
    match body.get("color") {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(color)) if PLAYER_COLORS.contains(&color.as_str()) => Ok(Some(color.clone())),
        _ => Err((400, "Choose a color from the palette.")),
    }
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
    pub identity: String,
    pub name: String,
    pub driver: usize,
    pub color: String,
    pub chat_color: String,
    pub preferred_color: Option<String>,
    pub role: String,
    pub afk: bool,
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
    pub(crate) chat: crate::chat::Chat,
    pub core: NativeArena,
    pub members: [Option<Member>; CAPACITY],
    pub bots: usize,
    pub arena: usize,
    pub abilities: bool,
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
        let config = json!({"maxPlayers":8,"code":"00","arena":arena,"bots":bots,"host":null,"dedicated":true,"epoch":epoch,"seed":seed,"players":[]});
        Self {
            chat: crate::chat::Chat::default(),
            core: NativeArena::new(config).unwrap(),
            members: std::array::from_fn(|_| None),
            bots,
            arena,
            abilities: true,
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
        json!({"maxPlayers":8,"code":"00","arena":self.arena,"bots":self.bots,"host":null,"dedicated":true,"epoch":self.epoch,"seed":self.seed,"specialAbilities":self.abilities,"players":self.members.iter().enumerate().filter_map(|(id,p)|p.as_ref().map(|p|json!({"id":id,"name":p.name,"driver":p.driver,"color":p.color,"role":p.role,"afk":p.afk}))).collect::<Vec<_>>()})
    }
    pub fn sync(&mut self) {
        self.bots = self.bots.min(CAPACITY - self.count());
        self.core
            .configure(self.config())
            .expect("validated room configuration");
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
    fn available_chat_color(&self, preferred: &str, except: Option<usize>) -> Result<String> {
        let available = |color: &str| !self.members.iter().enumerate().any(|(id, member)| Some(id) != except && member.as_ref().is_some_and(|member| member.chat_color == color));
        if PLAYER_COLORS.contains(&preferred) && available(preferred) { return Ok(preferred.to_owned()); }
        PLAYER_COLORS.iter().find(|color| available(color)).map(|color| color.to_string())
            .ok_or((503, "No chat colors are available."))
    }
    pub fn join(&mut self, body: &Value) -> Result<Value> {
        let name = name(&body["name"])?;
        let preferred_color = color_preference(body)?;
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
        let available = |color: &str| !self.members.iter().flatten().any(|member| member.color == color);
        let color = preferred_color.as_deref().filter(|color| available(color)).map(str::to_owned)
            .or_else(|| PLAYER_COLORS.iter().find(|color| available(color)).map(|color| color.to_string()))
            .ok_or((503, "No player colors are available."))?;
        let preferred_color = Some(preferred_color.unwrap_or_else(|| color.clone()));
        let chat_color = self.available_chat_color(&color, None)?;
        let now = Instant::now();
        let mut p = Member {
            token: token(),
            identity: token(),
            name,
            driver: chosen,
            color,
            chat_color,
            preferred_color,
            role: role.into(),
            afk: false,
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
        self.members[id] = Some(p);
        self.sync();
        let (m, a) = self.core.resume(id);
        self.members[id].as_mut().unwrap().clear(m, a);
        self.broadcast();
        Ok(self.reply(id))
    }
    pub fn restore(&mut self, saved: &crate::sessions::Session) -> Result<usize> {
        if let Some(id) = self.members.iter().position(|p| p.as_ref().is_some_and(|p| p.identity == saved.identity)) {
            return Ok(id);
        }
        let reply = self.join(&json!({"name":saved.name,"driver":saved.driver,"role":saved.role,"color":saved.color}))?;
        let id = reply["you"].as_u64().unwrap() as usize;
        let preferred = saved.chat_color.as_deref().unwrap_or(&self.members[id].as_ref().unwrap().chat_color);
        let chat_color = self.available_chat_color(preferred, Some(id))?;
        self.members[id].as_mut().unwrap().chat_color = chat_color;
        self.members[id].as_mut().unwrap().identity = saved.identity.clone();
        Ok(id)
    }
    pub fn prefer_color(&mut self, id: usize, color: &str) -> Result<()> {
        if !PLAYER_COLORS.contains(&color) { return Err((400, "Choose a color from the palette.")); }
        // Reconnecting must preserve the color assigned to the current match.
        if !matches!(self.core.phase(), "ready" | "finished") { return Ok(()); }
        let available = !self.members.iter().enumerate().any(|(other, p)| other != id && p.as_ref().is_some_and(|p| p.color == color));
        let member = self.members[id].as_mut().unwrap();
        member.preferred_color = Some(color.to_owned());
        // Keep the current unique assignment if the preferred swatch is occupied.
        if available { member.color = color.to_owned(); }
        self.broadcast();
        Ok(())
    }
    pub fn reply(&self, id: usize) -> Value {
        let mut reply = self.core.snapshot(id);
        reply["token"] = json!(self.members[id].as_ref().unwrap().token);
        reply["preferredColor"] = json!(self.members[id].as_ref().unwrap().preferred_color);
        reply["chatColor"] = json!(self.members[id].as_ref().unwrap().chat_color);
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
        self.broadcast();
        self.reply(id)
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
        self.broadcast();
    }
    fn reset(&mut self) {
        self.epoch = self.epoch.checked_add(1).expect("epoch exhausted");
        let mut bytes = [0; 4];
        getrandom::fill(&mut bytes).unwrap();
        self.seed = u32::from_le_bytes(bytes);
        for p in self.members.iter_mut().flatten() {
            p.clear(-1, -1);
        }
        self.core = NativeArena::new(self.config()).unwrap();
    }
    pub fn control(&mut self, id: usize, path: &str, b: &Value) -> Result<Value> {
        self.members[id].as_mut().unwrap().seen = Instant::now();
        if path == "/api/chat" {
            let players = self.members.iter().enumerate().filter_map(|(id,p)|p.as_ref().map(|p|(id,p.identity.clone(),p.name.clone(),Some(p.chat_color.clone())))).collect::<Vec<_>>();
            return self.chat.exchange(id, &players, b);
        }
        match path {
            "/api/session" => {
                if let Some(color) = color_preference(b)? { self.prefer_color(id, &color)?; }
                return Ok(self.resume(id, false));
            }
            "/api/color" => {
                if !matches!(self.core.phase(), "ready" | "finished") {
                    return Err((409, "Choose your color between matches."));
                }
                let color = b["color"].as_str().filter(|color| PLAYER_COLORS.contains(color))
                    .ok_or((400, "Choose a color from the palette."))?;
                if self.members.iter().enumerate().any(|(other, p)| other != id && p.as_ref().is_some_and(|p| p.color == color)) {
                    return Err((409, "Another player has chosen that color."));
                }
                self.prefer_color(id, color)?;
                return Ok(json!({"ok":true,"color":color,"preferredColor":color}));
            }
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
            "/api/leave" => {
                let generation = self.members[id].as_ref().unwrap().generation;
                self.disconnect(id, generation);
            }
            "/api/input" => {
                self.controls(id, b.clone())?;
                return Ok(json!({"ok":true}));
            }
            "/api/control" => {
                if self.members[id].as_ref().unwrap().afk {
                    return Err((403, "Return to the arena before changing the room."));
                }
                if !matches!(self.core.phase(), "ready" | "finished") {
                    return Err((
                        409,
                        "Change room settings or start a new match between matches.",
                    ));
                }
                match b["action"].as_str().unwrap_or("") {
                    "special-abilities" => {
                        self.abilities = b["enabled"]
                            .as_bool()
                            .ok_or((400, "Choose abilities on or off."))?
                    }
                    "start" => {
                        self.reset();
                        self.core.start();
                    }
                    "arena" => {
                        self.arena = b["arena"]
                            .as_u64()
                            .filter(|&a| a < 2)
                            .ok_or((400, "Choose an arena."))?
                            as usize;
                        self.reset();
                    }
                    "bots" => {
                        self.bots = b["bots"]
                            .as_u64()
                            .filter(|&n| n as usize <= CAPACITY - self.count())
                            .ok_or((400, "Too many bots for this room."))?
                            as usize;
                        self.reset();
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
                .is_some_and(|p| p.seen.elapsed() > Duration::from_secs(900))
            {
                if let Some(member) = p.as_ref() { member.notify.notify_one(); }
                *p = None;
                changed = true;
                continue;
            }
            if let Some(p) = p {
                if !p.afk && p.seen.elapsed() > Duration::from_secs(15) {
                    p.afk = true;
                    p.keys = 0;
                    changed = true;
                }
            }
        }
        if changed {
            self.sync();
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
    fn identical_names_have_separate_sessions_and_refresh_keeps_the_same_player() {
        let mut room = Room::new(0, 0);
        let first = room.join(&json!({"name":"Same name","driver":0})).unwrap();
        let second = room.join(&json!({"name":"Same name","driver":1})).unwrap();
        assert_eq!(first["you"], 0);
        assert_eq!(second["you"], 1);
        assert_ne!(first["token"], second["token"]);
        assert_eq!(room.find(first["token"].as_str().unwrap()), Some(0));
        assert_eq!(room.find(second["token"].as_str().unwrap()), Some(1));
        let refreshed = room.resume(1, false);
        assert_eq!(refreshed["you"], 1);
        assert_eq!(refreshed["world"]["driver"], 1);
        assert_eq!(room.find(refreshed["token"].as_str().unwrap()), Some(1));
        assert_eq!(room.find(first["token"].as_str().unwrap()), Some(0));
    }
    #[test]
    fn chat_controls_use_room_identity_and_preserve_private_delivery() {
        let mut room = Room::new(0, 0);
        for name in ["Alice", "Bob", "Eve"] {
            room.join(&json!({"name":name,"driver":null})).unwrap();
        }
        let sent=room.control(0,"/api/chat",&json!({"text":"Private hello","to":1,"name":"Forged","color":"#000000"})).unwrap();
        assert_eq!(sent["messages"][0]["name"],"Alice");
        assert_eq!(sent["messages"][0]["color"],room.core.player_color(0).unwrap());
        assert_eq!(room.control(1,"/api/chat",&json!({})).unwrap()["messages"][0]["text"],"Private hello");
        assert!(room.control(2,"/api/chat",&json!({})).unwrap()["messages"].as_array().unwrap().is_empty());
        room.control(1,"/api/chat",&json!({"text":"Public hello"})).unwrap();
        assert_eq!(room.control(2,"/api/chat",&json!({})).unwrap()["messages"][0]["text"],"Public hello");
    }
    #[test]
    fn private_chat_survives_reconnects_and_afk_token_rotation() {
        let mut room=Room::new(0,0);
        room.join(&json!({"name":"Alice","driver":0})).unwrap();
        room.join(&json!({"name":"Bob","driver":1})).unwrap();
        room.control(0,"/api/chat",&json!({"text":"Keep this private","to":1})).unwrap();
        let old_token=room.members[1].as_ref().unwrap().token.clone();
        room.resume(1,true);room.resume(1,false);room.resume(0,false);
        assert_ne!(old_token,room.members[1].as_ref().unwrap().token);
        for id in [0,1]{assert_eq!(room.control(id,"/api/chat",&json!({})).unwrap()["messages"][0]["text"],"Keep this private");}
    }
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
    fn any_active_player_can_configure_and_start_the_shared_room() {
        for starter in [0, 1] {
            let mut room = Room::new(0, 0);
            room.join(&json!({"name":"First","driver":0})).unwrap();
            room.join(&json!({"name":"Second","driver":1})).unwrap();
            room.control(1, "/api/control", &json!({"action":"arena","arena":1}))
                .unwrap();
            room.control(0, "/api/control", &json!({"action":"bots","bots":3}))
                .unwrap();
            room.control(
                1,
                "/api/control",
                &json!({"action":"special-abilities","enabled":false}),
            )
            .unwrap();
            let settings = room.reply(starter);
            assert_eq!(settings["arena"], 1);
            assert_eq!(settings["bots"], 3);
            assert_eq!(settings["specialAbilities"], false);
            assert!(settings["host"].is_null());
            assert!(settings["world"]["host"].is_null());
            room.control(starter, "/api/control", &json!({"action":"start"}))
                .unwrap();
            assert_eq!(room.core.phase(), "countdown");
            assert!(room.reply(1)["startRequest"].is_null());
        }
    }
    #[test]
    fn shared_room_has_no_play_requests_veto_or_reset_controls() {
        let mut room = Room::new(0, 0);
        room.join(&json!({"name":"First","driver":0})).unwrap();
        room.join(&json!({"name":"Second","driver":1})).unwrap();
        for id in [0, 1] {
            assert_eq!(
                room.control(id, "/api/ready", &json!({"ready":true}))
                    .unwrap_err()
                    .0,
                404
            );
            assert_eq!(
                room.control(
                    id,
                    "/api/control",
                    &json!({"action":"refuse-start","requestId":1})
                )
                .unwrap_err()
                .0,
                400
            );
            assert_eq!(
                room.control(id, "/api/control", &json!({"action":"reset"}))
                    .unwrap_err()
                    .0,
                400
            );
        }
        assert_eq!(room.core.phase(), "ready");
    }
    #[test]
    fn disconnect_and_afk_preserve_the_match_without_assigning_a_captain() {
        let mut room = Room::new(0, 0);
        room.join(&json!({"name":"First","driver":0})).unwrap();
        room.join(&json!({"name":"Second","driver":1})).unwrap();
        room.control(1, "/api/control", &json!({"action":"start"}))
            .unwrap();
        let epoch = room.core.epoch();
        room.disconnect(0, 0);
        for _ in 0..181 {
            room.tick();
        }
        assert!(room.reply(1)["host"].is_null());
        assert_eq!(room.reply(1)["world"]["phase"], "racing");
        assert_eq!(room.reply(1)["world"]["soundEpoch"], epoch);
        assert_eq!(room.reply(0)["players"][0]["afk"], true);
        room.control(1, "/api/afk", &json!({"afk":true})).unwrap();
        assert_eq!(room.core.phase(), "racing");
        let returned = room.control(1, "/api/afk", &json!({"afk":false})).unwrap();
        assert_eq!(returned["players"][1]["afk"], false);
        assert_eq!(returned["world"]["soundEpoch"], epoch);
        assert!(returned["host"].is_null());
    }
    #[test]
    fn room_settings_cannot_reset_a_live_match_and_afk_players_cannot_start_it() {
        let mut room = Room::new(0, 0);
        room.join(&json!({"name":"First","driver":0})).unwrap();
        room.join(&json!({"name":"Second","driver":1})).unwrap();
        room.control(0, "/api/afk", &json!({"afk":true})).unwrap();
        assert_eq!(
            room.control(0, "/api/control", &json!({"action":"start"}))
                .unwrap_err()
                .0,
            403
        );
        room.control(1, "/api/control", &json!({"action":"start"}))
            .unwrap();
        let epoch = room.core.epoch();
        for action in [
            json!({"action":"start"}),
            json!({"action":"bots","bots":1}),
            json!({"action":"arena","arena":1}),
            json!({"action":"special-abilities","enabled":false}),
        ] {
            assert_eq!(room.control(1, "/api/control", &action).unwrap_err().0, 409);
        }
        assert_eq!(room.core.epoch(), epoch);
        assert_eq!(room.reply(1)["arena"], 0);
        assert_eq!(room.reply(1)["bots"], 0);
        assert_eq!(room.reply(1)["specialAbilities"], true);
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

#[cfg(test)]
mod security_tests {
    use super::*;
    #[test]
    fn abandoned_members_expire_even_when_the_socket_never_closed() {
        let mut room=Room::new(0,0);let old=room.join(&json!({"name":"Abandoned","driver":0})).unwrap();
        let member=room.members[0].as_mut().unwrap();member.connected=true;member.seen=Instant::now()-Duration::from_secs(901);
        room.tick();assert_eq!(room.count(),0);assert!(room.find(old["token"].as_str().unwrap()).is_none());
        assert_eq!(room.join(&json!({"name":"Replacement","driver":0})).unwrap()["you"],0);
    }
}

#[cfg(test)]
mod automatic_color_tests {
    use super::*;
    #[test]
    fn default_colors_are_unique_and_survive_reconnects_driver_changes_and_new_matches() {
        let mut room = Room::new(0, 7);
        let first = room.join(&json!({"name":"Same name","driver":6})).unwrap();
        let color = first["world"]["color"].as_str().unwrap().to_owned();
        assert!(PLAYER_COLORS.contains(&color.as_str()));
        room.control(0, "/api/driver", &json!({"driver":0})).unwrap();
        let resumed = room.resume(0, false);
        assert_eq!(resumed["world"]["color"], color);
        for _ in 1..CAPACITY { room.join(&json!({"name":"Same name","driver":6})).unwrap(); }
        let colors = room.members.iter().flatten().map(|p| p.color.clone()).collect::<std::collections::HashSet<_>>();
        assert_eq!(colors.len(), CAPACITY);
        for id in 0..CAPACITY {
            assert!(PLAYER_COLORS.contains(&room.core.player_color(id).unwrap()));
            assert_eq!(room.core.player_color(id).unwrap(), room.members[id].as_ref().unwrap().color);
        }
        room.control(0, "/api/control", &json!({"action":"start"})).unwrap();
        assert_eq!(room.core.player_color(0).unwrap(), color);
    }
}
