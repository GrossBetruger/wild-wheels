//! Menus: joining a server, the room lobby and the in-game menu.
//! Every choice here maps to a request the browser client also makes.
use crate::{
    app::GameSession,
    config::{Config, player_name, server_origin},
    ported::{Graphics, Ported},
    prefs::Preferences,
    scene::FollowCamera,
    transport::Command,
};
use bevy::{
    app::AppExit,
    input::{
        ButtonState,
        keyboard::{Key, KeyboardInput},
    },
    prelude::*,
    text::FontSize,
    ui::RelativeCursorPosition,
};
use serde_json::json;
use wild_wheels_core::ClientAction;

const PANEL: Color = Color::srgba(0.035, 0.025, 0.09, 0.88);
const BUTTON: Color = Color::srgb(0.20, 0.17, 0.32);
const SELECTED: Color = Color::srgb(0.52, 0.34, 0.81);
const PRIMARY: Color = Color::srgb(0.80, 0.36, 0.26);
const GOLD: Color = Color::srgb(0.95, 0.80, 0.38);
const MUTED: Color = Color::srgb(0.72, 0.70, 0.80);
const WARNING: Color = Color::srgb(1.0, 0.62, 0.52);
/// The racer preview stands far above the arena, out of every match's sight.
const PREVIEW: Vec3 = Vec3::new(0.0, 500.0, 0.0);
/// Set once, in rust-core.
const ROOM_CAPACITY: usize = wild_wheels_core::MAX_PLAYERS;
const CONTROLS: &str = "Arrows / WASD   drive\nShift   drift\nSpace   fire\nTab   switch weapon\nX   boost      C   chaff\nZ   flip      F   special ability\nV   push to talk (mic)\nP   sit out (AFK)      Esc   menu";

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Field {
    Server,
    Name,
}
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Screen {
    Join,
    Connecting,
    Lobby,
    Playing,
    Menu,
}
#[derive(Component, Clone, Copy, Debug)]
pub enum Act {
    /// One of the racer's own actions, from a HUD button.
    Game(ClientAction),
    Edit(Field),
    Racer(usize),
    Color(usize),
    Join,
    Start,
    Arena(usize),
    Bots(usize),
    MatchLimit(&'static str, usize),
    Abilities(bool),
    /// Opens the in-game menu, as Escape does.
    Menu,
    Resume,
    SitOut,
    MuteVoice(usize),
    Leave,
    Quit,
}
/// A button's resting color, brightened while the pointer is over it.
#[derive(Component)]
pub struct Tone(pub Color);
#[derive(Component)]
pub struct Preview;

#[derive(Resource)]
pub struct Menu {
    /// Developer options from the command line, kept for every join.
    base: Config,
    server: String,
    name: String,
    driver: usize,
    color: Option<String>,
    field: Field,
    /// The in-game menu is open; driving input is ignored meanwhile.
    pub open: bool,
    notice: String,
    drawn: String,
    root: Option<Entity>,
}
impl Menu {
    /// Explicit command-line values win over remembered ones.
    pub fn new(base: Config, saved: Preferences) -> Self {
        let chosen = |explicit: bool, saved: Option<String>, given: String| match explicit {
            true => given,
            false => saved.unwrap_or(given),
        };
        Self {
            color: base
                .color
                .clone()
                .or(saved.color.filter(|c| crate::colors::valid(c))),
            server: chosen(base.join, saved.server, base.origin.to_string()),
            name: chosen(base.join, saved.name, base.name.clone()),
            driver: match base.join {
                true => base.driver,
                false => saved.driver.unwrap_or(base.driver),
            },
            base,
            field: Field::Name,
            open: false,
            notice: String::new(),
            drawn: String::new(),
            root: None,
        }
    }
    pub fn is_benchmark(&self) -> bool {
        self.base.benchmark.is_some()
    }
    pub fn screen(&self, session: &GameSession) -> Screen {
        match session.client.as_ref() {
            _ if !session.joined() => Screen::Join,
            _ if session.away => Screen::Menu,
            None => Screen::Connecting,
            Some(_) if self.open => Screen::Menu,
            Some(client) if matches!(client.view().phase, "ready" | "finished") => Screen::Lobby,
            Some(_) => Screen::Playing,
        }
    }
    fn join(&mut self, session: &mut GameSession) {
        let server = match self.server.contains("://") {
            true => self.server.clone(),
            false => format!("http://{}", self.server),
        };
        match (server_origin(server.trim()), player_name(&self.name)) {
            (Err(error), _) | (_, Err(error)) => self.notice = error.to_string(),
            (Ok(origin), Ok(name)) => {
                self.notice.clear();
                self.server = origin.to_string();
                self.remember();
                session.join(Config {
                    origin,
                    name,
                    driver: self.driver,
                    color: self.color.clone(),
                    ..self.base.clone()
                });
            }
        }
    }
    fn remember(&self) {
        Preferences {
            server: Some(self.server.clone()),
            name: Some(self.name.clone()),
            driver: Some(self.driver),
            color: self.color.clone(),
        }
        .save();
    }
    fn typed(&mut self, text: &str) {
        let (value, limit) = match self.field {
            Field::Server => (&mut self.server, 200),
            Field::Name => (&mut self.name, 24),
        };
        for character in text.chars().filter(|c| !c.is_control()) {
            if value.encode_utf16().count() + character.len_utf16() <= limit {
                value.push(character);
            }
        }
    }
}

/// The system clipboard, for pasting a server address or chat message (including UTF-8 / Hebrew).
pub(crate) fn clipboard() -> Option<String> {
    let output = std::process::Command::new("pbpaste")
        .env("LC_CTYPE", "UTF-8")
        .output()
        .ok()?;
    let text = String::from_utf8(output.stdout).ok()?;
    Some(text.lines().next()?.trim().to_owned())
}

pub fn setup(mut commands: Commands) {
    commands.spawn((
        Transform::from_translation(PREVIEW),
        Visibility::default(),
        Ported::default(),
        Preview,
    ));
}

#[allow(clippy::too_many_arguments)]
pub fn control(
    mut menu: ResMut<Menu>,
    chat: Res<crate::chat::ChatPanel>,
    mut session: ResMut<GameSession>,
    graphics: Res<Graphics>,
    mut typed: MessageReader<KeyboardInput>,
    keys: Res<ButtonInput<KeyCode>>,
    mouse: Res<ButtonInput<MouseButton>>,
    buttons: Query<(&RelativeCursorPosition, &Act)>,
    mut exit: MessageWriter<AppExit>,
) {
    if chat.capture_frame {
        typed.clear();
        return;
    }
    let screen = menu.screen(&session);
    let mut acts = Vec::new();
    if mouse.just_pressed(MouseButton::Left) {
        acts.extend(
            buttons
                .iter()
                .find(|(pointer, _)| pointer.cursor_over())
                .map(|(_, act)| *act),
        );
    }
    let command = keys.any_pressed([KeyCode::SuperLeft, KeyCode::SuperRight]);
    let racers = graphics.racers().len().max(1);
    // Some platforms deliver a navigation key press twice in one frame.
    let mut handled = Vec::new();
    for event in typed.read().filter(|e| e.state == ButtonState::Pressed) {
        if !matches!(event.logical_key, Key::Character(_) | Key::Space) {
            if handled.contains(&event.key_code) {
                continue;
            }
            handled.push(event.key_code);
        }
        if screen == Screen::Join && command && event.key_code == KeyCode::KeyV {
            if let Some(pasted) = clipboard() {
                menu.typed(&pasted);
            }
            continue;
        }
        match (screen, &event.logical_key) {
            (Screen::Join, Key::Character(text)) if command => {
                if text.eq_ignore_ascii_case("v")
                    && let Some(pasted) = clipboard()
                {
                    menu.typed(&pasted);
                }
            }
            (Screen::Join, Key::Character(text)) => menu.typed(text),
            (Screen::Join, Key::Space) => menu.typed(" "),
            (Screen::Join, Key::Backspace) => {
                match menu.field {
                    Field::Server => menu.server.pop(),
                    Field::Name => menu.name.pop(),
                };
            }
            (Screen::Join, Key::Tab) => {
                menu.field = match menu.field {
                    Field::Server => Field::Name,
                    Field::Name => Field::Server,
                }
            }
            (Screen::Join, Key::ArrowRight | Key::ArrowDown) => {
                acts.push(Act::Racer((menu.driver + 1) % racers))
            }
            (Screen::Join, Key::ArrowLeft | Key::ArrowUp) => {
                acts.push(Act::Racer((menu.driver + racers - 1) % racers))
            }
            (Screen::Join, Key::Enter) => acts.push(Act::Join),
            (Screen::Join, _) if !command => {
                if let Some(text) = &event.text {
                    menu.typed(text);
                }
            }
            (Screen::Lobby, Key::Enter) => acts.push(Act::Start),
            (Screen::Connecting, Key::Escape) => acts.push(Act::Leave),
            (Screen::Lobby | Screen::Playing, Key::Escape) => menu.open = true,
            (Screen::Menu, Key::Enter | Key::Escape) if session.away => acts.push(Act::SitOut),
            (Screen::Menu, Key::Escape) => acts.push(Act::Resume),
            (Screen::Lobby | Screen::Playing | Screen::Menu, Key::Character(text))
                if !command
                    && (text.eq_ignore_ascii_case("p") || event.key_code == KeyCode::KeyP) =>
            {
                acts.push(Act::SitOut);
            }
            (Screen::Lobby | Screen::Playing | Screen::Menu, _)
                if !command && event.key_code == KeyCode::KeyP =>
            {
                acts.push(Act::SitOut);
            }
            _ => {}
        }
    }
    for act in acts {
        let control = |session: &mut GameSession, action| {
            session.request(Command::Control(action));
        };
        match act {
            Act::Color(index) => {
                let Some(swatch) = crate::colors::palette().get(index) else {
                    continue;
                };
                match screen {
                    Screen::Join => {
                        menu.color = Some(swatch.hex.into());
                        menu.remember();
                    }
                    Screen::Lobby => session.choose_color(swatch.hex),
                    _ => {}
                }
            }
            Act::Game(action) => session.act(action),
            Act::Edit(field) => menu.field = field,
            Act::Racer(driver) => {
                menu.driver = driver;
                menu.remember();
                session.request(Command::Driver(driver));
            }
            Act::Join => menu.join(&mut session),
            Act::Start => control(&mut session, json!({"action":"start"})),
            Act::Arena(arena) => control(&mut session, json!({"action":"arena","arena":arena})),
            Act::MatchLimit(field, value) => control(&mut session, json!({"action":field,"value":value})),
            Act::Bots(bots) => control(&mut session, json!({"action":"bots","bots":bots})),
            Act::Abilities(enabled) => control(
                &mut session,
                json!({"action":"special-abilities","enabled":enabled}),
            ),
            Act::Menu => menu.open = true,
            Act::Resume => menu.open = false,
            Act::SitOut => {
                let away = !session.away;
                if session.set_away(away) {
                    menu.open = false;
                }
            }
            Act::Leave => {
                session.leave();
                menu.open = false;
            }
            Act::MuteVoice(id) => {
                session.voice.toggle_mute(id);
            }
            Act::Quit => {
                session.leave();
                exit.write(AppExit::Success);
            }
        }
    }
}

/// Spawns menu widgets beneath a parent node.
struct Builder<'a, 'w, 's> {
    commands: &'a mut Commands<'w, 's>,
    font: bevy::text::FontSource,
}
impl Builder<'_, '_, '_> {
    fn colors(
        &mut self,
        root: Entity,
        preferred: Option<&str>,
        view: Option<&wild_wheels_core::ClientView>,
        pending: bool,
        message: &str,
    ) {
        let panel = self.column(
            root,
            Node {
                position_type: PositionType::Absolute,
                left: match view.is_some() {
                    true => px(14),
                    false => Val::Auto,
                },
                right: match view.is_some() {
                    true => Val::Auto,
                    false => px(14),
                },
                bottom: match view.is_some() {
                    true => px(96),
                    false => px(14),
                },
                width: px(510),
                ..default()
            },
        );
        self.text(panel, "YOUR COLOR", 13.0, MUTED);
        let assigned = view.map(|v| v.player.color.as_str());
        let selected = assigned
            .or(preferred)
            .unwrap_or(crate::colors::palette()[0].hex);
        let row = self.row(panel);
        for (index, swatch) in crate::colors::palette().iter().enumerate() {
            let taken = view.is_some_and(|v| crate::colors::occupied(v, swatch.hex));
            let locked = pending || view.is_some_and(|v| !crate::colors::editable(v.phase));
            let chosen = selected == swatch.hex;
            let color = Color::srgb_u8(swatch.rgb[0], swatch.rgb[1], swatch.rgb[2]);
            let tile = self.node(
                row,
                Node {
                    width: px(27),
                    height: px(30),
                    border: UiRect::all(px(if chosen { 3.0 } else { 1.0 })),
                    align_items: AlignItems::Center,
                    justify_content: JustifyContent::Center,
                    ..default()
                },
                color,
            );
            self.commands
                .entity(tile)
                .insert(BorderColor::all(if chosen { Color::WHITE } else { MUTED }));
            if !taken && !locked {
                self.commands.entity(tile).insert((
                    RelativeCursorPosition::default(),
                    Act::Color(index),
                    Tone(color),
                ));
            }
            self.text(
                tile,
                if taken {
                    "X"
                } else if chosen {
                    "*"
                } else {
                    ""
                },
                17.0,
                Color::WHITE,
            );
        }
        let label = crate::colors::palette()
            .iter()
            .find(|s| s.hex == selected)
            .map_or(selected, |s| s.name);
        let fallback = preferred
            .filter(|c| *c != selected)
            .and_then(|c| crate::colors::palette().iter().find(|s| s.hex == c));
        let hint = match (message.is_empty(), fallback) {
            (false, _) => message.to_owned(),
            (_, Some(swatch)) => format!(
                "Preferred {} | Currently {label}. X = taken by another player.",
                swatch.name
            ),
            _ => format!("{label} | X = taken by another player. Choose between matches."),
        };
        self.text(panel, &hint, 12.0, MUTED);
    }
    fn node(&mut self, parent: Entity, node: Node, color: Color) -> Entity {
        self.commands
            .spawn((node, BackgroundColor(color), ChildOf(parent)))
            .id()
    }
    fn column(&mut self, parent: Entity, node: Node) -> Entity {
        let node = Node {
            flex_direction: FlexDirection::Column,
            row_gap: px(8),
            padding: UiRect::all(px(18)),
            ..node
        };
        self.node(parent, node, PANEL)
    }
    fn row(&mut self, parent: Entity) -> Entity {
        let node = Node {
            flex_wrap: FlexWrap::Wrap,
            column_gap: px(6),
            row_gap: px(6),
            align_items: AlignItems::Center,
            ..default()
        };
        self.node(parent, node, Color::NONE)
    }
    fn text(&mut self, parent: Entity, text: &str, size: f32, color: Color) {
        self.commands.spawn((
            Text::new(text),
            TextFont {
                font: self.font.clone(),
                font_size: FontSize::Px(size),
                ..default()
            },
            TextColor(color),
            ChildOf(parent),
        ));
    }
    fn button(&mut self, parent: Entity, label: &str, act: Act, color: Color, width: Val) {
        let node = Node {
            width,
            padding: UiRect::axes(px(10), px(7)),
            justify_content: JustifyContent::Center,
            ..default()
        };
        let button = self.node(parent, node, color);
        self.commands
            .entity(button)
            .insert((RelativeCursorPosition::default(), act, Tone(color)));
        self.text(button, label, 15.0, Color::WHITE);
    }
    fn choice(&mut self, parent: Entity, label: &str, act: Act, chosen: bool, width: Val) {
        let color = match chosen {
            true => SELECTED,
            false => BUTTON,
        };
        self.button(parent, label, act, color, width);
    }
    fn racers(&mut self, parent: Entity, graphics: &Graphics, chosen: usize, width: f32) {
        let grid = self.row(parent);
        for (driver, racer) in graphics.racers().iter().enumerate() {
            self.choice(
                grid,
                &racer.name,
                Act::Racer(driver),
                driver == chosen,
                px(width),
            );
        }
    }
}

