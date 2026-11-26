//! The in-match HUD: everything the browser client shows over the arena.
//! Labels, enabling rules and notice timing mirror `client/game.js` and `ui/`;
//! racer names, ability names and announcement cards come from the ported pack.
use crate::{
    app::GameSession,
    gui::{Act, Menu, Screen, Tone},
    ported::{Graphics, tint},
    scene::FollowCamera,
    ui_port::UiCards,
};
use bevy::{prelude::*, ui::RelativeCursorPosition};
use std::collections::{HashMap, HashSet, VecDeque};
use wild_wheels_core::{ClientAction, ClientView};

/// Racers whose special ability the browser offers a button for.
const SPECIALISTS: [usize; 9] = [5, 7, 8, 9, 11, 12, 13, 14, 15];
/// The browser viewport is 922 CSS pixels wide in its usual layout; the native
/// window is 1280, so every CSS length is scaled by this.
const K: f32 = 1.4;
/// Fill, border and text colors of one button state, from the browser's CSS.
#[derive(Clone, Copy)]
struct Look {
    fill: Color,
    edge: Color,
    ink: Color,
}
/// A CSS `#rrggbbaa` color.
const fn hex(rgba: u32) -> Color {
    Color::srgba(
        (rgba >> 24 & 255) as f32 / 255.0,
        (rgba >> 16 & 255) as f32 / 255.0,
        (rgba >> 8 & 255) as f32 / 255.0,
        (rgba & 255) as f32 / 255.0,
    )
}
const CARD: Look = Look {
    fill: hex(0xffffff0b),
    edge: hex(0xffffff36),
    ink: hex(0xf9f4e8ff),
};
const CHOSEN: Look = Look {
    fill: hex(0xe2ed9d25),
    edge: hex(0xe2ed9dff),
    ink: hex(0xf0ffb0ff),
};
const RAPID: Look = Look {
    fill: hex(0xff9b2829),
    edge: hex(0xffbd58ff),
    ink: hex(0xffe099ff),
};
const ACTION: Look = Look {
    fill: hex(0x243847e8),
    edge: hex(0xbce5f3ff),
    ink: hex(0xe1f8ffff),
};
const SHADOW: Color = hex(0x29283bff);
const MAP_SCALE: f32 = 0.6;
const MAP_SIZE: Vec2 = Vec2::splat(126.0);
const SLOTS: usize = 8;
const MAP_BLOCK_SLOTS: usize = 32;
const MAP_WATER_SLOTS: usize = 48;
const MAP_BRIDGE_SLOTS: usize = 16;

/// One piece of text the HUD keeps up to date; an empty reading hides its panel.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum Id {
    Kills,
    Health,
    Time,
    Board,
    Incoming,
    Averted,
    Hint,
    Toast,
    Dizzy,
    Whack,
    Ring,
    Ability,
    BridgeProgress,
    Reward,
    Intelligence,
    Tehilim,
    Hedgeguard,
    Vulcan,
    Item,
    Drift,
    Speed,
    Hedgehogs,
    Missiles,
    Turbos,
    Special,
    Chaff,
    Flip,
    Voice,
    Euler,
}
/// A node the HUD shows, hides, moves or recolors.
#[derive(Component, Clone, Copy, PartialEq, Debug)]
pub enum Part {
    Root,
    Panel(Id),
    /// The filled length of a progress bar.
    Fill(Id),
    MapWater(usize),
    MapBridge(usize),
    MapBlock(usize),
    MapDot(usize),
    /// Anchors a rival's nameplate above their kart.
    Plate(usize),
    /// The nameplate itself, edged in the rival's color.
    PlateEdge(usize),
    /// Ported HTML/CSS announcement card container (with dynamic subtitle & sparks).
    HtmlCard(Id),
    /// Radial burst spark around a ported HTML/CSS announcement card.
    CardSpark(Id, usize),
    KarmaScore(usize),
}
#[derive(Component, Clone, Copy, PartialEq, Debug)]
pub enum Label {
    Of(Id),
    /// The large number on a weapon card.
    Count(Id),
    Plate(usize),
    /// Dynamic detail text overlaid into the ported HTML card's `<small>` slot.
    CardDetail(Id),
    KarmaScore(usize),
}
/// Image node displaying a Chrome-ported HTML/CSS announcement texture.
#[derive(Component, Clone, Copy, PartialEq, Eq)]
pub struct HtmlCardArt(Id);
/// A label's own color, used whenever its reading does not override it.
#[derive(Component)]
pub struct Ink(Color);
/// A clickable card or button whose color shows whether it can be used.
#[derive(Component)]
pub struct Card(Id);

#[derive(Default)]
struct Reading {
    text: String,
    count: String,
    color: Option<Color>,
    fill: Option<f32>,
    /// A card's resting color; `None` leaves other panels alone.
    tone: Option<Color>,
    border: Option<Color>,
}

