use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    io::{self, Read},
    path::Path,
};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Counts {
    ticks: u64,
    overruns: u64,
    tick_total_us: u64,
    tick_max_us: u64,
    peak_players: usize,
    player_ticks: u64,
    first_seen: Option<u64>,
    last_seen: Option<u64>,
    // Power-of-two upper bounds allow percentiles to merge across restarts.
    timings: Vec<u64>,
}
impl Default for Counts {
    fn default() -> Self {
        Self {
            ticks: 0,
            overruns: 0,
            tick_total_us: 0,
            tick_max_us: 0,
            peak_players: 0,
            player_ticks: 0,
            first_seen: None,
            last_seen: None,
            timings: vec![0; 65],
        }
    }
}
impl Counts {
    fn record(&mut self, at: u64, us: u64, overrun: bool, players: usize) {
        self.ticks += 1;
        self.overruns += u64::from(overrun);
        self.tick_total_us += us;
        self.tick_max_us = self.tick_max_us.max(us);
        self.peak_players = self.peak_players.max(players);
        self.player_ticks += players as u64;
        self.first_seen = Some(self.first_seen.map_or(at, |first| first.min(at)));
        self.last_seen = Some(self.last_seen.map_or(at, |last| last.max(at)));
        let bucket = match us {
            0 => 0,
            _ => (65 - (us - 1).leading_zeros()) as usize,
        };
        self.timings[bucket.min(64)] += 1;
    }
    fn report(&self) -> Value {
        let threshold = (self.ticks as u128 * 99).div_ceil(100);
        let mut count = 0u128;
        let mut p99 = 0;
        for (bucket, samples) in self.timings.iter().enumerate() {
            count += *samples as u128;
            if count < threshold {
                continue;
            }
            p99 = match bucket {
                0 => 0,
                64 => u64::MAX,
                _ => 1u64 << (bucket - 1),
            };
            break;
        }
        json!({"ticks":self.ticks,"overruns":self.overruns,
            "tickMeanUs":match self.ticks {0=>0.0,_=>self.tick_total_us as f64/self.ticks as f64},
            "tickMaxUs":self.tick_max_us,"tickP99UpperUs":p99,
            "peakPlayers":self.peak_players,"playerSeconds":self.player_ticks as f64/60.0,
            "simulationSeconds":self.ticks as f64/60.0,
            "firstSeen":self.first_seen,"lastSeen":self.last_seen})
    }
    fn valid(&self) -> bool {
        self.timings.len() == 65
            && self.timings.iter().map(|n| *n as u128).sum::<u128>() == self.ticks as u128
            && self.overruns <= self.ticks
            && self.peak_players <= 8
            && self.player_ticks as u128 <= self.ticks as u128 * 8
            && match (self.first_seen, self.last_seen) {
                (None, None) => self.ticks == 0,
                (Some(first), Some(last)) => {
                    self.ticks > 0 && first <= last && last < 253_402_300_800
                }
                _ => false,
            }
    }
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Stats {
    total: Counts,
    by_commit: BTreeMap<String, Counts>,
    by_date: BTreeMap<String, Counts>,
    #[serde(skip)]
    day: u64,
    #[serde(skip)]
    date: String,
}
impl Stats {
    pub fn open(path: &Path) -> io::Result<Self> {
        let file = match std::fs::File::open(path) {
            Ok(file) => file,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Self::default()),
            Err(error) => return Err(error),
        };
        const MAX_BYTES: u64 = 64 * 1024 * 1024;
        let mut bytes = Vec::new();
        file.take(MAX_BYTES + 1).read_to_end(&mut bytes)?;
        if bytes.len() as u64 > MAX_BYTES {
            return Err(io::Error::other("Saved stats are too large"));
        }
        let stats: Self = serde_json::from_slice(&bytes).map_err(io::Error::other)?;
        let valid_commit = |s: &str| {
            (s.len() == 40 && s.bytes().all(|c| c.is_ascii_hexdigit()))
                || (s.starts_with("build:")
                    && s.len() == 16
                    && s[6..].bytes().all(|c| c.is_ascii_hexdigit()))
        };
        let totals_match = |rows: &BTreeMap<String, Counts>| {
            rows.values().map(|v| v.ticks as u128).sum::<u128>() == stats.total.ticks as u128
                && rows.values().map(|v| v.overruns as u128).sum::<u128>()
                    == stats.total.overruns as u128
                && rows.values().map(|v| v.tick_total_us as u128).sum::<u128>()
                    == stats.total.tick_total_us as u128
        };
        if !stats.total.valid()
            || stats.by_commit.len() > 100_000
            || stats.by_date.len() > 100_000
            || stats
                .by_commit
                .iter()
                .any(|(key, value)| !valid_commit(key) || !value.valid())
            || stats.by_date.iter().any(|(key, value)| {
                !value.valid()
                    || value.first_seen.is_none_or(|at| date(at) != *key)
                    || value.last_seen.is_none_or(|at| date(at) != *key)
            })
            || !totals_match(&stats.by_commit)
            || !totals_match(&stats.by_date)
        {
            return Err(io::Error::other("Invalid saved stats"));
        }
        Ok(stats)
    }
    pub fn record(&mut self, commit: &str, at: u64, us: u64, overrun: bool, players: usize) {
        let day = at / 86_400;
        if self.date.is_empty() || self.day != day {
            self.day = day;
            self.date = date(at);
        }
        if !self.by_commit.contains_key(commit) {
            self.by_commit.insert(commit.to_owned(), Counts::default());
        }
        if !self.by_date.contains_key(&self.date) {
            self.by_date.insert(self.date.clone(), Counts::default());
        }
        self.total.record(at, us, overrun, players);
        self.by_commit
            .get_mut(commit)
            .unwrap()
            .record(at, us, overrun, players);
        self.by_date
            .get_mut(&self.date)
            .unwrap()
            .record(at, us, overrun, players);
    }
    pub fn report(&self) -> Value {
        let reports = |rows: &BTreeMap<String, Counts>| {
            rows.iter()
                .map(|(key, value)| (key.clone(), value.report()))
                .collect::<BTreeMap<_, _>>()
        };
        json!({"total":self.total.report(),"byCommit":reports(&self.by_commit),"byDate":reports(&self.by_date)})
    }
    pub fn save(&self, path: &Path) -> io::Result<()> {
        crate::sessions::write(path, &serde_json::to_vec(self).map_err(io::Error::other)?)
    }
}

