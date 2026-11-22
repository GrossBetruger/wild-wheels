// CSP-safe AudioWorklet processor that forwards microphone PCM chunks to the main thread.
class VoiceCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel?.length) this.port.postMessage(new Float32Array(channel));
    return true;
  }
}
registerProcessor('voice-capture', VoiceCaptureProcessor);
