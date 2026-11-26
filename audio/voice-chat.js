import {
  VOICE_FRAME_SAMPLES,
  VOICE_SAMPLE_RATE,
  VoiceResampler,
  encodeMulaw,
  packVoiceFrame,
  unpackServerVoiceFrame,
} from './voice-codec.js';

const SPEAKING_HOLD_MS = 320;
const JITTER_BUFFER_SEC = 0.04;
const MAX_PLAYBACK_LEAD_SEC = 0.24;

export class VoiceChat {
  socket = null;
  token = null;
  connected = false;
  talking = false;
  playbackBlocked = false;
  error = '';
  mutedSpeakers = new Set();
  speakers = new Map(); // speakerId -> { lastHeardMs, nextTime }
  sequence = 0;
  pingTimer = null;
  reconnectTimer = null;
  activityTimer = null;
  captureContext = null;
  captureStream = null;
  captureNode = null;
  captureSource = null;
  captureSink = null;
  resampler = null;
  captureReady = null;
  playbackContext = null;

  constructor({ isAudioEnabled = () => true, getAudioContext = () => null, onChange = () => {}, log = () => {} } = {}) {
    this.isAudioEnabled = isAudioEnabled;
    this.getAudioContext = getAudioContext;
    this.onChange = onChange;
    this.log = log;
  }

  connect(token) {
    if (!token) { this.disconnect(); return; }
    if (this.token === token && this.socket && this.socket.readyState <= WebSocket.OPEN) return;
    this.closeSocket();
    this.token = token;
    this.openSocket(token);
  }

  disconnect() {
    this.token = null;
    this.talking = false;
    this.connected = false;
    this.error = '';
    this.speakers.clear();
    this.closeSocket();
    this.stopCapture();
    this.onChange();
  }

  closeSocket() {
    clearInterval(this.pingTimer); this.pingTimer = null;
    clearTimeout(this.reconnectTimer); this.reconnectTimer = null;
    clearInterval(this.activityTimer); this.activityTimer = null;
    const socket = this.socket;
    this.socket = null;
    this.connected = false;
    if (socket) {
      socket.onclose = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.close();
    }
  }

