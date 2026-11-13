use serde::{Deserialize, Serialize};
use std::{
    fs::{self, OpenOptions},
    io::{self, Read, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

pub const LIFETIME: u64 = 30 * 24 * 60 * 60;
const MAX_SESSIONS: usize = 10_000;
const MAX_BYTES: u64 = 4 * 1024 * 1024;

pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Session {
    pub identity: String,
    pub token: String,
    pub name: String,
    pub driver: usize,
    pub role: String,
    pub expires: u64,
}

pub struct Sessions {
    path: PathBuf,
    records: Vec<Session>,
}

impl Sessions {
    pub fn open(path: PathBuf, at: u64) -> io::Result<Self> {
        let records: Vec<Session> = match fs::File::open(&path) {
            Ok(file) => {
                let mut bytes = Vec::new();
                file.take(MAX_BYTES + 1).read_to_end(&mut bytes)?;
                if bytes.len() as u64 > MAX_BYTES {
                    return Err(io::Error::other("Session file is too large"));
                }
                serde_json::from_slice(&bytes).map_err(io::Error::other)?
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => Vec::new(),
            Err(error) => return Err(error),
        };
        let valid_key = |key: &str| key.len() == 64 && key.bytes().all(|b| b.is_ascii_hexdigit());
        if records.len() > MAX_SESSIONS
            || records.iter().any(|p| {
                !valid_key(&p.identity)
                    || !valid_key(&p.token)
                    || p.name.trim().is_empty()
                    || p.name.encode_utf16().count() > 24
                    || p.driver >= 15
                    || !matches!(p.role.as_str(), "driver" | "bomber")
            })
        {
            return Err(io::Error::other("Invalid saved sessions"));
        }
        Ok(Self {
            path,
            records: records.into_iter().filter(|p| p.expires > at).collect(),
        })
    }

    pub fn find(&self, token: &str, at: u64) -> Option<&Session> {
        self.records
            .iter()
            .find(|p| p.token == token && p.expires > at)
    }

    pub async fn remember(&mut self, session: Session, at: u64) -> io::Result<()> {
        let mut records: Vec<_> = self
            .records
            .iter()
            .filter(|p| p.identity != session.identity && p.expires > at)
            .cloned()
            .collect();
        if records.len() >= MAX_SESSIONS {
            return Err(io::Error::other("Session storage is full"));
        }
        records.push(session);
        let bytes = serde_json::to_vec(&records).map_err(io::Error::other)?;
        let path = self.path.clone();
        // Filesystem latency must not stall the simulation's async thread.
        tokio::task::spawn_blocking(move || write(&path, &bytes))
            .await
            .map_err(io::Error::other)??;
        self.records = records;
        Ok(())
    }
}

pub(crate) fn write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let mut directory = fs::DirBuilder::new();
    directory.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        directory.mode(0o700);
    }
    directory.create(parent)?;
    let temporary = parent.join(format!(".sessions-{}.tmp", crate::room::token()));
    let result = (|| {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        fs::rename(&temporary, path)?;
        #[cfg(unix)]
        fs::File::open(parent)?.sync_all()?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test(flavor = "current_thread")]
    async fn saved_identity_survives_restart_and_rotated_tokens_expire_independently_of_names() {
        let path = std::env::temp_dir()
            .join(format!("wild-wheels-sessions-{}", crate::room::token()))
            .join("sessions.json");
        let mut store = Sessions::open(path.clone(), 100).unwrap();
        let alice = Session {
            identity: "a".repeat(64),
            token: "1".repeat(64),
            name: "Same name".into(),
            driver: 7,
            role: "bomber".into(),
            expires: 100 + LIFETIME,
        };
        let bob = Session {
            identity: "b".repeat(64),
            token: "2".repeat(64),
            name: "Same name".into(),
            driver: 10,
            role: "driver".into(),
            expires: 100 + LIFETIME,
        };
        store.remember(alice.clone(), 100).await.unwrap();
        store.remember(bob, 100).await.unwrap();
        let mut restarted = Sessions::open(path.clone(), 101).unwrap();
        assert_eq!(restarted.find(&"1".repeat(64), 101).unwrap().driver, 7);
        assert_eq!(restarted.find(&"1".repeat(64), 101).unwrap().role, "bomber");
        assert_eq!(restarted.find(&"2".repeat(64), 101).unwrap().driver, 10);
        let mut rotated = alice;
        rotated.token = "3".repeat(64);
        rotated.name = "New name".into();
        rotated.expires = 101 + LIFETIME;
        restarted.remember(rotated, 101).await.unwrap();
        let restored = Sessions::open(path.clone(), 102).unwrap();
        assert!(restored.find(&"1".repeat(64), 102).is_none());
        assert_eq!(
            restored.find(&"3".repeat(64), 102).unwrap().identity,
            "a".repeat(64)
        );
        assert_eq!(
            restored.find(&"3".repeat(64), 102).unwrap().name,
            "New name"
        );
        assert!(restored.find(&"2".repeat(64), 100 + LIFETIME).is_none());
        assert!(restored.find(&"3".repeat(64), 100 + LIFETIME).is_some());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
}
