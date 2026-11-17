//! The server's problem log: what went wrong here and in the players' clients.
//! Lines are queued without waiting and written by a thread of their own, so
//! nothing here can delay a game tick. Each day has a file for the server and one
//! for the clients; a file is deleted once it is more than 30 days old, and each
//! has a daily size limit, so the folder cannot outgrow a small disk.
use serde_json::{json, Map, Value};
use std::{
    collections::HashMap,
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc::{sync_channel, RecvTimeoutError, SyncSender},
        Arc,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

/// Days a file is kept after the day it records.
pub const DAYS: u64 = 30;
/// Lines waiting to be written; more than this are counted and dropped.
const QUEUE: usize = 2048;
/// The longest line written. Longer ones keep only the start of their details.
const LINE_BYTES: usize = 2048;
/// Lines of one kind written in a minute; the rest are counted, not written.
const REPEATS_PER_MINUTE: u32 = 30;
/// Kept free under each daily limit for the line that says it was reached.
const RESERVE: u64 = 256;
const DAY_MS: u64 = 86_400_000;

/// Daily size limits, in bytes: one for the server's own lines and one for all
/// clients together, so players' reports cannot crowd out the server's.
#[derive(Clone, Copy)]
pub struct Limits {
    pub server: u64,
    pub clients: u64,
}
impl Default for Limits {
    fn default() -> Self {
        Self { server: 3 << 20, clients: 1 << 20 }
    }
}
impl Limits {
    /// `WILD_WHEELS_LOG_DAILY_BYTES` sets the two limits together, three parts to one.
    pub fn from_env() -> Self {
        match std::env::var("WILD_WHEELS_LOG_DAILY_BYTES").ok().and_then(|v| v.parse::<u64>().ok()) {
            Some(total) if total >= 65_536 => Self { server: total / 4 * 3, clients: total / 4 },
            _ => Self::default(),
        }
    }
}

enum Message {
    Line { at: u64, clients: bool, event: String, line: String },
    Flush(SyncSender<()>),
}

#[derive(Clone)]
pub struct Logs {
    queue: SyncSender<Message>,
    dropped: Arc<AtomicU64>,
    directory: Option<PathBuf>,
    key: Arc<str>,
    limits: Limits,
}
pub fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64
}
/// Days since 1970 as a calendar date, by Howard Hinnant's algorithm.
fn date(days: u64) -> (u64, u64, u64) {
    let z = days + 719_468;
    let era = z / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    (yoe + era * 400 + u64::from(month <= 2), month, doy - (153 * mp + 2) / 5 + 1)
}
/// The reverse of `date`, for a file's name. `None` unless it is a real date.
fn days(day: &str) -> Option<u64> {
    let b = day.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' || !day.bytes().enumerate().all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit()) {
        return None;
    }
    let (y, m, d): (u64, u64, u64) = (day[..4].parse().ok()?, day[5..7].parse().ok()?, day[8..].parse().ok()?);
    if y < 1970 || !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    let y = if m <= 2 { y - 1 } else { y };
    let era = y / 400;
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let count = (era * 146_097 + yoe * 365 + yoe / 4 - yoe / 100 + doy).checked_sub(719_468)?;
    (date(count) == (day[..4].parse().ok()?, m, d)).then_some(count)
}
pub fn day(at: u64) -> String {
    let (y, m, d) = date(at / DAY_MS);
    format!("{y:04}-{m:02}-{d:02}")
}
pub fn stamp(at: u64) -> String {
    let s = at % DAY_MS / 1000;
    format!("{}T{:02}:{:02}:{:02}.{:03}Z", day(at), s / 3600, s / 60 % 60, s % 60, at % 1000)
}
fn name(day: &str, clients: bool) -> String {
    format!("{day}.{}.jsonl", if clients { "clients" } else { "server" })
}
/// One line of the log. `fields` are the details; they never replace the heading.
fn line(at: u64, source: &str, level: &str, event: &str, fields: Value) -> String {
    let mut entry = Map::new();
    entry.insert("t".into(), json!(stamp(at)));
    entry.insert("source".into(), json!(source));
    entry.insert("level".into(), json!(level));
    entry.insert("event".into(), json!(event));
    let heading = entry.clone();
    if let Value::Object(fields) = fields {
        for (key, value) in fields {
            entry.entry(key).or_insert(value);
        }
    }
    let text = Value::Object(entry).to_string();
    if text.len() <= LINE_BYTES {
        return text;
    }
    let mut cut = LINE_BYTES / 2;
    while !text.is_char_boundary(cut) {
        cut -= 1;
    }
    let mut short = heading;
    short.insert("truncated".into(), json!(true));
    short.insert("start".into(), json!(&text[..cut]));
    Value::Object(short).to_string()
}

