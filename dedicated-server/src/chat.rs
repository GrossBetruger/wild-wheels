use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, VecDeque},
    io::{self, Read},
    path::Path,
    time::{Instant, SystemTime, UNIX_EPOCH},
};

// Room slot, stable identity, display name, and session chat color.
type Player = (usize, String, String, Option<String>);

enum ChatAction<'a> {
    Poll,
    Send {
        text: &'a str,
        to: Option<usize>,
        reply_to: Option<u64>,
    },
    Delete {
        message_id: u64,
    },
}

impl<'a> ChatAction<'a> {
    fn parse(body: &'a Value) -> crate::room::Result<Self> {
        match (body.get("text"), body.get("deleteId")) {
            (Some(_), Some(_)) => Err((400, "Choose one chat action.")),
            (_, Some(value)) => Ok(Self::Delete {
                message_id: value.as_u64().ok_or((404, "Message unavailable."))?,
            }),
            (Some(value), None) => {
                let text = value
                    .as_str()
                    .filter(|s| !s.trim().is_empty() && s.encode_utf16().count() <= 500)
                    .ok_or((400, "Enter a message of 1–500 characters."))?;
                let to = body
                    .get("to")
                    .filter(|v| !v.is_null())
                    .map(|value| {
                        value
                            .as_u64()
                            .and_then(|n| usize::try_from(n).ok())
                            .ok_or((400, "Choose another player who is still in the room."))
                    })
                    .transpose()?;
                let reply_to = body
                    .get("replyTo")
                    .filter(|v| !v.is_null())
                    .map(|value| {
                        value
                            .as_u64()
                            .ok_or((400, "That message is unavailable in this conversation."))
                    })
                    .transpose()?;
                Ok(Self::Send { text, to, reply_to })
            }
            (None, None) => Ok(Self::Poll),
        }
    }
}

