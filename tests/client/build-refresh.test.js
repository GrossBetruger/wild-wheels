import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILD_REFRESH_MS, serviceBuildNotice, watchServerBuild } from '../../client/build-refresh.js';

function harness({ served = '', builds, hidden = () => false }) {
  const pending = [...builds];
  let reloads = 0;
  let hiddenNow = hidden();
  const timers = [];
  const listeners = new Map();
  const watching = watchServerBuild({
    served,
    load: async () => pending.shift(),
    reload: () => { reloads++; },
    hidden: () => hiddenNow,
    schedule: fn => { timers.push(fn); return timers.length; },
    cancel() {},
    listen: (type, listener) => listeners.set(type, listener),
    unlisten: type => listeners.delete(type),
  });
  return {
    watching, timers, reloads: () => reloads,
    show() { hiddenNow = false; listeners.get('visibilitychange')?.(); },
  };
}

test('an open page reloads as soon as the server build changes', async () => {
  const page = harness({ served: 'AAAAAAAAAA', builds: ['AAAAAAAAAA', 'BBBBBBBBBB'] });
  await page.watching;
  assert.equal(page.reloads(), 0);
  await page.timers[0]();
  assert.equal(page.reloads(), 1);
  assert.equal(BUILD_REFRESH_MS, 2000);
});

test('a page without a stamp adopts the first build and reloads on the next one', async () => {
  const page = harness({ builds: ['CCCCCCCCCC', 'DDDDDDDDDD'] });
  await page.watching;
  assert.equal(page.reloads(), 0);
  await page.timers[0]();
  assert.equal(page.reloads(), 1);
});

test('a hidden tab waits until it is visible, then reloads immediately', async () => {
  const page = harness({ served: 'AAAAAAAAAA', builds: ['EEEEEEEEEE'], hidden: () => true });
  await page.watching;
  await page.timers[0]();
  assert.equal(page.reloads(), 0);
  page.show();
  await page.watching.catch(() => {});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.reloads(), 1);
});

test('the same build leaves the page in place', async () => {
  const page = harness({ served: 'AAAAAAAAAA', builds: ['AAAAAAAAAA', 'AAAAAAAAAA'] });
  await page.watching;
  await page.timers[0]();
  assert.equal(page.reloads(), 0);
});

test('the update notice follows the active job and confirms readiness only after an observed update', () => {
  assert.equal(serviceBuildNotice('fetching-wasm', true), 'Downloading WASM release…');
  assert.equal(serviceBuildNotice('unpacking-wasm', true), 'Unpacking WASM release…');
  assert.equal(serviceBuildNotice('compiling-wasm', true), 'Compiling 3D WASM…');
  assert.equal(serviceBuildNotice('waiting-wasm', true), 'Waiting for WASM build lock…');
  assert.equal(serviceBuildNotice('packing-graphics', true), 'Building graphics pack…');
  assert.equal(serviceBuildNotice('packing-sounds', true), 'Building sound pack…');
  assert.equal(serviceBuildNotice('failed', true), 'Server update failed');
  assert.equal(serviceBuildNotice('ready', true), 'Game server ready');
  assert.equal(serviceBuildNotice('ready', false), '');
});
