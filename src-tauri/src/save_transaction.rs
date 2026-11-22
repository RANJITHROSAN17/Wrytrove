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

/// Records an operation on the staged file, not a guarantee about the final file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PermissionAction {
    CopiedToTemp,
    NotApplied,
}

#[derive(Debug)]
pub struct SaveCommit {
    pub identity: Option<crate::file_identity::FileIdentity>,
    pub permissions: PermissionAction,
}

pub fn committed(identity: Option<String>, permissions: PermissionAction) -> serde_json::Value {
    let permissions = match permissions {
        PermissionAction::CopiedToTemp => "copied_to_temp",
        PermissionAction::NotApplied => "not_applied",
    };
    serde_json::json!({ "phase": "committed", "identity": identity,
        "metadata": { "permissions": permissions, "acl": "not_verified", "other": "not_verified" } })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn serializes_structured_success_and_failures_without_durability_claims() {
        assert_eq!(committed(Some("id".into()), PermissionAction::CopiedToTemp), serde_json::json!({
            "phase": "committed", "identity": "id", "metadata": {"permissions": "copied_to_temp", "acl": "not_verified", "other": "not_verified"}
        }));
        assert_eq!(committed(None, PermissionAction::NotApplied), serde_json::json!({
            "phase": "committed", "identity": null, "metadata": {"permissions": "not_applied", "acl": "not_verified", "other": "not_verified"}
        }));
        let failure = SaveFailure::new(SavePhase::Replace, "Cannot replace the original file: denied").json();
        assert_eq!(failure["phase"], "replace");
        assert_eq!(failure["kind"], "failure");
        let conflict = SaveFailure::new(SavePhase::Revalidate, "WRYTROVE_FILE_CHANGED: changed").json();
        assert_eq!(conflict["phase"], "revalidate");
        assert_eq!(conflict["kind"], "conflict");
    }
}