/// A timed announcement: shown from when it is sampled until `until`.
#[derive(Clone, Debug, PartialEq)]
struct Notice {
    title: String,
    detail: String,
    color: Option<[u8; 3]>,
    card_key: Option<String>,
    score_swap: Option<[String; 2]>,
    started: f64,
    until: f64,
}
/// Announcements derived from changes in game state, each mirroring a browser class.
#[derive(Resource, Default)]
pub struct Notices {
    /// (arena, viewer): a different match forgets everything seen.
    identity: Option<(usize, usize)>,
    elapsed: f64,
    kills: HashSet<u32>,
    whacks: VecDeque<Notice>,
    whack: Option<Notice>,
    diversions: HashMap<u32, u32>,
    averted: f64,
    burning: bool,
    ring: Option<(bool, f64)>,
    abilities: HashMap<usize, (usize, f64, f64, f64, f64, String, u16)>,
    last_karma_id: u32,
    ability: Option<Notice>,
    intelligence: Option<u32>,
    reward: Option<Notice>,
    euler_bridges: u16,
    euler_on_bridge: Option<(usize, i8)>,
    euler_hinted: bool,
}
impl Notices {
    /// Live bitmask of distinct Königsberg bridges crossed in the current life,
    /// combining authoritative server state with immediate local tracking.
    pub fn euler_mask(&self, view: &ClientView) -> u16 {
        if view.arena_def.bridges.len() != 7 || view.phase != "racing" || view.player.destroyed > 0.0 {
            return 0;
        }
        view.player.euler_bridges | self.euler_bridges
    }
    /// Updates every announcement for this frame. `now` is wall-clock seconds.
    fn sample(&mut self, view: &ClientView, graphics: &Graphics, now: f64) {
        let p = view.player;
        let identity = Some((view.arena, view.you));
        let restarted = identity != self.identity || view.elapsed + 0.5 < self.elapsed;
        self.elapsed = view.elapsed;
        let racing = view.phase == "racing";
        if restarted {
            *self = Self {
                identity,
                elapsed: view.elapsed,
                // Joining a match must not celebrate what happened before.
                kills: view.kill_feed.iter().map(|k| k.id).collect(),
                diversions: view
                    .chaff_clouds
                    .iter()
                    .filter(|c| c.owner == view.you)
                    .map(|c| (c.id, c.diversions))
                    .collect(),
                intelligence: Some(p.intelligence_bonus),
                last_karma_id: view.last_karma.map_or(0, |k| k.id),
                ..default()
            };
        }
        // KillCelebration: each of the viewer's kills gets two seconds, in order.
        for kill in view.kill_feed.iter().rev() {
            if !self.kills.insert(kill.id) || !racing {
                continue;
            }
            if kill.attacker != view.you || view.elapsed - kill.time > 3.0 {
                continue;
            }
            let victim = view.actors.get(kill.victim);
            self.whacks.push_back(Notice {
                title: match (kill.assist, kill.radiation) {
                    (true, _) => "\u{2726} CO-WHACKED \u{2726}",
                    (false, true) => "YOU CHERNOWHACKED",
                    (false, false) if kill.kind == "wormhole" => "You Spaghetti-whacked",
                    _ => "\u{2726} YOU WHACKED \u{2726}",
                }
                .into(),
                detail: format!(
                    "\u{201c}{}\u{201d}{}{}",
                    kill.victim_name,
                    match kill.kind.as_str() {
                        "fashion" if !kill.assist => "\nThat's all.",
                        _ => "",
                    },
                    match victim.is_some_and(|v| v.driver == 10) {
                        true => "\nhe's unimpressed...",
                        false => "",
                    },
                ),
                color: None,
                card_key: None,
                score_swap: None,
                started: now,
                until: 0.0,
            });
        }
        if !racing {
            self.whacks.clear();
            self.whack = None;
        }
        while self.whacks.len() > 16 {
            self.whacks.pop_front();
        }
        if self.whack.as_ref().is_some_and(|w| now >= w.until) {
            self.whack = None;
        }
        if self.whack.is_none()
            && let Some(mut next) = self.whacks.pop_front()
        {
            next.until = now + 2.0;
            self.whack = Some(next);
        }
        // ChaffNotice: one of the viewer's clouds has just drawn a missile away.
        for cloud in view.chaff_clouds.iter().filter(|c| c.owner == view.you) {
            let before = self
                .diversions
                .insert(cloud.id, cloud.diversions)
                .unwrap_or(0);
            let recent = cloud.diverted_at.is_some_and(|at| view.elapsed - at < 3.0);
            if cloud.diversions > before && recent {
                self.averted = now + 2.0;
            }
        }
        if !racing || p.destroyed > 0.0 {
            self.averted = 0.0;
        }
        // RingOfFireNotice: the viewer's ring has just been lit.
        let ring = view
            .effects
            .iter()
            .find(|fx| fx.kind == "fireRing" && fx.owner == Some(view.you))
            .filter(|_| view.special_abilities);
        if !racing || p.destroyed > 0.0 {
            self.burning = false;
            self.ring = None;
        } else {
            if let Some(ring) = ring.filter(|_| !self.burning && self.ring.is_none()) {
                self.ring = Some((ring.color.as_deref() == Some("#4abaff"), now + 2.3));
            }
            self.burning = ring.is_some();
            if self.ring.is_some_and(|(_, until)| now >= until) {
                self.ring = None;
            }
        }
        // AbilityUsage: a jump in a racer's cooldown means they just used their special.
        let mut used = None;
        let mut karma_caster = None;
        if let Some(karma) = view.last_karma
            && karma.id > self.last_karma_id
        {
            self.last_karma_id = karma.id;
            if racing && view.special_abilities && view.elapsed - karma.time < 3.0 {
                karma_caster = Some(karma.caster);
                let (title, detail, color) = graphics.racers()[15].card.clone();
                used = Some((
                    karma.caster == view.you,
                    Notice {
                        title, detail, color: Some(color),
                        card_key: Some("ability:15".into()),
                        score_swap: karma.swapped.then(|| [karma.victim_after.to_string(), karma.caster_after.to_string()]),
                        started: now,
                        until: now + 2.4,
                    },
                ));
            }
        }
        for a in view.actors {
            let state = (
                a.driver,
                a.special_cooldown,
                a.boost,
                a.somersault_cooldown,
                a.nightmare_cooldown,
                a.notice.clone(),
                a.euler_bridges,
            );
            let before = self.abilities.insert(a.id, state.clone());
            let Some(before) = before else {
                continue;
            };
            let absent = a.inactive || a.afk || a.destroyed > 0.0 || a.bomber;
            if !racing || absent {
                continue;
            }
            if state.5 != before.5 {
                let who = match a.id == view.you {
                    true => "YOU".to_owned(),
                    false => a.name.as_deref().unwrap_or("RIVAL").to_uppercase(),
                };
                if state.5 == "EULERIAN PATH ACHIEVED!" {
                    let event = Notice {
                        title: "EULERIAN PATH ACHIEVED!".into(),
                        detail: format!("{who} BROKE THE THEOREM · EULER'S GHOST HAUNTS THE ARENA!"),
                        color: Some([0xf5, 0xd7, 0x7f]),
                        card_key: Some("euler:path".into()),
                        score_swap: None,
                        started: now,
                        until: now + 4.2,
                    };
                    if a.id == view.you || used.as_ref().is_none_or(|(mine, _)| !mine) {
                        used = Some((a.id == view.you, event));
                    }
                    continue;
                }
                if state.5 == "6/7 bridges, Euler remains confident of his result..." {
                    let event = Notice {
                        title: "6/7 BRIDGES".into(),
                        detail: "6/7 bridges, Euler remains confident of his result...".into(),
                        color: Some([0x9f, 0xd8, 0xf5]),
                        card_key: Some("euler:near".into()),
                        score_swap: None,
                        started: now,
                        until: now + 3.2,
                    };
                    if a.id == view.you || used.as_ref().is_none_or(|(mine, _)| !mine) {
                        used = Some((a.id == view.you, event));
                    }
                    continue;
                }
            }
            let crossed = a.euler_bridges.count_ones();
            if a.id == view.you && a.euler_bridges != before.6 && (1..=5).contains(&crossed) {
                used = Some((true, Notice {
                    title: format!("{crossed}/7 BRIDGES"),
                    detail: "Distinct bridges crossed on this path".into(),
                    color: Some([0x9f, 0xd8, 0xf5]),
                    card_key: Some("euler:progress".into()),
                    score_swap: None,
                    started: now,
                    until: now + 1.8,
                }));
                continue;
            }
            if before.0 != a.driver || !view.special_abilities {
                continue;
            }
            let racer = graphics.racers().get(a.driver);
            let own = |title: &str, detail: &str, color: [u8; 3]| {
                Some((title.to_owned(), detail.to_owned(), color))
            };
            let mut card = None;
            let mut card_key: Option<String> = None;
            if a.driver == 7 && state.4 > before.4 + 1.0 {
                card = own(
                    "NIGHTMARE FUEL",
                    "HOUSTON, WE HAVE A PROBLEM",
                    [0xd0, 0x68, 0xff],
                );
                card_key = Some("ability:7:nightmare".into());
            }
            if state.1 > before.1 + 1.0 || (a.driver == 10 && state.2 > before.2 + 0.3) {
                if a.driver == 15 && karma_caster == Some(a.id) {
                    continue;
                }
                card = racer
                    .filter(|racer| !racer.card.0.is_empty())
                    .map(|racer| racer.card.clone());
                card_key = Some(format!("ability:{}", a.driver));
            }
            if a.driver == 5 && state.3 > before.3 + 0.3 {
                card = own("CRICKET'S JUMP", "NOW YOU SEE HER...", [0xb7, 0xf3, 0x5b]);
                card_key = Some("ability:5:jump".into());
            }
            if card.is_some() && a.driver == 13 && a.special_active > 0.0 {
                card = own(
                    "XYLOPHONE-ATTACK",
                    "A VERY TAXING PERFORMANCE",
                    [0xff, 0xf2, 0x9b],
                );
                card_key = Some("ability:13:xylophone".into());
            }
            let wormhole = a.driver == 8 && state.4 > before.4 + 1.0;
            if wormhole {
                card = own("WORMHOLE", "Can you handle the topology", [0x9f, 0xfa, 0xff]);
                card_key = Some("ability:8:wormhole".into());
            }
            let Some((mut title, detail, color)) = card else {
                continue;
            };
            if a.driver == 8 && a.id != view.you && !wormhole {
                title = "TIME DILATION".into();
                card_key = Some("ability:8:rival".into());
            }
            let who = match a.id == view.you {
                true => "YOU",
                false => a.name.as_deref().unwrap_or("RIVAL"),
            };
            let event = Notice {
                title,
                detail: if a.driver == 15 || wormhole { detail } else { format!("{who} · {detail}") },
                color: Some(color),
                card_key,
                score_swap: None,
                started: now,
                until: now + 2.4,
            };
            // The viewer's own ability takes precedence; otherwise the latest wins.
            if a.id == view.you || used.as_ref().is_none_or(|(mine, _)| !mine) {
                used = Some((a.id == view.you, event));
            }
        }
        if let Some((_, event)) = used {
            self.ability = Some(event);
        }
        if !racing
            || (!view.special_abilities && !self.ability.as_ref()
                .and_then(|n| n.card_key.as_deref()).is_some_and(|key| key.starts_with("euler:")))
            || self.ability.as_ref().is_some_and(|c| now >= c.until)
        {
            self.ability = None;
        }
        // PermanentStatGains: a collected bicycle raises intelligence for good.
        let bonus = p.intelligence_bonus;
        if let Some(before) = self.intelligence.filter(|before| bonus > *before) {
            let base = graphics
                .racers()
                .get(p.driver)
                .map_or(0, |r| u32::from(r.intelligence));
            self.reward = Some(Notice {
                title: format!(
                    "INTELLIGENCE UP!  {} \u{2192} {}",
                    base + before,
                    base + bonus
                ),
                detail: format!(
                    "{} -> {} · BICYCLE COLLECTED · CARRY MORE ITEMS",
                    base + before,
                    base + bonus
                ),
                color: Some([0xc6, 0xad, 0xff]),
                card_key: Some("reward:intelligence".into()),
                score_swap: None,
                started: now,
                until: now + 3.0,
            });
        }
        self.intelligence = Some(bonus.max(self.intelligence.unwrap_or(0)));
        if self.reward.as_ref().is_some_and(|c| now >= c.until) {
            self.reward = None;
        }
        // Client-side Euler bridge crossing tracker (matches rust-core/src/arena/euler.rs)
        // so the live 3D arrow and counter update immediately even before a server restart.
        if !racing || view.arena_def.bridges.len() != 7 || p.destroyed > 0.0 || p.bomber || p.afk || p.inactive {
            self.euler_bridges = 0;
            self.euler_on_bridge = None;
            self.euler_hinted = false;
        } else {
            let bridges = &view.arena_def.bridges;
            let axis_delta = |b: &[f64; 5]| if b[4] == 1.0 { p.wx - b[0] } else { p.wz - b[1] };
            let on = |b: &[f64; 5]| {
                if b[4] == 1.0 {
                    (p.wx - b[0]).abs() <= b[2] / 2.0 + 0.6 && (p.wz - b[1]).abs() <= b[3] / 2.0
                } else {
                    (p.wx - b[0]).abs() <= b[2] / 2.0 && (p.wz - b[1]).abs() <= b[3] / 2.0 + 0.6
                }
            };
            let current = bridges
                .iter()
                .enumerate()
                .find(|(_, b)| on(b))
                .map(|(idx, b)| (idx, if axis_delta(b) < 0.0 { -1_i8 } else { 1_i8 }));
            match (self.euler_on_bridge, current) {
                (None, Some(entry)) => self.euler_on_bridge = Some(entry),
                (Some((prev, _)), Some(entry)) if prev != entry.0 => self.euler_on_bridge = Some(entry),
                (Some((idx, entry_side)), None) => {
                    self.euler_on_bridge = None;
                    let b = &bridges[idx];
                    if (p.wx - b[0]).hypot(p.wz - b[1]) <= b[2].max(b[3]) + 10.0 {
                        let exit_side = if axis_delta(b) < 0.0 { -1_i8 } else { 1_i8 };
                        if exit_side == -entry_side {
                            let bit = 1u16 << idx;
                            if self.euler_bridges & bit != 0 {
                                self.euler_bridges = bit;
                                self.euler_hinted = false;
                            } else {
                                self.euler_bridges |= bit;
                                let count = self.euler_bridges.count_ones();
                                if count == 6 && !self.euler_hinted {
                                    self.euler_hinted = true;
                                    self.ability = Some(Notice {
                                        title: "6/7 BRIDGES".into(),
                                        detail: "6/7 bridges, Euler remains confident of his result...".into(),
                                        color: Some([0x9f, 0xd8, 0xf5]),
                                        card_key: Some("euler:near".into()),
                                        score_swap: None,
                                        started: now,
                                        until: now + 3.2,
                                    });
                                } else if count == 7 {
                                    self.euler_bridges = 0;
                                    self.euler_hinted = false;
                                    self.ability = Some(Notice {
                                        title: "EULERIAN PATH ACHIEVED!".into(),
                                        detail: "YOU BROKE THE THEOREM · EULER'S GHOST HAUNTS THE ARENA!".into(),
                                        color: Some([0xf5, 0xd7, 0x7f]),
                                        card_key: Some("euler:path".into()),
                                        score_swap: None,
                                        started: now,
                                        until: now + 4.2,
                                    });
                                }
                            }
                        }
                    }
                }
                _ => {}
            }
        }
    }
}

