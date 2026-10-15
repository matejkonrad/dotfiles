//! The auto-fix decision, kept pure: given a PR, its loop state, and the agent's status,
//! what happens next. The daemon carries out the step and records the new state.

use serde::{Deserialize, Serialize};

use crate::model::{Check, Ci, Comment, PrState, PrStatus, unresolved_threads};

pub const MAX_ROUNDS: u32 = 5;
/// The same failure coming back this many times stops the loop.
pub const MAX_REPEATS: u32 = 2;
/// After a round, GitHub needs a moment to register the pushed commit and its checks.
pub const GRACE_SECS: u64 = 90;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "phase", rename_all = "snake_case")]
pub enum Phase {
    /// Evaluate on the next tick.
    #[default]
    Ready,
    /// A prompt is with the agent.
    Running,
    /// The round ended; wait for CI on whatever the agent pushed.
    WaitingCi,
    /// The agent asked something; wait until it is idle again.
    WaitingAgent,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AutoState {
    #[serde(flatten)]
    pub phase: Phase,
    #[serde(default)]
    pub rounds: u32,
    /// Failed checks and new threads of the last round, to detect a repeat.
    #[serde(default)]
    pub last_sig: String,
    #[serde(default)]
    pub repeats: u32,
    /// Threads already given to the agent; it judged them, so they are not sent again.
    #[serde(default)]
    pub sent_threads: Vec<String>,
    /// Head commit when the last round started, to tell whether the agent pushed.
    #[serde(default)]
    pub round_head: String,
    /// Unix seconds when the last round ended.
    #[serde(default)]
    pub ended_at: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StopReason {
    /// No failing checks and no new threads.
    Done,
    RoundCap,
    Repeated,
    Closed,
    AgentGone,
}

impl StopReason {
    pub fn text(self) -> &'static str {
        match self {
            StopReason::Done => "checks pass, no new review threads",
            StopReason::RoundCap => "round limit reached",
            StopReason::Repeated => "the same failure keeps coming back",
            StopReason::Closed => "the PR is merged or closed",
            StopReason::AgentGone => "the agent pane is gone",
        }
    }
}

#[derive(Debug, PartialEq)]
pub enum Step {
    Wait,
    Start {
        checks: Vec<Check>,
        threads: Vec<Comment>,
        sig: String,
    },
    Stop(StopReason),
}

fn agent_free(status: &str) -> bool {
    matches!(status, "idle" | "done")
}

/// `agent` is the agent pane's status, or None when the pane no longer exists. `now` is unix seconds.
pub fn next_step(
    pr: &PrStatus,
    state: &AutoState,
    agent: Option<&str>,
    me: &str,
    now: u64,
) -> Step {
    if pr.state != PrState::Open {
        return Step::Stop(StopReason::Closed);
    }
    let Some(agent) = agent else {
        return Step::Stop(StopReason::AgentGone);
    };
    if state.phase == Phase::Running || !agent_free(agent) {
        return Step::Wait;
    }
    let ci = pr.ci();
    // After a round, judge the agent's push only once GitHub has its checks and they finished.
    if state.phase == Phase::WaitingCi {
        let pushed = pr.head_oid != state.round_head;
        if now < state.ended_at + GRACE_SECS
            || (pushed && pr.checks.is_empty())
            || ci == Ci::Running
        {
            return Step::Wait;
        }
    }
    let checks: Vec<Check> = pr.failed_checks().into_iter().cloned().collect();
    let threads: Vec<Comment> = unresolved_threads(pr, me)
        .into_iter()
        .filter(|t| !state.sent_threads.contains(&t.id))
        .cloned()
        .collect();
    if checks.is_empty() && threads.is_empty() {
        return if ci == Ci::Running {
            Step::Wait
        } else {
            Step::Stop(StopReason::Done)
        };
    }
    if state.rounds >= MAX_ROUNDS {
        return Step::Stop(StopReason::RoundCap);
    }
    let mut sig: Vec<String> = checks.iter().map(|c| format!("check:{}", c.name)).collect();
    sig.extend(threads.iter().map(|t| format!("thread:{}", t.id)));
    sig.sort();
    let sig = sig.join(",");
    if sig == state.last_sig && state.repeats + 1 >= MAX_REPEATS {
        return Step::Stop(StopReason::Repeated);
    }
    Step::Start {
        checks,
        threads,
        sig,
    }
}

/// The state after the daemon sent a round's prompt.
pub fn started(state: &AutoState, pr: &PrStatus, sig: &str, threads: &[Comment]) -> AutoState {
    let mut next = state.clone();
    next.round_head = pr.head_oid.clone();
    next.phase = Phase::Running;
    next.rounds += 1;
    next.repeats = if sig == state.last_sig {
        state.repeats + 1
    } else {
        0
    };
    next.last_sig = sig.to_string();
    next.sent_threads
        .extend(threads.iter().map(|t| t.id.clone()));
    next
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::CheckState;
    use crate::model::tests::{comment, pr};

    fn failing() -> PrStatus {
        let mut p = pr(1);
        p.checks = vec![Check {
            name: "test".into(),
            state: CheckState::Failure,
            url: None,
        }];
        p
    }

    #[test]
    fn stops_when_closed_or_the_agent_is_gone() {
        let mut p = failing();
        assert_eq!(
            next_step(&p, &AutoState::default(), None, "me", 1000),
            Step::Stop(StopReason::AgentGone)
        );
        p.state = PrState::Merged;
        assert_eq!(
            next_step(&p, &AutoState::default(), Some("idle"), "me", 1000),
            Step::Stop(StopReason::Closed)
        );
    }

    #[test]
    fn waits_while_the_agent_works_or_a_round_runs() {
        let p = failing();
        assert_eq!(
            next_step(&p, &AutoState::default(), Some("working"), "me", 1000),
            Step::Wait
        );
        assert_eq!(
            next_step(&p, &AutoState::default(), Some("blocked"), "me", 1000),
            Step::Wait
        );
        let running = AutoState {
            phase: Phase::Running,
            ..AutoState::default()
        };
        assert_eq!(
            next_step(&p, &running, Some("idle"), "me", 1000),
            Step::Wait
        );
    }

    #[test]
    fn starts_with_failed_checks_and_new_threads_only() {
        let mut p = failing();
        let mut old = comment("alice", "old", Some(false), "1");
        old.id = "T1".into();
        let mut new = comment("alice", "new", Some(false), "2");
        new.id = "T2".into();
        p.comments = vec![old, new];
        let state = AutoState {
            sent_threads: vec!["T1".into()],
            ..AutoState::default()
        };
        let Step::Start {
            checks,
            threads,
            sig,
        } = next_step(&p, &state, Some("done"), "me", 1000)
        else {
            panic!()
        };
        assert_eq!(checks.len(), 1);
        assert_eq!(
            threads.iter().map(|t| t.id.as_str()).collect::<Vec<_>>(),
            ["T2"]
        );
        assert_eq!(sig, "check:test,thread:T2");
    }

    #[test]
    fn waits_for_ci_on_the_pushed_commit_then_finishes_green() {
        let mut p = pr(1);
        p.checks = vec![Check {
            name: "test".into(),
            state: CheckState::Pending,
            url: None,
        }];
        let after = AutoState {
            phase: Phase::WaitingCi,
            rounds: 1,
            ..AutoState::default()
        };
        assert_eq!(next_step(&p, &after, Some("idle"), "me", 1000), Step::Wait);
        p.checks[0].state = CheckState::Success;
        assert_eq!(
            next_step(&p, &after, Some("idle"), "me", 1000),
            Step::Stop(StopReason::Done)
        );
    }

    #[test]
    fn stops_when_the_same_failure_comes_back_twice() {
        let p = failing();
        let Step::Start { sig, threads, .. } =
            next_step(&p, &AutoState::default(), Some("idle"), "me", 1000)
        else {
            panic!()
        };
        let mut state = started(&AutoState::default(), &p, &sig, &threads);
        state.phase = Phase::WaitingCi;
        // Back once: one more try.
        let Step::Start { sig, threads, .. } = next_step(&p, &state, Some("idle"), "me", 1000)
        else {
            panic!()
        };
        state = started(&state, &p, &sig, &threads);
        assert_eq!(state.repeats, 1);
        state.phase = Phase::WaitingCi;
        // Back twice: stop.
        assert_eq!(
            next_step(&p, &state, Some("idle"), "me", 1000),
            Step::Stop(StopReason::Repeated)
        );
    }

    #[test]
    fn waits_out_the_grace_period_and_for_checks_on_a_pushed_commit() {
        let mut p = failing();
        let state = AutoState {
            phase: Phase::WaitingCi,
            round_head: "abc".into(),
            ended_at: 950,
            ..AutoState::default()
        };
        assert_eq!(next_step(&p, &state, Some("idle"), "me", 1000), Step::Wait);
        p.head_oid = "def".into();
        p.checks.clear();
        assert_eq!(next_step(&p, &state, Some("idle"), "me", 2000), Step::Wait);
    }

    #[test]
    fn stops_at_the_round_cap() {
        let state = AutoState {
            phase: Phase::WaitingCi,
            rounds: MAX_ROUNDS,
            ..AutoState::default()
        };
        assert_eq!(
            next_step(&failing(), &state, Some("idle"), "me", 1000),
            Step::Stop(StopReason::RoundCap)
        );
    }

    #[test]
    fn a_new_failure_resets_the_repeat_count() {
        let state = AutoState {
            last_sig: "check:lint".into(),
            repeats: 1,
            ..AutoState::default()
        };
        let next = started(&state, &pr(1), "check:test", &[]);
        assert_eq!(
            (next.repeats, next.rounds, next.phase),
            (0, 1, Phase::Running)
        );
    }
}
