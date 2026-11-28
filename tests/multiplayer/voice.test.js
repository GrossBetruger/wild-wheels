import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import WebSocket from 'ws';
import { Multiplayer } from '../../server/multiplayer.js';
import {
  VOICE_FRAME_SAMPLES,
  VOICE_SAMPLE_RATE,
  VoiceResampler,
  decodeMulaw,
  decodeMulawSample,
  encodeMulaw,
  encodeMulawSample,
  packVoiceFrame,
  unpackServerVoiceFrame,
} from '../../audio/voice-codec.js';
import { VoiceChat } from '../../audio/voice-chat.js';

test('mu-law voice codec round-trips silence and sine waves within telephony tolerance', () => {
  assert.equal(encodeMulawSample(0), 0xff);
  assert.ok(Math.abs(decodeMulawSample(0xff)) < 0.005);

  const input = new Float32Array(VOICE_FRAME_SAMPLES);
  for (let i = 0; i < input.length; i++) input[i] = Math.sin(i * 0.15) * 0.6;
  const encoded = encodeMulaw(input);
  assert.equal(encoded.length, VOICE_FRAME_SAMPLES);
  const decoded = decodeMulaw(encoded);
  let maxErr = 0;
  for (let i = 0; i < input.length; i++) maxErr = Math.max(maxErr, Math.abs(input[i] - decoded[i]));
  assert.ok(maxErr < 0.03, `expected mu-law error < 0.03, got ${maxErr}`);
});

test('VoiceResampler downsamples 48 kHz to exact 16 kHz 320-sample frames', () => {
  const resampler = new VoiceResampler(48000, VOICE_SAMPLE_RATE, VOICE_FRAME_SAMPLES);
  const frames = [];
  // 960 samples at 48 kHz = 20 ms = 320 samples at 16 kHz.
  const chunk = new Float32Array(960);
  for (let i = 0; i < chunk.length; i++) chunk[i] = Math.sin(i / 48000 * 2 * Math.PI * 440) * 0.5;
  resampler.push(chunk, frame => frames.push(new Float32Array(frame)));
  assert.equal(frames.length, 1);
  assert.equal(frames[0].length, VOICE_FRAME_SAMPLES);
});

test('voice wire packing and server frame unpacking reject malformed packets', () => {
  const mulaw = encodeMulaw(new Float32Array(VOICE_FRAME_SAMPLES));
  const clientFrame = packVoiceFrame(42, mulaw);
  assert.equal(clientFrame.length, 4 + VOICE_FRAME_SAMPLES);

  const serverFrame = new Uint8Array(2 + clientFrame.length);
  serverFrame[0] = 3; // speaker id
  serverFrame[1] = 0; // flags
  serverFrame.set(clientFrame, 2);

  const decoded = unpackServerVoiceFrame(serverFrame);
  assert.equal(decoded.speaker, 3);
  assert.equal(decoded.flags, 0);
  assert.equal(decoded.seq, 42);
  assert.equal(decoded.samples.length, VOICE_FRAME_SAMPLES);

  assert.equal(unpackServerVoiceFrame(new Uint8Array(10)), null);
  assert.equal(unpackServerVoiceFrame(serverFrame.subarray(0, serverFrame.length - 1)), null);
});

