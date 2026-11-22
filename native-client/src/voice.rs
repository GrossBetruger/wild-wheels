//! Push-to-talk multiplayer voice chat over `/api/voice` using 16 kHz mono G.711 µ-law.
//! Wire format matches `dedicated-server/src/voice.rs` and `audio/voice-codec.js`.
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use crossbeam_channel::{Receiver, Sender, bounded};
use futures_util::{SinkExt, StreamExt};
use serde_json::json;
use std::{
    collections::{HashMap, HashSet, VecDeque},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};
use tokio_tungstenite::tungstenite::{Message, client::IntoClientRequest};
use url::Url;

pub const VOICE_SAMPLE_RATE: u32 = 16_000;
pub const VOICE_FRAME_SAMPLES: usize = 320; // 20 ms at 16 kHz
const MIN_SAMPLES: usize = 160;
const MAX_SAMPLES: usize = 960;
const MAX_BUFFER_SAMPLES: usize = VOICE_SAMPLE_RATE as usize / 3; // ~333 ms cap per speaker
const SPEAKING_HOLD: Duration = Duration::from_millis(320);

const MULAW_BIAS: i32 = 0x84;
const MULAW_MAX: i32 = 32_635;

pub fn encode_mulaw_sample(sample: f32) -> u8 {
    let mut pcm = (sample.clamp(-1.0, 1.0) * 32_767.0).round() as i32;
    let sign = if pcm < 0 {
        pcm = -pcm;
        0x80
    } else {
        0
    };
    if pcm > MULAW_MAX {
        pcm = MULAW_MAX;
    }
    pcm += MULAW_BIAS;
    let mut exponent = 7i32;
    let mut mask = 0x4000;
    while exponent > 0 && (pcm & mask) == 0 {
        exponent -= 1;
        mask >>= 1;
    }
    let mantissa = (pcm >> (exponent + 3)) & 0x0f;
    !(sign | (exponent << 4) | mantissa) as u8
}

pub fn decode_mulaw_sample(byte: u8) -> f32 {
    let u = !byte;
    let sign = u & 0x80;
    let exponent = (u >> 4) & 0x07;
    let mantissa = i32::from(u & 0x0f);
    let mut pcm = (((mantissa << 3) + MULAW_BIAS) << exponent) - MULAW_BIAS;
    if sign != 0 {
        pcm = -pcm;
    }
    pcm as f32 / 32_768.0
}

pub fn pack_client_frame(seq: u16, mulaw: &[u8]) -> Option<Vec<u8>> {
    let count = mulaw.len();
    if !(MIN_SAMPLES..=MAX_SAMPLES).contains(&count) {
        return None;
    }
    let mut out = Vec::with_capacity(4 + count);
    out.extend_from_slice(&seq.to_le_bytes());
    out.extend_from_slice(&(count as u16).to_le_bytes());
    out.extend_from_slice(mulaw);
    Some(out)
}

pub fn unpack_server_frame(data: &[u8]) -> Option<(usize, u16, Vec<f32>)> {
    if data.len() < 6 + MIN_SAMPLES || data.len() > 6 + MAX_SAMPLES {
        return None;
    }
    let speaker = usize::from(data[0]);
    let seq = u16::from_le_bytes([data[2], data[3]]);
    let count = usize::from(u16::from_le_bytes([data[4], data[5]]));
    if !(MIN_SAMPLES..=MAX_SAMPLES).contains(&count) || data.len() != 6 + count {
        return None;
    }
    let samples = data[6..].iter().map(|&b| decode_mulaw_sample(b)).collect();
    Some((speaker, seq, samples))
}

struct SpeakerQueue {
    samples: VecDeque<f32>,
    last_heard: Instant,
    phase: f64,
    prev: f32,
}

impl SpeakerQueue {
    fn new(now: Instant) -> Self {
        Self {
            samples: VecDeque::with_capacity(VOICE_FRAME_SAMPLES * 4),
            last_heard: now,
            phase: 1.0,
            prev: 0.0,
        }
    }

