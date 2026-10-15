//! GitHub through the `gh` CLI, so the user's existing login is reused and no token is stored.

use std::collections::HashMap;
use std::time::Duration;

use anyhow::{Context, Result, bail};
use regex::Regex;
use serde_json::Value;

use super::{Fetched, Forge};
use crate::model::{Check, CheckState, Comment, PrRef, PrState, PrStatus};
use crate::proc;

const GH_TIMEOUT: Duration = Duration::from_secs(45);
const LOG_LINES: usize = 120;

#[derive(Clone)]
pub struct Github;

const PR_FRAGMENT: &str = r#"fragment pr on PullRequest {
  number title url state isDraft reviewDecision mergeStateStatus baseRefName headRefName headRefOid
  commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100) { nodes {
    __typename
    ... on CheckRun { name status conclusion detailsUrl }
    ... on StatusContext { context state targetUrl }
  } } } } } }
  comments(last: 50) { nodes { author { login } body url createdAt } }
  reviews(last: 50) { nodes { author { login } body url submittedAt } }
  reviewThreads(first: 100) { nodes { id isResolved path line comments(first: 1) { nodes { author { login } body url createdAt } } } }
}"#;

/// One query for every PR: alias `p<i>` per PR, so a missing PR nulls only its own alias.
pub fn batch_query(prs: &[PrRef]) -> String {
    let mut q = String::from("query {\n");
    for (i, pr) in prs.iter().enumerate() {
        let (owner, name) = pr.repo.split_once('/').unwrap_or((&pr.repo, ""));
        // Repo names come from git remotes and PR refs: [\w.-] only, so quoting is safe.
        q.push_str(&format!(
            "  p{i}: repository(owner: {owner:?}, name: {name:?}) {{ pullRequest(number: {}) {{ ...pr }} }}\n",
            pr.number
        ));
    }
    q.push_str("}\n");
    q.push_str(PR_FRAGMENT);
    q
}

fn str_at<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(Value::as_str).unwrap_or("")
}

fn login(v: &Value) -> String {
    v.get("author")
        .and_then(|a| a.get("login"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string()
}

fn nodes<'a>(v: &'a Value, key: &str) -> &'a [Value] {
    v.get(key)
        .and_then(|c| c.get("nodes"))
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
}

fn check_of(node: &Value) -> Check {
    let is_run = str_at(node, "__typename") == "CheckRun";
    let (name, url) = if is_run {
        (str_at(node, "name"), node.get("detailsUrl"))
    } else {
        (str_at(node, "context"), node.get("targetUrl"))
    };
    let state = if is_run {
        if str_at(node, "status") != "COMPLETED" {
            CheckState::Pending
        } else {
            match str_at(node, "conclusion") {
                "FAILURE" | "CANCELLED" | "TIMED_OUT" | "ACTION_REQUIRED" | "STARTUP_FAILURE"
                | "ERROR" => CheckState::Failure,
                "SKIPPED" | "NEUTRAL" | "STALE" => CheckState::Skipped,
                _ => CheckState::Success,
            }
        }
    } else {
        match str_at(node, "state") {
            "PENDING" | "EXPECTED" => CheckState::Pending,
            "FAILURE" | "ERROR" => CheckState::Failure,
            _ => CheckState::Success,
        }
    };
    Check {
        name: if name.is_empty() {
            "check".into()
        } else {
            name.into()
        },
        state,
        url: url.and_then(Value::as_str).map(str::to_string),
    }
}

