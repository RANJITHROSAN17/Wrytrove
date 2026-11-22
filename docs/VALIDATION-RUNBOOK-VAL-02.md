# VAL-02 — Windows execution runbook

For [#66](https://github.com/RANJITHROSAN17/Wrytrove/issues/66) and the [matrix](VALIDATION-MATRIX-VAL-02.md). **Preparation only: none of these cases has been run here.** This runbook does not assert that a behavior passes. Execute every case and variant on clean Windows 10 and Windows 11 profiles with supported WebView2, using the actual shipped installer/build under test. A hosted CI run or a browser-only preview does not replace these runs.

## Safety and setup

1. Use an isolated disposable VM with a checkpoint, synthetic files only, and no real provider keys, documents, or other user data. Provision a separate disposable VM/share for D; never disconnect a real network. Use administrator privileges only for VM, share, link or ACL setup, and run Wrytrove as the normal test user. Record that distinction.
2. Record source commit, app version, installer SHA-256 and signing mode; Windows edition/build, WebView2 version, filesystem and volume, VM/hypervisor, Node version, account privilege and settings. Record prior installer version/hash for G5. Follow [release verification](RELEASE-VERIFICATION.md); never label an unsigned preview signed. Archive the run record outside the VM before restoring a checkpoint or cutting power.
3. Copy this checkout's scripts into the VM. In PowerShell, from the repository root, set `$CaseRoot` to a **new** path on a disposable local volume, e.g. `$CaseRoot = 'C:\VAL02\A1-run01'` (create `C:\VAL02` first), then run `node scripts/validation/val02-fixtures.mjs $CaseRoot`. It refuses an existing destination, creates `workspace`, `outside`, and `manifest.json`, and writes about 141 MiB of deterministic synthetic data. If interrupted, inspect and remove the incomplete directory manually; never point it at a real workspace. Use a new root per case and repeat. The helper's automated self-test is `npm run test:val02-fixtures`; it does not validate the Windows application.
4. Prepare case-specific state (including ACLs and links) **before** the baseline. Put evidence in a separate directory not inside `workspace` or `outside`. Capture while the trees are quiescent; a live/racing capture is not a consistent snapshot.

## Evidence procedure (every run)

From the checkout in PowerShell, after setting `$CaseRoot` and `$Evidence` to separate disposable paths:

```powershell
New-Item -ItemType Directory -Path $Evidence -ErrorAction Stop | Out-Null
node scripts/validation/capture-state.mjs snapshot "$CaseRoot\workspace" "$Evidence\workspace-before.json"
if ($LASTEXITCODE -ne 0) { throw 'Before workspace snapshot failed' }
node scripts/validation/capture-state.mjs snapshot "$CaseRoot\outside" "$Evidence\outside-before.json"
if ($LASTEXITCODE -ne 0) { throw 'Before outside snapshot failed' }
# Capture Windows attributes and ACLs on relevant files, directories and link objects too.
Get-Item -Force "$CaseRoot\workspace\target.txt", "$CaseRoot\outside\canary.txt" | Format-List FullName,Attributes,Length,LastWriteTimeUtc | Out-File "$Evidence\metadata-before.txt"
Get-Acl "$CaseRoot\workspace\target.txt", "$CaseRoot\outside\canary.txt" | Format-List Path,Owner,Group,AccessToString,Sddl | Out-File "$Evidence\acl-before.txt"
```

After the action and once all writes have stopped, repeat snapshots and metadata/ACL capture with `after` filenames; include any additional case-specific paths and the share. Then compare **both** trees:

```powershell
node scripts/validation/capture-state.mjs diff "$Evidence\workspace-before.json" "$Evidence\workspace-after.json" | Tee-Object "$Evidence\workspace-diff.json"
$workspaceExit = $LASTEXITCODE
node scripts/validation/capture-state.mjs diff "$Evidence\outside-before.json" "$Evidence\outside-after.json" | Tee-Object "$Evidence\outside-diff.json"
$outsideExit = $LASTEXITCODE
"workspace=$workspaceExit outside=$outsideExit" | Out-File "$Evidence\diff-exits.txt"
```

Exit 0 means identical, 1 means differences, 2 means an error. Explain all differences; a nonzero diff is not automatically a product failure. Failed captures are **blocked evidence**, not a pass. Save `manifest.json`, before/after snapshots, diffs and exit codes, metadata/ACLs, relevant screenshots/logs, and the run record. Note exact error messages and save stage, not just “failed”. Review/redact paths, usernames, share names and other identifying data before publishing. Never publish credentials.

The Node helper streams regular file hashes and records size, mtime and a mode-derived read-only flag. It is not an ACL, ownership, Windows attribute or reparse-tag inventory; use Windows tools above and record the link/reparse tag separately (for example `fsutil reparsepoint query <path>` where applicable). It does not follow recognized symlinks/junctions during ordinary traversal, but is **not race-safe** and cannot promise to recognize every reparse type or linked ancestor. Do not use it to contain hostile paths; stop the race before capturing and snapshot the actual outside target separately. Record failures or inaccessible entries rather than assuming absence. It cannot prove crash durability or secure deletion.

## Per-case actions

The [matrix](VALIDATION-MATRIX-VAL-02.md) supplies expected outcomes and issue mapping. For each variant below record exact steps, times, app messages, observed hashes/metadata and evidence links. Save and restart Wrytrove between cases; do not accept an overwrite confirmation unless a variant explicitly tests it. If a setup prerequisite cannot be achieved, mark **blocked**, explain why, and retain evidence; do not substitute a unit test.

### A — encoding and permissions

- **A1:** Create a new synthetic document in Wrytrove, type `alpha` then newline `beta`, save into workspace, close/reopen, edit and Save As to a different new name. Capture both files' bytes and compare to intended UTF-8 without BOM; include both save paths.
- **A2:** Individually open `utf8-bom.txt`, `utf16le.txt`, `utf16be.txt`; change only `beta` to `BETA`, save, close/reopen. Inspect bytes/BOM and compare to the original manifest and expected encoding, not just the displayed text.
- **A3:** Repeat with `utf8.txt`, `crlf.txt`, `mixed.txt`; edit one line and record line-ending bytes and any warning. Do not normalize the fixture externally.
- **A4:** Set `target.txt` read-only (`attrib +R <path>`), capture baseline, open/edit/save. Capture error and file bytes; reset the attribute only after evidence.
- **A5:** On the disposable workspace, configure a file/directory ACL that permits reading but denies the test user the write/create/delete permissions needed to save. Record SDDL and verify the denial with a separate synthetic write as that user before baseline. Open/edit/save, record errors and temporary files. Restore permissions after capture; never alter ACLs outside the disposable tree.

### B — external changes

Open `target.txt`, edit without saving, then use another process/editor to make the specified change; preserve dirty editor state. Capture the external bytes before trying save, then attempt save and record UI/conflict behavior and disk bytes. Test both regular save and applicable Save As paths, recording confirmation choices.

- **B1:** Modify existing bytes externally while the app is open.
- **B2:** After a focus check, atomically replace the destination with different synthetic bytes before save. Record focus/replace/save timing and whether the intended window was actually reached. For the narrower hash-check/commit race use an explicitly instrumented *separate* build or filesystem synchronization mechanism and record its commit and method; if timing cannot be demonstrated, mark that variant blocked. Do not treat repeated untimed attempts as proof that no race exists.
- **B3:** Rename the destination externally, then save the dirty tab. Capture both old and new names.
- **B4:** Delete the destination externally, then save and restart; document whether and how the dirty draft is recoverable.

### C — containment and reparse behavior

Use disposable `outside/canary.txt` and a selected workspace folder; create and document links before baseline. Do not grant Wrytrove access to the outside path separately. Capture the outside tree directly before and after, as well as reparse metadata. Use separate cases for read, navigation and save where reachable.

- **C1:** `cmd /c mklink /J <workspace-link> <outside-dir>`; try navigating/opening/saving the canary through the junction. Record target and command result.
- **C2:** Create a directory symlink (`New-Item -ItemType SymbolicLink`) to the outside directory; use Developer Mode or the required privilege for setup. Attempt the same operations as C1 under the normal user.
- **C3:** Open a synthetic file in a real parent directory under workspace, then replace that parent with a junction to outside while a save is pending. Capture the method and timing and check the outside canary. Without a demonstrable pending-save window, mark the race variant blocked; use a separately identified instrumented build if necessary.
- **C4:** In a disposable VM provision a separate test volume and directory mount point (or a specified non-junction reparse type), record its tag and target, and test access. Do not delete or dismount a real volume. If unavailable, mark blocked and name the untested type.

### D — share and connectivity

Provision a test-only SMB share on the second VM; record share configuration, versions, ACLs and network isolation. Copy `target.txt` to the share and snapshot/hash the share from its host as well as the client workspace. **D1:** open via UNC, edit/save/reopen and compare bytes. **D2:** open/edit, disconnect the disposable share/network before saving, record the error, then reconnect only to capture the unchanged server copy. **D3:** after D2 reconnect, retry the dirty save, inspect recovery records and verify the resulting server bytes. Record if the disconnect did not actually occur or a test could not run.

### E — interruption and recovery

Use checkpoints and preserve evidence outside the VM. Record how the interruption point was established. A process kill is not a power-loss simulation.

- **E1:** Save an edited target and terminate the process during a verified temp write; inspect destination and `.wrytrove-*` files, restart and record any stage information. If the window cannot be observed or controlled, mark blocked; separately identify any instrumented build.
- **E2:** Edit an open file, wait for the recovery write, verify a synthetic draft exists, forcibly terminate Wrytrove, restart and inspect the recovery prompt and bytes. Repeat with externally newer disk content and with newer draft content.
- **E3:** Edit and force a guest OS restart while typing. Record the last known persisted draft and what was recovered, not an assumed final keystroke.
- **E4:** During a verified save window, power off the VM through the hypervisor without guest shutdown. On restart inspect destination bytes against the complete old/new expected hashes and recovery state. If the timing or external evidence cannot be established, mark blocked. Repeat with documented timing, not a single unobserved cut.

### F — file sizes

For each of `20mib.txt`, `20mib-plus-one.txt`, and `100mib.txt`, record original hash and byte length. Open in the shipped app, document the UI/degraded mode and any limits; try a small edit/save only if available, then hash after and check that no truncation or false success occurred. These are **F1**, **F2**, **F3** respectively. Preserve the originals for comparison.

### G — installer lifecycle

Use a fresh checkpoint per variant and archive installer hashes. **G1:** install and launch; record installer result, signing mode and WebView2 version. **G2:** create and snapshot a synthetic user file outside the installation directory, uninstall via Settings, check app removal and file hash. **G3:** set associations as the test user, launch `.txt` and `.md` from Explorer and record application/bytes. **G4:** on a VM without the runtime, block the bootstrapper network destination in the isolated test network, run installer, capture outcome and installed state; if runtime absence or blocking cannot be verified, mark blocked. **G5:** install a verified prior release, create synthetic settings/files, upgrade to the target release, then follow the documented rollback (uninstall and install prior release); compare settings and files at each stage. Record any unsupported rollback or migration rather than assuming preservation.

## Run record and closure

For each OS/case/variant record: ID, date/time UTC, tester, environment and build/installer hashes; exact setup/commands, baseline, action/timing and expected result; observed behavior, hashes, attributes/ACLs and messages; status **pass/fail/blocked/not run**; artifact links; related issue or new bug and minimal reproduction. For failures, use #46, #47, #49 or #51 when appropriate, otherwise file a new bug. Keep sensitive exploit details private under [SECURITY.md](../SECURITY.md). A pass requires all relevant evidence; unmet prerequisites and unhit timing windows are blocked, never silent passes. The issue remains open until both OS matrices and all acceptance criteria are supported by real evidence.
