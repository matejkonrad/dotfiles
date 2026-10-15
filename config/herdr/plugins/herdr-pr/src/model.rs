//! Forge-neutral PR model and the pure functions on it: noise filtering, CI summary,
//! sidebar token text, and the fix prompts. Ported from the Claude Code `pr-watch` mod.

use std::sync::LazyLock;

use regex::Regex;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct PrRef {
    /// "owner/name"
    pub repo: String,
    pub number: u64,
}

impl PrRef {
    pub fn key(&self) -> String {
        format!("{}#{}", self.repo, self.number)
    }

    /// One ref from "owner/repo#12", a GitHub pull URL, or a Graphite PR URL.
    pub fn parse(text: &str) -> Option<PrRef> {
        parse_pr_refs(text).into_iter().next()
    }
}

static REF_PATTERNS: LazyLock<[Regex; 3]> = LazyLock::new(|| {
    [
        Regex::new(r"github\.com/([\w.-]+/[\w.-]+)/pull/(\d+)").unwrap(),
        Regex::new(r"app\.graphite\.(?:dev|com)/github/pr/([\w.-]+/[\w.-]+)/(\d+)").unwrap(),
        Regex::new(r"(?:^|\s)([\w.-]+/[\w.-]+)#(\d+)").unwrap(),
    ]
});

pub fn parse_pr_refs(text: &str) -> Vec<PrRef> {
    let mut refs: Vec<PrRef> = Vec::new();
    for pattern in REF_PATTERNS.iter() {
        for caps in pattern.captures_iter(text) {
            let Ok(number) = caps[2].parse() else {
                continue;
            };
            let one = PrRef {
                repo: caps[1].to_string(),
                number,
            };
            if !refs.contains(&one) {
                refs.push(one);
            }
        }
    }
    refs
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PrState {
    Open,
    Merged,
    Closed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CheckState {
    Pending,
    Success,
    Failure,
    Skipped,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Check {
    pub name: String,
    pub state: CheckState,
    pub url: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Comment {
    /// Thread id for review threads, the comment URL otherwise.
    pub id: String,
    pub author: String,
    pub body: String,
    pub url: String,
    pub created_at: String,
    /// e.g. "src/lib/url.ts:42" for an inline thread.
    pub location: Option<String>,
    /// None for PR-level comments and review bodies, which have no thread.
    pub resolved: Option<bool>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PrStatus {
    pub pr: PrRef,
    pub title: String,
    pub url: String,
    pub state: PrState,
    pub draft: bool,
    pub base: String,
    pub head: String,
    pub head_oid: String,
    /// GitHub's mergeStateStatus: CLEAN, BLOCKED, BEHIND, DIRTY, UNSTABLE, ...
    pub merge_state: String,
    pub review_decision: String,
    pub checks: Vec<Check>,
    pub comments: Vec<Comment>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Ci {
    Failing,
    Running,
    Passing,
    None,
}

impl PrStatus {
    pub fn failed_checks(&self) -> Vec<&Check> {
        self.checks
            .iter()
            .filter(|c| c.state == CheckState::Failure)
            .collect()
    }

    pub fn ci(&self) -> Ci {
        if self.checks.iter().any(|c| c.state == CheckState::Failure) {
            Ci::Failing
        } else if self.checks.iter().any(|c| c.state == CheckState::Pending) {
            Ci::Running
        } else if self.checks.is_empty() {
            Ci::None
        } else {
            Ci::Passing
        }
    }
}

/// Bots that only post noise (stack lists, deploy previews, reminders), not reviews.
static NOISE_AUTHORS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)graphite|vercel|github-actions|mergetron|linear").unwrap());
/// Codex re-posts a status table, and wraps inline findings in a review body that only introduces them.
static NOISE_BODIES: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"codex-pull-request-review-summary|^\s*#*\s*💡 Codex Review").unwrap()
});

/// Comments from others, without noise: unresolved threads first, then newest first.
pub fn visible_comments<'a>(pr: &'a PrStatus, me: &str) -> Vec<&'a Comment> {
    let mut list: Vec<&Comment> = pr
        .comments
        .iter()
        .filter(|c| {
            !c.author.is_empty()
                && c.author != me
                && !NOISE_AUTHORS.is_match(&c.author)
                && !c.body.trim().is_empty()
                && !NOISE_BODIES.is_match(&c.body)
        })
        .collect();
    list.sort_by(|a, b| {
        let open = |c: &Comment| if c.resolved == Some(false) { 0 } else { 1 };
        open(a)
            .cmp(&open(b))
            .then_with(|| b.created_at.cmp(&a.created_at))
    });
    list
}

