//! Private per-origin identity storage; never shared with browser cookies.
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    io::{self, Read, Write},
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Serialize, Deserialize)]
pub struct Identity {
    pub token: String,
    pub expires: u64,
}
pub struct Store {
    path: PathBuf,
    identities: BTreeMap<String, Identity>,
}
pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
impl Store {
    pub fn open() -> io::Result<Self> {
        if let Some(directory) = std::env::var_os("WILD_WHEELS_NATIVE_DATA_DIR") {
            return Self::at(PathBuf::from(directory).join("sessions.json"));
        }
        let project = directories::ProjectDirs::from("games", "WildWheels", "NativeClient")
            .ok_or_else(|| io::Error::other("No application data directory"))?;
        Self::at(project.data_local_dir().join("sessions.json"))
    }
    fn at(path: PathBuf) -> io::Result<Self> {
        let identities: BTreeMap<String, Identity> = match fs::File::open(&path) {
            Ok(file) => {
                let mut data = Vec::new();
                file.take(1_048_577).read_to_end(&mut data)?;
                if data.len() > 1_048_576 {
                    return Err(io::Error::other("Session file is too large"));
                }
                serde_json::from_slice(&data).map_err(io::Error::other)?
            }
            Err(e) if e.kind() == io::ErrorKind::NotFound => BTreeMap::new(),
            Err(e) => return Err(e),
        };
        if identities.len() > 1024 || identities.values().any(|i| !valid_token(&i.token)) {
            return Err(io::Error::other("Invalid saved native sessions"));
        }
        Ok(Self { path, identities })
    }
    pub fn get(&self, origin: &str) -> Option<&Identity> {
        self.identities.get(origin).filter(|i| i.expires > now())
    }
    pub fn remember(&mut self, origin: &str, identity: Identity) -> io::Result<()> {
        if !valid_token(&identity.token) {
            return Err(io::Error::other("Invalid server session"));
        }
        self.identities.retain(|_, i| i.expires > now());
        if self.identities.len() >= 1024 && !self.identities.contains_key(origin) {
            return Err(io::Error::other("Native session storage is full"));
        }
        self.identities.insert(origin.to_owned(), identity);
        let parent = self
            .path
            .parent()
            .ok_or_else(|| io::Error::other("Invalid session path"))?;
        let mut directory = fs::DirBuilder::new();
        directory.recursive(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            directory.mode(0o700);
        }
        directory.create(parent)?;
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let temporary = self
            .path
            .with_extension(format!("{}-{stamp}.tmp", std::process::id()));
        let result = (|| {
            let mut options = fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut file = options.open(&temporary)?;
            file.write_all(&serde_json::to_vec(&self.identities)?)?;
            file.sync_all()?;
            fs::rename(&temporary, &self.path)?;
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(temporary);
        }
        result
    }
}
fn valid_token(token: &str) -> bool {
    token.len() == 64 && token.bytes().all(|b| b.is_ascii_hexdigit())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn path() -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir()
            .join(format!(
                "wild-wheels-identity-{}-{stamp}",
                std::process::id()
            ))
            .join("sessions.json")
    }
    #[test]
    fn restarting_restores_each_servers_identity_and_keeps_rotated_tokens() {
        let path = path();
        let mut store = Store::at(path.clone()).unwrap();
        store
            .remember(
                "http://localhost:5173/",
                Identity {
                    token: "a".repeat(64),
                    expires: now() + 3600,
                },
            )
            .unwrap();
        store
            .remember(
                "https://example.com/",
                Identity {
                    token: "b".repeat(64),
                    expires: now() + 3600,
                },
            )
            .unwrap();
        store
            .remember(
                "http://localhost:5173/",
                Identity {
                    token: "c".repeat(64),
                    expires: now() + 3600,
                },
            )
            .unwrap();
        let restored = Store::at(path.clone()).unwrap();
        assert_eq!(
            restored.get("http://localhost:5173/").unwrap().token,
            "c".repeat(64)
        );
        assert_eq!(
            restored.get("https://example.com/").unwrap().token,
            "b".repeat(64)
        );
        assert!(restored.get("http://localhost:5189/").is_none());
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
    #[test]
    fn expired_sessions_are_not_restored() {
        let path = path();
        let mut store = Store::at(path.clone()).unwrap();
        store
            .remember(
                "http://localhost:5173/",
                Identity {
                    token: "a".repeat(64),
                    expires: now() - 1,
                },
            )
            .unwrap();
        assert!(
            Store::at(path.clone())
                .unwrap()
                .get("http://localhost:5173/")
                .is_none()
        );
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
}