#[derive(Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Chat {
    sequence: u64,
    messages: VecDeque<(String, Option<String>, Value)>,
    #[serde(skip)]
    sent: HashMap<String, Instant>,
}
impl Chat {
    pub fn open(path: &Path) -> io::Result<Self> {
        let file = match std::fs::File::open(path) {
            Ok(file) => file,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Self::default()),
            Err(error) => return Err(error),
        };
        // Bound allocation before parsing, including malformed or manually edited files.
        const MAX_BYTES: u64 = 2 * 1024 * 1024;
        let mut bytes = Vec::new();
        file.take(MAX_BYTES + 1).read_to_end(&mut bytes)?;
        if bytes.len() as u64 > MAX_BYTES {
            return Err(io::Error::other("Saved chat is too large"));
        }
        let chat: Self = serde_json::from_slice(&bytes).map_err(io::Error::other)?;
        let key = |s: &str| s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit());
        let text = |v: &Value, limit| v.as_str().is_some_and(|s| s.encode_utf16().count() <= limit);
        let color = |m: &Value| m.get("color").is_none_or(|v| v.as_str().is_some_and(|s| s.len() == 7 && s.starts_with('#') && s.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)));
        let cursor = |v: &Value| v.as_u64().is_some_and(|n| n > 0 && n <= chat.sequence);
        if chat.sequence > 9_007_199_254_740_991 || chat.messages.len() > 200
            || chat.messages.iter().any(|(from, to, m)| {
                !key(from) || to.as_ref().is_some_and(|s| !key(s))
                    || !cursor(&m["id"]) || m.get("updated").is_some_and(|v| !cursor(v))
                    || !text(&m["name"], 24) || !text(&m["text"], 500) || !color(m)
                    || m["from"].as_u64().is_none_or(|n| n >= 8)
                    || (to.is_some() && (m["to"].as_u64().is_none_or(|n| n >= 8) || !text(&m["toName"], 24)))
                    || (to.is_none() && !m["to"].is_null())
                    || m["time"].as_u64().is_none()
                    || (!m["reply"].is_null() && (!cursor(&m["reply"]["id"]) || !text(&m["reply"]["name"], 24) || !text(&m["reply"]["text"], 500) || !color(&m["reply"])))
            }) {
            return Err(io::Error::other("Invalid saved chat"));
        }
        Ok(chat)
    }

    pub fn save(&self, path: &Path) -> io::Result<()> {
        let bytes = serde_json::to_vec(self).map_err(io::Error::other)?;
        // Reuse the session store's atomic replacement and 0600 permissions.
        crate::sessions::write(path, &bytes)
    }

    pub fn exchange(
        &mut self,
        id: usize,
        players: &[Player],
        body: &Value,
    ) -> crate::room::Result<Value> {
        let after = match body.get("after") {
            None => 0,
            Some(value) => value
                .as_u64()
                .filter(|v| *v <= 9_007_199_254_740_991)
                .ok_or((400, "Invalid chat cursor."))?,
        };
        let sender = players
            .iter()
            .find(|p| p.0 == id)
            .ok_or((401, "Rejoin the room to reconnect."))?;
        match ChatAction::parse(body)? {
            ChatAction::Poll => {}
            ChatAction::Send { text, to, reply_to } => {
                self.send_message(sender, players, text, to, reply_to)?;
            }
            ChatAction::Delete { message_id } => self.delete_message(sender, message_id)?,
        }
        Ok(self.build_response(sender, players, after))
    }

    fn delete_message(&mut self, sender: &Player, message_id: u64) -> crate::room::Result<()> {
        let index = self
            .messages
            .iter()
            .position(|(_, _, m)| m["id"].as_u64() == Some(message_id))
            .ok_or((404, "Message unavailable."))?;
        if self.messages[index].0 != sender.1 {
            return Err((404, "Message unavailable."));
        }
        if self.messages[index].2["deleted"] != true {
            self.sequence += 1;
            let target = &mut self.messages[index].2;
            target["deleted"] = json!(true);
            target["text"] = json!("");
            target["reply"] = Value::Null;
            target["updated"] = json!(self.sequence);
            let id = target["id"].clone();
            let name = target["name"].clone();
            for (_, _, message) in self.messages.iter_mut() {
                if message["reply"].is_object() && message["reply"]["id"] == id {
                    self.sequence += 1;
                    message["reply"] = json!({"id":id,"name":name,"text":"","deleted":true});
                    message["updated"] = json!(self.sequence);
                }
            }
        }
        Ok(())
    }

    fn send_message(
        &mut self,
        sender: &Player,
        players: &[Player],
        text: &str,
        to: Option<usize>,
        reply_to: Option<u64>,
    ) -> crate::room::Result<()> {
        let recipient = match to {
            None => None,
            Some(to) => Some(
                players
                    .iter()
                    .find(|p| p.0 == to && to != sender.0)
                    .ok_or((400, "Choose another player who is still in the room."))?,
            ),
        };
        let reply = match reply_to {
            None => Value::Null,
            Some(reply_id) => {
                let original = self
                    .messages
                    .iter()
                    .find(|(_, _, m)| m["id"].as_u64() == Some(reply_id))
                    .filter(|(_, _, m)| m["deleted"] != true)
                    .filter(|(from, to, _)| match recipient {
                        None => to.is_none(),
                        Some(peer) => {
                            (from == &sender.1 && to.as_ref() == Some(&peer.1))
                                || (from == &peer.1 && to.as_ref() == Some(&sender.1))
                        }
                    })
                    .ok_or((400, "That message is unavailable in this conversation."))?;
                {
                    let mut quote = json!({"id":original.2["id"],"name":original.2["name"],"text":original.2["text"]});
                    if let Some(color) = original.2.get("color") {
                        quote["color"] = color.clone();
                    }
                    quote
                }
            }
        };
        if self
            .sent
            .get(&sender.1)
            .is_some_and(|last| last.elapsed().as_millis() < 500)
        {
            return Err((429, "Please wait a moment before sending another message."));
        }
        self.sent
            .retain(|token, _| players.iter().any(|p| &p.1 == token));
        self.sent.insert(sender.1.clone(), Instant::now());
        self.sequence += 1;
        let mut message = json!({"id":self.sequence,"from":sender.0,"name":sender.2,"to":recipient.map(|p|p.0),"toName":recipient.map(|p|&p.2),"text":text.trim(),"reply":reply,"time":SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64});
        if let Some(color) = &sender.3 {
            message["color"] = json!(color);
        }
        self.messages
            .push_back((sender.1.clone(), recipient.map(|p| p.1.clone()), message));
        if self.messages.len() > 200 {
            self.messages.pop_front();
        }
        Ok(())
    }

    fn build_response(&self, sender: &Player, players: &[Player], after: u64) -> Value {
        let messages: Vec<_> = self
            .messages
            .iter()
            .filter(|(from, to, message)| {
                message
                    .get("updated")
                    .unwrap_or(&message["id"])
                    .as_u64()
                    .unwrap()
                    > after
                    && (to.is_none() || from == &sender.1 || to.as_ref() == Some(&sender.1))
            })
            .map(|(from, to, message)| {
                let mut message = message.clone();
                // Slots can change after reconnect/restart; identities do not.
                let slot = |identity: &str| {
                    players
                        .iter()
                        .find(|p| p.1 == identity)
                        .map_or(json!(-1), |p| json!(p.0))
                };
                message["from"] = slot(from);
                if let Some(to) = to {
                    message["to"] = slot(to);
                }
                message
            })
            .collect();
        json!({"you":sender.0,"players":players.iter().map(|p|json!({"id":p.0,"name":p.2,"color":p.3})).collect::<Vec<_>>(),"cursor":self.sequence,"messages":messages})
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn conflicting_or_malformed_actions_leave_chat_unchanged() {
        let mut chat = Chat::default();
        let players = players();
        chat.exchange(0, &players, &json!({"text":"Keep this"}))
            .unwrap();
        let before = serde_json::to_value(&chat).unwrap();
        for (body, status) in [
            (json!({"text":"Replace this","deleteId":1}), 400),
            (json!({"text":null,"deleteId":1}), 400),
            (json!({"deleteId":"1"}), 404),
            (json!({"text":false}), 400),
            (json!({"text":"Bad recipient","to":"1"}), 400),
            (json!({"text":"Bad reply","replyTo":false}), 400),
        ] {
            assert_eq!(chat.exchange(0, &players, &body).unwrap_err().0, status);
            assert_eq!(serde_json::to_value(&chat).unwrap(), before);
        }
    }

    #[test]
    fn poll_does_not_mutate_chat_and_actions_respect_the_cursor() {
        let mut chat = Chat::default();
        let players = players();
        chat.exchange(0, &players, &json!({"text":"First"}))
            .unwrap();
        let before = serde_json::to_value(&chat).unwrap();
        let poll = chat.exchange(1, &players, &json!({"after":1})).unwrap();
        assert_eq!(poll["messages"], json!([]));
        assert_eq!(poll["cursor"], 1);
        assert_eq!(serde_json::to_value(&chat).unwrap(), before);
        let sent = chat
            .exchange(1, &players, &json!({"text":"Second","after":1}))
            .unwrap();
        assert_eq!(sent["messages"].as_array().unwrap().len(), 1);
        assert_eq!(sent["messages"][0]["text"], "Second");
        let deleted = chat
            .exchange(0, &players, &json!({"deleteId":1,"after":2}))
            .unwrap();
        assert_eq!(deleted["messages"].as_array().unwrap().len(), 1);
        assert_eq!(deleted["messages"][0]["deleted"], true);
        let repeated = chat
            .exchange(0, &players, &json!({"deleteId":1,"after":3}))
            .unwrap();
        assert_eq!(repeated["cursor"], 3);
        assert_eq!(repeated["messages"], json!([]));
    }

    #[test]
    fn restart_preserves_text_replies_deletions_and_private_ownership_when_slots_change() {
        let path = std::env::temp_dir().join(format!("wild-wheels-chat-{}", crate::room::token())).join("chat.json");
        let alice = "a".repeat(64);
        let bob = "b".repeat(64);
        let stranger = "c".repeat(64);
        let players = vec![(0, alice.clone(), "Alice".into(), None), (1, bob.clone(), "Bob".into(), None)];
        let mut chat = super::Chat::default();
        let text = "\"},\"command\":\"$(touch /tmp/chat-must-not-execute)\" <script> & \\";
        chat.exchange(0, &players, &serde_json::json!({"text":text})).unwrap();
        chat.exchange(1, &players, &serde_json::json!({"text":"Secret", "to":0, "replyTo":null})).unwrap();
        chat.exchange(0, &players, &serde_json::json!({"deleteId":1})).unwrap();
        chat.save(&path).unwrap();
        let mut restored = super::Chat::open(&path).unwrap();
        let players = vec![(0, stranger, "Alice".into(), None), (3, bob, "Bob".into(), None), (5, alice, "Alice".into(), None)];
        let public = restored.exchange(0, &players, &serde_json::json!({})).unwrap();
        assert_eq!(public["messages"].as_array().unwrap().len(), 1);
        assert_eq!(public["messages"][0]["deleted"], true);
        let private = restored.exchange(5, &players, &serde_json::json!({})).unwrap();
        assert_eq!(private["messages"][1]["text"], "Secret");
        assert_eq!(private["messages"][1]["from"], 3);
        assert_eq!(private["messages"][1]["to"], 5);
        assert_eq!(restored.exchange(0, &players, &serde_json::json!({"deleteId":2})).unwrap_err().0, 404);
        let reply = restored.exchange(5, &players, &serde_json::json!({"text":text,"to":3,"replyTo":2})).unwrap();
        assert_eq!(reply["messages"][2]["reply"]["text"], "Secret");
        restored.save(&path).unwrap();
        let mut again = super::Chat::open(&path).unwrap();
        assert_eq!(again.exchange(3, &players, &serde_json::json!({})).unwrap()["messages"][2]["text"], text);
        #[cfg(unix)] {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        }
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn invalid_or_oversized_chat_is_rejected_without_overwriting_it() {
        let path = std::env::temp_dir().join(format!("wild-wheels-invalid-chat-{}", crate::room::token()));
        assert!(super::Chat::open(&path).is_ok());
        for bytes in [b"not json".to_vec(), b"{\"sequence\":0,\"messages\":[[\"bad identity\",null,{}]]}".to_vec(), vec![b' '; 2 * 1024 * 1024 + 1]] {
            std::fs::write(&path, &bytes).unwrap();
            assert!(super::Chat::open(&path).is_err());
            assert_eq!(std::fs::read(&path).unwrap(), bytes);
        }
        std::fs::remove_file(path).unwrap();
    }
    use super::*;
    #[test]
    fn replies_are_authoritative_and_stay_in_their_conversation() {
        let mut chat = Chat::default();
        let players = players();
        chat.exchange(0, &players, &json!({"text":"Secret question","to":1}))
            .unwrap();
        let response = chat
            .exchange(
                1,
                &players,
                &json!({"text":"Answer","to":0,"replyTo":1,"reply":{"text":"Forged"}}),
            )
            .unwrap();
        assert_eq!(
            response["messages"][1]["reply"],
            json!({"id":1,"name":"Alice","text":"Secret question"})
        );
        assert_eq!(
            chat.exchange(2, &players, &json!({"text":"Leak","to":0,"replyTo":1}))
                .unwrap_err()
                .0,
            400
        );
        assert_eq!(
            chat.exchange(0, &players, &json!({"text":"Public leak","replyTo":1}))
                .unwrap_err()
                .0,
            400
        );
        assert_eq!(
            chat.exchange(2, &players, &json!({"text":"Missing","replyTo":999}))
                .unwrap_err()
                .0,
            400
        );
    }
    #[test]
    fn deletion_is_sender_only_and_redacts_quotes_for_both_participants() {
        let mut chat = Chat::default();
        let players = players();
        chat.exchange(0, &players, &json!({"text":"Remove this","to":1}))
            .unwrap();
        chat.exchange(1, &players, &json!({"text":"Reply","to":0,"replyTo":1}))
            .unwrap();
        assert_eq!(
            chat.exchange(1, &players, &json!({"deleteId":1}))
                .unwrap_err()
                .0,
            404
        );
        let update = chat
            .exchange(0, &players, &json!({"deleteId":1,"after":2}))
            .unwrap();
        assert_eq!(update["messages"][0]["deleted"], true);
        assert_eq!(update["messages"][0]["text"], "");
        assert_eq!(update["messages"][1]["reply"]["deleted"], true);
        assert_eq!(update["messages"][1]["reply"]["text"], "");
        assert_eq!(
            chat.exchange(1, &players, &json!({"after":2})).unwrap()["messages"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        assert!(
            chat.exchange(2, &players, &json!({"after":2})).unwrap()["messages"]
                .as_array()
                .unwrap()
                .is_empty()
        );
    }
    fn players() -> Vec<(usize, String, String, Option<String>)> {
        vec![
            (0, "alice-token".into(), "Alice".into(), None),
            (1, "bob-token".into(), "Bob".into(), None),
            (2, "eve-token".into(), "Eve".into(), None),
        ]
    }
    #[test]
    fn private_messages_only_reach_the_two_sessions() {
        let mut chat = Chat::default();
        let mut players = players();
        let sent = chat
            .exchange(0, &players, &json!({"text":"Secret","to":1}))
            .unwrap();
        assert_eq!(sent["messages"].as_array().unwrap().len(), 1);
        assert_eq!(
            chat.exchange(1, &players, &json!({})).unwrap()["messages"][0]["text"],
            "Secret"
        );
        assert!(chat.exchange(2, &players, &json!({})).unwrap()["messages"]
            .as_array()
            .unwrap()
            .is_empty());
        players[1].1 = "replacement-token".into();
        assert!(chat.exchange(1, &players, &json!({})).unwrap()["messages"]
            .as_array()
            .unwrap()
            .is_empty());
    }
    #[test]
    fn public_messages_validation_and_rate_limit() {
        let mut chat = Chat::default();
        let players = players();
        for body in [
            json!({"text":" "}),
            json!({"text":"x","to":99}),
            json!({"text":"x","to":0}),
            json!({"after":-1}),
            json!({"text":"x".repeat(501)}),
        ] {
            assert_eq!(chat.exchange(0, &players, &body).unwrap_err().0, 400);
        }
        chat.exchange(0, &players, &json!({"text":"Hello everyone"}))
            .unwrap();
        assert_eq!(
            chat.exchange(2, &players, &json!({})).unwrap()["messages"][0]["text"],
            "Hello everyone"
        );
        assert_eq!(
            chat.exchange(0, &players, &json!({"text":"Again"}))
                .unwrap_err()
                .0,
            429
        );
        assert!(
            chat.exchange(1, &players, &json!({"after":1})).unwrap()["messages"]
                .as_array()
                .unwrap()
                .is_empty()
        );
    }
}

#[cfg(test)]
mod attack_tests {
    use super::*;
    #[test]
    fn injection_payloads_are_data_and_private_message_ids_do_not_grant_access() {
        let players=vec![(0,"alice".into(),"Alice".into(), None),(1,"bob".into(),"Bob".into(), None),(2,"eve".into(),"Eve".into(), None)];
        for text in ["<script>alert(1)</script>","<img src=x onerror=alert(1)>","' OR 1=1; DROP TABLE messages; --","{\"__proto__\":{\"admin\":true}}"] {
            let mut chat=Chat::default();
            let sent=chat.exchange(0,&players,&json!({"text":text,"to":1,"from":2})).unwrap();
            assert_eq!(sent["messages"][0]["text"],text);assert_eq!(sent["messages"][0]["from"],0);
            assert_eq!(chat.exchange(2,&players,&json!({})).unwrap()["messages"],json!([]));
            for id in [1,999] { assert_eq!(chat.exchange(2,&players,&json!({"deleteId":id})).unwrap_err(),(404,"Message unavailable.")); }
            assert_eq!(chat.exchange(2,&players,&json!({"text":"Leak","to":0,"replyTo":1})).unwrap_err().0,400);
        }
    }
}

#[cfg(test)]
mod color_tests {
    use super::*;
    #[test]
    fn quotes_preserve_original_colors_across_changes_and_restarts_without_trusting_client_colors() {
        let mut players = vec![
            (0, "a".repeat(64), "Alice".into(), Some("#a4198b".into())),
            (1, "b".repeat(64), "Bob".into(), Some("#3c75d8".into())),
            (2, "c".repeat(64), "Eve".into(), None),
        ];
        let mut chat = Chat::default();
        let sent = chat.exchange(0, &players, &json!({"text":"Private question","to":1,"color":"#000000"})).unwrap();
        assert_eq!(sent["messages"][0]["color"], "#a4198b");
        players[0].3 = Some("#3b6329".into());
        let answer = chat.exchange(1, &players, &json!({"text":"Answer","to":0,"replyTo":1,"reply":{"color":"#000000"}})).unwrap();
        let quote = json!({"id":1,"name":"Alice","text":"Private question","color":"#a4198b"});
        assert_eq!(answer["messages"][1]["color"], "#3c75d8");
        assert_eq!(answer["messages"][1]["reply"], quote);
        assert_eq!(chat.exchange(2, &players, &json!({})).unwrap()["messages"], json!([]));
        let path = std::env::temp_dir().join(format!("wild-wheels-chat-color-{}", crate::room::token())).join("chat.json");
        chat.save(&path).unwrap();
        let mut restored = Chat::open(&path).unwrap();
        assert_eq!(restored.exchange(0, &players, &json!({})).unwrap()["messages"][1]["reply"], quote);
        let deletion = restored.exchange(0, &players, &json!({"deleteId":1,"after":2})).unwrap();
        assert_eq!(deletion["messages"][1]["reply"], json!({"id":1,"name":"Alice","text":"","deleted":true}));
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
}