    fn push(&mut self, samples: &[f32], now: Instant) {
        self.last_heard = now;
        self.samples.extend(samples.iter().copied());
        if self.samples.len() > MAX_BUFFER_SAMPLES {
            let drop_n = self.samples.len() - MAX_BUFFER_SAMPLES;
            self.samples.drain(..drop_n);
        }
    }

    fn next_sample(&mut self, ratio: f64) -> f32 {
        while self.phase >= 1.0 {
            if let Some(next) = self.samples.pop_front() {
                self.prev = next;
            } else {
                self.prev = 0.0;
                self.phase = 1.0;
                return 0.0;
            }
            self.phase -= 1.0;
        }
        let next = self.samples.front().copied().unwrap_or(self.prev);
        let sample = self.prev + (next - self.prev) * self.phase as f32;
        self.phase += ratio;
        sample
    }
}

#[derive(Default)]
pub(crate) struct Mixer {
    speakers: HashMap<usize, SpeakerQueue>,
    muted: HashSet<usize>,
}

impl Mixer {
    pub(crate) fn push(&mut self, speaker: usize, samples: &[f32], now: Instant) {
        let entry = self
            .speakers
            .entry(speaker)
            .or_insert_with(|| SpeakerQueue::new(now));
        entry.last_heard = now;
        if !self.muted.contains(&speaker) {
            entry.push(samples, now);
        }
    }

    pub(crate) fn toggle_mute(&mut self, speaker: usize) {
        if !self.muted.remove(&speaker) {
            self.muted.insert(speaker);
            if let Some(q) = self.speakers.get_mut(&speaker) {
                q.samples.clear();
            }
        }
    }

    pub(crate) fn is_muted(&self, speaker: usize) -> bool {
        self.muted.contains(&speaker)
    }

    pub(crate) fn active_speakers(&self, now: Instant) -> Vec<usize> {
        let mut ids: Vec<usize> = self
            .speakers
            .iter()
            .filter(|(id, q)| !self.muted.contains(id) && now.duration_since(q.last_heard) < SPEAKING_HOLD)
            .map(|(&id, _)| id)
            .collect();
        ids.sort_unstable();
        ids
    }

    pub(crate) fn is_speaking(&self, speaker: usize, now: Instant) -> bool {
        self.speakers
            .get(&speaker)
            .is_some_and(|q| now.duration_since(q.last_heard) < SPEAKING_HOLD)
    }

    pub(crate) fn clear(&mut self) {
        self.speakers.clear();
    }

    pub(crate) fn mix_frame(&mut self, output_rate: u32) -> f32 {
        let ratio = f64::from(VOICE_SAMPLE_RATE) / f64::from(output_rate.max(1));
        let mut sum = 0.0f32;
        for (&id, queue) in &mut self.speakers {
            if self.muted.contains(&id) || queue.samples.is_empty() {
                continue;
            }
            sum += queue.next_sample(ratio);
        }
        sum.tanh()
    }
}

struct Resampler {
    ratio: f64,
    phase: f64,
    prev: f32,
    has_prev: bool,
    buf: Vec<u8>,
    seq: u16,
}

impl Resampler {
    fn new(input_rate: u32) -> Self {
        Self {
            ratio: f64::from(input_rate) / f64::from(VOICE_SAMPLE_RATE),
            phase: 0.0,
            prev: 0.0,
            has_prev: false,
            buf: Vec::with_capacity(VOICE_FRAME_SAMPLES),
            seq: 0,
        }
    }

    fn reset(&mut self) {
        self.phase = 0.0;
        self.prev = 0.0;
        self.has_prev = false;
        self.buf.clear();
    }

