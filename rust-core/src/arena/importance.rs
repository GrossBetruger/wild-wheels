//! Ability importance simulation. For every racer with abilities, as
//! gameplay/special-abilities.js lists them, bots play matches with each subset
//! of that racer's abilities switched on (the power set), against a field of
//! racers who have none. Every subset plays the same seeds, so the differences
//! between subsets come from the abilities. Each ability's contribution is its
//! Shapley value: its average effect when added to every subset of the others.
//! It plays the real rules and bot AI with no rendering, and runs only when
//! asked: `npm run scenario:ability-importance`
//! (scripts/scenarios/ability-importance.mjs).
//!
//! Settings, from the environment: ABILITY_MATCHES per subset (default 40),
//! ABILITY_MINUTES per match (default 4), ABILITY_REPORT, the Markdown report
//! file to write.
use super::abilities::DISABLED;
use super::*;
use std::fmt::Write as _;

/// Racers and their abilities, numbered as `ability_on` numbers them.
const RACERS: [(usize, &[&str]); 9] = [
    (5, &["Low-Cost Locust", "Cricket's Jump"]),
    (7, &["Reine de la paresse"]),
    (8, &["Special Relativity"]),
    (9, &["Fashion-Statement"]),
    (10, &["Reefer Madness (smoke)", "Ring of Fire"]),
    (11, &["Providence"]),
    (12, &["Six-Heart Recovery"]),
    (13, &["Tax-Audit", "Xylophone-Attack"]),
    (14, &["Dark Humor", "BatYouDidn'tKnow"]),
];
/// The field: racers with no abilities, in seat order.
const FIELD: [usize; 6] = [0, 1, 2, 3, 4, 6];
const STEP: f64 = 1.0 / 60.0;

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

fn setting(name: &str, default: f64) -> f64 {
    std::env::var(name).ok().and_then(|value| value.parse().ok()).unwrap_or(default)
}

/// One match: the racer under test in a seat that moves with the seed, with the
/// abilities in `on` (a bit each) switched on, against the field.
fn play(driver: usize, abilities: usize, on: u8, seed: u32, minutes: f64) -> Outcome {
    let room: control::Room = serde_json::from_value(json!({
        "code": "00", "maxPlayers": MAX_PLAYERS, "arena": seed % 2, "bots": MAX_PLAYERS,
        "dedicated": true, "host": null, "epoch": 1, "seed": seed, "players": [],
        "specialAbilities": true,
    }))
    .unwrap();
    let mut game = Game::create_room(&room).unwrap();
    let subject = seed as usize % MAX_PLAYERS;
    for (seat, actor) in game.actors.iter_mut().enumerate() {
        actor.driver = match seat == subject {
            true => driver,
            false => FIELD[(seat + seed as usize) % FIELD.len()],
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
    let seeds = results[0].len();
    (0..seeds)
        .map(|seed| {
            (0..1usize << abilities)
                .filter(|without| without & (1 << i) == 0)
                .map(|without| {
                    let size = without.count_ones() as usize;
                    let weight = factorial(size) * factorial(abilities - size - 1) / factorial(abilities);
                    let with = without | (1 << i);
                    weight * (measure(results[with][seed]) - measure(results[without][seed]))
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

#[test]
#[ignore = "a simulation, not a test: run it with npm run scenario:ability-importance"]
fn ability_importance() {
    let _kernel = native::KERNEL.lock().unwrap();
    let matches = setting("ABILITY_MATCHES", 40.0) as u32;
    let minutes = setting("ABILITY_MINUTES", 4.0);
    let mut report = String::new();
    let mut summary = Vec::new();
    let _ = writeln!(report, "# Ability importance\n");
    let _ = writeln!(
        report,
        "Each racer with abilities played {matches} bot matches of {minutes} minutes per subset of its abilities, \
         in one of {MAX_PLAYERS} seats against racers with no abilities ({}). Every subset played the same seeds. \
         **Net** is kills minus deaths per match; **won** is the share of matches the racer finished with the most kills. \
         An ability's **contribution** is its Shapley value: its average effect when added to every subset of the racer's \
         other abilities, with a 95% confidence interval over the seeds.\n",
        FIELD.map(driver_name).join(", ")
    );
    let mut details = String::new();
    for (driver, list) in RACERS {
        let abilities = list.len();
        let results: Vec<Vec<Outcome>> = (0..1usize << abilities)
            .map(|on| (1..=matches).map(|seed| play(driver, abilities, on as u8, seed, minutes)).collect())
            .collect();
        let name = driver_name(driver);
        println!("{name}: {} subsets × {matches} matches", 1 << abilities);
        let _ = writeln!(details, "## {name}\n");
        let _ = writeln!(details, "| Abilities on | Kills | Deaths | Net | Won |\n|---|---:|---:|---:|---:|");
        for (on, outcomes) in results.iter().enumerate() {
            let kills = spread(&outcomes.iter().map(|o| o.kills).collect::<Vec<_>>()).0;
            let deaths = spread(&outcomes.iter().map(|o| o.deaths).collect::<Vec<_>>()).0;
            let net = spread(&outcomes.iter().map(|o| o.net()).collect::<Vec<_>>()).0;
            let won = spread(&outcomes.iter().map(|o| o.won).collect::<Vec<_>>()).0;
            let _ = writeln!(details, "| {} | {kills:.2} | {deaths:.2} | {net:+.2} | {:.0}% |", names(list, on), won * 100.0);
        }
        let _ = writeln!(details, "\n| Ability | Net contribution | Kills | Deaths | Won |\n|---|---:|---:|---:|---:|");
        for (i, ability) in list.iter().enumerate() {
            let (net, error) = spread(&shapley(&results, abilities, i, Outcome::net));
            let kills = spread(&shapley(&results, abilities, i, |o| o.kills)).0;
            let deaths = spread(&shapley(&results, abilities, i, |o| o.deaths)).0;
            let won = spread(&shapley(&results, abilities, i, |o| o.won)).0;
            // A deterministic match that never triggers the ability plays the same with or without it.
            let unused = (0..1usize << abilities)
                .filter(|s| s & (1 << i) == 0)
                .all(|s| results[s].iter().zip(&results[s | 1 << i]).all(|(a, b)| a.kills == b.kills && a.deaths == b.deaths));
            let note = match unused {
                true => " (never triggered by bots)",
                false => "",
            };
            let _ = writeln!(
                details,
                "| {ability}{note} | {net:+.2} ± {error:.2} | {kills:+.2} | {deaths:+.2} | {:+.0} pts |",
                won * 100.0
            );
            summary.push((net, error, name, *ability, kills, deaths, won, unused));
        }
        let _ = writeln!(details);
    }
    summary.sort_by(|a, b| b.0.total_cmp(&a.0));
    let _ = writeln!(report, "## Ranking\n\n| Racer | Ability | Net per match | Kills | Deaths | Won |\n|---|---|---:|---:|---:|---:|");
    for (net, error, racer, ability, kills, deaths, won, unused) in &summary {
        let ability = match unused {
            true => format!("{ability} (never triggered by bots)"),
            false => (*ability).into(),
        };
        let _ = writeln!(report, "| {racer} | {ability} | {net:+.2} ± {error:.2} | {kills:+.2} | {deaths:+.2} | {:+.0} pts |", won * 100.0);
    }
    let _ = writeln!(report, "\n{details}");
    let path = std::env::var("ABILITY_REPORT").unwrap_or_else(|_| "ability-importance.md".into());
    std::fs::write(&path, &report).expect("the report is written");
    println!("\n{report}\nReport written to {path}");
}
