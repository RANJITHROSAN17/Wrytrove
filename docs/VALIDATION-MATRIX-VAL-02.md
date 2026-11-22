# VAL-02 — Consumer Windows reliability and filesystem matrix

This is the execution plan for [#66](https://github.com/RANJITHROSAN17/Wrytrove/issues/66). It is
a **template**: no case in this file has been run yet. Each case must be filled in with the
environment, the observed result and an artifact link before it counts toward the Definition of
Done.

## Rules for every run

- Use a disposable VM from a clean Windows 10 or Windows 11 profile with current supported WebView2.
- Use synthetic content only. Never use real user documents.
- Follow the [case-by-case runbook](VALIDATION-RUNBOOK-VAL-02.md) on **both** Windows versions. Make a separate run record for each case, variant and OS; a summary row is not a substitute for its evidence.
- Capture the workspace and outside canary separately before and after the action; explain every diff. See the runbook for commands, ACL/attribute capture, limitations, and exit codes.
- Node is a test-only dependency, not needed by the shipped application. Evidence must be stored outside the snapshot roots.
- Attach before/after JSON, diff output, Windows metadata/ACL captures and relevant sanitized screenshots or logs to each run record. Never publish real paths, credentials or user documents.

## Matrix

Each row is one case. "Maps to" names the issue that should receive a finding if the case fails.

### A. Open, save and encoding

| ID | Scenario | Steps (summary) | Expected result | Maps to | Observed | Artifact |
|---|---|---|---|---|---|---|
| A1 | New, open, save, save-as for UTF-8 | Create, type, save, save-as to a new name, reopen | Bytes match what was typed; no extra BOM | #49 | _to fill_ | _link_ |
| A2 | UTF-8 BOM and UTF-16 LE/BE round-trip | Open synthetic BOM and UTF-16 files, edit one line, save | Encoding and BOM preserved; edited line only changed | #49 | _to fill_ | _link_ |
| A3 | CRLF and LF round-trip | Open CRLF file, save; open LF file, save | Line endings unchanged; mixed endings reported | #49 | _to fill_ | _link_ |
| A4 | Read-only file | Set read-only attribute, edit, save | Save refused with an actionable message; file bytes unchanged | #49 | _to fill_ | _link_ |
| A5 | Permission denied | Remove write ACL for the user, edit, save | Save refused; does not claim success; no temp file left behind | #49 | _to fill_ | _link_ |

### B. Changes made outside the editor

| ID | Scenario | Steps (summary) | Expected result | Maps to | Observed | Artifact |
|---|---|---|---|---|---|---|
| B1 | External modification before save | Open file, change bytes in another editor, save in Wrytrove | Save blocked; user sees a conflict and the external content is not overwritten | #49 | _to fill_ | _link_ |
| B2 | Replacement between focus check and save | Replace the file with a new one during the focus-check window, then save | Hash verification fails; no silent overwrite | #49 | _to fill_ | _link_ |
| B3 | Rename between open and save | Rename the open file, save | Wrytrove reports the missing path; does not create a new file at the old path without asking | #49 | _to fill_ | _link_ |
| B4 | Deletion between open and save | Delete the open file, save | Reports the missing file; recovery copy kept | #47 | _to fill_ | _link_ |

### C. Links, junctions and scope

| ID | Scenario | Steps (summary) | Expected result | Maps to | Observed | Artifact |
|---|---|---|---|---|---|---|
| C1 | Junction inside the selected workspace pointing outside | Create a junction in scope to an outside folder; open and save a file through it | Outside target unchanged (verify with capture of the outside folder); action refused or clearly scoped | #49 | _to fill_ | _link_ |
| C2 | Symlink inside scope pointing outside | Same as C1 with a symlink | Same as C1 | #49 | _to fill_ | _link_ |
| C3 | Parent-directory swap | Replace a parent directory with a link while a save is pending | No write outside the selected scope | #49 | _to fill_ | _link_ |
| C4 | Mount point or reparse point | Use a mount point inside the workspace | Behaviour documented; no escape from scope | #49 | _to fill_ | _link_ |

### D. Network and degraded storage

| ID | Scenario | Steps (summary) | Expected result | Maps to | Observed | Artifact |
|---|---|---|---|---|---|---|
| D1 | UNC path on a reachable share | Open and save a file on a test share | Save completes; hash matches after save | #49 | _to fill_ | _link_ |
| D2 | Share disconnected mid-session | Disconnect the share, then save | Save fails with an actionable message; no success claim; prior file intact | #49 | _to fill_ | _link_ |
| D3 | Share reconnects after failure | Reconnect, then save again | Save succeeds only after verification; no duplicate recovery writes | #49 | _to fill_ | _link_ |

### E. Interruption, termination and recovery

| ID | Scenario | Steps (summary) | Expected result | Maps to | Observed | Artifact |
|---|---|---|---|---|---|---|
| E1 | Interrupted temp write | Kill the process during the temp-file write of a save | Prior destination file intact; the stage of failure is reported on next start | #49 | _to fill_ | _link_ |
| E2 | Process termination with unsaved edits | Edit, wait for recovery, kill the process, restart | Newest recovery draft offered; disk-newer and draft-newer shown distinctly | #47 | _to fill_ | _link_ |
| E3 | Forced restart | Force a restart in the middle of typing | Same as E2 | #47 | _to fill_ | _link_ |
| E4 | Simulated power loss | Cut power to the VM (or use a hypervisor power-off) during a save | Destination is the old or the new complete content, never a mix; recovery offered | #49, #47 | _to fill_ | _link_ |

### F. Size limits

| ID | Scenario | Steps (summary) | Expected result | Maps to | Observed | Artifact |
|---|---|---|---|---|---|---|
| F1 | Exactly 20 MiB synthetic file | Open and save | Accepted; hash matches | #51 | _to fill_ | _link_ |
| F2 | 20 MiB + 1 byte | Open | Rejected or degraded with a clear message; not truncated | #51 | _to fill_ | _link_ |
| F3 | Representative larger file (for example 100 MiB) | Open | Documented degraded behaviour; no crash | #51 | _to fill_ | _link_ |

### G. Installer and upgrade

| ID | Scenario | Steps (summary) | Expected result | Maps to | Observed | Artifact |
|---|---|---|---|---|---|---|
| G1 | Clean install | Run the signed or unsigned-preview installer | Installs; launches; WebView2 present | #46 | _to fill_ | _link_ |
| G2 | Uninstall | Uninstall | Program removed; user files untouched (capture confirms) | #46 | _to fill_ | _link_ |
| G3 | File associations | Open a .txt/.md file from Explorer | Opens in Wrytrove when associated | #46 | _to fill_ | _link_ |
| G4 | WebView2 bootstrapper failure | Block the bootstrapper network access | Installer reports the failure; no broken half-install claimed as success | #46 | _to fill_ | _link_ |
| G5 | Upgrade and rollback | Install the previous version, upgrade, then reinstall the previous version | Data and settings preserved; rollback documented in RELEASE-VERIFICATION.md | #46 | _to fill_ | _link_ |

## Definition of Done mapping

- Each case above has a reproducible step list, environment, expected result, observed result and artifact link. → Columns "Steps", "Observed" and "Artifact".
- No changed-on-disk file is silently overwritten in any save path. → B1, B2.
- A failed or interrupted save leaves the prior destination recoverable and reports the stage. → A5, E1, E4.
- Reparse/link paths cannot escape scope. → C1–C4 with outside-folder capture.
- Network, read-only and permission failures are actionable. → A4, A5, D2.
- Recovery is tested after termination and power loss. → E2–E4.
- Findings are mapped to #46, #47, #49, #51 or a new bug. → "Maps to" column. New bugs need a minimal reproduction.
