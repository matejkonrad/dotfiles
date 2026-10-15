//! A forge hosts PRs (GitHub today, GitLab later). The daemon only sees the `Forge` trait
//! and the model types, so adding a forge means one new module and one `AnyForge` arm.

pub mod github;

use anyhow::Result;

use crate::model::{Check, PrRef, PrStatus};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ForgeKind {
    Github,
}

/// "owner/name" on a known forge, from a git remote URL.
pub fn repo_from_remote(url: &str) -> Option<(ForgeKind, String)> {
    let url = url.trim();
    let rest = url
        .strip_prefix("https://github.com/")
        .or_else(|| url.strip_prefix("http://github.com/"))
        .or_else(|| url.strip_prefix("ssh://git@github.com/"))
        .or_else(|| url.strip_prefix("ssh://git@github.com:"))
        .or_else(|| url.strip_prefix("git@github.com:"))?;
    let rest = rest.trim_end_matches('/');
    let rest = rest.strip_suffix(".git").unwrap_or(rest);
    let mut parts = rest.split('/');
    let (owner, name) = (parts.next()?, parts.next()?);
    if owner.is_empty() || name.is_empty() || parts.next().is_some() {
        return None;
    }
    Some((ForgeKind::Github, format!("{owner}/{name}")))
}

/// One fetched PR, or why it could not be fetched (not found, no access).
pub type Fetched = (PrRef, std::result::Result<PrStatus, String>);

#[allow(async_fn_in_trait)]
pub trait Forge {
    /// The logged-in user, whose own comments are not review findings.
    async fn viewer(&self) -> Result<String>;
    /// The open PR whose head is `branch`.
    async fn pr_for_branch(&self, repo: &str, branch: &str) -> Result<Option<PrRef>>;
    /// Status of many PRs in one request. Err only when the whole request failed.
    async fn fetch(&self, prs: &[PrRef]) -> Result<Vec<Fetched>>;
    /// The log of a failed check, shortened for a prompt.
    async fn check_log(&self, repo: &str, check: &Check) -> Result<String>;
}

/// Static dispatch over the forges, so the daemon stays free of trait objects.
#[derive(Clone)]
pub enum AnyForge {
    Github(github::Github),
}

impl AnyForge {
    pub fn for_kind(kind: ForgeKind) -> AnyForge {
        match kind {
            ForgeKind::Github => AnyForge::Github(github::Github),
        }
    }
}

impl Forge for AnyForge {
    async fn viewer(&self) -> Result<String> {
        match self {
            AnyForge::Github(f) => f.viewer().await,
        }
    }
    async fn pr_for_branch(&self, repo: &str, branch: &str) -> Result<Option<PrRef>> {
        match self {
            AnyForge::Github(f) => f.pr_for_branch(repo, branch).await,
        }
    }
    async fn fetch(&self, prs: &[PrRef]) -> Result<Vec<Fetched>> {
        match self {
            AnyForge::Github(f) => f.fetch(prs).await,
        }
    }
    async fn check_log(&self, repo: &str, check: &Check) -> Result<String> {
        match self {
            AnyForge::Github(f) => f.check_log(repo, check).await,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_github_repos_from_ssh_scp_and_https_remotes() {
        let want = Some((
            ForgeKind::Github,
            "framer/FramerCreatorsService".to_string(),
        ));
        assert_eq!(
            repo_from_remote("ssh://git@github.com/framer/FramerCreatorsService.git"),
            want
        );
        assert_eq!(
            repo_from_remote("git@github.com:framer/FramerCreatorsService.git\n"),
            want
        );
        assert_eq!(
            repo_from_remote("https://github.com/framer/FramerCreatorsService"),
            want
        );
        assert_eq!(repo_from_remote("https://gitlab.com/a/b.git"), None);
        assert_eq!(repo_from_remote("https://github.com/only-owner"), None);
    }
}
