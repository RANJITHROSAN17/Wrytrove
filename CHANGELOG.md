# Changelog

## Unreleased — after 0.4.0

### Release trust

- Add a read-only Windows build plus tag-only publish boundary with tag/version/commit/checksum guards, CycloneDX npm and Cargo metadata SBOMs, SPDX coverage validation, GitHub artifact attestations and downloadable offline provenance bundles.
- Add optional Authenticode signing with RFC 3161 timestamping and expected publisher-thumbprint verification. A missing certificate remains an explicitly labelled `unsigned-preview`; no automatic updater or forced migration is introduced. See [`docs/RELEASE-VERIFICATION.md`](docs/RELEASE-VERIFICATION.md).

### Brand rename

- Rename the product, package, Cargo crate/library, Tauri product name, window title, file-association label, UI copy, documentation and automation from Morrow to **Wrytrove**. The version remains `0.4.0`.
- Read pre-rename settings, daily goals and IndexedDB recovery snapshots as fallbacks; new writes use Wrytrove keys. The desktop bundle identifier stays `app.morrow.editor` so existing WebView storage and folder permissions are not orphaned. Keep old roadmap issue markers recognizable so closed tasks are not filed again.
- Rename the visual-explainer document and screenshot assets. Historical branch names, the published `Morrow_0.4.0_x64-setup.exe` filename, repository URLs and the naming-analysis record are intentionally preserved.

### The writing layer

- Add a **writing surface**: live words, characters, paragraphs, lines and reading time in the status bar; an optional **daily word goal** that counts only positive per-document deltas, resets at local midnight and is stored locally; and a **minimap** that tiles the document exactly, marks the caret, is click-to-jump, and disables itself above 400,000 characters instead of stalling.
- Add **focus**, **typewriter** and **zen** modes (`F8`, `F9`, `F11`), with a sentence or paragraph scope, plus a status chip that turns them off in one click.
- Add **Markdown editing commands** — bold, italic, inline code, strikethrough, link, block quote, bullet/numbered/task lists, fenced code block and heading levels (`Ctrl+B`/`Ctrl+I`/`Ctrl+K`, `Ctrl+Shift+1…6`, `Ctrl+Shift+Q`/`U`, `Ctrl+Shift+K`/`D`) — and line operations (duplicate, delete, sort, move up/down, trim, join). `Ctrl+B` still toggles the sidebar everywhere bold cannot apply.
- Add optional **smart typography** (curly quotes, dashes, ellipsis) that only ever rewrites a single typed character, never a paste or IME composition, and never inside code.
- Add settings for font family (editor/serif/sans/mono), browser spell-check, a ruler column, minimap, smart typography, focus scope, daily goal and the daily-note folder. Stored daily-note folders are validated as relative paths so a note can never be written outside the workspace.

### The notes layer

- Add a **Notes rail** with three views: an **outline** of the current note, **tags** from `#tag` and front matter (for this note and across the index), and **links** — outbound `[[wiki links]]` with broken/ambiguous states, **backlinks**, and orphan notes.
- Add an on-demand, **local-only note index** with tag counts, backlink resolution and ambiguity reporting (two notes named `Plan` link to neither, rather than guessing). It reads only folders you opened, can be cleared from the menu, and is never uploaded.
- Add **quick capture** (`Ctrl+Alt+N`) that appends a timestamped block to `Inbox.md` (or a configured note), optionally as a task list; **daily notes** (`Ctrl+Alt+D`) from an expandable template with `yyyy-mm-dd`, `yyyy-mm`, `yyyy/mm/dd` and `dd-MM-yyyy` formats; and **new note from template**.
- Add a **note actions** set: tab outline palette (`Ctrl+Shift+O`), notes panel toggle (`Ctrl+Alt+B`), index build/clear.

### Local AI transport

- Stop Ollama requests from carrying an `Origin` header. `tauri-plugin-http` stamps every request with the webview's origin, which on a Windows release build is `https://tauri.localhost`; Ollama's default CORS allow-list covers `tauri://*` (Linux/macOS) but not that Windows origin, so every installed build was rejected with HTTP 403 before reaching the API while a dev build worked. Ollama requests now send an explicitly empty `Origin`, which the plugin drops via its `unsafe-headers` feature, so no origin leaves the app and a default Ollama install works unchanged. `docs/USER-GUIDE.md` documents the `OLLAMA_ORIGINS` workaround for older builds; unit tests pin the header on all three request paths.

