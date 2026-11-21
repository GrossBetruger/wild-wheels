//! Chat input captures gameplay keys only while composing or clicking chat.
use super::{Chat, Message};
use crate::{app::GameSession, gui::Menu};
use bevy::{
    input::{
        ButtonState,
        keyboard::{Key, KeyboardInput},
        mouse::MouseWheel,
    },
    prelude::*,
    text::FontSize,
    ui::RelativeCursorPosition,
};
use std::collections::BTreeMap;

#[derive(Default, Clone)]
struct Draft {
    text: String,
    reply: Option<u64>,
}
#[derive(Component, Clone, Copy)]
pub enum Action {
    Toggle,
    Conversation(Option<usize>),
    Reply(u64),
    CancelReply,
    Delete(u64),
    Send,
}
#[derive(Component)]
pub struct Log;
#[derive(Resource, Default)]
pub struct ChatPanel {
    open: bool,
    pub capture_frame: bool,
    selected: Option<usize>,
    selected_name: Option<String>,
    drafts: BTreeMap<Option<usize>, Draft>,
    root: Option<Entity>,
    drawn: String,
    generation: u64,
    sent: u64,
    pending: Option<(Option<usize>, Draft)>,
    scroll: f32,
}
impl ChatPanel {
    fn draft_mut(&mut self) -> &mut Draft {
        self.drafts.entry(self.selected).or_default()
    }
    fn type_text(&mut self, value: &str) {
        let draft = self.drafts.entry(self.selected).or_default();
        let mut length = draft.text.encode_utf16().count();
        for c in value.chars().filter(|c| !c.is_control()) {
            if length + c.len_utf16() > 500 {
                break;
            }
            length += c.len_utf16();
            draft.text.push(c);
        }
    }
    fn send(&mut self, chat: &mut Chat) {
        let draft = self.drafts.entry(self.selected).or_default().clone();
        if chat.send(&draft.text, self.selected, draft.reply) {
            self.pending = Some((self.selected, draft));
        }
    }
    fn accept_sent(&mut self, chat: &Chat) {
        if chat.sent == self.sent {
            return;
        }
        self.sent = chat.sent;
        if let Some((to, pending)) = self.pending.take() {
            let draft = self.drafts.entry(to).or_default();
            if draft.text == pending.text {
                draft.text.clear();
            }
            if draft.reply == pending.reply {
                draft.reply = None;
            }
        }
        self.scroll = 0.0;
    }
}
#[allow(clippy::too_many_arguments)]
pub fn control(
    mut panel: ResMut<ChatPanel>,
    mut session: ResMut<GameSession>,
    menu: Res<Menu>,
    mut typed: MessageReader<KeyboardInput>,
    keys: Res<ButtonInput<KeyCode>>,
    mouse: Res<ButtonInput<MouseButton>>,
    buttons: Query<(&RelativeCursorPosition, &Action)>,
    mut wheel: MessageReader<MouseWheel>,
    windows: Query<&Window>,
) {
    panel.capture_frame = panel.open;
    let focused = windows.iter().any(|w| w.focused);
    session.chat.update(false);
    if panel.open && focused {
        session.chat.read(panel.selected);
    }
    if panel.generation != session.chat.generation {
        let root = panel.root.take();
        let capture_frame = panel.capture_frame;
        *panel = ChatPanel {
            generation: session.chat.generation,
            sent: session.chat.sent,
            root,
            capture_frame,
            ..Default::default()
        };
    }
    panel.accept_sent(&session.chat);
    // Do not silently retarget a private draft when a seat changes occupants.
    if let Some(id) = panel.selected {
        let name = session
            .chat
            .players
            .iter()
            .find(|p| p.id == id)
            .map(|p| p.name.clone());
        if name != panel.selected_name {
            panel.drafts.remove(&Some(id));
            panel.selected = None;
            panel.selected_name = None;
            session.chat.status = "Conversation changed; select the recipient again".into();
        }
    }
    let connected = session.client.is_some();
    if !connected || !focused {
        typed.clear();
        wheel.clear();
        return;
    }
    if mouse.just_pressed(MouseButton::Left) {
        let action = buttons
            .iter()
            .find(|(p, _)| p.cursor_over())
            .map(|(_, a)| *a);
        if let Some(action) = action {
            panel.capture_frame = true;
            match action {
                Action::Toggle => panel.open = !panel.open,
                Action::Conversation(to) => {
                    panel.selected = to;
                    panel.selected_name = to.and_then(|id| {
                        session
                            .chat
                            .players
                            .iter()
                            .find(|p| p.id == id)
                            .map(|p| p.name.clone())
                    });
                    panel.scroll = 0.0;
                }
                Action::Send => panel.send(&mut session.chat),
                Action::Reply(id) => {
                    panel.draft_mut().reply = Some(id);
                }
                Action::CancelReply => {
                    panel.draft_mut().reply = None;
                }
                Action::Delete(id) => {
                    session.chat.submit(serde_json::json!({"deleteId":id}));
                }
            }
        }
    }
    let command = keys.any_pressed([
        KeyCode::SuperLeft,
        KeyCode::SuperRight,
        KeyCode::ControlLeft,
        KeyCode::ControlRight,
    ]);
    for event in typed.read().filter(|e| e.state == ButtonState::Pressed) {
        if !panel.open {
            if !menu.open && event.key_code == KeyCode::KeyT && !event.repeat {
                panel.open = true;
                panel.capture_frame = true;
            }
            continue;
        }
        panel.capture_frame = true;
        if command && event.key_code == KeyCode::KeyV {
            if let Some(value) = crate::gui::clipboard() {
                panel.type_text(&value);
            }
            continue;
        }
        match &event.logical_key {
            Key::Escape if !event.repeat => panel.open = false,
            Key::Enter if !event.repeat => panel.send(&mut session.chat),
            Key::Backspace => {
                panel.draft_mut().text.pop();
            }
            Key::Character(s) if command && s.eq_ignore_ascii_case("v") => {
                if let Some(value) = crate::gui::clipboard() {
                    panel.type_text(&value);
                }
            }
            Key::Character(_) if command => {}
            Key::Character(s) => panel.type_text(s),
            Key::Space => panel.type_text(" "),
            Key::PageUp => panel.scroll += 200.0,
            Key::PageDown => panel.scroll = (panel.scroll - 200.0).max(0.0),
            _ if !command => {
                if let Some(s) = &event.text {
                    panel.type_text(s);
                }
            }
            _ => {}
        }
    }
    for event in wheel.read() {
        if panel.open {
            panel.scroll = (panel.scroll + event.y * 35.0).clamp(0.0, 100000.0);
        }
    }
    panel.capture_frame |= panel.open;
}
/// Returns true if the text contains Hebrew or other RTL codepoints.
pub(crate) fn has_rtl(value: &str) -> bool {
    value.chars().any(|c| {
        matches!(
            u32::from(c),
            0x0590..=0x08FF | 0xFB1D..=0xFDFF | 0xFE70..=0xFEFF
        )
    })
}
/// Formats the chat input line so the `> ` prompt stays on the left and the cursor `|`
/// stays at the end of the typed text even when typing Hebrew (RTL).
pub(crate) fn format_prompt(draft: &str) -> String {
    match has_rtl(draft) {
        true => format!("\u{200E}> {draft}|\u{200F}"),
        false => format!("> {draft}|"),
    }
}
/// Formats a chat message line (`Name: text`) so the sender prefix stays anchored on the
/// left while RTL Hebrew message text flows naturally without scrambling the colon or sender.
pub(crate) fn format_line(prefix: &str, body: &str) -> String {
    match has_rtl(prefix) || has_rtl(body) {
        true => format!("\u{200E}{prefix}\u{200E}: {body}\u{200F}"),
        false => format!("{prefix}: {body}"),
    }
}
fn text(
    commands: &mut Commands,
    parent: Entity,
    font: &bevy::text::FontSource,
    value: impl Into<String>,
    size: f32,
    color: Color,
) {
    commands.spawn((
        Text::new(value),
        TextFont {
            font: font.clone(),
            font_size: FontSize::Px(size),
            ..default()
        },
        TextColor(color),
        ChildOf(parent),
    ));
}
fn button(
    commands: &mut Commands,
    parent: Entity,
    font: &bevy::text::FontSource,
    label: &str,
    action: Action,
) {
    let entity = commands
        .spawn((
            Node {
                padding: UiRect::axes(px(8), px(5)),
                ..default()
            },
            BackgroundColor(Color::srgb(0.20, 0.16, 0.31)),
            RelativeCursorPosition::default(),
            action,
            ChildOf(parent),
        ))
        .id();
    text(commands, entity, font, label, 14.0, Color::WHITE);
}
fn visible(message: &Message, chat: &Chat, selected: Option<usize>) -> bool {
    match selected {
        None => message.to.is_none(),
        Some(id) => {
            message.to.is_some()
                && chat
                    .you
                    .is_some_and(|you| message.conversation(you) == Some(id))
        }
    }
}
pub fn draw(
    mut commands: Commands,
    mut panel: ResMut<ChatPanel>,
    session: Res<GameSession>,
    faces: Option<Res<crate::hud::MenloFaces>>,
) {
    let font = faces.map(|f| f.source.clone()).unwrap_or_default();
    let chat = &session.chat;
    let draft = panel
        .drafts
        .get(&panel.selected)
        .cloned()
        .unwrap_or_default();
    let signature = format!(
        "{}:{}:{}:{:?}:{}:{:?}:{}:{}:{}",
        session.client.is_some(),
        panel.open,
        chat.revision,
        panel.selected,
        draft.text,
        draft.reply,
        chat.status,
        chat.pending,
        chat.unread
    );
    if signature == panel.drawn {
        return;
    }
    panel.drawn = signature;
    if let Some(root) = panel.root.take() {
        commands.entity(root).despawn();
    }
    if session.client.is_none() {
        return;
    }
    let root = commands
        .spawn((
            Node {
                position_type: PositionType::Absolute,
                left: px(18),
                bottom: px(18),
                width: px(440),
                max_width: percent(90),
                flex_direction: FlexDirection::Column,
                row_gap: px(8),
                padding: UiRect::all(px(12)),
                ..default()
            },
            BackgroundColor(Color::srgba(0.035, 0.025, 0.09, 0.94)),
            GlobalZIndex(30),
        ))
        .id();
    panel.root = Some(root);
    button(
        &mut commands,
        root,
        &font,
        &match panel.open {
            true => "PIT STOP CHAT  -  CLOSE (ESC)".into(),
            false => format!("CHAT (T)  -  {} NEW", chat.unread),
        },
        Action::Toggle,
    );
    if !panel.open {
        return;
    }
    let tabs = commands
        .spawn((
            Node {
                flex_wrap: FlexWrap::Wrap,
                column_gap: px(5),
                row_gap: px(5),
                ..default()
            },
            ChildOf(root),
        ))
        .id();
    button(
        &mut commands,
        tabs,
        &font,
        &format!("Everyone ({})", chat.unread_in(None)),
        Action::Conversation(None),
    );
    for player in chat.players.iter().filter(|p| Some(p.id) != chat.you) {
        button(
            &mut commands,
            tabs,
            &font,
            &format!("{} ({})", player.name, chat.unread_in(Some(player.id))),
            Action::Conversation(Some(player.id)),
        );
    }
    let conversation = match &panel.selected_name {
        Some(name) => format!("PRIVATE: {name}"),
        None => "EVERYONE IN THE ROOM".into(),
    };
    text(
        &mut commands,
        root,
        &font,
        conversation,
        15.0,
        Color::srgb(0.94, 0.79, 0.45),
    );
    let log = commands
        .spawn((
            Node {
                height: px(240),
                flex_direction: FlexDirection::Column,
                row_gap: px(8),
                overflow: Overflow::scroll_y(),
                ..default()
            },
            ChildOf(root),
            Log,
            ScrollPosition::default(),
        ))
        .id();
    let messages: Vec<_> = chat
        .messages
        .values()
        .filter(|m| visible(m, chat, panel.selected))
        .collect();
    for message in messages {
        let row = commands
            .spawn((
                Node {
                    flex_direction: FlexDirection::Column,
                    flex_shrink: 0.0,
                    padding: UiRect::all(px(7)),
                    ..default()
                },
                BackgroundColor(Color::srgb(0.11, 0.09, 0.18)),
                ChildOf(log),
            ))
            .id();
        let own = chat.you.is_some_and(|id| message.from == id as i64);
        text(
            &mut commands,
            row,
            &font,
            format_line(
                match own {
                    true => "You",
                    false => &message.name,
                },
                match message.deleted {
                    true => "Message deleted",
                    false => &message.text,
                },
            ),
            15.0,
            Color::WHITE,
        );
        if let Some(quote) = &message.reply {
            text(
                &mut commands,
                row,
                &font,
                format_line(
                    &format!("Reply to {}", quote.name),
                    match quote.deleted {
                        true => "Message deleted",
                        false => &quote.text,
                    },
                ),
                12.0,
                Color::srgb(0.73, 0.70, 0.83),
            );
        }
        if !message.deleted {
            let actions = commands
                .spawn((
                    Node {
                        column_gap: px(6),
                        ..default()
                    },
                    ChildOf(row),
                ))
                .id();
            button(
                &mut commands,
                actions,
                &font,
                "Reply",
                Action::Reply(message.id),
            );
            if own {
                button(
                    &mut commands,
                    actions,
                    &font,
                    "Delete",
                    Action::Delete(message.id),
                );
            }
        }
    }
    if let Some(reply) = draft
        .reply
        .and_then(|id| chat.messages.get(&id))
        .filter(|m| !m.deleted)
    {
        text(
            &mut commands,
            root,
            &font,
            format_line(&format!("Replying to {}", reply.name), &reply.text),
            12.0,
            Color::srgb(0.94, 0.79, 0.45),
        );
        button(
            &mut commands,
            root,
            &font,
            "Cancel reply",
            Action::CancelReply,
        );
    }
    text(
        &mut commands,
        root,
        &font,
        format_prompt(&draft.text),
        17.0,
        Color::WHITE,
    );
    button(
        &mut commands,
        root,
        &font,
        match chat.pending {
            true => "Sending...",
            false => "Send (Enter)",
        },
        Action::Send,
    );
    text(
        &mut commands,
        root,
        &font,
        format!(
            "{} - {}/500\nScroll / PgUp / PgDn for history",
            chat.status,
            draft.text.encode_utf16().count()
        ),
        12.0,
        Color::srgb(0.73, 0.70, 0.83),
    );
}

