use crate::{error, limit, security::same_origin, App};
use axum::{
    body::Bytes,
    extract::{
        ws::{Message, WebSocket},
        ConnectInfo, State, WebSocketUpgrade,
    },
    http::{header, HeaderMap},
    response::Response,
};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    net::SocketAddr,
    time::{Duration, Instant},
};
use tokio::{sync::mpsc, time::timeout};

/// Maximum incoming WebSocket frame size (4-byte header + up to 960 1-byte µ-law samples + margin).
pub const MAX_MESSAGE_BYTES: usize = 1024;
const HEADER_IN: usize = 4;
const MIN_SAMPLES: usize = 160;
const MAX_SAMPLES: usize = 960;
const QUEUE_DEPTH: usize = 16;
const MAX_FRAMES_PER_SEC: u32 = 75;

struct Peer {
    generation: u64,
    tx: mpsc::Sender<Bytes>,
}

#[derive(Default)]
pub struct VoiceHub {
    next_generation: u64,
    peers: HashMap<usize, Peer>,
}

impl VoiceHub {
    pub fn register(&mut self, id: usize, tx: mpsc::Sender<Bytes>) -> u64 {
        self.next_generation = self.next_generation.wrapping_add(1);
        let generation = self.next_generation;
        self.peers.insert(id, Peer { generation, tx });
        generation
    }

    pub fn unregister(&mut self, id: usize, generation: u64) {
        if self.peers.get(&id).is_some_and(|p| p.generation == generation) {
            self.peers.remove(&id);
        }
    }

    pub fn disconnect(&mut self, id: usize) {
        self.peers.remove(&id);
    }

    /// Validates an incoming client voice frame (`seq: u16 LE`, `count: u16 LE`, `count` µ-law bytes)
    /// and relays it to all other connected peers in the room prefixed with `[speaker_id, flags]`.
    pub fn relay(
        &mut self,
        sender_id: usize,
        generation: u64,
        payload: &[u8],
    ) -> Result<usize, &'static str> {
        if self
            .peers
            .get(&sender_id)
            .is_none_or(|peer| peer.generation != generation)
        {
            return Err("replaced by a newer voice connection");
        }
        let Ok(speaker) = u8::try_from(sender_id) else {
            return Err("invalid speaker slot");
        };
        if payload.len() < HEADER_IN + MIN_SAMPLES || payload.len() > HEADER_IN + MAX_SAMPLES {
            return Err("invalid voice frame size");
        }
        let sample_count = usize::from(u16::from_le_bytes([payload[2], payload[3]]));
        if !(MIN_SAMPLES..=MAX_SAMPLES).contains(&sample_count)
            || payload.len() != HEADER_IN + sample_count
        {
            return Err("voice frame sample count mismatch");
        }
        let mut out = Vec::with_capacity(2 + payload.len());
        out.push(speaker);
        out.push(0u8); // flags
        out.extend_from_slice(payload);
        let packet = Bytes::from(out);
        let mut delivered = 0usize;
        for (&peer_id, peer) in &self.peers {
            if peer_id == sender_id {
                continue;
            }
            if peer.tx.try_send(packet.clone()).is_ok() {
                delivered += 1;
            }
        }
        Ok(delivered)
    }
}

pub async fn upgrade(
    State(app): State<App>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    h: HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    if !h.contains_key(header::ORIGIN) || !same_origin(&app, &h, addr.ip()) {
        app.logs.note("warn", "voice-refused", json!({"reason":"origin"}));
        return error((403, "Use the game from the same server."));
    }
    if !limit(&app, addr.ip(), "voice", 16, Duration::from_secs(1)) {
        return error((429, "Too many connections."));
    }
    let Ok(permit) = app.voice_sockets.clone().try_acquire_owned() else {
        app.logs.note("warn", "voice-refused", json!({"reason":"capacity"}));
        return error((503, "Too many connections."));
    };
    ws.max_message_size(MAX_MESSAGE_BYTES)
        .max_frame_size(MAX_MESSAGE_BYTES)
        .on_upgrade(move |socket| async move {
            let _permit = permit;
            connection(app, socket).await
        })
}