/// The browser's leaderboard order: kills, then the host on a tie, then fewer deaths.
pub fn standings<'a>(view: &ClientView<'a>) -> Vec<&'a wild_wheels_core::Actor> {
    let mut racers: Vec<_> = view.actors.iter().filter(|a| !a.inactive).collect();
    let top = racers.iter().map(|a| a.kills).fold(f64::MIN, f64::max);
    let host =
        |a: &wild_wheels_core::Actor| view.multiplayer && view.host == Some(a.id) && a.kills == top;
    racers.sort_by(|a, b| {
        b.kills
            .total_cmp(&a.kills)
            .then(host(b).cmp(&host(a)))
            .then(a.deaths.cmp(&b.deaths))
            .then(a.id.cmp(&b.id))
    });
    racers
}
/// One row of the all-time Elo leaderboard: rank, player name, Elo rating, wins, games, and whether it is the viewer.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct AllTimeRow {
    pub rank: usize,
    pub name: String,
    pub rating: i64,
    pub wins: u64,
    pub games: u64,
    pub you: bool,
}

pub(crate) const ALL_TIME_ROWS: usize = 8;

/// Mirrors `allTimeRows` in `ui/all-time.js`: returns the top `limit` entries
/// and appends the viewer's own entry if ranked lower than `limit`.
pub(crate) fn all_time_rows(
    board: &[(String, f64, u64, u64)],
    you: Option<&str>,
    limit: usize,
) -> Vec<AllTimeRow> {
    let you_key = you.map(|s| s.trim().to_lowercase()).filter(|s| !s.is_empty());
    let row = |index: usize, (name, rating, wins, games): &(String, f64, u64, u64)| AllTimeRow {
        rank: index + 1,
        name: name.clone(),
        rating: rating.round() as i64,
        wins: *wins,
        games: *games,
        you: you_key
            .as_deref()
            .is_some_and(|key| name.trim().to_lowercase() == key),
    };
    let mut top: Vec<AllTimeRow> = board
        .iter()
        .take(limit)
        .enumerate()
        .map(|(i, p)| row(i, p))
        .collect();
    if let Some(key) = you_key.as_deref()
        && !top.iter().any(|r| r.you)
        && let Some((index, entry)) = board
            .iter()
            .enumerate()
            .find(|(_, (name, _, _, _))| name.trim().to_lowercase() == key)
    {
        top.push(row(index, entry));
    }
    top
}

/// Finds a player's all-time Elo entry (1-based rank, rounded Elo rating, wins, games) by name.
pub(crate) fn player_elo(
    board: &[(String, f64, u64, u64)],
    name: Option<&str>,
) -> Option<(usize, i64, u64, u64)> {
    let key = name?.trim().to_lowercase();
    if key.is_empty() {
        return None;
    }
    board
        .iter()
        .enumerate()
        .find(|(_, (entry_name, _, _, _))| entry_name.trim().to_lowercase() == key)
        .map(|(i, (_, rating, wins, games))| (i + 1, rating.round() as i64, *wins, *games))
}

/// Server and game text without emoji, which the HUD's font cannot draw.
pub fn plain(text: &str) -> String {
    let kept: String = text
        .chars()
        .filter(|c| !matches!(u32::from(*c), 0x1F000..=0x1FAFF | 0xFE00..=0xFE0F | 0x200D))
        .collect();
    kept.split_whitespace().collect::<Vec<_>>().join(" ")
}
/// Minutes, seconds and hundredths, as the browser's race clock shows them.
pub fn clock(seconds: f64) -> String {
    let seconds = seconds.max(0.0);
    format!("{:02}:{:05.2}", (seconds / 60.0).floor(), seconds % 60.0)
}
/// Whether a wall or the arena's edge hides a racer from the camera.
fn hidden(view: &ClientView, eye: Vec3, wx: f64, wz: f64, height: f32) -> bool {
    let to = Vec3::new(wx as f32, height, wz as f32);
    let distance = Vec2::new(to.x - eye.x, to.z - eye.z).length();
    let mut step = 1.0;
    while step < distance {
        let point = eye.lerp(to, step / distance);
        let (x, z) = (f64::from(point.x), f64::from(point.z));
        let walled = view
            .blocks
            .iter()
            .any(|[bx, bz, w, d]| (x - bx).abs() < w / 2.0 && (z - bz).abs() < d / 2.0);
        if (point.y < 6.0 && walled) || (point.y < 5.0 && !view.arena_def.in_bounds(x, z, 0.0)) {
            return true;
        }
        step += 2.0;
    }
    false
}

