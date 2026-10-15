//! The one background process: follows herdr workspaces, fetches PRs in one batch per tick,
//! writes the `$pr` sidebar token, runs auto-fix loops, and serves the actions and the board.

use std::collections::{BTreeMap, HashMap};
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result};
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::{mpsc, oneshot};
use tokio::time::sleep_until;

use crate::fixloop::{self, AutoState, Phase, Step};
use crate::forge::{AnyForge, Forge, ForgeKind, repo_from_remote};
use crate::herdr::{self, Event, Herdr};
use crate::ipc::{self, AgentView, BoardView, CommentView, PrView, Reply, Request, VerdictView};
use crate::model::{
    self, Ci, Mark, PrRef, PrState, PrStatus, comment_fix_prompt, fix_prompt, merge_readiness,
    short_name, summarize_comment, unresolved_threads, visible_comments,
};
use crate::proc;
use crate::stack::{AnyStack, Stack, StackBranch};
use crate::store::Store;

const FAST: Duration = Duration::from_secs(20);
const SLOW: Duration = Duration::from_secs(120);
/// Workspaces without a PR look for a new one this often.
const DISCOVERY: Duration = Duration::from_secs(300);
const STALE_FOCUS: Duration = Duration::from_secs(30);
const GIT_TIMEOUT: Duration = Duration::from_secs(10);
const SOURCE: &str = "herdr-pr";

macro_rules! log {
    ($($arg:tt)*) => { eprintln!("{} {}", iso(now_unix()), format!($($arg)*)) };
}

pub fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Unix seconds as "YYYY-MM-DDTHH:MM:SSZ", the format GitHub uses, so the two compare as strings.
pub fn iso(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60
    )
}

/// The inverse of `iso`, for GitHub timestamps.
pub fn parse_iso(text: &str) -> Option<u64> {
    let b = text.as_bytes();
    if b.len() < 19 {
        return None;
    }
    let num = |r: std::ops::Range<usize>| text.get(r)?.parse::<i64>().ok();
    let (y, m, d) = (num(0..4)?, num(5..7)?, num(8..10)?);
    let (hh, mm, ss) = (num(11..13)?, num(14..16)?, num(17..19)?);
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    u64::try_from(days * 86_400 + hh * 3600 + mm * 60 + ss).ok()
}

/// e.g. "5m", "3h", "2d".
pub fn age(created_at: &str, now: u64) -> String {
    let Some(at) = parse_iso(created_at) else {
        return String::new();
    };
    match now.saturating_sub(at) / 60 {
        m if m < 60 => format!("{m}m"),
        m if m < 60 * 24 => format!("{}h", m / 60),
        m => format!("{}d", m / 60 / 24),
    }
}

fn ago(at: Option<Instant>) -> String {
    match at {
        None => "never".into(),
        Some(at) => match at.elapsed().as_secs() {
            s if s < 60 => format!("{s}s ago"),
            s => format!("{}m ago", s / 60),
        },
    }
}

// ---- process lifecycle ----------------------------------------------------------------------

fn lock_path() -> PathBuf {
    ipc::state_dir().join("daemon.pid")
}

/// Holds an exclusive lock on the pid file for the life of the process. None if another holds it.
fn try_lock() -> Option<std::fs::File> {
    use std::os::fd::AsRawFd;
    let file = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(lock_path())
        .ok()?;
    // SAFETY: flock on an fd we own; the lock is released when the file closes.
    let locked = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } == 0;
    locked.then_some(file)
}

/// `herdr-pr daemon`: start the background process unless one runs, then return at once.
pub fn start() -> Result<()> {
    std::fs::create_dir_all(ipc::state_dir())?;
    match try_lock() {
        None => {
            println!("herdr-pr daemon already running");
            return Ok(());
        }
        Some(lock) => drop(lock),
    }
    let log = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(ipc::state_dir().join("daemon.log"))?;
    let mut cmd = std::process::Command::new(std::env::current_exe()?);
    cmd.args(["daemon", "--foreground"])
        .stdin(Stdio::null())
        .stdout(log.try_clone()?)
        .stderr(log);
    // SAFETY: setsid is async-signal-safe; it detaches the daemon from herdr's hook process group.
    unsafe {
        cmd.pre_exec(|| {
            libc::setsid();
            Ok(())
        });
    }
    cmd.spawn().context("spawn daemon")?;
    println!("herdr-pr daemon started");
    Ok(())
}

pub fn run_foreground() -> Result<()> {
    std::fs::create_dir_all(ipc::state_dir())?;
    let Some(_lock) = try_lock() else {
        return Ok(());
    };
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    rt.block_on(async {
        let herdr = Arc::new(Herdr::from_env()?);
        let (tx, rx) = mpsc::unbounded_channel();
        serve(tx.clone())?;
        log!("daemon up, pid {}", std::process::id());
        Daemon::new(herdr, tx).await.run(rx).await
    })
}

// ---- config -----------------------------------------------------------------------------------

#[derive(Default, Deserialize)]
struct RepoConfig {
    stack: Option<String>,
}

#[derive(Default, Deserialize)]
struct Config {
    #[serde(default)]
    repos: BTreeMap<String, RepoConfig>,
}

fn load_config() -> Config {
    let Some(dir) = std::env::var_os("HERDR_PLUGIN_CONFIG_DIR") else {
        return Config::default();
    };
    let path = PathBuf::from(dir).join("config.toml");
    match std::fs::read_to_string(&path) {
        Ok(text) => toml::from_str(&text).unwrap_or_else(|err| {
            log!("ignoring {}: {err}", path.display());
            Config::default()
        }),
        Err(_) => Config::default(),
    }
}