    fn push_mono(&mut self, input: &[f32], tx: &Sender<Vec<u8>>) {
        if input.is_empty() {
            return;
        }
        let mut pos = self.phase;
        while pos < input.len() as f64 {
            let i0 = pos.floor() as isize;
            let frac = (pos - i0 as f64) as f32;
            let s0 = if i0 < 0 {
                if self.has_prev { self.prev } else { input[0] }
            } else {
                input[i0 as usize]
            };
            let s1 = input
                .get((i0 + 1).max(0) as usize)
                .copied()
                .unwrap_or(*input.last().unwrap());
            let sample = s0 + (s1 - s0) * frac;
            self.buf.push(encode_mulaw_sample(sample));
            if self.buf.len() == VOICE_FRAME_SAMPLES {
                if let Some(frame) = pack_client_frame(self.seq, &self.buf) {
                    let _ = tx.try_send(frame);
                }
                self.seq = self.seq.wrapping_add(1);
                self.buf.clear();
            }
            pos += self.ratio;
        }
        self.prev = *input.last().unwrap();
        self.has_prev = true;
        self.phase = pos - input.len() as f64;
    }
}

enum Control {
    Connect(Url, String),
    Disconnect,
    Stop,
}

enum AudioCommand {
    EnsureInput,
    StopInput,
}

pub struct Voice {
    control: Option<Sender<Control>>,
    audio_cmd: Option<Sender<AudioCommand>>,
    mixer: Arc<Mutex<Mixer>>,
    talking: Arc<AtomicBool>,
    error: Arc<Mutex<Option<String>>>,
    connected: bool,
    input_started: bool,
}

impl Default for Voice {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for Voice {
    fn drop(&mut self) {
        self.talking.store(false, Ordering::Relaxed);
        if let Some(tx) = &self.control {
            let _ = tx.try_send(Control::Stop);
        }
    }
}

impl Voice {
    pub fn new() -> Self {
        Self {
            control: None,
            audio_cmd: None,
            mixer: Arc::new(Mutex::new(Mixer::default())),
            talking: Arc::new(AtomicBool::new(false)),
            error: Arc::new(Mutex::new(None)),
            connected: false,
            input_started: false,
        }
    }

    pub fn connect(&mut self, origin: Url, token: String) {
        self.ensure_workers();
        self.connected = true;
        if let Some(tx) = &self.control {
            let _ = tx.try_send(Control::Connect(origin, token));
        }
    }

    pub fn disconnect(&mut self) {
        self.connected = false;
        self.talking.store(false, Ordering::Relaxed);
        self.input_started = false;
        self.mixer.lock().unwrap().clear();
        *self.error.lock().unwrap() = None;
        if let Some(tx) = &self.control {
            let _ = tx.try_send(Control::Disconnect);
        }
        if let Some(tx) = &self.audio_cmd {
            let _ = tx.try_send(AudioCommand::StopInput);
        }
    }

    pub fn set_talking(&mut self, active: bool) {
        let next = active && self.connected;
        let prev = self.talking.swap(next, Ordering::Relaxed);
        if next && !prev {
            *self.error.lock().unwrap() = None;
            if !self.input_started {
                self.input_started = true;
                if let Some(tx) = &self.audio_cmd {
                    let _ = tx.try_send(AudioCommand::EnsureInput);
                }
            }
        }
    }

    pub fn is_talking(&self) -> bool {
        self.talking.load(Ordering::Relaxed)
    }

    pub fn toggle_mute(&self, speaker: usize) {
        self.mixer.lock().unwrap().toggle_mute(speaker);
    }

    pub fn is_muted(&self, speaker: usize) -> bool {
        self.mixer.lock().unwrap().is_muted(speaker)
    }

    pub fn active_speakers(&self) -> Vec<usize> {
        self.mixer.lock().unwrap().active_speakers(Instant::now())
    }

    pub fn is_speaking(&self, speaker: usize) -> bool {
        self.mixer.lock().unwrap().is_speaking(speaker, Instant::now())
    }

    pub fn error(&self) -> Option<String> {
        self.error.lock().unwrap().clone()
    }