pub fn parse_pr(node: &Value, pr: &PrRef) -> Result<PrStatus> {
    let state = match str_at(node, "state") {
        "OPEN" => PrState::Open,
        "MERGED" => PrState::Merged,
        "CLOSED" => PrState::Closed,
        other => bail!("unknown PR state {other:?}"),
    };
    let contexts = node
        .pointer("/commits/nodes/0/commit/statusCheckRollup/contexts/nodes")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    // A re-run adds a second entry under the same name; the later one is current.
    let mut checks: Vec<Check> = Vec::new();
    for check in contexts.iter().map(check_of) {
        match checks.iter_mut().find(|c| c.name == check.name) {
            Some(slot) => *slot = check,
            None => checks.push(check),
        }
    }
    let mut comments: Vec<Comment> = nodes(node, "comments")
        .iter()
        .map(|c| Comment {
            id: str_at(c, "url").into(),
            author: login(c),
            body: str_at(c, "body").into(),
            url: str_at(c, "url").into(),
            created_at: str_at(c, "createdAt").into(),
            location: None,
            resolved: None,
        })
        .collect();
    comments.extend(nodes(node, "reviews").iter().map(|r| Comment {
        id: str_at(r, "url").into(),
        author: login(r),
        body: str_at(r, "body").into(),
        url: str_at(r, "url").into(),
        created_at: str_at(r, "submittedAt").into(),
        location: None,
        resolved: None,
    }));
    for thread in nodes(node, "reviewThreads") {
        let Some(first) = nodes(thread, "comments").first() else {
            continue;
        };
        let path = str_at(thread, "path");
        // An outdated thread has no line any more, so it shows the file alone.
        let location = match (path, thread.get("line").and_then(Value::as_u64)) {
            ("", _) => None,
            (p, Some(line)) => Some(format!("{p}:{line}")),
            (p, None) => Some(p.to_string()),
        };
        comments.push(Comment {
            id: str_at(thread, "id").into(),
            author: login(first),
            body: str_at(first, "body").into(),
            url: str_at(first, "url").into(),
            created_at: str_at(first, "createdAt").into(),
            location,
            resolved: Some(
                thread
                    .get("isResolved")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
            ),
        });
    }
    Ok(PrStatus {
        pr: pr.clone(),
        title: str_at(node, "title").into(),
        url: str_at(node, "url").into(),
        state,
        draft: node
            .get("isDraft")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        base: str_at(node, "baseRefName").into(),
        head: str_at(node, "headRefName").into(),
        head_oid: str_at(node, "headRefOid").into(),
        merge_state: str_at(node, "mergeStateStatus").into(),
        review_decision: str_at(node, "reviewDecision").into(),
        checks,
        comments,
    })
}

/// The response of `batch_query`, one result per requested PR, in order.
pub fn parse_batch(body: &Value, prs: &[PrRef]) -> Result<Vec<Fetched>> {
    let Some(data) = body.get("data").filter(|d| d.is_object()) else {
        let message = body
            .pointer("/errors/0/message")
            .and_then(Value::as_str)
            .unwrap_or("no data in response");
        bail!("{message}");
    };
    let mut errors: HashMap<String, String> = HashMap::new();
    for err in body
        .get("errors")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        if let Some(alias) = err.pointer("/path/0").and_then(Value::as_str) {
            errors.insert(alias.to_string(), str_at(err, "message").to_string());
        }
    }
    Ok(prs
        .iter()
        .enumerate()
        .map(|(i, pr)| {
            let alias = format!("p{i}");
            let result = match data
                .get(&alias)
                .and_then(|r| r.get("pullRequest"))
                .filter(|n| n.is_object())
            {
                Some(node) => parse_pr(node, pr).map_err(|e| e.to_string()),
                None => Err(errors
                    .get(&alias)
                    .cloned()
                    .unwrap_or_else(|| "not found".into())),
            };
            (pr.clone(), result)
        })
        .collect())
}

fn run_id(url: &str) -> Option<String> {
    Regex::new(r"/actions/runs/(\d+)")
        .ok()?
        .captures(url)
        .map(|c| c[1].to_string())
}

impl Forge for Github {
    async fn viewer(&self) -> Result<String> {
        let out = proc::run("gh", &["api", "user", "--jq", ".login"], None, GH_TIMEOUT).await?;
        if !out.ok {
            bail!("gh api user: {}", out.error_line());
        }
        Ok(out.stdout.trim().to_string())
    }

    async fn pr_for_branch(&self, repo: &str, branch: &str) -> Result<Option<PrRef>> {
        let args = [
            "pr", "list", "-R", repo, "--head", branch, "--state", "open", "--json", "number",
            "--limit", "1",
        ];
        let out = proc::run("gh", &args, None, GH_TIMEOUT).await?;
        if !out.ok {
            bail!("gh pr list: {}", out.error_line());
        }
        let list: Value = serde_json::from_str(&out.stdout).context("gh pr list output")?;
        Ok(list
            .pointer("/0/number")
            .and_then(Value::as_u64)
            .map(|number| PrRef {
                repo: repo.to_string(),
                number,
            }))
    }

    async fn fetch(&self, prs: &[PrRef]) -> Result<Vec<Fetched>> {
        if prs.is_empty() {
            return Ok(Vec::new());
        }
        let query = format!("query={}", batch_query(prs));
        let out = proc::run("gh", &["api", "graphql", "-f", &query], None, GH_TIMEOUT).await?;
        // gh exits 1 when any alias errors (a deleted PR) but still prints the other PRs.
        match serde_json::from_str::<Value>(&out.stdout) {
            Ok(body) => parse_batch(&body, prs),
            Err(_) => bail!("gh api graphql: {}", out.error_line()),
        }
    }

