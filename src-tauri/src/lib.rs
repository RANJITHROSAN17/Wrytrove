use percent_encoding::percent_decode_str;
use sha2::{Digest, Sha256};
use std::{fs, io::{Read, Write}, path::{Path, PathBuf}, sync::Mutex};
use tauri::{Emitter, Manager, State};
use tauri_plugin_fs::FsExt;

mod access_revocation;
mod file_identity;
mod journal_key;
mod large_file;
mod save_transaction;

use save_transaction::{PermissionAction, SaveCommit, SaveFailure, SavePhase};

/// Authored once in `limits.json` (shared with `src/encoding.ts`); `max_file_bytes_matches_the_shared_limit`
/// keeps this constant honest.
const MAX_FILE_BYTES: usize = 20 * 1024 * 1024;
const LARGE_FILE_PREFIX: &str = "WRYTROVE_LARGE_FILE: ";
const MAX_DIRECTORY_ENTRIES: usize = 2_000;

#[derive(Default)]
struct LaunchQueue(Mutex<Vec<String>>);

fn collect_launch_files(app: &tauri::AppHandle, args: Vec<String>, cwd: &str) {
    let mut accepted = Vec::new();
    for arg in args.into_iter().skip(1) {
        let path = PathBuf::from(arg);
        let path = if path.is_absolute() { path } else { Path::new(cwd).join(path) };
        if path.is_file() && app.fs_scope().allow_file(&path).is_ok() {
            accepted.push(path.to_string_lossy().to_string());
        }
    }
    if !accepted.is_empty() {
        if let Some(queue) = app.try_state::<LaunchQueue>() {
            if let Ok(mut files) = queue.0.lock() { files.extend(accepted); }
        }
        let _ = app.emit("wrytrove-open-files", ());
    }
}

/// Returns the 32-byte recovery journal key (AUD-03). Locked or missing keys are reported with the
/// KEY_UNAVAILABLE prefix; the webview must then pause recovery rather than replace data.
#[tauri::command]
async fn journal_key_load(app: tauri::AppHandle) -> Result<tauri::ipc::Response, String> {
    let dir = app.path().app_data_dir().map_err(|err| format!("{}: {err}", journal_key::KEY_UNAVAILABLE))?;
    tauri::async_runtime::spawn_blocking(move || journal_key::load_or_create_in(&dir).map(tauri::ipc::Response::new))
        .await.map_err(|err| format!("Key task failed: {err}"))?
}

fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|err| format!("Cannot locate the app data folder: {err}"))
}

/// Refuses native access under a folder whose access was revoked (AUD-03).
fn check_not_revoked(app: &tauri::AppHandle, path: &Path) -> Result<(), String> {
    access_revocation::ensure_access(&data_dir(app)?, path)
}

/// Absolute paths with no `..` components are the only ones accepted at the access-record boundary.
/// Rejects relative input rather than normalizing it, so a stored revocation always names the
/// exact folder the user picked.
fn require_absolute_no_parent(path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path);
    if !path.is_absolute() || path.components().any(|part| matches!(part, std::path::Component::ParentDir)) {
        return Err("Invalid folder path.".into());
    }
    Ok(path)
}

/// Revokes access to a folder. Callers must not revoke a folder that an open document still uses;
/// the Access leases panel defers that case until the document closes.
#[tauri::command]
async fn access_revoke(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let path = require_absolute_no_parent(&path)?;
    let dir = data_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || access_revocation::revoke(&dir, &path.to_string_lossy()))
        .await.map_err(|err| format!("Access task failed: {err}"))?
}

/// Restores access to a folder after the user reopens it.
#[tauri::command]
async fn access_restore(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let path = require_absolute_no_parent(&path)?;
    let dir = data_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || access_revocation::restore(&dir, &path.to_string_lossy()))
        .await.map_err(|err| format!("Access task failed: {err}"))?
}

/// Folders whose access is currently revoked.
#[tauri::command]
async fn access_revoked_list(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let dir = data_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || access_revocation::list(&dir))
        .await.map_err(|err| format!("Access task failed: {err}"))?
}

#[tauri::command]
fn take_launch_files(queue: State<'_, LaunchQueue>) -> Vec<String> {
    match queue.0.lock() { Ok(mut files) => std::mem::take(&mut *files), Err(_) => Vec::new() }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ExpectedVersion<'a> { Absent, Hash(&'a str) }

/// Empty or arbitrary metadata never grants overwrite permission. The explicit
/// "absent" sentinel also survives WebView2 transports that drop empty headers.
fn parse_expected(value: &str) -> Result<ExpectedVersion<'_>, String> {
    if value == "absent" { return Ok(ExpectedVersion::Absent); }
    if value.len() == 64 && value.bytes().all(|ch| ch.is_ascii_digit() || (b'a'..=b'f').contains(&ch)) {
        return Ok(ExpectedVersion::Hash(value));
    }
    Err("Invalid expected file version.".into())
}
fn sha256_hex(data: impl AsRef<[u8]>) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let digest = Sha256::digest(data);
    let raw: &[u8] = digest.as_ref();
    let mut out = String::with_capacity(raw.len() * 2);
    for &b in raw {
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 0x0f) as usize] as char);
    }
    out
}

fn parse_force(value: &str) -> Result<bool, String> {
    match value { "0" => Ok(false), "1" => Ok(true), _ => Err("Invalid overwrite confirmation.".into()) }
}

fn atomic_write_checked(path: &Path, data: &[u8], expected: &str, force: bool, identity: Option<file_identity::FileIdentity>) -> Result<SaveCommit, SaveFailure> {
    atomic_write_with_operations(path, data, expected, force, identity, || {},
        |file| file.sync_all(),
        |temp, destination, no_clobber| {
            if no_clobber {
                temp.persist_noclobber(destination).map(|_| ()).map_err(|err| err.error)
            } else {
                temp.persist(destination).map(|_| ()).map_err(|err| err.error)
            }
        })
}

#[cfg(test)]
fn atomic_write(path: &Path, data: &[u8], expected: &str, force: bool) -> Result<(), String> {
    atomic_write_with_hook(path, data, expected, force, || {})
}

/// Hash and identify the *same opened handle*. The first handle stays open through the identity
/// comparison to reduce identity reuse. It is closed before replacement; the check is not atomic.
fn verify_expected(path: &Path, hash: &str) -> Result<(fs::File, file_identity::FileIdentity), String> {
    let meta = match fs::symlink_metadata(path) {
        Ok(meta) => meta,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Err("WRYTROVE_FILE_CHANGED: file no longer exists".into()),
        Err(err) => return Err(format!("Cannot inspect destination: {err}")),
    };
    if is_link_or_reparse(&meta) { return Err("WRYTROVE_FILE_CHANGED: destination is now a link or reparse point".into()); }
    if !meta.is_file() { return Err("WRYTROVE_FILE_CHANGED: destination is no longer a regular file".into()); }
    let (mut file, opened) = open_regular_file(path)
        .map_err(|_| "WRYTROVE_FILE_CHANGED: cannot verify the file on disk".to_string())?;
    if opened.len() > MAX_FILE_BYTES as u64 { return Err("WRYTROVE_FILE_CHANGED: the file grew beyond the safety limit".into()); }
    let identity = file_identity::identity(&file)?;
    let mut bytes = Vec::new();
    (&mut file).take(MAX_FILE_BYTES as u64 + 1).read_to_end(&mut bytes)
        .map_err(|err| format!("Cannot verify the file on disk: {err}"))?;
    if bytes.len() > MAX_FILE_BYTES || sha256_hex(&bytes) != hash {
        return Err("WRYTROVE_FILE_CHANGED: file differs from the version you opened".into());
    }
    Ok((file, identity))
}

