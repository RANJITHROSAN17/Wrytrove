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

/// What the save was actually able to check about the file it left behind. Every value describes a
/// metadata comparison this crate can perform; none of them is a durability guarantee.
///
/// The save deliberately does not claim anything about the Windows DACL. The staged file is
/// created fresh beside the destination and therefore inherits only the parent directory's
/// inheritable access control entries, so an explicit, non-inherited ACL on the original is not
/// carried across the rename. Reporting that as a warning on every save told the user nothing they
/// could act on, so the banner is now driven by what the post-commit inspection really finds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MetadataPreservation {
    /// The destination did not exist before the save, so there was no metadata to carry over.
    NotApplicable,
    /// Every part of the final file's inspectable metadata matches the original's.
    Preserved,
    /// The final file's inspectable metadata differs from the original's.
    Changed,
    /// The final file could not be inspected after the commit.
    NotVerified,
}

impl MetadataPreservation {
    fn name(self) -> &'static str {
        match self {
            Self::NotApplicable => "not_applicable",
            Self::Preserved => "preserved",
            Self::Changed => "changed",
            Self::NotVerified => "not_verified",
        }
    }
}

#[derive(Debug)]
pub struct SaveCommit {
    pub identity: Option<crate::file_identity::FileIdentity>,
    pub permissions: PermissionAction,
    pub preservation: MetadataPreservation,
}

pub fn committed(
    identity: Option<String>,
    permissions: PermissionAction,
    preservation: MetadataPreservation,
) -> serde_json::Value {
    let permissions = match permissions {
        PermissionAction::CopiedToTemp => "copied_to_temp",
        PermissionAction::NotApplied => "not_applied",
    };
    serde_json::json!({ "phase": "committed", "identity": identity,
        "metadata": { "permissions": permissions, "preservation": preservation.name() } })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn serializes_structured_success_and_failures_without_durability_claims() {
        assert_eq!(committed(Some("id".into()), PermissionAction::CopiedToTemp, MetadataPreservation::Preserved), serde_json::json!({
            "phase": "committed", "identity": "id", "metadata": {"permissions": "copied_to_temp", "preservation": "preserved"}
        }));
        assert_eq!(committed(None, PermissionAction::NotApplied, MetadataPreservation::NotApplicable), serde_json::json!({
            "phase": "committed", "identity": null, "metadata": {"permissions": "not_applied", "preservation": "not_applicable"}
        }));
        // Only a detected difference or a failed inspection is worth reporting to the user.
        assert_eq!(committed(None, PermissionAction::CopiedToTemp, MetadataPreservation::Changed)["metadata"]["preservation"], "changed");
        assert_eq!(committed(None, PermissionAction::CopiedToTemp, MetadataPreservation::NotVerified)["metadata"]["preservation"], "not_verified");
        let failure = SaveFailure::new(SavePhase::Replace, "Cannot replace the original file: denied").json();
        assert_eq!(failure["phase"], "replace");
        assert_eq!(failure["kind"], "failure");
        let conflict = SaveFailure::new(SavePhase::Revalidate, "WRYTROVE_FILE_CHANGED: changed").json();
        assert_eq!(conflict["phase"], "revalidate");
        assert_eq!(conflict["kind"], "conflict");
    }
}
