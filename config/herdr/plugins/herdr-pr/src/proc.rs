//! Child processes with a timeout, for `gh` and `git`.

use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use anyhow::{Context, Result, bail};
use tokio::process::Command;

pub struct Output {
    pub ok: bool,
    pub stdout: String,
    pub stderr: String,
}

impl Output {
    /// The first stderr line, for logs and the board.
    pub fn error_line(&self) -> String {
        self.stderr
            .lines()
            .find(|l| !l.trim().is_empty())
            .unwrap_or("command failed")
            .trim()
            .to_string()
    }
}

pub async fn run(
    program: &str,
    args: &[&str],
    cwd: Option<&Path>,
    timeout: Duration,
) -> Result<Output> {
    let mut cmd = Command::new(program);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    // gh pagers and prompts would hang a background process.
    cmd.env("GH_PAGER", "cat")
        .env("GH_PROMPT_DISABLED", "1")
        .env("NO_COLOR", "1");
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    let child = cmd.spawn().with_context(|| format!("spawn {program}"))?;
    let Ok(out) = tokio::time::timeout(timeout, child.wait_with_output()).await else {
        bail!("{program} timed out after {}s", timeout.as_secs());
    };
    let out = out?;
    Ok(Output {
        ok: out.status.success(),
        stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
    })
}