/// Flushes the parent directory so the rename is durable. Best effort: the file is already committed
/// when this runs, so a failure here is not reported as a failed save.
#[cfg(unix)]
fn sync_parent_directory(parent: &Path) {
    if let Ok(dir) = fs::File::open(parent) { let _ = dir.sync_all(); }
}

/// Windows does not allow flushing a directory handle this way, so the rename is not separately
/// flushed there. This limitation is documented in the audit and must not be presented as durable.
#[cfg(not(unix))]
fn sync_parent_directory(_parent: &Path) {}

/// `before_commit` runs after the temporary file is flushed and before the destination is revalidated.
/// Tests use it to change the destination at the point where a race would matter.
#[cfg(test)]
fn atomic_write_with_hook(path: &Path, data: &[u8], expected: &str, force: bool, before_commit: impl FnOnce()) -> Result<(), String> {
    // Older tests exercise races within a save; obtain a baseline as a real read would.
    let identity = open_regular_file(path).ok().and_then(|(file, _)| file_identity::identity(&file).ok());
    atomic_write_with_operations(path, data, expected, force, identity, before_commit,
        |file| file.sync_all(),
        |temp, destination, no_clobber| {
            if no_clobber {
                temp.persist_noclobber(destination).map(|_| ()).map_err(|err| err.error)
            } else {
                temp.persist(destination).map(|_| ()).map_err(|err| err.error)
            }
        }).map(|_| ()).map_err(|failure| failure.message)
}

/// The injectable operations let tests simulate I/O failures at the exact boundaries without
/// exposing fault injection through IPC. A simulated error is not evidence of OS crash durability.
fn atomic_write_with_operations(
    path: &Path, data: &[u8], expected: &str, force: bool,
    opened_identity: Option<file_identity::FileIdentity>, before_commit: impl FnOnce(),
    flush: impl FnOnce(&fs::File) -> std::io::Result<()>,
    persist: impl FnOnce(tempfile::NamedTempFile, &Path, bool) -> std::io::Result<()>,
) -> Result<SaveCommit, SaveFailure> {
    let expected = parse_expected(expected).map_err(|err| SaveFailure::new(SavePhase::Request, err))?;
    if !force && matches!(expected, ExpectedVersion::Hash(_)) && opened_identity.is_none() {
        return Err(SaveFailure::new(SavePhase::Verify, "WRYTROVE_FILE_CHANGED: original file identity is unavailable"));
    }
    if data.len() > MAX_FILE_BYTES { return Err(SaveFailure::new(SavePhase::Request, "This file exceeds the 20 MiB safety limit.")); }
    let metadata = match fs::symlink_metadata(path) {
        Ok(meta) => {
            if is_link_or_reparse(&meta) { return Err(SaveFailure::new(SavePhase::Verify, "Saving through a link or reparse point is not supported. Open the real file instead.")); }
            if !meta.is_file() { return Err(SaveFailure::new(SavePhase::Verify, "The selected destination is not a regular file.")); }
            if meta.permissions().readonly() { return Err(SaveFailure::new(SavePhase::Verify, "The selected file is read-only.")); }
            Some(meta)
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => None,
        Err(err) => return Err(SaveFailure::new(SavePhase::Verify, format!("Cannot inspect destination: {err}"))),
    };
    let verified = if !force {
        match expected {
            ExpectedVersion::Absent if metadata.is_some() => return Err(SaveFailure::new(SavePhase::Verify, "WRYTROVE_FILE_CHANGED: destination already exists")),
            ExpectedVersion::Absent => None,
            ExpectedVersion::Hash(hash) => {
                if metadata.is_none() { return Err(SaveFailure::new(SavePhase::Verify, "WRYTROVE_FILE_CHANGED: file no longer exists")); }
                let verified = verify_expected(path, hash).map_err(|err| SaveFailure::new(SavePhase::Verify, err))?;
                if Some(verified.1) != opened_identity {
                    return Err(SaveFailure::new(SavePhase::Verify, "WRYTROVE_FILE_CHANGED: destination identity differs from the file opened"));
                }
                Some(verified)
            }
        }
    } else { None };
    let parent = path.parent().filter(|p| !p.as_os_str().is_empty())
        .ok_or_else(|| SaveFailure::new(SavePhase::CreateTemp, "No parent directory for the selected file."))?;
    let mut temporary = tempfile::Builder::new().prefix(".wrytrove-").tempfile_in(parent)
        .map_err(|err| SaveFailure::new(SavePhase::CreateTemp, format!("Cannot create a temporary file beside the destination: {err}")))?;
    temporary.write_all(data).map_err(|err| SaveFailure::new(SavePhase::WriteTemp, format!("Cannot write file: {err}")))?;
    flush(temporary.as_file()).map_err(|err| SaveFailure::new(SavePhase::FlushTemp, format!("Cannot flush file to disk: {err}")))?;
    let permissions = if let Some(meta) = metadata {
        temporary.as_file().set_permissions(meta.permissions()).map_err(|err| SaveFailure::new(SavePhase::PreservePermissions, format!("Cannot set temporary file permissions: {err}")))?;
        PermissionAction::CopiedToTemp
    } else { PermissionAction::NotApplied };
    before_commit();
    if let (Some((_, original_identity)), ExpectedVersion::Hash(hash)) = (&verified, expected) {
        let (_, current_identity) = verify_expected(path, hash).map_err(|err| SaveFailure::new(SavePhase::Revalidate, err))?;
        if current_identity != *original_identity {
            return Err(SaveFailure::new(SavePhase::Revalidate, "WRYTROVE_FILE_CHANGED: destination identity changed during save"));
        }
    }
    // Windows replacement can fail while the original handle is open; the final race remains.
    drop(verified);
    let committed_identity = file_identity::identity(temporary.as_file()).ok();
    let no_clobber = !force && expected == ExpectedVersion::Absent;
    persist(temporary, path, no_clobber).map_err(|err| {
        let message = if no_clobber && err.kind() == std::io::ErrorKind::AlreadyExists {
            "WRYTROVE_FILE_CHANGED: destination now exists".to_string()
        } else if no_clobber {
            format!("Cannot create the selected file: {err}")
        } else {
            format!("Cannot replace the original file: {err}")
        };
        SaveFailure::new(SavePhase::Replace, message)
    })?;
    // Parent sync is best effort after commit, not an uncommitted failure or durability guarantee.
    sync_parent_directory(parent);
    Ok(SaveCommit { identity: committed_identity, permissions })
}

/// Read the invoke payload for `safe_write`, whichever IPC transport delivered it.
///
/// `invoke` with a raw payload (`Uint8Array`) only reaches Rust as
/// [`tauri::ipc::InvokeBody::Raw`] while Tauri's IPC custom protocol is usable. When the webview
/// refuses that fetch — a CSP that does not allow the `ipc` host, or a platform that blocks the
/// custom protocol — Tauri silently retries the very same call through `window.ipc.postMessage`,
/// where the payload is serialized as JSON. Both shapes are accepted so a save keeps working on
/// either transport instead of failing with "Expected raw file data." `tests/ipc-body.test.ts`
/// pins the JavaScript half of this conversion.
fn invoke_payload_bytes(body: &tauri::ipc::InvokeBody) -> Result<Vec<u8>, String> {
    match body {
        tauri::ipc::InvokeBody::Raw(bytes) => Ok(bytes.clone()),
        tauri::ipc::InvokeBody::Json(value) => json_payload_bytes(value),
    }
}

/// JSON forms of the same bytes: a number array (what a `Uint8Array` becomes inside a JSON
/// payload), a base64 string, or either of those under a `bytes` field.
fn json_payload_bytes(value: &serde_json::Value) -> Result<Vec<u8>, String> {
    let payload = match value {
        serde_json::Value::Object(fields) => fields.get("bytes").ok_or("Missing file data.")?,
        other => other,
    };
    match payload {
        serde_json::Value::Array(items) => items
            .iter()
            .map(|item| {
                item.as_u64()
                    .and_then(|byte| u8::try_from(byte).ok())
                    .ok_or_else(|| "Invalid file data.".to_string())
            })
            .collect(),
        serde_json::Value::String(text) => base64_decode(text),
        _ => Err("Invalid file data.".into()),
    }
}

/// Minimal standard-alphabet base64 decoder. Tauri ships no base64 dependency, and the decoded
/// payload is still size-checked before it reaches the filesystem.
fn base64_decode(text: &str) -> Result<Vec<u8>, String> {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut lookup = [u8::MAX; 256];
    for (index, symbol) in ALPHABET.iter().enumerate() {
        lookup[usize::from(*symbol)] = index as u8;
    }
    let mut sextets: Vec<u8> = Vec::with_capacity(text.len());
    for symbol in text.bytes() {
        match symbol {
            // Padding only ever terminates the payload.
            b'=' => break,
            b'\r' | b'\n' | b'\t' | b' ' => continue,
            other => {
                let value = lookup[usize::from(other)];
                if value == u8::MAX { return Err("Invalid base64 file data.".into()); }
                sextets.push(value);
            }
        }
    }
    let mut bytes = Vec::with_capacity(sextets.len() / 4 * 3 + 3);
    for group in sextets.chunks(4) {
        // A trailing quantum of one symbol carries no information.
        if group.len() == 1 { return Err("Invalid base64 file data.".into()); }
        let mut buffer = 0u32;
        for (index, sextet) in group.iter().enumerate() {
            buffer |= u32::from(*sextet) << (18 - 6 * index);
        }
        bytes.push((buffer >> 16) as u8);
        if group.len() > 2 { bytes.push((buffer >> 8) as u8); }
        if group.len() > 3 { bytes.push(buffer as u8); }
    }
    Ok(bytes)
}

/// Only files or folders selected, dropped, or launched by the user are in the
/// plugin's dynamic scope. The body is the file bytes on either IPC transport;
/// the path is percent-encoded.
#[tauri::command]
async fn safe_write(app: tauri::AppHandle, request: tauri::ipc::Request<'_>) -> Result<serde_json::Value, serde_json::Value> {
    let prepared = (|| -> Result<_, String> {
        let data = invoke_payload_bytes(request.body())?;
        if data.len() > MAX_FILE_BYTES { return Err("This file exceeds the 20 MiB safety limit.".into()); }
        let header = |key: &str| -> Result<String, String> {
            request.headers().get(key).and_then(|h| h.to_str().ok()).map(str::to_owned).ok_or_else(|| format!("Missing {key} header."))
        };
        let encoded = header("x-wrytrove-path")?;
        let path = PathBuf::from(percent_decode_str(&encoded).decode_utf8().map_err(|_| "Invalid file path encoding.")?.into_owned());
        if !path.is_absolute() || path.components().any(|part| matches!(part, std::path::Component::ParentDir)) {
            return Err("Invalid file path.".into());
        }
        let expected = header("x-wrytrove-expected")?;
        parse_expected(&expected)?;
        let force = parse_force(&header("x-wrytrove-force")?)?;
        let identity_header = header("x-wrytrove-identity")?;
        let identity = if identity_header == "none" { None }
            else { Some(file_identity::FileIdentity::parse(&identity_header).ok_or("Invalid file identity.")?) };
        if !app.fs_scope().is_allowed(&path) { return Err("This file has not been selected for access in Wrytrove.".into()); }
        check_not_revoked(&app, &path)?;
        Ok((data, path, expected, force, identity))
    })().map_err(|err| SaveFailure::new(SavePhase::Request, err).json())?;
    let (data, path, expected, force, identity) = prepared;
    let result = tauri::async_runtime::spawn_blocking(move || atomic_write_checked(&path, &data, &expected, force, identity))
        .await.map_err(|err| SaveFailure::new(SavePhase::Unknown, format!("Save task did not complete: {err}")).json())?;
    result.map(|result| save_transaction::committed(result.identity.map(|value| value.token()), result.permissions))
        .map_err(|failure| failure.json())
}

/// Windows junctions and other reparse points are deliberately not treated as
/// ordinary files or folders. This does not close races in parent directories.
fn is_link_or_reparse(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        metadata.file_type().is_symlink() || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
    }
    #[cfg(not(windows))]
    { metadata.file_type().is_symlink() }
}

