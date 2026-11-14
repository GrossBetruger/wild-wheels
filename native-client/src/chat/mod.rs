//! Native chat: bounded HTTP IO, conversation state, and Bevy UI are separate.
#[cfg(test)]
mod integration;
mod network;
mod panel;
pub use panel::{ChatPanel, control, draw, scroll};
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct Player {
    pub id: usize,
    pub name: String,
}
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct Quote {
    pub id: u64,
    pub name: String,
    pub text: String,
    #[serde(default)]
    pub deleted: bool,
}
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct Message {
    pub id: u64,
    pub from: i64,
    pub to: Option<i64>,
    pub name: String,
    pub text: String,
    #[serde(default)]
    pub deleted: bool,
    pub reply: Option<Quote>,
}
impl Message {
    pub fn conversation(&self, you: usize) -> Option<usize> {
        let peer = match self.to {
            None => return None,
            Some(peer) if self.from == you as i64 => peer,
            Some(_) => self.from,
        };
        usize::try_from(peer).ok()
    }
}
#[derive(Deserialize)]
pub struct Response {
    pub you: usize,
    pub cursor: u64,
    pub players: Vec<Player>,
    pub messages: Vec<Message>,
}
impl Response {
    pub fn parse(value: Value) -> Result<Self, String> {
        let response: Self =
            serde_json::from_value(value).map_err(|_| "Invalid chat response".to_owned())?;
        if response.you >= 8
            || response.players.len() > 8
            || response.messages.len() > 200
            || response.cursor > 9_007_199_254_740_991
        {
            return Err("Invalid chat response".into());
        }
        if response
            .players
            .iter()
            .any(|p| p.id >= 8 || p.name.encode_utf16().count() > 24)
            || response.messages.iter().any(|m| {
                m.text.encode_utf16().count() > 500
                    || m.name.encode_utf16().count() > 24
                    || m.reply.as_ref().is_some_and(|q| {
                        q.id > response.cursor
                            || q.text.encode_utf16().count() > 500
                            || q.name.encode_utf16().count() > 24
                    })
            })
        {
            return Err("Invalid chat response".into());
        }
        Ok(response)
    }
}
#[derive(Default)]
pub struct Chat {
    worker: Option<network::Worker>,
    pub you: Option<usize>,
    pub players: Vec<Player>,
    pub messages: BTreeMap<u64, Message>,
    pub revision: u64,
    pub generation: u64,
    pub sent: u64,
    pub pending: bool,
    pub status: String,
    pub unread: usize,
    unread_ids: BTreeMap<Option<usize>, BTreeSet<u64>>,
    initialized: bool,
}
impl Chat {
    pub fn connect(&mut self, origin: url::Url, token: String) {
        self.clear();
        self.worker = Some(network::Worker::spawn(origin, token));
        self.status = "Connecting chat...".into();
    }
    pub fn clear(&mut self) {
        *self = Self {
            generation: self.generation + 1,
            ..Default::default()
        };
    }
    pub fn update(&mut self, reading: bool) {
        loop {
            let event = self.worker.as_ref().and_then(|w| w.events.try_recv().ok());
            let Some(event) = event else {
                break;
            };
            match event {
                network::Event::Reply {
                    response,
                    action,
                    sent,
                } => {
                    self.merge(response, reading);
                    if sent {
                        self.sent += 1;
                    }
                    if action {
                        self.pending = false;
                    }
                    self.status = "Connected".into();
                }
                network::Event::Error { message, action } => {
                    if action {
                        self.pending = false;
                    }
                    self.status = message;
                    self.revision += 1;
                }
            }
        }
        if reading {
            self.unread = 0;
            self.unread_ids.clear();
        }
    }
    fn merge(&mut self, response: Response, reading: bool) {
        let mut changed = self.players != response.players || self.you != Some(response.you);
        for message in response.messages {
            if self.initialized
                && !reading
                && !message.deleted
                && Some(message.from) != Some(response.you as i64)
                && !self.messages.contains_key(&message.id)
            {
                self.unread_ids
                    .entry(message.conversation(response.you))
                    .or_default()
                    .insert(message.id);
            }
            if message.deleted {
                for ids in self.unread_ids.values_mut() {
                    ids.remove(&message.id);
                }
            }
            changed |= self.messages.get(&message.id) != Some(&message);
            self.messages.insert(message.id, message);
        }
        while self.messages.len() > 200 {
            self.messages.pop_first();
        }
        for ids in self.unread_ids.values_mut() {
            ids.retain(|id| self.messages.contains_key(id));
        }
        self.you = Some(response.you);
        self.players = response.players;
        self.initialized = true;
        self.unread = self.unread_ids.values().map(BTreeSet::len).sum();
        if changed {
            self.revision += 1;
        }
    }
    pub fn read(&mut self, conversation: Option<usize>) {
        self.unread_ids.remove(&conversation);
        self.unread = self.unread_ids.values().map(BTreeSet::len).sum();
    }
    pub fn unread_in(&self, conversation: Option<usize>) -> usize {
        self.unread_ids.get(&conversation).map_or(0, BTreeSet::len)
    }
    pub fn submit(&mut self, action: Value) -> bool {
        if self.pending {
            return false;
        }
        let queued = self
            .worker
            .as_ref()
            .is_some_and(|w| w.commands.try_send(action).is_ok());
        if queued {
            self.pending = true;
            self.status = "Sending...".into();
        }
        queued
    }
    pub fn send(&mut self, text: &str, to: Option<usize>, reply: Option<u64>) -> bool {
        let text = text.trim();
        if text.is_empty() || text.encode_utf16().count() > 500 {
            return false;
        }
        if to.is_some_and(|id| Some(id) == self.you || !self.players.iter().any(|p| p.id == id)) {
            self.status = "That player is no longer in the room".into();
            return false;
        }
        self.submit(json!({"text":text,"to":to,"replyTo":reply}))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn edits_and_deletions_replace_messages_without_replaying_unread_notifications() {
        let mut chat = Chat::default();
        chat.merge(Response::parse(json!({"you":0,"cursor":1,"players":[],"messages":[{"id":1,"from":1,"to":null,"name":"Sarah","text":"Hello","reply":null}]})).unwrap(), false);
        assert_eq!(chat.unread, 0);
        chat.merge(Response::parse(json!({"you":0,"cursor":2,"players":[],"messages":[{"id":2,"from":1,"to":0,"name":"Sarah","text":"Private","reply":null}]})).unwrap(), false);
        assert_eq!(chat.unread, 1);
        chat.merge(Response::parse(json!({"you":0,"cursor":3,"players":[],"messages":[{"id":2,"from":1,"to":0,"name":"Sarah","text":"","deleted":true,"reply":null}]})).unwrap(), true);
        assert!(chat.messages[&2].deleted);
        assert_eq!(chat.messages.len(), 2);
    }
    #[test]
    fn public_and_private_messages_belong_to_separate_conversations() {
        let response = Response::parse(json!({"you":0,"cursor":3,"players":[],"messages":[{"id":1,"from":1,"to":null,"name":"Sarah","text":"Public","reply":null},{"id":2,"from":0,"to":1,"name":"Me","text":"Sent","reply":null},{"id":3,"from":1,"to":0,"name":"Sarah","text":"Received","reply":null}]})).unwrap();
        assert_eq!(response.messages[0].conversation(0), None);
        assert_eq!(response.messages[1].conversation(0), Some(1));
        assert_eq!(response.messages[2].conversation(0), Some(1));
    }
}
