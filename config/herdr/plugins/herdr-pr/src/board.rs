//! The PR board. It only renders what the daemon streams and sends commands back; it never
//! calls GitHub itself. Wide: the stack on the left, the selected PR on the right. Narrow: the
//! stack on top, the PR below. Opens as a popup, a split, or a tab.

use std::io::{BufRead, BufReader, Write};
use std::sync::mpsc;
use std::time::Duration;

use anyhow::Result;
use ratatui::crossterm::event::{
    self, DisableMouseCapture, EnableMouseCapture, Event, KeyCode, KeyEventKind, MouseButton,
    MouseEventKind,
};
use ratatui::crossterm::execute;
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Clear, Paragraph};
use ratatui::{DefaultTerminal, Frame};

use crate::ipc::{self, AgentView, BoardView, CommentView, PrView, Reply, Request};
use crate::model::{CheckState, Ci, Tone};

// Gruvbox Material dark, the palette of the terminal, nvim, and herdr.
const FG: Color = Color::Rgb(0xd4, 0xbe, 0x98);
const GREY: Color = Color::Rgb(0x92, 0x83, 0x74);
const FAINT: Color = Color::Rgb(0x5a, 0x52, 0x4c);
const SELECTION: Color = Color::Rgb(0x3c, 0x38, 0x36);
const SELECTION_DIM: Color = Color::Rgb(0x32, 0x30, 0x2f);
const RED: Color = Color::Rgb(0xea, 0x69, 0x62);
const ORANGE: Color = Color::Rgb(0xe7, 0x8a, 0x4e);
const YELLOW: Color = Color::Rgb(0xd8, 0xa6, 0x57);
const GREEN: Color = Color::Rgb(0xa9, 0xb6, 0x65);
const AQUA: Color = Color::Rgb(0x89, 0xb4, 0x82);
const PURPLE: Color = Color::Rgb(0xd3, 0x86, 0x9b);

/// At this width and above the board uses two columns.
const TWO_COLUMNS: u16 = 100;
/// Lines of a comment body shown when it is not selected.
const PREVIEW_LINES: usize = 2;

#[derive(Clone)]
enum Pending {
    Fix(String),
    Auto(String),
    Comment(String, String),
}

enum Mode {
    Normal,
    PickAgent {
        agents: Vec<AgentView>,
        index: usize,
        then: Pending,
    },
    Watch(String),
    /// Right-click menu: (label, command key), the selected item, and where it opens.
    Menu {
        items: Vec<(&'static str, char)>,
        index: usize,
        at: (u16, u16),
    },
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Focus {
    List,
    Detail,
}

struct Board {
    workspace_id: String,
    view: BoardView,
    selected: usize,
    /// Index into `visible_comments()` of the selected PR.
    comment: Option<usize>,
    focus: Focus,
    show_resolved: bool,
    mode: Mode,
    message: Option<(String, bool)>,
    list_area: Rect,
    list_scroll: u16,
    detail_area: Rect,
    detail_scroll: u16,
    /// Detail line → comment index, for mouse clicks.
    detail_map: Vec<Option<usize>>,
    buttons: Vec<(Rect, char)>,
    menu_area: Rect,
}

fn ci_glyph(ci: Ci, draft: bool) -> (&'static str, Color) {
    match ci {
        Ci::Failing => ("✗", RED),
        Ci::Running => ("◐", YELLOW),
        Ci::Passing if !draft => ("✓", GREEN),
        _ => ("○", GREY),
    }
}

fn tone(t: Tone) -> Color {
    match t {
        Tone::Success => GREEN,
        Tone::Error => RED,
        Tone::Warning => ORANGE,
        Tone::Inactive => GREY,
    }
}

fn priority_color(p: &str) -> Color {
    match p {
        "P0" | "P1" => RED,
        "P2" => ORANGE,
        _ => AQUA,
    }
}

fn fit(text: &str, width: usize) -> String {
    let chars: Vec<char> = text.chars().collect();
    if chars.len() <= width {
        return text.to_string();
    }
    let mut out: String = chars[..width.saturating_sub(1)].iter().collect();
    out.push('…');
    out
}

/// Word wrap to `width` columns; words longer than a line are cut.
fn wrap(text: &str, width: usize) -> Vec<String> {
    let width = width.max(8);
    let mut out = Vec::new();
    for paragraph in text.lines() {
        let mut line = String::new();
        for word in paragraph.split_whitespace() {
            let mut word: Vec<char> = word.chars().collect();
            while word.len() > width {
                if !line.is_empty() {
                    out.push(std::mem::take(&mut line));
                }
                out.push(word.drain(..width).collect());
            }
            let word: String = word.into_iter().collect();
            let len = line.chars().count();
            if len > 0 && len + 1 + word.chars().count() > width {
                out.push(std::mem::take(&mut line));
            }
            if !line.is_empty() {
                line.push(' ');
            }
            line.push_str(&word);
        }
        out.push(line);
    }
    while out.last().is_some_and(String::is_empty) {
        out.pop();
    }
    out
}

fn open_url(url: &str) {
    let opener = if cfg!(target_os = "macos") {
        "open"
    } else {
        "xdg-open"
    };
    let _ = std::process::Command::new(opener).arg(url).spawn();
}

/// Open threads, then PR-level comments, then (if shown) resolved threads.
fn visible_comments(pr: &PrView, show_resolved: bool) -> Vec<&CommentView> {
    let rank = |c: &CommentView| match c.resolved {
        Some(false) => 0,
        None => 1,
        Some(true) => 2,
    };
    let mut list: Vec<&CommentView> = pr
        .comments
        .iter()
        .filter(|c| show_resolved || c.resolved != Some(true))
        .collect();
    list.sort_by_key(|c| rank(c));
    list
}

fn section(title: &str) -> Line<'static> {
    Line::styled(
        title.to_string(),
        Style::new().fg(GREY).add_modifier(Modifier::BOLD),
    )
}

impl Board {
    fn pr(&self) -> Option<&PrView> {
        self.view.prs.get(self.selected)
    }

