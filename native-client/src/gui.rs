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
const ROOM_CAPACITY: usize = 8;
const CONTROLS: &str = "Arrows / WASD   drive\nShift   drift\nSpace   fire\nTab   switch weapon\nX   boost      C   chaff\nZ   flip      F   special ability";

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
    Join,
    Start,
    Arena(usize),
    Bots(usize),
    Abilities(bool),
    Resume,
    SitOut,
    Leave,
    Quit,
}
/// A button's resting color, brightened while the pointer is over it.
#[derive(Component)]
pub struct Tone(Color);
#[derive(Component)]
pub struct Preview;

#[derive(Resource)]
pub struct Menu {
    /// Developer options from the command line, kept for every join.
    base: Config,
    server: String,
    name: String,
    driver: usize,
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
    pub fn screen(&self, session: &GameSession) -> Screen {
        match session.client.as_ref() {
            _ if !session.joined() => Screen::Join,
            None => Screen::Connecting,
            Some(_) if self.open || session.away => Screen::Menu,
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

/// The system clipboard, for pasting a server address.
fn clipboard() -> Option<String> {
    let output = std::process::Command::new("pbpaste").output().ok()?;
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
    mut session: ResMut<GameSession>,
    graphics: Res<Graphics>,
    mut typed: MessageReader<KeyboardInput>,
    keys: Res<ButtonInput<KeyCode>>,
    mouse: Res<ButtonInput<MouseButton>>,
    buttons: Query<(&RelativeCursorPosition, &Act)>,
    mut exit: MessageWriter<AppExit>,
) {
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
            (Screen::Lobby, Key::Enter) => acts.push(Act::Start),
            (Screen::Connecting, Key::Escape) => acts.push(Act::Leave),
            (Screen::Lobby | Screen::Playing, Key::Escape) => menu.open = true,
            (Screen::Menu, Key::Escape) if !session.away => acts.push(Act::Resume),
            _ => {}
        }
    }
    for act in acts {
        let control = |session: &mut GameSession, action| {
            session.request(Command::Control(action));
        };
        match act {
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
            Act::Bots(bots) => control(&mut session, json!({"action":"bots","bots":bots})),
            Act::Abilities(enabled) => control(
                &mut session,
                json!({"action":"special-abilities","enabled":enabled}),
            ),
            Act::Resume => menu.open = false,
            Act::SitOut => {
                let away = !session.away;
                if session.request(Command::Afk(away)) {
                    session.away = away;
                    menu.open = false;
                }
            }
            Act::Leave => {
                session.leave();
                menu.open = false;
            }
            Act::Quit => {
                session.leave();
                exit.write(AppExit::Success);
            }
        }
    }
}

/// Spawns menu widgets beneath a parent node.
struct Builder<'a, 'w, 's>(&'a mut Commands<'w, 's>);
impl Builder<'_, '_, '_> {
    fn node(&mut self, parent: Entity, node: Node, color: Color) -> Entity {
        self.0
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
        self.0.spawn((
            Text::new(text),
            TextFont {
                font_size: FontSize::Px(size),
                ..default()
            },
            TextColor(color),
            ChildOf(parent),
        ));
    }
    /// Empty text that a HUD system fills in every frame.
    fn readout(&mut self, parent: Entity, size: f32, marker: impl Component) {
        self.0.spawn((
            Text::default(),
            TextFont {
                font_size: FontSize::Px(size),
                ..default()
            },
            TextColor(Color::WHITE),
            marker,
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
        self.0
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
) {
    let screen = menu.screen(&session);
    let view = session.client.as_ref().map(|client| client.view());
    // Everything a screen shows; the widgets are rebuilt only when this changes.
    let drawn = match (screen, view.as_ref()) {
        (Screen::Join, _) => format!(
            "join|{}|{}|{:?}|{}|{}",
            menu.server, menu.name, menu.field, menu.driver, menu.notice
        ),
        (Screen::Lobby, Some(view)) => format!(
            "lobby|{}|{}|{}|{}|{}|{}",
            view.arena,
            view.actors
                .iter()
                .filter(|a| !a.inactive)
                .map(|a| format!("{}{}", a.name.as_deref().unwrap_or("bot"), a.human))
                .collect::<Vec<_>>()
                .join(","),
            view.special_abilities,
            view.player.driver,
            view.phase,
            session.status
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
    let mut ui = Builder(&mut commands);
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
            ui.text(panel, "SPECIAL ABILITIES", 13.0, MUTED);
            let row = ui.row(panel);
            for (label, enabled) in [("On", true), ("Off", false)] {
                let chosen = view.special_abilities == enabled;
                ui.choice(row, label, Act::Abilities(enabled), chosen, px(72));
            }
            ui.text(panel, "RACER", 13.0, MUTED);
            ui.racers(panel, &graphics, view.player.driver, 175.0);
            let names: Vec<_> = racers()
                .filter(|a| a.human)
                .map(|a| a.name.as_deref().unwrap_or("Racer"))
                .collect();
            ui.text(
                panel,
                &format!("PLAYERS  {}", names.join(", ")),
                13.0,
                MUTED,
            );
            ui.button(
                panel,
                "START MATCH  (Enter)",
                Act::Start,
                PRIMARY,
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
            let (title, sit) = match session.away {
                true => ("SITTING OUT", "Return to the arena"),
                false => ("MENU", "Sit out (AFK)"),
            };
            ui.text(panel, title, 30.0, GOLD);
            if !session.away {
                ui.button(panel, "Resume  (Esc)", Act::Resume, PRIMARY, percent(100));
            }
            ui.button(panel, sit, Act::SitOut, BUTTON, percent(100));
            ui.button(panel, "Leave room", Act::Leave, BUTTON, percent(100));
            ui.button(panel, "Quit game", Act::Quit, BUTTON, percent(100));
            ui.text(panel, CONTROLS, 15.0, MUTED);
        }
        _ => {
            let hint = ui.node(
                root,
                Node {
                    position_type: PositionType::Absolute,
                    right: px(14),
                    bottom: px(10),
                    ..default()
                },
                Color::NONE,
            );
            ui.text(hint, "Esc  menu", 14.0, Color::WHITE);
        }
    }
}

/// A value the in-match HUD keeps up to date.
#[derive(Component, Clone, Copy, PartialEq, Eq, Debug)]
pub enum Gauge {
    Hedgehogs,
    Missiles,
    Turbos,
    Special,
    Chaff,
    Flip,
    Status,
    Board,
}
/// The label beneath a card's count, or a button's whole text.
#[derive(Component)]
pub struct Caption(Gauge);
#[derive(Component)]
pub struct Count(Gauge);
#[derive(Component)]
pub struct Card(Gauge);
#[derive(Component)]
pub struct HudRoot;
/// Racers whose special ability the browser offers a button for.
const SPECIALISTS: [usize; 8] = [5, 7, 8, 9, 11, 12, 13, 14];
const DISABLED: Color = Color::srgba(0.12, 0.11, 0.18, 0.75);
const POWERED: Color = Color::srgb(0.72, 0.45, 0.12);

/// The browser's weapon cards and action buttons, built once and updated in place.
pub fn setup_hud(mut commands: Commands) {
    let root = commands
        .spawn((
            Node {
                position_type: PositionType::Absolute,
                width: percent(100),
                height: percent(100),
                display: Display::None,
                ..default()
            },
            HudRoot,
        ))
        .id();
    let mut ui = Builder(&mut commands);
    let rack = ui.node(
        root,
        Node {
            position_type: PositionType::Absolute,
            left: px(14),
            bottom: px(12),
            column_gap: px(7),
            ..default()
        },
        Color::NONE,
    );
    for (gauge, action) in [
        (Gauge::Hedgehogs, ClientAction::SelectHedgehog),
        (Gauge::Missiles, ClientAction::SelectMissile),
        (Gauge::Turbos, ClientAction::Boost),
    ] {
        let card = ui.node(
            rack,
            Node {
                width: px(112),
                flex_direction: FlexDirection::Column,
                align_items: AlignItems::Center,
                padding: UiRect::all(px(6)),
                ..default()
            },
            BUTTON,
        );
        ui.0.entity(card).insert((
            RelativeCursorPosition::default(),
            Act::Game(action),
            Tone(BUTTON),
            Card(gauge),
        ));
        ui.readout(card, 32.0, Count(gauge));
        ui.readout(card, 11.0, Caption(gauge));
    }
    let actions = ui.node(
        root,
        Node {
            position_type: PositionType::Absolute,
            right: px(14),
            bottom: px(40),
            width: px(250),
            flex_direction: FlexDirection::Column,
            row_gap: px(8),
            ..default()
        },
        Color::NONE,
    );
    for (gauge, action) in [
        (Gauge::Special, ClientAction::Special),
        (Gauge::Chaff, ClientAction::Chaff),
        (Gauge::Flip, ClientAction::Somersault),
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
            Card(gauge),
        ));
        ui.readout(button, 13.0, Caption(gauge));
    }
    let status = ui.node(
        root,
        Node {
            position_type: PositionType::Absolute,
            left: px(380),
            bottom: px(16),
            ..default()
        },
        Color::NONE,
    );
    ui.readout(status, 14.0, Caption(Gauge::Status));
    let board = ui.node(
        root,
        Node {
            position_type: PositionType::Absolute,
            right: px(14),
            top: px(14),
            padding: UiRect::all(px(10)),
            ..default()
        },
        PANEL,
    );
    ui.readout(board, 14.0, Caption(Gauge::Board));
}

type Readouts<'w, 's> = Query<
    'w,
    's,
    (
        Option<&'static Count>,
        Option<&'static Caption>,
        &'static mut Text,
    ),
    Or<(With<Count>, With<Caption>)>,
>;

pub fn hud(
    session: Res<GameSession>,
    menu: Res<Menu>,
    graphics: Res<Graphics>,
    mut roots: Query<&mut Node, (With<HudRoot>, Without<Card>)>,
    mut cards: Query<(&Card, &mut Tone, &mut Node)>,
    mut readouts: Readouts,
) {
    let view = session.client.as_ref().map(|client| client.view());
    let shown = view
        .as_ref()
        .filter(|_| menu.screen(&session) == Screen::Playing);
    for mut root in &mut roots {
        let display = match shown {
            Some(_) => Display::Flex,
            None => Display::None,
        };
        if root.display != display {
            root.display = display;
        }
    }
    let Some(view) = shown else {
        return;
    };
    let p = view.player;
    let live = view.phase == "racing" && p.destroyed <= 0.0;
    let powered = p.vulcan > 0.0;
    let ability = graphics
        .racers()
        .get(p.driver)
        .map(|racer| racer.ability.as_str())
        .filter(|_| SPECIALISTS.contains(&p.driver) && view.special_abilities);
    // Each gauge's count, caption, whether it can be used now, and its highlight.
    let gauge = |gauge: Gauge| -> (String, String, bool, Option<Color>) {
        let chosen = |item: &str| (p.item == item).then_some(SELECTED);
        match gauge {
            Gauge::Hedgehogs => (
                match powered {
                    true => "MAX".into(),
                    false => p.ammo.to_string(),
                },
                match (powered, p.driver) {
                    (true, 14) => "UZI".into(),
                    (true, _) => "VULCAN".into(),
                    _ => "HEDGEHOGS".into(),
                },
                powered || p.ammo > 0,
                match powered {
                    true => Some(POWERED),
                    false => chosen("hedgehog"),
                },
            ),
            Gauge::Missiles => (
                p.missiles.to_string(),
                "MISSILES".into(),
                p.missiles > 0,
                chosen("missile"),
            ),
            Gauge::Turbos => (
                p.turbos.to_string(),
                "X  TURBO".into(),
                live && p.turbos > 0 && p.boost <= 0.0,
                None,
            ),
            Gauge::Special => {
                let hunting = view.locusts.iter().filter(|b| b.owner == view.you).count();
                let label = match (p.special_cooldown > 0.0, p.driver) {
                    (true, _) => format!("F  RECHARGE {:.1}s", p.special_cooldown),
                    (false, 5) => format!("F  {}  {hunting} LOCUSTS", ability.unwrap_or("")),
                    _ => format!("F  {}", ability.unwrap_or("")),
                };
                let ready =
                    live && p.special_cooldown <= 0.0 && !(p.driver == 12 && p.health >= 6.0);
                (String::new(), label, ready, None)
            }
            Gauge::Chaff => (
                String::new(),
                format!("C  CHAFF {}", p.chaff),
                live && p.chaff > 0 && p.chaff_cooldown <= 0.0,
                None,
            ),
            Gauge::Flip => (
                String::new(),
                match p.somersault_cooldown > 1e-8 {
                    true => format!("Z  {:.1}s", p.somersault_cooldown),
                    false => "Z  SOMERSAULT".into(),
                },
                live && p.somersault_cooldown <= 1e-8,
                None,
            ),
            Gauge::Status => {
                let mut lines = Vec::new();
                if live && p.hedge_shield > 0.0 {
                    let blocks = match p.tehilim > 0.0 {
                        true => "HEDGEHOGS + BOMBS BLOCKED",
                        false => "MISSILES STILL HURT",
                    };
                    lines.push(format!("HEDGEGUARD  {:.1}s  {blocks}", p.hedge_shield));
                }
                if live && p.tehilim > 0.0 {
                    lines.push(format!(
                        "TEHILIM VS TILIM  {:.1}s  MISSILE REPULSION",
                        p.tehilim
                    ));
                }
                if live && powered {
                    lines.push(format!("RAPID FIRE  {:.0}s", p.vulcan.ceil()));
                }
                if view.phase == "racing" && p.was_drifting {
                    lines.push(
                        match p.drift {
                            charge if charge >= 0.85 => "SUPER BOOST READY",
                            charge if charge >= 0.45 => "BOOST READY",
                            _ => "DRIFT CHARGING",
                        }
                        .into(),
                    );
                }
                (String::new(), lines.join("\n"), true, None)
            }
            Gauge::Board => {
                let mut racers: Vec<_> = view
                    .actors
                    .iter()
                    .filter(|a| !a.inactive && !a.bomber)
                    .collect();
                racers.sort_by(|a, b| b.kills.total_cmp(&a.kills).then(a.id.cmp(&b.id)));
                let rows: Vec<_> = racers
                    .iter()
                    .take(8)
                    .map(|a| {
                        // Bots go by their racer's name, as in the browser.
                        let racer = graphics.racers().get(a.driver);
                        let name = a
                            .name
                            .as_deref()
                            .or(racer.map(|racer| racer.name.as_str()))
                            .unwrap_or("Racer");
                        format!("{:>4.1}  {name}", a.kills)
                    })
                    .collect();
                (String::new(), rows.join("\n"), true, None)
            }
        }
    };
    for (count, caption, mut text) in &mut readouts {
        let value = match (count, caption) {
            (Some(Count(of)), _) => gauge(*of).0,
            (_, Some(Caption(of))) => gauge(*of).1,
            _ => continue,
        };
        if text.0 != value {
            text.0 = value;
        }
    }
    for (card, mut tone, mut node) in &mut cards {
        let (_, _, usable, highlight) = gauge(card.0);
        let color = match (usable, highlight) {
            (_, Some(color)) => color,
            (true, None) => BUTTON,
            (false, None) => DISABLED,
        };
        if tone.0 != color {
            tone.0 = color;
        }
        let display = match card.0 == Gauge::Special && ability.is_none() {
            true => Display::None,
            false => Display::Flex,
        };
        if node.display != display {
            node.display = display;
        }
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
            preview.tint = graphics
                .racers()
                .get(menu.driver)
                .map_or([255; 3], |racer| racer.color);
        }
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
