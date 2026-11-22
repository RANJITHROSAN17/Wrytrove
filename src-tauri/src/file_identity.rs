//! Identity of an already-open regular file, for save-time race detection.
//! An identity comparison is not atomic with a later path-based replace.
use std::fs::File;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FileIdentity {
    volume: u64,
    file: u64,
}

#[cfg(unix)]
pub fn identity(file: &File) -> Result<FileIdentity, String> {
    use std::os::unix::fs::MetadataExt;
    let meta = file.metadata().map_err(|err| format!("Cannot inspect open file identity: {err}"))?;
    Ok(FileIdentity { volume: meta.dev(), file: meta.ino() })
}

#[cfg(windows)]
pub fn identity(file: &File) -> Result<FileIdentity, String> {
    use std::{ffi::c_void, mem::MaybeUninit, os::windows::io::AsRawHandle};

    #[repr(C)]
    struct FileTime { low: u32, high: u32 }
    // BY_HANDLE_FILE_INFORMATION from the Windows API.
    #[repr(C)]
    struct FileInformation {
        attributes: u32,
        creation_time: FileTime,
        last_access_time: FileTime,
        last_write_time: FileTime,
        volume_serial: u32,
        size_high: u32,
        size_low: u32,
        number_of_links: u32,
        file_index_high: u32,
        file_index_low: u32,
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GetFileInformationByHandle(handle: *mut c_void, information: *mut FileInformation) -> i32;
    }

    let mut info = MaybeUninit::<FileInformation>::uninit();
    // SAFETY: the file owns a live handle and info points to correctly sized writable storage.
    if unsafe { GetFileInformationByHandle(file.as_raw_handle(), info.as_mut_ptr()) } == 0 {
        return Err(format!("Cannot inspect open file identity: {}", std::io::Error::last_os_error()));
    }
    // SAFETY: the successful Windows call initialized all fields.
    let info = unsafe { info.assume_init() };
    let index = (u64::from(info.file_index_high) << 32) | u64::from(info.file_index_low);
    // Some filesystems do not provide a usable file index. Do not silently treat it as identity.
    if index == 0 { return Err("Cannot determine a stable file identity on this filesystem.".into()); }
    Ok(FileIdentity { volume: u64::from(info.volume_serial), file: index })
}

#[cfg(not(any(unix, windows)))]
pub fn identity(_file: &File) -> Result<FileIdentity, String> {
    Err("File identity checks are unavailable on this platform.".into())
}