    fn selected_comment(&self) -> Option<&CommentView> {
        let pr = self.pr()?;
        visible_comments(pr, self.show_resolved)
            .get(self.comment?)
            .copied()
    }

    fn send(&mut self, request: Request, pending: Option<Pending>) {
        match ipc::send(&request) {
            Ok(Reply {
                need_agent: Some(agents),
                ..
            }) if pending.is_some() => {
                self.mode = Mode::PickAgent {
                    agents,
                    index: 0,
                    then: pending.expect("checked"),
                };
            }
            Ok(Reply {
                error: Some(err), ..
            }) => self.message = Some((err, true)),
            Ok(Reply {
                message: Some(msg), ..
            }) => self.message = Some((msg, false)),
            Ok(_) => {}
            Err(err) => self.message = Some((format!("{err:#}"), true)),
        }
    }

    fn run_pending(&mut self, pending: Pending) {
        let ws = self.workspace_id.clone();
        let request = match pending.clone() {
            Pending::Fix(pr) => Request::Fix {
                workspace_id: ws,
                pr: Some(pr),
            },
            Pending::Auto(pr) => Request::Auto {
                workspace_id: ws,
                pr: Some(pr),
                on: None,
            },
            Pending::Comment(pr, comment_id) => Request::FixComment {
                workspace_id: ws,
                pr,
                comment_id,
            },
        };
        self.send(request, Some(pending));
    }

    /// Returns false to close the board.
    fn command(&mut self, key: char) -> bool {
        let ws = self.workspace_id.clone();
        let pr_key = self.pr().map(|p| p.key.clone());
        match key {
            'q' => return false,
            'f' => {
                if let Some(pr) = pr_key {
                    self.run_pending(Pending::Fix(pr));
                }
            }
            'a' => {
                if let Some(pr) = pr_key {
                    self.run_pending(Pending::Auto(pr));
                }
            }
            'c' => match (pr_key, self.selected_comment().map(|c| c.id.clone())) {
                (Some(pr), Some(id)) => self.run_pending(Pending::Comment(pr, id)),
                _ => self.message = Some(("select a comment first (tab, then j/k)".into(), true)),
            },
            'o' => {
                let url = self
                    .selected_comment()
                    .map(|c| c.url.clone())
                    .or_else(|| self.pr().map(|p| p.url.clone()));
                if let Some(url) = url {
                    open_url(&url);
                }
            }
            'R' => {
                self.show_resolved = !self.show_resolved;
                self.comment = None;
            }
            's' => self.send(Request::Seen { workspace_id: ws }, None),
            'w' => self.mode = Mode::Watch(String::new()),
            'u' => {
                if let Some(pr) = pr_key {
                    self.send(
                        Request::Unwatch {
                            workspace_id: ws,
                            pr,
                        },
                        None,
                    );
                }
            }
            'r' => self.send(
                Request::Refresh {
                    workspace_id: Some(ws),
                },
                None,
            ),
            _ => {}
        }
        true
    }

    fn select_pr(&mut self, index: usize) {
        if index != self.selected {
            self.selected = index;
            self.comment = None;
            self.detail_scroll = 0;
        }
    }

    fn move_by(&mut self, delta: isize) {
        match self.focus {
            Focus::List => {
                let count = self.view.prs.len() as isize;
                if count > 0 {
                    self.select_pr((self.selected as isize + delta).clamp(0, count - 1) as usize);
                }
            }
            Focus::Detail => {
                let count = self
                    .pr()
                    .map(|p| visible_comments(p, self.show_resolved).len())
                    .unwrap_or(0);
                if count > 0 {
                    let next = self
                        .comment
                        .map_or(0, |c| c as isize + delta)
                        .clamp(0, count as isize - 1);
                    self.comment = Some(next as usize);
                }
            }
        }
    }

