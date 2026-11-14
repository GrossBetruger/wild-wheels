//! The player's last menu choices, so the next launch starts where they left off.
use crate::session::data_directory;
use serde::{Deserialize, Serialize};
use std::{fs, io::Read, path::Path};

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Preferences {
    pub server: Option<String>,
    pub name: Option<String>,
    pub driver: Option<usize>,
}
impl Preferences {
    /// Unreadable or oversized preferences are ignored; they are only conveniences.
    pub fn load() -> Self {
        data_directory()
            .map(|directory| Self::read(&directory.join("preferences.json")))
            .unwrap_or_default()
    }
    fn read(path: &Path) -> Self {
        let mut data = Vec::new();
        match fs::File::open(path).map(|file| file.take(65_537).read_to_end(&mut data)) {
            Ok(Ok(size)) if size <= 65_536 => serde_json::from_slice(&data).unwrap_or_default(),
            _ => Self::default(),
        }
    }
    pub fn save(&self) {
        if let Ok(directory) = data_directory() {
            self.write(&directory.join("preferences.json"));
        }
    }
    fn write(&self, path: &Path) {
        let Some(parent) = path.parent() else {
            return;
        };
        if fs::create_dir_all(parent).is_ok()
            && let Ok(data) = serde_json::to_vec(self)
        {
            let _ = fs::write(path, data);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn menu_choices_survive_a_restart_and_damage_is_ignored() {
        let path = std::env::temp_dir()
            .join(format!("wild-wheels-preferences-{}", std::process::id()))
            .join("preferences.json");
        assert_eq!(Preferences::read(&path), Preferences::default());
        let chosen = Preferences {
            server: Some("http://localhost:5173/".into()),
            name: Some("Pip".into()),
            driver: Some(9),
        };
        chosen.write(&path);
        assert_eq!(Preferences::read(&path), chosen);
        fs::write(&path, "not json").unwrap();
        assert_eq!(Preferences::read(&path), Preferences::default());
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }
}