/// Read at most one extra entry to detect truncation; do not materialize an
/// arbitrarily large native directory listing in Rust or the webview.
fn bounded_directory(path: &Path) -> Result<serde_json::Value, String> {
    let metadata = fs::symlink_metadata(path).map_err(|err| format!("Cannot inspect folder: {err}"))?;
    if is_link_or_reparse(&metadata) || !metadata.is_dir() { return Err("This is not a regular folder, or it is a link/reparse point.".into()); }
    let mut source = fs::read_dir(path).map_err(|err| format!("Cannot read folder: {err}"))?;
    let mut entries = Vec::new();
    let mut skipped = 0usize;
    for _ in 0..MAX_DIRECTORY_ENTRIES {
        let entry = match source.next() {
            Some(Ok(entry)) => entry,
            Some(Err(_)) => { skipped += 1; continue; }
            None => return Ok(serde_json::json!({ "entries": entries, "skippedLinks": skipped, "truncated": false })),
        };
        // Do not use a lossy filename: it could accidentally refer to another path.
        let name = match entry.file_name().into_string() { Ok(name) => name, Err(_) => { skipped += 1; continue; } };
        let metadata = match fs::symlink_metadata(entry.path()) { Ok(value) => value, Err(_) => { skipped += 1; continue; } };
        if is_link_or_reparse(&metadata) || (!metadata.is_file() && !metadata.is_dir()) { skipped += 1; continue; }
        entries.push(serde_json::json!({ "name": name, "isFile": metadata.is_file(), "isDirectory": metadata.is_dir() }));
    }
    Ok(serde_json::json!({ "entries": entries, "skippedLinks": skipped, "truncated": source.next().is_some() }))
}