    fn key(&mut self, code: KeyCode) -> bool {
        match &mut self.mode {
            Mode::Watch(text) => match code {
                KeyCode::Esc => self.mode = Mode::Normal,
                KeyCode::Enter => {
                    let pr = std::mem::take(text);
                    self.mode = Mode::Normal;
                    let ws = self.workspace_id.clone();
                    self.send(
                        Request::Watch {
                            workspace_id: ws,
                            pr,
                        },
                        None,
                    );
                }
                KeyCode::Backspace => {
                    text.pop();
                }
                KeyCode::Char(c) => text.push(c),
                _ => {}
            },
            Mode::PickAgent {
                agents,
                index,
                then,
            } => match code {
                KeyCode::Esc | KeyCode::Char('q') => self.mode = Mode::Normal,
                KeyCode::Down | KeyCode::Char('j') => {
                    *index = (*index + 1).min(agents.len().saturating_sub(1))
                }
                KeyCode::Up | KeyCode::Char('k') => *index = index.saturating_sub(1),
                KeyCode::Enter => {
                    let (pane, then) = (agents[*index].pane_id.clone(), then.clone());
                    let pr = match &then {
                        Pending::Fix(pr) | Pending::Auto(pr) | Pending::Comment(pr, _) => {
                            pr.clone()
                        }
                    };
                    self.mode = Mode::Normal;
                    let ws = self.workspace_id.clone();
                    self.send(
                        Request::SetAgent {
                            workspace_id: ws,
                            pr,
                            pane_id: pane,
                        },
                        None,
                    );
                    self.run_pending(then);
                }
                _ => {}
            },
            Mode::Menu { items, index, .. } => match code {
                KeyCode::Esc | KeyCode::Char('q') => self.mode = Mode::Normal,
                KeyCode::Down | KeyCode::Char('j') => {
                    *index = (*index + 1).min(items.len().saturating_sub(1))
                }
                KeyCode::Up | KeyCode::Char('k') => *index = index.saturating_sub(1),
                KeyCode::Enter => {
                    let key = items[*index].1;
                    self.mode = Mode::Normal;
                    return self.command(key);
                }
                _ => {}
            },
            Mode::Normal => match code {
                KeyCode::Esc if self.focus == Focus::Detail => {
                    self.focus = Focus::List;
                    self.comment = None;
                }
                KeyCode::Esc => return false,
                KeyCode::Tab | KeyCode::BackTab => {
                    self.focus = if self.focus == Focus::List {
                        Focus::Detail
                    } else {
                        Focus::List
                    };
                    if self.focus == Focus::Detail && self.comment.is_none() {
                        self.move_by(0);
                    }
                }
                KeyCode::Enter | KeyCode::Char('l') | KeyCode::Right
                    if self.focus == Focus::List =>
                {
                    self.focus = Focus::Detail;
                    self.move_by(0);
                }
                KeyCode::Char('h') | KeyCode::Left if self.focus == Focus::Detail => {
                    self.focus = Focus::List;
                    self.comment = None;
                }
                KeyCode::Down | KeyCode::Char('j') => self.move_by(1),
                KeyCode::Up | KeyCode::Char('k') => self.move_by(-1),
                KeyCode::PageDown => self.detail_scroll = self.detail_scroll.saturating_add(10),
                KeyCode::PageUp => self.detail_scroll = self.detail_scroll.saturating_sub(10),
                KeyCode::Char(c) => return self.command(c),
                _ => {}
            },
        }
        true
    }

    fn hit_list(&self, column: u16, row: u16) -> Option<usize> {
        let a = self.list_area;
        if !a.contains((column, row).into()) || row <= a.y {
            return None;
        }
        let index = (row - a.y - 1 + self.list_scroll) as usize;
        (index < self.view.prs.len()).then_some(index)
    }

    fn hit_detail(&self, column: u16, row: u16) -> Option<Option<usize>> {
        let a = self.detail_area;
        if !a.contains((column, row).into()) {
            return None;
        }
        Some(
            self.detail_map
                .get((row - a.y + self.detail_scroll) as usize)
                .copied()
                .flatten(),
        )
    }

    fn click(&mut self, column: u16, row: u16) -> bool {
        if let Mode::Menu { items, .. } = &self.mode {
            let inner = self.menu_area;
            let hit = (row > inner.y && row + 1 < inner.y + inner.height)
                .then(|| items.get((row - inner.y - 1) as usize).map(|i| i.1))
                .flatten()
                .filter(|_| column >= inner.x && column < inner.x + inner.width);
            self.mode = Mode::Normal;
            return hit.is_none_or(|key| self.command(key));
        }
        if let Some((_, key)) = self
            .buttons
            .iter()
            .find(|(r, _)| r.contains((column, row).into()))
            .copied()
        {
            return self.command(key);
        }
        if !matches!(self.mode, Mode::Normal) {
            return true;
        }
        if let Some(index) = self.hit_list(column, row) {
            self.select_pr(index);
            self.focus = Focus::List;
        } else if let Some(Some(comment)) = self.hit_detail(column, row) {
            self.focus = Focus::Detail;
            self.comment = (self.comment != Some(comment)).then_some(comment);
        }
        true
    }