pub fn unresolved_threads<'a>(pr: &'a PrStatus, me: &str) -> Vec<&'a Comment> {
    visible_comments(pr, me)
        .into_iter()
        .filter(|c| c.resolved == Some(false))
        .collect()
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Tone {
    Success,
    Error,
    Warning,
    Inactive,
}

/// e.g. CLEAN → "ready to merge", DIRTY → "merge conflicts".
pub fn merge_readiness(pr: &PrStatus) -> (&'static str, Tone) {
    match pr.state {
        PrState::Merged => return ("merged", Tone::Inactive),
        PrState::Closed => return ("closed", Tone::Inactive),
        PrState::Open => {}
    }
    if pr.draft {
        return ("draft", Tone::Inactive);
    }
    match pr.merge_state.as_str() {
        "CLEAN" | "HAS_HOOKS" => ("ready to merge", Tone::Success),
        "DIRTY" => ("merge conflicts", Tone::Error),
        "BEHIND" => ("behind base", Tone::Warning),
        "BLOCKED" => ("blocked", Tone::Warning),
        "UNSTABLE" => ("checks not passing", Tone::Warning),
        _ => ("merge state unknown", Tone::Inactive),
    }
}

/// e.g. "framer/FramerCreatorsService#1039" → "FCS#1039".
pub fn short_name(pr: &PrRef) -> String {
    let repo = pr.repo.rsplit('/').next().unwrap_or(&pr.repo);
    let initials: String = repo.chars().filter(|c| c.is_ascii_uppercase()).collect();
    let name = if repo.len() > 12 && initials.len() >= 2 {
        initials.as_str()
    } else {
        repo
    };
    format!("{name}#{}", pr.number)
}

/// e.g. "chatgpt-codex-connector[bot]" → "codex".
pub fn short_author(login: &str) -> String {
    let name = login.strip_suffix("[bot]").unwrap_or(login);
    match name {
        "chatgpt-codex-connector" => "codex",
        "devin-ai-integration" => "devin",
        "copilot-pull-request-reviewer" => "copilot",
        other => other,
    }
    .to_string()
}

static HTML_COMMENT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?s)<!--.*?-->").unwrap());
static DETAILS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?s)<details.*?</details>").unwrap());
static IMAGE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"!\[[^\]]*\]\([^)]*\)").unwrap());
static LINK: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\[([^\]]*)\]\([^)]*\)").unwrap());
static TAG: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"<[^>]+>").unwrap());
static HEADING: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^#+\s*").unwrap());
static SPACES: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[ \t]+").unwrap());
static RULE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^-{3,}$").unwrap());
static FOOTER: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)was this helpful|react with 👍|^reviewed commit").unwrap());
static BLANKS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\n{3,}").unwrap());

/// The comment as plain paragraphs: no HTML, badges, images, or tables.
pub fn comment_plain_text(body: &str) -> String {
    let text = HTML_COMMENT.replace_all(body, "");
    let text = DETAILS.replace_all(&text, "");
    let text = IMAGE.replace_all(&text, "");
    let text = LINK.replace_all(&text, "$1");
    let text = TAG.replace_all(&text, "");
    let lines: Vec<String> = text
        .lines()
        .map(|line| {
            let line = HEADING.replace(line, "");
            let line = line.replace("**", "").replace("__", "");
            SPACES.replace_all(&line, " ").trim().to_string()
        })
        .filter(|line| !line.starts_with('|') && !RULE.is_match(line) && !FOOTER.is_match(line))
        .collect();
    BLANKS
        .replace_all(&lines.join("\n"), "\n\n")
        .trim()
        .to_string()
}

static BADGE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"!\[(P\d) Badge\]").unwrap());