### Installed-build fixes

- Fix saving from an installed Windows build, which failed with "Expected raw file data." `safe_write` accepted only `InvokeBody::Raw`, the shape Tauri produces while its IPC custom protocol is usable. When the webview refuses that fetch, Tauri silently retries the same call through `window.ipc.postMessage`, where the payload arrives as JSON instead — so no save could ever be committed. `safe_write` now reads the payload on either transport: raw bytes, the number array a `Uint8Array` becomes inside a JSON payload, a base64 string, or either of those under a `bytes` field. `tests/ipc-body.test.ts` copies Tauri's own payload conversion so the real body type is covered rather than mocked away, and the Rust decoder is unit-tested against every shape.
- Fix the tab close button disappearing behind a long file name. `.tab-name` had no `min-width: 0`, so as a flex item it kept its full min-content width and the 21px close button was laid out past the tab's 235px cap, outside the visible strip. The name now ellipsizes and the close button keeps its own width and contrast. Short fixtures never reproduced this, so a browser test opens a long-named file and asserts the button, its glyph and its position inside the tab.
- Stop the save-metadata notice from firing on every save. It was built from two hardcoded Rust fields (`acl` and `other`, always `not_verified`) plus the staged `permissions` operation, so every save — including a first save of a new file that had no metadata to preserve — raised `Saved "<name>". No existing permissions value was applied to the temporary file. ACLs and other metadata were not verified and may change.` The save now inspects the file it actually left behind and compares it with the one it replaced (Windows `FILE_ATTRIBUTE_READONLY`/`HIDDEN`/`SYSTEM` plus the read-only flag; Unix permission bits), reporting `preserved`, `changed`, `not_applicable` or `not_verified`. The banner appears only for a detected difference or a failed check, and a save that preserved everything it could check shows nothing at all. The staged operation is still reported for diagnostics but no longer described to the user, because it says nothing about the file they end up with. Verified in a browser across all six metadata shapes; the notice stays hidden for an ordinary save, a new file, a legacy report with no preservation field and a missing report, and appears — dismissibly — for `changed` and `not_verified`.

### Tests and docs

- Add the VAL-05 pre-recruitment study kit for #69: a consent script, synthetic checksummed fixtures, privacy plan, coded observation template and codebook, facilitator and assistive-technology scripts, a decision ledger, pilot-size record, and privacy-preserving aggregation tooling. Maintainer v0.1 sign-off is recorded, but no user sessions were run and no product decisions are claimed; the issue remains open until sessions or a signed pilot exception produce evidence.
- 250 unit tests across 25 files, including new suites for word statistics, outlines, notes and front matter, Markdown formatting, focus modes, Markdown extensions, the note index, discovery, the daily goal and the minimap. `npx tsc --noEmit` is clean.
- Add [Wrytrove at a glance](docs/WRYTROVE-AT-A-GLANCE.md), a one-image visual explainer of what the app is, a day with it, and an honest list of what is still unproven.
- Add a `Content-Security-Policy` to the browser preview (`index.html`): same-origin scripts/styles/workers only, no remote origins, `connect-src` limited to `self` plus `ws:`/`wss:` for Vite HMR. Enforced by the static security audit. `frame-ancestors` cannot be expressed in a meta tag and remains covered by the desktop Tauri CSP. The desktop app keeps its own (stricter) policy; AI requests never use browser fetch in either surface.

- Add **reviewable AI actions on a selection**: Improve, Fix grammar, Shorten, Expand, Summarize, Bullet points, Explain and Custom. Replace actions open the existing diff review and never edit or save automatically; Explain is read-only. Only the selected text (up to 12,000 characters) and an optional instruction (up to 2,000) are sent to Ollama, after a separate per-session consent. Requests are cancellable, time out after 60 seconds, and are refused if the selection changed. Output is bounded, cleaned, and treated as untrusted text. Unit tests cover limits, delimiter collisions, output cleaning and the transport path; a real model response on Windows remains unverified.
- Add [competitive audit, user-expectation research and AI upgrade plan](docs/COMPETITIVE-AUDIT-AND-ROADMAP-2026-11.md), covering the most-starred notepad, note-taking and AI-editor repositories, licensing cautions, a table-stakes gap list and a phased roadmap.


