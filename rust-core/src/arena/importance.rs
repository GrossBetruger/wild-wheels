//! Ability importance simulation. For every racer with abilities, as
//! gameplay/special-abilities.js lists them, bots play matches with each subset
//! of that racer's abilities switched on (the power set). Every subset plays the
//! same seeds, so the differences between subsets come from the abilities. Each
//! ability's contribution is its Shapley value: its average effect when added to
//! every subset of the others. It plays the real rules and bot AI with no
//! rendering, and runs only when asked: `npm run scenario:ability-importance`
//! (scripts/scenarios/ability-importance.mjs).
//!
//! Two fields of opponents: **plain**, racers with no abilities, measures what an
//! ability is worth on its own; **mixed**, the other racers with abilities, all
//! switched on, measures it against their abilities and counters.
//!
//! Settings, from the environment: ABILITY_MATCHES per subset (default 40),
//! ABILITY_MINUTES per match (default 4), ABILITY_FIELD (plain, mixed or both,
//! the default) and ABILITY_REPORT, the Markdown report file to write.
use super::abilities::{DISABLED, press_for_bots};
use super::*;
use std::fmt::Write as _;

/// Racers and their abilities, numbered as `ability_on` numbers them.
const RACERS: [(usize, &[&str]); 9] = [
    (5, &["Low-Cost Locust", "Cricket's Jump"]),
    (7, &["Reine de la paresse", "Nightmare Fuel"]),
    (8, &["Special Relativity"]),
    (9, &["Fashion-Statement"]),
    (10, &["Reefer Madness (smoke)", "Ring of Fire"]),
    (11, &["Providence"]),
    (12, &["Six-Heart Recovery"]),
    (13, &["Tax-Audit", "Xylophone-Attack"]),
    (14, &["Dark Humor", "BatYouDidn'tKnow"]),
];
/// Racers with no abilities, the plain field.
const PLAIN: [usize; 6] = [0, 1, 2, 3, 4, 6];
const STEP: f64 = 1.0 / 60.0;

#[derive(Clone, Copy, PartialEq)]
enum Field {
    Plain,
    Mixed,
}
impl Field {
    fn name(self) -> &'static str {
        match self {
            Field::Plain => "plain",
            Field::Mixed => "mixed",
        }
    }
    /// The opponents' racers, seated in turn.
    fn opponents(self, driver: usize) -> Vec<usize> {
        match self {
            Field::Plain => PLAIN.to_vec(),
            Field::Mixed => RACERS.iter().map(|(d, _)| *d).filter(|d| *d != driver).collect(),
        }
    }
    fn describe(self) -> String {
        match self {
            Field::Plain => format!("racers with no abilities ({})", PLAIN.map(driver_name).join(", ")),
            Field::Mixed => "the other racers with abilities, every ability on".into(),
        }
    }
}

/// How the racer under test did in one match.
#[derive(Clone, Copy, Default)]
struct Outcome {
    kills: f64,
    deaths: f64,
    won: f64,
}
impl Outcome {
    fn net(self) -> f64 {
        self.kills - self.deaths
    }
}

/// One ability's Shapley contributions in one field.
struct Contribution {
    net: f64,
    error: f64,
    kills: f64,
    deaths: f64,
    won: f64,
    unused: bool,
}

fn setting(name: &str, default: f64) -> f64 {
    std::env::var(name).ok().and_then(|value| value.parse().ok()).unwrap_or(default)
}