pub fn draw(
    mut commands: Commands,
    mut menu: ResMut<Menu>,
    session: Res<GameSession>,
    graphics: Res<Graphics>,
    faces: Option<Res<crate::hud::MenloFaces>>,
) {
    if session.joined() && session.colors.preferred != menu.color {
        menu.color = session.colors.preferred.clone();
        menu.remember();
    }
    let screen = menu.screen(&session);
    let view = session.client.as_ref().map(|client| client.view());
    // Everything a screen shows; the widgets are rebuilt only when this changes.
    let drawn = match (screen, view.as_ref()) {
        (Screen::Join, _) => format!(
            "join|{}|{}|{:?}|{}|{}|{:?}",
            menu.server, menu.name, menu.field, menu.driver, menu.notice, menu.color
        ),
        (Screen::Lobby, Some(view)) => format!(
            "lobby|{}|{}|{}|{}|{}|{}|{:?}|{}|{}|{}|{}|{:?}|{}|{}|{:?}|{:?}",
            view.arena,
            view.actors
                .iter()
                .filter(|a| !a.inactive)
                .map(|a| format!(
                    "{}{}{}{}",
                    a.name.as_deref().unwrap_or("bot"),
                    a.human,
                    a.color,
                    a.afk
                ))
                .collect::<Vec<_>>()
                .join(","),
            view.special_abilities,
            view.player.driver,
            view.phase,
            session.status,
            menu.color,
            session.colors.pending,
            session.colors.message,
            view.target_score,
            view.duration,
            session.board,
            session.voice.is_talking(),
            session.voice.is_socket_ready(),
            session.voice.error(),
            view.actors
                .iter()
                .filter(|a| !a.inactive && a.human && a.id != view.you)
                .map(|a| (a.id, session.voice.is_muted(a.id), session.voice.is_speaking(a.id)))
                .collect::<Vec<_>>()
        ),
        (Screen::Menu, Some(view)) => format!(
            "{screen:?}|{}|{}|{}|{}|{:?}|{:?}",
            session.away,
            session.status,
            session.voice.is_talking(),
            session.voice.is_socket_ready(),
            session.voice.error(),
            view.actors
                .iter()
                .filter(|a| !a.inactive && a.human && a.id != view.you)
                .map(|a| (a.id, a.name.as_deref().unwrap_or(""), session.voice.is_muted(a.id), session.voice.is_speaking(a.id)))
                .collect::<Vec<_>>()
        ),
        _ => format!("{screen:?}|{}|{}", session.away, session.status),
    };
    if drawn == menu.drawn {
        return;
    }
    menu.drawn = drawn;
    if let Some(root) = menu.root.take() {
        commands.entity(root).despawn();
    }
    let root = commands
        .spawn(Node {
            position_type: PositionType::Absolute,
            width: percent(100),
            height: percent(100),
            ..default()
        })
        .id();
    menu.root = Some(root);
    let font = faces.map(|f| f.source.clone()).unwrap_or_default();
    let mut ui = Builder {
        commands: &mut commands,
        font,
    };
    let centered = Node {
        position_type: PositionType::Absolute,
        left: percent(32),
        right: percent(32),
        top: percent(22),
        ..default()
    };
    match (screen, view.as_ref()) {
        (Screen::Join, _) => {
            let panel = ui.column(
                root,
                Node {
                    position_type: PositionType::Absolute,
                    left: px(36),
                    top: px(36),
                    width: px(548),
                    ..default()
                },
            );
            ui.text(panel, "WILD WHEELS", 44.0, GOLD);
            ui.text(panel, "Arena battles on the dedicated server", 16.0, MUTED);
            for (label, field, value) in [
                ("SERVER", Field::Server, &menu.server),
                ("YOUR NAME", Field::Name, &menu.name),
            ] {
                ui.text(panel, label, 13.0, MUTED);
                let editing = menu.field == field;
                let shown = match editing {
                    true => format!("{value}|"),
                    false => value.clone(),
                };
                ui.choice(panel, &shown, Act::Edit(field), editing, percent(100));
            }
            ui.text(panel, "RACER", 13.0, MUTED);
            ui.racers(panel, &graphics, menu.driver, 166.0);
            ui.colors(root, menu.color.as_deref(), None, false, "");
            if let Some(racer) = graphics.racers().get(menu.driver) {
                ui.text(panel, &racer.description, 15.0, Color::WHITE);
            }
            ui.button(panel, "JOIN THE ARENA", Act::Join, PRIMARY, percent(100));
            ui.text(panel, &menu.notice, 15.0, WARNING);
            ui.text(
                panel,
                "Tab: switch field   Arrows: choose a racer   Enter: join   Cmd+V: paste",
                12.0,
                MUTED,
            );
        }
        (Screen::Lobby, Some(view)) => {
            if let Some(board) = session.board.as_deref() {
                let lb = ui.column(
                    root,
                    Node {
                        position_type: PositionType::Absolute,
                        left: px(14),
                        top: px(14),
                        width: px(396),
                        ..default()
                    },
                );
                ui.text(lb, "ALL-TIME LEADERBOARD", 22.0, GOLD);
                ui.text(lb, "ELO RATING · WINS / GAMES", 12.0, MUTED);
                let you_elo = crate::hud::player_elo(board, view.player.name.as_deref());
                match you_elo {
                    Some((rank, rating, wins, games)) => {
                        ui.text(
                            lb,
                            &format!("YOUR ELO  {rating}  ·  RANK #{rank}  ·  {wins}W / {games}G"),
                            14.0,
                            GOLD,
                        );
                    }
                    None => {
                        ui.text(
                            lb,
                            "YOUR ELO  1000  ·  UNRANKED (finish a match to rank)",
                            13.0,
                            MUTED,
                        );
                    }
                }
                let rows = crate::hud::all_time_rows(
                    board,
                    view.player.name.as_deref(),
                    crate::hud::ALL_TIME_ROWS,
                );
                if rows.is_empty() {
                    ui.text(lb, "No matches finished yet", 14.0, MUTED);
                } else {
                    for row in rows {
                        let marker = match row.you {
                            true => " (YOU)",
                            false => "",
                        };
                        let color = match row.you {
                            true => GOLD,
                            false => Color::WHITE,
                        };
                        ui.text(
                            lb,
                            &format!(
                                "#{:<2}  {}{}   {} ELO  ·  {} / {}",
                                row.rank, row.name, marker, row.rating, row.wins, row.games
                            ),
                            14.0,
                            color,
                        );
                    }
                }
            }
            let panel = ui.column(
                root,
                Node {
                    position_type: PositionType::Absolute,
                    right: px(14),
                    top: px(14),
                    width: px(392),
                    ..default()
                },
            );
            ui.text(panel, "ROOM", 26.0, GOLD);
            ui.text(panel, "ARENA", 13.0, MUTED);
            let arenas = ui.row(panel);
            for (index, arena) in graphics.arenas().iter().enumerate() {
                ui.choice(
                    arenas,
                    &arena.name,
                    Act::Arena(index),
                    index == view.arena,
                    px(147),
                );
            }
            if let Some(arena) = graphics.arena(view.arena) {
                ui.text(panel, &arena.description, 13.0, Color::WHITE);
            }
            let racers = || view.actors.iter().filter(|a| !a.inactive && !a.bomber);
            let bots = racers().filter(|a| !a.human).count();
            let people = racers().filter(|a| a.human).count();
            ui.text(panel, "BOTS", 13.0, MUTED);
            let row = ui.row(panel);
            ui.button(row, "-", Act::Bots(bots.saturating_sub(1)), BUTTON, px(44));
            ui.text(row, &format!("  {bots}  "), 18.0, Color::WHITE);
            let more = (bots + 1).min(ROOM_CAPACITY.saturating_sub(people));
            ui.button(row, "+", Act::Bots(more), BUTTON, px(44));
            for (label, field, value, maximum) in [
                ("KILLS TO WIN", "targetScore", view.target_score as usize, 100),
                ("MINUTES", "matchMinutes", (view.duration / 60.0) as usize, 30),
            ] {
                let row = ui.row(panel);
                ui.text(row, label, 13.0, MUTED);
                ui.button(row, "-", Act::MatchLimit(field, value.saturating_sub(1).max(1)), BUTTON, px(44));
                ui.text(row, &format!("  {value}  "), 18.0, Color::WHITE);
                ui.button(row, "+", Act::MatchLimit(field, (value + 1).min(maximum)), BUTTON, px(44));
            }
            ui.text(panel, "SPECIAL ABILITIES", 13.0, MUTED);
            let row = ui.row(panel);
            for (label, enabled) in [("On", true), ("Off", false)] {
                let chosen = view.special_abilities == enabled;
                ui.choice(row, label, Act::Abilities(enabled), chosen, px(72));
            }
            ui.text(panel, "RACER", 13.0, MUTED);
            ui.racers(panel, &graphics, view.player.driver, 175.0);
            ui.colors(
                root,
                menu.color.as_deref(),
                Some(view),
                session.colors.pending,
                &session.colors.message,
            );
            let humans: Vec<_> = racers().filter(|a| a.human).collect();
            let names: Vec<_> = humans
                .iter()
                .map(|a| {
                    let name = a.name.as_deref().unwrap_or("Racer");
                    let elo = session
                        .board
                        .as_deref()
                        .and_then(|b| crate::hud::player_elo(b, Some(name)))
                        .map(|(_, rating, _, _)| rating);
                    let talking = match a.id == view.you {
                        true => session.voice.is_talking(),
                        false => session.voice.is_speaking(a.id),
                    };
                    let tag = match (a.afk, talking) {
                        (true, true) => "AFK, MIC",
                        (true, false) => "AFK",
                        (false, true) => "MIC",
                        (false, false) => "",
                    };
                    match (elo, tag.is_empty()) {
                        (Some(rating), false) => format!("{name} ({rating}, {tag})"),
                        (Some(rating), true) => format!("{name} ({rating})"),
                        (None, false) => format!("{name} ({tag})"),
                        (None, true) => name.to_owned(),
                    }
                })
                .collect();
            ui.text(
                panel,
                &format!("PLAYERS  {}", names.join(", ")),
                13.0,
                MUTED,
            );
            let peers: Vec<_> = humans.iter().filter(|a| a.id != view.you).collect();
            if !peers.is_empty() {
                ui.text(panel, "VOICE  (HOLD V TO TALK)", 12.0, MUTED);
                for peer in peers {
                    let name = peer.name.as_deref().unwrap_or("Racer");
                    let muted = session.voice.is_muted(peer.id);
                    let row = ui.row(panel);
                    let label = match session.voice.is_speaking(peer.id) && !muted {
                        true => format!("{name}  [TALKING]"),
                        false => name.to_owned(),
                    };
                    ui.text(row, &label, 13.0, Color::WHITE);
                    ui.choice(
                        row,
                        match muted {
                            true => "Unmute",
                            false => "Mute",
                        },
                        Act::MuteVoice(peer.id),
                        muted,
                        px(76),
                    );
                }
            }
            if session.voice.is_talking() {
                let live = match session.voice.is_socket_ready() {
                    true => "MIC LIVE",
                    false => "MIC LIVE (VOICE RECONNECTING...)",
                };
                ui.text(panel, live, 12.0, GOLD);
            }
            if let Some(err) = session.voice.error() {
                ui.text(panel, &format!("MIC: {err}"), 12.0, WARNING);
            }
            ui.button(
                panel,
                "START MATCH  (Enter)",
                Act::Start,
                PRIMARY,
                percent(100),
            );
            ui.button(
                panel,
                "Sit out (AFK)  (P)",
                Act::SitOut,
                BUTTON,
                percent(100),
            );
            ui.button(panel, "Leave room", Act::Leave, BUTTON, percent(100));
            ui.text(panel, &session.status, 13.0, WARNING);
        }
        (Screen::Connecting, _) => {
            let panel = ui.column(root, centered);
            ui.text(panel, "CONNECTING", 30.0, GOLD);
            ui.text(panel, &session.status, 16.0, Color::WHITE);
            ui.button(panel, "Cancel  (Esc)", Act::Leave, BUTTON, percent(100));
        }
        (Screen::Menu, _) => {
            let panel = ui.column(root, centered);
            let (title, sit, tone) = match session.away {
                true => ("SITTING OUT", "Return to the arena  (Enter)", PRIMARY),
                false => ("MENU", "Sit out (AFK)  (P)", BUTTON),
            };
            ui.text(panel, title, 30.0, GOLD);
            if session.away {
                ui.text(
                    panel,
                    "Your place and score are saved. The match continues while you are away.",
                    15.0,
                    Color::WHITE,
                );
            } else {
                ui.button(panel, "Resume  (Esc)", Act::Resume, PRIMARY, percent(100));
            }
            ui.button(panel, sit, Act::SitOut, tone, percent(100));
            if let Some(view) = view.as_ref() {
                let peers: Vec<_> = view
                    .actors
                    .iter()
                    .filter(|a| !a.inactive && a.human && a.id != view.you)
                    .collect();
                if !peers.is_empty() {
                    ui.text(panel, "VOICE MUTE  (HOLD V TO TALK)", 12.0, MUTED);
                    for peer in peers {
                        let name = peer.name.as_deref().unwrap_or("Racer");
                        let muted = session.voice.is_muted(peer.id);
                        let row = ui.row(panel);
                        ui.text(row, name, 13.0, Color::WHITE);
                        ui.choice(
                            row,
                            match muted {
                                true => "Unmute",
                                false => "Mute",
                            },
                            Act::MuteVoice(peer.id),
                            muted,
                            px(76),
                        );
                    }
                }
            }
            ui.button(panel, "Leave room", Act::Leave, BUTTON, percent(100));
            ui.button(panel, "Quit game", Act::Quit, BUTTON, percent(100));
            ui.text(panel, CONTROLS, 15.0, MUTED);
        }
        _ => {}
    }
}