fn readings(
    view: &ClientView,
    graphics: &Graphics,
    notices: &Notices,
    now: f64,
    board: Option<&[(String, f64, u64, u64)]>,
    voice_text: String,
    talking: bool,
) -> HashMap<Id, Reading> {
    let p = view.player;
    let racing = view.phase == "racing";
    let live = racing && p.destroyed <= 0.0;
    let active = racing && view.finish_countdown.is_none();
    let powered = p.vulcan > 0.0;
    let racer = graphics.racers().get(p.driver);
    let mut out = HashMap::new();
    let mut text = |id: Id, text: String| {
        out.insert(id, Reading { text, ..default() });
    };
    text(
        Id::Kills,
        format!("{:.0} / {:.0}", p.kills, view.target_score),
    );
    let left = view.duration - view.finish_time.unwrap_or(view.elapsed);
    text(Id::Time, clock(left));
    text(Id::Speed, format!("{:.0}", (p.speed * 0.24).round()));
    text(Id::Health, "\u{2665}".repeat(p.health.max(0.0) as usize));
    let rows: Vec<_> = standings(view)
        .iter()
        .map(|a| {
            let first = graphics
                .racers()
                .get(a.driver)
                .and_then(|racer| racer.name.split(' ').next());
            let name = match a.id == view.you {
                true => "YOU",
                false => a.name.as_deref().or(first).unwrap_or("Racer"),
            };
            format!("{name}  {:.0} / {}", a.kills, a.deaths)
        })
        .collect();
    // Under the match's own standings, the server's all-time board: Elo rating, wins and games played.
    // A server that sent no board shows none; one with an empty board says so.
    let all_time = match board {
        None => String::new(),
        Some(board) => {
            let rows: String = all_time_rows(board, p.name.as_deref(), ALL_TIME_ROWS)
                .into_iter()
                .map(|row| {
                    let marker = match row.you {
                        true => " (YOU)",
                        false => "",
                    };
                    format!(
                        "\n{}. {}{}  {} · {} / {}",
                        row.rank, row.name, marker, row.rating, row.wins, row.games
                    )
                })
                .collect();
            let rows = match rows.is_empty() {
                true => "\nNo matches finished yet".to_owned(),
                false => rows,
            };
            format!("\n\nALL-TIME · ELO · WINS / GAMES{rows}")
        }
    };
    text(
        Id::Board,
        format!(
            "LEADERBOARD · KILLS / DEATHS\n{}{all_time}",
            rows.join("\n")
        ),
    );
    // The line under the top bar: respawn, spawn shield or rapid fire.
    let weapon = match p.driver {
        14 => "UZI",
        _ => "VULCAN",
    };
    let mut hint = String::new();
    if p.destroyed > 0.0 {
        hint = format!("WRECKED · RESPAWN IN {:.0}", p.destroyed.ceil());
    }
    if !p.bomber && p.shield > 0.0 && p.destroyed <= 0.0 {
        hint = "SPAWN SHIELD".into();
    }
    if powered && active {
        let state = match p.vulcan <= 3.0 {
            true => "ENDING",
            false => "ACTIVE",
        };
        hint = format!("{weapon} {state} · {:.1}s", p.vulcan);
    }
    text(Id::Hint, hint);
    let mut toast = match p.notice_time > 0.0 {
        true => p.notice.clone(),
        false => String::new(),
    };
    if let Some(latest) = view
        .kill_feed
        .first()
        .filter(|k| view.elapsed - k.time < 3.0)
    {
        let streak = powered && p.notice_time > 0.0 && p.notice.starts_with("2-KILL");
        if !streak {
            toast = latest.text.clone();
        }
    }
    text(Id::Toast, plain(&toast));
    if !p.bomber && live && p.dizzy > 0.0 {
        text(Id::Dizzy, format!("\u{2726} DIZZY · {:.1}s", p.dizzy));
    }
    if view.special_abilities && !p.bomber && live && p.reverse_controls > 0.0 {
        text(
            Id::Dizzy,
            format!("⇄ CONTROLS REVERSED · {:.1}s", p.reverse_controls),
        );
    }
    // Missiles locked on the viewer that chaff has not yet drawn away.
    let threats = view
        .projectiles
        .iter()
        .filter(|s| {
            active
                && p.destroyed <= 0.0
                && s.kind == "missile"
                && s.target == Some(view.you)
                && s.owner != view.you
                && s.life > 0.0
                && s.decoy.is_none()
                && !s.chaffed
        })
        .count();
    if threats > 0 {
        let title = match threats {
            1 => "\u{26a0} INCOMING MISSILE",
            _ => "\u{26a0} INCOMING MISSILES",
        };
        let help = match p.chaff > 0 && p.chaff_cooldown <= 0.0 {
            true => "C / CHAFF TO BREAK THE LOCK",
            false => "EVADE THE MISSILE",
        };
        text(Id::Incoming, format!("{title}\n{help}"));
    } else if now < notices.averted {
        text(
            Id::Averted,
            "\u{2713} MISSILE AVERTED\nCHAFF BROKE THE LOCK".into(),
        );
    }
    let mut card = |id: Id, card: &Notice| {
        out.insert(
            id,
            Reading {
                text: match id {
                    Id::BridgeProgress => card.title.clone(),
                    _ => format!("{}\n{}", card.title, card.detail),
                },
                color: card.color.map(|[r, g, b]| Color::srgb_u8(r, g, b)),
                ..default()
            },
        );
    };
    if let Some(whack) = &notices.whack {
        card(Id::Whack, whack);
    }
    if let Some(ability) = &notices.ability {
        let id = match ability.card_key.as_deref() {
            Some("euler:progress") => Id::BridgeProgress,
            _ => Id::Ability,
        };
        card(id, ability);
    }
    if let Some(reward) = &notices.reward {
        card(Id::Reward, reward);
    }
    if let Some((blue, _)) = notices.ring {
        out.insert(
            Id::Ring,
            Reading {
                text: "RING OF FIRE\nKEEP TURNING · LET IT BURN".into(),
                color: Some(match blue {
                    true => Color::srgb_u8(0x4a, 0xba, 0xff),
                    false => Color::srgb_u8(0xff, 0x9a, 0x3c),
                }),
                ..default()
            },
        );
    }
    let euler_mask = notices.euler_mask(view);
    if view.phase == "racing"
        && !p.bomber
        && p.destroyed <= 0.0
        && view.arena_def.bridges.len() == 7
    {
        let count = euler_mask.count_ones();
        out.insert(
            Id::Euler,
            Reading {
                text: format!("BRIDGES  {count}/7"),
                color: Some(match count {
                    6 => Color::srgb_u8(0x9f, 0xd8, 0xf5),
                    _ => Color::srgb_u8(0xf5, 0xd7, 0x7f),
                }),
                ..default()
            },
        );
    }
    let mut status = |id: Id, text: String| {
        out.insert(id, Reading { text, ..default() });
    };
    if live && !p.bomber && p.hedge_shield > 0.0 {
        let blocks = match p.tehilim > 0.0 {
            true => "HEDGEHOGS + BOMBS BLOCKED",
            false => "MISSILES STILL HURT",
        };
        status(
            Id::Hedgeguard,
            format!("HEDGEGUARD · {:.1}s · {blocks}", p.hedge_shield),
        );
    }
    if live && !p.bomber && p.tehilim > 0.0 {
        status(
            Id::Tehilim,
            format!("TEHILIM VS TILIM · {:.1}s · MISSILE REPULSION", p.tehilim),
        );
    }
    if racing && !p.bomber && p.intelligence_bonus > 0 {
        let base = racer.map_or(0, |r| u32::from(r.intelligence));
        status(
            Id::Intelligence,
            format!(
                "INTELLIGENCE {} · +{}",
                base + p.intelligence_bonus,
                p.intelligence_bonus
            ),
        );
    }
    let mut item = match p.item.as_str() {
        "boost" => "AFTERBURNER READY".into(),
        "hedgehog" => format!("HEDGEHOG × {}", p.ammo),
        "missile" => format!("MISSILE × {} · HOMING", p.missiles),
        _ => "EMPTY · COLLECT AMMO".into(),
    };
    if powered && p.item == "hedgehog" {
        item = match p.driver {
            14 => "BAT COMPANION · AUTO UZI".into(),
            _ => "VULCAN · HOLD SPACE TO SPRAY".into(),
        };
    }
    status(Id::Item, item);
    if powered && racing {
        let animal = match p.driver {
            14 => "BATYOUDIDN'TKNOW",
            5 => "CRICKET",
            6 => "DOLLAR",
            8 => "ELECTRON",
            9 => "BALLET",
            10 => "LASER",
            _ => "HEDGEHOG",
        };
        out.insert(
            Id::Vulcan,
            Reading {
                text: format!("{animal} {weapon} · {:.1}s", p.vulcan),
                fill: Some((p.vulcan / 15.0) as f32),
                ..default()
            },
        );
    }
    if racing && p.was_drifting {
        let (label, color) = match p.drift {
            charge if charge >= 0.85 => ("SUPER BOOST READY", Color::srgb_u8(0xc8, 0x8a, 0xff)),
            charge if charge >= 0.45 => ("BOOST READY", Color::srgb_u8(0x72, 0xdc, 0xff)),
            _ => ("DRIFT CHARGING", Color::WHITE),
        };
        out.insert(
            Id::Drift,
            Reading {
                text: label.into(),
                color: Some(color),
                fill: Some((p.drift / 1.2) as f32),
                ..default()
            },
        );
    }
    // Weapon cards and action buttons: count, caption and the browser's look for
    // each state (selected, rapid fire, disabled).
    let mut card = |id: Id, count: String, text: String, usable: bool, highlight: Option<Look>| {
        let rack = matches!(id, Id::Hedgehogs | Id::Missiles | Id::Turbos);
        let look = highlight.unwrap_or(match rack {
            true => CARD,
            false => ACTION,
        });
        let fade = match (usable || highlight.is_some(), rack) {
            (true, _) => 1.0,
            (false, true) => 0.4,
            (false, false) => 0.45,
        };
        out.insert(
            id,
            Reading {
                text,
                count,
                tone: Some(look.fill.with_alpha(look.fill.alpha() * fade)),
                border: Some(look.edge.with_alpha(look.edge.alpha() * fade)),
                color: Some(look.ink.with_alpha(fade)),
                ..default()
            },
        );
    };
    let chosen = |item: &str| (p.item == item).then_some(CHOSEN);
    card(
        Id::Hedgehogs,
        match powered {
            true => "\u{221e}".into(),
            false => p.ammo.to_string(),
        },
        match powered {
            true => weapon.into(),
            false => "HEDGEHOGS".into(),
        },
        powered || p.ammo > 0,
        match powered {
            true => Some(RAPID),
            false => chosen("hedgehog"),
        },
    );
    card(
        Id::Missiles,
        p.missiles.to_string(),
        "MISSILES".into(),
        p.missiles > 0,
        chosen("missile"),
    );
    card(
        Id::Turbos,
        p.turbos.to_string(),
        match (
            p.driver == 7 && view.special_abilities,
            p.nightmare_active > 0.0,
            p.nightmare_cooldown > 0.0,
        ) {
            (true, true, _) => format!("NIGHTMARE {:.1}s", p.nightmare_active),
            (true, false, true) => format!("X · TURBO / NF {:.0}s", p.nightmare_cooldown),
            (true, false, false) => "XX · NIGHTMARE".into(),
            _ => "X · TURBO".into(),
        },
        live && (p.turbos > 0 && p.boost <= 0.0
            || p.driver == 7 && view.special_abilities && p.nightmare_cooldown <= 0.0),
        None,
    );
    card(
        Id::Chaff,
        String::new(),
        format!("C · CHAFF {}", p.chaff),
        live && p.chaff > 0 && p.chaff_cooldown <= 0.0,
        None,
    );
    card(
        Id::Flip,
        String::new(),
        match p.somersault_cooldown > 1e-8 {
            true => format!("Z · {:.1}s", p.somersault_cooldown),
            false => "Z · SOMERSAULT".into(),
        },
        live && p.somersault_cooldown <= 1e-8,
        None,
    );
    let ability = racer
        .map(|racer| racer.ability.as_str())
        .filter(|_| SPECIALISTS.contains(&p.driver) && view.special_abilities && !p.bomber);
    if let Some(ability) = ability {
        let karma_ready = p.last_killer.is_some_and(|v| {
            v != p.id
                && view
                    .actors
                    .get(v)
                    .is_some_and(|t| !t.inactive && !t.afk && !t.bomber && t.destroyed <= 0.0)
        });
        let label = match (p.special_cooldown > 0.0, p.driver, karma_ready) {
            (true, _, _) => format!("F · RECHARGE {:.1}s", p.special_cooldown),
            (false, 15, false) if p.last_killer.is_none() => format!("F · {ability} (NEEDS KO)"),
            (false, 15, false) => format!("F · {ability} (RESPAWNING)"),
            _ => format!("F · {ability}"),
        };
        let ready = live
            && p.special_cooldown <= 0.0
            && !(p.driver == 12 && p.health >= 6.0)
            && !(p.driver == 15 && !karma_ready);
        card(Id::Special, String::new(), label, ready, None);
    }
    if !voice_text.is_empty() {
        out.insert(
            Id::Voice,
            Reading {
                text: voice_text,
                tone: Some(match talking {
                    true => hex(0x1a7642ea),
                    false => hex(0x141622d4),
                }),
                border: Some(match talking {
                    true => hex(0x9bf5beff),
                    false => hex(0xbce5f377),
                }),
                color: Some(hex(0xf9f4e8ff)),
                ..default()
            },
        );
    }
    out
}

/// The browser uses the system monospace font, which on macOS is Menlo; it also
/// holds the symbols the HUD needs. We pair it with macOS Hebrew fonts so chat,
/// player names, and leaderboards render both Latin and Hebrew glyphs cleanly.
/// Keeping the handles keeps the faces loaded for as long as the UI exists.
#[derive(Resource, Clone)]
pub struct MenloFaces {
    #[expect(dead_code)]
    handles: Vec<Handle<Font>>,
    pub source: bevy::text::FontSource,
}

const SYSTEM_FONT_PATHS: &[&str] = &[
    "/System/Library/Fonts/Menlo.ttc",
    "/System/Library/Fonts/SFHebrew.ttf",
    "/System/Library/Fonts/ArialHB.ttc",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
];

