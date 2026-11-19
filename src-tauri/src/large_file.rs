//! Buffered windows avoid mapping a file that another process can truncate.
//! There is no persistent native handle: every IPC call checks current access.
use std::{fs, io::{Read, Seek, SeekFrom}, path::Path};

pub const MAX_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_RANGE: usize = 256 * 1024;

fn fingerprint(meta: &fs::Metadata) -> Result<String, String> {
    let modified = meta.modified().map_err(|e| format!("Cannot determine file version: {e}"))?;
    #[cfg(unix)]
    let identity = {
        use std::os::unix::fs::MetadataExt;
        format!("{}:{}:{}:{}", meta.dev(), meta.ino(), meta.ctime(), meta.ctime_nsec())
    };
    #[cfg(not(unix))]
    let identity = format!("{:?}", meta.created().ok());
    Ok(format!("{}:{modified:?}:{identity}", meta.len()))
}

pub fn inspect(path: &Path) -> Result<serde_json::Value, String> {
    let (_, meta) = super::open_regular_file(path)?;
    let size = meta.len();
    if size > MAX_BYTES {
        return Err(format!("File is {size} bytes; the read-only viewer limit is {MAX_BYTES} bytes (1 GiB)."));
    }
    Ok(serde_json::json!({ "size": size, "version": fingerprint(&meta)? }))
}

pub fn range(path: &Path, version: &str, offset: u64, length: usize) -> Result<Vec<u8>, String> {
    if length == 0 || length > MAX_RANGE || version.len() > 256 {
        return Err("Invalid large-file range.".into());
    }
    let (mut file, meta) = super::open_regular_file(path)?;
    const CHANGED: &str = "The file changed on disk. Close and reopen it to continue.";
    if fingerprint(&meta)? != version { return Err(CHANGED.into()); }
    if meta.len() > MAX_BYTES || offset.checked_add(length as u64).is_none_or(|end| end > meta.len()) {
        return Err("Range is outside the file or exceeds the viewer limit.".into());
    }
    let mut bytes = vec![0; length];
    file.seek(SeekFrom::Start(offset)).map_err(|e| format!("Cannot seek in file: {e}"))?;
    file.read_exact(&mut bytes).map_err(|e| format!("Cannot read file range: {e}"))?;
    let after = file.metadata().map_err(|e| format!("Cannot inspect open file: {e}"))?;
    if fingerprint(&after)? != version { return Err(CHANGED.into()); }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ranges_stay_bounded_on_large_sparse_fixtures() {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        for mib in [100, 500] {
            let size = mib * 1024 * 1024;
            file.as_file().set_len(size).unwrap();
            file.as_file_mut().seek(SeekFrom::Start(size - 3)).unwrap();
            std::io::Write::write_all(file.as_file_mut(), b"end").unwrap();
            let info = inspect(file.path()).unwrap();
            assert_eq!(info["size"].as_u64(), Some(size));
            let version = info["version"].as_str().unwrap();
            assert_eq!(range(file.path(), version, size - 3, 3).unwrap(), b"end");
            assert!(range(file.path(), version, size - 3, 4).is_err());
            assert!(range(file.path(), version, 0, MAX_RANGE + 1).is_err());
            assert!(range(file.path(), version, u64::MAX, 2).is_err());
            file.as_file().set_len(size - 1).unwrap();
            assert!(range(file.path(), version, 0, 1).unwrap_err().contains("changed"));
        }
        file.as_file().set_len(MAX_BYTES + 1).unwrap();
        assert!(inspect(file.path()).unwrap_err().contains("1 GiB"));
    }

    #[cfg(unix)]
    #[test]
    fn rejects_links_and_special_files() {
        let dir = tempfile::tempdir().unwrap();
        let link = dir.path().join("link");
        std::os::unix::fs::symlink("/dev/null", &link).unwrap();
        assert!(inspect(&link).is_err());
        assert!(inspect(Path::new("/dev/null")).is_err());
    }
}