// ---- IPC server -------------------------------------------------------------------------------

enum Msg {
    Ipc(Request, oneshot::Sender<Reply>),
    Subscribe(String, mpsc::UnboundedSender<String>),
    RoundDone {
        key: String,
        pr: PrRef,
        outcome: Result<String, String>,
    },
}

fn serve(tx: mpsc::UnboundedSender<Msg>) -> Result<()> {
    let path = ipc::socket_path();
    let _ = std::fs::remove_file(&path); // a socket left by a crashed daemon; we hold the lock
    let listener = UnixListener::bind(&path).with_context(|| format!("bind {}", path.display()))?;
    tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            tokio::spawn(client(stream, tx.clone()));
        }
    });
    Ok(())
}

async fn client(stream: UnixStream, tx: mpsc::UnboundedSender<Msg>) {
    let (read, mut write) = stream.into_split();
    let mut lines = BufReader::new(read).lines();
    let Ok(Some(line)) = lines.next_line().await else {
        return;
    };
    let request: Request = match serde_json::from_str(&line) {
        Ok(r) => r,
        Err(err) => {
            let reply = serde_json::to_string(&Reply::error(format!("bad request: {err}")))
                .unwrap_or_default();
            let _ = write.write_all((reply + "\n").as_bytes()).await;
            return;
        }
    };
    if let Request::Subscribe { workspace_id } = request {
        let (view_tx, mut view_rx) = mpsc::unbounded_channel();
        if tx.send(Msg::Subscribe(workspace_id, view_tx)).is_err() {
            return;
        }
        // Views until the board closes. Commands arrive on their own connections.
        while let Some(view) = view_rx.recv().await {
            if write.write_all((view + "\n").as_bytes()).await.is_err() {
                return;
            }
        }
        return;
    }
    let (reply_tx, reply_rx) = oneshot::channel();
    if tx.send(Msg::Ipc(request, reply_tx)).is_err() {
        return;
    }
    let reply = reply_rx
        .await
        .unwrap_or_else(|_| Reply::error("daemon stopped"));
    let _ = write
        .write_all((serde_json::to_string(&reply).unwrap_or_default() + "\n").as_bytes())
        .await;
}

// ---- workspaces -------------------------------------------------------------------------------

struct Ws {
    id: String,
    label: String,
    /// Top of the git checkout, the store key.
    checkout: Option<PathBuf>,
    repo: Option<(ForgeKind, String)>,
    remote_checked: bool,
    branch: Option<String>,
    stack: Vec<StackBranch>,
    discovered: Vec<PrRef>,
    own: Option<PrRef>,
    discovered_at: Option<Instant>,
    token: Option<String>,
    token_written: bool,
}

impl Ws {
    fn key(&self) -> String {
        match &self.checkout {
            Some(path) => path.display().to_string(),
            None => format!("workspace:{}", self.id),
        }
    }
}

/// The checked-out branch, read from `HEAD` without a process. Handles linked worktrees.
pub fn read_branch(checkout: &Path) -> Option<String> {
    let dot_git = checkout.join(".git");
    let head = if dot_git.is_file() {
        let pointer = std::fs::read_to_string(&dot_git).ok()?;
        let gitdir = PathBuf::from(pointer.trim().strip_prefix("gitdir:")?.trim());
        let gitdir = if gitdir.is_absolute() {
            gitdir
        } else {
            checkout.join(gitdir)
        };
        gitdir.join("HEAD")
    } else {
        dot_git.join("HEAD")
    };
    let text = std::fs::read_to_string(head).ok()?;
    text.trim()
        .strip_prefix("ref: refs/heads/")
        .map(str::to_string)
}

#[derive(Clone)]
struct Agent {
    pane_id: String,
    workspace_id: String,
    label: String,
    status: String,
}

fn agents_from(list: &Value) -> Vec<Agent> {
    list.as_array()
        .into_iter()
        .flatten()
        .filter_map(|a| {
            let s = |k: &str| a.get(k).and_then(Value::as_str).unwrap_or("").to_string();
            let pane_id = s("pane_id");
            if pane_id.is_empty() {
                return None;
            }
            let title = s("terminal_title_stripped");
            let kind = s("agent");
            let label = if title.is_empty() || title == kind {
                kind
            } else {
                format!("{kind}: {title}")
            };
            Some(Agent {
                label: format!("{label} ({pane_id})"),
                pane_id,
                workspace_id: s("workspace_id"),
                status: s("agent_status"),
            })
        })
        .collect()
}

// ---- daemon -----------------------------------------------------------------------------------

struct Daemon {
    herdr: Arc<Herdr>,
    tx: mpsc::UnboundedSender<Msg>,
    stack: AnyStack,
    config: Config,
    store: Store,
    wss: BTreeMap<String, Ws>,
    prs: HashMap<PrRef, PrStatus>,
    pr_errors: HashMap<PrRef, String>,
    fetched_at: Option<Instant>,
    fetch_error: Option<String>,
    backoff: u32,
    me: String,
    agents: Vec<Agent>,
    subs: Vec<(String, mpsc::UnboundedSender<String>)>,
    next_tick: tokio::time::Instant,
}

