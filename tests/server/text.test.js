import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createGameServer } from '../../server.js';

async function listen(t) {
  const textDirectory = await mkdtemp(join(tmpdir(), 'wild-wheels-text-'));
  const { server } = createGameServer({ textDirectory });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(textDirectory, { recursive: true, force: true });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { origin: `http://127.0.0.1:${server.address().port}`, textDirectory };
}

test('concurrent anonymous text posts create separate private files with the original UTF-8 contents', async t => {
  const { origin, textDirectory } = await listen(t);
  const texts = ['  First line\nSecond line 🏁\n', '  Another post  '];
  const filenames = await Promise.all(texts.map(async body => {
    const response = await fetch(origin + '/api/text', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body,
      signal: AbortSignal.timeout(4000),
    });
    assert.equal(response.status, 201);
    const { filename } = await response.json();
    assert.match(filename, /^\d+\.txt$/);
    assert.equal(await readFile(join(textDirectory, filename), 'utf8'), body);
    const direct = await fetch(origin + '/.wild-wheels/text/' + filename, { signal: AbortSignal.timeout(4000) });
    assert.equal(direct.status, 404);
    return filename;
  }));
  assert.equal(new Set(filenames).size, 2);
});

test('cross-origin, oversized or invalid text never creates a file', async t => {
  const { origin, textDirectory } = await listen(t);
  for (const [body, headers, expected] of [
    ['foreign origin', { Origin: 'https://example.invalid' }, 403],
    ['{}', { 'Content-Type': 'application/json' }, 415],
    ['', {}, 400],
    [Buffer.from([0xff]), {}, 400],
    ['a'.repeat(65537), {}, 413],
    [(async function* () { yield 'a'.repeat(65536); yield 'b'; })(), {}, 413],
  ]) {
    const response = await fetch(origin + '/api/text', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', ...headers },
      body,
      duplex: 'half',
      signal: AbortSignal.timeout(4000),
    });
    assert.equal(response.status, expected);
    await response.text();
  }
  assert.deepEqual(await readdir(textDirectory), []);
});

test('a full text store rejects new posts and leaves the saved files intact', async t => {
  const { origin, textDirectory } = await listen(t);
  for (let slot = 1; slot <= 256; slot++) {
    await writeFile(join(textDirectory, `${slot}.txt`), 'existing text');
  }
  const response = await fetch(origin + '/api/text', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: 'extra text',
    signal: AbortSignal.timeout(4000),
  });
  assert.equal(response.status, 507);
  await response.text();
  assert.equal((await readdir(textDirectory)).length, 256);
  assert.equal(await readFile(join(textDirectory, '1.txt'), 'utf8'), 'existing text');
});

test('anonymous plain HTTP requests with a public hostname save test text', async t => {
  const { origin, textDirectory } = await listen(t);
  const saved = await new Promise((resolve, reject) => {
    const req = request(origin + '/api/text', {
      method: 'POST',
      headers: { Host: 'wild-wheels.duckdns.org:5173', 'Content-Type': 'text/plain' },
      signal: AbortSignal.timeout(4000),
    }, res => {
      let response = '';
      res.setEncoding('utf8');
      res.on('data', part => { response += part; });
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(response) }));
    });
    req.on('error', reject);
    req.end('Synthetic test key');
  });
  assert.equal(saved.status, 201);
  assert.equal(await readFile(join(textDirectory, saved.body.filename), 'utf8'), 'Synthetic test key');
});