pub fn hover(mut buttons: Query<(&RelativeCursorPosition, &Tone, &mut BackgroundColor)>) {
    for (pointer, tone, mut color) in &mut buttons {
        let shown = match pointer.cursor_over() {
            true => tone.0.mix(&Color::WHITE, 0.16),
            false => tone.0,
        };
        if color.0 != shown {
            color.0 = shown;
        }
    }
}

/// Before joining, the chosen racer turns slowly beside the form, as in the browser's picker.
pub fn preview(
    menu: Res<Menu>,
    session: Res<GameSession>,
    graphics: Res<Graphics>,
    time: Res<Time>,
    mut sky: ResMut<ClearColor>,
    mut previews: Query<&mut Ported, With<Preview>>,
    mut cameras: Query<&mut Transform, With<FollowCamera>>,
) {
    let choosing = !session.joined();
    for mut preview in &mut previews {
        let clip = match choosing {
            true => graphics.clip(&format!("driver:{}:idle", menu.driver)),
            false => None,
        };
        if preview.clip != clip {
            preview.clip = clip;
        }
        preview.tint = menu
            .color
            .as_deref()
            .and_then(crate::ported::tint)
            .unwrap_or_else(|| {
                graphics
                    .racers()
                    .get(menu.driver)
                    .map_or([255; 3], |racer| racer.color)
            });
    }
    if !choosing {
        return;
    }
    sky.0 = Color::srgb_u8(0xe5, 0xde, 0xef);
    let tall = matches!(menu.driver, 11 | 12 | 14);
    let (radius, height, focus) = match tall {
        true => (15.0, 9.5, 4.0),
        false => (12.0, 7.4, 2.55),
    };
    let orbit = time.elapsed_secs() * 0.28 + 0.35;
    for mut camera in &mut cameras {
        let eye = PREVIEW + Vec3::new(orbit.sin() * radius, height, orbit.cos() * radius);
        *camera = Transform::from_translation(eye).looking_at(PREVIEW + Vec3::Y * focus, Vec3::Y);
        // Step aside so the racer stands to the right of the form.
        let aside = camera.right() * -radius * 0.42;
        camera.translation += aside;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn menu(arguments: &[&str], saved: Preferences) -> Menu {
        let config = Config::from_args(arguments.iter().map(|a| a.to_string())).unwrap();
        Menu::new(config, saved)
    }
    #[test]
    fn the_menu_opens_with_remembered_choices_unless_a_server_is_given() {
        let saved = Preferences {
            server: Some("https://play.example.test/".into()),
            name: Some("Pearl".into()),
            driver: Some(9),
            color: Some("#e72845".into()),
        };
        let remembered = menu(&[], saved.clone());
        assert_eq!(
            (
                remembered.server.as_str(),
                remembered.name.as_str(),
                remembered.driver
            ),
            ("https://play.example.test/", "Pearl", 9)
        );
        let explicit = menu(
            &["--server", "http://localhost:5189", "--name", "Tester"],
            saved,
        );
        assert_eq!(
            (
                explicit.server.as_str(),
                explicit.name.as_str(),
                explicit.driver
            ),
            ("http://localhost:5189/", "Tester", 0)
        );
    }
    #[test]
    fn typing_respects_the_servers_name_limit_and_ignores_control_characters() {
        let mut menu = menu(&[], Preferences::default());
        menu.name.clear();
        menu.field = Field::Name;
        menu.typed("Pip\u{8}\n");
        assert_eq!(menu.name, "Pip");
        menu.typed(&"x".repeat(40));
        assert_eq!(menu.name.encode_utf16().count(), 24);
    }
}
