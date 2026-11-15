//! AUD-03: the recovery journal key. A random 256-bit key is generated once, wrapped with Windows
//! DPAPI for the current user, and stored in the app data folder. The plaintext key is returned to
//! the webview only for the life of a session and is never written in plaintext.
//!
//! Raw Win32 declarations are used instead of a crate so Cargo.lock does not change.

use std::{fs, path::{Path, PathBuf}, sync::Mutex};

/// Error prefix the frontend maps to `KeyUnavailableError`. Locked or missing keys are never
/// replaced silently, because replacing the key would make existing drafts unreadable.
pub const KEY_UNAVAILABLE: &str = "WRYTROVE_KEY_UNAVAILABLE";
const KEY_FILE: &str = "journal-key.v1.dpapi";
const KEY_BYTES: usize = 32;
const ENTROPY: &[u8] = b"wrytrove-journal-key-v1";
static KEY_LOCK: Mutex<()> = Mutex::new(());

fn key_path(dir: &Path) -> PathBuf { dir.join(KEY_FILE) }

#[cfg(windows)]
mod platform {
    use std::ffi::c_void;
    use std::ptr;

    #[repr(C)]
    pub struct DataBlob { pub cb_data: u32, pub pb_data: *mut u8 }

    #[link(name = "crypt32")]
    extern "system" {
        pub fn CryptProtectData(data_in: *const DataBlob, descr: *const u16, entropy: *const DataBlob, reserved: *mut c_void, prompt: *mut c_void, flags: u32, out: *mut DataBlob) -> i32;
        pub fn CryptUnprotectData(data_in: *const DataBlob, descr: *mut *mut u16, entropy: *const DataBlob, reserved: *mut c_void, prompt: *mut c_void, flags: u32, out: *mut DataBlob) -> i32;
    }
    #[link(name = "kernel32")]
    extern "system" { pub fn LocalFree(mem: *mut c_void) -> *mut c_void; }
    #[link(name = "bcrypt")]
    extern "system" { pub fn BCryptGenRandom(alg: *mut c_void, buf: *mut u8, len: u32, flags: u32) -> i32; }

    const CRYPTPROTECT_UI_FORBIDDEN: u32 = 0x1;
    const BCRYPT_USE_SYSTEM_PREFERRED_RNG: u32 = 0x2;

    pub fn random(buf: &mut [u8]) -> Result<(), String> {
        let len = u32::try_from(buf.len()).map_err(|_| "Random buffer too large.".to_string())?;
        // SAFETY: buf is valid for len bytes; a null algorithm handle with the system RNG flag is documented.
        let status = unsafe { BCryptGenRandom(ptr::null_mut(), buf.as_mut_ptr(), len, BCRYPT_USE_SYSTEM_PREFERRED_RNG) };
        if status == 0 { Ok(()) } else { Err("The system random source failed.".into()) }
    }

    pub fn protect(data: &[u8]) -> Result<Vec<u8>, String> {
        let input = DataBlob { cb_data: u32::try_from(data.len()).map_err(|_| "Key too large.".to_string())?, pb_data: data.as_ptr() as *mut u8 };
        let entropy = DataBlob { cb_data: super::ENTROPY.len() as u32, pb_data: super::ENTROPY.as_ptr() as *mut u8 };
        let mut out = DataBlob { cb_data: 0, pb_data: ptr::null_mut() };
        // SAFETY: input, entropy and out are valid for the call; the output buffer is freed below.
        let ok = unsafe { CryptProtectData(&input, ptr::null(), &entropy, ptr::null_mut(), ptr::null_mut(), CRYPTPROTECT_UI_FORBIDDEN, &mut out) };
        if ok == 0 || out.pb_data.is_null() { return Err("The key could not be protected by Windows.".into()); }
        // SAFETY: on success out.pb_data points to out.cb_data bytes allocated by DPAPI.
        let bytes = unsafe { std::slice::from_raw_parts(out.pb_data, out.cb_data as usize).to_vec() };
        unsafe { LocalFree(out.pb_data as *mut c_void) };
        Ok(bytes)
    }