pub(crate) fn load_ui_fonts(fonts: &mut Assets<Font>) -> Option<MenloFaces> {
    let mut handles = Vec::new();
    for path in SYSTEM_FONT_PATHS {
        if let Ok(bytes) = std::fs::read(path) {
            if *path == "/System/Library/Fonts/Supplemental/Arial.ttf" {
                let _ = fonts.insert(
                    AssetId::<Font>::default(),
                    Font::from_bytes(bytes.clone()),
                );
            }
            handles.push(fonts.add(Font::from_bytes(bytes)));
        }
    }
    if handles.is_empty() {
        return None;
    }
    let source = bevy::text::FontSource::List(
        handles
            .iter()
            .cloned()
            .map(bevy::text::FontSource::Handle)
            .collect(),
    );
    Some(MenloFaces { handles, source })
}

struct Style {
    size: f32,
    bold: bool,
    italic: bool,
    color: Color,
    shadow: bool,
    /// Lines are centred, as in banners and buttons, rather than set left.
    centred: bool,
}
impl Style {
    const fn new(size: f32, color: Color) -> Self {
        Self {
            size,
            bold: true,
            italic: false,
            color,
            shadow: false,
            centred: true,
        }
    }
}
/// A node with the browser's border and corner radius, both in CSS pixels.
fn boxed(node: Node, border: f32, radius: f32) -> Node {
    Node {
        border: UiRect::all(px(border * K)),
        border_radius: BorderRadius::all(px(radius * K)),
        ..node
    }
}
struct Hud<'a, 'w, 's> {
    commands: &'a mut Commands<'w, 's>,
    face: bevy::text::FontSource,
}
impl Hud<'_, '_, '_> {
    fn node(&mut self, parent: Entity, node: Node, fill: Color, edge: Color) -> Entity {
        self.commands
            .spawn((
                node,
                BackgroundColor(fill),
                BorderColor::all(edge),
                ChildOf(parent),
            ))
            .id()
    }
    fn words(&mut self, parent: Entity, text: &str, style: Style, marker: Option<Label>) {
        let mut entity = self.commands.spawn((
            Text::new(text),
            TextFont {
                font: self.face.clone(),
                font_size: bevy::text::FontSize::Px(style.size * K),
                weight: match style.bold {
                    true => bevy::text::FontWeight::BOLD,
                    false => bevy::text::FontWeight::NORMAL,
                },
                style: match style.italic {
                    true => bevy::text::FontStyle::Italic,
                    false => bevy::text::FontStyle::Normal,
                },
                ..default()
            },
            TextLayout::justify(match style.centred {
                true => Justify::Center,
                false => Justify::Left,
            }),
            TextColor(style.color),
            Ink(style.color),
            ChildOf(parent),
        ));
        if style.shadow {
            entity.insert(TextShadow {
                offset: Vec2::splat(2.0),
                color: SHADOW,
            });
        }
        if let Some(marker) = marker {
            entity.insert(marker);
        }
    }
    /// A notice centred across the viewport at a CSS `top`, hidden until it has text.
    fn banner(
        &mut self,
        root: Entity,
        id: Id,
        top: Val,
        panel: (Node, Color, Color),
        style: Style,
    ) {
        let row = self.node(
            root,
            Node {
                position_type: PositionType::Absolute,
                top,
                left: px(0),
                right: px(0),
                justify_content: JustifyContent::Center,
                ..default()
            },
            Color::NONE,
            Color::NONE,
        );
        let (node, fill, edge) = panel;
        let panel = self.node(
            row,
            Node {
                display: Display::None,
                ..node
            },
            fill,
            edge,
        );
        self.commands.entity(panel).insert(Part::Panel(id));
        self.words(panel, "", style, Some(Label::Of(id)));
    }
    fn bar(&mut self, parent: Entity, id: Id, color: Color) {
        let track = self.node(
            parent,
            Node {
                width: percent(100),
                height: px(5.0 * K),
                ..default()
            },
            hex(0xffffff2e),
            Color::NONE,
        );
        let fill = self.node(
            track,
            Node {
                height: percent(100),
                ..default()
            },
            color,
            Color::NONE,
        );
        self.commands.entity(fill).insert(Part::Fill(id));
    }
    fn button(&mut self, parent: Entity, id: Id, act: Act, node: Node, look: Look) -> Entity {
        let button = self.node(parent, node, look.fill, look.edge);
        self.commands.entity(button).insert((
            RelativeCursorPosition::default(),
            act,
            Tone(look.fill),
            Card(id),
        ));
        button
    }
}

