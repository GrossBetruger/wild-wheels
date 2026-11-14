//! Combat and match presentation. The server remains the authority for outcomes.
use crate::app::GameSession;
use bevy::{prelude::*, text::FontSize};

pub struct FeedbackPlugin;
impl Plugin for FeedbackPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<FeedbackState>()
            .add_systems(Startup, setup);
    }
}
#[derive(Component)]
pub struct MatchPanel;
#[derive(Component)]
pub struct MatchText;
#[derive(Component)]
pub struct DamageFlash;
#[derive(Resource, Default)]
pub struct FeedbackState {
    phase: String,
    go_until: f32,
    health: Option<f64>,
    flash: f32,
}
fn setup(mut commands: Commands) {
    commands.spawn((
        Node {
            position_type: PositionType::Absolute,
            width: percent(100),
            height: percent(100),
            ..default()
        },
        BackgroundColor(Color::NONE),
        DamageFlash,
    ));
    let panel = commands
        .spawn((
            Node {
                position_type: PositionType::Absolute,
                left: percent(22),
                right: percent(22),
                top: percent(22),
                padding: UiRect::all(px(24)),
                display: Display::None,
                ..default()
            },
            BackgroundColor(Color::srgba(0.035, 0.025, 0.09, 0.86)),
            MatchPanel,
        ))
        .id();
    commands.spawn((
        Text::default(),
        TextFont {
            font_size: FontSize::Px(36.0),
            ..default()
        },
        TextColor(Color::WHITE),
        TextShadow::default(),
        MatchText,
        ChildOf(panel),
    ));
}

/// Priority rules keep AFK and death visible even while a match is underway.
fn notice(
    phase: &str,
    away: bool,
    destroyed: f64,
    countdown: f64,
    ending: bool,
    go: bool,
) -> Option<String> {
    if away {
        return Some("AFK\nYou are sitting out\nEscape to return\nThe arena keeps running".into());
    }
    match phase {
        "ready" => Some("READY TO RUMBLE?\nEnter to start the match".into()),
        "paused" => Some("PAUSED\nWaiting for the match to resume".into()),
        "countdown" => Some(format!("GET READY\n{}", countdown.ceil().max(1.0))),
        "finished" => Some("MATCH COMPLETE".into()),
        _ if ending => Some("MATCH OVER!\nOne last burst of mayhem...".into()),
        _ if destroyed > 0.0 => Some(format!(
            "WHACKED!\nBack in {}...",
            destroyed.ceil().max(1.0)
        )),
        "racing" if go => Some("GO!".into()),
        _ => None,
    }
}

pub fn sync_match(
    session: Res<GameSession>,
    menu: Res<crate::gui::Menu>,
    time: Res<Time>,
    mut state: ResMut<FeedbackState>,
    mut panels: Query<&mut Node, With<MatchPanel>>,
    mut texts: Query<(&mut Text, &mut TextFont), With<MatchText>>,
    mut flashes: Query<&mut BackgroundColor, With<DamageFlash>>,
) {
    let now = time.elapsed_secs();
    let dt = time.delta_secs().min(0.1);
    // Outside a room, and wherever a menu is showing, the menus speak instead.
    let mut message = None;
    let mut finished = false;
    let mut countdown = false;
    match session.client.as_ref() {
        None => {
            state.health = None;
            state.phase.clear();
        }
        Some(client) => {
            let view = client.view();
            if view.phase == "racing" && state.phase == "countdown" {
                state.go_until = now + 1.2;
            }
            state.phase = view.phase.into();
            if state
                .health
                .is_some_and(|health| view.player.health < health)
            {
                state.flash = 0.35;
            }
            state.health = Some(view.player.health);
            message = notice(
                view.phase,
                session.away || view.player.afk,
                view.player.destroyed,
                view.countdown,
                view.finish_countdown.is_some(),
                now < state.go_until,
            );
            countdown = view.phase == "countdown";
            finished = view.phase == "finished";
            if view.phase == "finished" && !session.away && !view.player.afk {
                let winner = view
                    .winner
                    .and_then(|id| view.actors.get(id))
                    .and_then(|a| a.name.as_deref())
                    .unwrap_or("Winner");
                let mut racers: Vec<_> = view.actors.iter().filter(|a| !a.inactive).collect();
                racers.sort_by(|a, b| {
                    b.kills
                        .total_cmp(&a.kills)
                        .then_with(|| (Some(b.id) == view.winner).cmp(&(Some(a.id) == view.winner)))
                        .then(a.deaths.cmp(&b.deaths))
                        .then(a.id.cmp(&b.id))
                });
                let mut board = format!("MATCH COMPLETE\n{winner} wins!\n\n");
                for (rank, actor) in racers.iter().take(8).enumerate() {
                    board.push_str(&format!(
                        "{}. {}  {:.1} pts / {} deaths\n",
                        rank + 1,
                        actor.name.as_deref().unwrap_or("Racer"),
                        actor.kills,
                        actor.deaths
                    ));
                }
                board.push_str("\nEnter for another round");
                message = Some(board);
            }
        }
    }
    if menu.screen(&session) == crate::gui::Screen::Menu
        || session
            .client
            .as_ref()
            .is_some_and(|c| c.view().phase == "ready")
    {
        message = None;
    }
    for mut panel in &mut panels {
        // The final standings make room for the lobby on the right.
        (panel.left, panel.right) = match finished {
            true => (percent(4), px(426)),
            false => (percent(22), percent(22)),
        };
        panel.display = match message {
            Some(_) => Display::Flex,
            None => Display::None,
        };
    }
    for (mut text, mut font) in &mut texts {
        text.0 = message.clone().unwrap_or_default();
        font.font_size = FontSize::Px(match countdown {
            true => 48.0 + (now * 7.0).sin() * 5.0,
            false => 30.0,
        });
    }
    state.flash = (state.flash - dt).max(0.0);
    for mut flash in &mut flashes {
        flash.0 = Color::srgba(0.95, 0.04, 0.02, state.flash * 0.7);
    }
}

#[cfg(test)]
mod tests {
    use super::notice;
    #[test]
    fn racer_sees_countdown_go_death_and_clear_play() {
        assert_eq!(
            notice("countdown", false, 0.0, 2.4, false, false).as_deref(),
            Some("GET READY\n3")
        );
        assert_eq!(
            notice("racing", false, 0.0, 0.0, false, true).as_deref(),
            Some("GO!")
        );
        assert_eq!(
            notice("racing", false, 2.1, 0.0, false, false).as_deref(),
            Some("WHACKED!\nBack in 3...")
        );
        assert_eq!(notice("racing", false, 0.0, 0.0, false, false), None);
    }
    #[test]
    fn afk_does_not_claim_the_shared_server_is_paused() {
        assert_eq!(
            notice("racing", true, 0.0, 0.0, false, false).as_deref(),
            Some("AFK\nYou are sitting out\nEscape to return\nThe arena keeps running")
        );
        assert_eq!(
            notice("racing", false, 0.0, 0.0, true, false).as_deref(),
            Some("MATCH OVER!\nOne last burst of mayhem...")
        );
    }
}
