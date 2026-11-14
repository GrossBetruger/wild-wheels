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

/// The browser's centre message for each phase. Respawning is announced on the
/// HUD's hint line instead, as in the browser.
fn notice(phase: &str, away: bool, countdown: f64, ending: bool) -> Option<String> {
    if away {
        return Some("AFK\nYour place and score are saved.\nThe match continues.".into());
    }
    match phase {
        "paused" => Some("PIT STOP\nCatch your breath.".into()),
        "countdown" => Some(format!(
            "ON YOUR MARKS\n{}\nHold Up or W to accelerate",
            countdown.ceil().max(1.0)
        )),
        "finished" => Some("BATTLE COMPLETE".into()),
        _ if ending => Some("MATCH OVER!\nOne last burst of mayhem...".into()),
        _ => None,
    }
}
fn ordinal(place: usize) -> &'static str {
    match (place % 100, place % 10) {
        (11..=13, _) => "TH",
        (_, 1) => "ST",
        (_, 2) => "ND",
        (_, 3) => "RD",
        _ => "TH",
    }
}

#[allow(clippy::too_many_arguments)]
pub fn sync_match(
    session: Res<GameSession>,
    menu: Res<crate::gui::Menu>,
    graphics: Res<crate::ported::Graphics>,
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
                view.countdown,
                view.finish_countdown.is_some(),
            );
            countdown = view.phase == "countdown";
            finished = view.phase == "finished";
            if view.phase == "finished" && !session.away && !view.player.afk {
                // The browser's results: placing, the final leaderboard, bicycle thefts.
                let order = crate::hud::standings(&view);
                let name = |a: &wild_wheels_core::Actor| {
                    let racer = graphics.racers().get(a.driver);
                    let name = a.name.as_deref().or(racer.map(|r| r.name.as_str()));
                    match a.id == view.you {
                        true => format!("{} (YOU)", name.unwrap_or("Racer")),
                        false => name.unwrap_or("Racer").to_owned(),
                    }
                };
                let place = order
                    .iter()
                    .position(|a| a.id == view.you)
                    .map_or(1, |i| i + 1);
                let tie = view.multiplayer
                    && order.len() > 1
                    && Some(order[0].id) == view.host
                    && order[0].kills == order[1].kills;
                let p = view.player;
                let mut board = format!(
                    "{}\n{place}{} PLACE\n{:.0} kills, {} deaths, {}\n\nFINAL LEADERBOARD\n",
                    match tie {
                        true => "TIE ON POINTS, HOST WINS",
                        false => "BATTLE COMPLETE",
                    },
                    ordinal(place),
                    p.kills,
                    p.deaths,
                    crate::hud::clock(view.finish_time.unwrap_or(view.elapsed)),
                );
                for (rank, actor) in order.iter().take(8).enumerate() {
                    board.push_str(&format!(
                        "{:>2}  {:<26} {:>3.0} kills {:>3} deaths\n",
                        rank + 1,
                        name(actor),
                        actor.kills,
                        actor.deaths
                    ));
                }
                let mut thieves: Vec<_> = order.iter().filter(|a| a.bicycles_stolen > 0).collect();
                thieves.sort_by(|a, b| {
                    b.bicycles_stolen
                        .cmp(&a.bicycles_stolen)
                        .then(a.id.cmp(&b.id))
                });
                if !thieves.is_empty() {
                    board.push_str("\nBICYCLES STOLEN\n");
                    for thief in thieves {
                        board.push_str(&format!("{:<30} {}\n", name(thief), thief.bicycles_stolen));
                    }
                }
                board.push_str("\nEnter to play again");
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
    use super::{notice, ordinal};
    #[test]
    fn the_centre_message_follows_the_browser_for_each_phase() {
        assert_eq!(
            notice("countdown", false, 2.4, false).as_deref(),
            Some("ON YOUR MARKS\n3\nHold Up or W to accelerate")
        );
        // Respawning is shown on the HUD's hint line, not as a centre message.
        assert_eq!(notice("racing", false, 0.0, false), None);
        assert_eq!(
            notice("racing", false, 0.0, true).as_deref(),
            Some("MATCH OVER!\nOne last burst of mayhem...")
        );
        assert_eq!(
            notice("finished", false, 0.0, false).as_deref(),
            Some("BATTLE COMPLETE")
        );
    }
    #[test]
    fn sitting_out_does_not_claim_the_shared_match_is_paused() {
        assert_eq!(
            notice("racing", true, 0.0, false).as_deref(),
            Some("AFK\nYour place and score are saved.\nThe match continues.")
        );
    }
    #[test]
    fn places_read_as_the_browser_writes_them() {
        assert_eq!(
            [1, 2, 3, 4, 11, 12, 13, 21].map(ordinal),
            ["ST", "ND", "RD", "TH", "TH", "TH", "TH", "ST"]
        );
    }
}
