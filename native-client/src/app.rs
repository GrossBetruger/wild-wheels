use crate::{
    config::Config,
    transport::{Command, Event, Transport},
};
use bevy::prelude::*;
use std::{
    error::Error,
    time::{Duration, Instant},
};
use wild_wheels_core::{ClientAction, ClientInput, NativeClient};

/// Matches `dedicated-server/src/room.rs` (`player-away` after 15 seconds).
const UNFOCUSED_AWAY_SECONDS: f64 = 15.0;

/// Puts the player into AFK when the game window is left in the background,
/// matching the browser client's `blur`/`visibilitychange` and background-tab rules.
#[derive(Default, Debug)]
pub(crate) struct FocusAfk {
    ever_focused: bool,
    unfocused_since: Option<f64>,
}
impl FocusAfk {
    pub fn reset(&mut self) {
        *self = Self::default();
    }
    pub fn should_sit_out(
        &mut self,
        now: f64,
        window_focused: bool,
        phase: Option<&str>,
        away: bool,
        automated: bool,
    ) -> bool {
        if window_focused {
            self.ever_focused = true;
            self.unfocused_since = None;
            return false;
        }
        if automated || away || phase.is_none() {
            self.unfocused_since = None;
            return false;
        }
        let since = *self.unfocused_since.get_or_insert(now);
        let unfocused_for = (now - since).max(0.0);
        if matches!(phase, Some("countdown" | "racing"))
            && (self.ever_focused || unfocused_for >= UNFOCUSED_AWAY_SECONDS)
        {
            self.unfocused_since = None;
            return true;
        }
        if unfocused_for >= UNFOCUSED_AWAY_SECONDS {
            self.unfocused_since = None;
            return true;
        }
        false
    }
}