/// Builds the browser's arena HUD once; `update` fills it in every frame.
/// Positions and sizes are the browser's CSS, scaled by `K`.
pub fn setup(mut commands: Commands, mut fonts: ResMut<Assets<Font>>) {
    let face = match load_ui_fonts(&mut fonts) {
        Some(faces) => {
            let source = faces.source.clone();
            commands.insert_resource(faces);
            source
        }
        None => bevy::text::FontSource::default(),
    };
    let white = Color::WHITE;
    let none = Color::NONE;
    let fixed = |node: Node| Node {
        position_type: PositionType::Absolute,
        ..node
    };
    let column = |node: Node| Node {
        flex_direction: FlexDirection::Column,
        ..node
    };
    let root = commands
        .spawn((
            fixed(Node {
                width: percent(100),
                height: percent(100),
                display: Display::None,
                ..default()
            }),
            Part::Root,
        ))
        .id();
    let mut ui = Hud {
        commands: &mut commands,
        face,
    };
    // .kart-nameplate: above the kart, under everything else on the HUD.
    for index in 0..SLOTS {
        let anchor = ui.node(
            root,
            fixed(Node {
                width: px(0),
                height: px(0),
                justify_content: JustifyContent::Center,
                align_items: AlignItems::End,
                display: Display::None,
                ..default()
            }),
            none,
            none,
        );
        ui.commands.entity(anchor).insert(Part::Plate(index));
        let plate = ui.node(
            anchor,
            Node {
                padding: UiRect::axes(px(7.0 * K), px(4.0 * K)),
                border: UiRect::top(px(3.0 * K)),
                border_radius: BorderRadius::all(px(5.0 * K)),
                flex_shrink: 0.0,
                ..default()
            },
            hex(0x211932dd),
            white,
        );
        ui.commands.entity(plate).insert(Part::PlateEdge(index));
        ui.words(
            plate,
            "",
            Style::new(11.0, white),
            Some(Label::Plate(index)),
        );
    }
    // .hud: kills, health and time left across the top, with no panels.
    let small = || Style {
        bold: false,
        shadow: true,
        ..Style::new(9.0, Color::WHITE)
    };
    let shadowed = |size| Style {
        shadow: true,
        ..Style::new(size, Color::WHITE)
    };
    let top = ui.node(
        root,
        fixed(Node {
            top: px(18.0 * K),
            left: px(20.0 * K),
            right: px(20.0 * K),
            column_gap: px(25.0 * K),
            ..default()
        }),
        none,
        none,
    );
    let block = |ui: &mut Hud, node: Node| {
        ui.node(
            top,
            column(Node {
                row_gap: px(4.0 * K),
                ..node
            }),
            Color::NONE,
            Color::NONE,
        )
    };
    let kills = block(
        &mut ui,
        Node {
            align_items: AlignItems::Start,
            ..default()
        },
    );
    ui.words(kills, "", shadowed(38.0), Some(Label::Of(Id::Kills)));
    ui.words(kills, "KILLS", small(), None);
    let health = block(
        &mut ui,
        Node {
            align_items: AlignItems::Start,
            ..default()
        },
    );
    ui.words(health, "HEALTH", small(), None);
    ui.words(health, "", shadowed(19.0), Some(Label::Of(Id::Health)));
    let timer = block(
        &mut ui,
        Node {
            margin: UiRect::left(Val::Auto),
            align_items: AlignItems::End,
            ..default()
        },
    );
    ui.words(timer, "TIME LEFT", small(), None);
    ui.words(timer, "", shadowed(19.0), Some(Label::Of(Id::Time)));
    // The arena map sits under the clock, as in the browser.
    let map = ui.node(
        root,
        fixed(Node {
            right: px(20.0 * K),
            top: px(70.0 * K),
            width: px(MAP_SIZE.x),
            height: px(MAP_SIZE.y),
            border_radius: BorderRadius::all(px(6.0 * K)),
            overflow: Overflow::clip(),
            ..default()
        }),
        hex(0xe5e0d9d8),
        none,
    );
    for index in 0..MAP_WATER_SLOTS {
        let water = ui.node(map, fixed(Node::default()), hex(0x4f8cb5ff), none);
        ui.commands.entity(water).insert(Part::MapWater(index));
    }
    for index in 0..MAP_BRIDGE_SLOTS {
        let bridge = ui.node(map, fixed(Node::default()), hex(0xc48f52ff), none);
        ui.commands.entity(bridge).insert(Part::MapBridge(index));
    }
    for index in 0..MAP_BLOCK_SLOTS {
        let block = ui.node(map, fixed(Node::default()), hex(0x92839dff), none);
        ui.commands.entity(block).insert(Part::MapBlock(index));
    }
    for index in 0..SLOTS {
        let dot = ui.node(
            map,
            fixed(Node {
                border_radius: BorderRadius::MAX,
                ..default()
            }),
            white,
            none,
        );
        ui.commands.entity(dot).insert(Part::MapDot(index));
    }
    // The browser shows the leaderboard beside the game; here it sits under the map.
    let board = ui.node(
        root,
        fixed(boxed(
            Node {
                right: px(20.0 * K),
                top: px(70.0 * K + MAP_SIZE.y + 8.0 * K),
                padding: UiRect::all(px(8.0 * K)),
                ..default()
            },
            1.0,
            8.0,
        )),
        hex(0x202336b8),
        hex(0xffffff30),
    );
    ui.words(
        board,
        "",
        Style {
            bold: false,
            centred: false,
            ..Style::new(9.0, white)
        },
        Some(Label::Of(Id::Board)),
    );
    // Notices, each at the browser's own height.
    let pad = |x: f32, y: f32| Node {
        padding: UiRect::axes(px(x * K), px(y * K)),
        ..default()
    };
    ui.banner(
        root,
        Id::Whack,
        percent(6),
        (
            boxed(pad(22.0, 10.0), 3.0, 15.0),
            hex(0xfff0d8ff),
            hex(0xffdc6aff),
        ),
        Style::new(22.0, hex(0x5829a4ff)),
    );
    ui.banner(
        root,
        Id::Voice,
        px(12.0 * K),
        (
            boxed(pad(14.0, 6.0), 1.0, 999.0),
            hex(0x141622d4),
            hex(0xbce5f377),
        ),
        Style::new(11.0, hex(0xf9f4e8ff)),
    );
    ui.banner(
        root,
        Id::Hint,
        percent(15),
        (pad(0.0, 0.0), none, none),
        Style {
            shadow: true,
            ..Style::new(12.0, hex(0xfff0afff))
        },
    );
    ui.banner(
        root,
        Id::Ring,
        percent(17),
        (
            boxed(pad(22.0, 9.0), 1.0, 8.0),
            hex(0x32120dc0),
            hex(0xff9b3c99),
        ),
        Style::new(15.0, white),
    );
    ui.banner(
        root,
        Id::Toast,
        percent(19),
        (pad(0.0, 0.0), none, none),
        Style {
            shadow: true,
            ..Style::new(14.0, white)
        },
    );
    ui.banner(
        root, Id::BridgeProgress, percent(23),
        (boxed(pad(9.0, 4.0), 1.0, 8.0), hex(0x163047ec), hex(0x9fd8f5ff)),
        Style::new(12.0, white),
    );
    for id in [Id::Ability, Id::Reward] {
        ui.banner(
            root,
            id,
            percent(23),
            (
                boxed(
                    Node {
                        max_width: percent(90),
                        ..pad(16.0, 8.0)
                    },
                    1.0,
                    9.0,
                ),
                hex(0x232955e6),
                hex(0xffffff40),
            ),
            Style::new(18.0, white),
        );
        // Ported HTML/CSS announcement card (shown instead of the flat banner when WWUP textures are present).
        let row = ui.node(
            root,
            fixed(Node {
                display: Display::None,
                top: percent(match id {
                    Id::Ability => 13,
                    _ => 18,
                }),
                left: px(0),
                right: px(0),
                justify_content: JustifyContent::Center,
                ..default()
            }),
            none,
            none,
        );
        ui.commands.entity(row).insert(Part::HtmlCard(id));
        let card = ui.node(
            row,
            Node {
                position_type: PositionType::Relative,
                ..default()
            },
            none,
            none,
        );
        ui.commands
            .entity(card)
            .insert((ImageNode::default(), HtmlCardArt(id)));
        let detail = ui.node(
            card,
            fixed(Node {
                justify_content: JustifyContent::Center,
                align_items: AlignItems::Center,
                ..default()
            }),
            none,
            none,
        );
        ui.words(
            detail,
            "",
            Style {
                bold: true,
                shadow: true,
                ..Style::new(12.5, hex(0xf4eaffff))
            },
            Some(Label::CardDetail(id)),
        );
        if id == Id::Ability {
            for side in 0..2 {
                let chip = ui.node(card, fixed(Node {
                    display: Display::None, width: px(40. * K), height: px(23. * K),
                    border_radius: BorderRadius::MAX, justify_content: JustifyContent::Center,
                    align_items: AlignItems::Center, ..default()
                }), hex(0x203a35ff), none);
                ui.commands.entity(chip).insert(Part::KarmaScore(side));
                let ink = [0xa9ffdcff, 0xffe5a2ff][side];
                ui.words(chip, "", Style::new(16., hex(ink)), Some(Label::KarmaScore(side)));
            }
        }
        for spark_i in 0..10 {
            let spark = ui.node(
                card,
                fixed(Node {
                    display: Display::None,
                    width: px(6.0),
                    height: px(6.0),
                    border_radius: BorderRadius::MAX,
                    ..default()
                }),
                hex(0xfff3adff),
                none,
            );
            ui.commands.entity(spark).insert(Part::CardSpark(id, spark_i));
        }
    }
    ui.banner(
        root,
        Id::Euler,
        px(16.0 * K),
        (
            boxed(pad(12.0, 5.0), 1.5, 8.0),
            hex(0x163047d8),
            hex(0xf5d77faa),
        ),
        Style::new(13.0, hex(0xf5d77fff)),
    );
    ui.banner(
        root,
        Id::Incoming,
        percent(31),
        (
            boxed(pad(18.0, 11.0), 2.0, 9.0),
            hex(0x721e20f5),
            hex(0xffad80ff),
        ),
        Style::new(14.0, hex(0xfff4dfff)),
    );
    ui.banner(
        root,
        Id::Averted,
        percent(31),
        (
            boxed(pad(9.0, 5.0), 1.0, 9.0),
            hex(0x14573566),
            hex(0x99efad88),
        ),
        Style::new(12.0, hex(0xeffff1ff)),
    );
    // .dizzy-notice
    let dizzy = ui.node(
        root,
        fixed(boxed(
            Node {
                top: px(100.0 * K),
                left: px(20.0 * K),
                padding: UiRect::axes(px(10.0 * K), px(6.0 * K)),
                display: Display::None,
                ..default()
            },
            1.0,
            7.0,
        )),
        hex(0x39592b88),
        hex(0xdcefa888),
    );
    ui.commands.entity(dizzy).insert(Part::Panel(Id::Dizzy));
    ui.words(
        dizzy,
        "",
        Style::new(12.0, hex(0xefffd4ff)),
        Some(Label::Of(Id::Dizzy)),
    );
    // .drift-meter
    let amber = hex(0xffd18dff);
    let drift = ui.node(
        root,
        fixed(boxed(
            column(Node {
                bottom: px(135.0 * K),
                right: px(20.0 * K),
                width: px(180.0 * K),
                padding: UiRect::all(px(10.0 * K)),
                row_gap: px(5.0 * K),
                display: Display::None,
                ..default()
            }),
            1.0,
            9.0,
        )),
        hex(0x252437e8),
        hex(0xfbb369ff),
    );
    ui.commands.entity(drift).insert(Part::Panel(Id::Drift));
    ui.words(
        drift,
        "",
        Style::new(10.0, amber),
        Some(Label::Of(Id::Drift)),
    );
    ui.bar(drift, Id::Drift, hex(0xfbb369ff));
    ui.words(
        drift,
        "RELEASE DRIFT TO BOOST",
        Style {
            bold: false,
            ..Style::new(8.0, amber)
        },
        None,
    );
    // .chaff-button and its variants share one shape.
    let action = |width: f32| {
        boxed(
            Node {
                width: px(width * K),
                min_height: px(44.0 * K),
                padding: UiRect::axes(px(5.0 * K), px(10.0 * K)),
                justify_content: JustifyContent::Center,
                align_items: AlignItems::Center,
                ..default()
            },
            1.0,
            8.0,
        )
    };
    let label = || Style::new(11.0, ACTION.ink);
    // .somersault-button, above the item box.
    let flip = ui.button(
        root,
        Id::Flip,
        Act::Game(ClientAction::Somersault),
        fixed(Node {
            left: px(20.0 * K),
            bottom: px(150.0 * K),
            ..action(152.0)
        }),
        ACTION,
    );
    ui.words(flip, "", label(), Some(Label::Of(Id::Flip)));
    // .item-box: status lines, the rapid-fire timer, the ammo rack and the item line.
    let item = ui.node(
        root,
        fixed(boxed(
            column(Node {
                left: px(20.0 * K),
                bottom: px(18.0 * K),
                padding: UiRect::all(px(10.0 * K)),
                row_gap: px(6.0 * K),
                align_items: AlignItems::Start,
                ..default()
            }),
            1.0,
            12.0,
        )),
        hex(0x202336d9),
        hex(0xffffff45),
    );
    for (id, color) in [
        (Id::Intelligence, hex(0xd9c8ffff)),
        (Id::Tehilim, hex(0xbcd4ffff)),
        (Id::Hedgeguard, hex(0xa9f5eaff)),
        (Id::Vulcan, hex(0xffda85ff)),
    ] {
        let line = ui.node(
            item,
            column(Node {
                row_gap: px(4.0 * K),
                align_self: AlignSelf::Stretch,
                align_items: AlignItems::Start,
                display: Display::None,
                ..default()
            }),
            none,
            none,
        );
        ui.commands.entity(line).insert(Part::Panel(id));
        ui.words(line, "", Style::new(10.0, color), Some(Label::Of(id)));
        if id == Id::Vulcan {
            ui.bar(line, id, hex(0xffbd58ff));
        }
    }
    let rack = ui.node(
        item,
        Node {
            column_gap: px(7.0 * K),
            ..default()
        },
        none,
        none,
    );
    for (id, action) in [
        (Id::Hedgehogs, ClientAction::SelectHedgehog),
        (Id::Missiles, ClientAction::SelectMissile),
        (Id::Turbos, ClientAction::Boost),
    ] {
        let card = ui.button(
            rack,
            id,
            Act::Game(action),
            boxed(
                column(Node {
                    width: px(82.0 * K),
                    min_height: px(65.0 * K),
                    padding: UiRect::axes(px(8.0 * K), px(6.0 * K)),
                    align_items: AlignItems::Center,
                    justify_content: JustifyContent::Center,
                    ..default()
                }),
                1.0,
                7.0,
            ),
            CARD,
        );
        ui.words(card, "", Style::new(34.0, CARD.ink), Some(Label::Count(id)));
        ui.words(card, "", Style::new(8.0, CARD.ink), Some(Label::Of(id)));
    }
    ui.words(item, "", Style::new(10.0, white), Some(Label::Of(Id::Item)));
    ui.words(
        item,
        "SPACE TO FIRE · TAB / Q / \u{2318} WEAPONS · X TURBO",
        Style {
            bold: false,
            ..Style::new(8.0, white)
        },
        None,
    );
    // .special-button and .chaff-button on the right.
    for (id, act, bottom, width) in [
        (Id::Special, ClientAction::Special, 177.0, 190.0),
        (Id::Chaff, ClientAction::Chaff, 125.0, 112.0),
    ] {
        let button = ui.button(
            root,
            id,
            Act::Game(act),
            fixed(Node {
                right: px(20.0 * K),
                bottom: px(bottom * K),
                ..action(width)
            }),
            ACTION,
        );
        ui.words(button, "", label(), Some(Label::Of(id)));
    }
    // .pause: the browser's AFK button, with the menu beside it.
    let corner = ui.node(
        root,
        fixed(Node {
            right: px(22.0 * K),
            bottom: px(75.0 * K),
            column_gap: px(6.0 * K),
            ..default()
        }),
        none,
        none,
    );
    for (text, act) in [("MENU", Act::Menu), ("AFK", Act::SitOut)] {
        let fill = hex(0x28273866);
        let pause = ui.node(
            corner,
            boxed(
                Node {
                    padding: UiRect::axes(px(10.0 * K), px(6.0 * K)),
                    ..default()
                },
                1.0,
                5.0,
            ),
            fill,
            hex(0xffffff77),
        );
        ui.commands
            .entity(pause)
            .insert((RelativeCursorPosition::default(), act, Tone(fill)));
        ui.words(
            pause,
            text,
            Style {
                bold: false,
                ..Style::new(11.0, white)
            },
            None,
        );
    }
    // #speed
    let speed = ui.node(
        root,
        fixed(Node {
            right: px(20.0 * K),
            bottom: px(18.0 * K),
            align_items: AlignItems::Baseline,
            column_gap: px(5.0 * K),
            ..default()
        }),
        none,
        none,
    );
    ui.words(
        speed,
        "",
        Style {
            italic: true,
            shadow: true,
            ..Style::new(36.0, white)
        },
        Some(Label::Of(Id::Speed)),
    );
    ui.words(speed, "KM/H", small(), None);
}

