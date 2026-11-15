//! Real server interoperability. Set WILD_WHEELS_TEST_SERVER to a built binary.
use super::*;
use std::{
    net::TcpListener,
    path::PathBuf,
    process::{Child, Command, Stdio},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

struct Server {
    child: Child,
    directory: PathBuf,
}
impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        let _ = std::fs::remove_dir_all(&self.directory);
    }
}
fn wait(mut outcome: impl FnMut() -> bool) {
    let until = Instant::now() + Duration::from_secs(10);
    while Instant::now() < until {
        if outcome() {
            return;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    panic!("Chat outcome did not arrive within ten seconds");
}

#[test]
#[ignore = "requires WILD_WHEELS_TEST_SERVER pointing to a dedicated server binary"]
fn native_chat_exchanges_public_private_replies_and_deletions_with_the_browser_api() {
    let binary = std::env::var("WILD_WHEELS_TEST_SERVER").expect("Set WILD_WHEELS_TEST_SERVER");
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    let origin = url::Url::parse(&format!("http://127.0.0.1:{port}/")).unwrap();
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let directory = std::env::temp_dir().join(format!(
        "wild-wheels-native-chat-{}-{stamp}",
        std::process::id()
    ));
    std::fs::create_dir(&directory).unwrap();
    let child = Command::new(binary)
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
    let _server = Server { child, directory };
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .unwrap();
    wait(|| {
        rt.block_on(async {
            client
                .get(origin.join("healthz").unwrap())
                .send()
                .await
                .is_ok_and(|r| r.status().is_success())
        })
    });
    let join = |name: &str| {
        rt.block_on(async {
            client
                .post(origin.join("api/join").unwrap())
                .json(&json!({"code":"00","name":name,"driver":0,"role":"driver"}))
                .send()
                .await
                .unwrap()
                .json::<Value>()
                .await
                .unwrap()["token"]
                .as_str()
                .unwrap()
                .to_owned()
        })
    };
    let native_token = join("Native");
    let browser_token = join("Browser");
    let outsider_token = join("Outsider");
    let request = |token: &str, body: Value| {
        rt.block_on(async {
            let response = client
                .post(origin.join("api/chat").unwrap())
                .header("Origin", origin.origin().ascii_serialization())
                .bearer_auth(token)
                .json(&body)
                .send()
                .await
                .unwrap();
            assert!(
                response.status().is_success(),
                "Chat request failed with {}",
                response.status()
            );
            response.json::<Value>().await.unwrap()
        })
    };
    let browser = request(&browser_token, json!({}));
    let browser_id = browser["you"].as_u64().unwrap() as usize;
    let mut native = Chat::default();
    native.connect(origin.clone(), native_token);
    wait(|| {
        native.update(false);
        native.you.is_some()
    });
    assert!(native.send("Hello <script> & שלום", None, None));
    wait(|| {
        native.update(false);
        !native.pending && native.sent == 1
    });
    let public = request(&browser_token, json!({}));
    assert_eq!(public["messages"][0]["text"], "Hello <script> & שלום");
    request(
        &browser_token,
        json!({"text":"Private hello","to":native.you}),
    );
    wait(|| {
        native.update(false);
        native.messages.values().any(|m| m.text == "Private hello")
    });
    let private_id = native
        .messages
        .values()
        .find(|m| m.text == "Private hello")
        .unwrap()
        .id;
    assert!(native.unread_in(Some(browser_id)) > 0);
    assert_eq!(
        request(&outsider_token, json!({}))["messages"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    // The native sender's next message must respect the server's 500 ms rate limit.
    std::thread::sleep(Duration::from_millis(550));
    assert!(native.send("Private reply", Some(browser_id), Some(private_id)));
    wait(|| {
        native.update(false);
        native.sent == 2
    });
    let reply = request(&browser_token, json!({}));
    let reply = reply["messages"]
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["text"] == "Private reply")
        .unwrap();
    assert_eq!(reply["reply"]["text"], "Private hello");
    assert!(native.submit(json!({"deleteId":reply["id"]})));
    wait(|| {
        native.update(false);
        !native.pending
    });
    let response = request(&browser_token, json!({}));
    let removed = response["messages"]
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["id"] == reply["id"])
        .unwrap();
    assert_eq!(removed["deleted"], true);
    assert_eq!(removed["text"], "");
    assert_eq!(
        request(&outsider_token, json!({}))["messages"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}
