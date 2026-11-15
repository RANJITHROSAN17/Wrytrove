//! AUD-03: revocable folder access. A revoked folder is recorded in the app data folder, and the
//! native commands refuse reads, writes and listings under it until the folder is reopened.
//!
//! The record is read on every check, so a restart keeps the revocation. A damaged record fails
//! closed: access is refused rather than silently ignored. Matching is lexical, so a link inside a
//! revoked folder that points elsewhere is still refused, because its path is under the root.

use std::{fs, io::Write, path::{Path, PathBuf}, sync::Mutex};

pub const ACCESS_REVOKED: &str = "ACCESS_REVOKED";
const RECORD: &str = "revoked-access.v1.json";
static RECORD_LOCK: Mutex<()> = Mutex::new(());

fn record_path(dir: &Path) -> PathBuf { dir.join(RECORD) }

fn separator() -> char { if cfg!(windows) { '\\' } else { '/' } }

/// Comparable form of a path: one separator style, no trailing separator, case-folded on Windows.
fn key(path: &str) -> String {
    let sep = separator();
    let mut text: String = path.chars().map(|c| if c == '/' || c == '\\' { sep } else { c }).collect();
    while text.len() > 1 && text.ends_with(sep) { text.pop(); }
    if cfg!(windows) { text = text.to_lowercase(); }
    text
}

/// True when `path` is `root` or lies inside it. Checks the separator boundary, so `/a/foo` does
/// not cover `/a/foobar`.
fn covers(root: &str, path: &str) -> bool {
    if path == root { return true; }
    let sep = separator();
    let boundary = if root.ends_with(sep) { root.to_string() } else { format!("{root}{sep}") };
    path.starts_with(&boundary)
}

fn load(dir: &Path) -> Result<Vec<String>, String> {
    match fs::read_to_string(record_path(dir)) {
        Ok(text) => {
            let value: serde_json::Value = serde_json::from_str(&text).map_err(|_| damaged())?;
            let items = value.as_array().ok_or_else(damaged)?;
            items.iter().map(|item| item.as_str().map(str::to_owned).ok_or_else(damaged)).collect()
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(err) => Err(format!("{ACCESS_REVOKED}: cannot read the revoked-access record ({err})")),
    }
}

fn damaged() -> String {
    format!("{ACCESS_REVOKED}: the revoked-access record is damaged, so access is refused. Delete {RECORD} in the app data folder to restore access.")
}

fn store(dir: &Path, items: &[String]) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|err| format!("Cannot prepare the access record folder: {err}"))?;
    let json = serde_json::to_string(items).map_err(|err| format!("Cannot encode the access record: {err}"))?;
    // Temporary file and rename, so a crash never leaves a half-written record.
    let mut temporary = tempfile::Builder::new().prefix(".revoked-access-").tempfile_in(dir)
        .map_err(|err| format!("Cannot write the access record: {err}"))?;
    temporary.write_all(json.as_bytes()).map_err(|err| format!("Cannot write the access record: {err}"))?;
    temporary.as_file().sync_all().map_err(|err| format!("Cannot flush the access record: {err}"))?;
    temporary.persist(record_path(dir)).map_err(|err| format!("Cannot save the access record: {}", err.error))?;
    Ok(())
}

/// Records that access to `root` is revoked. Idempotent.
pub fn revoke(dir: &Path, root: &str) -> Result<(), String> {
    let _guard = RECORD_LOCK.lock().map_err(|_| "The access record is busy.".to_string())?;
    let mut items = load(dir)?;
    let wanted = key(root);
    if !items.iter().any(|item| key(item) == wanted) {
        items.push(root.to_string());
        store(dir, &items)?;
    }
    Ok(())
}

/// Removes a revocation, so the folder can be used again after it is reopened.
pub fn restore(dir: &Path, root: &str) -> Result<(), String> {
    let _guard = RECORD_LOCK.lock().map_err(|_| "The access record is busy.".to_string())?;
    let mut items = load(dir)?;
    let wanted = key(root);
    let before = items.len();
    items.retain(|item| key(item) != wanted);
    if items.len() != before { store(dir, &items)?; }
    Ok(())
}

/// Revoked roots, as recorded.
pub fn list(dir: &Path) -> Result<Vec<String>, String> {
    let _guard = RECORD_LOCK.lock().map_err(|_| "The access record is busy.".to_string())?;
    load(dir)
}

/// Refuses access when `path` lies inside a revoked folder.
pub fn ensure_access(dir: &Path, path: &Path) -> Result<(), String> {
    let wanted = key(&path.to_string_lossy());
    let revoked = load(dir)?;
    if revoked.iter().any(|root| covers(&key(root), &wanted)) {
        return Err(format!("{ACCESS_REVOKED}: access to this folder was revoked in Wrytrove. Reopen the folder to continue."));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_record_allows_access() {
        let dir = tempfile::tempdir().unwrap();
        assert!(ensure_access(dir.path(), &dir.path().join("note.md")).is_ok());
    }

    #[test]
    fn revoked_folder_refuses_its_contents_and_is_restored() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("notes");
        let child = root.join("sub").join("a.md");
        revoke(dir.path(), &root.to_string_lossy()).unwrap();
        assert!(ensure_access(dir.path(), &child).unwrap_err().starts_with(ACCESS_REVOKED));
        restore(dir.path(), &root.to_string_lossy()).unwrap();
        assert!(ensure_access(dir.path(), &child).is_ok());
    }

    #[test]
    fn a_sibling_that_shares_a_name_prefix_is_not_refused() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("foo");
        revoke(dir.path(), &root.to_string_lossy()).unwrap();
        assert!(ensure_access(dir.path(), &dir.path().join("foobar").join("x.md")).is_ok());
    }

    #[test]
    fn revocation_survives_a_restart_because_it_is_read_from_disk() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("kept");
        revoke(dir.path(), &root.to_string_lossy()).unwrap();
        // A new process reads the same record from the app data folder.
        assert_eq!(list(dir.path()).unwrap(), vec![root.to_string_lossy().into_owned()]);
        assert!(ensure_access(dir.path(), &root.join("a.md")).is_err());
    }

    #[test]
    fn revoke_is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("twice").to_string_lossy().into_owned();
        revoke(dir.path(), &root).unwrap();
        revoke(dir.path(), &format!("{root}{}", separator())).unwrap();
        assert_eq!(list(dir.path()).unwrap().len(), 1);
    }

    #[test]
    fn a_damaged_record_fails_closed() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(record_path(dir.path()), b"{ not json").unwrap();
        let err = ensure_access(dir.path(), &dir.path().join("a.md")).unwrap_err();
        assert!(err.starts_with(ACCESS_REVOKED));
        assert!(err.contains(RECORD));
    }
}
