import { randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const maxBytes = 64 * 1024;
const utf8 = new TextDecoder('utf-8', { fatal: true });

export function createTextEndpoint(multiplayer, {
  textPostKey = process.env.TEXT_POST_KEY,
  textDirectory = join(process.env.WILD_WHEELS_RUN_DIR || '.wild-wheels', 'text'),
} = {}) {
  if (textPostKey !== undefined && (textPostKey.length !== 64 || /[^a-f0-9]/i.test(textPostKey))) {
    throw new Error('TEXT_POST_KEY must be 64 hexadecimal characters.');
  }
  const authorization = textPostKey && Buffer.from(`Bearer ${textPostKey}`);

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
    if (!authorization) return reply(404, { error: 'Not found.' });
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
      const presented = Buffer.from(req.headers.authorization ?? '');
      if (presented.length !== authorization.length || !timingSafeEqual(presented, authorization)) {
        res.setHeader('WWW-Authenticate', 'Bearer');
        return reply(401, { error: 'Send the text posting key as a bearer token.' });
      }
      multiplayer.limit(req, 'text', 10, 60000);
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

      await mkdir(textDirectory, { recursive: true, mode: 0o700 });
      const filename = `${randomUUID()}.txt`;
      const temporary = join(textDirectory, `.${filename}.tmp`);
      try {
        await writeFile(temporary, body, { flag: 'wx', mode: 0o600 });
        await rename(temporary, join(textDirectory, filename));
      } catch (error) {
        if (error.code !== 'EEXIST') await unlink(temporary).catch(() => {});
        throw error;
      }
      return reply(201, { filename });
    } catch (error) {
      if (res.destroyed || req.aborted) return;
      return reply(error.status ?? 500, {
        error: error.status ? error.message : 'Unable to save text.',
      });
    }
  };
}
