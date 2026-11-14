use super::*;

fn server(path: std::path::PathBuf) -> App {
    App {
        trust_proxy: false,
        invite_secret: None,
        stats: Default::default(),
        shutdown: tokio::sync::watch::channel(false).0,
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

#[tokio::test(flavor = "current_thread")]
async fn checking_updates_does_not_consume_the_install_rate_limit() {
    let directory = std::env::temp_dir().join(format!("wild-wheels-update-limit-{}", room::token()));
    let app = server(directory.join("sessions.json"));
    let (_, cookie, _) = post(&app, "/api/join", "", json!({"code":"00","name":"Updater","driver":0})).await;
    assert_eq!(post(&app, "/api/updates/install", &cookie, json!({})).await.0, StatusCode::CONFLICT);
    assert_eq!(post(&app, "/api/updates/check", &cookie, json!({})).await.0, StatusCode::CONFLICT);
    assert_eq!(post(&app, "/api/updates/install", &cookie, json!({})).await.0, StatusCode::CONFLICT);
    assert_eq!(post(&app, "/api/updates/install", &cookie, json!({})).await.0, StatusCode::TOO_MANY_REQUESTS);
    std::fs::remove_dir_all(directory).unwrap();
}

async fn post(app: &App, path: &str, cookie: &str, body: Value) -> (StatusCode, String, Value) {
    let mut h = HeaderMap::new();
    h.insert(header::HOST, "localhost".parse().unwrap());
    h.insert(header::ORIGIN, "http://localhost".parse().unwrap());
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

#[tokio::test(flavor = "current_thread")]
async fn saved_color_preferences_survive_restarts_and_occupied_fallbacks() {
    let directory=std::env::temp_dir().join(format!("wild-wheels-color-profile-{}",room::token()));
    let path=directory.join("sessions.json");
    let app=server(path.clone());
    let preferred=wild_wheels_core::PLAYER_COLORS[12];
    let (status,cookie,first)=post(&app,"/api/join","",json!({"code":"00","name":"Returning","driver":0,"color":preferred})).await;
    assert_eq!(status,StatusCode::OK);assert_eq!(first["world"]["color"],preferred);drop(app);
    let restarted=server(path.clone());
    let (_,other_cookie,_)=post(&restarted,"/api/join","",json!({"code":"00","name":"Other","driver":1,"color":preferred})).await;
    let (status,cookie,returned)=post(&restarted,"/api/session",&cookie,json!({})).await;
    assert_eq!(status,StatusCode::OK);assert_eq!(returned["preferredColor"],preferred);assert_ne!(returned["world"]["color"],preferred);
    let stored=sessions::Sessions::open(path.clone(),sessions::now()).unwrap();
    let token=cookie.strip_prefix("wild-wheels-session=").unwrap();
    assert_eq!(stored.find(token,sessions::now()).unwrap().color.as_deref(),Some(preferred));
    assert_eq!(post(&restarted,"/api/color",&cookie,json!({"color":preferred,"id":0})).await.0,StatusCode::CONFLICT);
    assert_eq!(post(&restarted,"/api/color",&cookie,json!({"color":"url(https://attacker.invalid)"})).await.0,StatusCode::BAD_REQUEST);
    let chosen=wild_wheels_core::PLAYER_COLORS[4];
    assert_eq!(post(&restarted,"/api/color",&cookie,json!({"color":chosen,"id":0})).await.0,StatusCode::OK);
    assert_eq!(post(&restarted,"/api/chat",&cookie,json!({"text":"Color check"})).await.2["messages"][0]["color"],returned["chatColor"]);
    let other=post(&restarted,"/api/session",&other_cookie,json!({})).await.2;
    assert_eq!(other["world"]["color"],preferred);drop(restarted);
    let again=server(path);
    let (status,_,saved)=post(&again,"/api/session",&cookie,json!({})).await;
    assert_eq!(status,StatusCode::OK);assert_eq!(saved["world"]["color"],chosen);assert_eq!(saved["preferredColor"],chosen);
    std::fs::remove_dir_all(directory).unwrap();
}

#[tokio::test(flavor = "current_thread")]
async fn failed_color_profile_writes_restore_the_previous_assignment() {
    let directory=std::env::temp_dir().join(format!("wild-wheels-color-write-{}",room::token()));
    let path=directory.join("sessions.json");let app=server(path.clone());
    let (_,cookie,first)=post(&app,"/api/join","",json!({"code":"00","name":"Player","driver":0})).await;
    std::fs::remove_file(&path).unwrap();std::fs::create_dir(&path).unwrap();
    let chosen=wild_wheels_core::PLAYER_COLORS[4];
    assert_eq!(post(&app,"/api/color",&cookie,json!({"color":chosen})).await.0,StatusCode::SERVICE_UNAVAILABLE);
    { let room=app.room.lock().unwrap();assert_eq!(room.core.player_color(0).unwrap(),first["world"]["color"].as_str().unwrap());assert_eq!(room.members[0].as_ref().unwrap().preferred_color.as_deref(),first["preferredColor"].as_str()); }
    std::fs::remove_dir(&path).unwrap();
    assert_eq!(post(&app,"/api/color",&cookie,json!({"color":chosen})).await.0,StatusCode::OK);
    std::fs::remove_dir_all(directory).unwrap();
}

#[tokio::test(flavor = "current_thread")]
async fn two_players_racing_for_a_color_cannot_both_claim_it() {
    let directory=std::env::temp_dir().join(format!("wild-wheels-color-race-{}",room::token()));
    let app=server(directory.join("sessions.json"));
    let (_,alice,_)=post(&app,"/api/join","",json!({"code":"00","name":"Alice","driver":0})).await;
    let (_,bob,_)=post(&app,"/api/join","",json!({"code":"00","name":"Bob","driver":1})).await;
    let color=wild_wheels_core::PLAYER_COLORS[12];
    let (first,second)=tokio::join!(post(&app,"/api/color",&alice,json!({"color":color})),post(&app,"/api/color",&bob,json!({"color":color})));
    assert!(matches!((first.0,second.0),(StatusCode::OK,StatusCode::CONFLICT)|(StatusCode::CONFLICT,StatusCode::OK)));
    let room=app.room.lock().unwrap();assert_ne!(room.members[0].as_ref().unwrap().color,room.members[1].as_ref().unwrap().color);drop(room);
    std::fs::remove_dir_all(directory).unwrap();
}

#[tokio::test(flavor = "current_thread")]
async fn legacy_profiles_without_colors_keep_their_identity_when_restored() {
    let directory=std::env::temp_dir().join(format!("wild-wheels-legacy-color-{}",room::token()));
    std::fs::create_dir_all(&directory).unwrap();let path=directory.join("sessions.json");
    let token="a".repeat(64);let identity="b".repeat(64);
    std::fs::write(&path,json!([{"identity":identity,"token":token,"name":"Legacy","driver":7,"role":"driver","expires":sessions::now()+sessions::LIFETIME}]).to_string()).unwrap();
    let app=server(path);let (status,_,state)=post(&app,"/api/session",&format!("wild-wheels-session={token}"),json!({})).await;
    assert_eq!(status,StatusCode::OK);assert_eq!(state["world"]["name"],"Legacy");
    assert!(wild_wheels_core::PLAYER_COLORS.contains(&state["world"]["color"].as_str().unwrap()));
    assert_eq!(app.room.lock().unwrap().members[0].as_ref().unwrap().identity,identity);
    std::fs::remove_dir_all(directory).unwrap();
}

#[tokio::test(flavor = "current_thread")]
async fn match_colors_lock_until_finished_including_resume_and_rejoin_preferences() {
    let directory=std::env::temp_dir().join(format!("wild-wheels-color-lock-{}",room::token()));
    let app=server(directory.join("sessions.json"));
    let original=wild_wheels_core::PLAYER_COLORS[0];
    let requested=wild_wheels_core::PLAYER_COLORS[1];
    let (status,mut cookie,_)=post(&app,"/api/join","",json!({"code":"00","name":"Host","driver":0,"color":original})).await;
    assert_eq!(status,StatusCode::OK);
    assert_eq!(post(&app,"/api/control",&cookie,json!({"action":"start"})).await.0,StatusCode::OK);
    for phase in ["countdown","racing"] {
        assert_eq!(app.room.lock().unwrap().core.phase(),phase);
        assert_eq!(post(&app,"/api/color",&cookie,json!({"color":requested})).await.0,StatusCode::CONFLICT);
        for path in ["/api/session","/api/join"] {
            let (status,next,reply)=post(&app,path,&cookie,json!({"code":"00","name":"Host","driver":0,"color":requested})).await;
            assert_eq!(status,StatusCode::OK);assert_eq!(reply["world"]["color"],original);assert_eq!(reply["preferredColor"],original);
            cookie=next;
        }
        if phase=="countdown" {
            let mut room=app.room.lock().unwrap();
            for _ in 0..100 {
                if room.core.phase()!="countdown" { break; }
                room.core.step(wild_wheels_core::Frame {dt:0.05,inputs:vec![]}).unwrap();
            }
        }
    }
    {
        let mut room=app.room.lock().unwrap();
        for _ in 0..4000 {
            if room.core.phase()=="finished" { break; }
            room.core.step(wild_wheels_core::Frame {dt:0.05,inputs:vec![]}).unwrap();
        }
        assert_eq!(room.core.phase(),"finished");
    }
    assert_eq!(post(&app,"/api/color",&cookie,json!({"color":requested})).await.0,StatusCode::OK);
    assert_eq!(app.room.lock().unwrap().members[0].as_ref().unwrap().color,requested);
    std::fs::remove_dir_all(directory).unwrap();
}

#[tokio::test(flavor = "current_thread")]
async fn fixed_chat_colors_survive_vehicle_changes_afk_refresh_and_server_restart() {
    let directory=std::env::temp_dir().join(format!("wild-wheels-fixed-chat-color-{}",room::token()));
    let path=directory.join("sessions.json");
    let app=server(path.clone());
    let fixed=wild_wheels_core::PLAYER_COLORS[12];let vehicle=wild_wheels_core::PLAYER_COLORS[6];
    let (status,mut cookie,joined)=post(&app,"/api/join","",json!({"code":"00","name":"Host","driver":0,"color":fixed,"chatColor":vehicle})).await;
    assert_eq!(status,StatusCode::OK);assert_eq!(joined["chatColor"],fixed);
    assert_eq!(post(&app,"/api/color",&cookie,json!({"color":vehicle,"chatColor":vehicle})).await.0,StatusCode::OK);
    let (_,other_cookie,other)=post(&app,"/api/join","",json!({"code":"00","name":"Other","driver":1,"color":fixed})).await;
    assert_eq!(other["world"]["color"],fixed);assert_ne!(other["chatColor"],fixed);
    for body in [json!({"afk":true}),json!({"afk":false})] {
        let (status,next,reply)=post(&app,"/api/afk",&cookie,body).await;
        assert_eq!(status,StatusCode::OK);assert_eq!(reply["chatColor"],fixed);cookie=next;
    }
    let (status,next,reply)=post(&app,"/api/session",&cookie,json!({"chatColor":vehicle})).await;
    assert_eq!(status,StatusCode::OK);assert_eq!(reply["chatColor"],fixed);assert_eq!(reply["world"]["color"],vehicle);cookie=next;
    let (_,_,chat)=post(&app,"/api/chat",&cookie,json!({"text":"Stable color","chatColor":vehicle,"color":vehicle})).await;
    assert_eq!(chat["messages"][0]["color"],fixed);assert_eq!(chat["players"][0]["color"],fixed);
    let (_,_,answer)=post(&app,"/api/chat",&other_cookie,json!({"text":"Answer","replyTo":chat["messages"][0]["id"]})).await;
    assert_eq!(answer["messages"][1]["reply"]["color"],fixed);
    drop(app);
    let restarted=server(path);
    let (status,_,reply)=post(&restarted,"/api/session",&cookie,json!({})).await;
    assert_eq!(status,StatusCode::OK);assert_eq!(reply["chatColor"],fixed);assert_eq!(reply["world"]["color"],vehicle);
    std::fs::remove_dir_all(directory).unwrap();
}