// UTC calendar date, computed only when the day changes; no date-library dependency.
fn date(at: u64) -> String {
    let mut days = at / 86_400;
    let mut year = 1970;
    let leap = |y| y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);
    loop {
        let length = match leap(year) {
            true => 366,
            false => 365,
        };
        if days < length {
            break;
        }
        days -= length;
        year += 1;
    }
    let months = [
        31,
        match leap(year) {
            true => 29,
            false => 28,
        },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    let mut month = 1;
    for length in months {
        if days < length {
            break;
        }
        days -= length;
        month += 1;
    }
    format!("{year:04}-{month:02}-{:02}", days + 1)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn totals_and_independent_commit_and_utc_date_groups_survive_restart() {
        let path = std::env::temp_dir()
            .join(format!("wild-wheels-stats-{}", crate::room::token()))
            .join("stats.json");
        let first = "a".repeat(40);
        let second = "b".repeat(40);
        let mut stats = Stats::open(&path).unwrap();
        stats.record(&first, 86_399, 10, false, 2);
        stats.record(&first, 86_400, 20, true, 3);
        stats.record(&second, 86_401, 40, false, 1);
        stats.save(&path).unwrap();
        let mut restored = Stats::open(&path).unwrap();
        restored.record(&second, 86_402, 30, false, 2);
        let report = restored.report();
        assert_eq!(report["total"]["ticks"], 4);
        assert_eq!(report["total"]["overruns"], 1);
        assert_eq!(report["total"]["tickMeanUs"], 25.0);
        assert_eq!(report["total"]["tickMaxUs"], 40);
        assert_eq!(report["total"]["tickP99UpperUs"], 64);
        assert_eq!(report["total"]["peakPlayers"], 3);
        assert_eq!(report["byCommit"][&first]["ticks"], 2);
        assert_eq!(report["byCommit"][&second]["ticks"], 2);
        assert_eq!(report["byDate"]["1970-01-01"]["ticks"], 1);
        assert_eq!(report["byDate"]["1970-01-02"]["ticks"], 3);
        assert_eq!(report["byDate"]["1970-01-02"]["overruns"], 1);
        restored.save(&path).unwrap();
        assert_eq!(Stats::open(&path).unwrap().report(), report);
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
    #[test]
    fn utc_dates_handle_midnight_leap_days_and_century_rules() {
        assert_eq!(date(0), "1970-01-01");
        assert_eq!(date(86_399), "1970-01-01");
        assert_eq!(date(86_400), "1970-01-02");
        assert_eq!(date(951_782_400), "2000-02-29");
        assert_eq!(date(4_107_542_400), "2100-03-01");
    }
    #[test]
    fn invalid_stats_do_not_silently_reset_history() {
        let path =
            std::env::temp_dir().join(format!("wild-wheels-bad-stats-{}", crate::room::token()));
        std::fs::write(
            &path,
            b"{\"total\":{\"ticks\":100},\"byCommit\":{},\"byDate\":{}}",
        )
        .unwrap();
        assert!(Stats::open(&path).is_err());
        assert_eq!(
            std::fs::read(&path).unwrap(),
            b"{\"total\":{\"ticks\":100},\"byCommit\":{},\"byDate\":{}}"
        );
        std::fs::remove_file(path).unwrap();
    }
}
