//! Lethality simulation: bots playing the racers whose special abilities deal
//! damage fight full matches, and every kill is credited to what dealt it, so
//! abilities can be compared by the kills they score. It plays the real game
//! rules with no rendering or network, and runs only when asked:
//! `npm run scenario:lethality` (scripts/scenarios/lethality.mjs).
//!
//! Settings, from the environment: LETHALITY_MATCHES (default 6), each played
//! until a racer reaches LETHALITY_TARGET kills (default 50).
use super::*;
use std::collections::BTreeMap;

/// Racers whose special ability deals damage, with the kill kind it records.
const ABILITIES: [(usize, &str, &str); 5] = [
    (7, "nightmare", "Nightmare Fuel"),
    (5, "locust", "Low-Cost Locust"),
    (9, "fashion", "Fashion-Statement"),
    (10, "fireRing", "fire ring"),
    (13, "tax", "Tax-Audit"),
];
/// Simulated seconds per step, as the server ticks.
const STEP: f64 = 1.0 / 60.0;

#[derive(Default)]
struct Tally {
    seats: usize,
    seconds: f64,
    ability_kills: usize,
    by_kind: BTreeMap<String, usize>,
    deaths: usize,
    deaths_to_abilities: usize,
}

fn setting(name: &str, default: usize) -> usize {
    std::env::var(name).ok().and_then(|value| value.parse().ok()).unwrap_or(default)
}

/// One match of bots only, seated in turn as the ability racers.
fn play(seed: u32, target: f64, tallies: &mut BTreeMap<usize, Tally>) -> (f64, usize) {
    let room: control::Room = serde_json::from_value(json!({
        "code": "00", "maxPlayers": MAX_PLAYERS, "arena": seed % 2, "bots": MAX_PLAYERS,
        "dedicated": true, "host": null, "epoch": 1, "seed": seed, "players": [],
        "specialAbilities": true,
    }))
    .unwrap();
    assert!(room.valid(), "simulation room");
    let mut game = Game::create_room(&room).unwrap();
    // Seat the ability racers in turn, shifted each match so no racer keeps a
    // starting position.
    for (seat, actor) in game.actors.iter_mut().enumerate() {
        actor.driver = ABILITIES[(seat + seed as usize) % ABILITIES.len()].0;
        actor.name = Some(format!("{} {}", driver_name(actor.driver), seat + 1));
    }
    game.global.target_score = target;
    game.global.duration = f64::INFINITY;
    game.global.phase = "countdown".into();
    let mut seen = 0;
    let mut steps = 0usize;
    while game.global.phase != "finished" && steps < 60 * 60 * 120 {
        super::abilities::press_for_bots(&mut game);
        game.tick(Frame { dt: STEP, inputs: Vec::new() });
        steps += 1;
        for kill in game.global.kill_feed.iter().filter(|kill| kill.id > seen && !kill.assist) {
            let victim = game.actors[kill.victim].driver;
            let ability = ABILITIES.iter().any(|(_, kind, _)| *kind == kill.kind);
            let dead = tallies.entry(victim).or_default();
            dead.deaths += 1;
            dead.deaths_to_abilities += usize::from(ability);
            if kill.attacker < game.actors.len() {
                let killer = tallies.entry(game.actors[kill.attacker].driver).or_default();
                *killer.by_kind.entry(kill.kind.clone()).or_default() += 1;
                killer.ability_kills += usize::from(ability);
            }
        }
        seen = game.global.kill_feed.iter().map(|kill| kill.id).max().unwrap_or(seen).max(seen);
    }
    let seconds = game.global.elapsed;
    for actor in &game.actors {
        let tally = tallies.entry(actor.driver).or_default();
        tally.seats += 1;
        tally.seconds += seconds;
    }
    (seconds, seen as usize)
}

#[test]
#[ignore = "a simulation, not a test: run it with npm run scenario:lethality"]
fn lethality() {
    let _kernel = native::KERNEL.lock().unwrap();
    let (matches, target) = (setting("LETHALITY_MATCHES", 6), setting("LETHALITY_TARGET", 50));
    println!(
        "{matches} matches of {MAX_PLAYERS} bots, specials on, each until a racer has {target} kills"
    );
    let mut tallies = BTreeMap::new();
    for seed in 1..=matches as u32 {
        let (seconds, kills) = play(seed, target as f64, &mut tallies);
        println!("match {seed}: {kills} kills in {:.1} minutes", seconds / 60.0);
    }
    println!();
    println!(
        "{:<20} {:<18} {:>6} {:>7} {:>8} {:>7} {:>9} {:>11}",
        "racer", "ability", "seats", "kills", "ability", "share", "per hour", "deaths to"
    );
    println!("{:<20} {:<18} {:>6} {:>7} {:>8} {:>7} {:>9} {:>11}", "", "", "", "", "kills", "", "of play", "abilities");
    let mut rows: Vec<_> = ABILITIES.iter().filter_map(|(driver, kind, name)| Some((driver, kind, name, tallies.get(driver)?))).collect();
    rows.sort_by_key(|(_, _, _, tally)| std::cmp::Reverse(tally.ability_kills));
    for (driver, kind, name, tally) in rows {
        let all: usize = tally.by_kind.values().sum();
        let ability = tally.by_kind.get(*kind).copied().unwrap_or(0);
        println!(
            "{:<20} {:<18} {:>6} {:>7} {:>8} {:>6.0}% {:>9.1} {:>11}",
            driver_name(*driver),
            name,
            tally.seats,
            all,
            ability,
            100.0 * ability as f64 / all.max(1) as f64,
            ability as f64 / (tally.seconds / 3600.0).max(1e-9),
            tally.deaths_to_abilities,
        );
        let others: Vec<String> = tally.by_kind.iter().filter(|(k, _)| k != kind).map(|(k, n)| format!("{k} {n}")).collect();
        println!("{:<20}   other kills: {}", "", match others.is_empty() { true => "none".into(), false => others.join(", ") });
    }
    println!();
    println!("Ability kills are those its own ability dealt; per hour is per seat-hour of play.");
    println!("Bots never press Nightmare Fuel themselves; the simulation presses it whenever it is ready.");
}
