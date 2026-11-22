use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::VecDeque,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::Notify;
use wild_wheels_core::{arena_count, arena_max_players, in_bounds, Action, Frame, Input, Move, NativeArena, Told, PLAYER_COLORS};
/// Set once, in rust-core: `wild_wheels_core::MAX_PLAYERS`.
pub const CAPACITY: usize = wild_wheels_core::MAX_PLAYERS;
static FULL: std::sync::LazyLock<&'static str> =
    std::sync::LazyLock::new(|| String::leak(format!("This server is full ({CAPACITY} players).")));
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
        .filter(|&v| v < 16)
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
    /// For the problem log: inputs received and the longest queue of moves waiting
    /// to be played, since the last report.
    inputs: u32,
    longest_queue: usize,
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
    target_score: u64,
    match_minutes: u64,
    epoch: u32,
    seed: u32,
    pub ticks: u64,
    pub overruns: u64,
    pub tick_us: Vec<u64>,
    pub log: crate::logs::Logs,
    /// The match phase last noted in the log.
    phase: String,
    /// The game events already noted, and the most in flight since the last report.
    told: Told,
    busiest: [usize; 3],
    /// The all-time leaderboard, and whether it has changed since it was saved.
    pub board: crate::leaderboard::Leaderboard,
    pub board_changed: bool,
}
impl Room {
    pub fn new(arena: usize, bots: usize) -> Self {
        let epoch = 1;
        let seed = 1;
        let config = json!({"maxPlayers":CAPACITY,"code":"00","arena":arena,"bots":bots,"host":null,"dedicated":true,"epoch":epoch,"seed":seed,"players":[]});
        Self {
            chat: crate::chat::Chat::default(),
            core: NativeArena::new(config).unwrap(),
            members: std::array::from_fn(|_| None),
            bots,
            arena,
            abilities: true,
            target_score: 10,
            match_minutes: 3,
            epoch,
            seed,
            ticks: 0,
            overruns: 0,
            tick_us: Vec::new(),
            log: crate::logs::Logs::disabled(),
            phase: "ready".into(),
            told: Told::default(),
            busiest: [0; 3],
            board: Default::default(),
            board_changed: false,
        }
    }
    /// Who a log line is about. Names are the players' own; tokens are never logged.
    pub fn who(&self, id: usize) -> Value {
        match &self.members[id] {
            Some(p) => json!({"player":id,"name":p.name,"driver":p.driver}),
            None => json!({"player":id}),
        }
    }
    /// What the server holds of a player's controls, for a line about refusing them.
    pub fn input_state(&self, id: usize) -> Value {
        match &self.members[id] {
            Some(p) => json!({"acceptedMove":p.accepted_move,"queuedMoves":p.moves.len(),"sequence":p.sequence,"acceptedAction":p.accepted_action,"afk":p.afk}),
            None => Value::Null,
        }
    }
    /// The match being played and its clock, to set beside what clients report.
    pub fn clock(&self) -> Value {
        json!({"match":self.epoch,"matchSeconds":(self.core.elapsed() * 10.0).round() / 10.0})
    }
    /// The most projectiles, effects and drift particles in flight since the last call.
    pub fn busiest(&mut self) -> Value {
        let [projectiles, effects, particles] = std::mem::take(&mut self.busiest);
        json!({"projectiles":projectiles,"effects":effects,"particles":particles})
    }
    /// Each player's inputs and longest queue of waiting moves since the last call.
    pub fn activity(&mut self) -> Vec<Value> {
        self.members.iter_mut().enumerate().filter_map(|(id, p)| p.as_mut().map(|p| {
            let report = json!({"player":id,"name":p.name,"driver":p.driver,"connected":p.connected,"afk":p.afk,"inputs":p.inputs,"longestMoveQueue":p.longest_queue});
            p.inputs = 0;
            p.longest_queue = 0;
            report
        })).collect()
    }
    pub fn count(&self) -> usize {
        self.members.iter().flatten().count()
    }
    pub fn arena_capacity(&self) -> usize {
        arena_max_players(self.arena).map_or(CAPACITY, |cap| cap.min(CAPACITY))
    }
    pub fn config(&self) -> Value {
        json!({"maxPlayers":CAPACITY,"code":"00","arena":self.arena,"bots":self.bots,"host":null,"dedicated":true,"epoch":self.epoch,"seed":self.seed,"specialAbilities":self.abilities,"targetScore":self.target_score,"matchMinutes":self.match_minutes,"players":self.members.iter().enumerate().filter_map(|(id,p)|p.as_ref().map(|p|json!({"id":id,"name":p.name,"driver":p.driver,"color":p.color,"role":p.role,"afk":p.afk}))).collect::<Vec<_>>()})
    }
    pub fn sync(&mut self) {
        self.bots = self.bots.min(self.arena_capacity().saturating_sub(self.count()));
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
        if self.count() >= self.arena_capacity() {
            return Err((
                409,
                match arena_max_players(self.arena) {
                    Some(4) => "Octagon is full (4 players).",
                    Some(_) => "This arena is full.",
                    None => *FULL,
                },
            ));
        }
        let Some(id) = self.members.iter().position(Option::is_none) else {
            return Err((409, *FULL));
        };
        let chosen = chosen.unwrap_or_else(|| {
            (0..16)
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
            inputs: 0,
            longest_queue: 0,
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
                let afk = match b.get("afk") {
                    None | Some(Value::Null) => false,
                    Some(Value::Bool(afk)) => *afk,
                    _ => return bad("Choose AFK or back in the arena."),
                };
                return Ok(self.resume(id, afk));
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
                    "targetScore" => {
                        self.target_score = b["value"].as_u64().filter(|n| (1..=100).contains(n))
                            .ok_or((400, "Choose 1 to 100 kills."))?;
                    }
                    "matchMinutes" => {
                        self.match_minutes = b["value"].as_u64().filter(|n| (1..=30).contains(n))
                            .ok_or((400, "Choose 1 to 30 minutes."))?;
                    }
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
                        let next = b["arena"]
                            .as_u64()
                            .filter(|&a| (a as usize) < arena_count())
                            .ok_or((400, "Choose an arena."))?
                            as usize;
                        if let Some(cap) = arena_max_players(next) {
                            if self.count() > cap {
                                return Err((
                                    409,
                                    match cap {
                                        4 => "Octagon supports up to 4 players.",
                                        _ => "Too many players in the room for that arena.",
                                    },
                                ));
                            }
                        }
                        self.arena = next;
                        self.bots = self.bots.min(self.arena_capacity().saturating_sub(self.count()));
                        self.reset();
                    }
                    "bots" => {
                        self.bots = b["bots"]
                            .as_u64()
                            .filter(|&n| n as usize <= self.arena_capacity().saturating_sub(self.count()))
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
                "fire" | "nightmare" | "turbo" | "chaff" | "special" | "somersault" | "cycle" | "select" | "bomb"
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
                && (!in_bounds(self.arena, a.wx, a.wz)
                    || a.bomb_kind
                        .as_ref()
                        .is_some_and(|s| !matches!(s.as_str(), "stink" | "abomb")))
            {
                return bad("Invalid bomb.");
            }
        }
        p.accepted_move = accepted;
        p.moves.extend(moves);
        p.inputs += 1;
        p.longest_queue = p.longest_queue.max(p.moves.len());
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
        for (id, p) in self.members.iter_mut().enumerate() {
            if p.as_ref()
                .is_some_and(|p| p.seen.elapsed() > Duration::from_secs(900))
            {
                if let Some(member) = p.as_ref() {
                    member.notify.notify_one();
                    self.log.note("info", "player-expired", json!({"player":id,"name":member.name,"reason":"not heard from for 15 minutes"}));
                }
                *p = None;
                changed = true;
                continue;
            }
            if let Some(p) = p {
                if !p.afk && p.seen.elapsed() > Duration::from_secs(15) {
                    p.afk = true;
                    p.keys = 0;
                    changed = true;
                    self.log.note("warn", "player-away", json!({"player":id,"name":p.name,"connected":p.connected,"reason":"not heard from for 15 seconds"}));
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
        // What happens in the match, so a client's slow frames can be set beside it.
        for mut event in self.core.happenings(&mut self.told) {
            event["match"] = json!(self.epoch);
            let kind = match event["what"] == "kill" {true => "game-kill", false => "game-ability"};
            self.log.note("info", kind, event);
        }
        let load = self.core.load();
        for (most, now) in self.busiest.iter_mut().zip(load) {
            *most = (*most).max(now);
        }
        if self.core.phase() != self.phase {
            let players: Vec<_> = (0..CAPACITY).filter(|id| self.members[*id].is_some()).map(|id| self.who(id)).collect();
            self.log.note("info", "match-phase", json!({"match":self.epoch,"from":self.phase,"to":self.core.phase(),"arena":self.arena,"bots":self.bots,"abilities":self.abilities,"players":players}));
            if self.core.phase() == "finished" {
                // A finished match counts for the people still playing it: one game
                // each, and a win for whoever the match ranks first, unless that is a bot.
                let playing = |id: usize| self.members[id].as_ref().filter(|p| !p.afk).map(|p| p.name.clone());
                let placings = self.core.placings();
                let played: Vec<String> = placings.iter().filter_map(|id| playing(*id)).collect();
                let winner = placings.first().and_then(|id| playing(*id));
                if !played.is_empty() {
                    self.board.record(&played, winner.as_deref());
                    self.board_changed = true;
                }
                // Ratings compare the people driving in it, by kills and then deaths;
                // bots and bombers are not rated.
                let results: Vec<crate::leaderboard::Result> = self.core.scores().into_iter()
                    .filter_map(|(id, kills, deaths)| self.members[id].as_ref().filter(|p| !p.afk && p.role == "driver").map(|p| (p.name.clone(), kills, deaths)))
                    .collect();
                let ratings = self.board.rate(&results);
                self.log.note("info", "match-result", json!({"match":self.epoch,"winner":winner,"played":played,"ratings":ratings}));
            }
            self.phase = self.core.phase().to_owned();
        }
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
    fn a_full_room_of_people_can_join_and_one_more_is_rejected() {
        let mut room = Room::new(0, 1);
        for id in 0..CAPACITY {
            let reply = room
                .join(&json!({"name":format!("Player {id}"),"driver":null}))
                .unwrap();
            assert_eq!(reply["you"], id);
            assert_eq!(reply["maxPlayers"], CAPACITY);
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
    fn houstons_nightmare_action_is_acknowledged_and_cannot_reset_its_cooldown() {
        let mut room = Room::new(0, 0);
        room.join(&json!({"name":"Houston","driver":7})).unwrap();
        room.control(0,"/api/control",&json!({"action":"start"})).unwrap();
        for _ in 0..181 { room.tick(); }
        let epoch=room.core.epoch();
        room.controls(0,json!({"sequence":0,"epoch":epoch,"keys":[],"moves":[],"actions":[{"type":"nightmare","id":0,"afterMove":-1}]})).unwrap();
        room.tick();
        let active=room.reply(0);
        assert_eq!(active["actionSequence"],0);
        assert!(active["world"]["nightmareActive"].as_f64().unwrap()>11.9);
        assert!(active["world"]["nightmareCooldown"].as_f64().unwrap()>29.9);
        assert_eq!(active["world"]["specialCooldown"],0.0);
        room.controls(0,json!({"sequence":1,"epoch":epoch,"keys":[],"moves":[],"actions":[{"type":"nightmare","id":1,"afterMove":-1}]})).unwrap();
        room.tick();
        assert_eq!(room.reply(0)["actionSequence"],1);
        assert!(room.reply(0)["world"]["nightmareCooldown"].as_f64().unwrap()<active["world"]["nightmareCooldown"].as_f64().unwrap());
    }
    #[test]
    fn abilities_and_match_phases_are_noted_with_the_match_clock() {
        let directory = std::env::temp_dir().join(format!("wild-wheels-game-log-{}", token()));
        let mut room = Room::new(0, 0);
        room.log = crate::logs::Logs::open(&directory, Default::default(), None).unwrap();
        room.join(&json!({"name":"Houston","driver":7})).unwrap();
        room.control(0,"/api/control",&json!({"action":"start"})).unwrap();
        for _ in 0..181 { room.tick(); }
        let epoch=room.core.epoch();
        room.controls(0,json!({"sequence":0,"epoch":epoch,"keys":[],"moves":[],"actions":[{"type":"nightmare","id":0,"afterMove":-1},{"type":"special","id":1,"afterMove":-1}]})).unwrap();
        // Nightmare Fuel lasts 13 seconds; it starts once and ends once.
        for _ in 0..(14 * 60) { room.tick(); }
        room.log.flush();
        std::thread::sleep(Duration::from_millis(1200));
        let read = |query: &str| crate::logs::read(&directory, Default::default(), &crate::logs::Query::parse(query).unwrap(), crate::logs::now()).unwrap();
        let abilities = read("day=today&event=game-ability");
        let told: Vec<_> = abilities["entries"].as_array().unwrap().iter().map(|e| (e["ability"].as_str().unwrap().to_owned(), e["state"].as_str().unwrap().to_owned())).collect();
        assert_eq!(told.iter().filter(|(ability, state)| ability == "Nightmare Fuel" && state == "start").count(), 1, "{told:?}");
        assert_eq!(told.iter().filter(|(ability, state)| ability == "Nightmare Fuel" && state == "end").count(), 1, "{told:?}");
        assert_eq!(told.iter().filter(|(ability, state)| ability == "Reine de la paresse" && state == "start").count(), 1, "{told:?}");
        let start = abilities["entries"].as_array().unwrap().iter().find(|e| e["ability"] == "Nightmare Fuel" && e["state"] == "start").unwrap();
        assert_eq!((start["match"].as_u64(), start["who"]["character"].as_str(), start["who"]["human"].as_bool()), (Some(u64::from(room.epoch)), Some("Houston the RTPL"), Some(true)));
        assert!(start["matchSeconds"].as_f64().unwrap() < 0.2, "{start}");
        let phases: Vec<_> = read("day=today&event=match-phase")["entries"].as_array().unwrap().iter().map(|e| e["to"].as_str().unwrap().to_owned()).collect();
        assert_eq!(phases, ["countdown", "racing"]);
        std::fs::remove_dir_all(directory).unwrap();
    }
    #[test]
    fn a_finished_match_counts_one_game_for_each_person_playing_and_a_win_for_the_winner() {
        // Once with only people, once with a bot, which attacks and so usually wins.
        for bots in [0, 1] {
            let mut room = Room::new(0, bots);
            for name in ["Oren", "Sarah", "Dana"] {
                room.join(&json!({"name":name,"driver":null})).unwrap();
            }
            room.control(0,"/api/control",&json!({"action":"start"})).unwrap();
            // Dana sits the match out.
            room.control(2,"/api/afk",&json!({"afk":true})).unwrap();
            let mut ticks = 0;
            while room.core.phase() != "finished" {
                room.tick();
                ticks += 1;
                assert!(ticks < 60 * 60 * 6, "the match must finish");
                assert!(room.board_changed == (room.core.phase() == "finished"), "a match is counted as it finishes, not before");
            }
            let first = room.core.placings()[0];
            let winner = ["Oren", "Sarah"].get(first).copied();
            if bots == 0 {
                assert_eq!(winner, Some("Oren"), "nobody scored, so the match ranks the first seat first");
            }
            let mut standings = room.board.standings();
            standings.sort_by(|a, b| a.name.cmp(&b.name));
            assert_eq!(standings.len(), 2, "only the people playing are counted: {standings:?}");
            for (player, name) in standings.iter().zip(["Oren", "Sarah"]) {
                assert_eq!((player.name.as_str(), player.games, player.wins), (name, 1, u64::from(winner == Some(name))), "bots {bots}, first seat {first}");
            }
            // The two people are rated against each other by their scores, whatever a bot did.
            let scores = room.core.scores();
            let score = |seat: usize| scores.iter().find(|(id, ..)| *id == seat).map(|(_, kills, deaths)| (*kills, std::cmp::Reverse(*deaths))).unwrap();
            let (oren, sarah) = (standings[0].rating, standings[1].rating);
            match score(0).partial_cmp(&score(1)).unwrap() {
                std::cmp::Ordering::Greater => assert_eq!((oren, sarah), (1016.0, 984.0)),
                std::cmp::Ordering::Less => assert_eq!((oren, sarah), (984.0, 1016.0)),
                std::cmp::Ordering::Equal => assert_eq!((oren, sarah), (1000.0, 1000.0), "level scores are a draw, though the match names a winner"),
            }
            // The result is counted once, however long the finished match stays on screen.
            room.board_changed = false;
            for _ in 0..600 { room.tick(); }
            assert!(!room.board_changed);
            assert!(room.board.standings().iter().all(|player| player.games == 1));
            assert_eq!(room.board.standings().iter().map(|player| player.rating).sum::<f64>(), 2000.0, "and rated once");
        }
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
    #[test]
    fn session_resume_can_preserve_afk_or_return_to_arena() {
        let mut room = Room::new(0, 0);
        room.join(&json!({"name":"Oren","driver":0})).unwrap();
        room.control(0, "/api/afk", &json!({"afk":true})).unwrap();
        assert!(room.members[0].as_ref().unwrap().afk);

        // Background/AFK reconnects pass afk: true and must not pop the player back into the match.
        let stayed = room.control(0, "/api/session", &json!({"afk":true})).unwrap();
        assert!(room.members[0].as_ref().unwrap().afk);
        assert_eq!(stayed["players"][0]["afk"], true);

        // Invalid non-boolean afk is rejected.
        assert_eq!(room.control(0, "/api/session", &json!({"afk":"yes"})).unwrap_err().0, 400);

        // Default /api/session without afk returns the player to active play.
        let returned = room.control(0, "/api/session", &json!({})).unwrap();
        assert!(!room.members[0].as_ref().unwrap().afk);
        assert_eq!(returned["players"][0]["afk"], false);
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

    #[test]
    fn octagon_enforces_four_player_limit_and_clamps_bots() {
        let mut room = Room::new(0, 5);
        for i in 0..3 {
            room.join(&json!({"name":format!("P{i}"),"driver":i})).unwrap();
        }
        room.control(0, "/api/control", &json!({"action":"arena","arena":2})).unwrap();
        assert_eq!(room.arena, 2);
        assert_eq!(room.bots, 1, "3 humans + 1 bot = 4 max on Octagon");
        assert!(room.control(0, "/api/control", &json!({"action":"bots","bots":2})).is_err());
        room.join(&json!({"name":"P3","driver":3})).unwrap();
        assert_eq!(room.bots, 0, "4th human replaces the last bot slot");
        assert_eq!(
            room.join(&json!({"name":"P4","driver":4})).unwrap_err().0,
            409,
            "5th human must be rejected while room is on Octagon"
        );
        // Switching back to Scrapyard lets a 5th human join, then switching to Octagon is rejected.
        room.control(0, "/api/control", &json!({"action":"arena","arena":0})).unwrap();
        room.join(&json!({"name":"P4","driver":4})).unwrap();
        assert_eq!(
            room.control(0, "/api/control", &json!({"action":"arena","arena":2})).unwrap_err().0,
            409
        );
    }
}
