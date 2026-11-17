//! The all-time leaderboard: for each player's name, matches won and matches
//! played, and nothing else. It is kept in memory, changes only when a match
//! finishes, and is saved to a file then and when the server stops.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    io::{self, Read},
    path::Path,
};

/// Names kept. A new name beyond this replaces the one that has played least.
const PLAYERS: usize = 1000;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Player {
    pub name: String,
    pub wins: u64,
    pub games: u64,
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
            && board.players.iter().all(|p| !p.name.trim().is_empty() && p.name.encode_utf16().count() <= 24 && p.wins <= p.games)
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
                    self.players.push(Player { name: name.clone(), wins: won, games: 1 });
                }
            }
        }
    }
    /// The board for showing: most wins first, then fewest games, then by name.
    pub fn standings(&self) -> Vec<Player> {
        let mut players = self.players.clone();
        players.sort_by(|a, b| b.wins.cmp(&a.wins).then(a.games.cmp(&b.games)).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
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
    #[test]
    fn a_match_counts_once_for_each_player_and_a_win_for_its_winner() {
        let mut board = Leaderboard::default();
        board.record(&names(&["Oren", "Sarah", "Dana"]), Some("Sarah"));
        board.record(&names(&["oren", "Sarah"]), Some("OREN"));
        // A bot won this one: everyone played, nobody won.
        board.record(&names(&["Sarah", "Dana", "Dana"]), None);
        assert_eq!(
            board.standings(),
            [
                Player { name: "oren".into(), wins: 1, games: 2 },
                Player { name: "Sarah".into(), wins: 1, games: 3 },
                Player { name: "Dana".into(), wins: 0, games: 2 },
            ],
            "most wins first, then fewest games; a name is one player whatever its capitals"
        );
    }
    #[test]
    fn the_file_holds_only_names_wins_and_games_and_survives_a_restart() {
        let path = file("saved");
        let mut board = Leaderboard::default();
        board.record(&names(&["Oren", "Sarah"]), Some("Oren"));
        board.save(&path).unwrap();
        let saved: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(saved, json!({"players":[{"name":"Oren","wins":1,"games":1},{"name":"Sarah","wins":0,"games":1}]}));
        let mut restored = Leaderboard::open(&path).unwrap();
        restored.record(&names(&["Sarah"]), Some("Sarah"));
        restored.save(&path).unwrap();
        assert_eq!(Leaderboard::open(&path).unwrap().report(), json!({"players":[{"name":"Oren","wins":1,"games":1},{"name":"Sarah","wins":1,"games":2}]}));
        assert!(Leaderboard::open(&file("missing")).unwrap().standings().is_empty(), "no file yet is an empty board");
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
        assert!(board.standings()[0] == Player { name: "Regular".into(), wins: 1, games: 2 }, "the least played names make room, not the regulars");
    }
}