## 0.4.0 — unreleased preview

- Refresh the dark and light palettes, app icon, connected tabs, editor chrome, dialogs and compact layout. Add a visible quick-open entry point and selected contrast/reduced-motion checks.
- Make the normal-browser Arena path the default: prepare a bounded, editable prompt from an explicit selection, copy only on request, sign in externally and review the pasted response. The website is not embedded and sessions are not transferred. The separate eligible-key API is still optional.
- Generate explicit permissions for the main bundled webview's Rust commands, deny remote editor navigation, narrow allowed external URLs, and test local versus remote IPC with Tauri's mock runtime.
- Enforce bounded no-follow native reads for individually opened files and bound Ollama JSON/error responses. Direct links/reparse points are rejected; parent-path races and existing-file save races remain.
- Preserve the unreleased 0.3.0 candidate's new-file save fix, multi-root workspaces, creation/search and API comparison. Consumer Windows, authenticated Arena and a complete security/accessibility audit remain unverified.


## 0.2.0 — 2026-10-30

### Folder, navigation and reviewed changes

- Open one explicitly selected folder, browse it lazily, and search its **saved files** with literal text and optional case/extension/name filters. Traversal, file sizes and results are bounded; generated folders, unsupported items and errors are disclosed. See the README for exact limits and exclusions.
- Add quick open (`Ctrl+P`), go to line (`Ctrl+G`), a command palette (`Ctrl+Shift+P`) and an optional, default-off recent native paths list with a clear control and storage-failure warnings.
- Compare a pasted replacement with one selected editor range before accepting it. Changes apply to the editor only, as one isolated undo step. Stale targets are rejected and Markdown is not silently stripped.
- Offer a normal-browser Arena workflow with manual copy/paste, plus an optional Arena API panel requiring an eligible key and explicit confirmation for every request. Keys are not persisted by Wrytrove. A Linux synthetic invalid-key request returned HTTP 401; authenticated success remains unverified. API access, model availability, billing and privacy depend on the user's account.
- Add an opt-in, locally rendered Markdown preview that follows unsaved edits. It uses an isolated worker and bounded inert DOM nodes; links and images are disabled and raw HTML is text. Limits and Windows verification caveats are in the README.
- Warn locally about a few potential credential patterns before an Arena API send. This is a limited, fallible heuristic, not a guarantee or a redaction tool. Clarify that Ollama's loopback API can route cloud models.
- Bound native folder enumeration and reads before IPC, skip detected links/reparse points, and restrict the HTTP plugin's redirect scope. Parent-directory and filesystem races remain; closing a folder view does not revoke persisted Tauri access.
- Add automated tests for search, navigation, review safety and undo, Arena request validation with a mock transport, and recent-path privacy. These do not replace hands-on Windows, live-provider, security or accessibility testing.

## 0.1.1 — 2026-10-30

### Trust and usability

- AI consent is session-only; AI starts off every time, including after upgrades from older saved settings.
- Settings and recovery failures show persistent, actionable warnings. Unreadable settings or recovery snapshots no longer cause existing recovery data to be silently overwritten.
- Recovery deletion failures can be retried, and closing with dirty work while recovery is unavailable prompts for confirmation. Recovery remains unencrypted, best-effort local storage—not a backup or secure erase.
- Opening or dropping multiple files now preserves successful opens and reports each failure by filename. Files remain subject to the 20 MiB limit and supported text encodings.
- Improved text contrast, keyboard focus indicators and suggestion readability in the dark and light themes.
- Added regression tests for settings/AI consent, recovery, mixed file-opening failures and selected contrast pairs. The Windows build workflow is configured to run browser UI tests as well as unit and Rust tests.
- Updated the development test runner to Vitest 4.1.12, removing the affected `tinypool` dependency and addressing reported Vitest/mocker advisories.

### Important limitations

- If saving settings fails, the current recovery preference may revert after restart; the app warns about this. Save and back up work separately.
- Browser UI tests simulate storage and picker failures. Native multi-file picker unit tests use mocks. The changes still require hands-on Windows/WebView2, real-AI, and full accessibility/security testing.
- Windows installers built by the workflow are unsigned and can trigger SmartScreen. An Actions artifact is not a signed release.

## 0.1.0

Initial open-source Windows preview: Tauri editor shell, CodeMirror editing and syntax coloring, local recovery, and optional Ollama inline suggestions.
