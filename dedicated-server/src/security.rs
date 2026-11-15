use super::*;

pub fn local_host(host: &str) -> bool {
    let Ok(uri) = format!("http://{host}").parse::<Uri>() else {
        return false;
    };
    if uri.path() != "/"
        || uri.query().is_some()
        || uri
            .authority()
            .is_none_or(|a| a.as_str() != host || host.contains('@'))
    {
        return false;
    }
    let Some(host) = uri.host() else {
        return false;
    };
    if matches!(host, "localhost" | "[::1]" | "::1") {
        return true;
    }
    host.parse::<IpAddr>().is_ok_and(|ip| match ip {
        IpAddr::V4(ip) => ip.is_loopback() || ip.is_private(),
        IpAddr::V6(ip) => ip.is_loopback(),
    })
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
pub fn transport(app: &App, h: &HeaderMap, peer: IpAddr) -> bool {
    let Some(host) = h.get(header::HOST).and_then(|v| v.to_str().ok()) else {
        return false;
    };
    let secure = app.trust_proxy
        && peer.is_loopback()
        && h.get("x-forwarded-proto").is_some_and(|v| v == "https");
    let actual = format!("{}://{host}", if secure { "https" } else { "http" });
    match &app.origin {
        Some(expected) => &actual == expected && (secure || local_host(host)),
        None => local_host(host),
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
            sockets: Arc::new(Semaphore::new(32)),
            origin: origin.map(str::to_owned),
            trust_proxy: true,
            invite_secret: None,
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