struct Writer {
    directory: PathBuf,
    limits: Limits,
    day: String,
    written: [u64; 2],
    suppressed: [u64; 2],
    minute: u64,
    counts: HashMap<(bool, String), u32>,
    pending: [Vec<u8>; 2],
}
impl Writer {
    fn limit(&self, clients: bool) -> u64 {
        if clients { self.limits.clients } else { self.limits.server }
    }
    /// Starts a day: old files go, and today's sizes count against today's limits.
    fn begin(&mut self, at: u64) {
        let today = day(at);
        let previous = std::mem::replace(&mut self.day, today.clone());
        if let Ok(files) = fs::read_dir(&self.directory) {
            for file in files.flatten() {
                let name = file.file_name().to_string_lossy().into_owned();
                let recorded = name.strip_suffix(".server.jsonl").or_else(|| name.strip_suffix(".clients.jsonl")).and_then(days);
                if recorded.is_some_and(|recorded| at / DAY_MS > recorded + DAYS) {
                    let _ = fs::remove_file(file.path());
                }
            }
        }
        let missed = std::mem::take(&mut self.suppressed);
        for clients in [false, true] {
            self.written[usize::from(clients)] = fs::metadata(self.directory.join(name(&today, clients))).map_or(0, |m| m.len());
            if missed[usize::from(clients)] > 0 {
                self.put(clients, line(at, "log", "warn", "log-limit-summary", json!({"day":previous,"notWritten":missed[usize::from(clients)]})));
            }
        }
    }
    fn put(&mut self, clients: bool, text: String) {
        let file = usize::from(clients);
        self.written[file] += text.len() as u64 + 1;
        self.pending[file].extend_from_slice(text.as_bytes());
        self.pending[file].push(b'\n');
    }
    fn accept(&mut self, at: u64, clients: bool, event: String, text: String) {
        if day(at) != self.day {
            self.save();
            self.begin(at);
        }
        if at / 60_000 != self.minute {
            // Say how many lines of each kind the last minute left out.
            self.minute = at / 60_000;
            for ((clients, event), count) in std::mem::take(&mut self.counts) {
                if count > REPEATS_PER_MINUTE {
                    self.append(at, clients, line(at, "log", "warn", "log-repeats", json!({"of":event,"notWritten":count - REPEATS_PER_MINUTE})));
                }
            }
        }
        let count = self.counts.entry((clients, event)).or_insert(0);
        *count += 1;
        if *count <= REPEATS_PER_MINUTE {
            self.append(at, clients, text);
        }
    }
    fn append(&mut self, at: u64, clients: bool, text: String) {
        let file = usize::from(clients);
        if self.written[file] + text.len() as u64 + 1 + RESERVE > self.limit(clients) {
            if self.suppressed[file] == 0 && self.written[file] + RESERVE <= self.limit(clients) {
                self.put(clients, line(at, "log", "warn", "log-limit-reached", json!({"dailyBytes":self.limit(clients)})));
            }
            self.suppressed[file] += 1;
            return;
        }
        self.put(clients, text);
    }
    fn save(&mut self) {
        for clients in [false, true] {
            let bytes = std::mem::take(&mut self.pending[usize::from(clients)]);
            if bytes.is_empty() {
                continue;
            }
            let mut options = fs::OpenOptions::new();
            options.append(true).create(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            if let Err(error) = options.open(self.directory.join(name(&self.day, clients))).and_then(|mut file| file.write_all(&bytes)) {
                eprintln!("Unable to write the server log: {error}");
            }
        }
    }
}

impl Logs {
    /// A log that keeps nothing, for tests and for a server whose folder cannot be used.
    pub fn disabled() -> Self {
        Self { queue: sync_channel(1).0, dropped: Default::default(), directory: None, key: "".into(), limits: Limits::default() }
    }
    pub fn open(directory: &Path, limits: Limits, key: Option<String>) -> io::Result<Self> {
        let mut builder = fs::DirBuilder::new();
        builder.recursive(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder.create(directory)?;
        // Reading the log needs this key. It is made once and kept beside the log,
        // where only someone who can already read the files can read it.
        let key_file = directory.join("read-key");
        let key = match key {
            Some(key) => key,
            None => match fs::read_to_string(&key_file) {
                Ok(saved) if saved.trim().len() >= 32 => saved.trim().to_owned(),
                _ => {
                    let made = crate::room::token();
                    let mut options = fs::OpenOptions::new();
                    options.write(true).create(true).truncate(true);
                    #[cfg(unix)]
                    {
                        use std::os::unix::fs::OpenOptionsExt;
                        options.mode(0o600);
                    }
                    options.open(&key_file)?.write_all(made.as_bytes())?;
                    made
                }
            },
        };
        let (queue, waiting) = sync_channel(QUEUE);
        let dropped = Arc::new(AtomicU64::new(0));
        let mut writer = Writer { directory: directory.to_owned(), limits, day: String::new(), written: [0; 2], suppressed: [0; 2], minute: 0, counts: HashMap::new(), pending: Default::default() };
        writer.begin(now());
        let lost = dropped.clone();
        std::thread::Builder::new().name("problem-log".into()).spawn(move || loop {
            let first = waiting.recv_timeout(Duration::from_secs(1));
            let mut done = Vec::new();
            let mut next = match first {
                Ok(message) => Some(message),
                Err(RecvTimeoutError::Timeout) => None,
                Err(RecvTimeoutError::Disconnected) => return,
            };
            let mut taken = 0;
            while let Some(message) = next {
                match message {
                    Message::Line { at, clients, event, line } => writer.accept(at, clients, event, line),
                    Message::Flush(reply) => done.push(reply),
                }
                taken += 1;
                next = if taken < 512 { waiting.try_recv().ok() } else { None };
            }
            let lost = lost.swap(0, Ordering::Relaxed);
            if lost > 0 {
                let at = now();
                writer.accept(at, false, "log-queue-full".into(), line(at, "log", "warn", "log-queue-full", json!({"notWritten":lost})));
            }
            // An idle server still turns the page at midnight, so old days go on time.
            let at = now();
            if day(at) != writer.day {
                writer.save();
                writer.begin(at);
            }
            writer.save();
            for reply in done {
                let _ = reply.try_send(());
            }
        })?;
        Ok(Self { queue, dropped, directory: Some(directory.to_owned()), key: key.into(), limits })
    }
    fn send(&self, clients: bool, source: &str, level: &str, event: &str, fields: Value) {
        if self.directory.is_none() {
            return;
        }
        let at = now();
        let message = Message::Line { at, clients, event: event.to_owned(), line: line(at, source, level, event, fields) };
        if self.queue.try_send(message).is_err() {
            self.dropped.fetch_add(1, Ordering::Relaxed);
        }
    }
    /// Something the server itself saw. Never waits.
    pub fn note(&self, level: &str, event: &str, fields: Value) {
        self.send(false, "server", level, event, fields);
    }
    /// Something a player's client reported, already checked. Never waits.
    pub fn client(&self, source: &str, level: &str, event: &str, fields: Value) {
        self.send(true, source, level, event, fields);
    }
    /// Waits, briefly, until what has been noted is on disk: before stopping or after a panic.
    pub fn flush(&self) {
        let (reply, done) = sync_channel(1);
        if self.queue.try_send(Message::Flush(reply)).is_ok() {
            let _ = done.recv_timeout(Duration::from_secs(2));
        }
    }
    pub fn directory(&self) -> Option<&Path> {
        self.directory.as_deref()
    }
    /// Whether `presented` is the reading key, compared without stopping early.
    pub fn key_matches(&self, presented: &str) -> bool {
        !self.key.is_empty()
            && presented.len() == self.key.len()
            && presented.bytes().zip(self.key.bytes()).fold(0, |different, (a, b)| different | (a ^ b)) == 0
    }
    pub fn limits(&self) -> Limits {
        self.limits
    }
}

/// What a reader asked for: a day and the lines of it that match.
#[derive(Default)]
pub struct Query {
    pub day: Option<String>,
    pub source: Option<String>,
    pub level: Option<String>,
    pub event: Option<String>,
    pub contains: Option<String>,
    pub limit: Option<usize>,
}
impl Query {
    /// From a URL's query string. Unknown names are an error, so a typing mistake
    /// is not mistaken for "no lines matched".
    pub fn parse(query: &str) -> Result<Self, &'static str> {
        let mut parsed = Self::default();
        for pair in query.split('&').filter(|pair| !pair.is_empty()) {
            let (name, value) = pair.split_once('=').unwrap_or((pair, ""));
            let value = decode(value).ok_or("Invalid query.")?;
            match name {
                "day" => parsed.day = Some(value),
                "source" => parsed.source = Some(value),
                "level" => parsed.level = Some(value),
                "event" => parsed.event = Some(value),
                "contains" => parsed.contains = Some(value),
                "limit" => parsed.limit = Some(value.parse().ok().filter(|n| (1..=2000).contains(n)).ok_or("Limit must be 1–2000.")?),
                _ => return Err("Unknown query. Use day, source, level, event, contains and limit."),
            }
        }
        Ok(parsed)
    }
}
fn decode(text: &str) -> Option<String> {
    let mut bytes = Vec::with_capacity(text.len());
    let mut rest = text.bytes();
    while let Some(byte) = rest.next() {
        match byte {
            b'+' => bytes.push(b' '),
            b'%' => {
                let digits = [rest.next()?, rest.next()?];
                bytes.push(u8::from_str_radix(std::str::from_utf8(&digits).ok()?, 16).ok()?);
            }
            other => bytes.push(other),
        }
    }
    String::from_utf8(bytes).ok()
}
/// The days on disk with their sizes, or the matching lines of one day, oldest
/// first. Reads files, so call it away from the game's thread.
pub fn read(directory: &Path, limits: Limits, query: &Query, at: u64) -> Result<Value, &'static str> {
    let Some(wanted) = query.day.as_deref() else {
        let mut found: std::collections::BTreeMap<String, [u64; 2]> = Default::default();
        for file in fs::read_dir(directory).map_err(|_| "The log cannot be read.")?.flatten() {
            let name = file.file_name().to_string_lossy().into_owned();
            for (clients, ending) in [(false, ".server.jsonl"), (true, ".clients.jsonl")] {
                if let Some(day) = name.strip_suffix(ending).filter(|day| days(day).is_some()) {
                    found.entry(day.to_owned()).or_default()[usize::from(clients)] = file.metadata().map_or(0, |m| m.len());
                }
            }
        }
        let listed: Vec<_> = found.iter().map(|(day, sizes)| json!({"day":day,"serverBytes":sizes[0],"clientBytes":sizes[1]})).collect();
        return Ok(json!({"today":day(at),"keptDays":DAYS,"dailyLimitBytes":{"server":limits.server,"clients":limits.clients},"days":listed,
            "use":"Add ?day=today or ?day=YYYY-MM-DD, and optionally source, level, event, contains and limit."}));
    };
    let wanted = match wanted {
        "today" => day(at),
        other => other.to_owned(),
    };
    // Only a real date reaches the file system, so a request cannot name another file.
    days(&wanted).ok_or("Day must be today or YYYY-MM-DD.")?;
    let mut lines = Vec::new();
    for clients in [false, true] {
        if let Ok(text) = fs::read_to_string(directory.join(name(&wanted, clients))) {
            lines.extend(text.lines().filter(|line| query.contains.as_deref().is_none_or(|part| line.contains(part))).filter_map(|line| serde_json::from_str::<Value>(line).ok()));
        }
    }
    let is = |entry: &Value, field: &str, wanted: &Option<String>| wanted.as_deref().is_none_or(|wanted| entry[field].as_str() == Some(wanted));
    lines.retain(|entry| is(entry, "source", &query.source) && is(entry, "level", &query.level) && is(entry, "event", &query.event));
    lines.sort_by(|a, b| a["t"].as_str().cmp(&b["t"].as_str()));
    let matched = lines.len();
    let kept = lines.split_off(matched.saturating_sub(query.limit.unwrap_or(200)));
    Ok(json!({"day":wanted,"matched":matched,"returned":kept.len(),"entries":kept}))
}