/// Bound native reads even if the file grows after the metadata check. The final
/// component is opened without following links; parent-directory races remain.
fn bounded_read_with_identity(path: &Path, max_bytes: usize) -> Result<(Vec<u8>, Option<file_identity::FileIdentity>), String> {
    if max_bytes == 0 || max_bytes > MAX_FILE_BYTES { return Err("Invalid file size limit.".into()); }
    let (mut file, metadata) = open_regular_file(path)?;
    if metadata.len() > max_bytes as u64 {
        return Err(format!("{LARGE_FILE_PREFIX}File exceeds the {max_bytes}-byte limit for this operation."));
    }
    // An unavailable identity does not prevent reading. It cannot authorize a normal overwrite.
    let identity = file_identity::identity(&file).ok();
    let mut bytes = Vec::new();
    (&mut file).take(max_bytes as u64 + 1).read_to_end(&mut bytes).map_err(|err| format!("Cannot read file: {err}"))?;
    if bytes.len() > max_bytes {
        return Err(format!("{LARGE_FILE_PREFIX}File grew beyond the size limit while reading."));
    }
    Ok((bytes, identity))
}

#[cfg(test)]
fn bounded_read(path: &Path, max_bytes: usize) -> Result<Vec<u8>, String> {
    bounded_read_with_identity(path, max_bytes).map(|(bytes, _)| bytes)
}

/// Open the final path component without following links or blocking on a Unix FIFO.
fn open_regular_file(path: &Path) -> Result<(fs::File, fs::Metadata), String> {
    let metadata = fs::symlink_metadata(path).map_err(|err| format!("Cannot inspect file: {err}"))?;
    if is_link_or_reparse(&metadata) || !metadata.is_file() { return Err("Symbolic links, reparse points and non-regular files are skipped.".into()); }
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    let file = options.open(path).map_err(|err| format!("Cannot open file: {err}"))?;
    let opened = file.metadata().map_err(|err| format!("Cannot inspect open file: {err}"))?;
    if is_link_or_reparse(&opened) || !opened.is_file() { return Err("The opened item is not a regular file.".into()); }
    Ok((file, opened))
}

fn check_read_path(app: &tauri::AppHandle, path: &Path) -> Result<(), String> {
    if !path.is_absolute() || path.components().any(|part| matches!(part, std::path::Component::ParentDir)) {
        return Err("Invalid file path.".into());
    }
    if !app.fs_scope().is_allowed(path) { return Err("This file has not been selected for access in Wrytrove.".into()); }
    check_not_revoked(app, path)
}

#[tauri::command]
async fn large_file_inspect(app: tauri::AppHandle, path: String) -> Result<serde_json::Value, String> {
    let path = PathBuf::from(path);
    check_read_path(&app, &path)?;
    tauri::async_runtime::spawn_blocking(move || large_file::inspect(&path)).await.map_err(|err| format!("File task failed: {err}"))?
}

#[tauri::command]
async fn large_file_range(app: tauri::AppHandle, path: String, version: String, offset: u64, length: usize) -> Result<tauri::ipc::Response, String> {
    let path = PathBuf::from(path);
    check_read_path(&app, &path)?;
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = large_file::range(&path, &version, offset, length)?;
        check_read_path(&app, &path)?;
        Ok(tauri::ipc::Response::new(bytes))
    }).await.map_err(|err| format!("File task failed: {err}"))?
}

#[tauri::command]
async fn workspace_list_directory(app: tauri::AppHandle, path: String) -> Result<serde_json::Value, String> {
    let path = PathBuf::from(path);
    if !app.fs_scope().is_allowed(&path) { return Err("This folder has not been selected for access in Wrytrove.".into()); }
    check_not_revoked(&app, &path)?;
    tauri::async_runtime::spawn_blocking(move || bounded_directory(&path)).await.map_err(|err| format!("Folder task failed: {err}"))?
}

#[tauri::command]
async fn workspace_read_file(app: tauri::AppHandle, path: String, max_bytes: usize, offer_large_view: Option<bool>) -> Result<tauri::ipc::Response, String> {
    let path = PathBuf::from(path);
    check_read_path(&app, &path)?;
    let result = tauri::async_runtime::spawn_blocking(move || bounded_read_with_identity(&path, max_bytes)).await.map_err(|err| format!("File task failed: {err}"))?;
    let (bytes, identity) = result.map_err(|error| {
        if offer_large_view.unwrap_or(false) { error }
        else { error.strip_prefix(LARGE_FILE_PREFIX).unwrap_or(&error).to_string() }
    })?;
    // Fixed 32-byte ASCII identity prefix; dashes mean the identity is unavailable.
    // The size limit applies to file bytes, not this protocol envelope.
    let mut response = identity.map(|id| id.token()).unwrap_or_else(|| "-".repeat(32)).into_bytes();
    response.extend_from_slice(&bytes);
    Ok(tauri::ipc::Response::new(response))
}

/// Cheap change probe for an already-authorized path: one stat plus an identity lookup, with no
/// file contents crossing IPC. The version is a hint, not proof — a same-length rewrite inside one
/// filesystem timestamp tick produces the same value — so it only ever short-circuits to
/// "unchanged"; any mismatch sends the webview back to reading and hashing the bytes, which stays
/// authoritative. The probe reuses `large_file`'s fingerprint so both features agree on identity.
fn file_version(path: &Path) -> Result<serde_json::Value, String> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Ok(serde_json::json!({ "exists": false, "version": null }));
        }
        Err(err) => return Err(format!("Cannot inspect file: {err}")),
    };
    // A link, reparse point or non-regular file is reported as absent rather than probed.
    if is_link_or_reparse(&metadata) || !metadata.is_file() {
        return Ok(serde_json::json!({ "exists": false, "version": null }));
    }
    let (_, opened) = open_regular_file(path)?;
    Ok(serde_json::json!({ "exists": true, "version": large_file::fingerprint(&opened)? }))
}

/// Version-only probe so a window-focus check costs one stat instead of a full read and hash.
#[tauri::command]
async fn workspace_file_version(app: tauri::AppHandle, path: String) -> Result<serde_json::Value, String> {
    let path = PathBuf::from(path);
    check_read_path(&app, &path)?;
    tauri::async_runtime::spawn_blocking(move || file_version(&path))
        .await
        .map_err(|err| format!("File task failed: {err}"))?
}

/// A conservative, cross-platform single component; rejects Windows device names
/// and alternate data streams even when running tests on another operating system.
fn valid_new_entry_name(name: &str) -> bool {
    if name.is_empty() || name == "." || name == ".." || name.encode_utf16().count() > 180
        || name.ends_with(' ') || name.ends_with('.')
        || name.chars().any(|ch| ch <= '\u{1f}' || "<>:\"/\\|?*".contains(ch)) { return false; }
    let stem = name.split(['.', ' ']).next().unwrap_or("").to_uppercase();
    let device = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL" | "CLOCK$" | "CONIN$" | "CONOUT$")
        || (stem.len() == 4 && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && matches!(stem.as_bytes()[3], b'1'..=b'9'))
        || ["COM¹", "COM²", "COM³", "LPT¹", "LPT²", "LPT³"].contains(&stem.as_str());
    !device
}

