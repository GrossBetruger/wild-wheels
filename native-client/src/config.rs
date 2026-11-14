use std::error::Error;
use url::Url;

#[derive(Clone, Debug)]
pub struct Config {
    pub origin: Url,
    pub name: String,
    pub driver: usize,
    /// Join straight away instead of opening the menu; set by `--server`.
    pub join: bool,
    pub headless: bool,
    pub seconds: f64,
    /// Whether `--seconds` was given; a showcase otherwise runs until closed.
    pub timed: bool,
    pub auto_start: bool,
    pub screenshot: Option<String>,
    /// Play one racer's animations without a server; see showcase.rs.
    pub showcase: Option<String>,
    /// A directory for showcase screenshots.
    pub capture: Option<String>,
    /// Draw the showcase or a benchmark into an image instead of a window, so it
    /// neither needs the screen nor shows anything on it.
    pub offscreen: bool,
    pub sparring: bool,
    /// Measure frame times for this many seconds, then exit.
    pub benchmark: Option<f64>,
}
impl Config {
    pub fn from_args(args: impl Iterator<Item = String>) -> Result<Self, Box<dyn Error>> {
        let mut config = Self {
            origin: Url::parse("http://localhost:5173")?,
            name: "Native Pip".into(),
            driver: 0,
            join: false,
            headless: false,
            seconds: 8.0,
            timed: false,
            auto_start: false,
            screenshot: None,
            showcase: None,
            capture: None,
            offscreen: false,
            sparring: false,
            benchmark: None,
        };
        let mut args = args;
        while let Some(arg) = args.next() {
            match arg.as_str() {
                "--server" => {
                    config.origin = server_origin(&args.next().ok_or("--server requires a URL")?)?;
                    config.join = true;
                }
                "--name" => config.name = args.next().ok_or("--name requires a name")?,
                "--headless" => config.headless = true,
                "--sparring" => {
                    config.sparring = true;
                    config.headless = true;
                }
                "--auto-start" => config.auto_start = true,
                "--benchmark" => {
                    config.benchmark = Some(
                        args.next()
                            .ok_or("--benchmark requires a duration")?
                            .parse()?,
                    )
                }
                "--showcase" => {
                    config.showcase = Some(
                        args.next()
                            .ok_or("--showcase requires boost or rapid-fire")?,
                    )
                }
                "--capture" => {
                    config.capture = Some(args.next().ok_or("--capture requires a directory")?)
                }
                "--offscreen" => config.offscreen = true,
                "--screenshot" => {
                    config.screenshot = Some(args.next().ok_or("--screenshot requires a PNG path")?)
                }
                "--seconds" => {
                    config.timed = true;
                    config.seconds = args
                        .next()
                        .ok_or("--seconds requires a duration")?
                        .parse()?
                }
                "--help" => {
                    println!(
                        "Wild Wheels native arena client\nRun without options to choose a server, name and racer in the menu.\nDeveloper options: --server URL --name NAME [--auto-start] [--headless --seconds 8]\n--showcase boost|rapid-fire [--seconds 60] plays one racer's animations without a server"
                    );
                    std::process::exit(0);
                }
                _ => return Err(format!("Unknown option: {arg}").into()),
            }
        }
        config.name = player_name(&config.name)?;
        if !config.seconds.is_finite() || !(1.0..=300.0).contains(&config.seconds) {
            return Err("Duration must be 1–300 seconds".into());
        }
        Ok(config)
    }
}
/// The server's own rule for player names.
pub fn player_name(value: &str) -> Result<String, Box<dyn Error>> {
    let name = value.trim();
    if name.is_empty() || name.encode_utf16().count() > 24 {
        return Err("Name must have 1–24 characters".into());
    }
    Ok(name.to_owned())
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
