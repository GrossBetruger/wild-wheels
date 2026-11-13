use super::*;

fn server(path: std::path::PathBuf) -> App {
    App {
        updates: Default::default(),
        sessions: Arc::new(tokio::sync::Mutex::new(
            sessions::Sessions::open(path, sessions::now()).unwrap(),
        )),
        room: Arc::new(Mutex::new(Room::new(0, 0))),
        photos: Default::default(),
        limits: Default::default(),
        sockets: Arc::new(Semaphore::new(32)),
        origin: None,
    }
}

async fn post(app: &App, path: &str, cookie: &str, body: Value) -> (StatusCode, String, Value) {
    let mut h = HeaderMap::new();
    h.insert(header::CONTENT_TYPE, "application/json".parse().unwrap());
    h.insert(header::COOKIE, cookie.parse().unwrap());
    let response = http(
        State(app.clone()),
        ConnectInfo("127.0.0.1:1234".parse().unwrap()),
        Method::POST,
        path.parse().unwrap(),
        h,
        body.to_string().into(),
    )
    .await;
    let cookie = response
        .headers()
        .get(header::SET_COOKIE)
        .map(|h| h.to_str().unwrap().split(';').next().unwrap().to_owned())
        .unwrap_or_default();
    let status = response.status();
    let body = axum::body::to_bytes(response.into_body(), 1024 * 1024)
        .await
        .unwrap();
    (status, cookie, serde_json::from_slice(&body).unwrap())
}

#[tokio::test(flavor = "current_thread")]
async fn cookies_restore_distinct_players_after_restart_with_saved_names_characters_and_roles() {
    let directory = std::env::temp_dir().join(format!("wild-wheels-restart-{}", room::token()));
    let path = directory.join("sessions.json");
    let app = server(path.clone());
    let (status, first_cookie, _) = post(
        &app,
        "/api/join",
        "",
        json!({"code":"00","name":"Same name","driver":7,"role":"bomber"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, second_cookie, _) = post(
        &app,
        "/api/join",
        "",
        json!({"code":"00","name":"Same name","driver":10}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_ne!(first_cookie, second_cookie);
    assert_eq!(
        post(
            &app,
            "/api/name",
            &first_cookie,
            json!({"name":"Houston again"})
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        post(&app, "/api/driver", &first_cookie, json!({"driver":8}))
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        post(
            &app,
            "/api/control",
            &second_cookie,
            json!({"action":"start"})
        )
        .await
        .0,
        StatusCode::OK
    );
    drop(app);

    let restarted = server(path.clone());
    assert_eq!(restarted.room.lock().unwrap().count(), 0);
    let (status, _, second) = post(&restarted, "/api/session", &second_cookie, json!({})).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(second["you"], 0);
    assert_eq!(second["world"]["name"], "Same name");
    assert_eq!(second["world"]["driver"], 10);
    let (status, refreshed_cookie, first) =
        post(&restarted, "/api/session", &first_cookie, json!({})).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(first["you"], 1);
    assert_eq!(first["world"]["name"], "Houston again");
    assert_eq!(first["world"]["driver"], 8);
    assert_eq!(first["world"]["bomber"], true);
    assert_eq!(first["world"]["phase"], "ready");
    assert_eq!(first["world"]["kills"], 0.0);
    assert_ne!(refreshed_cookie, first_cookie);
    assert_eq!(
        post(&restarted, "/api/session", &first_cookie, json!({}))
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    drop(restarted);
    let restarted = server(path);
    assert_eq!(
        post(&restarted, "/api/session", &refreshed_cookie, json!({}))
            .await
            .2["world"]["name"],
        "Houston again"
    );
    std::fs::remove_dir_all(directory).unwrap();
}

#[tokio::test(flavor = "current_thread")]
async fn releasing_an_abandoned_slot_keeps_its_saved_identity_separate_from_the_replacement() {
    let directory = std::env::temp_dir().join(format!("wild-wheels-return-{}", room::token()));
    let app = server(directory.join("sessions.json"));
    let (_, cookie, _) = post(
        &app,
        "/api/join",
        "",
        json!({"code":"00","name":"Returning","driver":7}),
    )
    .await;
    {
        let mut room = app.room.lock().unwrap();
        room.members[0].as_mut().unwrap().seen = Instant::now() - Duration::from_secs(901);
        room.tick();
        assert_eq!(room.count(), 0);
    }
    let (_, replacement_cookie, replacement) = post(
        &app,
        "/api/join",
        "",
        json!({"code":"00","name":"Replacement","driver":10}),
    )
    .await;
    assert_eq!(replacement["you"], 0);
    let (status, _, returning) = post(&app, "/api/session", &cookie, json!({})).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(returning["you"], 1);
    assert_eq!(returning["world"]["name"], "Returning");
    assert_eq!(returning["world"]["driver"], 7);
    let (_, _, replacement) = post(&app, "/api/session", &replacement_cookie, json!({})).await;
    assert_eq!(replacement["you"], 0);
    assert_eq!(replacement["world"]["name"], "Replacement");
    assert_eq!(replacement["world"]["driver"], 10);
    std::fs::remove_dir_all(directory).unwrap();
}

#[tokio::test(flavor = "current_thread")]
async fn a_failed_disk_write_issues_no_new_cookie_and_retry_recovers_the_same_player() {
    let directory =
        std::env::temp_dir().join(format!("wild-wheels-save-failure-{}", room::token()));
    let path = directory.join("sessions.json");
    let app = server(path.clone());
    let (_, cookie, _) = post(
        &app,
        "/api/join",
        "",
        json!({"code":"00","name":"Houston","driver":7}),
    )
    .await;
    std::fs::remove_file(&path).unwrap();
    std::fs::create_dir(&path).unwrap();
    let (status, failed_cookie, _) = post(&app, "/api/session", &cookie, json!({})).await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert!(failed_cookie.is_empty());
    std::fs::remove_dir(&path).unwrap();
    let (status, refreshed_cookie, player) = post(&app, "/api/session", &cookie, json!({})).await;
    assert_eq!(status, StatusCode::OK);
    assert!(!refreshed_cookie.is_empty());
    assert_eq!(player["you"], 0);
    assert_eq!(player["world"]["name"], "Houston");
    assert_eq!(app.room.lock().unwrap().count(), 1);
    std::fs::remove_dir_all(directory).unwrap();
}
