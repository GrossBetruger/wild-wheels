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

#[derive(Resource)]
pub struct GameSession {
    pub client: Option<NativeClient>,
    pub status: String,
    pub sounds: Vec<String>,
    /// Racer calls waiting to be heard: driver, cue and volume.
    pub voices: Vec<(usize, String, f64)>,
    transport: Option<Transport>,
    epoch: Instant,
    last_send: f64,
    pub away: bool,
    observed: Option<(u32, u64)>,
    metrics: crate::metrics::Metrics,
}
impl GameSession {
    fn new() -> Self {
        Self {
            client: None,
            status: String::new(),
            sounds: vec![],
            voices: vec![],
            transport: None,
            epoch: Instant::now(),
            last_send: 0.0,
            away: false,
            observed: None,
            metrics: Default::default(),
        }
    }
    /// Whether the player has asked to be in a room, connected yet or not.
    pub fn joined(&self) -> bool {
        self.transport.is_some()
    }
    pub fn join(&mut self, config: Config) {
        self.leave();
        self.status = "Connecting...".into();
        self.transport = Some(Transport::spawn(config));
    }
    /// Gives up the seat in the room and returns to the menu.
    pub fn leave(&mut self) {
        if let Some(transport) = self.transport.take() {
            let _ = transport.commands.try_send(Command::Leave);
        }
        self.client = None;
        self.away = false;
        self.status.clear();
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
    fn receive(&mut self, now: f64) {
        let Some(transport) = self.transport.as_ref() else {
            return;
        };
        while let Ok(event) = transport.events.try_recv() {
            match event {
                Event::Status(status) => {
                    self.status = status;
                }
                Event::Connected => {
                    self.metrics.connected();
                    self.client = None;
                    self.status = "Connected".into();
                }
                Event::Error(error) => {
                    self.status = error;
                    self.client = None;
                }
                Event::Packet(bytes) => {
                    let result = match self.client.as_mut() {
                        Some(client) => client.accept(&bytes, now),
                        None => NativeClient::from_packet(&bytes, now)
                            .map(|client| self.client = Some(client)),
                    };
                    if let Err(error) = result {
                        self.status = format!("Protocol error: {error}");
                        self.client = None;
                    }
                }
            }
        }
        if let Some(client) = self.client.as_ref() {
            let view = client.view();
            if view.phase != "racing" || view.player.destroyed > 0.0 || view.player.afk {
                self.metrics.inactive();
            }
            self.metrics.acknowledged(view.movement_ack, now);
            let state = (view.player.deaths, view.player.health.to_bits());
            if self.observed != Some(state) {
                println!(
                    "{}",
                    serde_json::json!({"event":"player-health","name":view.player.name,"health":view.player.health,"deaths":view.player.deaths,"destroyed":view.player.destroyed})
                );
                self.observed = Some(state);
            }
        }
    }
    fn send(&mut self, input: ClientInput, now: f64) {
        let Some(transport) = self.transport.as_ref() else {
            return;
        };
        if now - self.last_send < 1.0 / 30.0 || transport.commands.is_full() {
            return;
        }
        let Some(client) = self.client.as_mut() else {
            return;
        };
        match client.outbound(input) {
            Ok(bytes) => match transport.commands.try_send(Command::Input(bytes)) {
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
pub fn run(config: Config) -> Result<(), Box<dyn Error>> {
    if config.headless {
        return headless(config);
    }
    let screenshot = config.screenshot.clone();
    let mut session = GameSession::new();
    if config.join {
        session.join(config.clone());
    }
    App::new()
        .insert_resource(crate::scene::Capture(screenshot))
        .insert_resource(session)
        .insert_resource(crate::gui::Menu::new(
            config,
            crate::prefs::Preferences::load(),
        ))
        .insert_resource(ClearColor(Color::srgb(0.71, 0.83, 0.85)))
        .add_plugins(DefaultPlugins.set(WindowPlugin {
            primary_window: Some(Window {
                title: "Wild Wheels".into(),
                resolution: (1280, 800).into(),
                ..default()
            }),
            ..default()
        }))
        .add_plugins((
            crate::ported::PortedGraphicsPlugin,
            crate::scene::ArenaPresentationPlugin,
            crate::sound::GameAudioPlugin,
            crate::feedback::FeedbackPlugin,
        ))
        .add_systems(Startup, (crate::gui::setup, crate::gui::setup_hud))
        .add_systems(
            Update,
            (
                crate::gui::control,
                drive,
                crate::scene::sync,
                crate::gui::preview,
                crate::ported::animate,
                crate::sound::play,
                crate::feedback::sync_match,
                crate::gui::draw,
                crate::gui::hud,
                crate::gui::hover,
            )
                .chain(),
        )
        .run();
    Ok(())
}
fn drive(
    mut session: ResMut<GameSession>,
    menu: Res<crate::gui::Menu>,
    keys: Res<ButtonInput<KeyCode>>,
    windows: Query<&Window>,
    time: Res<Time>,
) {
    let now = session.epoch.elapsed().as_secs_f64();
    session.receive(now);
    // Keys pressed while the menu is open belong to the menu.
    let focused = windows.iter().any(|w| w.focused) && !menu.open;
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
    if let Err(error) = client.advance(time.delta_secs_f64().min(0.05), input, now) {
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
    session.send(input, now);
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
