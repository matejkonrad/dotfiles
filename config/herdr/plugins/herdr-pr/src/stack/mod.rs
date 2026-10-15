//! A stack tool manages chains of dependent branches (gh stack today; Graphite or git-town later).

pub mod gh_stack;

use std::path::Path;

use anyhow::Result;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StackBranch {
    pub name: String,
    pub pr: Option<u64>,
}

#[allow(async_fn_in_trait)]
pub trait Stack {
    /// The branches of the stack that holds `branch`, bottom to top. None when it is in no stack.
    async fn stack_of(&self, checkout: &Path, branch: &str) -> Result<Option<Vec<StackBranch>>>;
    /// What the agent runs to push after a fix.
    fn push_command(&self) -> &'static str;
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AnyStack {
    GhStack,
    /// No stack tool: one PR per branch, pushed with git.
    Plain,
}

impl AnyStack {
    /// From the config name, e.g. `stack = "plain"` for one repo.
    pub fn from_name(name: &str) -> Option<AnyStack> {
        match name {
            "gh-stack" => Some(AnyStack::GhStack),
            "plain" => Some(AnyStack::Plain),
            _ => None,
        }
    }
}

impl Stack for AnyStack {
    async fn stack_of(&self, checkout: &Path, branch: &str) -> Result<Option<Vec<StackBranch>>> {
        match self {
            AnyStack::GhStack => gh_stack::stack_of(checkout, branch).await,
            AnyStack::Plain => Ok(None),
        }
    }

    fn push_command(&self) -> &'static str {
        match self {
            AnyStack::GhStack => "gh stack push",
            AnyStack::Plain => "git push",
        }
    }
}