impl Daemon {
    async fn new(herdr: Arc<Herdr>, tx: mpsc::UnboundedSender<Msg>) -> Daemon {
        let has_gh_stack = proc::run("gh", &["extension", "list"], None, GIT_TIMEOUT)
            .await
            .map(|o| o.stdout.contains("gh-stack") || o.stdout.contains("gh stack"))
            .unwrap_or(false);
        Daemon {
            herdr,
            tx,
            stack: if has_gh_stack {
                AnyStack::GhStack
            } else {
                AnyStack::Plain
            },
            config: load_config(),
            store: Store::load(ipc::state_dir().join("state.json")),
            wss: BTreeMap::new(),
            prs: HashMap::new(),
            pr_errors: HashMap::new(),
            fetched_at: None,
            fetch_error: None,
            backoff: 0,
            me: String::new(),
            agents: Vec::new(),
            subs: Vec::new(),
            next_tick: tokio::time::Instant::now(),
        }
    }

    fn forge(kind: ForgeKind) -> AnyForge {
        AnyForge::for_kind(kind)
    }

    fn stack_for(&self, repo: &str) -> AnyStack {
        self.config
            .repos
            .get(repo)
            .and_then(|r| r.stack.as_deref())
            .and_then(AnyStack::from_name)
            .unwrap_or(self.stack)
    }

    fn tick_soon(&mut self) {
        self.next_tick = tokio::time::Instant::now() + Duration::from_millis(200);
    }

    async fn run(mut self, mut rx: mpsc::UnboundedReceiver<Msg>) -> Result<()> {
        let mut events = self.resync().await;
        loop {
            tokio::select! {
                Some(msg) = rx.recv() => self.handle(msg).await,
                event = async {
                    match events.as_mut() {
                        Some(stream) => stream.recv().await.unwrap_or(Event::Lost),
                        None => std::future::pending().await,
                    }
                } => match event {
                    Event::Lost => {
                        log!("herdr event stream lost; resyncing");
                        tokio::time::sleep(Duration::from_secs(2)).await;
                        events = self.resync().await;
                    }
                    Event::WorkspacesChanged => {
                        self.sync_workspaces().await;
                        self.tick_soon();
                    }
                    Event::WorkspaceFocused(id) => {
                        let stale = self.fetched_at.is_none_or(|at| at.elapsed() > STALE_FOCUS);
                        if let Some(ws) = self.wss.get_mut(&id)
                            && ws.own.is_none() {
                                ws.discovered_at = None;
                            }
                        if stale {
                            self.tick_soon();
                        }
                    }
                    Event::Other => {}
                },
                _ = sleep_until(self.next_tick) => self.tick().await,
            }
        }
    }

    /// Subscribe, then read the authoritative state. None if herdr is not reachable yet.
    async fn resync(&mut self) -> Option<mpsc::Receiver<Event>> {
        let types = [
            "workspace.created",
            "workspace.closed",
            "workspace.focused",
            "worktree.created",
            "worktree.opened",
            "worktree.removed",
        ];
        let events = match self.herdr.subscribe(&types).await {
            Ok(rx) => Some(rx),
            Err(err) => {
                log!("subscribe failed: {err:#}");
                // Retry through the Lost path on the next loop turn.
                let (tx, rx) = mpsc::channel(1);
                tokio::spawn(async move {
                    tokio::time::sleep(Duration::from_secs(5)).await;
                    let _ = tx.send(Event::Lost).await;
                });
                Some(rx)
            }
        };
        self.sync_workspaces().await;
        self.tick_soon();
        events
    }