    /// Right-click: select what is under the pointer and open the action menu there.
    fn right_click(&mut self, column: u16, row: u16) {
        if !matches!(self.mode, Mode::Normal | Mode::Menu { .. }) {
            return;
        }
        if let Some(index) = self.hit_list(column, row) {
            self.select_pr(index);
        } else if let Some(Some(comment)) = self.hit_detail(column, row) {
            self.focus = Focus::Detail;
            self.comment = Some(comment);
        }
        let Some(pr) = self.pr() else { return };
        let mut items: Vec<(&'static str, char)> = vec![("Fix now", 'f')];
        items.push((
            if pr.auto.is_some() {
                "Auto-fix off"
            } else {
                "Auto-fix on"
            },
            'a',
        ));
        if self.selected_comment().is_some() {
            items.push(("Fix this comment", 'c'));
            items.push(("Open comment in browser", 'o'));
        } else {
            items.push(("Open PR in browser", 'o'));
        }
        items.push((
            if self.show_resolved {
                "Hide resolved threads"
            } else {
                "Show resolved threads"
            },
            'R',
        ));
        items.extend([
            ("Mark all seen", 's'),
            ("Unwatch PR", 'u'),
            ("Watch another PR…", 'w'),
            ("Refresh", 'r'),
        ]);
        self.mode = Mode::Menu {
            items,
            index: 0,
            at: (column, row),
        };
    }

    fn scroll(&mut self, column: u16, row: u16, down: bool) {
        if self.detail_area.contains((column, row).into()) {
            self.detail_scroll = if down {
                self.detail_scroll.saturating_add(3)
            } else {
                self.detail_scroll.saturating_sub(3)
            };
        } else {
            self.move_by(if down { 1 } else { -1 });
        }
    }

    // ---- drawing ------------------------------------------------------------------------

    fn list_lines(&self, width: usize) -> Vec<Line<'static>> {
        let mut lines = vec![section(" STACK")];
        for (i, pr) in self.view.prs.iter().enumerate() {
            let (glyph, color) = ci_glyph(pr.ci, pr.draft);
            let open = pr
                .comments
                .iter()
                .filter(|c| c.resolved == Some(false))
                .count();
            let mut right = String::new();
            if open > 0 {
                right.push_str(&format!(" {open}○"));
            }
            if pr.auto.is_some() {
                right.push_str(" ⟳");
            }
            let marker = if pr.current { "›" } else { " " };
            let indent = "  ".repeat(pr.depth.min(4));
            let lead = format!("{marker}{indent}{glyph} {} ", pr.name);
            let title = if pr.title.is_empty() {
                pr.error.clone().unwrap_or_default()
            } else {
                pr.title.clone()
            };
            let room = width.saturating_sub(lead.chars().count() + right.chars().count() + 1);
            let mut line = Line::from(vec![
                Span::styled(format!("{marker}{indent}"), Style::new().fg(YELLOW)),
                Span::styled(format!("{glyph} "), Style::new().fg(color)),
                Span::styled(
                    pr.name.clone(),
                    Style::new().fg(FG).add_modifier(Modifier::BOLD),
                ),
                Span::raw(" "),
                Span::styled(fit(&title, room), Style::new().fg(GREY)),
                Span::styled(
                    right,
                    Style::new().fg(if pr.auto.is_some() { PURPLE } else { ORANGE }),
                ),
            ]);
            if i == self.selected {
                let bg = if self.focus == Focus::List {
                    SELECTION
                } else {
                    SELECTION_DIM
                };
                line = line.style(Style::new().bg(bg));
            }
            lines.push(line);
        }
        if self.view.prs.is_empty() {
            lines.push(Line::styled(
                " No PRs here. Press w to watch one.",
                Style::new().fg(GREY),
            ));
        }
        lines
    }