/// Recheck each existing component and its canonical containment. This avoids
/// intentionally following links/junctions but cannot eliminate parent-directory
/// races with another local process between the checks and the create syscall.
fn checked_workspace_parent(root: &Path, relative: &str) -> Result<PathBuf, String> {
    if !root.is_absolute() || root.components().any(|part| matches!(part, std::path::Component::ParentDir)) {
        return Err("Invalid workspace root.".into());
    }
    let meta = fs::symlink_metadata(root).map_err(|err| format!("Cannot inspect workspace root: {err}"))?;
    if is_link_or_reparse(&meta) || !meta.is_dir() { return Err("Choose a regular folder, not a link or reparse point.".into()); }
    let canonical_root = fs::canonicalize(root).map_err(|err| format!("Cannot resolve workspace root: {err}"))?;
    let mut parent = root.to_path_buf();
    if !relative.is_empty() {
        for component in relative.split('/') {
            if component.is_empty() || component == "." || component == ".." || component.contains(['\\', '\0']) {
                return Err("Invalid folder path.".into());
            }
            parent.push(component);
            let meta = fs::symlink_metadata(&parent).map_err(|err| format!("Cannot inspect target folder: {err}"))?;
            if is_link_or_reparse(&meta) || !meta.is_dir() { return Err("Links and reparse points are not supported in workspace paths.".into()); }
            let resolved = fs::canonicalize(&parent).map_err(|err| format!("Cannot resolve target folder: {err}"))?;
            if !resolved.starts_with(&canonical_root) { return Err("The target folder is outside the selected workspace.".into()); }
        }
    }
    Ok(parent)
}

fn create_workspace_child(root: &Path, relative: &str, name: &str, kind: &str) -> Result<(), String> {
    if !valid_new_entry_name(name) { return Err("Invalid file or folder name.".into()); }
    if kind != "file" && kind != "directory" { return Err("Invalid entry type.".into()); }
    let parent = checked_workspace_parent(root, relative)?;
    let target = parent.join(name);
    let result = if kind == "directory" {
        fs::create_dir(target)
    } else {
        fs::OpenOptions::new().write(true).create_new(true).open(target).map(|_| ())
    };
    result.map_err(|err| if err.kind() == std::io::ErrorKind::AlreadyExists {
        "An item with that name already exists. Nothing was overwritten.".to_string()
    } else { format!("Cannot create this item: {err}") })
}

#[tauri::command]
async fn workspace_create_entry(app: tauri::AppHandle, root: String, parent_relative: String, name: String, kind: String) -> Result<(), String> {
    let root = PathBuf::from(root);
    if !app.fs_scope().is_allowed(&root) { return Err("This folder has not been selected for access in Wrytrove.".into()); }
    check_not_revoked(&app, &root)?;
    let revocation_dir = data_dir(&app)?;
    // Scope check is on both the selected root and its verified descendant.
    tauri::async_runtime::spawn_blocking(move || {
        let parent = checked_workspace_parent(&root, &parent_relative)?;
        if !app.fs_scope().is_allowed(&parent) { return Err("This target folder is outside the selected file-access scope.".into()); }
        access_revocation::ensure_access(&revocation_dir, &parent)?;
        create_workspace_child(&root, &parent_relative, &name, &kind)
    }).await.map_err(|err| format!("Create task failed: {err}"))?
}

/// Fit an oversized/off-screen initial window to the selected monitor work area.
/// Sizes are physical pixels. This is best effort when the work area is smaller
/// than the configured minimum window size or changes after startup.
fn fit_initial_geometry(
    outer: (u32, u32), inner: (u32, u32), position: (i32, i32), area: (i32, i32, u32, u32),
) -> Option<((u32, u32), (i32, i32))> {
    if area.2 == 0 || area.3 == 0 { return None; }
    let right = i64::from(position.0) + i64::from(outer.0);
    let bottom = i64::from(position.1) + i64::from(outer.1);
    if position.0 >= area.0 && position.1 >= area.1
        && right <= i64::from(area.0) + i64::from(area.2)
        && bottom <= i64::from(area.1) + i64::from(area.3) { return None; }
    let target_outer = (outer.0.min(area.2.saturating_sub(16).max(1)), outer.1.min(area.3.saturating_sub(16).max(1)));
    let target_inner = (inner.0.saturating_sub(outer.0.saturating_sub(target_outer.0)).max(1), inner.1.saturating_sub(outer.1.saturating_sub(target_outer.1)).max(1));
    let x = i64::from(area.0) + i64::from(area.2.saturating_sub(target_outer.0) / 2);
    let y = i64::from(area.1) + i64::from(area.3.saturating_sub(target_outer.1) / 2);
    Some((target_inner, (x.clamp(i32::MIN as i64, i32::MAX as i64) as i32, y.clamp(i32::MIN as i64, i32::MAX as i64) as i32)))
}

fn fit_initial_window(window: &tauri::WebviewWindow) {
    let monitor = window.current_monitor().ok().flatten().or_else(|| window.primary_monitor().ok().flatten());
    if let (Some(monitor), Ok(outer), Ok(inner), Ok(position)) = (monitor, window.outer_size(), window.inner_size(), window.outer_position()) {
        let work = monitor.work_area();
        if let Some((size, pos)) = fit_initial_geometry((outer.width, outer.height), (inner.width, inner.height), (position.x, position.y), (work.position.x, work.position.y, work.size.width, work.size.height)) {
            let _ = window.set_size(tauri::PhysicalSize::new(size.0, size.1));
            let _ = window.set_position(tauri::PhysicalPosition::new(pos.0, pos.1));
        }
    }
}

/// Keep the privileged editor webview on bundled app origins. The explicit dev
/// origin is enabled only in debug builds; external websites open in a browser.
fn trusted_editor_navigation(url: &tauri::Url) -> bool {
    if !url.username().is_empty() || url.password().is_some() { return false; }
    match (url.scheme(), url.host_str()) {
        ("tauri", Some("localhost")) => true,
        ("http" | "https", Some("tauri.localhost")) => url.port().is_none(),
        ("http", Some("localhost")) if cfg!(debug_assertions) => url.port() == Some(1420),
        _ => false,
    }
}