#[derive(Resource)]
pub struct GameSession {
    pub colors: crate::colors::Selection,
    pub chat: crate::chat::Chat,
    pub voice: crate::voice::Voice,
    pub client: Option<NativeClient>,
    pub status: String,
    pub sounds: Vec<String>,
    /// Racer calls waiting to be heard: driver, cue and volume.
    pub voices: Vec<(usize, String, f64)>,
    transport: Option<Transport>,
    epoch: Instant,
    last_send: f64,
    /// The connection the current client was built from; see `Command::Input`.
    connection: u64,
    pub away: bool,
    /// True after `set_away(false)` until the fresh resumed connection arrives, so
    /// stale pre-AFK packets cannot immediately bounce the player back to AFK.
    resuming: bool,
    focus: FocusAfk,
    observed: Option<(u32, u64)>,
    metrics: crate::metrics::Metrics,
    /// For the problem log: frame times, and when the server was last heard from.
    health: crate::reports::FrameHealth,
    heard: f64,
    /// The server's all-time leaderboard, best first: name, rating, wins and games
    /// played. `None` until a server has sent one, so one without a board shows none.
    pub board: Option<Vec<(String, f64, u64, u64)>>,
    /// The match phase last seen, to fetch the board again when a match finishes.
    phase: String,
}
impl GameSession {
    pub(crate) fn new() -> Self {
        Self {
            colors: Default::default(),
            chat: Default::default(),
            voice: Default::default(),
            client: None,
            status: String::new(),
            sounds: vec![],
            voices: vec![],
            transport: None,
            epoch: Instant::now(),
            last_send: 0.0,
            connection: 0,
            away: false,
            resuming: false,
            focus: Default::default(),
            observed: None,
            metrics: Default::default(),
            health: Default::default(),
            heard: 0.0,
            board: None,
            phase: String::new(),
        }
    }
    /// Whether the player has asked to be in a room, connected yet or not.
    pub fn joined(&self) -> bool {
        self.transport.is_some()
    }
    pub fn join(&mut self, config: Config) {
        self.leave();
        self.colors = crate::colors::Selection {
            preferred: config.color.clone(),
            ..Default::default()
        };
        self.status = "Connecting...".into();
        self.board = None;
        self.transport = Some(Transport::spawn(config));
    }
    /// Gives up the seat in the room and returns to the menu.
    pub fn leave(&mut self) {
        self.colors.pending = false;
        self.chat.clear();
        self.voice.disconnect();
        if let Some(transport) = self.transport.take() {
            let _ = transport.commands.try_send(Command::Leave);
        }
        self.client = None;
        self.away = false;
        self.resuming = false;
        self.focus.reset();
        self.status.clear();
    }
    /// Transitions into or out of AFK (`Sitting out`).
    pub fn set_away(&mut self, away: bool) -> bool {
        if self.away == away || !self.joined() {
            return false;
        }
        if self.request(Command::Afk(away)) {
            self.away = away;
            if away {
                self.resuming = false;
            } else {
                self.client = None;
                self.resuming = true;
            }
            return true;
        }
        false
    }
    /// Performs one of the racer's actions, as a key press or a HUD button would.
    pub fn act(&mut self, action: ClientAction) {
        let now = self.epoch.elapsed().as_secs_f64();
        if let Some(client) = self.client.as_mut() {
            let _ = client.action(action, now);
        }
    }
    /// Sends a room request; `false` when the network worker cannot take it now.
    pub fn request(&mut self, command: Command) -> bool {
        self.transport
            .as_ref()
            .is_some_and(|transport| transport.commands.try_send(command).is_ok())
    }
    pub fn choose_color(&mut self, color: &str) {
        let Some(client) = self.client.as_ref() else {
            return;
        };
        let view = client.view();
        if self.colors.pending
            || !crate::colors::editable(view.phase)
            || !crate::colors::valid(color)
            || crate::colors::occupied(&view, color)
        {
            return;
        }
        if self.request(Command::Color(color.into())) {
            self.colors.pending = true;
            self.colors.message = "Saving color...".into();
        }
    }
    fn receive(&mut self, now: f64) {
        let Some(transport) = self.transport.as_ref() else {
            return;
        };
        while let Ok(event) = transport.events.try_recv() {
            match event {
                Event::ColorPreference(color) => self.colors.preferred = color,
                Event::Leaderboard(board) => self.board = Some(board),
                Event::ColorResult(result) => {
                    self.colors.pending = false;
                    match result {
                        Ok(color) => {
                            self.colors.preferred = Some(color);
                            self.colors.message.clear();
                        }
                        Err(error) => self.colors.message = error,
                    }
                }
                Event::Session { origin, token } => {
                    self.chat.connect(origin.clone(), token.clone());
                    self.voice.connect(origin, token);
                }
                Event::Status(status) => {
                    self.status = status;
                }
                Event::Connected(connection) => {
                    self.connection = connection;
                    self.colors.pending = false;
                    self.metrics.connected();
                    self.client = None;
                    self.resuming = false;
                    self.status = "Connected".into();
                }
                Event::Error(error) => {
                    crate::reports::note(
                        "error",
                        "connection-ended",
                        serde_json::json!({"reason":error}),
                    );
                    self.status = error;
                    self.client = None;
                    self.resuming = false;
                }
                Event::Packet(bytes) => {
                    if self.resuming {
                        continue;
                    }
                    self.heard = now;
                    let result = match self.client.as_mut() {
                        Some(client) => client.accept(&bytes, now),
                        None => NativeClient::from_packet(&bytes, now)
                            .map(|client| self.client = Some(client)),
                    };
                    if let Err(error) = result {
                        crate::reports::limited(
                            "packet",
                            10.0,
                            "error",
                            "packet-invalid",
                            || serde_json::json!({"error":error.to_string(),"bytes":bytes.len()}),
                        );
                        self.status = format!("Protocol error: {error}");
                        self.client = None;
                    }
                }
            }
        }
        let mut finished = false;
        let mut server_afk = false;
        if let Some(client) = self.client.as_ref() {
            let view = client.view();
            if view.phase != "racing" || view.player.destroyed > 0.0 || view.player.afk {
                self.metrics.inactive();
            }
            server_afk = view.player.afk;
            self.metrics.acknowledged(view.movement_ack, now);
            if view.phase != self.phase {
                self.phase = view.phase.to_owned();
                finished = view.phase == "finished";
            }
            let state = (view.player.deaths, view.player.health.to_bits());
            if self.observed != Some(state) {
                println!(
                    "{}",
                    serde_json::json!({"event":"player-health","name":view.player.name,"health":view.player.health,"deaths":view.player.deaths,"destroyed":view.player.destroyed})
                );
                self.observed = Some(state);
            }
        }
        if server_afk && !self.away {
            self.set_away(true);
        }
        // The board changes when a match finishes; ask for it then.
        if finished {
            self.request(Command::Leaderboard);
        }
    }
    fn send(&mut self, input: ClientInput, now: f64) {
        let Some(transport) = self.transport.as_ref() else {
            return;
        };
        if now - self.last_send < 1.0 / 30.0 || transport.commands.len() >= 4 {
            return;
        }
        let Some(client) = self.client.as_mut() else {
            return;
        };
        match client.outbound(input) {
            Ok(bytes) => match transport
                .commands
                .try_send(Command::Input(self.connection, bytes))
            {
                Ok(()) => {
                    self.last_send = now;
                    self.metrics.sent(client.last_sent_movement(), now);
                }
                Err(_) => self.status = "Network worker stopped".into(),
            },
            Err(error) => self.status = error.to_string(),
        }
    }
}
// The game's own work is a fraction of a millisecond per frame; Bevy's default
// of one worker per core spends more waking idle threads than it saves.
// WILD_WHEELS_THREADS overrides the total for measurements.
/// Worker threads for Bevy's task pools in total: input/output, async compute
/// (where pack meshes are built) and compute.
const THREADS: usize = 4;
pub fn run(mut config: Config) -> Result<(), Box<dyn Error>> {
    if config.color.is_none() {
        config.color = crate::prefs::Preferences::load()
            .color
            .filter(|c| crate::colors::valid(c));
    }
    if config.headless {
        return headless(config);
    }
    if let Some(scene) = config.showcase.clone() {
        return crate::showcase::run(config, &scene);
    }
    let screenshot = config.screenshot.clone();
    let benchmark = config.benchmark;
    let paced = std::env::var_os("WILD_WHEELS_BENCH_VSYNC").is_some();
    // Only a benchmark runs offscreen: the match is otherwise played on screen.
    let offscreen = config.offscreen && benchmark.is_some();
    use crate::bench::mark;
    let mut session = GameSession::new();
    if config.join {
        session.join(config.clone());
    }
    let mut app = App::new();
    let plugins = DefaultPlugins
        .set(bevy::app::TaskPoolPlugin {
            task_pool_options: bevy::app::TaskPoolOptions::with_num_threads(
                std::env::var("WILD_WHEELS_THREADS")
                    .ok()
                    .and_then(|threads| threads.parse().ok())
                    .unwrap_or(THREADS),
            ),
        })
        .set(WindowPlugin {
            primary_window: Some(Window {
                title: "Wild Wheels".into(),
                resolution: (1280, 800).into(),
                // A benchmark measures how fast frames can be made, not the display's
                // rate, unless WILD_WHEELS_BENCH_VSYNC asks for the cost of normal play.
                present_mode: match benchmark.filter(|_| !paced) {
                    Some(_) => bevy::window::PresentMode::AutoNoVsync,
                    None => bevy::window::PresentMode::AutoVsync,
                },
                ..default()
            }),
            ..default()
        });
    match offscreen {
        // No window and no event loop: frames run back to back, each waiting for the GPU.
        true => app
            .add_plugins(
                plugins
                    .set(WindowPlugin {
                        primary_window: None,
                        exit_condition: bevy::window::ExitCondition::DontExit,
                        ..default()
                    })
                    .disable::<bevy::winit::WinitPlugin>(),
            )
            .add_plugins((
                bevy::app::ScheduleRunnerPlugin::run_loop(std::time::Duration::ZERO),
                crate::offscreen::OffscreenPlugin,
            )),
        false => app.add_plugins(plugins),
    };
    // Sound and on-screen work still run offscreen, so the frame cost is the game's.
    app.insert_resource(crate::scene::Capture(screenshot))
        .insert_resource(session)
        .insert_resource(crate::gui::Menu::new(
            config,
            crate::prefs::Preferences::load(),
        ))
        .insert_resource(ClearColor(Color::srgb(0.71, 0.83, 0.85)))
        .insert_resource(crate::bench::Bench::new(benchmark))
        .add_plugins((
            crate::ported::PortedGraphicsPlugin,
            crate::scene::ArenaPresentationPlugin,
            crate::sound::GameAudioPlugin,
            crate::feedback::FeedbackPlugin,
        ))
        .init_resource::<crate::hud::Notices>()
        .init_resource::<crate::chat::ChatPanel>()
        .add_systems(Startup, (crate::gui::setup, crate::hud::setup))
        .add_systems(
            Update,
            (
                (
                    crate::bench::begin,
                    crate::chat::control,
                    crate::gui::control,
                    mark(0),
                    drive,
                    mark(1),
                    crate::scene::sync,
                    mark(2),
                    crate::gui::preview,
                    mark(3),
                    crate::ported::animate,
                    mark(4),
                )
                    .chain(),
                (
                    crate::sound::play,
                    mark(5),
                    crate::feedback::sync_match,
                    mark(6),
                    crate::gui::draw,
                    crate::gui::hover,
                    mark(7),
                    crate::hud::update,
                    crate::chat::draw,
                    crate::chat::scroll,
                    mark(8),
                    crate::bench::finish,
                )
                    .chain(),
            )
                .chain(),
        )
        .run();
    Ok(())
}
pub(crate) fn drive(
    mut session: ResMut<GameSession>,
    mut menu: ResMut<crate::gui::Menu>,
    chat: Res<crate::chat::ChatPanel>,
    keys: Res<ButtonInput<KeyCode>>,
    windows: Query<&Window>,
    time: Res<Time>,
) {
    let now = session.epoch.elapsed().as_secs_f64();
    session.receive(now);
    let window_focused = windows.iter().any(|w| w.focused);
    let pilot = std::env::var_os("WILD_WHEELS_PILOT_SPECIAL").is_some();
    let automated = windows.is_empty() || menu.is_benchmark() || pilot;
    let away = session.away;
    let phase = session.client.as_ref().map(|c| c.view().phase.to_owned());
    if session
        .focus
        .should_sit_out(now, window_focused, phase.as_deref(), away, automated)
        && session.set_away(true)
    {
        menu.open = false;
    }
    // A window in the background draws slowly by design; that is not a problem to report.
    let (racing, clock) = session.client.as_ref().map_or((false, (0, 0.0)), |client| {
        let view = client.view();
        (
            view.phase == "racing" && !view.player.afk,
            (view.epoch, view.elapsed),
        )
    });
    let racing = racing && !session.away && window_focused;
    let heard = session.heard;
    session.health.frame(now, racing, heard, clock);
    // Keys pressed while the menu is open belong to the menu.
    let focused = window_focused && !menu.open && !chat.capture_frame;
    let ptt_allowed = window_focused && !chat.capture_frame && session.joined();
    let modifier = keys.pressed(KeyCode::SuperLeft)
        || keys.pressed(KeyCode::SuperRight)
        || keys.pressed(KeyCode::ControlLeft)
        || keys.pressed(KeyCode::ControlRight)
        || keys.pressed(KeyCode::AltLeft)
        || keys.pressed(KeyCode::AltRight);
    let talking = ptt_allowed && !modifier && keys.pressed(KeyCode::KeyV);
    session.voice.set_talking(talking);
    let held = |codes: &[KeyCode]| focused && codes.iter().any(|key| keys.pressed(*key));
    let input = ClientInput {
        keys: u32::from(held(&[KeyCode::ArrowUp, KeyCode::KeyW]))
            | (u32::from(held(&[KeyCode::ArrowDown, KeyCode::KeyS])) << 1)
            | (u32::from(held(&[KeyCode::ArrowRight, KeyCode::KeyD])) << 2)
            | (u32::from(held(&[KeyCode::ArrowLeft, KeyCode::KeyA])) << 3)
            | (u32::from(held(&[KeyCode::ShiftLeft, KeyCode::ShiftRight])) << 4),
        steer: None,
    };
    if session.away {
        return;
    }
    let Some(client) = session.client.as_mut() else {
        return;
    };
    // A developer run can hand the controls to the sparring pilot.
    let input = match pilot {
        true => crate::pilot::drive(client, now),
        false => input,
    };
    if let Err(error) = client.advance(time.delta_secs_f64().min(0.05), input, now) {
        crate::reports::limited(
            "advance",
            10.0,
            "error",
            "prediction-failed",
            || serde_json::json!({"error":error.to_string()}),
        );
        session.status = error.to_string();
        return;
    }
    for (trigger, action) in [
        (held(&[KeyCode::Space]), ClientAction::Fire),
        (
            focused
                && [
                    KeyCode::Tab,
                    KeyCode::KeyQ,
                    KeyCode::SuperLeft,
                    KeyCode::SuperRight,
                ]
                .iter()
                .any(|k| keys.just_pressed(*k)),
            ClientAction::CycleWeapon,
        ),
        (
            focused && keys.just_pressed(KeyCode::KeyX),
            ClientAction::Boost,
        ),
        (
            focused && keys.just_pressed(KeyCode::KeyC),
            ClientAction::Chaff,
        ),
        (
            focused && keys.just_pressed(KeyCode::KeyZ),
            ClientAction::Somersault,
        ),
        (
            focused && keys.just_pressed(KeyCode::KeyF),
            ClientAction::Special,
        ),
    ] {
        if trigger {
            let _ = client.action(action, now);
        }
    }
    let voices = client.drain_voices();
    let sounds = client.drain_audio();
    session.sounds.extend(sounds);
    session.voices.extend(voices);
    if window_focused || automated {
        session.send(input, now);
    }
}
fn headless(config: Config) -> Result<(), Box<dyn Error>> {
    let seconds = config.seconds;
    let sparring = config.sparring;
    let mut session = GameSession::new();
    session.join(config);
    let start = Instant::now();
    let mut previous = start;
    let mut origin = None;
    let mut max_distance = 0.0f64;
    let mut frames = 0;
    let mut ack = -1;
    let mut action_ack = -1;
    let mut shots = 0;
    let mut last_shot = 0.0;
    let mut initial_kills = None;
    let mut deaths = 0;
    while start.elapsed().as_secs_f64() < seconds {
        let now = start.elapsed().as_secs_f64();
        session.receive(now);
        let dt = previous.elapsed().as_secs_f64().min(0.05);
        previous = Instant::now();
        if let Some(client) = session.client.as_mut() {
            let input = match sparring {
                true => crate::pilot::drive(client, now),
                false => ClientInput {
                    keys: 1,
                    steer: None,
                },
            };
            let cost = Instant::now();
            client.advance(dt, input, now)?;
            session
                .metrics
                .frame(cost.elapsed().as_secs_f64() * 1e6, now);
            if !sparring && now - last_shot > 0.5 && client.action(ClientAction::Fire, now)? {
                shots += 1;
                last_shot = now;
            }
            let view = client.view();
            deaths = view.player.deaths;
            let initial = *initial_kills.get_or_insert(view.player.kills);
            if sparring && view.player.kills >= initial + 2.0 {
                println!(
                    "{}",
                    serde_json::json!({"event":"sparring-complete","kills":view.player.kills,"gained":view.player.kills-initial})
                );
                return Ok(());
            }
            let p = (view.player.wx, view.player.wz);
            let from = *origin.get_or_insert(p);
            max_distance = max_distance.max((p.0 - from.0).hypot(p.1 - from.1));
            ack = view.movement_ack;
            action_ack = view.action_ack;
            frames += 1;
            session.send(input, now);
        }
        std::thread::sleep(Duration::from_millis(16));
    }
    let pass = frames > 0 && ack >= 0 && action_ack >= 0 && max_distance > 1.0 && shots > 0;
    println!(
        "{}",
        serde_json::json!({"pass":pass,"frames":frames,"movementAck":ack,"actionAck":action_ack,"distance":max_distance,"shotsRequested":shots,"deaths":deaths,"status":session.status,"metrics":session.metrics.report()})
    );
    if !pass {
        return Err(
            "Headless arena smoke did not observe movement, acknowledgement, and firing".into(),
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn losing_window_focus_during_countdown_or_racing_immediately_triggers_afk() {
        let mut focus = FocusAfk::default();
        assert!(!focus.should_sit_out(1.0, true, Some("racing"), false, false));
        assert!(focus.should_sit_out(1.1, false, Some("racing"), false, false));

        focus.reset();
        assert!(!focus.should_sit_out(2.0, true, Some("countdown"), false, false));
        assert!(focus.should_sit_out(2.1, false, Some("countdown"), false, false));
    }

    #[test]
    fn match_starting_while_window_is_unfocused_in_background_immediately_triggers_afk() {
        let mut focus = FocusAfk::default();
        // Player finishes a match and switches away from the window.
        assert!(!focus.should_sit_out(10.0, true, Some("finished"), false, false));
        assert!(!focus.should_sit_out(11.0, false, Some("finished"), false, false));
        assert!(!focus.should_sit_out(14.0, false, Some("finished"), false, false));
        // Another player starts a match while this window is still unfocused.
        assert!(focus.should_sit_out(15.0, false, Some("countdown"), false, false));
    }

    #[test]
    fn unfocused_lobby_window_waits_fifteen_seconds_before_sitting_out() {
        let mut focus = FocusAfk::default();
        assert!(!focus.should_sit_out(5.0, true, Some("ready"), false, false));
        assert!(!focus.should_sit_out(10.0, false, Some("ready"), false, false));
        assert!(!focus.should_sit_out(24.9, false, Some("ready"), false, false));
        assert!(focus.should_sit_out(25.0, false, Some("ready"), false, false));

        // Returning focus before 15 seconds resets the background timer.
        let mut focus = FocusAfk::default();
        assert!(!focus.should_sit_out(0.0, true, Some("finished"), false, false));
        assert!(!focus.should_sit_out(1.0, false, Some("finished"), false, false));
        assert!(!focus.should_sit_out(12.0, false, Some("finished"), false, false));
        assert!(!focus.should_sit_out(12.5, true, Some("finished"), false, false));
        assert!(!focus.should_sit_out(20.0, false, Some("finished"), false, false));
        assert!(!focus.should_sit_out(34.9, false, Some("finished"), false, false));
        assert!(focus.should_sit_out(35.0, false, Some("finished"), false, false));
    }

    #[test]
    fn startup_grace_and_automated_runs_do_not_falsely_sit_out() {
        // Before the OS has focused a newly spawned window for the first time,
        // wait the full 15s threshold even if `--auto-start` enters countdown immediately.
        let mut focus = FocusAfk::default();
        assert!(!focus.should_sit_out(0.1, false, Some("countdown"), false, false));
        assert!(!focus.should_sit_out(15.0, false, Some("racing"), false, false));
        assert!(focus.should_sit_out(15.1, false, Some("racing"), false, false));

        // Automated benchmark/pilot runs never sit out due to window focus.
        let mut automated = FocusAfk::default();
        assert!(!automated.should_sit_out(1.0, true, Some("racing"), false, true));
        assert!(!automated.should_sit_out(2.0, false, Some("racing"), false, true));
        assert!(!automated.should_sit_out(100.0, false, Some("ready"), false, true));
    }

    #[test]
    fn returning_from_afk_ignores_stale_pre_afk_packets_until_reconnected() {
        use wild_wheels_core::NativeArena;

        let config = serde_json::json!({
            "maxPlayers": 6, "code": "00", "arena": 0, "bots": 0,
            "host": null, "dedicated": true, "epoch": 1, "seed": 1,
            "players": [{"id": 0, "name": "Oren", "driver": 0, "role": "driver", "afk": true}]
        });
        let mut arena = NativeArena::new(config).unwrap();
        let afk_packet = arena.packet_with_cues(0, vec![], vec![]);

        let (cmd_tx, cmd_rx) = crossbeam_channel::bounded(8);
        let (evt_tx, evt_rx) = crossbeam_channel::bounded(8);
        let mut session = GameSession::new();
        session.transport = Some(Transport {
            events: evt_rx,
            commands: cmd_tx,
        });
        session.client = Some(NativeClient::from_packet(&afk_packet, 1.0).unwrap());
        session.away = true;

        // Clicking BACK TO ARENA clears the stale client and enters resuming state.
        assert!(session.set_away(false));
        assert!(!session.away);
        assert!(session.client.is_none());
        assert!(matches!(cmd_rx.try_recv(), Ok(Command::Afk(false))));

        // A stale AFK packet that arrived before Event::Connected must not bounce back to AFK.
        evt_tx.send(Event::Packet(afk_packet.clone())).unwrap();
        session.receive(1.1);
        assert!(!session.away);
        assert!(session.client.is_none());
        assert!(cmd_rx.try_recv().is_err());

        // Once the fresh connection is established, subsequent packets are processed normally.
        evt_tx.send(Event::Connected(2)).unwrap();
        let active_config = serde_json::json!({
            "maxPlayers": 6, "code": "00", "arena": 0, "bots": 0,
            "host": null, "dedicated": true, "epoch": 1, "seed": 1,
            "players": [{"id": 0, "name": "Oren", "driver": 0, "role": "driver", "afk": false}]
        });
        arena.configure(active_config).unwrap();
        let active_packet = arena.packet_with_cues(0, vec![], vec![]);
        evt_tx.send(Event::Packet(active_packet)).unwrap();
        session.receive(1.2);
        assert!(!session.away);
        assert!(session.client.is_some());
    }
}
