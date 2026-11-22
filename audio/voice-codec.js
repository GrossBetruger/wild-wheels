// Shared 16 kHz mono G.711 mu-law voice codec and binary wire framing.
// Matches dedicated-server/src/voice.rs and native-client/src/voice.rs byte-for-byte.
export const VOICE_SAMPLE_RATE = 16000;
export const VOICE_FRAME_SAMPLES = 320; // 20 ms at 16 kHz
export const VOICE_MIN_SAMPLES = 160;
export const VOICE_MAX_SAMPLES = 960;

const MULAW_BIAS = 0x84;
const MULAW_MAX = 32635;

export function encodeMulawSample(sample) {
  let pcm = Math.round(Math.max(-1, Math.min(1, sample)) * 32767);
  let sign = 0;
  if (pcm < 0) {
    sign = 0x80;
    pcm = -pcm;
  }
  if (pcm > MULAW_MAX) pcm = MULAW_MAX;
  pcm += MULAW_BIAS;
  let exponent = 7;
  for (let mask = 0x4000; exponent > 0 && (pcm & mask) === 0; mask >>= 1) {
    exponent--;
  }
  const mantissa = (pcm >> (exponent + 3)) & 0x0f;
  return (~(sign | (exponent << 4) | mantissa)) & 0xff;
}

export function decodeMulawSample(byte) {
  const u = (~byte) & 0xff;
  const sign = u & 0x80;
  const exponent = (u >> 4) & 0x07;
  const mantissa = u & 0x0f;
  let pcm = (((mantissa << 3) + MULAW_BIAS) << exponent) - MULAW_BIAS;
  if (sign) pcm = -pcm;
  return pcm / 32768;
}

const DECODE_TABLE = new Float32Array(256);
for (let i = 0; i < 256; i++) DECODE_TABLE[i] = decodeMulawSample(i);

export function encodeMulaw(samples) {
  const out = new Uint8Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = encodeMulawSample(samples[i]);
  return out;
}

export function decodeMulaw(bytes) {
  const out = new Float32Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = DECODE_TABLE[bytes[i]];
  return out;
}

export function packVoiceFrame(seq, mulawBytes) {
  const count = mulawBytes.length;
  if (count < VOICE_MIN_SAMPLES || count > VOICE_MAX_SAMPLES) {
    throw new RangeError(`Voice frame must contain ${VOICE_MIN_SAMPLES}-${VOICE_MAX_SAMPLES} samples.`);
  }
  const buf = new Uint8Array(4 + count);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  view.setUint16(0, seq & 0xffff, true);
  view.setUint16(2, count, true);
  buf.set(mulawBytes, 4);
  return buf;
}

export function unpackServerVoiceFrame(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.byteLength < 6 + VOICE_MIN_SAMPLES || bytes.byteLength > 6 + VOICE_MAX_SAMPLES) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const speaker = bytes[0];
  const flags = bytes[1];
  const seq = view.getUint16(2, true);
  const count = view.getUint16(4, true);
  if (count < VOICE_MIN_SAMPLES || count > VOICE_MAX_SAMPLES || bytes.byteLength !== 6 + count) return null;
  return { speaker, flags, seq, samples: decodeMulaw(bytes.subarray(6)) };
}

export class VoiceResampler {
  constructor(inputRate, targetRate = VOICE_SAMPLE_RATE, frameSamples = VOICE_FRAME_SAMPLES) {
    this.ratio = inputRate / targetRate;
    this.frameSamples = frameSamples;
    this.phase = 0;
    this.prev = 0;
    this.hasPrev = false;
    this.buffer = new Float32Array(frameSamples);
    this.filled = 0;
  }
  reset() {
    this.phase = 0;
    this.prev = 0;
    this.hasPrev = false;
    this.filled = 0;
  }
  push(input, onFrame) {
    if (!input.length) return;
    let pos = this.phase;
    while (pos < input.length) {
      const i0 = Math.floor(pos);
      const frac = pos - i0;
      const s0 = i0 < 0 ? (this.hasPrev ? this.prev : input[0]) : input[i0];
      const s1 = i0 + 1 < input.length ? input[i0 + 1] : input[input.length - 1];
      this.buffer[this.filled++] = s0 + (s1 - s0) * frac;
      if (this.filled === this.frameSamples) {
        onFrame(this.buffer);
        this.filled = 0;
      }
      pos += this.ratio;
    }
    this.prev = input[input.length - 1];
    this.hasPrev = true;
    this.phase = pos - input.length;
  }
}