    async fn sync_workspaces(&mut self) {
        let snap = match self.herdr.call("session.snapshot", json!({})).await {
            Ok(v) => v,
            Err(err) => {
                log!("snapshot failed: {err:#}");
                return;
            }
        };
        let snap = snap.get("snapshot").unwrap_or(&snap);
        self.agents = agents_from(snap.get("agents").unwrap_or(&Value::Null));
        let mut seen = Vec::new();
        for w in snap
            .get("workspaces")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let Some(id) = w.get("workspace_id").and_then(Value::as_str) else {
                continue;
            };
            seen.push(id.to_string());
            let label = w
                .get("label")
                .and_then(Value::as_str)
                .unwrap_or(id)
                .to_string();
            if let Some(ws) = self.wss.get_mut(id) {
                ws.label = label;
                continue;
            }
            let mut checkout = w
                .pointer("/worktree/checkout_path")
                .and_then(Value::as_str)
                .map(PathBuf::from);
            if checkout.is_none() {
                // Not a herdr worktree workspace: use the git top of any pane's directory.
                let cwd = snap
                    .get("panes")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter(|p| p.get("workspace_id").and_then(Value::as_str) == Some(id))
                    .find_map(|p| p.get("cwd").and_then(Value::as_str).map(str::to_string));
                if let Some(cwd) = cwd
                    && let Ok(out) = proc::run(
                        "git",
                        &["-C", &cwd, "rev-parse", "--show-toplevel"],
                        None,
                        GIT_TIMEOUT,
                    )
                    .await
                    && out.ok
                {
                    checkout = Some(PathBuf::from(out.stdout.trim()));
                }
            }
            self.wss.insert(
                id.to_string(),
                Ws {
                    id: id.to_string(),
                    label,
                    checkout,
                    repo: None,
                    remote_checked: false,
                    branch: None,
                    stack: Vec::new(),
                    discovered: Vec::new(),
                    own: None,
                    discovered_at: None,
                    token: None,
                    token_written: false,
                },
            );
        }
        self.wss.retain(|id, _| seen.contains(id));
        self.subs
            .retain(|(id, tx)| seen.contains(id) && !tx.is_closed());
    }

    /// Finds the workspace's PRs: its stack's, or its branch's. Only when something changed.
    async fn discover(&mut self, id: &str, force: bool) {
        let Some(ws) = self.wss.get_mut(id) else {
            return;
        };
        let Some(checkout) = ws.checkout.clone() else {
            return;
        };
        if !ws.remote_checked {
            ws.remote_checked = true;
            if let Ok(out) = proc::run(
                "git",
                &["remote", "get-url", "origin"],
                Some(&checkout),
                GIT_TIMEOUT,
            )
            .await
            {
                ws.repo = if out.ok {
                    repo_from_remote(&out.stdout)
                } else {
                    None
                };
            }
        }
        let Some((kind, repo)) = ws.repo.clone() else {
            return;
        };
        let branch = read_branch(&checkout);
        let changed = branch != ws.branch;
        let due = ws
            .discovered_at
            .is_none_or(|at| ws.own.is_none() && at.elapsed() > DISCOVERY);
        if !(force || changed || due) {
            return;
        }
        ws.branch = branch.clone();
        ws.discovered_at = Some(Instant::now());
        let Some(branch) = branch else {
            ws.stack.clear();
            ws.discovered.clear();
            ws.own = None;
            return;
        };
        let stack = self.stack_for(&repo);
        let branches = stack
            .stack_of(&checkout, &branch)
            .await
            .unwrap_or_else(|err| {
                log!("stack lookup in {}: {err:#}", checkout.display());
                None
            });
        let (stack_list, discovered, own) = match branches {
            Some(list) => {
                let prs: Vec<PrRef> = list
                    .iter()
                    .filter_map(|b| b.pr)
                    .map(|number| PrRef {
                        repo: repo.clone(),
                        number,
                    })
                    .collect();
                let own = list
                    .iter()
                    .find(|b| b.name == branch)
                    .and_then(|b| b.pr)
                    .map(|number| PrRef {
                        repo: repo.clone(),
                        number,
                    });
                (list, prs, own)
            }
            None => {
                let own = Self::forge(kind)
                    .pr_for_branch(&repo, &branch)
                    .await
                    .unwrap_or_else(|err| {
                        log!("PR lookup for {branch}: {err:#}");
                        None
                    });
                (Vec::new(), own.iter().cloned().collect(), own)
            }
        };
        let Some(ws) = self.wss.get_mut(id) else {
            return;
        };
        ws.stack = stack_list;
        ws.discovered = discovered;
        ws.own = own;
    }

    /// Discovered and manual PRs, minus hidden ones, in stack order.
    fn watched(&mut self, id: &str) -> Vec<PrRef> {
        let Some(ws) = self.wss.get(id) else {
            return Vec::new();
        };
        let (key, discovered) = (ws.key(), ws.discovered.clone());
        let store = self.store.ws(&key);
        let mut list: Vec<PrRef> = Vec::new();
        for pr in discovered.iter().chain(store.manual.iter()) {
            if !store.hidden.contains(pr) && !list.contains(pr) {
                list.push(pr.clone());
            }
        }
        list
    }

    /// The PR the sidebar token and the keybind actions mean: the branch's, else the first watched.
    fn main_pr(&mut self, id: &str) -> Option<PrRef> {
        let own = self.wss.get(id)?.own.clone();
        let watched = self.watched(id);
        own.filter(|pr| watched.contains(pr))
            .or_else(|| watched.into_iter().next())
    }

    async fn tick(&mut self) {
        if let Ok(list) = self.herdr.call("agent.list", json!({})).await {
            self.agents = agents_from(list.get("agents").unwrap_or(&Value::Null));
        }
        let ids: Vec<String> = self.wss.keys().cloned().collect();
        for id in &ids {
            self.discover(id, false).await;
        }
        let mut all: Vec<PrRef> = Vec::new();
        for id in &ids {
            for pr in self.watched(id) {
                if !all.contains(&pr) {
                    all.push(pr);
                }
            }
        }
        if !all.is_empty() {
            self.fetch(&all).await;
        }
        for id in &ids {
            self.write_token(id).await;
        }
        for id in &ids {
            self.run_loops(id).await;
        }
        if let Err(err) = self.store.save() {
            log!("saving state: {err:#}");
        }
        self.push_views();
        self.next_tick = tokio::time::Instant::now() + self.interval(&all);
    }

    fn interval(&self, all: &[PrRef]) -> Duration {
        if all.is_empty() {
            return DISCOVERY;
        }
        if self.fetch_error.is_some() {
            return (FAST * 2u32.saturating_pow(self.backoff.min(5))).min(Duration::from_secs(600));
        }
        let busy = all
            .iter()
            .filter_map(|pr| self.prs.get(pr))
            .any(|s| s.state == PrState::Open && s.ci() == Ci::Running)
            || self
                .store
                .data
                .workspaces
                .values()
                .any(|w| !w.auto.is_empty());
        if busy { FAST } else { SLOW }
    }

    async fn fetch(&mut self, all: &[PrRef]) {
        if self.me.is_empty() {
            self.me = Self::forge(ForgeKind::Github)
                .viewer()
                .await
                .unwrap_or_default();
        }
        match Self::forge(ForgeKind::Github).fetch(all).await {
            Ok(list) => {
                self.fetch_error = None;
                self.backoff = 0;
                self.fetched_at = Some(Instant::now());
                for (pr, result) in list {
                    match result {
                        Ok(status) => {
                            self.pr_errors.remove(&pr);
                            if status.state != PrState::Open {
                                self.retire(&pr);
                            }
                            self.prs.insert(pr, status);
                        }
                        Err(err) => {
                            self.pr_errors.insert(pr, err);
                        }
                    }
                }
            }
            Err(err) => {
                log!("fetch failed: {err:#}");
                self.fetch_error = Some(format!("{err:#}"));
                self.backoff += 1;
            }
        }
    }

    /// A merged or closed PR leaves every workspace for good.
    fn retire(&mut self, pr: &PrRef) {
        for ws in self.store.data.workspaces.values_mut() {
            ws.manual.retain(|p| p != pr);
            if !ws.hidden.contains(pr) {
                ws.hidden.push(pr.clone());
            }
        }
    }

    async fn write_token(&mut self, id: &str) {
        let watched = self.watched(id);
        let Some(key) = self.wss.get(id).map(Ws::key) else {
            return;
        };
        let store = self.store.data.workspaces.get(&key);
        let auto = watched
            .iter()
            .any(|pr| store.is_some_and(|w| w.auto.contains_key(&pr.key())));
        let stale =
            self.fetch_error.is_some() || watched.iter().any(|pr| self.pr_errors.contains_key(pr));
        let prs: Vec<(&PrStatus, usize)> = watched
            .iter()
            .filter_map(|pr| self.prs.get(pr))
            .map(|s| (s, unresolved_threads(s, &self.me).len()))
            .collect();
        let mark = model::mark(&prs, auto, stale);
        let text = mark.map(|m| m.token().to_string());
        let Some(ws) = self.wss.get_mut(id) else {
            return;
        };
        if ws.token_written && ws.token == text {
            return;
        }
        // One token per mark, so the herdr config can color each; the others are cleared.
        let mut tokens = serde_json::Map::new();
        // Tokens of earlier versions.
        tokens.insert("pr".into(), Value::Null);
        tokens.insert("pr_none".into(), Value::Null);
        for m in Mark::ALL {
            let value = if Some(m) == mark {
                json!(m.glyph())
            } else {
                Value::Null
            };
            tokens.insert(m.token().into(), value);
        }
        let params = json!({ "workspace_id": id, "source": SOURCE, "tokens": tokens });
        if self
            .herdr
            .call("workspace.report_metadata", params)
            .await
            .is_ok()
        {
            ws.token = text;
            ws.token_written = true;
        }
    }

    fn agent_status(&self, pane_id: &str) -> Option<&str> {
        self.agents
            .iter()
            .find(|a| a.pane_id == pane_id)
            .map(|a| a.status.as_str())
    }

    async fn run_loops(&mut self, id: &str) {
        let Some(ws) = self.wss.get(id) else { return };
        let (key, repo) = (ws.key(), ws.repo.clone());
        let entries: Vec<(String, AutoState)> = self
            .store
            .ws(&key)
            .auto
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();
        for (pr_key, state) in entries {
            let Some(pr) = PrRef::parse(&pr_key) else {
                continue;
            };
            let Some(status) = self.prs.get(&pr).cloned() else {
                continue;
            };
            let pane = self
                .store
                .ws(&key)
                .agent
                .get(&pr_key)
                .cloned()
                .unwrap_or_default();
            let agent = self.agent_status(&pane).map(str::to_string);
            match fixloop::next_step(&status, &state, agent.as_deref(), &self.me, now_unix()) {
                Step::Wait => {}
                Step::Stop(reason) => {
                    self.store.ws(&key).auto.remove(&pr_key);
                    log!("auto-fix stopped for {pr_key}: {}", reason.text());
                    self.herdr
                        .notify(
                            &format!("herdr-pr: auto-fix stopped for {}", short_name(&pr)),
                            reason.text(),
                        )
                        .await;
                }
                Step::Start {
                    checks,
                    threads,
                    sig,
                } => {
                    let forge =
                        Self::forge(repo.as_ref().map(|r| r.0).unwrap_or(ForgeKind::Github));
                    let mut with_logs = Vec::new();
                    for check in checks {
                        let log = forge.check_log(&pr.repo, &check).await.unwrap_or_default();
                        with_logs.push((check, log));
                    }
                    let thread_refs: Vec<&model::Comment> = threads.iter().collect();
                    let text = fix_prompt(
                        &status,
                        &with_logs,
                        &thread_refs,
                        self.stack_for(&pr.repo).push_command(),
                    );
                    let next = fixloop::started(&state, &status, &sig, &threads);
                    log!("auto-fix round {} for {pr_key} via {pane}", next.rounds);
                    self.store.ws(&key).auto.insert(pr_key.clone(), next);
                    self.send_round(key.clone(), pr, pane, text);
                }
            }
        }
    }

    /// Sends a round's prompt on its own connection and reports back when the agent settles.
    fn send_round(&self, key: String, pr: PrRef, pane: String, text: String) {
        let (herdr, tx) = (self.herdr.clone(), self.tx.clone());
        tokio::spawn(async move {
            let params = json!({
                "target": pane,
                "text": text,
                "wait": { "until": ["idle", "done", "blocked"], "timeout_ms": 3_600_000u64 },
            });
            let outcome = match herdr.call_fresh("agent.prompt", params).await {
                Ok(result) => Ok(result
                    .pointer("/agent/agent_status")
                    .and_then(Value::as_str)
                    .unwrap_or("idle")
                    .to_string()),
                Err(err) if herdr::error_code(&err) == Some("agent_blocked") => {
                    Ok("blocked".to_string())
                }
                Err(err) => Err(format!("{err:#}")),
            };
            let _ = tx.send(Msg::RoundDone { key, pr, outcome });
        });
    }

    async fn round_done(&mut self, key: String, pr: PrRef, outcome: Result<String, String>) {
        let Some(state) = self.store.ws(&key).auto.get_mut(&pr.key()) else {
            return;
        };
        state.ended_at = now_unix();
        let blocked = match &outcome {
            Ok(status) => status == "blocked",
            Err(_) => true,
        };
        state.phase = if blocked {
            Phase::WaitingAgent
        } else {
            Phase::WaitingCi
        };
        match outcome {
            Ok(status) if status == "blocked" => {
                self.herdr
                    .notify(
                        &format!("herdr-pr: {} needs you", short_name(&pr)),
                        "The fixing agent is asking something.",
                    )
                    .await;
            }
            Err(err) => {
                log!("round for {} failed: {err}", pr.key());
                self.herdr
                    .notify(
                        &format!("herdr-pr: fix round failed for {}", short_name(&pr)),
                        &err,
                    )
                    .await;
            }
            Ok(_) => {}
        }
        let _ = self.store.save();
        self.tick_soon();
    }

    // ---- requests --------------------------------------------------------------------------

    async fn handle(&mut self, msg: Msg) {
        match msg {
            Msg::Ipc(request, reply) => {
                let answer = self.request(request).await;
                let _ = reply.send(answer);
                let _ = self.store.save();
                self.push_views();
            }
            Msg::Subscribe(id, tx) => {
                let view = serde_json::to_string(&self.view(&id)).unwrap_or_default();
                if tx.send(view).is_ok() {
                    self.subs.push((id, tx));
                }
            }
            Msg::RoundDone { key, pr, outcome } => self.round_done(key, pr, outcome).await,
        }
    }

    fn resolve_pr(&mut self, id: &str, pr: Option<&str>) -> Result<PrRef, Reply> {
        match pr {
            Some(text) => PrRef::parse(text)
                .ok_or_else(|| Reply::error(format!("not a PR reference: {text}"))),
            None => self
                .main_pr(id)
                .ok_or_else(|| Reply::error("no PR in this workspace")),
        }
    }

    /// The agent pane for a PR: the stored one, else the only agent in the workspace.
    fn agent_for(&mut self, id: &str, pr: &PrRef) -> Result<String, Reply> {
        let Some(key) = self.wss.get(id).map(Ws::key) else {
            return Err(Reply::error("unknown workspace"));
        };
        if let Some(pane) = self.store.ws(&key).agent.get(&pr.key()).cloned()
            && self.agent_status(&pane).is_some()
        {
            return Ok(pane);
        }
        let here: Vec<AgentView> = self
            .agents
            .iter()
            .filter(|a| a.workspace_id == id)
            .map(|a| AgentView {
                pane_id: a.pane_id.clone(),
                label: a.label.clone(),
                status: a.status.clone(),
            })
            .collect();
        match here.as_slice() {
            [] => Err(Reply::error(
                "no agent in this workspace to send the fix to",
            )),
            [only] => {
                self.store
                    .ws(&key)
                    .agent
                    .insert(pr.key(), only.pane_id.clone());
                Ok(only.pane_id.clone())
            }
            _ => Err(Reply {
                need_agent: Some(here),
                ..Reply::default()
            }),
        }
    }

    async fn request(&mut self, request: Request) -> Reply {
        let id = match &request {
            Request::Watch { workspace_id, .. }
            | Request::Unwatch { workspace_id, .. }
            | Request::Fix { workspace_id, .. }
            | Request::FixComment { workspace_id, .. }
            | Request::Auto { workspace_id, .. }
            | Request::SetAgent { workspace_id, .. }
            | Request::Seen { workspace_id }
            | Request::Subscribe { workspace_id } => Some(workspace_id.clone()),
            Request::Refresh { workspace_id } => workspace_id.clone(),
        };
        if let Some(id) = &id {
            if !self.wss.contains_key(id) {
                self.sync_workspaces().await;
            }
            if !self.wss.contains_key(id) {
                return Reply::error(format!("unknown workspace {id}"));
            }
        }
        let id = id.unwrap_or_default();
        let key = self.wss.get(&id).map(Ws::key).unwrap_or_default();
        match request {
            Request::Watch { pr, .. } => match PrRef::parse(&pr) {
                Some(pr) => {
                    let store = self.store.ws(&key);
                    store.hidden.retain(|p| p != &pr);
                    if !store.manual.contains(&pr) {
                        store.manual.push(pr.clone());
                    }
                    self.tick_soon();
                    Reply::message(format!("watching {}", short_name(&pr)))
                }
                None => Reply::error(format!("not a PR reference: {pr}")),
            },
            Request::Unwatch { pr, .. } => match PrRef::parse(&pr) {
                Some(pr) => {
                    let store = self.store.ws(&key);
                    store.manual.retain(|p| p != &pr);
                    store.auto.remove(&pr.key());
                    if !store.hidden.contains(&pr) {
                        store.hidden.push(pr.clone());
                    }
                    self.tick_soon();
                    Reply::message(format!("stopped watching {}", short_name(&pr)))
                }
                None => Reply::error(format!("not a PR reference: {pr}")),
            },
            Request::Fix { pr, .. } => {
                let pr = match self.resolve_pr(&id, pr.as_deref()) {
                    Ok(pr) => pr,
                    Err(reply) => return reply,
                };
                let Some(status) = self.prs.get(&pr).cloned() else {
                    return Reply::error("no data for this PR yet");
                };
                let pane = match self.agent_for(&id, &pr) {
                    Ok(pane) => pane,
                    Err(reply) => return reply,
                };
                let threads = unresolved_threads(&status, &self.me);
                let failed = status.failed_checks();
                if failed.is_empty() && threads.is_empty() {
                    return Reply::message(format!("{}: nothing to fix", short_name(&pr)));
                }
                let mut with_logs = Vec::new();
                for check in failed {
                    let log = Self::forge(ForgeKind::Github)
                        .check_log(&pr.repo, check)
                        .await
                        .unwrap_or_default();
                    with_logs.push((check.clone(), log));
                }
                let text = fix_prompt(
                    &status,
                    &with_logs,
                    &threads,
                    self.stack_for(&pr.repo).push_command(),
                );
                self.prompt(&pane, &text, &pr).await
            }
            Request::FixComment { pr, comment_id, .. } => {
                let Some(pr) = PrRef::parse(&pr) else {
                    return Reply::error("bad PR");
                };
                let Some(status) = self.prs.get(&pr).cloned() else {
                    return Reply::error("no data for this PR yet");
                };
                let Some(comment) = status.comments.iter().find(|c| c.id == comment_id) else {
                    return Reply::error("comment not found");
                };
                let pane = match self.agent_for(&id, &pr) {
                    Ok(pane) => pane,
                    Err(reply) => return reply,
                };
                let text =
                    comment_fix_prompt(&status, comment, self.stack_for(&pr.repo).push_command());
                self.prompt(&pane, &text, &pr).await
            }
            Request::Auto { pr, on, .. } => {
                let pr = match self.resolve_pr(&id, pr.as_deref()) {
                    Ok(pr) => pr,
                    Err(reply) => return reply,
                };
                let is_on = self.store.ws(&key).auto.contains_key(&pr.key());
                if !on.unwrap_or(!is_on) {
                    self.store.ws(&key).auto.remove(&pr.key());
                    self.tick_soon();
                    return Reply::message(format!("auto-fix off for {}", short_name(&pr)));
                }
                if let Err(reply) = self.agent_for(&id, &pr) {
                    return reply;
                }
                if !is_on {
                    self.store
                        .ws(&key)
                        .auto
                        .insert(pr.key(), AutoState::default());
                }
                self.tick_soon();
                Reply::message(format!("auto-fix on for {}", short_name(&pr)))
            }
            Request::SetAgent { pr, pane_id, .. } => match PrRef::parse(&pr) {
                Some(pr) => {
                    self.store.ws(&key).agent.insert(pr.key(), pane_id);
                    Reply::message("agent set")
                }
                None => Reply::error("bad PR"),
            },
            Request::Seen { .. } => {
                let now = iso(now_unix());
                for pr in self.watched(&id) {
                    self.store.ws(&key).seen_at.insert(pr.key(), now.clone());
                }
                Reply::message("marked as seen")
            }
            Request::Refresh { .. } => {
                let ids: Vec<String> = if id.is_empty() {
                    self.wss.keys().cloned().collect()
                } else {
                    vec![id.clone()]
                };
                for one in ids {
                    self.discover(&one, true).await;
                }
                self.tick_soon();
                Reply::message("refreshing")
            }
            Request::Subscribe { .. } => Reply::error("subscribe on its own connection"),
        }
    }

    async fn prompt(&self, pane: &str, text: &str, pr: &PrRef) -> Reply {
        match self
            .herdr
            .call("agent.prompt", json!({ "target": pane, "text": text }))
            .await
        {
            Ok(_) => Reply::message(format!("sent {} to {pane}", short_name(pr))),
            Err(err) if herdr::error_code(&err) == Some("agent_blocked") => {
                Reply::error("the agent is waiting for an answer; reply to it first")
            }
            Err(err) => Reply::error(format!("{err:#}")),
        }
    }

    // ---- board views ------------------------------------------------------------------------

    fn push_views(&mut self) {
        self.subs.retain(|(_, tx)| !tx.is_closed());
        let ids: Vec<String> = self.subs.iter().map(|(id, _)| id.clone()).collect();
        for id in ids {
            let view = serde_json::to_string(&self.view(&id)).unwrap_or_default();
            for (_, tx) in self.subs.iter().filter(|(sub, _)| *sub == id) {
                let _ = tx.send(view.clone());
            }
        }
    }

    fn view(&mut self, id: &str) -> BoardView {
        let watched = self.watched(id);
        let Some(ws) = self.wss.get(id) else {
            return BoardView::default();
        };
        let (key, label, branch, own) = (
            ws.key(),
            ws.label.clone(),
            ws.branch.clone(),
            ws.own.clone(),
        );
        let statuses: Vec<&PrStatus> = watched.iter().filter_map(|pr| self.prs.get(pr)).collect();
        let order = model::order_as_stacks(&statuses);
        let store = self.store.data.workspaces.get(&key);
        let mut prs: Vec<PrView> = order
            .iter()
            .map(|&(i, depth)| {
                let s = statuses[i];
                let seen = store
                    .and_then(|w| w.seen_at.get(&s.pr.key()))
                    .map(String::as_str)
                    .unwrap_or("");
                let now = now_unix();
                let visible = visible_comments(s, &self.me);
                let verdicts: Vec<VerdictView> = visible
                    .iter()
                    .filter(|c| model::is_verdict(c))
                    .map(|c| {
                        let (text, good) = model::verdict_text(c);
                        VerdictView {
                            author: model::short_author(&c.author),
                            text,
                            good,
                        }
                    })
                    .collect();
                let comments: Vec<CommentView> = visible
                    .into_iter()
                    .filter(|c| !model::is_verdict(c))
                    .map(|c| {
                        let (priority, text) = summarize_comment(&c.body);
                        CommentView {
                            id: c.id.clone(),
                            priority,
                            text,
                            author: model::short_author(&c.author),
                            location: c.location.clone(),
                            url: c.url.clone(),
                            resolved: c.resolved,
                            is_new: c.created_at.as_str() > seen,
                            body: model::comment_plain_text(&c.body),
                            age: age(&c.created_at, now),
                        }
                    })
                    .collect();
                let auto = store.and_then(|w| w.auto.get(&s.pr.key())).map(|a| {
                    let phase = match a.phase {
                        Phase::Ready => "ready",
                        Phase::Running => "agent working",
                        Phase::WaitingCi => "waiting for CI",
                        Phase::WaitingAgent => "agent needs you",
                    };
                    format!("auto · round {} · {phase}", a.rounds)
                });
                let (merge, merge_tone) = merge_readiness(s);
                PrView {
                    key: s.pr.key(),
                    name: short_name(&s.pr),
                    title: s.title.clone(),
                    url: s.url.clone(),
                    depth,
                    current: own.as_ref() == Some(&s.pr),
                    draft: s.draft,
                    ci: s.ci(),
                    merge: merge.to_string(),
                    merge_tone,
                    review: s.review_decision.to_lowercase().replace('_', " "),
                    head: s.head.clone(),
                    base: s.base.clone(),
                    checks: s
                        .checks
                        .iter()
                        .filter(|c| c.state != model::CheckState::Skipped)
                        .cloned()
                        .collect(),
                    failed: s.failed_checks().into_iter().cloned().collect(),
                    verdicts,
                    new_comments: comments.iter().filter(|c| c.is_new).count(),
                    comments,
                    auto,
                    agent: store.and_then(|w| w.agent.get(&s.pr.key())).cloned(),
                    error: self.pr_errors.get(&s.pr).cloned(),
                }
            })
            .collect();
        // PRs with no data yet still show, so a just-watched PR is visible.
        for pr in watched.iter().filter(|pr| !self.prs.contains_key(pr)) {
            prs.push(PrView {
                key: pr.key(),
                name: short_name(pr),
                title: String::new(),
                url: format!("https://github.com/{}/pull/{}", pr.repo, pr.number),
                depth: 0,
                current: own.as_ref() == Some(pr),
                draft: false,
                ci: Ci::None,
                merge: String::new(),
                merge_tone: model::Tone::Inactive,
                review: String::new(),
                head: String::new(),
                base: String::new(),
                checks: Vec::new(),
                failed: Vec::new(),
                verdicts: Vec::new(),
                comments: Vec::new(),
                new_comments: 0,
                auto: None,
                agent: None,
                error: Some(
                    self.pr_errors
                        .get(pr)
                        .cloned()
                        .unwrap_or_else(|| "loading…".into()),
                ),
            });
        }
        BoardView {
            workspace: label,
            branch,
            prs,
            agents: self
                .agents
                .iter()
                .filter(|a| a.workspace_id == id)
                .map(|a| AgentView {
                    pane_id: a.pane_id.clone(),
                    label: a.label.clone(),
                    status: a.status.clone(),
                })
                .collect(),
            error: self.fetch_error.clone(),
            updated: ago(self.fetched_at),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_github_times_back_and_formats_ages() {
        assert_eq!(parse_iso("2026-10-12T16:00:00Z"), Some(1_791_820_800));
        assert_eq!(parse_iso(&iso(951_782_400)), Some(951_782_400));
        assert_eq!(parse_iso("nope"), None);
        assert_eq!(age("2026-10-12T16:00:00Z", 1_791_820_800 + 300), "5m");
        assert_eq!(age("2026-10-12T16:00:00Z", 1_791_820_800 + 3 * 3600), "3h");
        assert_eq!(
            age("2026-10-12T16:00:00Z", 1_791_820_800 + 2 * 86_400),
            "2d"
        );
    }

    #[test]
    fn formats_unix_time_like_github() {
        assert_eq!(iso(0), "1970-01-01T00:00:00Z");
        assert_eq!(iso(1_791_820_800), "2026-10-12T16:00:00Z");
        assert_eq!(iso(951_782_400), "2000-02-29T00:00:00Z");
    }

    #[test]
    fn reads_the_branch_of_a_checkout_and_of_a_linked_worktree() {
        let root = std::env::temp_dir().join(format!("herdr-pr-head-{}", std::process::id()));
        let main = root.join("main");
        let wt = root.join("wt");
        std::fs::create_dir_all(main.join(".git/worktrees/wt")).unwrap();
        std::fs::create_dir_all(&wt).unwrap();
        std::fs::write(main.join(".git/HEAD"), "ref: refs/heads/main\n").unwrap();
        std::fs::write(
            main.join(".git/worktrees/wt/HEAD"),
            "ref: refs/heads/feat/x\n",
        )
        .unwrap();
        std::fs::write(
            wt.join(".git"),
            format!("gitdir: {}\n", main.join(".git/worktrees/wt").display()),
        )
        .unwrap();
        assert_eq!(read_branch(&main).as_deref(), Some("main"));
        assert_eq!(read_branch(&wt).as_deref(), Some("feat/x"));
        std::fs::write(main.join(".git/HEAD"), "0123abcd\n").unwrap();
        assert_eq!(read_branch(&main), None, "detached HEAD");
        assert_eq!(read_branch(&root), None, "not a checkout");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn labels_agents_from_herdr_records() {
        let list = json!([
            { "pane_id": "w1:p1", "workspace_id": "w1", "agent": "claude", "agent_status": "idle", "terminal_title_stripped": "Fix tests" },
            { "pane_id": "w1:p2", "workspace_id": "w1", "agent": "codex", "agent_status": "working", "terminal_title_stripped": "codex" },
            { "workspace_id": "w1" }
        ]);
        let agents = agents_from(&list);
        assert_eq!(agents.len(), 2);
        assert_eq!(agents[0].label, "claude: Fix tests (w1:p1)");
        assert_eq!(agents[1].label, "codex (w1:p2)");
    }
}
