use serde_json::{json, Value};
use std::{
    collections::{HashMap, VecDeque},
    time::{Instant, SystemTime, UNIX_EPOCH},
};

#[derive(Default)]
pub struct Chat {
    sequence: u64,
    messages: VecDeque<(String, Option<String>, Value)>,
    sent: HashMap<String, Instant>,
}
impl Chat {
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
            .map(|(_, _, message)| message)
            .collect();
        Ok(
            json!({"you":id,"players":players.iter().map(|p|json!({"id":p.0,"name":p.2})).collect::<Vec<_>>(),"cursor":self.sequence,"messages":messages}),
        )
    }
}

#[cfg(test)]
mod tests {
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
