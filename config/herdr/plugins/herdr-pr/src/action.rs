//! Keybind and link-handler actions: one request to the daemon, a toast with the answer, exit.

use anyhow::Result;
use serde_json::json;

use crate::ipc::{self, Reply, Request, notify};

const TITLE: &str = "herdr-pr";

/// `placement`: "popup" (centered, modal), "split" (a pane to the right that stays), or "tab".
pub fn open_board(workspace_id: &str, placement: &str) -> Result<()> {
    let mut params = json!({
        "plugin_id": "herdr-pr",
        "entrypoint": "board",
        "placement": placement,
        "focus": true,
        "env": { "HERDR_PR_WORKSPACE": workspace_id },
    });
    match placement {
        "popup" => {
            params["width"] = json!("84%");
            params["height"] = json!("76%");
        }
        "split" => params["direction"] = json!("right"),
        _ => {}
    }
    ipc::herdr_call("plugin.pane.open", params)?;
    Ok(())
}

fn show(reply: Reply, workspace_id: &str) {
    if reply.need_agent.is_some() {
        // Several agents here: the board asks which one, once per PR.
        if open_board(workspace_id, "popup").is_err() {
            notify(TITLE, "Several agents here; open the PR board to pick one.");
        }
    } else if let Some(err) = reply.error {
        notify(TITLE, &err);
    } else if let Some(message) = reply.message {
        notify(TITLE, &message);
    }
}

pub fn run(name: &str) -> Result<()> {
    let Some(ws) = ipc::current_workspace() else {
        notify(TITLE, "no workspace in the action context");
        anyhow::bail!("no workspace in the action context");
    };
    let request = match name {
        "board" => return open_board(&ws, "popup"),
        "board-split" => return open_board(&ws, "split"),
        "board-tab" => return open_board(&ws, "tab"),
        "fix" => Request::Fix {
            workspace_id: ws.clone(),
            pr: None,
        },
        "auto" => Request::Auto {
            workspace_id: ws.clone(),
            pr: None,
            on: None,
        },
        "seen" => Request::Seen {
            workspace_id: ws.clone(),
        },
        "refresh" => Request::Refresh {
            workspace_id: Some(ws.clone()),
        },
        other => anyhow::bail!("unknown action {other}"),
    };
    match ipc::send(&request) {
        Ok(reply) => show(reply, &ws),
        Err(_) => {
            notify(
                TITLE,
                "The daemon is not running. Run the action \"herdr-pr: start daemon\".",
            );
            anyhow::bail!("daemon not running");
        }
    }
    Ok(())
}

/// Ctrl-click on a GitHub PR URL: still open it, and watch it in this workspace.
pub fn link() -> Result<()> {
    let url = std::env::var("HERDR_PLUGIN_CLICKED_URL").unwrap_or_default();
    let opener = if cfg!(target_os = "macos") {
        "open"
    } else {
        "xdg-open"
    };
    let _ = std::process::Command::new(opener).arg(&url).spawn();
    let Some(ws) = ipc::current_workspace() else {
        return Ok(());
    };
    if let Ok(reply) = ipc::send(&Request::Watch {
        workspace_id: ws.clone(),
        pr: url,
    }) {
        show(reply, &ws);
    }
    Ok(())
}
