fn main() {
    // Generate per-command permissions; the capability grants them only to
    // the bundled main webview. Remote content has no custom-command grants.
    let manifest = tauri_build::AppManifest::new().commands(&[
        "safe_write",
        "take_launch_files",
        "workspace_list_directory",
        "workspace_read_file",
        "large_file_inspect",
        "large_file_range",
        "workspace_create_entry",
        "journal_key_load",
        "access_revoke",
        "access_restore",
        "access_revoked_list",
    ]);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest))
        .expect("failed to build the Tauri permission manifest");
}