/// One checked report: its level, its event and its details.
pub type Report = (&'static str, String, Value);
/// What a client may report in one request, checked and cut to size.
pub fn reports(body: &Value) -> Result<(&'static str, Vec<Report>), &'static str> {
    let source = match body["client"].as_str() {
        Some("browser") => "browser",
        Some("native") => "native",
        _ => return Err("Say which client is reporting."),
    };
    let entries = body["entries"].as_array().filter(|entries| (1..=32).contains(&entries.len())).ok_or("Report 1–32 entries.")?;
    let mut checked = Vec::new();
    for entry in entries {
        let level = match entry["level"].as_str() {
            Some("error") => "error",
            Some("warn") => "warn",
            Some("info") => "info",
            _ => return Err("Use the level error, warn or info."),
        };
        let event = entry["event"].as_str().filter(|event| (1..=40).contains(&event.len()) && event.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')).ok_or("Name each event in lowercase letters, digits and dashes.")?;
        let mut fields = Map::new();
        if let Some(build) = body["build"].as_str().filter(|build| build.len() <= 64) {
            fields.insert("build".into(), json!(build));
        }
        // How long before the report was sent this happened, so its real time is known.
        if let Some(age) = entry["agoMs"].as_u64().filter(|age| *age <= 3_600_000) {
            fields.insert("agoMs".into(), json!(age));
        }
        if let Some(count) = entry["count"].as_u64().filter(|count| *count > 1) {
            fields.insert("count".into(), json!(count));
        }
        if entry["data"].is_object() {
            fields.insert("data".into(), entry["data"].clone());
        }
        checked.push((level, event.to_owned(), Value::Object(fields)));
    }
    Ok((source, checked))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn folder(label: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("wild-wheels-logs-{label}-{}", crate::room::token()));
        fs::create_dir_all(&path).unwrap();
        path
    }
    fn writer(directory: &Path, limits: Limits, at: u64) -> Writer {
        let mut writer = Writer { directory: directory.to_owned(), limits, day: String::new(), written: [0; 2], suppressed: [0; 2], minute: 0, counts: HashMap::new(), pending: Default::default() };
        writer.begin(at);
        writer
    }
    fn files(directory: &Path) -> Vec<String> {
        let mut names: Vec<_> = fs::read_dir(directory).unwrap().flatten().map(|f| f.file_name().to_string_lossy().into_owned()).collect();
        names.sort();
        names
    }
    const START: u64 = 20_000 * DAY_MS + 3_600_000;
    #[test]
    fn dates_round_trip_and_only_real_dates_name_a_file() {
        assert_eq!(day(0), "1970-01-01");
        assert_eq!(day(START), "2024-10-04");
        assert_eq!(stamp(START + 61_005), "2024-10-04T01:01:01.005Z");
        for count in [0, 59, 60, 365, 11_016, 19_782, 20_000, 20_514] {
            assert_eq!(days(&day(count * DAY_MS)), Some(count));
        }
        for bad in ["2024-02-30", "2024-13-01", "../../etc", "2024-1-01", "today", "2024-10-04x"] {
            assert_eq!(days(bad), None, "{bad}");
        }
    }
    #[test]
    fn a_file_is_kept_for_thirty_days_and_deleted_on_the_next() {
        let directory = folder("kept");
        let mut log = writer(&directory, Limits::default(), START);
        log.accept(START, false, "first".into(), line(START, "server", "info", "first", json!({})));
        log.accept(START, true, "first".into(), line(START, "browser", "info", "first", json!({})));
        log.accept(START + 30 * DAY_MS, false, "later".into(), line(START + 30 * DAY_MS, "server", "info", "later", json!({})));
        log.save();
        assert_eq!(files(&directory), ["2024-10-04.clients.jsonl", "2024-10-04.server.jsonl", "2024-11-03.server.jsonl"], "thirty days later the first day is still there");
        log.accept(START + 31 * DAY_MS, false, "last".into(), line(START + 31 * DAY_MS, "server", "info", "last", json!({})));
        log.save();
        assert_eq!(files(&directory), ["2024-11-03.server.jsonl", "2024-11-04.server.jsonl"]);
        // Files that are not the log's are left alone, whatever their age.
        fs::write(directory.join("read-key"), "k").unwrap();
        fs::write(directory.join("1999-01-01.notes"), "mine").unwrap();
        writer(&directory, Limits::default(), START + 400 * DAY_MS);
        assert_eq!(files(&directory), ["1999-01-01.notes", "read-key"]);
        fs::remove_dir_all(directory).unwrap();
    }
    #[test]
    fn a_day_stops_at_its_limit_says_so_once_and_the_two_kinds_have_their_own() {
        let directory = folder("limit");
        let limits = Limits { server: 4096, clients: 2048 };
        let mut log = writer(&directory, limits, START);
        for n in 0..200 {
            // A different name each time, so this is the size limit and not the repeat limit.
            log.accept(START + n, false, format!("event-{n}"), line(START + n, "server", "info", &format!("event-{n}"), json!({"detail":"x".repeat(60)})));
        }
        log.accept(START, true, "client".into(), line(START, "browser", "error", "client", json!({})));
        log.save();
        let server = fs::read_to_string(directory.join("2024-10-04.server.jsonl")).unwrap();
        assert!(server.len() as u64 <= limits.server, "{}", server.len());
        assert!(server.len() as u64 > limits.server - 600);
        assert_eq!(server.matches("log-limit-reached").count(), 1);
        assert!(server.lines().all(|line| serde_json::from_str::<Value>(line).is_ok()));
        assert_eq!(fs::read_to_string(directory.join("2024-10-04.clients.jsonl")).unwrap().lines().count(), 1, "clients still have room");
        // A restart the same day does not start the limit again.
        let mut again = writer(&directory, limits, START + 1000);
        again.accept(START + 1000, false, "more".into(), line(START + 1000, "server", "info", "more", json!({"detail":"x".repeat(60)})));
        again.save();
        assert!(fs::metadata(directory.join("2024-10-04.server.jsonl")).unwrap().len() <= limits.server);
        // The next day says how much the day before left out.
        log.accept(START + DAY_MS, false, "next".into(), line(START + DAY_MS, "server", "info", "next", json!({})));
        log.save();
        let next = fs::read_to_string(directory.join("2024-10-05.server.jsonl")).unwrap();
        assert!(next.contains("log-limit-summary") && next.contains("\"day\":\"2024-10-04\""), "{next}");
        fs::remove_dir_all(directory).unwrap();
    }
    #[test]
    fn a_repeated_line_is_written_thirty_times_a_minute_and_the_rest_are_counted() {
        let directory = folder("repeats");
        let mut log = writer(&directory, Limits::default(), START);
        for n in 0..500 {
            log.accept(START + n, false, "same".into(), line(START + n, "server", "warn", "same", json!({})));
        }
        log.accept(START + 60_000, false, "other".into(), line(START + 60_000, "server", "info", "other", json!({})));
        log.save();
        let text = fs::read_to_string(directory.join("2024-10-04.server.jsonl")).unwrap();
        assert_eq!(text.matches("\"event\":\"same\"").count(), 30);
        assert!(text.contains("\"event\":\"log-repeats\"") && text.contains("\"notWritten\":470"), "{text}");
        fs::remove_dir_all(directory).unwrap();
    }
    #[test]
    fn lines_are_one_line_of_json_and_long_details_are_cut() {
        let text = line(START, "browser", "error", "js-error", json!({"message":"a\nb\"c","event":"forged","t":"forged"}));
        assert!(!text.contains('\n'));
        let entry: Value = serde_json::from_str(&text).unwrap();
        assert_eq!((entry["event"].as_str(), entry["t"].as_str(), entry["message"].as_str()), (Some("js-error"), Some("2024-10-04T01:00:00.000Z"), Some("a\nb\"c")));
        let long = line(START, "native", "error", "panic", json!({"message":"é".repeat(5000)}));
        assert!(long.len() <= LINE_BYTES && !long.contains('\n'));
        let entry: Value = serde_json::from_str(&long).unwrap();
        assert_eq!((entry["truncated"].as_bool(), entry["event"].as_str()), (Some(true), Some("panic")));
    }
    #[test]
    fn noting_never_waits_and_what_was_noted_can_be_read_back_and_filtered() {
        let directory = folder("read");
        let logs = Logs::open(&directory, Limits::default(), None).unwrap();
        let started = std::time::Instant::now();
        for n in 0..5000 {
            logs.note("info", "burst", json!({"n":n}));
        }
        assert!(started.elapsed() < Duration::from_millis(500), "noting must not wait for the disk: {:?}", started.elapsed());
        std::thread::sleep(Duration::from_millis(400));
        logs.note("error", "socket-closed", json!({"player":1,"reason":"rejected input"}));
        logs.client("browser", "error", "js-error", json!({"player":0,"data":{"message":"boom"}}));
        logs.flush();
        std::thread::sleep(Duration::from_millis(1200));
        logs.flush();
        let at = now();
        let index = read(&directory, Limits::default(), &Query::default(), at).unwrap();
        assert_eq!(index["days"].as_array().unwrap().len(), 1);
        assert!(index["days"][0]["serverBytes"].as_u64().unwrap() > 0 && index["days"][0]["clientBytes"].as_u64().unwrap() > 0);
        let errors = read(&directory, Limits::default(), &Query::parse("day=today&level=error").unwrap(), at).unwrap();
        let events: Vec<_> = errors["entries"].as_array().unwrap().iter().map(|e| e["event"].as_str().unwrap()).collect();
        assert_eq!(events.len(), 2);
        assert!(events.contains(&"socket-closed") && events.contains(&"js-error"));
        let one = read(&directory, Limits::default(), &Query::parse("day=today&source=browser&contains=boom&limit=5").unwrap(), at).unwrap();
        assert_eq!((one["returned"].as_u64(), one["entries"][0]["data"]["message"].as_str()), (Some(1), Some("boom")));
        // A full queue loses lines but says how many, and the burst is thinned as a repeat.
        let all = read(&directory, Limits::default(), &Query::parse("day=today&limit=2000").unwrap(), at).unwrap();
        assert!(all["entries"].as_array().unwrap().iter().filter(|e| e["event"] == "burst").count() <= 60);
        assert!(Query::parse("dya=today").is_err() && Query::parse("limit=0").is_err());
        assert!(read(&directory, Limits::default(), &Query::parse("day=../read-key").unwrap(), at).is_err());
        // The key was made, is private, and is the only thing that opens the log.
        let key = fs::read_to_string(directory.join("read-key")).unwrap();
        assert!(key.len() >= 32 && logs.key_matches(&key) && !logs.key_matches("") && !logs.key_matches(&key[1..]));
        assert!(Logs::open(&directory, Limits::default(), None).unwrap().key_matches(&key), "the key survives a restart");
        assert!(!Logs::disabled().key_matches(""));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(directory.join("read-key")).unwrap().permissions().mode() & 0o777, 0o600);
        }
        fs::remove_dir_all(directory).unwrap();
    }
    #[test]
    fn client_reports_are_checked_before_they_are_kept() {
        let (source, entries) = reports(&json!({"client":"native","build":"abc","entries":[{"level":"error","event":"connection-lost","agoMs":1500,"count":3,"data":{"reason":"reset"}}]})).unwrap();
        assert_eq!(source, "native");
        assert_eq!(entries[0].0, "error");
        assert_eq!(entries[0].2, json!({"build":"abc","agoMs":1500,"count":3,"data":{"reason":"reset"}}));
        for bad in [
            json!({"client":"server","entries":[{"level":"error","event":"x"}]}),
            json!({"client":"browser","entries":[]}),
            json!({"client":"browser","entries":[{"level":"fatal","event":"x"}]}),
            json!({"client":"browser","entries":[{"level":"error","event":"Has Spaces"}]}),
            json!({"client":"browser","entries":vec![json!({"level":"info","event":"x"});33]}),
        ] {
            assert!(reports(&bad).is_err(), "{bad}");
        }
    }
}
