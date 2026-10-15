//! Durable daemon state: one JSON file in the plugin state dir, written atomically.
//! Keyed by checkout path, which survives herdr restarts (workspace ids may not).

use std::collections::BTreeMap;
use std::path::PathBuf;

use anyhow::Result;
use serde::{Deserialize, Serialize};

use crate::fixloop::{AutoState, Phase};
use crate::model::PrRef;

#[derive(Default, Debug, Serialize, Deserialize)]
pub struct WsStore {
    /// PRs added by hand.
    #[serde(default)]
    pub manual: Vec<PrRef>,
    /// PRs removed by hand, or merged/closed: never shown again for this checkout.
    #[serde(default)]
    pub hidden: Vec<PrRef>,
    /// PR key → ISO time the comments were last marked seen.
    #[serde(default)]
    pub seen_at: BTreeMap<String, String>,
    /// PR key → agent pane id that receives fix prompts.
    #[serde(default)]
    pub agent: BTreeMap<String, String>,
    /// PR key → auto-fix loop state. Present means auto-fix is on.
    #[serde(default)]
    pub auto: BTreeMap<String, AutoState>,
}

#[derive(Default, Debug, Serialize, Deserialize)]
pub struct StoreData {
    #[serde(default)]
    pub workspaces: BTreeMap<String, WsStore>,
}

pub struct Store {
    path: PathBuf,
    pub data: StoreData,
}

impl Store {
    pub fn load(path: PathBuf) -> Store {
        let mut data: StoreData = std::fs::read(&path)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default();
        // A round that was running when the daemon stopped has no waiter any more.
        for ws in data.workspaces.values_mut() {
            for state in ws.auto.values_mut() {
                if state.phase == Phase::Running {
                    state.phase = Phase::Ready;
                }
            }
        }
        Store { path, data }
    }

    pub fn ws(&mut self, key: &str) -> &mut WsStore {
        self.data.workspaces.entry(key.to_string()).or_default()
    }

    pub fn save(&self) -> Result<()> {
        let tmp = self.path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(&self.data)?)?;
        std::fs::rename(&tmp, &self.path)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resets_a_running_round_on_load_and_round_trips() {
        let dir = std::env::temp_dir().join(format!("herdr-pr-store-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("state.json");
        let mut store = Store::load(path.clone());
        store.ws("/src/app").auto.insert(
            "o/r#1".into(),
            AutoState {
                phase: Phase::Running,
                ..AutoState::default()
            },
        );
        store.ws("/src/app").manual.push(PrRef {
            repo: "o/r".into(),
            number: 2,
        });
        store.save().unwrap();

        let mut again = Store::load(path);
        assert_eq!(again.ws("/src/app").auto["o/r#1"].phase, Phase::Ready);
        assert_eq!(again.ws("/src/app").manual.len(), 1);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