pub fn scroll(
    panel: Res<ChatPanel>,
    mut logs: Query<(&ComputedNode, &mut ScrollPosition), With<Log>>,
) {
    for (node, mut position) in &mut logs {
        let bottom = (node.content_size().y - node.size().y).max(0.0) * node.inverse_scale_factor();
        position.0.y = (bottom - panel.scroll).max(0.0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn typing_in_chat_does_not_drive_fire_boost_or_flip_and_everyone_hides_private_messages() {
        use bevy::{app::ScheduleRunnerPlugin, time::TimeUpdateStrategy};
        use wild_wheels_core::{NativeArena, NativeClient};
        let mut server = NativeArena::new(serde_json::json!({"maxPlayers":8,"code":"00","arena":0,"bots":0,"dedicated":true,"host":null,"epoch":1,"seed":1,"players":[{"id":0,"name":"Native","driver":0,"role":"driver"}]})).unwrap();
        server.start();
        for _ in 0..181 {
            server
                .step(wild_wheels_core::Frame {
                    dt: 1.0 / 60.0,
                    inputs: vec![],
                })
                .unwrap();
        }
        let mut session = GameSession::new();
        session.client = Some(NativeClient::from_packet(&server.packet(0), 0.0).unwrap());
        session.chat.merge(super::super::Response::parse(serde_json::json!({"you":0,"cursor":2,"players":[{"id":0,"name":"Native"},{"id":1,"name":"Browser"}],"messages":[{"id":1,"from":1,"to":null,"name":"Browser","text":"PUBLIC HELLO","reply":null},{"id":2,"from":1,"to":0,"name":"Browser","text":"PRIVATE SECRET","reply":null}]})).unwrap(),false);
        let menu = Menu::new(
            crate::config::Config::from_args(std::iter::empty()).unwrap(),
            crate::prefs::Preferences::default(),
        );
        let mut app = App::new();
        app.add_plugins(MinimalPlugins.build().disable::<ScheduleRunnerPlugin>())
            .insert_resource(TimeUpdateStrategy::ManualDuration(
                std::time::Duration::from_secs_f64(1.0 / 60.0),
            ))
            .insert_resource(session)
            .insert_resource(menu)
            .init_resource::<ChatPanel>()
            .init_resource::<ButtonInput<KeyCode>>()
            .init_resource::<ButtonInput<MouseButton>>()
            .add_message::<KeyboardInput>()
            .add_message::<MouseWheel>()
            .add_systems(Update, (control, crate::app::drive, draw).chain());
        let window = app
            .world_mut()
            .spawn(Window {
                focused: true,
                ..default()
            })
            .id();
        let event = |key_code, logical_key| KeyboardInput {
            key_code,
            logical_key,
            state: ButtonState::Pressed,
            text: None,
            repeat: false,
            window,
        };
        app.world_mut()
            .write_message(event(KeyCode::KeyT, Key::Character("t".into())));
        app.update();
        assert!(app.world().resource::<ChatPanel>().open);
        {
            let world = app.world_mut();
            let mut texts = world.query::<&Text>();
            let visible = texts
                .iter(world)
                .map(|text| text.0.as_str())
                .collect::<Vec<_>>()
                .join("\n");
            assert!(visible.contains("PUBLIC HELLO"));
            assert!(!visible.contains("PRIVATE SECRET"));
        }
        for key in [KeyCode::KeyW, KeyCode::Space, KeyCode::KeyX, KeyCode::KeyZ] {
            app.world_mut()
                .resource_mut::<ButtonInput<KeyCode>>()
                .press(key);
        }
        app.world_mut()
            .write_message(event(KeyCode::KeyW, Key::Character("w".into())));
        app.world_mut()
            .write_message(event(KeyCode::Space, Key::Space));
        app.update();
        let view = app
            .world()
            .resource::<GameSession>()
            .client
            .as_ref()
            .unwrap()
            .view();
        assert!(view.projectiles.is_empty());
        assert_eq!(view.player.ammo, 10);
        assert_eq!(view.player.speed, 0.0);
        assert_eq!(view.player.boost, 0.0);
        assert_eq!(view.player.somersault, 0.0);
        app.world_mut()
            .write_message(event(KeyCode::Escape, Key::Escape));
        app.update();
        assert!(!app.world().resource::<ChatPanel>().open);
        assert!(app.world().resource::<ChatPanel>().capture_frame);
        assert_eq!(app.world().resource::<ChatPanel>().drafts[&None].text, "w ");
        app.world_mut()
            .resource_mut::<ButtonInput<KeyCode>>()
            .clear();
        app.update();
        assert!(!app.world().resource::<ChatPanel>().capture_frame);
    }
    #[test]
    fn unicode_drafts_use_the_servers_utf16_limit_and_keep_input_as_plain_text() {
        let mut panel = ChatPanel::default();
        panel.type_text(&"a".repeat(498));
        panel.type_text("🦚");
        panel.type_text("x");
        assert_eq!(panel.drafts[&None].text.encode_utf16().count(), 500);
        let mut panel = ChatPanel::default();
        panel.type_text("<script> שלום\n");
        assert_eq!(panel.drafts[&None].text, "<script> שלום");
    }
    #[test]
    fn hebrew_messages_and_prompts_format_with_bidirectional_markers() {
        assert!(!has_rtl("Hello world"));
        assert!(has_rtl("שלום עולם"));
        assert_eq!(format_prompt("hello"), "> hello|");
        assert_eq!(format_prompt("שלום"), "\u{200E}> שלום|\u{200F}");
        assert_eq!(format_line("Oren", "gg"), "Oren: gg");
        assert_eq!(
            format_line("Oren", "משחק טוב!"),
            "\u{200E}Oren\u{200E}: משחק טוב!\u{200F}"
        );
    }
}