/// A review comment's priority badge (codex "P1" badge, devin severity emoji) and first line.
pub fn summarize_comment(body: &str) -> (Option<String>, String) {
    let plain = comment_plain_text(body);
    let first = plain
        .lines()
        .find(|l| !l.is_empty())
        .unwrap_or("")
        .to_string();
    let badge = BADGE.captures(body).map(|c| c[1].to_string());
    for (emoji, priority) in [("🔴", "P1"), ("🟠", "P1"), ("🟡", "P2"), ("🟢", "P3")] {
        if let Some(rest) = first.strip_prefix(emoji) {
            return (
                badge.or(Some(priority.to_string())),
                rest.trim_start().to_string(),
            );
        }
    }
    (badge, first)
}

static VERDICT: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)no (major )?issues|didn't find any|approv|lgtm|looks good|bravo|changes recommended|found \d+ (potential )?issues?").unwrap()
});
static FOUND: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"found (\d+) (potential )?issues?").unwrap());

/// A PR-level bot comment that only judges the whole PR ("No issues found", "found 2 issues"),
/// not a finding with a location.
pub fn is_verdict(c: &Comment) -> bool {
    c.resolved.is_none()
        && VERDICT.is_match(comment_plain_text(&c.body).lines().next().unwrap_or(""))
}

/// e.g. "Devin Review found 2 potential issues." → ("2 issues", false).
pub fn verdict_text(c: &Comment) -> (String, bool) {
    let first = comment_plain_text(&c.body)
        .lines()
        .next()
        .unwrap_or("")
        .to_lowercase();
    if let Some(caps) = FOUND.captures(&first) {
        let n = &caps[1];
        return (
            format!("{n} {}", if n == "1" { "issue" } else { "issues" }),
            false,
        );
    }
    let (text, good) = if first.contains("changes recommended") {
        ("changes recommended", false)
    } else if first.contains("no issues")
        || first.contains("no major issues")
        || first.contains("didn't find any")
    {
        ("no issues", true)
    } else if first.contains("auto-approved") || first.contains("autoapproved") {
        ("auto-approved", true)
    } else if first.contains("approv") {
        ("approval recommended", true)
    } else {
        ("looks good", true)
    };
    (text.to_string(), good)
}

/// The one sidebar mark of a workspace: the worst state across its whole stack.
/// Each mark is its own token, so the herdr config colors it (`$pr_fail` red, ...).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mark {
    /// An auto-fix loop is running.
    Auto,
    /// Failing checks, unresolved threads, or merge conflicts: needs you.
    Fail,
    /// Checks are running.
    Wait,
    /// The data could not be refreshed.
    Stale,
    Ok,
}

impl Mark {
    pub const ALL: [Mark; 5] = [Mark::Auto, Mark::Fail, Mark::Wait, Mark::Stale, Mark::Ok];

    pub fn token(self) -> &'static str {
        match self {
            Mark::Auto => "pr_auto",
            Mark::Fail => "pr_fail",
            Mark::Wait => "pr_wait",
            Mark::Stale => "pr_stale",
            Mark::Ok => "pr_ok",
        }
    }

    pub fn glyph(self) -> &'static str {
        match self {
            Mark::Auto => "⟳",
            Mark::Fail => "✗",
            Mark::Wait => "◐",
            Mark::Stale => "?",
            Mark::Ok => "✓",
        }
    }
}

/// `prs` pairs each open PR of the workspace with its unresolved thread count.
pub fn mark(prs: &[(&PrStatus, usize)], auto: bool, stale: bool) -> Option<Mark> {
    let open: Vec<&(&PrStatus, usize)> = prs
        .iter()
        .filter(|(p, _)| p.state == PrState::Open)
        .collect();
    if open.is_empty() {
        return None;
    }
    if auto {
        return Some(Mark::Auto);
    }
    if stale {
        return Some(Mark::Stale);
    }
    if open
        .iter()
        .any(|(p, unresolved)| p.ci() == Ci::Failing || *unresolved > 0 || p.merge_state == "DIRTY")
    {
        return Some(Mark::Fail);
    }
    if open.iter().any(|(p, _)| p.ci() == Ci::Running) {
        return Some(Mark::Wait);
    }
    Some(Mark::Ok)
}