    fn ensure_workers(&mut self) {
        if self.control.is_some() {
            return;
        }
        let (ctrl_tx, ctrl_rx) = bounded(8);
        let (frame_tx, frame_rx) = bounded::<Vec<u8>>(32);
        let (audio_tx, audio_rx) = bounded::<AudioCommand>(8);
        let mixer_net = self.mixer.clone();
        let _ = std::thread::Builder::new()
            .name("voice-network".into())
            .spawn(move || {
                let Ok(rt) = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                else {
                    return;
                };
                rt.block_on(network_worker(ctrl_rx, frame_rx, mixer_net));
            });

        let mixer_out = self.mixer.clone();
        let talking_in = self.talking.clone();
        let error_in = self.error.clone();
        let _ = std::thread::Builder::new()
            .name("voice-audio".into())
            .spawn(move || audio_worker(audio_rx, frame_tx, mixer_out, talking_in, error_in));

        self.control = Some(ctrl_tx);
        self.audio_cmd = Some(audio_tx);
    }
}

fn audio_worker(
    commands: Receiver<AudioCommand>,
    frame_tx: Sender<Vec<u8>>,
    mixer: Arc<Mutex<Mixer>>,
    talking: Arc<AtomicBool>,
    error_slot: Arc<Mutex<Option<String>>>,
) {
    let _output_stream = start_output_stream(mixer);
    let mut input_stream: Option<cpal::Stream> = None;
    while let Ok(cmd) = commands.recv() {
        match cmd {
            AudioCommand::EnsureInput => {
                if input_stream.is_none() {
                    match start_input_stream(frame_tx.clone(), talking.clone()) {
                        Ok(stream) => {
                            input_stream = Some(stream);
                            *error_slot.lock().unwrap() = None;
                        }
                        Err(err) => {
                            talking.store(false, Ordering::Relaxed);
                            *error_slot.lock().unwrap() = Some(err);
                        }
                    }
                }
            }
            AudioCommand::StopInput => {
                input_stream = None;
            }
        }
    }
}

fn start_output_stream(mixer: Arc<Mutex<Mixer>>) -> Option<cpal::Stream> {
    let host = cpal::default_host();
    let device = host.default_output_device()?;
    let supported = device.default_output_config().ok()?;
    let config: cpal::StreamConfig = supported.clone().into();
    let channels = usize::from(config.channels.max(1));
    let rate = config.sample_rate;
    let stream = match supported.sample_format() {
        cpal::SampleFormat::F32 => device
            .build_output_stream(
                &config,
                move |data: &mut [f32], _| {
                    let mut m = mixer.lock().unwrap();
                    for frame in data.chunks_mut(channels) {
                        let s = m.mix_frame(rate);
                        frame.fill(s);
                    }
                },
                |_| {},
                None,
            )
            .ok()?,
        cpal::SampleFormat::I16 => device
            .build_output_stream(
                &config,
                move |data: &mut [i16], _| {
                    let mut m = mixer.lock().unwrap();
                    for frame in data.chunks_mut(channels) {
                        let s = (m.mix_frame(rate) * 32_767.0) as i16;
                        frame.fill(s);
                    }
                },
                |_| {},
                None,
            )
            .ok()?,
        cpal::SampleFormat::U16 => device
            .build_output_stream(
                &config,
                move |data: &mut [u16], _| {
                    let mut m = mixer.lock().unwrap();
                    for frame in data.chunks_mut(channels) {
                        let s = ((m.mix_frame(rate) * 0.5 + 0.5).clamp(0.0, 1.0) * 65_535.0) as u16;
                        frame.fill(s);
                    }
                },
                |_| {},
                None,
            )
            .ok()?,
        _ => return None,
    };
    stream.play().ok()?;
    Some(stream)
}

fn start_input_stream(
    frame_tx: Sender<Vec<u8>>,
    talking: Arc<AtomicBool>,
) -> Result<cpal::Stream, String> {
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| "No microphone device found".to_owned())?;
    let supported = device
        .default_input_config()
        .map_err(|_| "Could not read microphone config".to_owned())?;
    let config: cpal::StreamConfig = supported.clone().into();
    let channels = usize::from(config.channels.max(1));
    let rate = config.sample_rate;
    let resampler = Arc::new(Mutex::new(Resampler::new(rate)));

