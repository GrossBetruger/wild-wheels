use serde_json::{json, Value};
use std::time::Instant;
use crate::room::CAPACITY;
use wild_wheels_core::{Frame, Input, Move, NativeArena};
pub fn run() {
    let config: Value = json!({"code":"00","maxPlayers":CAPACITY,"arena":0,"bots":0,"dedicated":true,"host":null,"epoch":1,"seed":123,"players":(0..CAPACITY).map(|id|json!({"id":id,"name":format!("Player {id}"),"driver":id%15,"role":"driver"})).collect::<Vec<_>>()});
    let mut game = NativeArena::new(config).unwrap();
    game.start();
    let mut samples = Vec::new();
    let mut bytes = 0;
    for step in 0..3600 {
        let inputs = (0..CAPACITY)
            .map(|actor| {
                let keys = 33
                    | match (step / 180 + actor) % 3 {
                        0 => 4,
                        1 => 8,
                        _ => 16,
                    };
                Input {
                    actor,
                    keys,
                    moves: Some(vec![Move {
                        sequence: step as i64,
                        keys: keys & 31,
                        steer: None,
                    }]),
                    sequence: Some(step as i64),
                    ..Input::default()
                }
            })
            .collect();
        let start = Instant::now();
        game.step(Frame {
            dt: 1.0 / 60.0,
            inputs,
        })
        .unwrap();
        if step % 2 == 0 {
            for id in 0..CAPACITY {
                bytes += game.packet(id).len();
            }
            game.drain();
        }
        if step >= 600 {
            samples.push(start.elapsed().as_secs_f64() * 1000.0);
        }
    }
    samples.sort_by(f64::total_cmp);
    println!(
        "{}",
        json!({"runtime":"native","ticks":3600,"players":CAPACITY,"medianMs":samples[samples.len()/2],"p95Ms":samples[samples.len()*95/100],"p99Ms":samples[samples.len()*99/100],"maxMs":samples.last(),"bytes":bytes,"final":game.snapshot(7)["world"]})
    );
}
