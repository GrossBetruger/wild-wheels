//! The in-match HUD: everything the browser client shows over the arena.
//! Labels, enabling rules and notice timing mirror `client/game.js` and `ui/`;
//! racer names, ability names and announcement cards come from the ported pack.
use crate::{
    app::GameSession,
    gui::{Act, BUTTON, Builder, GOLD, MUTED, Menu, PANEL, SELECTED, Screen, Tone},
    ported::{Graphics, tint},
    scene::FollowCamera,
};
use bevy::{prelude::*, ui::RelativeCursorPosition};
use std::collections::{HashMap, HashSet, VecDeque};
use wild_wheels_core::{ClientAction, ClientView};

/// Racers whose special ability the browser offers a button for.
const SPECIALISTS: [usize; 8] = [5, 7, 8, 9, 11, 12, 13, 14];
const DISABLED: Color = Color::srgba(0.12, 0.11, 0.18, 0.75);
const POWERED: Color = Color::srgb(0.72, 0.45, 0.12);
const ALERT: Color = Color::srgba(0.55, 0.08, 0.10, 0.92);
const CLEAR: Color = Color::srgba(0.08, 0.36, 0.22, 0.92);
const HEART: Color = Color::srgb(0.95, 0.36, 0.48);
const EMPTY_HEART: Color = Color::srgba(1.0, 1.0, 1.0, 0.16);
const MAX_HEALTH: usize = 6;
const MAP_SCALE: f32 = 0.6;
const MAP_SIZE: Vec2 = Vec2::new(124.0, 120.0);
const SLOTS: usize = 8;

/// One piece of text the HUD keeps up to date; an empty reading hides its panel.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum Id {
    Kills,
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
}
/// A node the HUD shows, hides, moves or recolors.
#[derive(Component, Clone, Copy, PartialEq, Debug)]
pub enum Part {
    Root,
    Panel(Id),
    /// The filled length of a progress bar.
    Fill(Id),
    Heart(usize),
    MapBlock(usize),
    MapDot(usize),
    /// Anchors a rival's nameplate above their kart.
    Plate(usize),
}
#[derive(Component, Clone, Copy, PartialEq, Debug)]
pub enum Label {
    Of(Id),
    /// The large number on a weapon card.
    Count(Id),
    Plate(usize),
}
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
}