    let stream = match supported.sample_format() {
        cpal::SampleFormat::F32 => {
            let r = resampler.clone();
            let t = talking.clone();
            let tx = frame_tx.clone();
            device
                .build_input_stream(
                    &config,
                    move |data: &[f32], _| {
                        let mut r = r.lock().unwrap();
                        if !t.load(Ordering::Relaxed) {
                            r.reset();
                            return;
                        }
                        let mono: Vec<f32> = data
                            .chunks(channels)
                            .map(|ch| ch.iter().copied().sum::<f32>() / ch.len() as f32)
                            .collect();
                        r.push_mono(&mono, &tx);
                    },
                    |_| {},
                    None,
                )
                .map_err(|_| "Microphone permission denied or unavailable".to_owned())?
        }
        cpal::SampleFormat::I16 => {
            let r = resampler.clone();
            let t = talking.clone();
            let tx = frame_tx.clone();
            device
                .build_input_stream(
                    &config,
                    move |data: &[i16], _| {
                        let mut r = r.lock().unwrap();
                        if !t.load(Ordering::Relaxed) {
                            r.reset();
                            return;
                        }
                        let mono: Vec<f32> = data
                            .chunks(channels)
                            .map(|ch| {
                                ch.iter().map(|&s| f32::from(s) / 32_768.0).sum::<f32>()
                                    / ch.len() as f32
                            })
                            .collect();
                        r.push_mono(&mono, &tx);
                    },
                    |_| {},
                    None,
                )
                .map_err(|_| "Microphone permission denied or unavailable".to_owned())?
        }
        cpal::SampleFormat::U16 => {
            let r = resampler.clone();
            let t = talking.clone();
            let tx = frame_tx.clone();
            device
                .build_input_stream(
                    &config,
                    move |data: &[u16], _| {
                        let mut r = r.lock().unwrap();
                        if !t.load(Ordering::Relaxed) {
                            r.reset();
                            return;
                        }
                        let mono: Vec<f32> = data
                            .chunks(channels)
                            .map(|ch| {
                                ch.iter()
                                    .map(|&s| (f32::from(s) / 32_768.0) - 1.0)
                                    .sum::<f32>()
                                    / ch.len() as f32
                            })
                            .collect();
                        r.push_mono(&mono, &tx);
                    },
                    |_| {},
                    None,
                )
                .map_err(|_| "Microphone permission denied or unavailable".to_owned())?
        }
        _ => return Err("Unsupported microphone sample format".to_owned()),
    };
    stream
        .play()
        .map_err(|_| "Could not start microphone stream".to_owned())?;
    Ok(stream)
}