test('/api/voice relays authenticated binary voice frames to room peers without echoing to sender', async t => {
  const app = new Multiplayer();
  const server = http.createServer((req, res) => app.handle(req, res));
  app.attach(server);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const origin = `http://127.0.0.1:${port}`;
  t.after(() => { app.close(); server.close(); });

  const post = async (path, body, token) => {
    const res = await fetch(origin + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    return res.json();
  };

  const host = await post('/api/rooms', { name: 'Oren', driver: 0, arena: 0, bots: 0 });
  const guest = await post('/api/join', { name: 'Sarah', driver: 1, code: host.code });

  const connectVoice = (token, expectedId) => new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/voice`, { origin });
    ws.once('open', () => {
      ws.once('message', (data, binary) => {
        try {
          assert.equal(binary, false);
          assert.deepEqual(JSON.parse(data.toString()), { type: 'ready', id: expectedId });
          resolve(ws);
        } catch (err) {
          reject(err);
        }
      });
      ws.send(JSON.stringify({ type: 'authenticate', token }));
    });
    ws.once('error', reject);
  });

  const wsHost = await connectVoice(host.token, host.you);
  const wsGuest = await connectVoice(guest.token, guest.you);
  t.after(() => { wsHost.close(); wsGuest.close(); });

  // Verify keepalive ping/pong.
  const pong = new Promise(resolve => wsHost.once('message', (data, binary) => resolve({ binary, msg: JSON.parse(data.toString()) })));
  wsHost.send(JSON.stringify({ type: 'ping' }));
  assert.deepEqual(await pong, { binary: false, msg: { type: 'pong' } });

  let hostEchoed = false;
  wsHost.on('message', (_data, binary) => { if (binary) hostEchoed = true; });

  const received = new Promise(resolve => wsGuest.once('message', (data, binary) => resolve({ binary, data })));
  const payload = packVoiceFrame(9, encodeMulaw(new Float32Array(VOICE_FRAME_SAMPLES).fill(0.25)));
  wsHost.send(payload);

  const packet = await received;
  assert.equal(packet.binary, true);
  const decoded = unpackServerVoiceFrame(packet.data);
  assert.equal(decoded.speaker, host.you);
  assert.equal(decoded.seq, 9);
  assert.equal(decoded.samples.length, VOICE_FRAME_SAMPLES);
  assert.ok(Math.abs(decoded.samples[0] - 0.25) < 0.03);
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(hostEchoed, false);

  // Invalid frame size closes the sender's voice socket.
  const closed = new Promise(resolve => wsHost.once('close', code => resolve(code)));
  wsHost.send(Buffer.from([1, 2, 3, 4, 5]));
  assert.equal(await closed, 1008);
});

test('VoiceChat flags playbackBlocked when AudioContext is suspended and clears on unlock', async () => {
  const started = [];
  const fakeContext = {
    state: 'suspended',
    currentTime: 0,
    destination: {},
    resume() {
      return Promise.resolve();
    },
    createBuffer(_ch, len, rate) {
      return { len, rate, copyToChannel() {} };
    },
    createBufferSource() {
      return {
        buffer: null,
        connect() {},
        start(when) { started.push(when); },
      };
    },
  };
  let changes = 0;
  const chat = new VoiceChat({
    getAudioContext: () => fakeContext,
    onChange: () => { changes++; },
  });
  const payload = packVoiceFrame(1, encodeMulaw(new Float32Array(VOICE_FRAME_SAMPLES).fill(0.2)));
  const packet = new Uint8Array(2 + payload.length);
  packet[0] = 2;
  packet.set(payload, 2);

  chat.handleIncoming(packet.buffer);
  assert.equal(chat.playbackBlocked, true);
  assert.equal(started.length, 0);
  assert.ok(changes > 0);

  fakeContext.state = 'running';
  fakeContext.currentTime = 1.0;
  chat.unlockPlayback();
  assert.equal(chat.playbackBlocked, false);

  chat.handleIncoming(packet.buffer);
  assert.equal(started.length, 1);
});

test('always-on mic mode stays live on V keyup and toggles mute on V keydown', async () => {
  const { NetworkGame } = await import('../../networking/network.js');
  const calls = [];
  const fake = Object.create(NetworkGame.prototype);
  fake.token = 'tok';
  fake.state = {};
  fake.micMode = 'ptt';
  fake.micMuted = false;
  fake.voice = { talking: false, setTalking: v => { fake.voice.talking = v; calls.push(v); return Promise.resolve(); } };
  fake.updateVoiceUi = () => {};
  fake.unlock = () => Promise.resolve();

  // Switch to always-on: starts transmitting immediately.
  await fake.setMicMode('always');
  assert.equal(fake.micMode, 'always');
  assert.equal(fake.voice.talking, true);

  // Keyup on V does not stop always-on mic; releasePushToTalk does not stop it either.
  fake.pressVoiceKey(false);
  fake.releasePushToTalk();
  assert.equal(fake.voice.talking, true);

  // Keydown on V mutes; key repeat is ignored; second keydown unmutes.
  fake.pressVoiceKey(true, false);
  assert.equal(fake.voice.talking, false);
  fake.pressVoiceKey(true, true);
  assert.equal(fake.voice.talking, false);
  fake.pressVoiceKey(true, false);
  assert.equal(fake.voice.talking, true);

  // Switching back to push-to-talk stops transmitting and restores hold-to-talk.
  await fake.setMicMode('ptt');
  assert.equal(fake.voice.talking, false);
  fake.pressVoiceKey(true);
  assert.equal(fake.voice.talking, true);
  fake.pressVoiceKey(false);
  assert.equal(fake.voice.talking, false);
});
