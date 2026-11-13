use serde_json::{json, Value};
use std::{
    path::PathBuf,
    process::Stdio,
    time::{Duration, Instant},
};
use tokio::{process::Command, time::timeout};

#[derive(Default)]
pub struct Updates {
    root: Option<PathBuf>,
    checked: Option<(Instant, String)>,
    started: bool,
}
impl Updates {
    pub fn discover() -> Self {
        let root = std::env::current_dir().ok().filter(|root| {
            std::env::var("WILD_WHEELS_MANAGED").as_deref() == Ok("1")
                && root.join("update_server.sh").is_file()
        });
        Self {
            root,
            ..Self::default()
        }
    }
    async fn git(&self, args: &[&str]) -> crate::room::Result<String> {
        let root = self.root.as_ref().ok_or((
            409,
            "Start this server with ./run_server.sh to enable updates.",
        ))?;
        let output = timeout(
            Duration::from_secs(20),
            Command::new("git")
                .args(args)
                .current_dir(root)
                .env("GIT_TERMINAL_PROMPT", "0")
                .stdin(Stdio::null())
                .kill_on_drop(true)
                .output(),
        )
        .await
        .map_err(|_| (504, "GitHub update check timed out."))?
        .map_err(|_| (503, "Could not run Git. Check the server log."))?;
        if !output.status.success() {
            return Err((409, "Could not check updates. The checkout must be clean, on main, and able to reach origin."));
        }
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
    }
    async fn validate_checkout(&self) -> crate::room::Result<()> {
        if self.git(&["branch", "--show-current"]).await? != "main" {
            return Err((409, "Server updates require a checkout of main."));
        }
        if !self.git(&["status", "--porcelain"]).await?.is_empty() {
            return Err((
                409,
                "The server checkout has local changes. Commit or remove them before updating.",
            ));
        }
        Ok(())
    }
    pub async fn check(&mut self) -> crate::room::Result<Value> {
        if self.started {
            return Err((409, "The server is already updating."));
        }
        self.validate_checkout().await?;
        self.git(&[
            "fetch",
            "--quiet",
            "--no-tags",
            "origin",
            "refs/heads/main:refs/remotes/origin/main",
        ])
        .await?;
        self.git(&[
            "merge-base",
            "--is-ancestor",
            "HEAD",
            "refs/remotes/origin/main",
        ])
        .await?;
        let latest = self.git(&["rev-parse", "refs/remotes/origin/main"]).await?;
        let description = self
            .git(&["log", "-1", "--format=%h %s", "refs/remotes/origin/main"])
            .await?;
        let available = latest != crate::REVISION;
        self.checked = Some((Instant::now(), latest.clone()));
        Ok(
            json!({"available":available,"current":crate::REVISION,"latest":latest,"description":description}),
        )
    }
    pub async fn start(&mut self) -> crate::room::Result<Value> {
        if self.started {
            return Err((409, "The server is already updating."));
        }
        let (_, latest) = self
            .checked
            .as_ref()
            .filter(|(at, revision)| {
                at.elapsed() < Duration::from_secs(300) && revision != crate::REVISION
            })
            .ok_or((409, "Check for updates before updating the server."))?;
        self.validate_checkout().await?;
        self.git(&["merge-base", "--is-ancestor", "HEAD", latest]).await?;
        let root = self.root.clone().ok_or((
            409,
            "Start this server with ./run_server.sh to enable updates.",
        ))?;
        let log = std::env::var_os("WILD_WHEELS_RUN_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| root.join(".wild-wheels"))
            .join("update.log");
        tokio::task::spawn_blocking(move || -> std::io::Result<()> {
            let mut options = std::fs::OpenOptions::new();
            options.create(true).append(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let output = options.open(log)?;
            // nohup and independent output let the updater survive stopping this server.
            std::process::Command::new("nohup")
                .arg("bash")
                .arg(root.join("update_server.sh"))
                .arg("--from-web")
                .current_dir(root)
                .stdin(Stdio::null())
                .stderr(output.try_clone()?)
                .stdout(output)
                .spawn()?;
            Ok(())
        })
        .await
        .map_err(|_| (503, "Could not start the updater."))?
        .map_err(|_| {
            (
                503,
                "Could not start the updater. Check the server update log.",
            )
        })?;
        self.started = true;
        Ok(json!({"updating":true,"latest":latest}))
    }
}
