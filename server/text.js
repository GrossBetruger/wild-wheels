import { randomUUID } from 'node:crypto';
import { link, mkdir, open, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';

const maxBytes = 64 * 1024;
const maxFiles = 256;
const utf8 = new TextDecoder('utf-8', { fatal: true });

export function createTextEndpoint(multiplayer, {
  textDirectory = join(process.env.WILD_WHEELS_RUN_DIR || '.wild-wheels', 'text'),
} = {}) {
  return async (req, res) => {
    const reply = (status, value) => {
      if (!req.complete) res.setHeader('Connection', 'close');
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(JSON.stringify(value));
    };
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return reply(405, { error: 'Use POST.' });
    }

    try {
      const origin = multiplayer.security.check(req);
      const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)
        && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname);
      if (!multiplayer.security.secure(req) && !loopback) {
        return reply(403, { error: 'Use HTTPS or connect locally.' });
      }
      multiplayer.limit(req, 'text', 10, 60000);
      multiplayer.limit(req, 'text-total', 30, 60000, 'all');
      if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'text/plain') {
        return reply(415, { error: 'Use text/plain with UTF-8 encoding.' });
      }
      if (Number(req.headers['content-length']) > maxBytes) {
        return reply(413, { error: 'Text exceeds 64 KiB.' });
      }
      const parts = [];
      let size = 0;
      for await (const part of req.iterator({ destroyOnReturn: false })) {
        size += part.length;
        if (size > maxBytes) return reply(413, { error: 'Text exceeds 64 KiB.' });
        parts.push(part);
      }
      const body = Buffer.concat(parts, size);
      if (size === 0) return reply(400, { error: 'Send non-empty UTF-8 text.' });
      try {
        utf8.decode(body);
      } catch {
        return reply(400, { error: 'Send non-empty UTF-8 text.' });
      }

      const filename = await saveText(textDirectory, body);
      if (!filename) return reply(507, { error: 'Text storage is full.' });
      return reply(201, { filename });
    } catch (error) {
      if (res.destroyed || req.aborted) return;
      return reply(error.status ?? 500, {
        error: error.status ? error.message : 'Unable to save text.',
      });
    }
  };
}

async function saveText(directory, body) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const existing = new Set(await readdir(directory));
  const available = Array.from({ length: maxFiles }, (_, index) => `${index + 1}.txt`)
    .filter(filename => !existing.has(filename));
  if (available.length === 0) return;
  const temporary = join(directory, `.${randomUUID()}.tmp`);
  const file = await open(temporary, 'wx', 0o600);
  try {
    try {
      await file.writeFile(body);
      await file.sync();
    } finally {
      await file.close();
    }
    for (const filename of available) {
      try {
        // Publish a complete file without replacing another request's file.
        await link(temporary, join(directory, filename));
        return filename;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
    }
  } finally {
    await unlink(temporary).catch(() => {});
  }
}
