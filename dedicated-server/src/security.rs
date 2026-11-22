use super::*;

pub fn key_matches(expected: &str, presented: &str) -> bool {
    !expected.is_empty()
        && presented.len() == expected.len()
        && presented.bytes().zip(expected.bytes()).fold(0, |different, (a, b)| different | (a ^ b)) == 0
}

fn valid_host(host:&str)->bool{
    let Ok(uri)=format!("http://{host}").parse::<Uri>() else{return false;};
    uri.path()=="/"&&uri.query().is_none()&&uri.host().is_some()&&uri.authority().is_some_and(|a|a.as_str()==host&&!host.contains('@'))
}

pub fn same_origin(app: &App, h: &HeaderMap) -> bool {
    if h.get("sec-fetch-site")
        .is_some_and(|v| v == "cross-site" || v == "same-site")
    {
        return false;
    }
    let Some(origin) = h.get(header::ORIGIN) else {
        return !h.contains_key(header::COOKIE)
            || h.get("sec-fetch-site").is_some_and(|v| v == "same-origin");
    };
    let expected = match &app.origin {
        Some(origin) => origin.clone(),
        None => {
            let Some(host) = h.get(header::HOST).and_then(|v| v.to_str().ok()) else {
                return false;
            };
            format!("http://{host}")
        }
    };
    origin.to_str().is_ok_and(|v| v == expected)
}
pub fn same_origin_get(app: &App, h: &HeaderMap) -> bool {
    !h.get("sec-fetch-site")
        .is_some_and(|v| v == "cross-site" || v == "same-site")
        && (!h.contains_key(header::ORIGIN) || same_origin(app, h))
}
pub fn transport(app: &App, h: &HeaderMap, peer: IpAddr) -> bool {
    let Some(host) = h.get(header::HOST).and_then(|v| v.to_str().ok()) else {
        return false;
    };
    let secure = app.trust_proxy
        && peer.is_loopback()
        && h.get("x-forwarded-proto").is_some_and(|v| v == "https");
    let actual = format!("{}://{host}", if secure { "https" } else { "http" });
    match &app.origin {
        Some(expected) => &actual == expected,
        None => valid_host(host),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn app(origin: Option<&str>) -> App {
        App {
            stats: Default::default(),
            shutdown: tokio::sync::watch::channel(false).0,
            updates: Default::default(),
            sessions: Arc::new(tokio::sync::Mutex::new(sessions::Sessions::open(
                std::env::temp_dir().join(format!("wild-wheels-security-sessions-{}", room::token())), sessions::now(),
            ).unwrap())),
            photos: Default::default(),
            room: Arc::new(Mutex::new(Room::new(0, 0))),
            limits: Default::default(),
            logs: crate::logs::Logs::disabled(),
            sockets: Arc::new(Semaphore::new(32)),
            listener: ([127, 0, 0, 1], 5173).into(),
            origin: origin.map(str::to_owned),
            trust_proxy: true,
            invite_secret: None,
            text_store: None,
        }
    }
    #[test]
    fn exact_origins_and_missing_cookie_metadata() {
        let app = app(Some("https://game.example"));
        let mut h = HeaderMap::new();
        h.insert(header::HOST, "game.example".parse().unwrap());
        for origin in [
            "http://game.example",
            "https://game.example.attacker.invalid",
            "null",
            "https://game.example/",
        ] {
            h.insert(header::ORIGIN, origin.parse().unwrap());
            assert!(!same_origin(&app, &h));
        }
        h.insert(header::ORIGIN, "https://game.example".parse().unwrap());
        assert!(same_origin(&app, &h));
        h.insert("sec-fetch-site", "cross-site".parse().unwrap());
        assert!(!same_origin(&app, &h));
        h.remove("sec-fetch-site");
        h.remove(header::ORIGIN);
        h.insert(
            header::COOKIE,
            "wild-wheels-session=secret".parse().unwrap(),
        );
        assert!(!same_origin(&app, &h));
        h.insert("sec-fetch-site", "same-origin".parse().unwrap());
        assert!(same_origin(&app, &h));
    }
    #[test]
    fn only_trusted_loopback_https_proxy_may_serve_public_origin() {
        let app = app(Some("https://game.example"));
        let mut h = HeaderMap::new();
        h.insert(header::HOST, "game.example".parse().unwrap());
        let local = "127.0.0.1".parse().unwrap();
        assert!(!transport(&app, &h, local));
        h.insert("x-forwarded-proto", "https".parse().unwrap());
        assert!(transport(&app, &h, local));
        assert!(!transport(&app, &h, "203.0.113.7".parse().unwrap()));
        h.insert(header::HOST, "attacker.invalid".parse().unwrap());
        assert!(!transport(&app, &h, local));
    }
    #[test]
    fn configured_duckdns_http_origin_accepts_remote_players_and_rejects_other_hosts_and_origins() {
        let app=app(Some("http://wild-wheels.duckdns.org:5173"));
        let peer="203.0.113.7".parse().unwrap();
        let mut headers=HeaderMap::new();
        headers.insert(header::HOST,"wild-wheels.duckdns.org:5173".parse().unwrap());
        headers.insert(header::ORIGIN,"http://wild-wheels.duckdns.org:5173".parse().unwrap());
        assert!(transport(&app,&headers,peer));assert!(same_origin(&app,&headers));
        headers.insert(header::ORIGIN,"http://attacker.invalid".parse().unwrap());
        assert!(!same_origin(&app,&headers));
        headers.insert(header::HOST,"attacker.invalid:5173".parse().unwrap());
        assert!(!transport(&app,&headers,peer));
    }
    #[test]
    fn automatic_duckdns_http_origin_needs_no_domain_configuration_but_still_rejects_cross_origin_requests(){
        let app=app(None);let peer="203.0.113.7".parse().unwrap();let mut headers=HeaderMap::new();
        headers.insert(header::HOST,"wild-wheels.duckdns.org:5173".parse().unwrap());headers.insert(header::ORIGIN,"http://wild-wheels.duckdns.org:5173".parse().unwrap());
        assert!(transport(&app,&headers,peer));assert!(same_origin(&app,&headers));
        headers.remove(header::ORIGIN);headers.insert(header::COOKIE,"wild-wheels-session=secret".parse().unwrap());
        assert!(same_origin_get(&app,&headers));assert!(!same_origin(&app,&headers));
        headers.insert("sec-fetch-site","cross-site".parse().unwrap());assert!(!same_origin_get(&app,&headers));headers.remove("sec-fetch-site");
        headers.insert(header::ORIGIN,"http://attacker.invalid".parse().unwrap());assert!(!same_origin(&app,&headers));assert!(!same_origin_get(&app,&headers));
        headers.insert(header::HOST,"wild-wheels.duckdns.org:5173/path".parse().unwrap());assert!(!transport(&app,&headers,peer));
    }
    #[test]
    fn rate_limit_bookkeeping_stays_bounded_without_blocking_existing_buckets() {
        let app = app(None);
        let ip = "127.0.0.1".parse().unwrap();
        {
            let mut limits = app.limits.lock().unwrap();
            for n in 0..4096 {
                limits.insert((ip, format!("bucket-{n}")), (Instant::now(), 0));
            }
        }
        assert!(!limit(&app, ip, "new-bucket", 30, Duration::from_secs(1)));
        assert!(limit(&app, ip, "bucket-0", 30, Duration::from_secs(1)));
        assert_eq!(app.limits.lock().unwrap().len(), 4096);
    }
    #[tokio::test(flavor = "current_thread")]
    async fn public_invitation_secret_is_checked_before_allocating_a_slot() {
        let mut app = app(None);
        app.invite_secret = Some("a".repeat(64));
        let mut h = HeaderMap::new();
        h.insert(header::CONTENT_TYPE, "application/json".parse().unwrap());
        let body = |invite: &str| {
            Bytes::from(
                json!({"code":"00","name":"Guest","driver":null,"invite":invite}).to_string(),
            )
        };
        let address = ConnectInfo("127.0.0.1:1234".parse().unwrap());
        let denied = http(
            State(app.clone()),
            address,
            Method::POST,
            "/api/join".parse().unwrap(),
            h.clone(),
            body("wrong"),
        )
        .await;
        assert_eq!(denied.status(), 403);
        assert_eq!(app.room.lock().unwrap().count(), 0);
        let accepted = http(
            State(app.clone()),
            address,
            Method::POST,
            "/api/join".parse().unwrap(),
            h,
            body(&"a".repeat(64)),
        )
        .await;
        assert_eq!(accepted.status(), 200);
        assert_eq!(app.room.lock().unwrap().count(), 1);
    }
}