fn editor_navigation_guard<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("editor-navigation-guard")
        .on_navigation(|webview, url| webview.label() != "main" || trusted_editor_navigation(url))
        .build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(LaunchQueue::default())
        .plugin(editor_navigation_guard())
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            collect_launch_files(app, args, &cwd);
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") { fit_initial_window(&window); }
            let cwd = std::env::current_dir().unwrap_or_default().to_string_lossy().to_string();
            collect_launch_files(app.handle(), std::env::args().collect(), &cwd);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![safe_write, take_launch_files, workspace_list_directory, workspace_read_file, workspace_file_version, large_file_inspect, large_file_range, workspace_create_entry, journal_key_load, access_revoke, access_restore, access_revoked_list])
        .run(tauri::generate_context!())
        .expect("error while running Wrytrove");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn editor_navigation_rejects_remote_and_deceptive_origins() {
        for allowed in ["tauri://localhost/index.html", "http://tauri.localhost/index.html", "https://tauri.localhost/index.html"] {
            assert!(trusted_editor_navigation(&allowed.parse().unwrap()), "blocked bundled origin {allowed}");
        }
        for denied in ["https://arena.ai/agent", "https://tauri.localhost.evil.invalid/", "http://tauri.localhost:8080/", "javascript:alert(1)", "file:///tmp/file", "http://localhost:9999/"] {
            assert!(!trusted_editor_navigation(&denied.parse().unwrap()), "allowed foreign origin {denied}");
        }
        assert_eq!(trusted_editor_navigation(&"http://localhost:1420/".parse().unwrap()), cfg!(debug_assertions));
    }
    // Tauri mock runtime currently fails to start on the hosted Windows runner
    // with STATUS_ENTRYPOINT_NOT_FOUND; exercise this boundary on Linux and
    // validate real permitted commands separately in the Windows GUI smoke test.
    #[cfg(not(windows))]
    #[test]
    fn ipc_manifest_allows_only_the_local_main_webview() {
        use tauri::test::{get_ipc_response, mock_builder, INVOKE_KEY};
        use tauri::webview::InvokeRequest;
        let app = mock_builder()
            .manage(LaunchQueue::default())
            .invoke_handler(tauri::generate_handler![take_launch_files])
            .build(tauri::generate_context!())
            .expect("mock app should load the real generated capability manifest");
        let main = app.get_webview_window("main").unwrap_or_else(||
            tauri::WebviewWindowBuilder::new(&app, "main", Default::default()).build().unwrap());
        let other = tauri::WebviewWindowBuilder::new(&app, "untrusted-local", Default::default()).build().unwrap();
        let origin = if cfg!(windows) { "http://tauri.localhost" } else { "tauri://localhost" };
        let request = |url: &str| InvokeRequest {
            cmd: "take_launch_files".into(),
            callback: tauri::ipc::CallbackFn(0),
            error: tauri::ipc::CallbackFn(1),
            url: url.parse().unwrap(),
            body: tauri::ipc::InvokeBody::default(),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        };
        assert!(get_ipc_response(&main, request(origin)).is_ok(), "main local editor must retain its permitted command");
        assert!(get_ipc_response(&main, request("https://arena.ai/agent")).is_err(), "remote Arena origin must not reach native IPC");
        assert!(get_ipc_response(&other, request(origin)).is_err(), "another local webview must not inherit main's command permission");
    }
    #[test]
    fn initial_geometry_uses_monitor_work_area_and_decorations() {
        // The saved Windows VM case: outer window 1044x788, work area 1024x720.
        let (inner, position) = fit_initial_geometry((1044, 788), (1024, 720), (0, 0), (0, 0, 1024, 720)).unwrap();
        assert_eq!(inner, (988, 636));
        assert_eq!(position, (8, 8));
        assert!(fit_initial_geometry((900, 650), (880, 600), (20, 20), (0, 0, 1024, 720)).is_none());
        let (_, negative_monitor) = fit_initial_geometry((1200, 900), (1180, 850), (0, 0), (-1920, -100, 1600, 900)).unwrap();
        assert!(negative_monitor.0 >= -1920 && negative_monitor.0 < 0);
        assert!(negative_monitor.1 >= -100);
    }
    #[test]
    fn safe_write_reads_the_payload_on_either_ipc_transport() {
        // `Raw` is the IPC custom-protocol shape; every JSON shape below is what the same invoke
        // becomes once Tauri falls back to `window.ipc.postMessage`.
        assert_eq!(invoke_payload_bytes(&tauri::ipc::InvokeBody::Raw(b"draft".to_vec())).unwrap(), b"draft");
        let from_json = |value: serde_json::Value| -> Vec<u8> {
            invoke_payload_bytes(&tauri::ipc::InvokeBody::from(value)).unwrap()
        };
        assert_eq!(from_json(serde_json::json!([100, 114, 97, 102, 116])), b"draft");
        assert_eq!(from_json(serde_json::json!({ "bytes": [100, 114, 97, 102, 116] })), b"draft");
        assert_eq!(from_json(serde_json::json!("ZHJhZnQ=")), b"draft");
        assert_eq!(from_json(serde_json::json!({ "bytes": "ZHJhZnQ=" })), b"draft");
        assert_eq!(from_json(serde_json::json!([])), Vec::<u8>::new());
        // Anything that is not bytes must be refused rather than written as an empty file.
        for rejected in [serde_json::json!({}), serde_json::json!({ "bytes": 7 }), serde_json::json!([300]),
            serde_json::json!("not base64!"), serde_json::json!("A"), serde_json::json!(null)] {
            let body = tauri::ipc::InvokeBody::from(rejected);
            assert!(invoke_payload_bytes(&body).is_err(), "accepted {body:?}");
        }
        assert_eq!(base64_decode("TQ==").unwrap(), b"M");
        assert_eq!(base64_decode("TWE=").unwrap(), b"Ma");
        assert_eq!(base64_decode("TWFu").unwrap(), b"Man");
        assert_eq!(base64_decode("").unwrap(), Vec::<u8>::new());
    }
    #[test]
    fn safe_write_detects_external_changes_and_preserves_original() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("file.txt");
        fs::write(&path, b"original").unwrap();
        assert_eq!(sha256_hex(b""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
        let old_hash = sha256_hex(b"original");
        fs::write(&path, b"changed by another app").unwrap();
        assert!(atomic_write(&path, b"new", &old_hash, false).unwrap_err().contains("WRYTROVE_FILE_CHANGED"));
        assert_eq!(fs::read(&path).unwrap(), b"changed by another app");
        atomic_write(&path, b"new", &old_hash, true).unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"new");
    }
    #[test]
    fn max_file_bytes_matches_the_shared_limit() {
        let shared: serde_json::Value =
            serde_json::from_str(include_str!("../../limits.json")).expect("limits.json must be valid JSON");
        let authored = shared["maxFileBytes"].as_u64().expect("limits.json must define maxFileBytes");
        assert_eq!(authored as usize, MAX_FILE_BYTES);
    }
    #[test]
    fn access_path_validation_rejects_relative_and_parent_components() {
        assert!(require_absolute_no_parent("notes/relative.md").is_err());
        assert!(require_absolute_no_parent("").is_err());
        let with_parent = if cfg!(windows) { "C:\\notes\\..\\secret" } else { "/notes/../secret" };
        assert!(require_absolute_no_parent(with_parent).is_err());
        let absolute = if cfg!(windows) { "C:\\notes\\folder" } else { "/notes/folder" };
        assert!(require_absolute_no_parent(absolute).is_ok());
    }
    #[test]
    fn save_aborts_when_destination_changes_before_commit() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("file.txt");
        fs::write(&path, b"original").unwrap();
        let old_hash = sha256_hex(b"original");
        let target = path.clone();
        let result = atomic_write_with_hook(&path, b"new", &old_hash, false, move || {
            fs::write(&target, b"changed during save").unwrap();
        });
        assert!(result.unwrap_err().contains("WRYTROVE_FILE_CHANGED"));
        assert_eq!(fs::read(&path).unwrap(), b"changed during save");
        let leftovers: Vec<_> = fs::read_dir(dir.path()).unwrap().filter_map(Result::ok)
            .filter(|e| e.file_name().to_string_lossy().starts_with(".wrytrove-")).collect();
        assert!(leftovers.is_empty(), "temporary file was left behind");
    }
    #[test]
    fn same_content_replacement_before_save_requires_conflict() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("file.txt");
        fs::write(&path, b"original").unwrap();
        let (bytes, identity) = bounded_read_with_identity(&path, MAX_FILE_BYTES).unwrap();
        let hash = sha256_hex(&bytes);
        let moved = dir.path().join("moved.txt");
        fs::rename(&path, &moved).unwrap();
        fs::write(&path, &bytes).unwrap();
        let result = atomic_write_checked(&path, b"edited", &hash, false, identity);
        let failure = result.unwrap_err();
        assert_eq!(failure.phase, SavePhase::Verify);
        assert!(failure.conflict);
        assert!(failure.message.contains("destination identity differs from the file opened"));
        assert_eq!(fs::read(&path).unwrap(), b"original");
        assert_eq!(fs::read(&moved).unwrap(), b"original");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 2);
    }
    #[test]
    fn successful_saves_return_the_new_identity_for_the_next_save() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("file.txt");
        fs::write(&path, b"one").unwrap();
        let (_, identity) = bounded_read_with_identity(&path, MAX_FILE_BYTES).unwrap();
        let next = atomic_write_checked(&path, b"two", &sha256_hex(b"one"), false, identity).unwrap();
        assert!(next.identity.is_some());
        assert_ne!(next.identity, identity);
        assert_eq!(next.identity, bounded_read_with_identity(&path, MAX_FILE_BYTES).unwrap().1);
        assert_eq!(next.permissions, PermissionAction::CopiedToTemp);
        atomic_write_checked(&path, b"three", &sha256_hex(b"two"), false, next.identity).unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"three");
    }
    #[test]
    fn file_version_probe_is_cheap_stable_and_reports_absence() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("file.txt");
        fs::write(&path, b"one").unwrap();
        let first = file_version(&path).unwrap();
        assert_eq!(first["exists"], serde_json::json!(true));
        // The same unchanged file must report the same version, or every focus would look like a change.
        assert_eq!(file_version(&path).unwrap(), first);
        // A length change always changes the version, independent of timestamp granularity.
        fs::write(&path, b"three").unwrap();
        assert_ne!(file_version(&path).unwrap(), first);
        // A missing file is reported, not treated as an error the caller has to guess at.
        fs::remove_file(&path).unwrap();
        assert_eq!(file_version(&path).unwrap(), serde_json::json!({ "exists": false, "version": null }));
        // Links are never probed, matching the read path.
        #[cfg(unix)]
        {
            let link = dir.path().join("link");
            std::os::unix::fs::symlink("/dev/null", &link).unwrap();
            assert_eq!(file_version(&link).unwrap()["exists"], serde_json::json!(false));
        }
    }
    #[test]
    fn missing_identity_never_authorizes_a_normal_overwrite() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("file.txt");
        fs::write(&path, b"original").unwrap();
        let failure = atomic_write_checked(&path, b"new", &sha256_hex(b"original"), false, None).unwrap_err();
        assert_eq!(failure.phase, SavePhase::Verify);
        assert!(failure.conflict);
        assert!(failure.message.contains("identity is unavailable"));
        assert_eq!(fs::read(&path).unwrap(), b"original");
    }
    #[test]
    fn save_aborts_when_destination_is_replaced_with_identical_content() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("file.txt");
        let moved = dir.path().join("original-moved.txt");
        fs::write(&path, b"original").unwrap();
        let old_hash = sha256_hex(b"original");
        let target = path.clone();
        let original = moved.clone();
        let result = atomic_write_with_hook(&path, b"new", &old_hash, false, move || {
            fs::rename(&target, &original).unwrap();
            fs::write(&target, b"original").unwrap();
        });
        assert!(result.unwrap_err().contains("destination identity changed during save"));
        assert_eq!(fs::read(&path).unwrap(), b"original");
        assert_eq!(fs::read(&moved).unwrap(), b"original");
        assert!(fs::read_dir(dir.path()).unwrap().all(|entry| !entry.unwrap().file_name().to_string_lossy().starts_with(".wrytrove-")));
    }
    #[test]
    fn save_aborts_when_destination_is_deleted_before_commit() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("file.txt");
        fs::write(&path, b"original").unwrap();
        let old_hash = sha256_hex(b"original");
        let target = path.clone();
        let result = atomic_write_with_hook(&path, b"new", &old_hash, false, move || {
            fs::remove_file(&target).unwrap();
        });
        assert!(result.unwrap_err().contains("file no longer exists"));
        assert!(!path.exists(), "a deleted destination must not be recreated silently");
    }
    #[test]
    fn save_succeeds_when_destination_is_unchanged_before_commit() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("file.txt");
        fs::write(&path, b"original").unwrap();
        let old_hash = sha256_hex(b"original");
        atomic_write_with_hook(&path, b"new", &old_hash, false, || {}).unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"new");
    }
    #[test]
    fn workspace_file_read_is_bounded_and_rejects_directories() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("data.txt");
        fs::write(&path, b"123456").unwrap();
        assert_eq!(bounded_read(&path, 6).unwrap(), b"123456");
        assert!(bounded_read(&path, 5).is_err());
        assert!(bounded_read(dir.path(), 10).is_err());
        assert!(bounded_read(&path, MAX_FILE_BYTES + 1).is_err());
    }
    #[test]
    fn workspace_listing_is_bounded_before_serialization() {
        let dir = tempfile::tempdir().unwrap();
        for n in 0..(MAX_DIRECTORY_ENTRIES + 1) {
            fs::write(dir.path().join(format!("{n}.txt")), b"").unwrap();
        }
        let listing = bounded_directory(dir.path()).unwrap();
        assert_eq!(listing["entries"].as_array().unwrap().len(), MAX_DIRECTORY_ENTRIES);
        assert_eq!(listing["truncated"], true);
    }
    #[cfg(unix)]
    #[test]
    fn workspace_skips_links_in_listings_and_reads() {
        use std::os::unix::fs::symlink;
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("real.txt"), b"real").unwrap();
        symlink(dir.path().join("real.txt"), dir.path().join("link.txt")).unwrap();
        let listing = bounded_directory(dir.path()).unwrap();
        assert_eq!(listing["entries"].as_array().unwrap().len(), 1);
        assert_eq!(listing["skippedLinks"], 1);
        assert!(bounded_read(&dir.path().join("link.txt"), 20).is_err());
    }
    #[test]
    fn workspace_create_is_single_component_and_never_overwrites() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("src")).unwrap();
        for name in ["", ".", "..", "../escape", "a/b", "a\\b", "C:stream", "bad?name", "file.", "file ", "CON.txt", "aux", "COM9.md", "LPT¹"] {
            assert!(!valid_new_entry_name(name), "accepted unsafe name: {name:?}");
            assert!(create_workspace_child(dir.path(), "src", name, "file").is_err());
        }
        assert!(valid_new_entry_name("report 📝.md"));
        create_workspace_child(dir.path(), "src", "report 📝.md", "file").unwrap();
        let created = dir.path().join("src").join("report 📝.md");
        fs::write(&created, b"must survive").unwrap();
        assert!(create_workspace_child(dir.path(), "src", "report 📝.md", "file").is_err());
        assert!(create_workspace_child(dir.path(), "src", "report 📝.md", "directory").is_err());
        assert_eq!(fs::read(&created).unwrap(), b"must survive");
        create_workspace_child(dir.path(), "src", "notes", "directory").unwrap();
        assert!(dir.path().join("src").join("notes").is_dir());
        for parent in ["../other", "/absolute", "src/../other", "src\\..", "src//child"] {
            assert!(create_workspace_child(dir.path(), parent, "escape.txt", "file").is_err());
        }
        assert!(create_workspace_child(dir.path(), "src", "no.txt", "arbitrary").is_err());
    }
    #[cfg(unix)]
    #[test]
    fn workspace_create_refuses_symlink_parents_and_targets() {
        use std::os::unix::fs::symlink;
        let dir = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("valuable.txt"), b"valuable").unwrap();
        symlink(outside.path(), dir.path().join("escape")).unwrap();
        symlink(outside.path().join("valuable.txt"), dir.path().join("existing.txt")).unwrap();
        assert!(create_workspace_child(dir.path(), "escape", "not-allowed.txt", "file").is_err());
        assert!(create_workspace_child(dir.path(), "", "existing.txt", "file").is_err());
        assert!(!outside.path().join("not-allowed.txt").exists());
        assert_eq!(fs::read(outside.path().join("valuable.txt")).unwrap(), b"valuable");
    }
    #[test]
    fn safe_write_creates_file_in_selected_directory() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("hello.txt");
        let result = atomic_write_checked(&path, b"hello", "absent", false, None).unwrap();
        assert_eq!(result.permissions, PermissionAction::NotApplied);
        assert_eq!(fs::read(&path).unwrap(), b"hello");
    }
    #[test]
    fn save_metadata_must_be_explicit_and_valid() {
        assert_eq!(parse_expected("absent").unwrap(), ExpectedVersion::Absent);
        assert!(matches!(parse_expected(&"a".repeat(64)).unwrap(), ExpectedVersion::Hash(_)));
        for invalid in ["", "none", "0", "absent ", "zzzz", &"A".repeat(64), &"g".repeat(64)] {
            assert!(parse_expected(invalid).is_err(), "accepted invalid expected value: {invalid:?}");
        }
        assert_eq!(parse_force("0").unwrap(), false);
        assert_eq!(parse_force("1").unwrap(), true);
        for invalid in ["", "true", "2", "01"] { assert!(parse_force(invalid).is_err()); }
        for invalid in ["", "none", "a", "g0000000000000000000000000000000", "A0000000000000000000000000000000"] {
            assert!(file_identity::FileIdentity::parse(invalid).is_none());
        }
        let valid = "0123456789abcdef0123456789abcdef";
        assert_eq!(file_identity::FileIdentity::parse(valid).unwrap().token(), valid);
    }
    #[test]
    fn new_destination_created_during_save_is_not_clobbered() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("new.txt");
        let competing_path = path.clone();
        let result = atomic_write_with_hook(&path, b"our data", "absent", false, move || {
            fs::write(competing_path, b"competing data").unwrap();
        });
        assert!(result.unwrap_err().contains("WRYTROVE_FILE_CHANGED"));
        assert_eq!(fs::read(&path).unwrap(), b"competing data");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1, "temporary file must be cleaned up");
    }

    #[test]
    fn transaction_reports_request_and_create_temp_phases() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("missing").join("new.txt");
        let invalid = atomic_write_checked(&path, b"x", "", false, None).unwrap_err();
        assert_eq!(invalid.phase, SavePhase::Request);
        let failure = atomic_write_checked(&path, b"x", "absent", false, None).unwrap_err();
        assert_eq!(failure.phase, SavePhase::CreateTemp);
        assert!(!failure.conflict);
        assert!(!path.exists());
    }

    #[test]
    fn transaction_reports_revalidation_conflict() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("file.txt");
        fs::write(&path, b"original").unwrap();
        let identity = file_identity::identity(&fs::File::open(&path).unwrap()).unwrap();
        let target = path.clone();
        let result = atomic_write_with_operations(&path, b"new", &sha256_hex(b"original"), false, Some(identity),
            move || fs::write(target, b"external").unwrap(),
            |file| file.sync_all(),
            |_, _, _| panic!("a conflict must not reach replacement"));
        let failure = result.unwrap_err();
        assert_eq!(failure.phase, SavePhase::Revalidate);
        assert!(failure.conflict);
        assert_eq!(fs::read(path).unwrap(), b"external");
    }

    #[test]
    fn simulated_flush_failure_keeps_destination_and_skips_commit() {
        use std::cell::Cell;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("existing.txt");
        fs::write(&path, b"original").unwrap();
        let expected = sha256_hex(b"original");
        let hook_called = Cell::new(false);
        let commit_attempted = Cell::new(false);
        let identity = file_identity::identity(&fs::File::open(&path).unwrap()).unwrap();
        let result = atomic_write_with_operations(&path, b"updated", &expected, false, Some(identity),
            || hook_called.set(true),
            |_| Err(std::io::Error::new(std::io::ErrorKind::Other, "injected flush failure")),
            |_, _, _| { commit_attempted.set(true); Ok(()) });
        let failure = result.unwrap_err();
        assert_eq!(failure.phase, SavePhase::FlushTemp);
        assert!(!failure.conflict);
        assert!(failure.message.contains("Cannot flush file to disk: injected flush failure"));
        assert!(!hook_called.get());
        assert!(!commit_attempted.get());
        assert_eq!(fs::read(&path).unwrap(), b"original");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1, "temporary file must be cleaned up");
    }

    #[test]
    fn simulated_replace_failure_keeps_destination_and_cleans_temporary_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("existing.txt");
        fs::write(&path, b"original").unwrap();
        let expected = sha256_hex(b"original");
        let identity = file_identity::identity(&fs::File::open(&path).unwrap()).unwrap();
        let result = atomic_write_with_operations(&path, b"updated", &expected, false, Some(identity), || {},
            |file| file.sync_all(),
            |temporary, _, no_clobber| {
                assert!(!no_clobber);
                assert_eq!(fs::read(temporary.path()).unwrap(), b"updated");
                Err(std::io::Error::new(std::io::ErrorKind::Other, "injected replace failure"))
            });
        let failure = result.unwrap_err();
        assert_eq!(failure.phase, SavePhase::Replace);
        assert!(!failure.conflict);
        assert!(failure.message.contains("Cannot replace the original file: injected replace failure"));
        assert_eq!(fs::read(&path).unwrap(), b"original");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1, "temporary file must be cleaned up");
    }

    #[test]
    fn new_destination_does_not_silently_overwrite_existing_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("new file-📝.txt");
        fs::write(&path, b"valuable original").unwrap();
        assert!(atomic_write(&path, b"replacement", "absent", false).unwrap_err().contains("WRYTROVE_FILE_CHANGED"));
        assert_eq!(fs::read(&path).unwrap(), b"valuable original");
        assert!(atomic_write(&path, b"replacement", "", true).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"valuable original");
        atomic_write(&path, b"replacement", "absent", true).unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"replacement");
    }
    #[test]
    fn existing_file_requires_matching_hash_or_explicit_force() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("existing.txt");
        let original = b"first\r\nline\n";
        fs::write(&path, original).unwrap();
        let hash = sha256_hex(original);
        atomic_write(&path, "updated 🦉".as_bytes(), &hash, false).unwrap();
        assert_eq!(fs::read(&path).unwrap(), "updated 🦉".as_bytes());
        assert!(atomic_write(&path, b"stale", &hash, false).unwrap_err().contains("WRYTROVE_FILE_CHANGED"));
        assert_eq!(fs::read(&path).unwrap(), "updated 🦉".as_bytes());
        fs::remove_file(&path).unwrap();
        assert!(atomic_write(&path, b"stale", &hash, false).unwrap_err().contains("WRYTROVE_FILE_CHANGED"));
        assert!(!path.exists());
    }
}
