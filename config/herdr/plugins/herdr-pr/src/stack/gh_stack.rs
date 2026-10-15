//! github/gh-stack: `gh stack view --json` lists the current stack's branches and PRs.

use std::path::Path;
use std::time::Duration;

use anyhow::Result;
use serde_json::Value;

use super::StackBranch;
use crate::proc;

/// None when the branch is in no stack, including trunk ("belongs to multiple stacks").
pub fn parse(stdout: &str, branch: &str) -> Option<Vec<StackBranch>> {
    let body: Value = serde_json::from_str(stdout).ok()?;
    let branches: Vec<StackBranch> = body
        .get("branches")?
        .as_array()?
        .iter()
        .filter_map(|b| {
            Some(StackBranch {
                name: b.get("name")?.as_str()?.to_string(),
                pr: b.pointer("/pr/number").and_then(Value::as_u64),
            })
        })
        .collect();
    // A one-branch "stack" adds nothing over the plain branch lookup.
    if branches.len() < 2 || !branches.iter().any(|b| b.name == branch) {
        return None;
    }
    Some(branches)
}

pub async fn stack_of(checkout: &Path, branch: &str) -> Result<Option<Vec<StackBranch>>> {
    let out = proc::run(
        "gh",
        &["stack", "view", "--json"],
        Some(checkout),
        Duration::from_secs(30),
    )
    .await?;
    // Not being in a stack is an error exit with a message, not a failure of ours.
    Ok(if out.ok {
        parse(&out.stdout, branch)
    } else {
        None
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const STACK: &str = r#"{
      "trunk": "main", "currentBranch": "feat/b",
      "branches": [
        { "name": "feat/a", "isCurrent": false, "isMerged": false, "pr": { "number": 11, "state": "OPEN" } },
        { "name": "feat/b", "isCurrent": true, "isMerged": false, "pr": { "number": 12, "state": "OPEN" } },
        { "name": "feat/c", "isCurrent": false, "isMerged": false }
      ]
    }"#;

    #[test]
    fn reads_branches_bottom_to_top_with_their_prs() {
        let got = parse(STACK, "feat/b").unwrap();
        let names: Vec<(&str, Option<u64>)> = got.iter().map(|b| (b.name.as_str(), b.pr)).collect();
        assert_eq!(
            names,
            [("feat/a", Some(11)), ("feat/b", Some(12)), ("feat/c", None)]
        );
    }

    #[test]
    fn is_none_outside_a_stack() {
        assert_eq!(
            parse("✗ current branch \"x\" is not part of a stack", "x"),
            None
        );
        assert_eq!(
            parse(
                "✗ branch \"main\" belongs to multiple stacks; checkout a non-trunk branch first",
                "main"
            ),
            None
        );
        assert_eq!(parse(STACK, "other"), None);
    }
}
