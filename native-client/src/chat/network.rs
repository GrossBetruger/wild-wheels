//! Runs independently of game sockets: a slow chat request cannot stall driving.
use super::Response;
use crossbeam_channel::{Receiver, Sender, bounded};
use serde_json::{Value, json};
use std::time::Duration;

pub enum Event {
    Reply {
        response: Response,
        action: bool,
        sent: bool,
    },
    Error {
        message: String,
        action: bool,
    },
}
pub struct Worker {
    pub commands: Sender<Value>,
    pub events: Receiver<Event>,
}
impl Worker {
    pub fn spawn(origin: url::Url, token: String) -> Self {
        let (tx, commands) = bounded(4);
        let (events, rx) = bounded(8);
        std::thread::Builder::new()
            .name("arena-chat".into())
            .spawn(move || {
                let runtime = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build();
                match runtime {
                    Ok(runtime) => runtime.block_on(run(origin, token, commands, events)),
                    Err(error) => {
                        let _ = events.try_send(Event::Error {
                            message: error.to_string(),
                            action: false,
                        });
                    }
                }
            })
            .expect("could not start chat worker");
        Self {
            commands: tx,
            events: rx,
        }
    }
}
async fn run(origin: url::Url, token: String, commands: Receiver<Value>, events: Sender<Event>) {
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .redirect(reqwest::redirect::Policy::none())
        .build()
    {
        Ok(client) => client,
        Err(_) => return,
    };
    let url = match origin.join("api/chat") {
        Ok(url) => url,
        Err(_) => return,
    };
    let mut cursor = 0;
    let mut players = Vec::new();
    let mut next = tokio::time::Instant::now();
    loop {
        let action = match commands.try_recv() {
            Ok(action) => Some(action),
            Err(crossbeam_channel::TryRecvError::Disconnected) => return,
            Err(crossbeam_channel::TryRecvError::Empty) => None,
        };
        if action.is_none() && tokio::time::Instant::now() < next {
            tokio::time::sleep(Duration::from_millis(20)).await;
            continue;
        }
        let sending = action.as_ref().is_some_and(|a| a.get("text").is_some());
        let mutation = action.is_some();
        let mut request = action.unwrap_or_else(|| json!({}));
        request["after"] = json!(cursor);
        let result = async {
            let reply = client
                .post(url.clone())
                .header("Origin", origin.origin().ascii_serialization())
                .bearer_auth(&token)
                .json(&request)
                .send()
                .await
                .map_err(|e| e.to_string())?;
            let value = crate::transport::body(reply)
                .await
                .map_err(|e| e.to_string())?;
            Response::parse(value)
        }
        .await;
        let succeeded = result.is_ok();
        match result {
            Ok(response) => {
                cursor = match response.players == players {
                    true => response.cursor,
                    false => 0,
                };
                players = response.players.clone();
                if events
                    .try_send(Event::Reply {
                        response,
                        action: mutation,
                        sent: sending,
                    })
                    .is_err()
                {
                    return;
                }
            }
            Err(message) => {
                if events
                    .try_send(Event::Error {
                        message,
                        action: mutation,
                    })
                    .is_err()
                {
                    return;
                }
            }
        }
        next = tokio::time::Instant::now()
            + Duration::from_millis(match succeeded {
                true => 500,
                false => 2000,
            });
    }
}