async fn connection(app: App, mut socket: WebSocket) {
    let mut shutdown = app.shutdown.subscribe();
    if *shutdown.borrow() {
        return;
    }
    let Ok(Some(Ok(Message::Text(text)))) = timeout(Duration::from_secs(3), socket.next()).await
    else {
        app.logs.note("warn", "voice-refused", json!({"reason":"auth-timeout"}));
        return;
    };
    let Ok(auth) = serde_json::from_str::<Value>(&text) else {
        app.logs.note("warn", "voice-refused", json!({"reason":"auth-json"}));
        return;
    };
    if auth["type"] != "authenticate" {
        app.logs.note("warn", "voice-refused", json!({"reason":"auth-type"}));
        return;
    }
    let Some(token) = auth["token"].as_str() else {
        app.logs.note("warn", "voice-refused", json!({"reason":"auth-token"}));
        return;
    };
    let (id, who) = {
        let room = app.room.lock().unwrap();
        let Some(id) = room.find(token) else {
            app.logs.note("warn", "voice-refused", json!({"reason":"unknown-session"}));
            return;
        };
        (id, room.who(id))
    };
    let (tx, mut rx) = mpsc::channel::<Bytes>(QUEUE_DEPTH);
    let (generation, peers) = {
        let mut voice = app.voice.lock().unwrap();
        let generation = voice.register(id, tx);
        (generation, voice.peers.len())
    };
    app.logs.note("info", "voice-open", json!({"who":who,"peers":peers}));
    let (mut sink, mut stream) = socket.split();
    if !matches!(
        timeout(
            Duration::from_secs(2),
            sink.send(Message::Text(json!({"type":"ready","id":id}).to_string().into())),
        )
        .await,
        Ok(Ok(()))
    ) {
        app.voice.lock().unwrap().unregister(id, generation);
        return;
    }
    let (pong_tx, mut pong_rx) = mpsc::channel::<Message>(2);

    let writer = async move {
        loop {
            let message = tokio::select! {
                packet = rx.recv() => match packet {
                    Some(bytes) => Message::Binary(bytes),
                    None => break,
                },
                pong = pong_rx.recv() => match pong {
                    Some(msg) => msg,
                    None => break,
                },
            };
            if !matches!(
                timeout(Duration::from_secs(2), sink.send(message)).await,
                Ok(Ok(()))
            ) {
                break;
            }
        }
        "writer-closed"
    };

    let reader_app = app.clone();
    let reader = async move {
        let mut since = Instant::now();
        let mut frames = 0u32;
        let mut relayed: u64 = 0;
        let reason = loop {
            let message = match timeout(Duration::from_secs(45), stream.next()).await {
                Ok(Some(Ok(msg))) => msg,
                Ok(Some(Err(_))) => break "socket-error",
                Ok(None) => break "eof",
                Err(_) => break "idle-timeout",
            };
            match message {
                Message::Binary(data) => {
                    if since.elapsed() >= Duration::from_secs(1) {
                        since = Instant::now();
                        frames = 0;
                    }
                    frames += 1;
                    if frames > MAX_FRAMES_PER_SEC {
                        break "rate-limit";
                    }
                    if reader_app.room.lock().unwrap().find(token) != Some(id) {
                        break "session-rotated";
                    }
                    match reader_app.voice.lock().unwrap().relay(id, generation, &data) {
                        Ok(delivered) => {
                            if delivered > 0 {
                                relayed += 1;
                            }
                        }
                        Err(reason) => break reason,
                    }
                }
                Message::Text(text) => {
                    let Ok(body) = serde_json::from_str::<Value>(&text) else {
                        break "bad-text";
                    };
                    if body["type"] != "ping" {
                        break "unknown-text";
                    }
                    if reader_app.room.lock().unwrap().find(token) != Some(id) {
                        break "session-rotated";
                    }
                    let _ = pong_tx.try_send(Message::Text(json!({"type":"pong"}).to_string().into()));
                }
                Message::Ping(_) | Message::Pong(_) => {}
                Message::Close(_) => break "client-close",
            }
        };
        (reason, relayed)
    };

    let (reason, relayed) = tokio::select! {
        reason = writer => (reason, 0u64),
        res = reader => res,
        _ = shutdown.changed() => ("shutdown", 0u64),
    };
    app.voice.lock().unwrap().unregister(id, generation);
    app.logs.note(
        "info",
        "voice-closed",
        json!({"who":who,"reason":reason,"relayedFrames":relayed}),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(seq: u16, samples: usize, fill: u8) -> Vec<u8> {
        let mut buf = Vec::with_capacity(4 + samples);
        buf.extend_from_slice(&seq.to_le_bytes());
        buf.extend_from_slice(&(samples as u16).to_le_bytes());
        buf.resize(4 + samples, fill);
        buf
    }

    #[test]
    fn voice_hub_relays_valid_frames_only_to_other_peers() {
        let mut hub = VoiceHub::default();
        let (tx0, mut rx0) = mpsc::channel(4);
        let (tx1, mut rx1) = mpsc::channel(4);
        let (tx2, mut rx2) = mpsc::channel(4);
        let g0 = hub.register(0, tx0);
        let _g1 = hub.register(1, tx1);
        let _g2 = hub.register(2, tx2);

        let payload = frame(7, 320, 0xab);
        assert_eq!(hub.relay(0, g0, &payload), Ok(2));
        assert!(rx0.try_recv().is_err(), "sender must not receive its own voice");
        for rx in [&mut rx1, &mut rx2] {
            let received = rx.try_recv().unwrap();
            assert_eq!(received.len(), 6 + 320);
            assert_eq!(received[0], 0);
            assert_eq!(received[1], 0);
            assert_eq!(u16::from_le_bytes([received[2], received[3]]), 7);
            assert_eq!(u16::from_le_bytes([received[4], received[5]]), 320);
            assert!(received[6..].iter().all(|&b| b == 0xab));
        }
    }

    #[test]
    fn voice_hub_rejects_malformed_frames_and_stale_generations() {
        let mut hub = VoiceHub::default();
        let (tx0, _rx0) = mpsc::channel(4);
        let g0 = hub.register(0, tx0);

        assert!(hub.relay(0, g0, &[0, 0]).is_err());
        assert!(hub.relay(0, g0, &frame(1, 100, 0xff)).is_err());
        assert!(hub.relay(0, g0, &frame(1, 961, 0xff)).is_err());
        let mut bad = frame(1, 320, 0xff);
        bad.pop();
        assert!(hub.relay(0, g0, &bad).is_err());

        // Replacing peer 0 invalidates its previous generation.
        let (tx0_new, _rx0_new) = mpsc::channel(4);
        let g0_new = hub.register(0, tx0_new);
        assert!(hub.relay(0, g0, &frame(2, 320, 0xff)).is_err());
        assert_eq!(hub.relay(0, g0_new, &frame(2, 320, 0xff)), Ok(0));
    }

    #[test]
    fn voice_hub_drops_frames_when_a_receiver_queue_is_full() {
        let mut hub = VoiceHub::default();
        let (tx0, _rx0) = mpsc::channel(2);
        let (tx1, mut rx1) = mpsc::channel(1);
        let g0 = hub.register(0, tx0);
        let _g1 = hub.register(1, tx1);

        assert_eq!(hub.relay(0, g0, &frame(1, 320, 0x11)), Ok(1));
        assert_eq!(hub.relay(0, g0, &frame(2, 320, 0x22)), Ok(0));
        let first = rx1.try_recv().unwrap();
        assert_eq!(u16::from_le_bytes([first[2], first[3]]), 1);
    }
}
