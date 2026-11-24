import test from 'node:test';
import assert from 'node:assert/strict';
import { ClientLog, FrameHealth, LIMITS, startReporting } from '../../client/log.js';

test('the same problem is counted instead of repeated, and a batch says how long ago each happened', () => {
  let now = 1000; const log = new ClientLog({ build: 'abc', now: () => now });
  log.note('error', 'js-error', { message: 'boom' }); now = 3000;
  log.note('error', 'js-error', { message: 'boom' }); log.note('warn', 'socket-closed', { code: 1006 }); now = 5000;
  const body = JSON.parse(log.batch());
  assert.deepEqual([body.client, body.build, body.entries.length], ['browser', 'abc', 2]);
  assert.deepEqual(body.entries[0], { level: 'error', event: 'js-error', agoMs: 4000, count: 2, data: { message: 'boom' } });
  assert.equal(body.entries[1].agoMs, 2000);
  assert.equal(log.queue.length, 2, 'reports wait until the server has them');
  log.sent(); assert.equal(log.batch(), null);
});
test('values JSON cannot carry are spelled out, and long or deep details are cut', () => {
  const log = new ClientLog();
  log.note('error', 'racer-not-drawn', { roll: NaN, speed: Infinity, x: 1.23456, text: 'x'.repeat(5000), deep: { a: { b: { c: { d: 1 } } } }, list: Array.from({ length: 100 }, (_, i) => i) });
  const { data } = JSON.parse(log.batch()).entries[0];
  assert.deepEqual([data.roll, data.speed, data.x], ['NaN', 'Infinity', 1.235]);
  assert.equal(data.text.length, LIMITS.text + 1); assert.equal(data.deep.a.b, '…'); assert.equal(data.list.length, 16);
});
test('a flood is dropped and counted, a batch fits one request, and a session has a ceiling', () => {
  const log = new ClientLog();
  for (let i = 0; i < 100; i++) log.note('warn', 'flood', { i, pad: 'p'.repeat(300) });
  assert.equal(log.queue.length, LIMITS.queued); assert.equal(log.dropped, 60);
  let sent = 0, batches = 0;
  for (let body; (body = log.batch()); log.sent()) {
    assert.ok(new TextEncoder().encode(body).length <= 8192, 'a batch must fit the server limit');
    const entries = JSON.parse(body).entries; assert.ok(entries.length <= LIMITS.batchEntries + 1);
    sent += entries.filter(entry => entry.event === 'flood').length; batches++;
    if (batches === 1) assert.deepEqual(entries.at(-1).data, { count: 60 }, 'the first batch says what was dropped');
  }
  assert.equal(sent, LIMITS.queued); assert.ok(batches > 1); assert.equal(log.dropped, 0);
  for (let i = 0; i < 1000; i++) { log.note('info', 'more', { i }); log.batch(); log.sent(); }
  assert.equal(log.noted, LIMITS.session);
});
test('a recurring problem is reported once per interval', () => {
  let now = 0; const log = new ClientLog({ now: () => now });
  for (now = 0; now < 60000; now += 16) log.limited('racer:3', 30000, 'error', 'racer-not-drawn', { racer: 3, wx: now });
  assert.equal(log.queue.length, 2);
});
test('reports are sent only when there are some, wait for a failed send, and stop for a server without a log', async () => {
  const log = new ClientLog(), posts = []; let status = 200, token = null, tick, hide;
  const send = startReporting(log, { token: () => token, post: async (body, bearer) => { posts.push([JSON.parse(body).entries.length, bearer]); if (status === 0) throw new Error('offline'); return status; }, schedule: run => { tick = run; }, onHide: run => { hide = run; } });
  await tick(); assert.equal(posts.length, 0, 'nothing to report');
  log.note('error', 'js-error', { message: 'a' }); await tick(); assert.equal(posts.length, 0, 'not in a room yet');
  token = 'secret'; status = 0; await send(); assert.equal(log.queue.length, 1, 'kept for the next try');
  status = 429; await tick(); assert.equal(log.queue.length, 1);
  status = 200; await hide(); assert.deepEqual(posts.at(-1), [1, 'secret']); assert.equal(log.queue.length, 0);
  await tick(); assert.equal(posts.length, 3);
  log.note('error', 'js-error', { message: 'b' }); status = 404; await tick(); assert.equal(log.queue.length, 0);
  log.note('error', 'js-error', { message: 'c' }); status = 200; await tick(); assert.equal(posts.length, 4, 'a server without a log is not asked again');
});
test('only a bad minute of frames is reported, and a finished match is summed up', () => {
  const reports = [], health = new FrameHealth((level, event, data) => reports.push([level, event, data]));
  let t = 0; for (let i = 0; i < 3800; i++) { t += 16.7; health.frame(t, true, t - 30, .04); }
  assert.deepEqual(reports, [], 'a smooth minute says nothing');
  for (let i = 0; i < 3000; i++) { t += i % 20 === 0 ? (i === 400 ? 300 : 120) : 16.7; health.frame(t, true, t - (i === 700 ? 2500 : 30), .04, { match: 7, seconds: 100 + i / 60 }); }
  assert.equal(reports.length, 1); const [level, event, minute] = reports[0];
  assert.deepEqual([minute.match, minute.fromMatchSeconds, minute.slowest.length, minute.slowest[0]], [7, 100, 8, [106.7, 300]], 'the slowest frames carry the match clock the server also notes');
  assert.ok(minute.toMatchSeconds > 140);
  assert.deepEqual([level, event], ['warn', 'slow-minute']); assert.ok(minute.over50Ms >= 60 && minute.longestMs >= 120 && minute.longestWaitForServerMs === 2500 && minute.rttMs === 40, JSON.stringify(minute));
  health.frame(t + 16, false, 0, .04);
  const summary = reports.at(-1); assert.deepEqual([summary[0], summary[1]], ['info', 'match-frames']); assert.ok(summary[2].frames > 5000 && summary[2].slowMinutes >= 1 && summary[2].gap === 2500);
  health.frame(t + 32, false, 0); assert.equal(reports.filter(report => report[1] === 'match-frames').length, 1);
});
test('matches shorter than a minute get separate frame summaries', () => {
  const reports = [];
  const health = new FrameHealth((level, event, data) => reports.push({ level, event, data }));
  health.frame(100, true, 90, .02);
  health.frame(120, true, 100, .02);
  health.frame(155, true, 125, .02);
  health.frame(175, false, 0, .02);
  health.frame(300, true, 290, .03);
  health.frame(316, true, 302, .03);
  health.frame(332, false, 0, .03);
  assert.deepEqual(reports, [
    { level: 'info', event: 'match-frames', data: { frames: 2, long: 0, worst: 35, gap: 30, slowMinutes: 0, rttMs: 20 } },
    { level: 'info', event: 'match-frames', data: { frames: 1, long: 0, worst: 16, gap: 14, slowMinutes: 0, rttMs: 30 } },
  ]);
});