    /// The selected PR's sections, which line belongs to which comment, and the selected comment's line.
    fn detail_lines(
        &self,
        width: usize,
    ) -> (Vec<Line<'static>>, Vec<Option<usize>>, Option<usize>) {
        let mut lines: Vec<Line<'static>> = Vec::new();
        let mut map: Vec<Option<usize>> = Vec::new();
        let mut cursor = None;
        let Some(pr) = self.pr() else {
            return (lines, map, cursor);
        };
        let text_width = width.saturating_sub(2);
        let mut push =
            |line: Line<'static>, comment: Option<usize>, lines: &mut Vec<Line<'static>>| {
                lines.push(line);
                map.push(comment);
            };

        for (i, row) in wrap(&format!("{}  {}", pr.name, pr.title), text_width)
            .into_iter()
            .enumerate()
        {
            let style = if i == 0 {
                Style::new().fg(FG).add_modifier(Modifier::BOLD)
            } else {
                Style::new().fg(FG)
            };
            push(Line::styled(format!(" {row}"), style), None, &mut lines);
        }
        if !pr.head.is_empty() {
            push(
                Line::styled(format!(" {} → {}", pr.head, pr.base), Style::new().fg(GREY)),
                None,
                &mut lines,
            );
        }
        let mut status = vec![Span::raw(" ")];
        if !pr.merge.is_empty() {
            status.push(Span::styled(
                pr.merge.clone(),
                Style::new().fg(tone(pr.merge_tone)),
            ));
        }
        if !pr.review.is_empty() {
            status.push(Span::styled(
                format!(" · {}", pr.review),
                Style::new().fg(GREY),
            ));
        }
        if pr.new_comments > 0 {
            status.push(Span::styled(
                format!(" · {} new", pr.new_comments),
                Style::new().fg(YELLOW),
            ));
        }
        push(Line::from(status), None, &mut lines);
        if let Some(auto) = &pr.auto {
            push(
                Line::styled(format!(" {auto}"), Style::new().fg(PURPLE)),
                None,
                &mut lines,
            );
        }
        if let Some(err) = &pr.error {
            push(
                Line::styled(format!(" {err}"), Style::new().fg(RED)),
                None,
                &mut lines,
            );
        }

        // Checks: a count per state, then the failing and running ones by name.
        push(Line::default(), None, &mut lines);
        let count = |s: CheckState| pr.checks.iter().filter(|c| c.state == s).count();
        let (failed, running, passed) = (
            count(CheckState::Failure),
            count(CheckState::Pending),
            count(CheckState::Success),
        );
        let mut summary = vec![Span::styled(
            " CHECKS  ",
            Style::new().fg(GREY).add_modifier(Modifier::BOLD),
        )];
        if pr.checks.is_empty() {
            summary.push(Span::styled("none", Style::new().fg(GREY)));
        }
        for (n, label, color) in [
            (failed, "failed", RED),
            (running, "running", YELLOW),
            (passed, "passed", GREEN),
        ] {
            if n > 0 {
                summary.push(Span::styled(
                    format!("{n} {label}  "),
                    Style::new().fg(color),
                ));
            }
        }
        push(Line::from(summary), None, &mut lines);
        for check in pr.checks.iter().filter(|c| c.state == CheckState::Failure) {
            push(
                Line::styled(
                    format!("   ✗ {}", fit(&check.name, text_width.saturating_sub(4))),
                    Style::new().fg(RED),
                ),
                None,
                &mut lines,
            );
        }
        let running_names: Vec<&str> = pr
            .checks
            .iter()
            .filter(|c| c.state == CheckState::Pending)
            .map(|c| c.name.as_str())
            .collect();
        if !running_names.is_empty() {
            for row in wrap(&running_names.join(" · "), text_width.saturating_sub(4)) {
                push(
                    Line::styled(format!("   ◐ {row}"), Style::new().fg(YELLOW)),
                    None,
                    &mut lines,
                );
            }
        }

        if !pr.verdicts.is_empty() {
            push(Line::default(), None, &mut lines);
            push(section(" VERDICTS"), None, &mut lines);
            for v in &pr.verdicts {
                push(
                    Line::from(vec![
                        Span::styled(format!("   {}: ", v.author), Style::new().fg(GREY)),
                        Span::styled(
                            v.text.clone(),
                            Style::new().fg(if v.good { GREEN } else { ORANGE }),
                        ),
                    ]),
                    None,
                    &mut lines,
                );
            }
        }

        let visible = visible_comments(pr, self.show_resolved);
        let open = pr
            .comments
            .iter()
            .filter(|c| c.resolved == Some(false))
            .count();
        let resolved_total = pr
            .comments
            .iter()
            .filter(|c| c.resolved == Some(true))
            .count();
        push(Line::default(), None, &mut lines);
        let mut header = vec![Span::styled(
            format!(" OPEN THREADS  {open}"),
            Style::new().fg(GREY).add_modifier(Modifier::BOLD),
        )];
        if resolved_total > 0 {
            let hint = if self.show_resolved {
                "R hides"
            } else {
                "R shows"
            };
            header.push(Span::styled(
                format!("   {resolved_total} resolved · {hint}"),
                Style::new().fg(FAINT),
            ));
        }
        push(Line::from(header), None, &mut lines);
        if open == 0 {
            push(
                Line::styled("   nothing open", Style::new().fg(GREY)),
                None,
                &mut lines,
            );
        }

        for (j, c) in visible.iter().enumerate() {
            let starts = |kind: Option<bool>| {
                c.resolved == kind && (j == 0 || visible[j - 1].resolved != kind)
            };
            if starts(None) {
                push(Line::default(), None, &mut lines);
                push(section(" COMMENTS"), None, &mut lines);
            }
            if starts(Some(true)) {
                push(Line::default(), None, &mut lines);
                push(section(" RESOLVED"), None, &mut lines);
            }
            let selected = self.comment == Some(j);
            if selected {
                cursor = Some(lines.len());
            }
            let faded = c.resolved == Some(true);
            let mut head = vec![Span::styled(
                if selected { " ▸ " } else { "   " },
                Style::new().fg(YELLOW),
            )];
            if let Some(p) = &c.priority {
                head.push(Span::styled(
                    format!("{p} "),
                    Style::new()
                        .fg(priority_color(p))
                        .add_modifier(Modifier::BOLD),
                ));
            }
            head.push(Span::styled(
                c.author.clone(),
                Style::new()
                    .fg(if faded { FAINT } else { FG })
                    .add_modifier(Modifier::BOLD),
            ));
            if !c.age.is_empty() {
                head.push(Span::styled(format!(" · {}", c.age), Style::new().fg(GREY)));
            }
            if c.is_new {
                head.push(Span::styled(" · new", Style::new().fg(YELLOW)));
            }
            let mut head_line = Line::from(head);
            if selected {
                head_line = head_line.style(Style::new().bg(SELECTION));
            }
            push(head_line, Some(j), &mut lines);
            if let Some(loc) = &c.location {
                push(
                    Line::styled(
                        format!("   {}", fit(loc, text_width.saturating_sub(2))),
                        Style::new().fg(AQUA),
                    ),
                    Some(j),
                    &mut lines,
                );
            }
            let body = if c.body.is_empty() {
                c.text.clone()
            } else {
                c.body.clone()
            };
            // The priority is in the header already; drop the severity emoji that carried it.
            let body = body
                .trim_start_matches(['🔴', '🟠', '🟡', '🟢', ' '])
                .to_string();
            let mut rows = wrap(&body, text_width.saturating_sub(2));
            if !selected {
                rows.retain(|r| !r.is_empty());
            }
            let shown = if selected {
                rows.len()
            } else {
                rows.len().min(PREVIEW_LINES)
            };
            let color = if faded { FAINT } else { FG };
            for (k, row) in rows.iter().take(shown).enumerate() {
                let more = !selected && k + 1 == shown && rows.len() > shown;
                let row = if more {
                    format!("{row} …")
                } else {
                    row.clone()
                };
                push(
                    Line::styled(format!("   {row}"), Style::new().fg(color)),
                    Some(j),
                    &mut lines,
                );
            }
            push(Line::default(), Some(j), &mut lines);
        }
        (lines, map, cursor)
    }

