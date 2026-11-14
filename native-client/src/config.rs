use std::error::Error;
use url::Url;

#[derive(Clone, Debug)]
pub struct Config {
    pub origin: Url,
    pub name: String,
    pub headless: bool,
    pub seconds: f64,
    pub auto_start: bool,
    pub screenshot: Option<String>,
    pub sparring: bool,
}
impl Config {
    pub fn from_args(args: impl Iterator<Item = String>) -> Result<Self, Box<dyn Error>> {
        let mut config = Self {
            origin: Url::parse("http://localhost:5173")?,
            name: "Native Pip".into(),
            headless: false,
            seconds: 8.0,
            auto_start: false,
            screenshot: None,
            sparring: false,
        };
        let mut args = args;
        while let Some(arg) = args.next() {
            match arg.as_str() {
                "--server" => {
                    config.origin = server_origin(&args.next().ok_or("--server requires a URL")?)?
                }
                "--name" => config.name = args.next().ok_or("--name requires a name")?,
                "--headless" => config.headless = true,
                "--sparring" => {
                    config.sparring = true;
                    config.headless = true;
                }
                "--auto-start" => config.auto_start = true,
                "--screenshot" => {
                    config.screenshot = Some(args.next().ok_or("--screenshot requires a PNG path")?)
                }
                "--seconds" => {
                    config.seconds = args
                        .next()
                        .ok_or("--seconds requires a duration")?
                        .parse()?
                }
                "--help" => {
                    println!(
                        "Wild Wheels native arena client\n--server URL --name NAME [--auto-start] [--headless --seconds 8]\nArrows/WASD: drive · Shift: drift · Space: fire · Tab/Command: weapon\nX: boost · C: chaff · Z: flip · Enter: start · Escape: AFK"
                    );
                    std::process::exit(0);
                }
                _ => return Err(format!("Unknown option: {arg}").into()),
            }
        }
        config.name = config.name.trim().to_owned();
        if config.name.is_empty() || config.name.encode_utf16().count() > 24 {
            return Err("Name must have 1–24 characters".into());
        }
        if !config.seconds.is_finite() || !(1.0..=300.0).contains(&config.seconds) {
            return Err("Duration must be 1–300 seconds".into());
        }
        Ok(config)
    }
}
pub fn server_origin(value: &str) -> Result<Url, Box<dyn Error>> {
    let mut url = Url::parse(value)?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("Use an HTTP(S) game URL without embedded credentials".into());
    }
    url.set_path("/");
    url.set_query(None);
    url.set_fragment(None);
    Ok(url)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn invitations_resolve_to_their_origin_and_credentials_are_rejected() {
        assert_eq!(
            server_origin("https://example.test:8443/?room=00")
                .unwrap()
                .as_str(),
            "https://example.test:8443/"
        );
        assert!(server_origin("file:///tmp/server").is_err());
        assert!(server_origin("https://secret@example.test").is_err());
    }
}