/// One auto-fix round: failed checks with their log excerpts first, then unresolved threads.
pub fn fix_prompt(
    pr: &PrStatus,
    checks: &[(Check, String)],
    threads: &[&Comment],
    push: &str,
) -> String {
    let mut out = vec![format!(
        "herdr-pr auto-fix for {} \"{}\" (branch {}).",
        pr.pr.key(),
        pr.title,
        pr.head
    )];
    if !checks.is_empty() {
        out.push(String::new());
        out.push("Failed checks:".into());
        for (check, log) in checks {
            let url = check
                .url
                .as_deref()
                .map(|u| format!(" ({u})"))
                .unwrap_or_default();
            out.push(format!("- {}{url}", check.name));
            if !log.trim().is_empty() {
                out.push(format!("```\n{}\n```", log.trim_end()));
            }
        }
    }
    if !threads.is_empty() {
        out.push(String::new());
        out.push("Unresolved review threads:".into());
        for thread in threads {
            let (priority, text) = summarize_comment(&thread.body);
            let priority = priority.map(|p| format!("{p} ")).unwrap_or_default();
            let location = thread
                .location
                .as_deref()
                .map(|l| format!(", {l}"))
                .unwrap_or_default();
            out.push(format!(
                "- {priority}{text} ({}{location}) {}",
                short_author(&thread.author),
                thread.url
            ));
        }
    }
    out.push(String::new());
    out.push(format!(
        "Fix the failed checks first, then each valid review finding, on branch {}. Run the related tests. \
         Skip findings that are wrong and say why. Do not reply to or resolve review threads. \
         When done, commit and push with `{push}`.",
        pr.head
    ));
    out.join("\n")
}

/// A one-off prompt about a single comment, from the board.
pub fn comment_fix_prompt(pr: &PrStatus, comment: &Comment, push: &str) -> String {
    let location = comment
        .location
        .as_deref()
        .map(|l| format!(" on {l}"))
        .unwrap_or_default();
    [
        format!(
            "Review comment from {} on {} \"{}\"{location} ({}):",
            short_author(&comment.author),
            pr.pr.key(),
            pr.title,
            comment.url
        ),
        String::new(),
        comment_plain_text(&comment.body),
        String::new(),
        format!(
            "Check whether it is right. If it is, fix it on branch {} and run the related tests; if not, tell me why. \
             Do not reply to or resolve the thread. When done, commit and push with `{push}`.",
            pr.head
        ),
    ]
    .join("\n")
}

/// Rows in stack order: a PR whose base is another watched PR's head follows it, one level deeper.
pub fn order_as_stacks(list: &[&PrStatus]) -> Vec<(usize, usize)> {
    // Returns (index into `list`, depth).
    let mut rows = Vec::new();
    let mut visited = vec![false; list.len()];
    fn visit(
        i: usize,
        depth: usize,
        list: &[&PrStatus],
        visited: &mut [bool],
        rows: &mut Vec<(usize, usize)>,
    ) {
        if visited[i] {
            return;
        }
        visited[i] = true;
        rows.push((i, depth));
        for (j, child) in list.iter().enumerate() {
            if j != i && child.pr.repo == list[i].pr.repo && child.base == list[i].head {
                visit(j, depth + 1, list, visited, rows);
            }
        }
    }
    for (i, pr) in list.iter().enumerate() {
        let has_parent = list
            .iter()
            .any(|p| p.pr.repo == pr.pr.repo && p.head == pr.base && p.pr != pr.pr);
        if !has_parent {
            visit(i, 0, list, &mut visited, &mut rows);
        }
    }
    // A cycle leaves PRs unvisited; show them flat rather than drop them.
    for i in 0..list.len() {
        if !visited[i] {
            visit(i, 0, list, &mut visited, &mut rows);
        }
    }
    rows
}

#[cfg(test)]
pub mod tests {
    use super::*;

    pub fn pr(number: u64) -> PrStatus {
        PrStatus {
            pr: PrRef {
                repo: "o/r".into(),
                number,
            },
            title: "t".into(),
            url: format!("https://github.com/o/r/pull/{number}"),
            state: PrState::Open,
            draft: false,
            base: "main".into(),
            head: format!("b{number}"),
            head_oid: "abc".into(),
            merge_state: "CLEAN".into(),
            review_decision: String::new(),
            checks: vec![],
            comments: vec![],
        }
    }