type Nodes<'w, 's> = Query<
    'w,
    's,
    (
        &'static Part,
        &'static mut Node,
        &'static mut BackgroundColor,
        &'static mut BorderColor,
    ),
    Without<Card>,
>;
type Cards<'w, 's> = Query<
    'w,
    's,
    (
        &'static Card,
        &'static mut Tone,
        &'static mut BorderColor,
        &'static mut Node,
    ),
>;
type Labels<'w, 's> = Query<
    'w,
    's,
    (
        &'static Label,
        &'static Ink,
        &'static mut Text,
        &'static mut TextColor,
    ),
>;
type Lens<'w, 's> = Query<'w, 's, (&'static Camera, &'static GlobalTransform), With<FollowCamera>>;

type HtmlArt<'w, 's> = Query<
    'w,
    's,
    (&'static HtmlCardArt, &'static mut ImageNode, &'static mut Node, &'static Children),
    (Without<Part>, Without<Card>),
>;
type DetailBoxes<'w, 's> = Query<'w, 's, &'static mut Node, (Without<Part>, Without<Card>, Without<HtmlCardArt>)>;

fn notice_for(notices: &Notices, id: Id) -> Option<&Notice> {
    match id {
        Id::Ability => notices.ability.as_ref(),
        Id::Reward => notices.reward.as_ref(),
        _ => None,
    }
}

/// Replay the nine ported silhouettes forward and backward before the card fades.
fn wormhole_morph_frame(elapsed: f64) -> usize {
    let step = ((elapsed - 0.24) / 0.11).round().clamp(0., 16.) as usize;
    step.min(16 - step)
}

/// Evaluates the browser's `@keyframes reward-arrive` vertical offset and opacity.
fn card_motion(notice: &Notice, now: f64) -> (f32, f32) {
    let span = (notice.until - notice.started).max(0.01);
    let p = ((now - notice.started) / span).clamp(0.0, 1.0) as f32;
    if p < 0.12 {
        let t = p / 0.12;
        (15.0 * (1.0 - t), t)
    } else if p < 0.22 {
        let t = (p - 0.12) / 0.10;
        (-3.0 * (1.0 - t), 1.0)
    } else if p <= 0.84 {
        (0.0, 1.0)
    } else {
        let t = (p - 0.84) / 0.16;
        (-22.0 * t, (1.0 - t).max(0.0))
    }
}