/// One match: the racer under test in a seat that moves with the seed, with the
/// abilities in `on` (a bit each) switched on, against the field.
fn play(field: Field, driver: usize, abilities: usize, on: u8, seed: u32, minutes: f64) -> Outcome {
    let room: control::Room = serde_json::from_value(json!({
        "code": "00", "maxPlayers": MAX_PLAYERS, "arena": seed % 2, "bots": MAX_PLAYERS,
        "dedicated": true, "host": null, "epoch": 1, "seed": seed, "players": [],
        "specialAbilities": true,
    }))
    .unwrap();
    let mut game = Game::create_room(&room).unwrap();
    let subject = seed as usize % MAX_PLAYERS;
    let opponents = field.opponents(driver);
    for (seat, actor) in game.actors.iter_mut().enumerate() {
        actor.driver = match seat == subject {
            true => driver,
            false => opponents[(seat + seed as usize) % opponents.len()],
        };
    }
    let all = (1u8 << abilities) - 1;
    DISABLED.with(|off| {
        let mut off = off.borrow_mut();
        off.clear();
        off.resize(MAX_PLAYERS, 0);
        off[subject] = all & !on;
    });
    game.global.target_score = f64::INFINITY;
    game.global.duration = minutes * 60.0;
    game.global.phase = "countdown".into();
    let mut steps = 0usize;
    while game.global.phase != "finished" && steps < ((minutes + 1.0) * 3600.0) as usize {
        press_for_bots(&mut game);
        game.tick(Frame { dt: STEP, inputs: Vec::new() });
        steps += 1;
    }
    DISABLED.with(|off| off.borrow_mut().clear());
    let a = &game.actors[subject];
    let best = game.actors.iter().map(|b| b.kills).fold(f64::MIN, f64::max);
    Outcome {
        kills: a.kills,
        deaths: a.deaths as f64,
        won: f64::from(u8::from(a.kills >= best)),
    }
}

/// Mean and the half-width of its 95% confidence interval.
fn spread(values: &[f64]) -> (f64, f64) {
    let n = values.len() as f64;
    let mean = values.iter().sum::<f64>() / n;
    let variance = values.iter().map(|v| (v - mean).powi(2)).sum::<f64>() / (n - 1.0).max(1.0);
    (mean, 1.96 * (variance / n).sqrt())
}

fn factorial(n: usize) -> f64 {
    (1..=n).map(|i| i as f64).product()
}

/// Per seed, ability `i`'s Shapley value for one measure.
fn shapley(results: &[Vec<Outcome>], abilities: usize, i: usize, measure: fn(Outcome) -> f64) -> Vec<f64> {
    (0..results[0].len())
        .map(|seed| {
            (0..1usize << abilities)
                .filter(|without| without & (1 << i) == 0)
                .map(|without| {
                    let size = without.count_ones() as usize;
                    let weight = factorial(size) * factorial(abilities - size - 1) / factorial(abilities);
                    weight * (measure(results[without | (1 << i)][seed]) - measure(results[without][seed]))
                })
                .sum()
        })
        .collect()
}

fn names(list: &[&str], on: usize) -> String {
    let chosen: Vec<&str> = (0..list.len()).filter(|i| on & (1 << i) != 0).map(|i| list[i]).collect();
    match chosen.is_empty() {
        true => "none".into(),
        false => chosen.join(" + "),
    }
}

/// Plays every subset of one racer's abilities in one field, appends its tables
/// to `details` and returns each ability's contribution.
fn measure(field: Field, driver: usize, list: &[&str], matches: u32, minutes: f64, details: &mut String) -> Vec<Contribution> {
    let abilities = list.len();
    let results: Vec<Vec<Outcome>> = (0..1usize << abilities)
        .map(|on| (1..=matches).map(|seed| play(field, driver, abilities, on as u8, seed, minutes)).collect())
        .collect();
    println!("{} field, {}: {} subsets × {matches} matches", field.name(), driver_name(driver), 1 << abilities);
    let _ = writeln!(details, "### {}, {} field\n", driver_name(driver), field.name());
    let _ = writeln!(details, "| Abilities on | Kills | Deaths | Net | Won |\n|---|---:|---:|---:|---:|");
    for (on, outcomes) in results.iter().enumerate() {
        let mean = |f: fn(&Outcome) -> f64| spread(&outcomes.iter().map(f).collect::<Vec<_>>()).0;
        let _ = writeln!(
            details,
            "| {} | {:.2} | {:.2} | {:+.2} | {:.0}% |",
            names(list, on),
            mean(|o| o.kills),
            mean(|o| o.deaths),
            mean(|o| o.net()),
            mean(|o| o.won) * 100.0
        );
    }
    let _ = writeln!(details);
    (0..abilities)
        .map(|i| {
            let (net, error) = spread(&shapley(&results, abilities, i, Outcome::net));
            // A deterministic match that never triggers the ability plays the same with or without it.
            let unused = (0..1usize << abilities)
                .filter(|s| s & (1 << i) == 0)
                .all(|s| results[s].iter().zip(&results[s | 1 << i]).all(|(a, b)| a.kills == b.kills && a.deaths == b.deaths));
            Contribution {
                net,
                error,
                kills: spread(&shapley(&results, abilities, i, |o| o.kills)).0,
                deaths: spread(&shapley(&results, abilities, i, |o| o.deaths)).0,
                won: spread(&shapley(&results, abilities, i, |o| o.won)).0,
                unused,
            }
        })
        .collect()
}

