//! Run explicitly against isolated dedicated-server binaries; never a live room.
use crate::{
    config::Config,
    transport::{Command, Event, Transport},
};
use serde_json::{Value, json};
use std::{
    net::TcpListener,
    path::PathBuf,
    process::{Child, Command as Process, Stdio},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use wild_wheels_core::NativeClient;

struct Server {
    child: Child,
    directory: PathBuf,
    origin: url::Url,
}
impl Server {
    fn start(variable: &str) -> Self {
        let binary = std::env::var(variable).expect("Set the server binary environment variable");
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory = std::env::temp_dir().join(format!(
            "wild-wheels-color-test-{}-{stamp}",
            std::process::id()
        ));
        std::fs::create_dir(&directory).unwrap();
        let child = Process::new(binary)
            .current_dir(&directory)
            .env("PORT", port.to_string())
            .env("BIND", "127.0.0.1")
            .env("BOTS", "0")
            .env("WILD_WHEELS_SESSION_FILE", directory.join("sessions.json"))
            .env("WILD_WHEELS_CHAT_FILE", directory.join("chat.json"))
            .env("WILD_WHEELS_STATS_FILE", directory.join("stats.json"))
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let server = Self {
            child,
            directory,
            origin: url::Url::parse(&format!("http://127.0.0.1:{port}/")).unwrap(),
        };
        let deadline = Instant::now() + Duration::from_secs(10);
        while std::net::TcpStream::connect(("127.0.0.1", port)).is_err() {
            assert!(Instant::now() < deadline, "Test server did not start");
            std::thread::sleep(Duration::from_millis(20));
        }
        server
    }
}
impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        let _ = std::fs::remove_dir_all(&self.directory);
    }
}
struct Probe {
    epoch: Instant,
    transport: Transport,
    client: Option<NativeClient>,
    preferred: Option<String>,
    reply: Option<Result<String, String>>,
    packets: usize,
}
impl Probe {
    fn join(server: &Server) -> Self {
        std::env::var_os("WILD_WHEELS_NATIVE_DATA_DIR")
            .expect("Set WILD_WHEELS_NATIVE_DATA_DIR to a temporary test directory");
        let mut config =
            Config::from_args(["--name".into(), "Native Color".into()].into_iter()).unwrap();
        config.origin = server.origin.clone();
        config.color = Some("#e72845".into());
        Self {
            epoch: Instant::now(),
            transport: Transport::spawn(config),
            client: None,
            preferred: None,
            reply: None,
            packets: 0,
        }
    }
    fn wait(&mut self, condition: impl Fn(&Self) -> bool) {
        let start = Instant::now();
        loop {
            while let Ok(event) = self.transport.events.try_recv() {
                match event {
                    Event::ColorResult(result) => self.reply = Some(result),
                    Event::ColorPreference(color) => self.preferred = color,
                    Event::Packet(bytes) => {
                        self.packets += 1;
                        match self.client.as_mut() {
                            Some(client) => client
                                .accept(&bytes, self.epoch.elapsed().as_secs_f64())
                                .unwrap(),
                            None => {
                                self.client = Some(NativeClient::from_packet(&bytes, 0.0).unwrap())
                            }
                        }
                    }
                    Event::Error(error) => panic!("Native transport failed: {error}"),
                    _ => {}
                }
            }
            if condition(self) {
                return;
            }
            assert!(
                start.elapsed() < Duration::from_secs(10),
                "Native color outcome timed out"
            );
            std::thread::sleep(Duration::from_millis(10));
        }
    }
    fn color(&self) -> String {
        self.client.as_ref().unwrap().view().player.color.clone()
    }
    fn choose(&mut self, color: &str) {
        self.reply = None;
        self.transport
            .commands
            .send(Command::Color(color.into()))
            .unwrap();
        self.wait(|p| p.reply.is_some());
    }
}

#[test]
#[ignore = "requires WILD_WHEELS_COLOR_SERVER pointing to Sarah's dedicated server build"]
fn native_picker_handles_occupied_preferences_and_authoritative_color_changes() {
    let server = Server::start("WILD_WHEELS_COLOR_SERVER");
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let http = reqwest::Client::new();
    let browser:Value=rt.block_on(async{http.post(server.origin.join("api/join").unwrap()).json(&json!({"code":"00","name":"Browser Red","driver":0,"role":"driver","color":"#e72845"})).send().await.unwrap().json().await.unwrap()});
    assert_eq!(browser["world"]["color"], "#e72845");
    let mut native = Probe::join(&server);
    native.wait(|p| p.client.is_some());
    assert_ne!(native.color(), "#e72845");
    assert_eq!(native.preferred.as_deref(), Some("#e72845"));
    let fallback = native.color();
    native.choose("#e72845");
    assert!(native.reply.as_ref().unwrap().is_err());
    assert_eq!(native.color(), fallback);
    native.choose("#3c75d8");
    assert_eq!(native.reply.as_ref().unwrap().as_ref().unwrap(), "#3c75d8");
    native.wait(|p| p.color() == "#3c75d8");
    let count = native.packets;
    native.wait(|p| p.packets > count + 2);
    assert_eq!(native.color(), "#3c75d8");
    native
        .transport
        .commands
        .send(Command::Control(json!({"action":"start"})))
        .unwrap();
    native.wait(|p| {
        matches!(
            p.client.as_ref().unwrap().view().phase,
            "countdown" | "racing"
        )
    });
    native.choose("#3b6329");
    assert!(native.reply.as_ref().unwrap().is_err());
    assert_eq!(native.color(), "#3c75d8");
}
#[test]
#[ignore = "requires WILD_WHEELS_LEGACY_SERVER pointing to a server without a color API"]
fn native_picker_keeps_older_servers_playable_when_color_changes_are_unavailable() {
    let server = Server::start("WILD_WHEELS_LEGACY_SERVER");
    let mut native = Probe::join(&server);
    native.wait(|p| p.client.is_some());
    let assigned = native.color();
    native.choose("#3c75d8");
    assert!(
        native
            .reply
            .as_ref()
            .unwrap()
            .as_ref()
            .unwrap_err()
            .contains("update")
    );
    assert_eq!(native.color(), assigned);
    let count = native.packets;
    native.wait(|p| p.packets > count + 2);
    assert_eq!(native.color(), assigned);
}