#[allow(clippy::too_many_arguments)]
pub fn update(
    session: Res<GameSession>,
    menu: Res<Menu>,
    graphics: Res<Graphics>,
    ui_cards: Res<UiCards>,
    time: Res<Time>,
    mut notices: ResMut<Notices>,
    cameras: Lens,
    mut nodes: Nodes,
    mut labels: Labels,
    mut cards: Cards,
    mut html_art: HtmlArt,
    mut detail_boxes: DetailBoxes,
) {
    let view = session.client.as_ref().map(|client| client.view());
    let Some(view) = view.filter(|_| menu.screen(&session) == Screen::Playing) else {
        for (part, mut node, ..) in &mut nodes {
            if *part == Part::Root && node.display != Display::None {
                node.display = Display::None;
            }
        }
        if session.client.is_none() {
            *notices = Notices::default();
        }
        return;
    };
    let now = time.elapsed_secs_f64();
    notices.sample(&view, &graphics, now);
    let talking = session.voice.is_talking();
    let voice_error = session.voice.error();
    let mut voice_parts = Vec::new();
    if talking {
        if !session.voice.is_socket_ready() {
            voice_parts.push("MIC LIVE (VOICE RECONNECTING...)".to_owned());
        } else if let Some(err) = &voice_error {
            voice_parts.push(format!("MIC LIVE · {err}"));
        } else {
            voice_parts.push("MIC LIVE".to_owned());
        }
    }
    let speaker_names: Vec<_> = session
        .voice
        .active_speakers()
        .into_iter()
        .filter_map(|id| {
            view.actors
                .iter()
                .find(|a| a.id == id)
                .and_then(|a| a.name.clone())
        })
        .collect();
    if !speaker_names.is_empty() {
        voice_parts.push(format!("VOICE: {}", speaker_names.join(", ")));
    }
    if voice_parts.is_empty()
        && let Some(err) = voice_error
    {
        voice_parts.push(format!("MIC: {err}"));
    }
    let readings = readings(
        &view,
        &graphics,
        &notices,
        now,
        session.board.as_deref(),
        voice_parts.join(" · "),
        talking,
    );
    let dark = crate::scene::dark_humor(&view).0 > 0.0;
    // Rivals far enough away to need a name, where the camera can see them.
    let mut plates = Vec::new();
    if let Ok((camera, lens)) = cameras.single() {
        let eye = lens.translation();
        for a in view.actors.iter().filter(|a| a.id != view.you) {
            let near = (a.wx - view.player.wx).hypot(a.wz - view.player.wz) < 28.0;
            let absent = a.bomber || a.destroyed > 0.0 || a.inactive || a.afk;
            if dark || absent || near || !matches!(view.phase, "racing" | "paused") {
                continue;
            }
            let jump = crate::scene::somersault(a.driver, a.somersault).0;
            if hidden(&view, eye, a.wx, a.wz, 2.0 + jump) {
                continue;
            }
            let above = Vec3::new(a.wx as f32, 7.2 + jump, a.wz as f32);
            if let Ok(at) = camera.world_to_viewport(lens, above) {
                let racer = graphics.racers().get(a.driver);
                let name = a.name.as_deref().or(racer.map(|r| r.name.as_str()));
                let color = tint(&a.color)
                    .or(racer.map(|r| r.color))
                    .unwrap_or([255; 3]);
                plates.push((at, name.unwrap_or("Racer").to_owned(), color));
            }
        }
    }
    let dots: Vec<_> = view
        .actors
        .iter()
        .filter(|a| !a.bomber && a.destroyed <= 0.0 && !a.afk && !a.inactive)
        .collect();
    let show = |node: &mut Node, shown: bool| {
        let display = match shown {
            true => Display::Flex,
            false => Display::None,
        };
        if node.display != display {
            node.display = display;
        }
    };
    let center = MAP_SIZE / 2.0;
    for (part, mut node, mut color, mut edge) in &mut nodes {
        match *part {
            Part::Root => show(&mut node, true),
            Part::Panel(id) => {
                let uses_html = notice_for(&notices, id)
                    .and_then(|n| n.card_key.as_deref())
                    .and_then(|k| ui_cards.get(k))
                    .is_some();
                show(
                    &mut node,
                    !uses_html && readings.get(&id).is_some_and(|r| !r.text.is_empty()),
                );
            }
            Part::HtmlCard(id) => {
                let active_card = notice_for(&notices, id).and_then(|n| {
                    n.card_key
                        .as_deref()
                        .and_then(|k| ui_cards.get(k))
                        .map(|c| (n, c))
                });
                show(&mut node, active_card.is_some());
                if let Some((notice, _)) = active_card {
                    let (dy, _) = card_motion(notice, now);
                    node.margin = UiRect::top(px(dy * K));
                }
            }
            Part::KarmaScore(side) => {
                let active = notices.ability.as_ref().filter(|n| n.score_swap.is_some())
                    .zip(ui_cards.get("ability:15"));
                show(&mut node, active.is_some());
                if let Some((notice, art)) = active {
                    let t = ((now - notice.started - 0.275) / 0.825).clamp(0., 1.) as f32;
                    let ease = t * t * (3. - 2. * t);
                    let direction = [1., -1.][side];
                    let offset = direction * (ease - 0.5) * 52.;
                    node.left = px((art.logical_w * 0.41 + offset - 20.) * K);
                    node.top = px(((art.detail_top + art.detail_h) * 0.82 + 10.
                        - direction * (ease * std::f32::consts::PI).sin() * 10.) * K);
                }
            }
            Part::CardSpark(id, index) => {
                let active_card = notice_for(&notices, id).and_then(|n| {
                    n.card_key
                        .as_deref()
                        .and_then(|k| ui_cards.get(k))
                        .map(|c| (n, c))
                });
                let spark = active_card.and_then(|(notice, ported)| {
                    let elapsed = (now - notice.started) as f32;
                    let s = (elapsed - 0.15) / 1.0;
                    (0.0..=1.0).contains(&s).then(|| {
                        let scale = K * 0.82;
                        let ease = 1.0 - (1.0 - s).powi(2);
                        let angle = (index as f32) * 36.0_f32.to_radians();
                        let dist = (15.0 + ease * (ported.logical_w * 0.36)) * scale;
                        let cx = ported.logical_w * 0.5 * scale;
                        let cy = ported.logical_h * 0.5 * scale;
                        (cx + angle.cos() * dist - 3.0, cy + angle.sin() * dist - 3.0, 1.0 - s)
                    })
                });
                show(&mut node, spark.is_some());
                if let Some((x, y, alpha)) = spark {
                    (node.left, node.top) = (px(x), px(y));
                    color.0 = Color::srgba(1.0, 0.953, 0.678, alpha);
                }
            }
            Part::Fill(id) => {
                let fill = readings.get(&id).and_then(|r| r.fill).unwrap_or(0.0);
                node.width = percent(fill.clamp(0.0, 1.0) * 100.0);
            }
            Part::MapWater(index) => {
                let rect = view.arena_def.water.get(index).copied().or_else(|| {
                    index
                        .checked_sub(view.arena_def.water.len())
                        .and_then(|bi| view.arena_def.bridges.get(bi))
                        .map(|b| [b[0], b[1], b[2], b[3]])
                });
                show(&mut node, rect.is_some());
                if let Some([x, z, w, d]) = rect {
                    let size = Vec2::new(w as f32, d as f32) * MAP_SCALE;
                    let corner = center + Vec2::new(x as f32, z as f32) * MAP_SCALE - size / 2.0;
                    (node.left, node.top) = (px(corner.x), px(corner.y));
                    (node.width, node.height) = (px(size.x), px(size.y));
                }
            }
            Part::MapBridge(index) => {
                let bridge = view.arena_def.bridges.get(index);
                show(&mut node, bridge.is_some());
                if let Some(&[x, z, w, d, axis]) = bridge {
                    let (bw, bd) = if axis == 1.0 {
                        (w + 2.0, (d - 2.0).max(2.0))
                    } else {
                        ((w - 2.0).max(2.0), d + 2.0)
                    };
                    let size = Vec2::new(bw as f32, bd as f32) * MAP_SCALE;
                    let corner = center + Vec2::new(x as f32, z as f32) * MAP_SCALE - size / 2.0;
                    (node.left, node.top) = (px(corner.x), px(corner.y));
                    (node.width, node.height) = (px(size.x), px(size.y));
                    let mask = notices.euler_mask(&view);
                    color.0 = if mask & (1u16 << index) != 0 {
                        hex(0x5ce4c0ff)
                    } else {
                        hex(0xc48f52ff)
                    };
                }
            }
            Part::MapBlock(index) => {
                let block = view.blocks.get(index);
                show(&mut node, block.is_some());
                if let Some([x, z, w, d]) = block {
                    let size = Vec2::new(*w as f32, *d as f32) * MAP_SCALE;
                    let corner = center + Vec2::new(*x as f32, *z as f32) * MAP_SCALE - size / 2.0;
                    (node.left, node.top) = (px(corner.x), px(corner.y));
                    (node.width, node.height) = (px(size.x), px(size.y));
                }
            }
            Part::MapDot(index) => {
                let actor = dots.get(index);
                show(&mut node, actor.is_some());
                if let Some(a) = actor {
                    let radius = match a.id == view.you {
                        true => 4.0,
                        false => 3.0,
                    };
                    let at = center + Vec2::new(a.wx as f32, a.wz as f32) * MAP_SCALE;
                    (node.left, node.top) = (px(at.x - radius), px(at.y - radius));
                    (node.width, node.height) = (px(radius * 2.0), px(radius * 2.0));
                    let [r, g, b] = tint(&a.color).unwrap_or([255; 3]);
                    color.0 = Color::srgb_u8(r, g, b);
                }
            }
            Part::PlateEdge(index) => {
                if let Some((_, _, [r, g, b])) = plates.get(index) {
                    edge.set_if_neq(BorderColor::all(Color::srgb_u8(*r, *g, *b)));
                }
            }
            Part::Plate(index) => {
                let plate = plates.get(index);
                show(&mut node, plate.is_some());
                if let Some((at, ..)) = plate {
                    (node.left, node.top) = (px(at.x), px(at.y));
                }
            }
        }
    }
    for (label, ink, mut text, mut color) in &mut labels {
        let (value, tinted) = match *label {
            Label::Of(id) => {
                let reading = readings.get(&id);
                (
                    reading.map_or("", |r| r.text.as_str()),
                    reading.and_then(|r| r.color),
                )
            }
            Label::Count(id) => {
                let reading = readings.get(&id);
                (
                    reading.map_or("", |r| r.count.as_str()),
                    reading.and_then(|r| r.color),
                )
            }
            Label::Plate(index) => match plates.get(index) {
                Some((_, name, _)) => (name.as_str(), None),
                None => ("", None),
            },
            Label::KarmaScore(side) => (
                notices.ability.as_ref().and_then(|n| n.score_swap.as_ref())
                    .map_or("", |scores| scores[side].as_str()), None,
            ),
            Label::CardDetail(id) => match notice_for(&notices, id) {
                // The fixed two-line Karma card includes its large caption in the HTML artwork.
                Some(notice) if notice.card_key.as_deref() == Some("ability:15") => ("", None),
                Some(notice) => {
                    let (_, alpha) = card_motion(notice, now);
                    (
                        notice.detail.as_str(),
                        Some(Color::srgba(0.957, 0.918, 1.0, alpha)),
                    )
                }
                None => ("", None),
            },
        };
        if text.0 != value {
            text.0 = value.to_owned();
        }
        let tinted = tinted.unwrap_or(ink.0);
        if color.0 != tinted {
            color.0 = tinted;
        }
    }
    for (art, mut image, mut node, children) in &mut html_art {
        let active_card = notice_for(&notices, art.0).and_then(|n| {
            let key = n.card_key.as_deref()?;
            if key == "ability:8:wormhole" {
                let frame = wormhole_morph_frame(now - n.started);
                if frame > 0 {
                    return ui_cards.get(&format!("{key}:{frame}")).map(|c| (n, c));
                }
            }
            ui_cards.get(key).map(|c| (n, c))
        });
        if let Some((notice, ported)) = active_card {
            let scale = K * 0.82;
            let (_, alpha) = card_motion(notice, now);
            if image.image != ported.image {
                image.image = ported.image.clone();
            }
            image.color = Color::srgba(1.0, 1.0, 1.0, alpha);
            (node.width, node.height) = (px(ported.logical_w * scale), px(ported.logical_h * scale));
            if let Some(&detail_entity) = children.first()
                && let Ok(mut detail_node) = detail_boxes.get_mut(detail_entity)
            {
                detail_node.left = px(ported.detail_left * scale);
                detail_node.top = px(ported.detail_top * scale);
                detail_node.width = px(ported.detail_w * scale);
                detail_node.height = px(ported.detail_h * scale);
            }
        }
    }
    for (card, mut tone, mut edge, mut node) in &mut cards {
        let reading = readings.get(&card.0);
        let wanted = reading.and_then(|r| r.tone).unwrap_or(ACTION.fill);
        if tone.0 != wanted {
            tone.0 = wanted;
        }
        edge.set_if_neq(BorderColor::all(
            reading.and_then(|r| r.border).unwrap_or(ACTION.edge),
        ));
        // A selected card has the browser's thicker border.
        let chosen = reading.is_some_and(|r| r.border == Some(CHOSEN.edge));
        let width = px(match chosen {
            true => 2.0 * K,
            false => K,
        });
        if node.border.left != width {
            node.border = UiRect::all(width);
        }
        show(&mut node, reading.is_some());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wormhole_morph_returns_to_the_cup_before_fadeout() {
        assert_eq!(wormhole_morph_frame(0.), 0);
        assert_eq!(wormhole_morph_frame(0.68), 4);
        assert_eq!(wormhole_morph_frame(1.12), 8);
        assert_eq!(wormhole_morph_frame(1.56), 4);
        assert_eq!(wormhole_morph_frame(2.0), 0);
        assert_eq!(wormhole_morph_frame(2.4), 0);
    }

    #[test]
    fn emoji_are_dropped_and_symbols_kept() {
        assert_eq!(plain("Elon \u{2192} YOU"), "Elon \u{2192} YOU");
        assert_eq!(plain("\u{1F6B2} INTELLIGENCE  UP"), "INTELLIGENCE UP");
    }

    #[test]
    fn the_race_clock_counts_minutes_seconds_and_hundredths() {
        assert_eq!(clock(151.5), "02:31.50");
        assert_eq!(clock(9.256), "00:09.26");
        assert_eq!(clock(-3.0), "00:00.00");
    }

    #[test]
    fn all_time_rows_shows_top_eight_and_appends_the_viewer_when_ranked_lower() {
        let board: Vec<(String, f64, u64, u64)> = (1..=12)
            .map(|i| (format!("Player {i}"), 1200.0 - (i as f64) * 10.0, 13 - i, 20))
            .collect();
        let top = all_time_rows(&board, Some("Player 3"), ALL_TIME_ROWS);
        assert_eq!(top.len(), 8);
        assert!(top[2].you);
        assert_eq!(top[2].rank, 3);
        let with_low_viewer = all_time_rows(&board, Some("player 11"), ALL_TIME_ROWS);
        assert_eq!(with_low_viewer.len(), 9);
        let last = with_low_viewer.last().unwrap();
        assert_eq!(last.rank, 11);
        assert_eq!(last.name, "Player 11");
        assert_eq!(last.rating, 1090);
        assert!(last.you);
        assert_eq!(
            player_elo(&board, Some("Player 11")),
            Some((11, 1090, 2, 20))
        );
    }
}