#[test]
#[ignore = "a simulation, not a test: run it with npm run scenario:ability-importance"]
fn ability_importance() {
    let _kernel = native::KERNEL.lock().unwrap();
    let matches = setting("ABILITY_MATCHES", 40.0) as u32;
    let minutes = setting("ABILITY_MINUTES", 4.0);
    let fields = match std::env::var("ABILITY_FIELD").as_deref() {
        Ok("plain") => vec![Field::Plain],
        Ok("mixed") => vec![Field::Mixed],
        _ => vec![Field::Plain, Field::Mixed],
    };
    let mut details = String::new();
    // Per racer and ability, its contribution in each field played.
    let mut rows: Vec<(&str, &str, Vec<Contribution>)> = Vec::new();
    for field in &fields {
        let _ = writeln!(details, "## {} field: {}\n", field.name(), field.describe());
        for (driver, list) in RACERS {
            let contributions = measure(*field, driver, list, matches, minutes, &mut details);
            for (ability, contribution) in list.iter().zip(contributions) {
                match rows.iter_mut().find(|(r, a, _)| *r == driver_name(driver) && a == ability) {
                    Some((.., found)) => found.push(contribution),
                    None => rows.push((driver_name(driver), ability, vec![contribution])),
                }
            }
        }
    }
    rows.sort_by(|a, b| b.2.last().unwrap().net.total_cmp(&a.2.last().unwrap().net));

    let mut report = String::new();
    let _ = writeln!(report, "# Ability importance\n");
    let _ = writeln!(
        report,
        "Each racer with abilities played {matches} bot matches of {minutes} minutes per subset of its abilities, \
         in one of {MAX_PLAYERS} seats, on the same seeds for every subset. Fields: {}. \
         **Net** is kills minus deaths per match; **won** is the share of matches the racer finished with the most kills. \
         An ability's **contribution** is its Shapley value: its average effect when added to every subset of the racer's \
         other abilities, with a 95% confidence interval over the seeds. Bots never press Nightmare Fuel themselves; \
         the simulation presses it for every Houston whenever it is ready.\n",
        fields.iter().map(|f| format!("**{}**, {}", f.name(), f.describe())).collect::<Vec<_>>().join("; ")
    );
    let _ = write!(report, "## Ranking\n\n| Racer | Ability |");
    for field in &fields {
        let _ = write!(report, " Net, {0} | Kills, {0} | Deaths, {0} | Won, {0} |", field.name());
    }
    let _ = writeln!(report, "\n|---|---|{}", "---:|".repeat(4 * fields.len()));
    for (racer, ability, contributions) in &rows {
        let unused = contributions.iter().all(|c| c.unused);
        let note = match unused {
            true => " (never triggered by bots)",
            false => "",
        };
        let _ = write!(report, "| {racer} | {ability}{note} |");
        for c in contributions {
            let _ = write!(report, " {:+.2} ± {:.2} | {:+.2} | {:+.2} | {:+.0} pts |", c.net, c.error, c.kills, c.deaths, c.won * 100.0);
        }
        let _ = writeln!(report);
    }
    let _ = writeln!(report, "\nRanked by net contribution in the {} field.\n\n{details}", fields.last().unwrap().name());
    let path = std::env::var("ABILITY_REPORT").unwrap_or_else(|_| "ability-importance.md".into());
    std::fs::write(&path, &report).expect("the report is written");
    println!("\n{report}\nReport written to {path}");
}
