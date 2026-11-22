//! Machine-readable save outcomes. A phase identifies the attempted operation, not a durability
//! guarantee; in particular an error from replacement can leave the on-disk outcome uncertain.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SavePhase {
    Request,
    Verify,
    CreateTemp,
    WriteTemp,
    FlushTemp,
    PreservePermissions,
    Revalidate,
    Replace,
    Unknown,
}

impl SavePhase {
    fn name(self) -> &'static str {
        match self {
            Self::Request => "request",
            Self::Verify => "verify",
            Self::CreateTemp => "create_temp",
            Self::WriteTemp => "write_temp",
            Self::FlushTemp => "flush_temp",
            Self::PreservePermissions => "preserve_permissions",
            Self::Revalidate => "revalidate",
            Self::Replace => "replace",
            Self::Unknown => "unknown",
        }
    }
}

#[derive(Debug)]
pub struct SaveFailure {
    pub phase: SavePhase,
    pub message: String,
    pub conflict: bool,
}

impl SaveFailure {
    pub fn new(phase: SavePhase, message: impl Into<String>) -> Self {
        let message = message.into();
        let conflict = message.starts_with("WRYTROVE_FILE_CHANGED:");
        Self { phase, message, conflict }
    }

    pub fn json(&self) -> serde_json::Value {
        serde_json::json!({
            "phase": self.phase.name(),
            "kind": if self.conflict { "conflict" } else { "failure" },
            "message": self.message,
        })
    }
}

pub fn committed(identity: Option<String>) -> serde_json::Value {
    serde_json::json!({ "phase": "committed", "identity": identity })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn serializes_structured_success_and_failures_without_durability_claims() {
        assert_eq!(committed(Some("id".into())), serde_json::json!({"phase": "committed", "identity": "id"}));
        assert_eq!(committed(None), serde_json::json!({"phase": "committed", "identity": null}));
        let failure = SaveFailure::new(SavePhase::Replace, "Cannot replace the original file: denied").json();
        assert_eq!(failure["phase"], "replace");
        assert_eq!(failure["kind"], "failure");
        let conflict = SaveFailure::new(SavePhase::Revalidate, "WRYTROVE_FILE_CHANGED: changed").json();
        assert_eq!(conflict["phase"], "revalidate");
        assert_eq!(conflict["kind"], "conflict");
    }
}
