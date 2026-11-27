//! Browser WebSocket transport owned directly by the WASM module (`web_sys::WebSocket`).
//! Handles authentication, binary snapshot ingestion, outbound input sending, and ping/pong RTT.

use std::cell::RefCell;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use wasm_bindgen::closure::Closure;
use wasm_bindgen::JsCast;
use web_sys::{BinaryType, CloseEvent, ErrorEvent, MessageEvent, WebSocket};

struct SocketState {
    id: u64,
    ws: WebSocket,
    last_ping: f64,
    _on_open: Closure<dyn FnMut()>,
    _on_message: Closure<dyn FnMut(MessageEvent)>,
    _on_close: Closure<dyn FnMut(CloseEvent)>,
    _on_error: Closure<dyn FnMut(ErrorEvent)>,
}

thread_local! {
    static SOCKET: RefCell<Option<SocketState>> = const { RefCell::new(None) };
}

static NEXT_ID: AtomicU64 = AtomicU64::new(1);
static RTT_BITS: AtomicU64 = AtomicU64::new(0);
static LAST_PACKET_MS_BITS: AtomicU64 = AtomicU64::new(0);
static CLOSED_EVENT: Mutex<Option<String>> = Mutex::new(None);
static LATEST_UI_PACKET: Mutex<Option<Vec<u8>>> = Mutex::new(None);

pub fn is_connected() -> bool {
    SOCKET.with(|slot| slot.borrow().is_some())
}

pub fn can_send() -> bool {
    SOCKET.with(|slot| {
        slot.borrow()
            .as_ref()
            .is_some_and(|s| s.ws.ready_state() == WebSocket::OPEN && s.ws.buffered_amount() <= 16384)
    })
}

pub fn rtt_secs() -> f64 {
    f64::from_bits(RTT_BITS.load(Ordering::Relaxed))
}

pub fn last_packet_ms() -> f64 {
    f64::from_bits(LAST_PACKET_MS_BITS.load(Ordering::Relaxed))
}

pub fn take_closed_json() -> String {
    CLOSED_EVENT
        .lock()
        .ok()
        .and_then(|mut slot| slot.take())
        .unwrap_or_default()
}

pub fn take_latest_packet() -> Vec<u8> {
    LATEST_UI_PACKET
        .lock()
        .ok()
        .and_then(|mut slot| slot.take())
        .unwrap_or_default()
}

pub fn disconnect() {
    SOCKET.with(|slot| {
        if let Some(state) = slot.borrow_mut().take() {
            state.ws.set_onopen(None);
            state.ws.set_onmessage(None);
            state.ws.set_onclose(None);
            state.ws.set_onerror(None);
            let _ = state.ws.close();
        }
    });
    RTT_BITS.store(0f64.to_bits(), Ordering::Relaxed);
    LAST_PACKET_MS_BITS.store(0f64.to_bits(), Ordering::Relaxed);
    if let Ok(mut slot) = CLOSED_EVENT.lock() {
        *slot = None;
    }
    if let Ok(mut slot) = LATEST_UI_PACKET.lock() {
        *slot = None;
    }
}

pub fn connect(url: &str, token: &str, client_type: &str) -> bool {
    disconnect();
    let Ok(ws) = WebSocket::new(url) else {
        return false;
    };
    ws.set_binary_type(BinaryType::Arraybuffer);
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);

    let auth_msg = serde_json::json!({
        "type": "authenticate",
        "token": token,
        "client": client_type,
    })
    .to_string();
    let ws_open = ws.clone();
    let on_open = Closure::<dyn FnMut()>::new(move || {
        let _ = ws_open.send_with_str(&auth_msg);
    });

    let ws_msg = ws.clone();
    let on_message = Closure::<dyn FnMut(MessageEvent)>::new(move |event: MessageEvent| {
        let active = SOCKET.with(|slot| slot.borrow().as_ref().is_some_and(|s| s.id == id));
        if !active {
            return;
        }
        let data = event.data();
        if let Ok(buf) = data.clone().dyn_into::<js_sys::ArrayBuffer>() {
            let bytes = js_sys::Uint8Array::new(&buf).to_vec();
            LAST_PACKET_MS_BITS.store(js_sys::Date::now().to_bits(), Ordering::Relaxed);
            if let Ok(mut latest) = LATEST_UI_PACKET.lock() {
                *latest = Some(bytes.clone());
            }
            crate::enqueue_incoming_packet(bytes);
            return;
        }
        if let Some(text) = data.as_string()
            && text.len() <= 2048
            && let Ok(val) = serde_json::from_str::<serde_json::Value>(&text)
            && val.get("type").and_then(|v| v.as_str()) == Some("pong")
            && let Some(sent) = val.get("sent").and_then(|v| v.as_f64())
        {
            let matched = SOCKET.with(|slot| {
                slot.borrow()
                    .as_ref()
                    .is_some_and(|s| s.id == id && (s.last_ping - sent).abs() < 1e-6)
            });
            if matched {
                let now = js_sys::Date::now() / 1000.0;
                let rtt = (now - sent).clamp(0.0, 0.3);
                RTT_BITS.store(rtt.to_bits(), Ordering::Relaxed);
            }
            return;
        }
        let _ = ws_msg.close();
    });

    let on_close = Closure::<dyn FnMut(CloseEvent)>::new(move |event: CloseEvent| {
        let was_active = SOCKET.with(|slot| {
            let matches = slot.borrow().as_ref().is_some_and(|s| s.id == id);
            if matches {
                slot.borrow_mut().take();
            }
            matches
        });
        if was_active
            && let Ok(mut slot) = CLOSED_EVENT.lock()
        {
            *slot = Some(
                serde_json::json!({
                    "code": event.code(),
                    "reason": event.reason(),
                    "clean": event.was_clean(),
                })
                .to_string(),
            );
        }
    });

    let on_error = Closure::<dyn FnMut(ErrorEvent)>::new(move |_event: ErrorEvent| {});

    ws.set_onopen(Some(on_open.as_ref().unchecked_ref()));
    ws.set_onmessage(Some(on_message.as_ref().unchecked_ref()));
    ws.set_onclose(Some(on_close.as_ref().unchecked_ref()));
    ws.set_onerror(Some(on_error.as_ref().unchecked_ref()));

    SOCKET.with(|slot| {
        *slot.borrow_mut() = Some(SocketState {
            id,
            ws,
            last_ping: f64::NEG_INFINITY,
            _on_open: on_open,
            _on_message: on_message,
            _on_close: on_close,
            _on_error: on_error,
        });
    });
    true
}

/// Sends an outbound input frame (and periodic 1s ping) directly over the Rust-owned WebSocket.
pub fn send_if_ready(text: &str) {
    SOCKET.with(|slot| {
        let mut guard = slot.borrow_mut();
        let Some(state) = guard.as_mut() else {
            return;
        };
        if state.ws.ready_state() != WebSocket::OPEN || state.ws.buffered_amount() > 16384 {
            return;
        }
        let now = js_sys::Date::now() / 1000.0;
        if now - state.last_ping >= 1.0 {
            state.last_ping = now;
            let ping = format!("{{\"type\":\"ping\",\"sent\":{now}}}");
            let _ = state.ws.send_with_str(&ping);
        }
        let _ = state.ws.send_with_str(text);
    });
}
