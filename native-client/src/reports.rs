//! Reports this client's problems to the server's log. Reports wait in a short
//! queue and are sent a few at a time over HTTP by the network worker, never over
//! the game socket and never from the thread that draws. The same problem is
//! counted, not repeated, and one run can only send so much. See docs/logging.md.
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant},
};

/// Reports waiting to be sent; more are counted and dropped.
const QUEUED: usize = 40;
/// Reports one run of the client may send.
const SESSION: usize = 400;
/// The most one request carries, under the server's limit for a report.
const BATCH_BYTES: usize = 7000;
const BATCH_ENTRIES: usize = 32;
/// How often waiting reports are sent.
pub const EVERY: Duration = Duration::from_secs(15);

struct Entry {
    key: String,
    level: &'static str,
    event: String,
    data: Value,
    at: Instant,
    count: u64,
}
#[derive(Default)]
struct Queue {
    waiting: Vec<Entry>,
    noted: usize,
    dropped: u64,
    last: HashMap<String, Instant>,
    /// Entries and dropped reports in the request being sent.
    sending: Option<(usize, u64)>,
    /// The server has no log, or refuses this client's reports.
    stopped: bool,
}
static QUEUE: Mutex<Option<Queue>> = Mutex::new(None);
fn with<T>(act: impl FnOnce(&mut Queue) -> T) -> T {
    let mut queue = QUEUE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    act(queue.get_or_insert_with(Queue::default))
}
impl Queue {
    fn note(&mut self, level: &'static str, event: &str, data: Value, at: Instant) {
        let key = format!("{level}:{event}:{data}");
        if let Some(waiting) = self.waiting.iter_mut().find(|entry| entry.key == key) {
            waiting.count += 1;
            return;
        }
        if self.stopped || self.noted >= SESSION || self.waiting.len() >= QUEUED {
            self.dropped += 1;
            return;
        }
        self.noted += 1;
        self.waiting.push(Entry {
            key,
            level,
            event: event.to_owned(),
            data,
            at,
            count: 1,
        });
    }
    fn batch(&mut self, at: Instant) -> Option<String> {
        if self.sending.is_some() || self.waiting.is_empty() {
            return None;
        }
        let mut entries = Vec::new();
        let mut size = 100;
        for entry in &self.waiting {
            let mut sending = json!({"level":entry.level,"event":entry.event,"agoMs":(at.saturating_duration_since(entry.at).as_millis() as u64).min(3_600_000),"count":entry.count,"data":entry.data});
            let mut bytes = sending.to_string().len() + 1;
            if !entries.is_empty() && (size + bytes > BATCH_BYTES || entries.len() >= BATCH_ENTRIES)
            {
                break;
            }
            // One report too large to send alone is cut down to what it is about.
            if size + bytes > BATCH_BYTES {
                let text = entry.data.to_string();
                let mut cut = text.len().min(600);
                while !text.is_char_boundary(cut) {
                    cut -= 1;
                }
                sending["data"] = json!({"cut":&text[..cut]});
                bytes = sending.to_string().len() + 1;
            }
            size += bytes;
            entries.push(sending);
        }
        let taken = entries.len();
        if self.dropped > 0 {
            entries.push(json!({"level":"warn","event":"reports-dropped","agoMs":0,"count":1,"data":{"count":self.dropped}}));
        }
        self.sending = Some((taken, self.dropped));
        Some(json!({"client":"native","build":concat!("native ", env!("CARGO_PKG_VERSION")),"entries":entries}).to_string())
    }
    /// The request ended: `Some(true)` kept by the server, `Some(false)` refused
    /// for good, `None` not delivered, so the reports wait for the next turn.
    fn sent(&mut self, kept: Option<bool>) {
        let Some((taken, dropped)) = self.sending.take() else {
            return;
        };
        match kept {
            Some(true) => {
                self.waiting.drain(..taken.min(self.waiting.len()));
                self.dropped -= dropped.min(self.dropped);
            }
            Some(false) => {
                self.stopped = true;
                self.waiting.clear();
            }
            None => {}
        }
    }
}
/// Queues one report. Never waits for the network or the disk.
pub fn note(level: &'static str, event: &str, data: Value) {
    with(|queue| queue.note(level, event, data, Instant::now()));
}
/// At most one report per `key` every `seconds`, for problems that would recur every frame.
pub fn limited(
    key: &str,
    seconds: f32,
    level: &'static str,
    event: &str,
    data: impl FnOnce() -> Value,
) {
    with(|queue| {
        let now = Instant::now();
        if queue
            .last
            .get(key)
            .is_some_and(|last| now.duration_since(*last).as_secs_f32() < seconds)
        {
            return;
        }
        if queue.last.len() > 200 {
            queue.last.clear();
        }
        queue.last.insert(key.to_owned(), now);
        queue.note(level, event, data(), now);
    });
}
/// The next request body, if reports wait and none is being sent.
pub fn batch() -> Option<String> {
    with(|queue| queue.batch(Instant::now()))
}
/// What became of the request `batch` made, by the server's status, if it answered.
pub fn sent(status: Option<u16>) {
    with(|queue| {
        queue.sent(match status {
            Some(200) => Some(true),
            Some(400 | 404 | 415) => Some(false),
            _ => None,
        })
    });
}