async fn network_worker(
    control: Receiver<Control>,
    frames: Receiver<Vec<u8>>,
    mixer: Arc<Mutex<Mixer>>,
) {
    let mut target: Option<(Url, String)> = None;
    loop {
        while let Ok(cmd) = control.try_recv() {
            match cmd {
                Control::Connect(origin, token) => target = Some((origin, token)),
                Control::Disconnect => target = None,
                Control::Stop => return,
            }
        }
        while frames.try_recv().is_ok() {}
        let Some((origin, token)) = target.clone() else {
            tokio::time::sleep(Duration::from_millis(25)).await;
            continue;
        };
        let keep_going = run_socket(&origin, &token, &control, &frames, &mixer, &mut target).await;
        if !keep_going {
            return;
        }
        if target.as_ref().is_some_and(|(o, t)| o == &origin && t == &token) {
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
    }
}

async fn run_socket(
    origin: &Url,
    token: &str,
    control: &Receiver<Control>,
    frames: &Receiver<Vec<u8>>,
    mixer: &Arc<Mutex<Mixer>>,
    target: &mut Option<(Url, String)>,
) -> bool {
    let Ok(mut ws_url) = origin.join("api/voice") else {
        return true;
    };
    let scheme = match ws_url.scheme() {
        "https" => "wss",
        _ => "ws",
    };
    if ws_url.set_scheme(scheme).is_err() {
        return true;
    }
    let Ok(mut request) = ws_url.as_str().into_client_request() else {
        return true;
    };
    let Ok(origin_header) = origin.origin().ascii_serialization().parse() else {
        return true;
    };
    request.headers_mut().insert("Origin", origin_header);
    let Ok((mut socket, _)) = tokio_tungstenite::connect_async_with_config(
        request,
        Some(
            tokio_tungstenite::tungstenite::protocol::WebSocketConfig::default()
                .max_message_size(Some(2048))
                .max_frame_size(Some(2048)),
        ),
        true,
    )
    .await
    else {
        return true;
    };
    if socket
        .send(Message::Text(
            json!({"type":"authenticate","token":token})
                .to_string()
                .into(),
        ))
        .await
        .is_err()
    {
        return true;
    }
    let mut ping_at = tokio::time::Instant::now() + Duration::from_secs(15);
    loop {
        tokio::select! {
            message = socket.next() => match message {
                Some(Ok(Message::Binary(bytes))) => {
                    if let Some((speaker, _seq, samples)) = unpack_server_frame(&bytes) {
                        mixer.lock().unwrap().push(speaker, &samples, Instant::now());
                    }
                }
                Some(Ok(Message::Close(_))) | Some(Err(_)) | None => return true,
                Some(Ok(_)) => {}
            },
            _ = tokio::time::sleep(Duration::from_millis(5)) => {
                if let Ok(cmd) = control.try_recv() {
                    match cmd {
                        Control::Connect(next_origin, next_token) => {
                            *target = Some((next_origin, next_token));
                            let _ = socket.close(None).await;
                            return true;
                        }
                        Control::Disconnect => {
                            *target = None;
                            let _ = socket.close(None).await;
                            return true;
                        }
                        Control::Stop => {
                            let _ = socket.close(None).await;
                            return false;
                        }
                    }
                }
                for _ in 0..8 {
                    let Ok(frame) = frames.try_recv() else { break; };
                    if socket.send(Message::Binary(frame.into())).await.is_err() {
                        return true;
                    }
                }
                if tokio::time::Instant::now() >= ping_at {
                    ping_at = tokio::time::Instant::now() + Duration::from_secs(15);
                    if socket.send(Message::Text(json!({"type":"ping"}).to_string().into())).await.is_err() {
                        return true;
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mulaw_codec_round_trips_silence_and_wave() {
        assert_eq!(encode_mulaw_sample(0.0), 0xff);
        assert!(decode_mulaw_sample(0xff).abs() < 0.005);
        for i in 0..VOICE_FRAME_SAMPLES {
            let input = ((i as f32) * 0.15).sin() * 0.6;
            let decoded = decode_mulaw_sample(encode_mulaw_sample(input));
            assert!((input - decoded).abs() < 0.03);
        }
    }

    #[test]
    fn wire_frame_round_trip_and_validation() {
        let mulaw = vec![encode_mulaw_sample(0.25); VOICE_FRAME_SAMPLES];
        let client = pack_client_frame(17, &mulaw).unwrap();
        assert_eq!(client.len(), 4 + VOICE_FRAME_SAMPLES);
        let mut server = Vec::with_capacity(2 + client.len());
        server.push(4);
        server.push(0);
        server.extend_from_slice(&client);

        let (speaker, seq, samples) = unpack_server_frame(&server).unwrap();
        assert_eq!(speaker, 4);
        assert_eq!(seq, 17);
        assert_eq!(samples.len(), VOICE_FRAME_SAMPLES);
        assert!((samples[0] - 0.25).abs() < 0.03);
        assert!(unpack_server_frame(&server[..server.len() - 1]).is_none());
    }

    #[test]
    fn mixer_mixes_unmuted_speakers_and_respects_mute() {
        let mut mixer = Mixer::default();
        let now = Instant::now();
        mixer.push(1, &vec![0.2; VOICE_FRAME_SAMPLES], now);
        mixer.push(2, &vec![0.3; VOICE_FRAME_SAMPLES], now);
        assert_eq!(mixer.active_speakers(now), vec![1, 2]);
        let mixed = mixer.mix_frame(VOICE_SAMPLE_RATE);
        assert!(mixed > 0.1);

        mixer.toggle_mute(2);
        assert!(mixer.is_muted(2));
        assert_eq!(mixer.active_speakers(now), vec![1]);
    }
}