    pub fn unprotect(data: &[u8]) -> Result<Vec<u8>, String> {
        let input = DataBlob { cb_data: u32::try_from(data.len()).map_err(|_| "Key file too large.".to_string())?, pb_data: data.as_ptr() as *mut u8 };
        let entropy = DataBlob { cb_data: super::ENTROPY.len() as u32, pb_data: super::ENTROPY.as_ptr() as *mut u8 };
        let mut out = DataBlob { cb_data: 0, pb_data: ptr::null_mut() };
        // SAFETY: as in protect; a failure means the key is locked, belongs to another user, or is damaged.
        let ok = unsafe { CryptUnprotectData(&input, ptr::null_mut(), &entropy, ptr::null_mut(), ptr::null_mut(), CRYPTPROTECT_UI_FORBIDDEN, &mut out) };
        if ok == 0 || out.pb_data.is_null() { return Err("The recovery key could not be unlocked by Windows.".into()); }
        // SAFETY: as in protect.
        let bytes = unsafe { std::slice::from_raw_parts(out.pb_data, out.cb_data as usize).to_vec() };
        unsafe { LocalFree(out.pb_data as *mut c_void) };
        Ok(bytes)
    }
}

/// Returns the journal key for `dir`, creating it on first use. Never replaces an existing key file
/// that cannot be unlocked, because that would make the existing drafts unreadable.
#[cfg(windows)]
pub fn load_or_create_in(dir: &Path) -> Result<Vec<u8>, String> {
    let _guard = KEY_LOCK.lock().map_err(|_| format!("{KEY_UNAVAILABLE}: key store unavailable"))?;
    fs::create_dir_all(dir).map_err(|err| format!("Cannot prepare the key folder: {err}"))?;
    let path = key_path(dir);
    match fs::read(&path) {
        Ok(wrapped) => {
            let key = platform::unprotect(&wrapped).map_err(|err| format!("{KEY_UNAVAILABLE}: {err}"))?;
            if key.len() != KEY_BYTES { return Err(format!("{KEY_UNAVAILABLE}: the stored key has an unexpected length.")); }
            Ok(key)
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            let mut key = vec![0u8; KEY_BYTES];
            platform::random(&mut key)?;
            let wrapped = platform::protect(&key)?;
            // Write to a temporary file and rename, so a crash never leaves a half-written key file.
            let mut temporary = tempfile::Builder::new().prefix(".journal-key-").tempfile_in(dir)
                .map_err(|err| format!("Cannot create the key file: {err}"))?;
            std::io::Write::write_all(&mut temporary, &wrapped).map_err(|err| format!("Cannot write the key file: {err}"))?;
            temporary.as_file().sync_all().map_err(|err| format!("Cannot flush the key file: {err}"))?;
            temporary.persist_noclobber(&path).map_err(|err| format!("Cannot store the key file: {}", err.error))?;
            Ok(key)
        }
        Err(err) => Err(format!("{KEY_UNAVAILABLE}: cannot read the key file ({err})")),
    }
}

#[cfg(not(windows))]
pub fn load_or_create_in(_dir: &Path) -> Result<Vec<u8>, String> {
    Err(format!("{KEY_UNAVAILABLE}: OS-protected key storage is only available on Windows."))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(not(windows))]
    fn non_windows_reports_the_key_as_unavailable_and_creates_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let err = load_or_create_in(dir.path()).unwrap_err();
        assert!(err.starts_with(KEY_UNAVAILABLE));
        assert!(!key_path(dir.path()).exists());
    }

    #[test]
    #[cfg(windows)]
    fn windows_key_is_created_once_and_then_unwrapped_unchanged() {
        let dir = tempfile::tempdir().unwrap();
        let first = load_or_create_in(dir.path()).unwrap();
        assert_eq!(first.len(), KEY_BYTES);
        let stored = fs::read(key_path(dir.path())).unwrap();
        assert!(!stored.windows(KEY_BYTES).any(|w| w == first.as_slice()), "plaintext key must not be stored");
        assert_eq!(load_or_create_in(dir.path()).unwrap(), first);
    }

    #[test]
    #[cfg(windows)]
    fn damaged_key_file_is_reported_and_never_replaced() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(key_path(dir.path()), b"not a dpapi blob").unwrap();
        let err = load_or_create_in(dir.path()).unwrap_err();
        assert!(err.starts_with(KEY_UNAVAILABLE));
        assert_eq!(fs::read(key_path(dir.path())).unwrap(), b"not a dpapi blob");
    }
}
