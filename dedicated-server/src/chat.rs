use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, VecDeque},
    io::{self, Read},
    path::Path,
    time::{Instant, SystemTime, UNIX_EPOCH},
};

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
        let cursor = |v: &Value| v.as_u64().is_some_and(|n| n > 0 && n <= chat.sequence);
        if chat.sequence > 9_007_199_254_740_991 || chat.messages.len() > 200
            || chat.messages.iter().any(|(from, to, m)| {
                !key(from) || to.as_ref().is_some_and(|s| !key(s))
                    || !cursor(&m["id"]) || m.get("updated").is_some_and(|v| !cursor(v))
                    || !text(&m["name"], 24) || !text(&m["text"], 500)
                    || m["from"].as_u64().is_none_or(|n| n >= 8)
                    || (to.is_some() && (m["to"].as_u64().is_none_or(|n| n >= 8) || !text(&m["toName"], 24)))
                    || (to.is_none() && !m["to"].is_null())
                    || m["time"].as_u64().is_none()
                    || (!m["reply"].is_null() && (!cursor(&m["reply"]["id"]) || !text(&m["reply"]["name"], 24) || !text(&m["reply"]["text"], 500)))
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
        players: &[(usize, String, String)],
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
        if let Some(value) = body.get("deleteId") {
            if body.get("text").is_some() {
                return Err((400, "Choose one chat action."));
            }
            let index = value
                .as_u64()
                .and_then(|id| {
                    self.messages
                        .iter()
                        .position(|(_, _, m)| m["id"].as_u64() == Some(id))
                })
                .ok_or((404, "Message unavailable."))?;
            if self.messages[index].0 != sender.1 {
                return Err((403, "You can only delete your own messages."));
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
        }
        if let Some(value) = body.get("text") {
            let text = value
                .as_str()
                .filter(|s| !s.trim().is_empty() && s.encode_utf16().count() <= 500)
                .ok_or((400, "Enter a message of 1–500 characters."))?;
            let recipient = match body.get("to").filter(|v| !v.is_null()) {
                None => None,
                Some(value) => {
                    let to = value
                        .as_u64()
                        .and_then(|n| usize::try_from(n).ok())
                        .ok_or((400, "Choose another player who is still in the room."))?;
                    Some(
                        players
                            .iter()
                            .find(|p| p.0 == to && to != id)
                            .ok_or((400, "Choose another player who is still in the room."))?,
                    )
                }
            };
            let reply = match body.get("replyTo").filter(|v| !v.is_null()) {
                None => Value::Null,
                Some(value) => {
                    let original = value
                        .as_u64()
                        .and_then(|id| {
                            self.messages
                                .iter()
                                .find(|(_, _, m)| m["id"].as_u64() == Some(id))
                        })
                        .filter(|(_, _, m)| m["deleted"] != true)
                        .filter(|(from, to, _)| match recipient {
                            None => to.is_none(),
                            Some(peer) => {
                                (from == &sender.1 && to.as_ref() == Some(&peer.1))
                                    || (from == &peer.1 && to.as_ref() == Some(&sender.1))
                            }
                        })
                        .ok_or((400, "That message is unavailable in this conversation."))?;
                    json!({"id":original.2["id"],"name":original.2["name"],"text":original.2["text"]})
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
            let message = json!({"id":self.sequence,"from":id,"name":sender.2,"to":recipient.map(|p|p.0),"toName":recipient.map(|p|&p.2),"text":text.trim(),"reply":reply,"time":SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64});
            self.messages
                .push_back((sender.1.clone(), recipient.map(|p| p.1.clone()), message));
            if self.messages.len() > 200 {
                self.messages.pop_front();
            }
        }
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
                let slot = |identity: &str| players.iter().find(|p| p.1 == identity).map_or(json!(-1), |p| json!(p.0));
                message["from"] = slot(from);
                if let Some(to) = to { message["to"] = slot(to); }
                message
            })
            .collect();
        Ok(
            json!({"you":id,"players":players.iter().map(|p|json!({"id":p.0,"name":p.2})).collect::<Vec<_>>(),"cursor":self.sequence,"messages":messages}),
        )
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn restart_preserves_text_replies_deletions_and_private_ownership_when_slots_change() {
        let path = std::env::temp_dir().join(format!("wild-wheels-chat-{}", crate::room::token())).join("chat.json");
        let alice = "a".repeat(64);
        let bob = "b".repeat(64);
        let stranger = "c".repeat(64);
        let players = vec![(0, alice.clone(), "Alice".into()), (1, bob.clone(), "Bob".into())];
        let mut chat = super::Chat::default();
        let text = "\"},\"command\":\"$(touch /tmp/chat-must-not-execute)\" <script> & \\";
        chat.exchange(0, &players, &serde_json::json!({"text":text})).unwrap();
        chat.exchange(1, &players, &serde_json::json!({"text":"Secret", "to":0, "replyTo":null})).unwrap();
        chat.exchange(0, &players, &serde_json::json!({"deleteId":1})).unwrap();
        chat.save(&path).unwrap();
        let mut restored = super::Chat::open(&path).unwrap();
        let players = vec![(0, stranger, "Alice".into()), (3, bob, "Bob".into()), (5, alice, "Alice".into())];
        let public = restored.exchange(0, &players, &serde_json::json!({})).unwrap();
        assert_eq!(public["messages"].as_array().unwrap().len(), 1);
        assert_eq!(public["messages"][0]["deleted"], true);
        let private = restored.exchange(5, &players, &serde_json::json!({})).unwrap();
        assert_eq!(private["messages"][1]["text"], "Secret");
        assert_eq!(private["messages"][1]["from"], 3);
        assert_eq!(private["messages"][1]["to"], 5);
        assert_eq!(restored.exchange(0, &players, &serde_json::json!({"deleteId":2})).unwrap_err().0, 403);
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
            403
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
    fn players() -> Vec<(usize, String, String)> {
        vec![
            (0, "alice-token".into(), "Alice".into()),
            (1, "bob-token".into(), "Bob".into()),
            (2, "eve-token".into(), "Eve".into()),
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