  openSocket(token) {
    if (typeof WebSocket === 'undefined' || typeof location === 'undefined') return;
    const url = new URL('/api/voice', location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = this.socket = new WebSocket(url);
    socket.binaryType = 'arraybuffer';
    socket.onopen = () => {
      if (this.token !== token || this.socket !== socket) return;
      socket.send(JSON.stringify({ type: 'authenticate', token }));
    };
    socket.onmessage = event => {
      if (this.token !== token || this.socket !== socket) return;
      if (event.data instanceof ArrayBuffer) {
        if (this.connected) this.handleIncoming(event.data);
        return;
      }
      if (this.connected || typeof event.data !== 'string') return;
      let reply;
      try { reply = JSON.parse(event.data); } catch { return; }
      if (reply?.type !== 'ready') return;
      this.connected = true;
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => {
        if (this.socket === socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'ping' }));
        }
      }, 15000);
      clearInterval(this.activityTimer);
      this.activityTimer = setInterval(() => {
        const now = performance.now();
        let expired = false;
        for (const [id, entry] of this.speakers) {
          if (now - entry.lastHeardMs >= SPEAKING_HOLD_MS) {
            this.speakers.delete(id);
            expired = true;
          }
        }
        if (expired) this.onChange();
      }, 160);
      this.onChange();
    };
    socket.onerror = () => {};
    socket.onclose = event => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.connected = false;
      clearInterval(this.pingTimer); this.pingTimer = null;
      clearInterval(this.activityTimer); this.activityTimer = null;
      if (event.code !== 1000) this.log('warn', 'voice-closed', { code: event.code, reason: event.reason });
      this.onChange();
      if (this.token === token && ![4001, 4003, 4004, 1008].includes(event.code)) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => {
          if (this.token === token && !this.socket) this.openSocket(token);
        }, 1500);
      }
    };
  }

  toggleMute(speakerId) {
    if (this.mutedSpeakers.has(speakerId)) this.mutedSpeakers.delete(speakerId);
    else this.mutedSpeakers.add(speakerId);
    this.onChange();
  }

  isMuted(speakerId) {
    return this.mutedSpeakers.has(speakerId);
  }

  activeSpeakers(now = performance.now()) {
    const ids = [];
    for (const [id, entry] of this.speakers) {
      if (now - entry.lastHeardMs < SPEAKING_HOLD_MS && !this.mutedSpeakers.has(id)) ids.push(id);
    }
    return ids;
  }

  isSpeaking(speakerId, now = performance.now()) {
    const entry = this.speakers.get(speakerId);
    return Boolean(entry && now - entry.lastHeardMs < SPEAKING_HOLD_MS);
  }

  async setTalking(active) {
    const next = Boolean(active) && Boolean(this.token);
    if (next === this.talking) return;
    if (!next) {
      this.talking = false;
      this.resampler?.reset();
      this.onChange();
      return;
    }
    this.talking = true;
    this.error = '';
    this.onChange();
    const ok = await this.ensureCapture();
    if (!ok) {
      this.talking = false;
      this.onChange();
      return;
    }
    if (this.captureContext?.state === 'suspended') {
      await this.captureContext.resume().catch(() => {});
    }
  }

  async ensureCapture() {
    if (this.captureStream) return true;
    if (this.captureReady) return this.captureReady;
    this.captureReady = (async () => {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        this.error = 'Mic needs HTTPS or localhost (you can still hear others).';
        return false;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        });
        const AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext;
        const ctx = new AudioCtx({ latencyHint: 'interactive' });
        const source = ctx.createMediaStreamSource(stream);
        const resampler = new VoiceResampler(ctx.sampleRate, VOICE_SAMPLE_RATE, VOICE_FRAME_SAMPLES);
        const onChunk = chunk => {
          if (!this.talking || !this.socket || this.socket.readyState !== WebSocket.OPEN) return;
          if (this.socket.bufferedAmount > 8192) return;
          resampler.push(chunk, frame => {
            const packet = packVoiceFrame(this.sequence++, encodeMulaw(frame));
            this.socket.send(packet);
          });
        };
        let node = null;
        if (ctx.audioWorklet) {
          try {
            await ctx.audioWorklet.addModule('/audio/voice-worklet.js');
            node = new AudioWorkletNode(ctx, 'voice-capture', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
            node.port.onmessage = event => onChunk(event.data);
          } catch {}
        }
        if (!node && typeof ctx.createScriptProcessor === 'function') {
          node = ctx.createScriptProcessor(1024, 1, 1);
          node.onaudioprocess = event => onChunk(event.inputBuffer.getChannelData(0));
        }
        if (!node) {
          stream.getTracks().forEach(track => track.stop());
          ctx.close().catch(() => {});
          this.error = 'Browser audio capture is unavailable.';
          return false;
        }
        // Keep the capture graph active without feeding mic audio back into local speakers.
        const sink = ctx.createGain();
        sink.gain.value = 0;
        source.connect(node);
        node.connect(sink);
        sink.connect(ctx.destination);
        this.captureStream = stream;
        this.captureContext = ctx;
        this.captureSource = source;
        this.captureNode = node;
        this.captureSink = sink;
        this.resampler = resampler;
        return true;
      } catch (err) {
        this.error = err?.name === 'NotAllowedError'
          ? 'Microphone permission denied.'
          : err?.name === 'NotFoundError'
            ? 'No microphone found.'
            : 'Could not start microphone.';
        return false;
      } finally {
        this.captureReady = null;
      }
    })();
    return this.captureReady;
  }

  stopCapture() {
    this.captureReady = null;
    try { this.captureSource?.disconnect(); } catch {}
    try { this.captureNode?.disconnect(); } catch {}
    try { this.captureSink?.disconnect(); } catch {}
    this.captureStream?.getTracks().forEach(track => track.stop());
    this.captureContext?.close().catch(() => {});
    this.captureStream = null;
    this.captureContext = null;
    this.captureSource = null;
    this.captureNode = null;
    this.captureSink = null;
    this.resampler = null;
  }

  outputContext() {
    const shared = this.getAudioContext?.();
    if (shared) {
      if (this.playbackContext && this.playbackContext !== shared) {
        this.playbackContext.close().catch(() => {});
        this.playbackContext = null;
      }
      return shared;
    }
    if (!this.playbackContext && typeof globalThis.AudioContext === 'function') {
      this.playbackContext = new AudioContext({ latencyHint: 'interactive' });
    }
    return this.playbackContext;
  }

  unlockPlayback() {
    const ctx = this.outputContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      ctx.resume().then(() => {
        if (this.playbackBlocked && ctx.state === 'running') {
          this.playbackBlocked = false;
          this.onChange();
        }
      }).catch(() => {});
    } else if (this.playbackBlocked && ctx.state === 'running') {
      this.playbackBlocked = false;
      this.onChange();
    }
  }

  handleIncoming(buffer) {
    const frame = unpackServerVoiceFrame(buffer);
    if (!frame) return;
    const now = performance.now();
    const existing = this.speakers.get(frame.speaker);
    const wasSpeaking = Boolean(existing && now - existing.lastHeardMs < SPEAKING_HOLD_MS);
    const entry = existing ?? { lastHeardMs: 0, nextTime: 0 };
    entry.lastHeardMs = now;
    this.speakers.set(frame.speaker, entry);
    if (!wasSpeaking) this.onChange();

    if (this.mutedSpeakers.has(frame.speaker) || !this.isAudioEnabled()) return;
    const ctx = this.outputContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      ctx.resume().then(() => {
        if (this.playbackBlocked && ctx.state === 'running') {
          this.playbackBlocked = false;
          this.onChange();
        }
      }).catch(() => {});
      if (!this.playbackBlocked) {
        this.playbackBlocked = true;
        this.onChange();
      }
      return;
    }
    if (this.playbackBlocked) {
      this.playbackBlocked = false;
      this.onChange();
    }
    const audioBuffer = ctx.createBuffer(1, frame.samples.length, VOICE_SAMPLE_RATE);
    audioBuffer.copyToChannel(frame.samples, 0);
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);
    const t = ctx.currentTime;
    if (entry.nextTime < t + 0.005 || entry.nextTime > t + MAX_PLAYBACK_LEAD_SEC) {
      entry.nextTime = t + JITTER_BUFFER_SEC;
    }
    source.start(entry.nextTime);
    entry.nextTime += frame.samples.length / VOICE_SAMPLE_RATE;
  }
}
