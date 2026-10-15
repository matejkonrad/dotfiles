//! herdr socket client: newline-delimited JSON over `HERDR_SOCKET_PATH`.
//! One long-lived connection for requests, one for the event subscription.

use std::fmt;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

use anyhow::{Context, Result, anyhow};
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;
use tokio::net::unix::{OwnedReadHalf, OwnedWriteHalf};
use tokio::sync::{Mutex, mpsc};

#[derive(Debug)]
pub struct HerdrError {
    pub code: String,
    pub message: String,
}

impl fmt::Display for HerdrError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "herdr {}: {}", self.code, self.message)
    }
}

impl std::error::Error for HerdrError {}

/// The herdr error code behind an error, e.g. "not_found" or "agent_blocked".
pub fn error_code(err: &anyhow::Error) -> Option<&str> {
    err.downcast_ref::<HerdrError>().map(|e| e.code.as_str())
}

type Conn = (BufReader<OwnedReadHalf>, OwnedWriteHalf);

pub struct Herdr {
    path: PathBuf,
    conn: Mutex<Option<Conn>>,
    next_id: AtomicU64,
}

async fn connect(path: &PathBuf) -> Result<Conn> {
    let stream = UnixStream::connect(path)
        .await
        .with_context(|| format!("connect {}", path.display()))?;
    let (read, write) = stream.into_split();
    Ok((BufReader::new(read), write))
}

fn result_of(line: &str) -> Result<Value> {
    let msg: Value = serde_json::from_str(line).context("herdr response")?;
    if let Some(err) = msg.get("error") {
        return Err(HerdrError {
            code: err
                .get("code")
                .and_then(Value::as_str)
                .unwrap_or("error")
                .into(),
            message: err
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("")
                .into(),
        }
        .into());
    }
    Ok(msg.get("result").cloned().unwrap_or(Value::Null))
}

async fn round_trip(conn: &mut Conn, id: &str, request: &str) -> Result<Value> {
    conn.1.write_all(request.as_bytes()).await?;
    let mut line = String::new();
    loop {
        line.clear();
        if conn.0.read_line(&mut line).await? == 0 {
            return Err(anyhow!("herdr closed the connection"));
        }
        let msg: Value = serde_json::from_str(&line).unwrap_or(Value::Null);
        if msg.get("id").and_then(Value::as_str) == Some(id) {
            return result_of(&line);
        }
    }
}

impl Herdr {
    pub fn new(path: PathBuf) -> Herdr {
        Herdr {
            path,
            conn: Mutex::new(None),
            next_id: AtomicU64::new(1),
        }
    }

    pub fn from_env() -> Result<Herdr> {
        let path = std::env::var_os("HERDR_SOCKET_PATH").context("HERDR_SOCKET_PATH is not set")?;
        Ok(Herdr::new(path.into()))
    }

    fn request(&self, method: &str, params: Value) -> (String, String) {
        let id = format!("pr_{}", self.next_id.fetch_add(1, Ordering::Relaxed));
        let line = json!({ "id": id, "method": method, "params": params }).to_string() + "\n";
        (id, line)
    }

    /// One request on the shared connection. Reconnects once if the connection went away.
    pub async fn call(&self, method: &str, params: Value) -> Result<Value> {
        let (id, line) = self.request(method, params);
        let mut guard = self.conn.lock().await;
        for attempt in 0..2 {
            if guard.is_none() {
                *guard = Some(connect(&self.path).await?);
            }
            let conn = guard.as_mut().expect("connected above");
            match round_trip(conn, &id, &line).await {
                Err(err) if err.downcast_ref::<HerdrError>().is_none() && attempt == 0 => {
                    *guard = None
                }
                other => return other,
            }
        }
        unreachable!("the second attempt returns")
    }

    /// A request on its own connection, for calls that block for a long time (agent.prompt with wait).
    pub async fn call_fresh(&self, method: &str, params: Value) -> Result<Value> {
        let (id, line) = self.request(method, params);
        let mut conn = connect(&self.path).await?;
        round_trip(&mut conn, &id, &line).await
    }

    pub async fn notify(&self, title: &str, body: &str) {
        let _ = self
            .call("notification.show", json!({ "title": title, "body": body }))
            .await;
    }

    /// Subscribes to lifecycle events. The channel ends with `Event::Lost` when the stream breaks.
    pub async fn subscribe(&self, types: &[&str]) -> Result<mpsc::Receiver<Event>> {
        let subs: Vec<Value> = types.iter().map(|t| json!({ "type": t })).collect();
        let (id, line) = self.request("events.subscribe", json!({ "subscriptions": subs }));
        let (mut read, mut write) = connect(&self.path).await?;
        write.write_all(line.as_bytes()).await?;
        let mut first = String::new();
        read.read_line(&mut first).await?;
        result_of(&first)?;
        let (tx, rx) = mpsc::channel(256);
        tokio::spawn(async move {
            let _write = write; // closing it would end the subscription
            let mut line = String::new();
            loop {
                line.clear();
                let event = match read.read_line(&mut line).await {
                    Ok(0) | Err(_) => Event::Lost,
                    Ok(_) => parse_event(&line, &id),
                };
                let lost = event == Event::Lost;
                if tx.send(event).await.is_err() || lost {
                    return;
                }
            }
        });
        Ok(rx)
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum Event {
    WorkspacesChanged,
    WorkspaceFocused(String),
    /// The stream broke or herdr dropped events: resnapshot and resubscribe.
    Lost,
    Other,
}

pub fn parse_event(line: &str, sub_id: &str) -> Event {
    let Ok(msg) = serde_json::from_str::<Value>(line) else {
        return Event::Other;
    };
    if msg.get("id").and_then(Value::as_str) == Some(sub_id) && msg.get("error").is_some() {
        return Event::Lost;
    }
    let kind = msg
        .get("event")
        .and_then(Value::as_str)
        .unwrap_or("")
        .replace('.', "_");
    match kind.as_str() {
        "workspace_focused" => match msg.pointer("/data/workspace_id").and_then(Value::as_str) {
            Some(id) => Event::WorkspaceFocused(id.to_string()),
            None => Event::Other,
        },
        "workspace_created" | "workspace_closed" | "worktree_created" | "worktree_opened"
        | "worktree_removed" => Event::WorkspacesChanged,
        _ => Event::Other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_lifecycle_events_and_losses() {
        let focused = r#"{"event":"workspace_focused","data":{"type":"workspace_focused","workspace_id":"w1V"}}"#;
        assert_eq!(
            parse_event(focused, "s"),
            Event::WorkspaceFocused("w1V".into())
        );
        let closed = r#"{"event":"workspace.closed","data":{"type":"workspace_closed","workspace_id":"w2"}}"#;
        assert_eq!(parse_event(closed, "s"), Event::WorkspacesChanged);
        let lost = r#"{"id":"s","error":{"code":"events_lost","message":"behind"}}"#;
        assert_eq!(parse_event(lost, "s"), Event::Lost);
        assert_eq!(
            parse_event(r#"{"event":"tab_focused","data":{}}"#, "s"),
            Event::Other
        );
        assert_eq!(parse_event("not json", "s"), Event::Other);
    }

    #[test]
    fn turns_error_responses_into_herdr_errors() {
        let err =
            result_of(r#"{"id":"1","error":{"code":"not_found","message":"pane not found"}}"#)
                .unwrap_err();
        assert_eq!(error_code(&err), Some("not_found"));
        assert_eq!(
            result_of(r#"{"id":"1","result":{"type":"pong"}}"#).unwrap()["type"],
            "pong"
        );
    }
}
