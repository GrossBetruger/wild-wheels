// Reports this browser's problems to the server's log. Reports wait in a short
// queue and go a few at a time over HTTP, never over the game socket, and are
// thinned here first: the same problem is counted, not repeated, and a session
// can only send so much. Nothing is sent while there is nothing to report.
export const LIMITS = { queued: 40, session: 400, batchBytes: 7000, batchEntries: 32, text: 400, everyMs: 15000 };

// JSON has no NaN or Infinity, and those are exactly what a broken pose holds.
function plain(value, depth = 0) {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : String(value);
  if (typeof value === 'string') return value.length > LIMITS.text ? `${value.slice(0, LIMITS.text)}…` : value;
  if (typeof value === 'boolean' || value === null) return value;
  if (value === undefined) return 'undefined';
  if (depth >= 3) return '…';
  if (Array.isArray(value)) return value.slice(0, 16).map(item => plain(item, depth + 1));
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 24).map(([key, item]) => [key.slice(0, 40), plain(item, depth + 1)]));
  return String(value).slice(0, LIMITS.text);
}

export class ClientLog {
  queue = []; noted = 0; dropped = 0; last = new Map();
  constructor({ client = 'browser', build = '', now = () => Date.now() } = {}) { this.client = client; this.build = String(build).slice(0, 64); this.now = now; }
  // Queues one report. The same event with the same details, still waiting, is counted instead.
  note(level, event, data = {}) {
    const details = plain(data), key = `${level}:${event}:${JSON.stringify(details)}`;
    const waiting = this.queue.find(entry => entry.key === key);
    if (waiting) { waiting.count++; return; }
    if (this.noted >= LIMITS.session || this.queue.length >= LIMITS.queued) { this.dropped++; return; }
    this.noted++; this.queue.push({ key, level, event, data: details, at: this.now(), count: 1 });
  }
  // At most one report per `key` every `ms`, for problems that would otherwise recur every frame.
  limited(key, ms, level, event, data) {
    const now = this.now(), last = this.last.get(key);
    if (last !== undefined && now - last < ms) return;
    if (this.last.size > 200) this.last.clear();
    this.last.set(key, now); this.note(level, event, data);
  }
  // The next request body, or null when nothing waits. The entries stay queued until `sent`.
  batch() {
    if (!this.queue.length) return null;
    const now = this.now(), entries = [];
    let size = 100, taken = 0;
    for (const entry of this.queue) {
      const sending = { level: entry.level, event: entry.event, agoMs: Math.max(0, Math.min(3_600_000, now - entry.at)), count: entry.count, data: entry.data };
      const bytes = new TextEncoder().encode(JSON.stringify(sending)).length + 1;
      if (entries.length && (size + bytes > LIMITS.batchBytes || entries.length >= LIMITS.batchEntries)) break;
      // One report too large to send alone is cut down to what it is about.
      if (bytes + size > LIMITS.batchBytes) sending.data = { cut: JSON.stringify(entry.data).slice(0, 600) };
      entries.push(sending); size += bytes; taken++;
    }
    if (this.dropped) { entries.push({ level: 'warn', event: 'reports-dropped', agoMs: 0, count: 1, data: { count: this.dropped } }); }
    this.sending = { entries: taken, dropped: this.dropped };
    return JSON.stringify({ client: this.client, build: this.build, entries });
  }
  sent() { if (!this.sending) return; this.queue.splice(0, this.sending.entries); this.dropped -= this.sending.dropped; this.sending = null; }
}

// Sends what waits every `everyMs` and when the page is hidden. A server that
// has no log (404) or refuses this client's reports ends reporting for the visit.
export function startReporting(log, { token, post = defaultPost, every = LIMITS.everyMs, schedule = setInterval, onHide = hidden => addEventListener('pagehide', hidden) } = {}) {
  let busy = false, stopped = false;
  const send = async () => {
    if (busy || stopped || !token()) return;
    const body = log.batch(); if (!body) return;
    busy = true;
    try {
      const status = await post(body, token());
      if (status === 200) log.sent();
      else if (status === 404 || status === 400 || status === 415) { stopped = true; log.queue.length = 0; }
    } catch { /* The server is unreachable; the reports wait for the next turn. */ }
    finally { busy = false; }
  };
  schedule(send, every); onHide(send);
  return send;
}
async function defaultPost(body, token) {
  const response = await fetch('/api/log', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body, keepalive: true, signal: AbortSignal.timeout(5000) });
  return response.status;
}

// A minute of frames at a time: how long they took and how long the game went
// without news from the server. Only a bad minute, or a finished match, is reported.
export class FrameHealth {
  times = []; last = null; started = null; gap = 0; long = 0; slowest = []; clock = null; from = null; match = { frames: 0, long: 0, worst: 0, gap: 0, slowMinutes: 0 };
  constructor(report) { this.report = report; }
  // `t` and `packetAt` are milliseconds on the same clock; `rtt` is seconds.
  // `clock` is the match and its seconds as this client shows them: the server
  // notes the same clock on abilities and kills, so slow frames can be set beside them.
  frame(t, racing, packetAt, rtt = 0, clock = null) {
    if (!racing) { if (this.match.frames) { this.minute(rtt); this.report('info', 'match-frames', { ...this.match, rttMs: Math.round(rtt * 1000) }); this.match = { frames: 0, long: 0, worst: 0, gap: 0, slowMinutes: 0 }; } this.last = null; this.started = null; return; }
    if (this.last !== null) {
      const took = t - this.last; this.times.push(took);
      if (took > 50) { this.long++; if (clock) { this.slowest.push([Math.round(clock.seconds * 10) / 10, Math.round(took)]); this.slowest.sort((a, b) => b[1] - a[1]).splice(8); } }
      if (packetAt) this.gap = Math.max(this.gap, t - packetAt);
    }
    this.last = t; this.started ??= t; if (clock) { this.from ??= clock.seconds; this.clock = clock; }
    if (t - this.started >= 60000) this.minute(rtt);
  }
  minute(rtt) {
    const times = this.times.sort((a, b) => a - b); this.times = []; this.started = null;
    if (!times.length) return;
    const at = share => Math.round(times[Math.min(times.length - 1, Math.floor(times.length * share))] * 10) / 10;
    const summary = { frames: times.length, medianMs: at(.5), p95Ms: at(.95), longestMs: at(1), over50Ms: this.long, longestWaitForServerMs: Math.round(this.gap), rttMs: Math.round(rtt * 1000) };
    // The slowest frames as [match seconds, milliseconds], longest first.
    if (this.clock) Object.assign(summary, { match: this.clock.match, fromMatchSeconds: Math.round(this.from * 10) / 10, toMatchSeconds: Math.round(this.clock.seconds * 10) / 10, slowest: this.slowest });
    this.slowest = []; this.from = null; this.clock = null;
    const slow = summary.p95Ms > 40 || this.long >= 10 || this.gap > 1000;
    this.match.frames += times.length; this.match.long += this.long; this.match.worst = Math.max(this.match.worst, summary.longestMs); this.match.gap = Math.max(this.match.gap, summary.longestWaitForServerMs); this.match.slowMinutes += Number(slow);
    if (slow) this.report('warn', 'slow-minute', summary);
    this.long = 0; this.gap = 0;
  }
}
