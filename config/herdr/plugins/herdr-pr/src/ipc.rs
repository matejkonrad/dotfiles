//! The daemon's own socket protocol (newline-delimited JSON), shared by the daemon,
//! the actions, and the board. Clients here are blocking: they live for one keypress.

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::model::{Check, Ci, Tone};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Request {
    Watch {
        workspace_id: String,
        pr: String,
    },
    Unwatch {
        workspace_id: String,
        pr: String,
    },
    /// Fix now: `pr` None means the workspace's own PR.
    Fix {
        workspace_id: String,
        pr: Option<String>,
    },
    FixComment {
        workspace_id: String,
        pr: String,
        comment_id: String,
    },
    /// Auto-fix on or off; `on` None toggles.
    Auto {
        workspace_id: String,
        pr: Option<String>,
        on: Option<bool>,
    },
    SetAgent {
        workspace_id: String,
        pr: String,
        pane_id: String,
    },
    Seen {
        workspace_id: String,
    },
    Refresh {
        workspace_id: Option<String>,
    },
    /// Keep the connection open and receive a `BoardView` line on every change.
    Subscribe {
        workspace_id: String,
    },
}

/// What the daemon answers. `need_agent` asks the client to pick a pane, then retry.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Reply {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub need_agent: Option<Vec<AgentView>>,
}

impl Reply {
    pub fn message(text: impl Into<String>) -> Reply {
        Reply {
            message: Some(text.into()),
            ..Reply::default()
        }
    }
    pub fn error(text: impl Into<String>) -> Reply {
        Reply {
            error: Some(text.into()),
            ..Reply::default()
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct BoardView {
    pub workspace: String,
    pub branch: Option<String>,
    pub prs: Vec<PrView>,
    pub agents: Vec<AgentView>,
    /// Why the data may be stale, e.g. "gh: not logged in".
    pub error: Option<String>,
    pub updated: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PrView {
    pub key: String,
    pub name: String,
    pub title: String,
    pub url: String,
    pub depth: usize,
    /// The PR of the workspace's checked-out branch.
    pub current: bool,
    pub draft: bool,
    pub ci: Ci,
    pub merge: String,
    pub merge_tone: Tone,
    pub review: String,
    pub head: String,
    pub base: String,
    /// Every check except skipped ones.
    pub checks: Vec<Check>,
    pub failed: Vec<Check>,
    /// Bot verdicts on the whole PR ("no issues", "2 issues"), shown on one line each.
    pub verdicts: Vec<VerdictView>,
    /// Review threads and comments, without verdicts: open threads first.
    pub comments: Vec<CommentView>,
    pub new_comments: usize,
    /// e.g. "auto · round 2 · waiting for CI"
    pub auto: Option<String>,
    pub agent: Option<String>,
    pub error: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CommentView {
    pub id: String,
    pub priority: Option<String>,
    pub text: String,
    pub author: String,
    pub location: Option<String>,
    pub url: String,
    pub resolved: Option<bool>,
    pub is_new: bool,
    /// The whole comment as plain text.
    pub body: String,
    /// e.g. "2h"
    pub age: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct VerdictView {
    pub author: String,
    pub text: String,
    pub good: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AgentView {
    pub pane_id: String,
    pub label: String,
    pub status: String,
}

pub fn state_dir() -> PathBuf {
    match std::env::var_os("HERDR_PLUGIN_STATE_DIR") {
        Some(dir) => dir.into(),
        None => PathBuf::from(std::env::var_os("HOME").unwrap_or_default())
            .join(".local/state/herdr-pr"),
    }
}

pub fn socket_path() -> PathBuf {
    state_dir().join("pr.sock")
}

pub fn connect() -> Result<UnixStream> {
    UnixStream::connect(socket_path()).context("herdr-pr daemon is not running")
}

pub fn send(request: &Request) -> Result<Reply> {
    let mut stream = connect()?;
    stream.write_all((serde_json::to_string(request)? + "\n").as_bytes())?;
    let mut line = String::new();
    BufReader::new(stream).read_line(&mut line)?;
    serde_json::from_str(&line).context("daemon reply")
}

/// The workspace an action or pane runs for.
pub fn current_workspace() -> Option<String> {
    for var in ["HERDR_PR_WORKSPACE", "HERDR_WORKSPACE_ID"] {
        if let Ok(id) = std::env::var(var)
            && !id.is_empty()
        {
            return Some(id);
        }
    }
    let context: Value =
        serde_json::from_str(&std::env::var("HERDR_PLUGIN_CONTEXT_JSON").ok()?).ok()?;
    ["/workspace_id", "/workspace/workspace_id", "/workspace/id"]
        .iter()
        .find_map(|p| context.pointer(p).and_then(Value::as_str))
        .map(str::to_string)
}

/// One blocking herdr request, for short-lived processes.
pub fn herdr_call(method: &str, params: Value) -> Result<Value> {
    let path = std::env::var_os("HERDR_SOCKET_PATH").context("HERDR_SOCKET_PATH is not set")?;
    let mut stream = UnixStream::connect(path)?;
    let line = json!({ "id": "herdr-pr", "method": method, "params": params }).to_string() + "\n";
    stream.write_all(line.as_bytes())?;
    let mut reply = String::new();
    BufReader::new(stream).read_line(&mut reply)?;
    let reply: Value = serde_json::from_str(&reply)?;
    if let Some(err) = reply.get("error") {
        anyhow::bail!(
            "{}",
            err.get("message")
                .and_then(Value::as_str)
                .unwrap_or("herdr error")
        );
    }
    Ok(reply.get("result").cloned().unwrap_or(Value::Null))
}

pub fn notify(title: &str, body: &str) {
    let _ = herdr_call("notification.show", json!({ "title": title, "body": body }));
}