    async fn check_log(&self, repo: &str, check: &Check) -> Result<String> {
        let Some(id) = check.url.as_deref().and_then(run_id) else {
            return Ok(String::new());
        };
        let out = proc::run(
            "gh",
            &["run", "view", &id, "--log-failed", "-R", repo],
            None,
            GH_TIMEOUT,
        )
        .await?;
        if !out.ok {
            return Ok(String::new());
        }
        let lines: Vec<&str> = out.stdout.lines().collect();
        let start = lines.len().saturating_sub(LOG_LINES);
        Ok(lines[start..].join("\n"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Value {
        serde_json::from_str(include_str!("../../tests/fixtures/github_batch.json")).unwrap()
    }

    fn refs() -> Vec<PrRef> {
        [12, 13, 99]
            .into_iter()
            .map(|number| PrRef {
                repo: "acme/app".into(),
                number,
            })
            .collect()
    }

    #[test]
    fn query_aliases_each_pr_with_quoted_names() {
        let q = batch_query(&refs()[..2]);
        assert!(q.contains(
            r#"p0: repository(owner: "acme", name: "app") { pullRequest(number: 12) { ...pr } }"#
        ));
        assert!(q.contains("p1: repository"));
        assert!(q.contains("fragment pr on PullRequest"));
    }

    #[test]
    fn parses_checks_keeping_the_latest_run_per_name() {
        let out = parse_batch(&fixture(), &refs()).unwrap();
        let pr = out[0].1.as_ref().unwrap();
        let states: Vec<(&str, CheckState)> = pr
            .checks
            .iter()
            .map(|c| (c.name.as_str(), c.state))
            .collect();
        assert_eq!(
            states,
            [
                ("test", CheckState::Failure),
                ("lint", CheckState::Pending),
                ("docs", CheckState::Skipped),
                ("deploy", CheckState::Success),
                ("preview", CheckState::Pending),
            ]
        );
        assert_eq!(
            pr.checks[0].url.as_deref(),
            Some("https://github.com/acme/app/actions/runs/556/job/2")
        );
        assert_eq!(
            (
                pr.head.as_str(),
                pr.head_oid.as_str(),
                pr.merge_state.as_str()
            ),
            ("feat/guard", "aaa111", "BEHIND")
        );
    }

    #[test]
    fn parses_comments_reviews_and_threads() {
        let out = parse_batch(&fixture(), &refs()).unwrap();
        let pr = out[0].1.as_ref().unwrap();
        let thread = pr.comments.iter().find(|c| c.id == "PRRT_1").unwrap();
        assert_eq!(
            (thread.resolved, thread.location.as_deref()),
            (Some(false), Some("src/a.rs:3"))
        );
        let outdated = pr.comments.iter().find(|c| c.id == "PRRT_2").unwrap();
        assert_eq!(outdated.location.as_deref(), Some("src/b.rs"));
        assert!(
            !pr.comments.iter().any(|c| c.id == "PRRT_3"),
            "a thread without comments is skipped"
        );
        assert!(
            pr.comments
                .iter()
                .any(|c| c.author == "carol" && c.resolved.is_none())
        );
    }

    #[test]
    fn reports_a_missing_pr_without_failing_the_others() {
        let out = parse_batch(&fixture(), &refs()).unwrap();
        assert_eq!(out[1].1.as_ref().unwrap().state, PrState::Merged);
        assert!(out[1].1.as_ref().unwrap().checks.is_empty());
        assert_eq!(
            out[2].1.as_ref().unwrap_err(),
            "Could not resolve to a PullRequest with the number of 99."
        );
    }

    #[test]
    fn fails_the_batch_when_there_is_no_data() {
        let body: Value =
            serde_json::from_str(r#"{"errors":[{"message":"Bad credentials"}]}"#).unwrap();
        assert_eq!(
            parse_batch(&body, &refs()).unwrap_err().to_string(),
            "Bad credentials"
        );
    }

    #[test]
    fn finds_the_actions_run_id() {
        assert_eq!(
            run_id("https://github.com/o/r/actions/runs/38265379047/job/1148").as_deref(),
            Some("38265379047")
        );
        assert_eq!(run_id("https://deploy"), None);
    }
}
