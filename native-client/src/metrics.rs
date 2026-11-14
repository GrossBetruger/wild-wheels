//! Bounded diagnostic samples; no network or rendering policy lives here.
use serde_json::{Value, json};
use std::collections::VecDeque;

#[derive(Default)]
pub struct Metrics {
    frames: Vec<f64>,
    acknowledgements: Vec<f64>,
    pending: VecDeque<(i64, f64)>,
    last_sent: i64,
    connections: u64,
}
impl Metrics {
    pub fn connected(&mut self) {
        self.pending.clear();
        self.last_sent = -1;
        self.connections += 1;
    }
    pub fn inactive(&mut self) {
        self.pending.clear();
    }
    pub fn frame(&mut self, microseconds: f64, now: f64) {
        if now >= 1.0 && self.frames.len() < 18000 {
            self.frames.push(microseconds);
        }
    }
    pub fn sent(&mut self, sequence: i64, now: f64) {
        if sequence < self.last_sent {
            self.pending.clear();
            self.last_sent = -1;
        }
        if sequence <= self.last_sent {
            return;
        }
        self.last_sent = sequence;
        self.pending.push_back((sequence, now));
        while self.pending.len() > 128 {
            self.pending.pop_front();
        }
    }
    pub fn acknowledged(&mut self, sequence: i64, now: f64) {
        while self
            .pending
            .front()
            .is_some_and(|(sent, _)| *sent <= sequence)
        {
            let (_, at) = self.pending.pop_front().unwrap();
            if self.acknowledgements.len() < 18000 {
                self.acknowledgements.push((now - at).max(0.0) * 1000.0);
            }
        }
    }
    pub fn report(&self) -> Value {
        fn summary(values: &[f64]) -> Value {
            let mut values = values.to_vec();
            values.sort_by(f64::total_cmp);
            let q = |fraction: f64| {
                values
                    .get((values.len().saturating_sub(1) as f64 * fraction) as usize)
                    .copied()
            };
            json!({"samples":values.len(),"p50":q(0.5),"p95":q(0.95),"p99":q(0.99)})
        }
        json!({"connections":self.connections,"clientAdvanceUs":summary(&self.frames),"movementAcknowledgementMs":summary(&self.acknowledgements),"acknowledgementNote":"Samples exclude intervals across death, inactive play, and reconnection.","gpuExecutionUs":null,"gpuNote":"GPU execution was not measured by this headless transport test."})
    }
}