/// Keeps a crash for the next run to report, since this one cannot send it.
pub fn remember_panics() {
    let earlier = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |panic| {
        if let Ok(directory) = crate::session::data_directory() {
            let _ = std::fs::create_dir_all(&directory);
            let _ = std::fs::write(
                directory.join("last-crash.json"),
                json!({"message":panic.to_string(),"at":crate::session::now()}).to_string(),
            );
        }
        earlier(panic);
    }));
    let Ok(file) =
        crate::session::data_directory().map(|directory| directory.join("last-crash.json"))
    else {
        return;
    };
    if let Ok(text) = std::fs::read_to_string(&file) {
        let _ = std::fs::remove_file(&file);
        if let Ok(crash) = serde_json::from_str::<Value>(&text[..text.len().min(4096)]) {
            note(
                "error",
                "crashed-last-run",
                json!({"message":crash["message"].as_str().map(|m| m.chars().take(600).collect::<String>()),"secondsAgo":crate::session::now().saturating_sub(crash["at"].as_u64().unwrap_or(0))}),
            );
        }
    }
}

/// A minute of frames at a time: how long they took and how long the game went
/// without news from the server. Only a bad minute, or a finished match, is reported.
#[derive(Default)]
pub struct FrameHealth {
    times: Vec<f32>,
    last: Option<f64>,
    started: Option<f64>,
    gap: f64,
    long: u32,
    /// The match shown, and its clock at the minute's first and latest frames.
    clock: Option<(u64, f64, f64)>,
    /// The longest frames as (match seconds, milliseconds), longest first.
    slowest: Vec<(f64, f32)>,
    /// Frames, long frames, the longest frame and wait, and slow minutes this match.
    played: (usize, u32, f32, f64, u32),
}
impl FrameHealth {
    /// `now` and `heard` are seconds on the same clock; `heard` is when the server
    /// last spoke. `clock` is the match and its seconds as this client shows them:
    /// the server notes the same clock on abilities and kills, so slow frames can
    /// be set beside them.
    pub fn frame(&mut self, now: f64, racing: bool, heard: f64, clock: (u64, f64)) {
        if !racing {
            if self.played.0 > 0 || !self.times.is_empty() {
                self.minute();
                let (frames, long, worst, gap, slow) = std::mem::take(&mut self.played);
                note(
                    "info",
                    "match-frames",
                    json!({"frames":frames,"over50Ms":long,"longestMs":worst,"longestWaitForServerMs":(gap * 1000.0).round(),"slowMinutes":slow}),
                );
            }
            (self.last, self.started) = (None, None);
            return;
        }
        if let Some(last) = self.last {
            let took = ((now - last) * 1000.0) as f32;
            self.times.push(took);
            if took > 50.0 {
                self.long += 1;
                self.slowest
                    .push(((clock.1 * 10.0).round() / 10.0, took.round()));
                self.slowest.sort_by(|a, b| b.1.total_cmp(&a.1));
                self.slowest.truncate(8);
            }
            self.gap = self.gap.max(now - heard);
        }
        self.last = Some(now);
        self.clock = Some((
            clock.0,
            self.clock.map_or(clock.1, |shown| shown.1),
            clock.1,
        ));
        if now - *self.started.get_or_insert(now) >= 60.0 {
            self.minute();
        }
    }
    fn minute(&mut self) {
        let mut times = std::mem::take(&mut self.times);
        self.started = None;
        if times.is_empty() {
            return;
        }
        times.sort_by(f32::total_cmp);
        let at = |share: f32| {
            (times[((times.len() as f32 * share) as usize).min(times.len() - 1)] * 10.0).round()
                / 10.0
        };
        let slow = at(0.95) > 40.0 || self.long >= 10 || self.gap > 1.0;
        self.played = (
            self.played.0 + times.len(),
            self.played.1 + self.long,
            self.played.2.max(at(1.0)),
            self.played.3.max(self.gap),
            self.played.4 + u32::from(slow),
        );
        let (shown, slowest) = (self.clock.take(), std::mem::take(&mut self.slowest));
        if let (true, Some((shown, from, to))) = (slow, shown) {
            note(
                "warn",
                "slow-minute",
                json!({"frames":times.len(),"medianMs":at(0.5),"p95Ms":at(0.95),"longestMs":at(1.0),"over50Ms":self.long,"longestWaitForServerMs":(self.gap * 1000.0).round(),
                    "match":shown,"fromMatchSeconds":(from * 10.0).round() / 10.0,"toMatchSeconds":(to * 10.0).round() / 10.0,"slowest":slowest}),
            );
        }
        (self.long, self.gap) = (0, 0.0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn the_same_problem_is_counted_and_a_batch_says_how_long_ago_each_happened() {
        let mut queue = Queue::default();
        let start = Instant::now();
        queue.note("error", "connection-lost", json!({"reason":"reset"}), start);
        queue.note(
            "error",
            "connection-lost",
            json!({"reason":"reset"}),
            start + Duration::from_secs(2),
        );
        queue.note(
            "warn",
            "slow-minute",
            json!({"p95Ms":80}),
            start + Duration::from_secs(3),
        );
        let body: Value =
            serde_json::from_str(&queue.batch(start + Duration::from_secs(5)).unwrap()).unwrap();
        assert_eq!(body["client"], "native");
        assert_eq!(
            body["entries"][0],
            json!({"level":"error","event":"connection-lost","agoMs":5000,"count":2,"data":{"reason":"reset"}})
        );
        assert_eq!(body["entries"][1]["agoMs"], 2000);
        assert!(queue.batch(start).is_none(), "one request at a time");
        // An undelivered request leaves its reports waiting; a delivered one clears them.
        queue.sent(None);
        assert_eq!(queue.waiting.len(), 2);
        assert!(queue.batch(start).is_some());
        queue.sent(Some(true));
        assert!(queue.waiting.is_empty() && queue.batch(start).is_none());
    }
    #[test]
    fn a_flood_is_dropped_and_counted_and_every_batch_fits_one_request() {
        let mut queue = Queue::default();
        let now = Instant::now();
        for n in 0..100 {
            queue.note("warn", "flood", json!({"n":n,"pad":"p".repeat(300)}), now);
        }
        assert_eq!((queue.waiting.len(), queue.dropped), (QUEUED, 60));
        let (mut sent, mut batches) = (0, 0);
        while let Some(body) = queue.batch(now) {
            assert!(body.len() <= 8192, "{}", body.len());
            let entries = serde_json::from_str::<Value>(&body).unwrap()["entries"]
                .as_array()
                .unwrap()
                .clone();
            if batches == 0 {
                assert_eq!(entries.last().unwrap()["data"], json!({"count":60}));
            }
            sent += entries
                .iter()
                .filter(|entry| entry["event"] == "flood")
                .count();
            batches += 1;
            queue.sent(Some(true));
        }
        assert_eq!((sent, queue.dropped), (QUEUED, 0));
        assert!(batches > 1);
        // One oversized report is cut instead of blocking the queue forever.
        queue.note("error", "huge", json!({"text":"é".repeat(20_000)}), now);
        assert!(queue.batch(now).unwrap().len() <= 8192);
        queue.sent(Some(true));
        // A run has a ceiling, and a server without a log is not asked again.
        for n in 0..1000 {
            queue.note("info", "more", json!({"n":n}), now);
            queue.batch(now);
            queue.sent(Some(true));
        }
        assert_eq!(queue.noted, SESSION);
        let mut refused = Queue::default();
        refused.note("info", "first", json!({}), now);
        refused.batch(now);
        refused.sent(Some(false));
        refused.note("info", "second", json!({}), now);
        assert!(refused.waiting.is_empty() && refused.batch(now).is_none());
    }
    #[test]
    fn only_a_bad_minute_of_frames_counts_as_slow() {
        let mut health = FrameHealth::default();
        let mut now = 0.0;
        for _ in 0..3700 {
            now += 1.0 / 60.0;
            health.frame(now, true, now - 0.03, (7, now));
        }
        assert_eq!(
            (health.played.0 > 3000, health.played.4),
            (true, 0),
            "a smooth minute is not slow"
        );
        for n in 0..3000 {
            now += if n % 20 == 0 { 0.12 } else { 1.0 / 60.0 };
            health.frame(now, true, now - if n == 700 { 2.5 } else { 0.03 }, (7, now));
            if n == 100 {
                assert_eq!(health.slowest.len(), 6);
                assert!(
                    health
                        .slowest
                        .iter()
                        .all(|(at, took)| *at > 60.0 && *took >= 119.0),
                    "{:?}",
                    health.slowest
                );
            }
        }
        assert_eq!(health.played.4, 1);
        assert!(
            health.played.1 >= 60
                && health.played.2 >= 119.0
                && (health.played.3 - 2.5).abs() < 1e-6,
            "{:?}",
            health.played
        );
        health.frame(now, false, now, (7, now));
        assert_eq!(
            health.played.0, 0,
            "a finished match starts the count again"
        );
    }
}