/// A timed announcement: shown from when it is sampled until `until`.
#[derive(Clone, Debug, PartialEq)]
struct Notice {
    title: String,
    detail: String,
    color: Option<[u8; 3]>,
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
    abilities: HashMap<usize, (usize, f64, f64, f64)>,
    ability: Option<Notice>,
    intelligence: Option<u32>,
    reward: Option<Notice>,
}
impl Notices {
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
                    (true, _) => "CO-WHACKED",
                    (false, true) => "YOU CHERNOWHACKED",
                    _ => "YOU WHACKED",
                }
                .into(),
                detail: match victim.is_some_and(|v| v.driver == 10) {
                    true => format!("\"{}\"\nhe's unimpressed...", kill.victim_name),
                    false => format!("\"{}\"", kill.victim_name),
                },
                color: tint(&kill.victim_color),
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
        for a in view.actors {
            let state = (a.driver, a.special_cooldown, a.boost, a.somersault_cooldown);
            let before = self.abilities.insert(a.id, state);
            let Some(before) = before.filter(|before| before.0 == a.driver) else {
                continue;
            };
            let absent = a.inactive || a.afk || a.destroyed > 0.0 || a.bomber;
            if !racing || !view.special_abilities || absent {
                continue;
            }
            let racer = graphics.racers().get(a.driver);
            let own = |title: &str, detail: &str, color: [u8; 3]| {
                Some((title.to_owned(), detail.to_owned(), color))
            };
            let mut card = None;
            if state.1 > before.1 + 1.0 || (a.driver == 10 && state.2 > before.2 + 0.3) {
                card = racer
                    .filter(|racer| !racer.card.0.is_empty())
                    .map(|racer| racer.card.clone());
            }
            if a.driver == 5 && state.3 > before.3 + 0.3 {
                card = own("CRICKET'S JUMP", "NOW YOU SEE HER...", [0xb7, 0xf3, 0x5b]);
            }
            if card.is_some() && a.driver == 13 && a.special_active > 0.0 {
                card = own(
                    "XYLOPHONE-ATTACK",
                    "A VERY TAXING PERFORMANCE",
                    [0xff, 0xf2, 0x9b],
                );
            }
            let Some((mut title, detail, color)) = card else {
                continue;
            };
            if a.driver == 8 && a.id != view.you {
                title = "TIME DILATION".into();
            }
            let who = match a.id == view.you {
                true => "YOU",
                false => a.name.as_deref().unwrap_or("RIVAL"),
            };
            let event = Notice {
                title,
                detail: format!("{who}  {detail}"),
                color: Some(color),
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
            || !view.special_abilities
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
                title: format!("INTELLIGENCE UP!  {} > {}", base + before, base + bonus),
                detail: "BICYCLE COLLECTED  CARRY MORE ITEMS".into(),
                color: Some([0xc6, 0xad, 0xff]),
                until: now + 3.0,
            });
        }
        self.intelligence = Some(bonus.max(self.intelligence.unwrap_or(0)));
        if self.reward.as_ref().is_some_and(|c| now >= c.until) {
            self.reward = None;
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
/// Server and game text with the symbols the built-in font lacks replaced, so a
/// kill feed line such as "Elon [skull] YOU" reads "Elon > YOU" instead of showing a blank box.
pub fn plain(text: &str) -> String {
    let words: Vec<_> = text
        .split_whitespace()
        .map(
            |word| match word.chars().all(|c| c.is_ascii() || c.is_alphanumeric()) {
                true => word,
                false => ">",
            },
        )
        .collect();
    words.join(" ")
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
        if (point.y < 6.0 && walled) || (point.y < 5.0 && (x.abs() > 96.0 || z.abs() > 96.0)) {
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
    text(Id::Speed, format!("{:.0} KM/H", (p.speed * 0.24).round()));
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
    text(
        Id::Board,
        format!("LEADERBOARD  KILLS / DEATHS\n{}", rows.join("\n")),
    );
    // The line under the top bar: respawn, spawn shield or rapid fire.
    let weapon = match p.driver {
        14 => "UZI",
        _ => "VULCAN",
    };
    let mut hint = String::new();
    if p.destroyed > 0.0 {
        hint = format!("WRECKED  RESPAWN IN {:.0}", p.destroyed.ceil());
    }
    if !p.bomber && p.shield > 0.0 && p.destroyed <= 0.0 {
        hint = "SPAWN SHIELD".into();
    }
    if powered && active {
        let state = match p.vulcan <= 3.0 {
            true => "ENDING",
            false => "ACTIVE",
        };
        hint = format!("{weapon} {state}  {:.1}s", p.vulcan);
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
        text(Id::Dizzy, format!("DIZZY  {:.1}s", p.dizzy));
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
            1 => "INCOMING MISSILE",
            _ => "INCOMING MISSILES",
        };
        let help = match p.chaff > 0 && p.chaff_cooldown <= 0.0 {
            true => "C / CHAFF TO BREAK THE LOCK",
            false => "EVADE THE MISSILE",
        };
        text(Id::Incoming, format!("{title}\n{help}"));
    } else if now < notices.averted {
        text(Id::Averted, "MISSILE AVERTED\nCHAFF BROKE THE LOCK".into());
    }
    let mut card = |id: Id, card: &Notice| {
        out.insert(
            id,
            Reading {
                text: format!("{}\n{}", card.title, card.detail),
                color: card.color.map(|[r, g, b]| Color::srgb_u8(r, g, b)),
                ..default()
            },
        );
    };
    if let Some(whack) = &notices.whack {
        card(Id::Whack, whack);
    }
    if let Some(ability) = &notices.ability {
        card(Id::Ability, ability);
    }
    if let Some(reward) = &notices.reward {
        card(Id::Reward, reward);
    }
    if let Some((blue, _)) = notices.ring {
        out.insert(
            Id::Ring,
            Reading {
                text: "RING OF FIRE\nKEEP TURNING  LET IT BURN".into(),
                color: Some(match blue {
                    true => Color::srgb_u8(0x4a, 0xba, 0xff),
                    false => Color::srgb_u8(0xff, 0x9a, 0x3c),
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
            format!("HEDGEGUARD  {:.1}s  {blocks}", p.hedge_shield),
        );
    }
    if live && !p.bomber && p.tehilim > 0.0 {
        status(
            Id::Tehilim,
            format!("TEHILIM VS TILIM  {:.1}s  MISSILE REPULSION", p.tehilim),
        );
    }
    if racing && !p.bomber && p.intelligence_bonus > 0 {
        let base = racer.map_or(0, |r| u32::from(r.intelligence));
        status(
            Id::Intelligence,
            format!(
                "INTELLIGENCE {}  +{}",
                base + p.intelligence_bonus,
                p.intelligence_bonus
            ),
        );
    }
    let mut item = match p.item.as_str() {
        "boost" => "AFTERBURNER READY".into(),
        "hedgehog" => format!("HEDGEHOG x {}", p.ammo),
        "missile" => format!("MISSILE x {}  HOMING", p.missiles),
        _ => "EMPTY  COLLECT AMMO".into(),
    };
    if powered && p.item == "hedgehog" {
        item = match p.driver {
            14 => "BAT COMPANION  AUTO UZI".into(),
            _ => "VULCAN  HOLD SPACE TO SPRAY".into(),
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
                text: format!("{animal} {weapon}  {:.1}s", p.vulcan),
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
    // Weapon cards and action buttons: count, caption and whether they can be used now.
    let mut card = |id: Id, count: String, text: String, usable: bool, highlight: Option<Color>| {
        let tone = highlight.unwrap_or(match usable {
            true => BUTTON,
            false => DISABLED,
        });
        out.insert(
            id,
            Reading {
                text,
                count,
                tone: Some(tone),
                ..default()
            },
        );
    };
    let chosen = |item: &str| (p.item == item).then_some(SELECTED);
    card(
        Id::Hedgehogs,
        match powered {
            true => "MAX".into(),
            false => p.ammo.to_string(),
        },
        match powered {
            true => weapon.into(),
            false => "HEDGEHOGS".into(),
        },
        powered || p.ammo > 0,
        match powered {
            true => Some(POWERED),
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
        "X  TURBO".into(),
        live && p.turbos > 0 && p.boost <= 0.0,
        None,
    );
    card(
        Id::Chaff,
        String::new(),
        format!("C  CHAFF {}", p.chaff),
        live && p.chaff > 0 && p.chaff_cooldown <= 0.0,
        None,
    );
    card(
        Id::Flip,
        String::new(),
        match p.somersault_cooldown > 1e-8 {
            true => format!("Z  {:.1}s", p.somersault_cooldown),
            false => "Z  SOMERSAULT".into(),
        },
        live && p.somersault_cooldown <= 1e-8,
        None,
    );
    let ability = racer
        .map(|racer| racer.ability.as_str())
        .filter(|_| SPECIALISTS.contains(&p.driver) && view.special_abilities && !p.bomber);
    if let Some(ability) = ability {
        let hunting = view.locusts.iter().filter(|b| b.owner == view.you).count();
        let label = match (p.special_cooldown > 0.0, p.driver) {
            (true, _) => format!("F  RECHARGE {:.1}s", p.special_cooldown),
            (false, 5) => format!("F  {ability}  {hunting} LOCUSTS"),
            _ => format!("F  {ability}"),
        };
        let ready = live && p.special_cooldown <= 0.0 && !(p.driver == 12 && p.health >= 6.0);
        card(Id::Special, String::new(), label, ready, None);
    }
    out
}

pub fn setup(mut commands: Commands) {
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
    let mut ui = Builder(&mut commands);
    // Rivals' nameplates sit behind everything else on the HUD.
    for index in 0..SLOTS {
        let anchor = ui.node(
            root,
            fixed(Node {
                width: px(0),
                justify_content: JustifyContent::Center,
                display: Display::None,
                ..default()
            }),
            Color::NONE,
        );
        ui.0.entity(anchor).insert(Part::Plate(index));
        let plate = ui.node(
            anchor,
            Node {
                padding: UiRect::axes(px(6), px(2)),
                flex_shrink: 0.0,
                ..default()
            },
            PANEL,
        );
        ui.readout(plate, 12.0, Label::Plate(index));
    }
    // Kills, health and time left, as the browser's top bar.
    let bar = ui.node(
        root,
        fixed(Node {
            top: px(10),
            left: px(0),
            right: px(0),
            justify_content: JustifyContent::Center,
            column_gap: px(10),
            ..default()
        }),
        Color::NONE,
    );
    for caption in ["KILLS", "HEALTH", "TIME LEFT"] {
        let block = ui.node(
            bar,
            column(Node {
                align_items: AlignItems::Center,
                padding: UiRect::axes(px(16), px(6)),
                min_width: px(130),
                ..default()
            }),
            PANEL,
        );
        ui.text(block, caption, 11.0, MUTED);
        match caption {
            "KILLS" => ui.readout(block, 24.0, Label::Of(Id::Kills)),
            "TIME LEFT" => ui.readout(block, 24.0, Label::Of(Id::Time)),
            _ => {
                let hearts = ui.node(
                    block,
                    Node {
                        column_gap: px(4),
                        padding: UiRect::vertical(px(7)),
                        ..default()
                    },
                    Color::NONE,
                );
                for index in 0..MAX_HEALTH {
                    let heart = ui.node(
                        hearts,
                        Node {
                            width: px(14),
                            height: px(14),
                            ..default()
                        },
                        EMPTY_HEART,
                    );
                    ui.0.entity(heart).insert(Part::Heart(index));
                }
            }
        }
    }
    let board = ui.node(
        root,
        fixed(Node {
            right: px(14),
            top: px(10),
            padding: UiRect::all(px(10)),
            ..default()
        }),
        PANEL,
    );
    ui.readout(board, 13.0, Label::Of(Id::Board));
    // The arena map: cover and fighter positions.
    let map = ui.node(
        root,
        fixed(Node {
            left: px(14),
            top: px(10),
            width: px(MAP_SIZE.x),
            height: px(MAP_SIZE.y),
            ..default()
        }),
        Color::srgba_u8(0xe5, 0xe0, 0xd9, 0xd8),
    );
    for index in 0..SLOTS {
        let block = ui.node(
            map,
            fixed(Node::default()),
            Color::srgb_u8(0x92, 0x83, 0x9d),
        );
        ui.0.entity(block).insert(Part::MapBlock(index));
    }
    for index in 0..SLOTS {
        let dot = ui.node(map, fixed(Node::default()), Color::WHITE);
        ui.0.entity(dot).insert(Part::MapDot(index));
    }
    // Warnings and announcements stack beneath the top bar.
    let notices = ui.node(
        root,
        fixed(column(Node {
            top: px(84),
            left: px(0),
            right: px(0),
            align_items: AlignItems::Center,
            row_gap: px(6),
            ..default()
        })),
        Color::NONE,
    );
    for (id, size, color) in [
        (Id::Incoming, 18.0, ALERT),
        (Id::Averted, 16.0, CLEAR),
        (Id::Hint, 16.0, PANEL),
        (Id::Toast, 15.0, PANEL),
        (Id::Dizzy, 16.0, PANEL),
        (Id::Whack, 24.0, PANEL),
        (Id::Ring, 20.0, PANEL),
        (Id::Ability, 18.0, PANEL),
        (Id::Reward, 18.0, PANEL),
    ] {
        let panel = ui.node(
            notices,
            Node {
                padding: UiRect::axes(px(16), px(8)),
                display: Display::None,
                ..default()
            },
            color,
        );
        ui.0.entity(panel).insert(Part::Panel(id));
        ui.0.spawn((
            Text::default(),
            TextFont {
                font_size: bevy::text::FontSize::Px(size),
                ..default()
            },
            TextLayout::justify(Justify::Center),
            TextColor(Color::WHITE),
            Label::Of(id),
            ChildOf(panel),
        ));
    }
    let bar_track = |ui: &mut Builder, parent: Entity, id: Id, color: Color| {
        let track = ui.node(
            parent,
            Node {
                width: px(220),
                height: px(6),
                ..default()
            },
            Color::srgba(1.0, 1.0, 1.0, 0.18),
        );
        let fill = ui.node(
            track,
            Node {
                height: percent(100),
                ..default()
            },
            color,
        );
        ui.0.entity(fill).insert(Part::Fill(id));
    };
    // Status lines, rapid-fire timer, weapon cards and the selected item.
    let corner = ui.node(
        root,
        fixed(column(Node {
            left: px(14),
            bottom: px(12),
            row_gap: px(5),
            ..default()
        })),
        Color::NONE,
    );
    for id in [Id::Intelligence, Id::Tehilim, Id::Hedgeguard, Id::Vulcan] {
        let line = ui.node(
            corner,
            column(Node {
                padding: UiRect::axes(px(8), px(4)),
                row_gap: px(4),
                display: Display::None,
                ..default()
            }),
            PANEL,
        );
        ui.0.entity(line).insert(Part::Panel(id));
        ui.readout(line, 12.0, Label::Of(id));
        if id == Id::Vulcan {
            bar_track(&mut ui, line, id, Color::srgb_u8(0xff, 0xbd, 0x58));
        }
    }
    let rack = ui.node(
        corner,
        Node {
            column_gap: px(7),
            ..default()
        },
        Color::NONE,
    );
    for (id, action) in [
        (Id::Hedgehogs, ClientAction::SelectHedgehog),
        (Id::Missiles, ClientAction::SelectMissile),
        (Id::Turbos, ClientAction::Boost),
    ] {
        let card = ui.node(
            rack,
            column(Node {
                width: px(112),
                align_items: AlignItems::Center,
                padding: UiRect::all(px(6)),
                ..default()
            }),
            BUTTON,
        );
        ui.0.entity(card).insert((
            RelativeCursorPosition::default(),
            Act::Game(action),
            Tone(BUTTON),
            Card(id),
        ));
        ui.readout(card, 32.0, Label::Count(id));
        ui.readout(card, 11.0, Label::Of(id));
    }
    let item = ui.node(corner, Node::default(), Color::NONE);
    ui.readout(item, 12.0, Label::Of(Id::Item));
    // The drift meter sits above the kart, as in the browser.
    let drift = ui.node(
        root,
        fixed(Node {
            bottom: px(120),
            left: px(0),
            right: px(0),
            justify_content: JustifyContent::Center,
            ..default()
        }),
        Color::NONE,
    );
    let meter = ui.node(
        drift,
        column(Node {
            align_items: AlignItems::Center,
            padding: UiRect::axes(px(12), px(6)),
            row_gap: px(4),
            display: Display::None,
            ..default()
        }),
        PANEL,
    );
    ui.0.entity(meter).insert(Part::Panel(Id::Drift));
    ui.readout(meter, 14.0, Label::Of(Id::Drift));
    bar_track(&mut ui, meter, Id::Drift, GOLD);
    ui.text(meter, "RELEASE DRIFT TO BOOST", 10.0, MUTED);
    // Speed and the action buttons.
    let actions = ui.node(
        root,
        fixed(column(Node {
            right: px(14),
            bottom: px(12),
            width: px(250),
            row_gap: px(8),
            align_items: AlignItems::Stretch,
            ..default()
        })),
        Color::NONE,
    );
    for (id, action) in [
        (Id::Special, ClientAction::Special),
        (Id::Chaff, ClientAction::Chaff),
        (Id::Flip, ClientAction::Somersault),
    ] {
        let button = ui.node(
            actions,
            Node {
                padding: UiRect::axes(px(8), px(10)),
                justify_content: JustifyContent::Center,
                ..default()
            },
            BUTTON,
        );
        ui.0.entity(button).insert((
            RelativeCursorPosition::default(),
            Act::Game(action),
            Tone(BUTTON),
            Card(id),
            Part::Panel(id),
        ));
        ui.readout(button, 13.0, Label::Of(id));
    }
    let foot = ui.node(
        actions,
        Node {
            justify_content: JustifyContent::SpaceBetween,
            align_items: AlignItems::End,
            ..default()
        },
        Color::NONE,
    );
    ui.text(foot, "Esc  menu", 13.0, Color::WHITE);
    ui.readout(foot, 22.0, Label::Of(Id::Speed));
}

type Nodes<'w, 's> = Query<
    'w,
    's,
    (
        &'static Part,
        &'static mut Node,
        &'static mut BackgroundColor,
    ),
>;
type Labels<'w, 's> = Query<'w, 's, (&'static Label, &'static mut Text, &'static mut TextColor)>;
type Lens<'w, 's> = Query<'w, 's, (&'static Camera, &'static GlobalTransform), With<FollowCamera>>;

#[allow(clippy::too_many_arguments)]
pub fn update(
    session: Res<GameSession>,
    menu: Res<Menu>,
    graphics: Res<Graphics>,
    time: Res<Time>,
    mut notices: ResMut<Notices>,
    cameras: Lens,
    mut nodes: Nodes,
    mut labels: Labels,
    mut cards: Query<(&Card, &mut Tone)>,
) {
    let view = session.client.as_ref().map(|client| client.view());
    let Some(view) = view.filter(|_| menu.screen(&session) == Screen::Playing) else {
        for (part, mut node, _) in &mut nodes {
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
    let readings = readings(&view, &graphics, &notices, now);
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
    for (part, mut node, mut color) in &mut nodes {
        match *part {
            Part::Root => show(&mut node, true),
            Part::Panel(id) => show(
                &mut node,
                readings.get(&id).is_some_and(|r| !r.text.is_empty()),
            ),
            Part::Fill(id) => {
                let fill = readings.get(&id).and_then(|r| r.fill).unwrap_or(0.0);
                node.width = percent(fill.clamp(0.0, 1.0) * 100.0);
            }
            Part::Heart(index) => {
                let full = (index as f64) < view.player.health;
                color.0 = match (full, index >= 3) {
                    (false, _) => EMPTY_HEART,
                    (true, true) => GOLD,
                    (true, false) => HEART,
                };
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
            Part::Plate(index) => {
                let plate = plates.get(index);
                show(&mut node, plate.is_some());
                if let Some((at, ..)) = plate {
                    (node.left, node.top) = (px(at.x), px(at.y));
                }
            }
        }
    }
    for (label, mut text, mut color) in &mut labels {
        let (value, tinted) = match *label {
            Label::Of(id) => {
                let reading = readings.get(&id);
                (
                    reading.map_or("", |r| r.text.as_str()),
                    reading.and_then(|r| r.color),
                )
            }
            Label::Count(id) => (readings.get(&id).map_or("", |r| r.count.as_str()), None),
            Label::Plate(index) => match plates.get(index) {
                Some((_, name, [r, g, b])) => (name.as_str(), Some(Color::srgb_u8(*r, *g, *b))),
                None => ("", None),
            },
        };
        if text.0 != value {
            text.0 = value.to_owned();
        }
        let tinted = tinted.unwrap_or(Color::WHITE);
        if color.0 != tinted {
            color.0 = tinted;
        }
    }
    for (card, mut tone) in &mut cards {
        let wanted = readings
            .get(&card.0)
            .and_then(|r| r.tone)
            .unwrap_or(DISABLED);
        if tone.0 != wanted {
            tone.0 = wanted;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn symbols_the_font_lacks_become_plain_separators() {
        assert_eq!(plain("Elon \u{2620} YOU"), "Elon > YOU");
        assert_eq!(plain("2-KILL STREAK  VULCAN!"), "2-KILL STREAK VULCAN!");
    }

    #[test]
    fn the_race_clock_counts_minutes_seconds_and_hundredths() {
        assert_eq!(clock(151.5), "02:31.50");
        assert_eq!(clock(9.256), "00:09.26");
        assert_eq!(clock(-3.0), "00:00.00");
    }
}