    pub fn comment(author: &str, body: &str, resolved: Option<bool>, at: &str) -> Comment {
        Comment {
            id: format!("{author}-{at}"),
            author: author.into(),
            body: body.into(),
            url: "https://github.com/o/r/pull/1#c".into(),
            created_at: at.into(),
            location: None,
            resolved,
        }
    }

    #[test]
    fn reads_refs_from_short_refs_github_and_graphite_urls_once_each() {
        let text = "framer/creators#5037\n\
            https://github.com/framer/FramerCreatorsService/pull/1039\n\
            https://app.graphite.com/github/pr/framer/FramerCreatorsService/1040 (created)\n\
            https://github.com/framer/FramerCreatorsService/pull/1039#issuecomment-1";
        let keys: Vec<String> = parse_pr_refs(text).iter().map(PrRef::key).collect();
        assert_eq!(
            keys,
            [
                "framer/FramerCreatorsService#1039",
                "framer/FramerCreatorsService#1040",
                "framer/creators#5037"
            ]
        );
    }

    #[test]
    fn shortens_long_repo_names_to_initials() {
        assert_eq!(
            short_name(&PrRef {
                repo: "framer/FramerCreatorsService".into(),
                number: 1039
            }),
            "FCS#1039"
        );
        assert_eq!(
            short_name(&PrRef {
                repo: "framer/creators".into(),
                number: 5037
            }),
            "creators#5037"
        );
    }

    #[test]
    fn hides_own_comments_and_noise_and_puts_unresolved_threads_first() {
        let mut p = pr(1);
        p.comments = vec![
            comment("me", "mine", None, "2026-01-05"),
            comment("vercel[bot]", "preview", None, "2026-01-05"),
            comment("alice", "old plain", None, "2026-01-01"),
            comment("bob", "resolved", Some(true), "2026-01-04"),
            comment("carol", "open thread", Some(false), "2026-01-02"),
            comment(
                "chatgpt-codex-connector[bot]",
                "## 💡 Codex Review\nhere",
                None,
                "2026-01-03",
            ),
            comment("dave", "   ", None, "2026-01-03"),
        ];
        let authors: Vec<&str> = visible_comments(&p, "me")
            .iter()
            .map(|c| c.author.as_str())
            .collect();
        assert_eq!(authors, ["carol", "bob", "alice"]);
        assert_eq!(unresolved_threads(&p, "me").len(), 1);
    }

    #[test]
    fn summarizes_ci_with_failure_over_pending_over_passing() {
        let mut p = pr(1);
        assert_eq!(p.ci(), Ci::None);
        let check = |name: &str, state| Check {
            name: name.into(),
            state,
            url: None,
        };
        p.checks = vec![
            check("a", CheckState::Success),
            check("b", CheckState::Pending),
        ];
        assert_eq!(p.ci(), Ci::Running);
        p.checks.push(check("c", CheckState::Failure));
        assert_eq!(p.ci(), Ci::Failing);
        assert_eq!(p.failed_checks().len(), 1);
    }

    #[test]
    fn names_merge_readiness() {
        let mut p = pr(1);
        assert_eq!(merge_readiness(&p), ("ready to merge", Tone::Success));
        p.merge_state = "DIRTY".into();
        assert_eq!(merge_readiness(&p).0, "merge conflicts");
        p.draft = true;
        assert_eq!(merge_readiness(&p).0, "draft");
        p.state = PrState::Merged;
        assert_eq!(merge_readiness(&p).0, "merged");
    }

    #[test]
    fn strips_html_badges_tables_and_footers_from_comments() {
        let body = "**<sub><sub>![P1 Badge](https://x/p1.svg)</sub></sub>  Preserve expert eligibility**\n\n\
            When the [site](https://x) is gone <!-- hidden -->\n| a | b |\n---\nWas this helpful? React with 👍";
        assert_eq!(
            comment_plain_text(body),
            "Preserve expert eligibility\n\nWhen the site is gone"
        );
        assert_eq!(
            summarize_comment(body),
            (Some("P1".into()), "Preserve expert eligibility".into())
        );
        assert_eq!(
            summarize_comment("🟡 Missing null check\nmore"),
            (Some("P2".into()), "Missing null check".into())
        );
    }

