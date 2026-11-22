import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createGameServer } from '../../server.js';

async function listen(t, textPostKey) {
  const textDirectory = await mkdtemp(join(tmpdir(), 'wild-wheels-text-'));
  const { server } = createGameServer({ textPostKey, textDirectory });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(textDirectory, { recursive: true, force: true });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { origin: `http://127.0.0.1:${server.address().port}`, textDirectory };
}

test('concurrent text posts create separate private files with the original UTF-8 contents', async t => {
  const key = randomBytes(32).toString('hex');
  const { origin, textDirectory } = await listen(t, key);
  const texts = ['  First line\nSecond line 🏁\n', '  Another post  '];
  const filenames = await Promise.all(texts.map(async body => {
    const response = await fetch(origin + '/api/text', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain; charset=utf-8', Authorization: `Bearer ${key}` },
      body,
      signal: AbortSignal.timeout(4000),
    });
    assert.equal(response.status, 201);
    const { filename } = await response.json();
    assert.match(filename, /^[a-f0-9-]+\.txt$/);
    assert.equal(await readFile(join(textDirectory, filename), 'utf8'), body);
    const direct = await fetch(origin + '/.wild-wheels/text/' + filename, { signal: AbortSignal.timeout(4000) });
    assert.equal(direct.status, 404);
    return filename;
  }));
  assert.equal(new Set(filenames).size, 2);
});

test('unauthorized, oversized or invalid text never creates a file', async t => {
  const key = randomBytes(32).toString('hex');
  const { origin, textDirectory } = await listen(t, key);
  for (const [body, headers, expected] of [
    ['missing key', { Authorization: '' }, 401],
    ['foreign origin', { Origin: 'https://example.invalid' }, 403],
    ['{}', { 'Content-Type': 'application/json' }, 415],
    ['', {}, 400],
    [Buffer.from([0xff]), {}, 400],
    ['a'.repeat(65537), {}, 413],
    [(async function* () { yield 'a'.repeat(65536); yield 'b'; })(), {}, 413],
  ]) {
    const response = await fetch(origin + '/api/text', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', Authorization: `Bearer ${key}`, ...headers },
      body,
      duplex: 'half',
      signal: AbortSignal.timeout(4000),
    });
    assert.equal(response.status, expected);
    await response.text();
  }
  assert.deepEqual(await readdir(textDirectory), []);
});
