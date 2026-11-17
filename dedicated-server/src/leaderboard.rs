//! The all-time leaderboard: for each player's name, matches won, matches
//! played and an Elo rating, and nothing else. It is kept in memory, changes
//! only when a match finishes, and is saved to a file then and when the server stops.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    io::{self, Read},
    path::Path,
};

/// Names kept. A new name beyond this replaces the one that has played least.
const PLAYERS: usize = 1000;
/// The rating everyone starts with.
pub const START: f64 = 1000.0;
/// The most a rating can move in one match, split evenly over a player's opponents.
const K: f64 = 32.0;
/// A rating this far above another's is expected to win ten times in eleven.
const SCALE: f64 = 400.0;
fn start() -> f64 {
    START
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Player {
    pub name: String,
    pub wins: u64,
    pub games: u64,
    /// Elo rating. A board saved before ratings existed starts everyone at 1000.
    #[serde(default = "start")]
    pub rating: f64,
}
/// One driver's result in a finished match: name, kills and deaths.
pub type Result = (String, f64, u64);
/// How a rating moved in one match.
#[derive(Debug, PartialEq, Serialize)]
pub struct Change {
    pub name: String,
    pub before: f64,
    pub after: f64,
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Leaderboard {
    players: Vec<Player>,
}
/// Players are told apart by name, whatever its capitals.
fn same(a: &str, b: &str) -> bool {
    a.to_lowercase() == b.to_lowercase()
}
impl Leaderboard {
    pub fn open(path: &Path) -> io::Result<Self> {
        let file = match std::fs::File::open(path) {
            Ok(file) => file,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Self::default()),
            Err(error) => return Err(error),
        };
        let mut bytes = Vec::new();
        file.take(1_048_577).read_to_end(&mut bytes)?;
        let board: Self = serde_json::from_slice(&bytes).map_err(io::Error::other)?;
        let sound = bytes.len() <= 1_048_576
            && board.players.len() <= PLAYERS
            && board.players.iter().all(|p| !p.name.trim().is_empty() && p.name.encode_utf16().count() <= 24 && p.wins <= p.games && p.rating.is_finite() && (0.0..=10_000.0).contains(&p.rating))
            && board.players.iter().enumerate().all(|(at, p)| !board.players[..at].iter().any(|earlier| same(&earlier.name, &p.name)));
        match sound {
            true => Ok(board),
            false => Err(io::Error::other("Invalid saved leaderboard")),
        }
    }
    pub fn save(&self, path: &Path) -> io::Result<()> {
        crate::sessions::write(path, &serde_json::to_vec(self).map_err(io::Error::other)?)
    }
    /// One finished match: everyone in `played` played it, and `winner`, if a
    /// person won, won it. A name is counted once however often it is given.
    pub fn record(&mut self, played: &[String], winner: Option<&str>) {
        let mut counted: Vec<&str> = Vec::new();
        for name in played {
            if counted.iter().any(|earlier| same(earlier, name)) {
                continue;
            }
            counted.push(name);
            let won = u64::from(winner.is_some_and(|winner| same(winner, name)));
            match self.players.iter_mut().find(|p| same(&p.name, name)) {
                Some(player) => {
                    // The name is shown as it was last written.
                    player.name = name.clone();
                    player.games += 1;
                    player.wins += won;
                }
                None => {
                    if self.players.len() >= PLAYERS {
                        let least = (0..self.players.len()).min_by_key(|at| (self.players[*at].games, self.players[*at].wins)).unwrap();
                        self.players.swap_remove(least);
                    }
                    self.players.push(Player { name: name.clone(), wins: won, games: 1, rating: START });
                }
            }
        }
    }
    /// Rates one finished match between the drivers in `results`, who must already
    /// be on the board. Each pair is compared: more kills wins, then fewer deaths,
    /// and equal on both is a draw. A player gains or loses, against each opponent,
    /// the difference between that result and what their ratings predicted, so an
    /// upset moves ratings more than an expected win. What one gains another loses.
    /// One driver alone, or a name given twice, changes nothing.
    pub fn rate(&mut self, results: &[Result]) -> Vec<Change> {
        let before: Vec<Option<f64>> = results.iter().map(|(name, ..)| self.players.iter().find(|p| same(&p.name, name)).map(|p| p.rating)).collect();
        let repeated = results.iter().enumerate().any(|(at, (name, ..))| results[..at].iter().any(|(earlier, ..)| same(earlier, name)));
        if results.len() < 2 || repeated || before.iter().any(Option::is_none) {
            return Vec::new();
        }
        let before: Vec<f64> = before.into_iter().flatten().collect();
        let mut changes = Vec::new();
        for (me, (name, kills, deaths)) in results.iter().enumerate() {
            let mut gained = 0.0;
            for (other, (_, their_kills, their_deaths)) in results.iter().enumerate().filter(|(other, _)| *other != me) {
                let scored = match kills.total_cmp(their_kills).then(their_deaths.cmp(deaths)) {
                    std::cmp::Ordering::Greater => 1.0,
                    std::cmp::Ordering::Equal => 0.5,
                    std::cmp::Ordering::Less => 0.0,
                };
                let expected = 1.0 / (1.0 + 10f64.powf((before[other] - before[me]) / SCALE));
                gained += scored - expected;
            }
            // Kept to one decimal place, so the file and the board show the same number.
            let after = ((before[me] + K * gained / (results.len() - 1) as f64).clamp(0.0, 10_000.0) * 10.0).round() / 10.0;
            changes.push(Change { name: name.clone(), before: before[me], after });
        }
        for change in &changes {
            if let Some(player) = self.players.iter_mut().find(|p| same(&p.name, &change.name)) {
                player.rating = change.after;
            }
        }
        changes
    }
    /// The board for showing: highest rating first, then most wins, fewest games, and by name.
    pub fn standings(&self) -> Vec<Player> {
        let mut players = self.players.clone();
        players.sort_by(|a, b| b.rating.total_cmp(&a.rating).then(b.wins.cmp(&a.wins)).then(a.games.cmp(&b.games)).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
        players
    }
    pub fn report(&self) -> Value {
        json!({"players":self.standings()})
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn names(list: &[&str]) -> Vec<String> {
        list.iter().map(|name| name.to_string()).collect()
    }
    fn file(label: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("wild-wheels-board-{label}-{}", crate::room::token())).join("leaderboard.json")
    }
    fn player(name: &str, wins: u64, games: u64, rating: f64) -> Player {
        Player { name: name.into(), wins, games, rating }
    }
    /// A board with these names, each having played one match.
    fn board(list: &[&str]) -> Leaderboard {
        let mut board = Leaderboard::default();
        board.record(&names(list), None);
        board
    }
    fn result(name: &str, kills: f64, deaths: u64) -> Result {
        (name.into(), kills, deaths)
    }
    fn rating(board: &Leaderboard, name: &str) -> f64 {
        board.players.iter().find(|p| p.name == name).unwrap().rating
    }
    #[test]
    fn a_match_counts_once_for_each_player_and_a_win_for_its_winner() {
        let mut board = Leaderboard::default();
        board.record(&names(&["Oren", "Sarah", "Dana"]), Some("Sarah"));
        board.record(&names(&["oren", "Sarah"]), Some("OREN"));
        // A bot won this one: everyone played, nobody won.
        board.record(&names(&["Sarah", "Dana", "Dana"]), None);
        assert_eq!(
            board.standings(),
            [player("oren", 1, 2, START), player("Sarah", 1, 3, START), player("Dana", 0, 2, START)],
            "with ratings level: most wins first, then fewest games; a name is one player whatever its capitals"
        );
    }
    #[test]
    fn between_two_level_players_the_winner_takes_sixteen_points_from_the_loser() {
        let mut board = board(&["Oren", "Sarah"]);
        let changes = board.rate(&[result("Oren", 10.0, 2), result("Sarah", 4.0, 7)]);
        assert_eq!(changes, [Change { name: "Oren".into(), before: 1000.0, after: 1016.0 }, Change { name: "Sarah".into(), before: 1000.0, after: 984.0 }]);
        assert_eq!(board.standings().iter().map(|p| p.name.as_str()).collect::<Vec<_>>(), ["Oren", "Sarah"], "the board is in rating order");
        // Equal kills: fewer deaths wins. Equal on both: a draw, and level players stay put.
        let mut close = super::tests::board(&["A", "B", "C", "D"]);
        close.rate(&[result("A", 5.0, 1), result("B", 5.0, 3)]);
        assert!(rating(&close, "A") > 1000.0 && rating(&close, "B") < 1000.0);
        close.rate(&[result("C", 5.0, 3), result("D", 5.0, 3)]);
        assert_eq!((rating(&close, "C"), rating(&close, "D")), (1000.0, 1000.0));
    }
    #[test]
    fn an_upset_moves_ratings_more_than_an_expected_win() {
        let mut expected = board(&["Strong", "Weak"]);
        expected.players[0].rating = 1400.0;
        let mut upset = expected.clone();
        expected.rate(&[result("Strong", 10.0, 0), result("Weak", 0.0, 10)]);
        upset.rate(&[result("Strong", 0.0, 10), result("Weak", 10.0, 0)]);
        // Ten times in eleven the stronger player should win, so winning earns about three points.
        assert_eq!((rating(&expected, "Strong"), rating(&expected, "Weak")), (1402.9, 997.1));
        assert_eq!((rating(&upset, "Strong"), rating(&upset, "Weak")), (1370.9, 1029.1));
    }
    #[test]
    fn in_a_larger_match_every_pair_counts_and_what_some_gain_others_lose() {
        let mut board = board(&["First", "Second", "Third", "Fourth"]);
        let changes = board.rate(&[result("Third", 3.0, 5), result("First", 10.0, 1), result("Fourth", 0.0, 9), result("Second", 6.0, 4)]);
        assert_eq!(changes.len(), 4);
        // Level players: first beats three, second two, third one, fourth none.
        assert_eq!([rating(&board, "First"), rating(&board, "Second"), rating(&board, "Third"), rating(&board, "Fourth")], [1016.0, 1005.3, 994.7, 984.0]);
        assert!((board.players.iter().map(|p| p.rating - START).sum::<f64>()).abs() < 0.11, "nothing is created or lost beyond rounding");
        // The most a rating can move in one match is the same however many play.
        assert!(changes.iter().all(|change| (change.after - change.before).abs() <= 16.0));
    }
    #[test]
    fn a_match_with_no_one_to_compare_against_changes_no_rating() {
        let mut board = board(&["Oren", "Sarah"]);
        assert!(board.rate(&[result("Oren", 10.0, 0)]).is_empty(), "a driver alone, or among bots");
        assert!(board.rate(&[]).is_empty());
        assert!(board.rate(&[result("Oren", 10.0, 0), result("Stranger", 0.0, 5)]).is_empty(), "someone not on the board");
        assert!(board.rate(&[result("Oren", 10.0, 0), result("oren", 0.0, 5)]).is_empty(), "one name given twice");
        assert_eq!((rating(&board, "Oren"), rating(&board, "Sarah")), (START, START));
    }
    #[test]
    fn the_file_holds_only_names_wins_games_and_ratings_and_survives_a_restart() {
        let path = file("saved");
        let mut board = Leaderboard::default();
        board.record(&names(&["Oren", "Sarah"]), Some("Oren"));
        board.rate(&[result("Oren", 10.0, 2), result("Sarah", 4.0, 7)]);
        board.save(&path).unwrap();
        let saved: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(saved, json!({"players":[{"name":"Oren","wins":1,"games":1,"rating":1016.0},{"name":"Sarah","wins":0,"games":1,"rating":984.0}]}));
        let mut restored = Leaderboard::open(&path).unwrap();
        restored.record(&names(&["Sarah"]), Some("Sarah"));
        restored.save(&path).unwrap();
        assert_eq!(Leaderboard::open(&path).unwrap().report(), json!({"players":[{"name":"Oren","wins":1,"games":1,"rating":1016.0},{"name":"Sarah","wins":1,"games":2,"rating":984.0}]}));
        assert!(Leaderboard::open(&file("missing")).unwrap().standings().is_empty(), "no file yet is an empty board");
        // A board saved before ratings existed keeps its counts and starts everyone at 1000.
        std::fs::write(&path, r#"{"players":[{"name":"Veteran","wins":5,"games":9}]}"#).unwrap();
        assert_eq!(Leaderboard::open(&path).unwrap().standings(), [player("Veteran", 5, 9, START)]);
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
    #[test]
    fn a_damaged_file_is_refused_instead_of_being_overwritten() {
        let path = file("damaged");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        for bad in [
            "not json",
            r#"{"players":[{"name":"Oren","wins":2,"games":1}]}"#,
            r#"{"players":[{"name":"Oren","wins":0,"games":1},{"name":"oren","wins":0,"games":1}]}"#,
            r#"{"players":[{"name":"Oren","wins":0,"games":1,"kills":9}]}"#,
            r#"{"players":[{"name":"","wins":0,"games":1}]}"#,
            r#"{"players":[{"name":"Oren","wins":0,"games":1,"rating":-5}]}"#,
            r#"{"players":[{"name":"Oren","wins":0,"games":1,"rating":1e9}]}"#,
        ] {
            std::fs::write(&path, bad).unwrap();
            assert!(Leaderboard::open(&path).is_err(), "{bad}");
        }
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
    #[test]
    fn the_board_cannot_grow_without_end() {
        let mut board = Leaderboard::default();
        board.record(&names(&["Regular"]), Some("Regular"));
        board.record(&names(&["Regular"]), None);
        for n in 0..PLAYERS + 50 {
            board.record(&[format!("Visitor {n}")], None);
        }
        assert_eq!(board.players.len(), PLAYERS);
        assert!(board.players.contains(&player("Regular", 1, 2, START)), "the least played names make room, not the regulars");
    }
}