    #[test]
    fn separates_bot_verdicts_from_findings() {
        let found = comment(
            "devin-ai-integration[bot]",
            "Devin Review found 2 potential issues.",
            None,
            "1",
        );
        let none = comment(
            "devin-ai-integration[bot]",
            "✅ Devin Review: No Issues Found",
            None,
            "1",
        );
        let finding = comment(
            "devin-ai-integration[bot]",
            "🔴 Null check missing",
            Some(false),
            "1",
        );
        assert!(is_verdict(&found) && is_verdict(&none) && !is_verdict(&finding));
        assert_eq!(verdict_text(&found), ("2 issues".into(), false));
        assert_eq!(verdict_text(&none), ("no issues".into(), true));
        let changes = comment("copilot", "🟡 Changes recommended", None, "1");
        assert_eq!(
            verdict_text(&changes),
            ("changes recommended".into(), false)
        );
    }

    #[test]
    fn shortens_bot_authors() {
        assert_eq!(short_author("chatgpt-codex-connector[bot]"), "codex");
        assert_eq!(short_author("alice"), "alice");
    }

    #[test]
    fn marks_the_worst_state_of_the_whole_stack() {
        let check = |state| Check {
            name: "t".into(),
            state,
            url: None,
        };
        let mut ok = pr(1);
        ok.checks = vec![check(CheckState::Success)];
        let mut running = pr(2);
        running.checks = vec![check(CheckState::Pending)];
        let mut failing = pr(3);
        failing.checks = vec![check(CheckState::Failure)];
        let mut merged = pr(4);
        merged.state = PrState::Merged;
        merged.checks = vec![check(CheckState::Failure)];

        assert_eq!(mark(&[], false, false), None);
        assert_eq!(mark(&[(&merged, 0)], false, false), None);
        assert_eq!(
            mark(&[(&ok, 0), (&merged, 0)], false, false),
            Some(Mark::Ok)
        );
        assert_eq!(
            mark(&[(&ok, 0), (&running, 0)], false, false),
            Some(Mark::Wait)
        );
        assert_eq!(
            mark(&[(&running, 0), (&failing, 0)], false, false),
            Some(Mark::Fail)
        );
        assert_eq!(
            mark(&[(&ok, 2)], false, false),
            Some(Mark::Fail),
            "unresolved threads need you"
        );
        let mut conflicted = ok.clone();
        conflicted.merge_state = "DIRTY".into();
        assert_eq!(mark(&[(&conflicted, 0)], false, false), Some(Mark::Fail));
        assert_eq!(mark(&[(&failing, 0)], false, true), Some(Mark::Stale));
        assert_eq!(mark(&[(&failing, 0)], true, true), Some(Mark::Auto));
    }

    #[test]
    fn fix_prompt_lists_checks_before_threads_and_names_the_push_command() {
        let mut p = pr(7);
        p.head = "feat/x".into();
        let check = Check {
            name: "Test".into(),
            state: CheckState::Failure,
            url: Some("https://ci/1".into()),
        };
        let thread = Comment {
            location: Some("a.rs:3".into()),
            ..comment("alice", "Use a guard", Some(false), "t")
        };
        let text = fix_prompt(&p, &[(check, "boom\n".into())], &[&thread], "gh stack push");
        let checks_at = text.find("Failed checks:").unwrap();
        let threads_at = text.find("Unresolved review threads:").unwrap();
        assert!(checks_at < threads_at);
        assert!(text.contains("- Test (https://ci/1)\n```\nboom\n```"));
        assert!(text.contains("- Use a guard (alice, a.rs:3)"));
        assert!(text.contains("`gh stack push`"));
    }

    #[test]
    fn orders_prs_as_stacks() {
        let mut a = pr(1);
        a.head = "a".into();
        let mut b = pr(2);
        b.base = "a".into();
        b.head = "b".into();
        let mut c = pr(3);
        c.base = "b".into();
        c.head = "c".into();
        let list = [&c, &a, &b];
        assert_eq!(order_as_stacks(&list), vec![(1, 0), (2, 1), (0, 2)]);
    }
}