    fn draw(&mut self, frame: &mut Frame) {
        let area = frame.area();
        let [head, main, status, keys] = Layout::vertical([
            Constraint::Length(2),
            Constraint::Min(3),
            Constraint::Length(1),
            Constraint::Length(1),
        ])
        .areas(area);

        let branch = self
            .view
            .branch
            .as_deref()
            .map(|b| format!(" · {b}"))
            .unwrap_or_default();
        let mut header = vec![
            Span::styled(
                format!(" {}", self.view.workspace),
                Style::new().fg(FG).add_modifier(Modifier::BOLD),
            ),
            Span::styled(branch, Style::new().fg(GREY)),
            Span::styled(
                format!(" · updated {}", self.view.updated),
                Style::new().fg(FAINT),
            ),
        ];
        if let Some(err) = &self.view.error {
            header.push(Span::styled(
                format!(" · {}", fit(err, 60)),
                Style::new().fg(RED),
            ));
        }
        frame.render_widget(Paragraph::new(Line::from(header)), head);

        // Responsive: side by side when wide, stacked when narrow.
        let (list_area, detail_area) = if area.width >= TWO_COLUMNS {
            let left = (area.width / 3).clamp(30, 48);
            let [l, sep, r] = Layout::horizontal([
                Constraint::Length(left),
                Constraint::Length(2),
                Constraint::Min(20),
            ])
            .areas(main);
            let rule: Vec<Line> = (0..sep.height)
                .map(|_| Line::styled("│", Style::new().fg(FAINT)))
                .collect();
            frame.render_widget(Paragraph::new(rule), sep);
            (l, r)
        } else {
            let rows = (self.view.prs.len().max(1) as u16 + 1)
                .min(main.height / 3)
                .max(2);
            let [l, sep, r] = Layout::vertical([
                Constraint::Length(rows),
                Constraint::Length(1),
                Constraint::Min(3),
            ])
            .areas(main);
            let rule = Line::styled("─".repeat(sep.width as usize), Style::new().fg(FAINT));
            frame.render_widget(Paragraph::new(rule), sep);
            (l, r)
        };
        self.list_area = list_area;
        self.detail_area = detail_area;

        let list = self.list_lines(list_area.width as usize);
        let visible_rows = list_area.height.saturating_sub(1) as usize;
        if self.selected < self.list_scroll as usize {
            self.list_scroll = self.selected as u16;
        } else if visible_rows > 0 && self.selected >= self.list_scroll as usize + visible_rows {
            self.list_scroll = (self.selected + 1 - visible_rows) as u16;
        }
        let mut list_view = vec![list[0].clone()];
        list_view.extend(list.into_iter().skip(1 + self.list_scroll as usize));
        frame.render_widget(Paragraph::new(list_view), list_area);

        let (lines, map, cursor) = self.detail_lines(detail_area.width as usize);
        self.detail_map = map;
        let height = detail_area.height as usize;
        if let Some(cursor) = cursor {
            let scroll = self.detail_scroll as usize;
            if cursor < scroll {
                self.detail_scroll = cursor as u16;
            } else if cursor + 3 > scroll + height {
                self.detail_scroll = (cursor + 3).saturating_sub(height) as u16;
            }
        }
        let max_scroll = lines.len().saturating_sub(height) as u16;
        self.detail_scroll = self.detail_scroll.min(max_scroll);
        frame.render_widget(
            Paragraph::new(lines).scroll((self.detail_scroll, 0)),
            detail_area,
        );

        let status_line = match &self.mode {
            Mode::Watch(text) => Line::from(vec![
                Span::styled(
                    " watch PR (URL or owner/repo#123): ",
                    Style::new().fg(YELLOW),
                ),
                Span::styled(format!("{text}▏"), Style::new().fg(FG)),
            ]),
            Mode::Menu { .. } => Line::styled(" enter: run · esc: close", Style::new().fg(GREY)),
            Mode::PickAgent { .. } => Line::styled(
                " which agent gets fix prompts for this PR?",
                Style::new().fg(YELLOW),
            ),
            Mode::Normal => match &self.message {
                Some((text, true)) => Line::styled(format!(" {text}"), Style::new().fg(RED)),
                Some((text, false)) => Line::styled(format!(" {text}"), Style::new().fg(GREEN)),
                None => Line::styled(
                    " tab: list/details · j/k: move · R: resolved · right-click: more",
                    Style::new().fg(FAINT),
                ),
            },
        };
        frame.render_widget(Paragraph::new(status_line), status);

        self.buttons.clear();
        let buttons: &[(char, &str)] = &[
            ('f', "fix"),
            ('a', "auto"),
            ('c', "fix comment"),
            ('o', "open"),
            ('s', "seen"),
            ('w', "watch"),
            ('r', "refresh"),
            ('q', "close"),
        ];
        let mut x = keys.x + 1;
        let mut spans = vec![Span::raw(" ")];
        for (key, label) in buttons {
            let key_text = format!("{key} ");
            let text = format!("{label}  ");
            let width = (key_text.chars().count() + text.chars().count()) as u16;
            if x + width > keys.right() {
                break;
            }
            self.buttons.push((Rect::new(x, keys.y, width, 1), *key));
            x += width;
            spans.push(Span::styled(key_text, Style::new().fg(YELLOW)));
            spans.push(Span::styled(text, Style::new().fg(GREY)));
        }
        frame.render_widget(Paragraph::new(Line::from(spans)), keys);

        if let Mode::Menu { items, index, at } = &self.mode {
            let width = items
                .iter()
                .map(|(l, _)| l.chars().count() as u16)
                .max()
                .unwrap_or(10)
                + 6;
            let height = items.len() as u16 + 2;
            let x = at.0.min(area.right().saturating_sub(width));
            let y = at.1.min(area.bottom().saturating_sub(height));
            let popup = Rect::new(x, y, width.min(area.width), height.min(area.height));
            self.menu_area = popup;
            frame.render_widget(Clear, popup);
            let lines: Vec<Line> = items
                .iter()
                .enumerate()
                .map(|(i, (label, key))| {
                    let line = Line::from(vec![
                        Span::styled(format!(" {label}"), Style::new().fg(FG)),
                        Span::styled(format!("  {key}"), Style::new().fg(FAINT)),
                    ]);
                    if i == *index {
                        line.style(Style::new().bg(SELECTION))
                    } else {
                        line
                    }
                })
                .collect();
            let block = Block::bordered().border_style(Style::new().fg(FAINT));
            frame.render_widget(Paragraph::new(lines).block(block), popup);
        }

        if let Mode::PickAgent { agents, index, .. } = &self.mode {
            let height = (agents.len() as u16 + 2).min(area.height);
            let width = area.width.saturating_sub(8).min(80);
            let popup = Rect::new(area.x + 4, area.y + 3, width, height);
            frame.render_widget(Clear, popup);
            let lines: Vec<Line> = agents
                .iter()
                .enumerate()
                .map(|(i, a)| {
                    let line = Line::from(vec![
                        Span::styled(
                            format!(" {} ", if i == *index { "›" } else { " " }),
                            Style::new().fg(YELLOW),
                        ),
                        Span::styled(
                            fit(&a.label, (width as usize).saturating_sub(14)),
                            Style::new().fg(FG),
                        ),
                        Span::styled(format!("  {}", a.status), Style::new().fg(GREY)),
                    ]);
                    if i == *index {
                        line.style(Style::new().bg(SELECTION))
                    } else {
                        line
                    }
                })
                .collect();
            let block = Block::bordered()
                .border_style(Style::new().fg(FAINT))
                .title(" pick agent ");
            frame.render_widget(Paragraph::new(lines).block(block), popup);
        }
    }
}

fn subscribe(workspace_id: String, tx: mpsc::Sender<BoardView>) -> Result<()> {
    let mut stream = ipc::connect()?;
    let request = serde_json::to_string(&Request::Subscribe { workspace_id })? + "\n";
    stream.write_all(request.as_bytes())?;
    std::thread::spawn(move || {
        for line in BufReader::new(stream).lines() {
            let Ok(line) = line else { return };
            if let Ok(view) = serde_json::from_str(&line)
                && tx.send(view).is_err()
            {
                return;
            }
        }
    });
    Ok(())
}

fn event_loop(
    terminal: &mut DefaultTerminal,
    board: &mut Board,
    rx: &mpsc::Receiver<BoardView>,
) -> Result<()> {
    loop {
        while let Ok(view) = rx.try_recv() {
            board.view = view;
            board.selected = board.selected.min(board.view.prs.len().saturating_sub(1));
        }
        terminal.draw(|f| board.draw(f))?;
        if !event::poll(Duration::from_millis(150))? {
            continue;
        }
        let keep = match event::read()? {
            Event::Key(key) if key.kind == KeyEventKind::Press => board.key(key.code),
            Event::Mouse(m) => match m.kind {
                MouseEventKind::Down(MouseButton::Left) => board.click(m.column, m.row),
                MouseEventKind::Down(MouseButton::Right) => {
                    board.right_click(m.column, m.row);
                    true
                }
                MouseEventKind::ScrollDown => {
                    board.scroll(m.column, m.row, true);
                    true
                }
                MouseEventKind::ScrollUp => {
                    board.scroll(m.column, m.row, false);
                    true
                }
                _ => true,
            },
            _ => true,
        };
        if !keep {
            return Ok(());
        }
    }
}

pub fn run() -> Result<()> {
    let Some(workspace_id) = ipc::current_workspace() else {
        anyhow::bail!("no workspace given");
    };
    let (tx, rx) = mpsc::channel();
    if let Err(err) = subscribe(workspace_id.clone(), tx) {
        eprintln!("herdr-pr: {err:#}. Run the action \"herdr-pr: start daemon\".");
        std::thread::sleep(Duration::from_secs(3));
        return Ok(());
    }
    let view = rx.recv_timeout(Duration::from_secs(5)).unwrap_or_default();
    let mut board = Board {
        workspace_id,
        // Start on the checked-out branch's PR.
        selected: view.prs.iter().position(|p| p.current).unwrap_or(0),
        view,
        comment: None,
        focus: Focus::List,
        show_resolved: false,
        mode: Mode::Normal,
        message: None,
        list_area: Rect::default(),
        list_scroll: 0,
        detail_area: Rect::default(),
        detail_scroll: 0,
        detail_map: Vec::new(),
        buttons: Vec::new(),
        menu_area: Rect::default(),
    };

    // HERDR_PR_DUMP=COLSxROWS[:resolved,comment] prints one frame as text instead of running.
    if let Ok(spec) = std::env::var("HERDR_PR_DUMP") {
        let (size, extra) = spec.split_once(':').unwrap_or((spec.as_str(), ""));
        let (w, h) = size
            .split_once('x')
            .and_then(|(w, h)| Some((w.parse().ok()?, h.parse().ok()?)))
            .unwrap_or((120, 40));
        board.show_resolved = extra.contains("resolved");
        if extra.contains("comment") {
            board.focus = Focus::Detail;
            board.comment = Some(0);
        }
        let mut term = ratatui::Terminal::new(ratatui::backend::TestBackend::new(w, h))?;
        term.draw(|f| board.draw(f))?;
        let buf = term.backend().buffer();
        for y in 0..h {
            let line: String = (0..w).map(|x| buf[(x, y)].symbol().to_string()).collect();
            println!("{}", line.trim_end());
        }
        return Ok(());
    }

    // In a split or tab the board is a real pane: ask herdr to pass right-clicks to it.
    if let Ok(pane_id) = std::env::var("HERDR_PANE_ID") {
        let _ = ipc::herdr_call(
            "pane.input.set",
            serde_json::json!({ "pane_id": pane_id, "right_click": "pane" }),
        );
    }
    let mut terminal = ratatui::init();
    execute!(std::io::stdout(), EnableMouseCapture)?;
    let result = event_loop(&mut terminal, &mut board, &rx);
    let _ = execute!(std::io::stdout(), DisableMouseCapture);
    ratatui::restore();
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wraps_words_and_cuts_overlong_ones() {
        assert_eq!(wrap("one two three four", 9), ["one two", "three", "four"]);
        assert_eq!(wrap("abcdefghijkl", 8), ["abcdefgh", "ijkl"]);
        assert_eq!(wrap("a\n\nb", 8), ["a", "", "b"]);
    }
}
