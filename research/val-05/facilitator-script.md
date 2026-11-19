# VAL-05 facilitator script

**Status:** template. No session has been run. Do not use this script until the approval table in the master protocol is signed.

## Before the session

1. Prepare a disposable Windows 10 or Windows 11 profile with a supported WebView2 runtime and the Wrytrove build under test.
2. Record build, Windows, WebView2, display scale, forced-colors state, keyboard layout and Narrator or NVDA version in a local environment log. Do not put a participant identifier in that log.
3. Copy the synthetic fixtures into a fresh disposable workspace and run `npm run study:check`.
4. Turn off product analytics and all optional provider connections. The study tools make no network calls. Do not enter a real provider key.
5. Assign the next session code, such as `S01`. Keep scheduling details separate.
6. Read the [consent script](consent-script.md). Stop if consent is not given.
7. Explain that the session is about the software, not the participant, and that they may pause or skip any task.

## How to observe

- Start timing when the task card is given; stop at completion, failure or withdrawal.
- Count an error as a wrong file, wrong target, missed save, unintended overwrite, lost focus, repeated wrong control, or an incorrect belief that changes behavior.
- Count hesitation as a pause of at least 3 seconds before the first meaningful action, or a visible reversal before committing.
- Give no hint before the first action. A neutral repeat of the task is `with_prompt`; step-by-step assistance is `with_facilitator_help`.
- After each task ask a neutral comprehension question, such as "What did the editor just do?" or "Which copy is now saved?" Do not teach the answer before recording the code.
- Use one finding code and one severity code per row. If the observation does not fit, use `OTHER_REDACTED` and write a synthetic reproduction later. Never paste a quote or document excerpt.
- Reset the disposable fixture copy between tasks. If personal text appears, stop, discard the copy and restart from the checksummed original.
- Run `npm run study:check` before leaving the session.

## Task cards

Use neutral wording. Do not explain the intended design before the task.

### T01 — First-run install and uninstall

**Setup:** disposable VM, installer under test, `fixtures/installer/synthetic-document.txt`.

**Say:** "Please install this preview, open the supplied document from the file manager, then uninstall the preview. Show me whether the supplied document is still there."

**Success:** installation launches, synthetic document opens, uninstall removes the app and leaves the document unchanged. Observe whether file ownership is clear. Record `INSTALL_UNINSTALL_UNCLEAR` if the participant worries that uninstall will remove their file.

### T02 — Open, edit, save and save-as

**Setup:** `fixtures/writer/chapter.md`.

**Say:** "Please open this document, make a small visible edit, save it, then save a second copy under a different name. Tell me which copy is saved when you finish."

**Success:** correct bytes in both destinations; no unintended overwrite; the participant distinguishes saved and unsaved state. Record `SAVED_UNSAVED_CONFUSION` where needed.

### T03 — External-change recovery

**Setup:** copy `fixtures/external-change/session.txt` into the disposable workspace. Keep `fixtures/external-change/external-v2.txt` ready outside the open tab.

**Say:** "Open this document and make an unsaved edit. I am going to change the copy on disk. Please save your work without losing either version."

**Facilitator action:** replace the on-disk copy with the second synthetic version, then wait for the app's focus or save check.

**Success:** the participant notices the conflict, can compare or keep the draft, and does not silently overwrite the newer disk copy. Record `EXTERNAL_CHANGE_CONFUSION` for an incorrect model of disk versus draft.

### T04 — Workspace search and source identification

**Setup:** `fixtures/developer/project/` as the selected workspace. Make one saved-file-only change if the build supports an unsaved-buffer distinction.

**Say:** "Please find the synthetic search term in this workspace, open the result and tell me whether it came from the saved file or an unsaved tab."

**Success:** the result opens at the expected location and the source is correctly identified. Record `SEARCH_SOURCE_UNCLEAR` if the participant assumes unsaved text was searched when it was not, or vice versa.

### T05 — Compare, review and undo

**Setup:** `fixtures/review/before.ts` and `fixtures/review/proposed.ts`.

**Say:** "Please compare this proposed replacement with the selected text, choose whether to apply it, then undo your last change."

**Success:** the participant reviews before applying, can reject or accept explicitly, and undo restores the prior editor state as one step. No automatic save or direct model mutation is allowed. Record `REVIEW_UNCLEAR` if accept, reject or undo is ambiguous.

### T06 — Note navigation

**Setup:** `fixtures/notes/` as the selected workspace.

**Say:** "Please use tags, links, backlinks and a daily note to find the related synthetic note. Tell me how you knew it was related."

**Success:** the participant reaches the intended note without guessing an ambiguous link. Record `NOTE_NAVIGATION_UNCLEAR` if backlinks, daily notes or broken-link states are misleading.

### T07 — Markdown preview

**Setup:** `fixtures/writer/preview.md`.

**Say:** "Please show the preview for this Markdown document and describe what happens to its link and image placeholders."

**Success:** preview is discoverable, follows bounded edits, and does not load a document-supplied resource. Record `PREVIEW_UNCLEAR` if inert placeholders surprise the participant in a way that blocks the task.

### T08 — Recovery and AI consent decision

**Setup:** `fixtures/privacy/recovery-choice.md` and `fixtures/privacy/ai-consent.md`.

**Say:** "Please decide whether you would enable recovery, then inspect the AI consent step and stop before any request is sent. Tell me what would leave this device and how you would cancel."

**Facilitator action:** use only the synthetic instruction in the fixture. Cancel before a provider request. Do not enter a real provider key and do not open a live provider.

**Success:** the participant can explain local recovery storage, session consent, destination, payload scope and cancellation without a live send. Record `RECOVERY_PRIVACY_UNCLEAR`, `AI_DESTINATION_UNCLEAR` or `AI_CONSENT_UNCLEAR` as applicable. A live provider test belongs to issue #68, not this task.

### T09 — Settings

**Setup:** `fixtures/settings/sample.txt`.

**Say:** "Please change one appearance or editor setting and then restore it. Use the keyboard if you can."

**Success:** the control has a usable name, the change is visible, focus returns predictably and restore works. Record `SETTINGS_UNCLEAR` or `UNLABELED_CONTROL` where needed.

### T10 — Keyboard-only core path

**Setup:** `fixtures/assistive-tech/keyboard-path.md`.

**Say:** "Without using a pointer, please open a tab, edit, save, search, open settings and return to the editor. Tell me if focus ever feels trapped."

**Success:** every control is reachable, focus order is logical, Escape or Close returns focus, and there is no trap. Record `FOCUS_TRAP`, `UNLABELED_CONTROL` or `STATUS_NOT_ANNOUNCED` as applicable.

### T11 — Narrator and NVDA identification

**Setup:** same fixture plus one dialog, one search result, one review action and one status message.

**Say:** "Using Narrator or NVDA, please identify the editor, active tab, dialog name, search result, review action and the current status message."

**Success:** names, roles, states, changes and errors are announced or otherwise available. Repeat with both screen readers across the pilot. Record `UNLABELED_CONTROL` or `STATUS_NOT_ANNOUNCED` for gaps; classify a core-path gap as `high` or `blocker`.

### T12 — Scaling, forced colors and minimum window

**Setup:** same core fixtures; rotate conditions across sessions: 100%, 150% and 200% scaling, forced colors, and 720×500 decorated window geometry.

**Say:** "Please repeat open, edit, save, search, preview and settings under this display condition. Tell me which state each control is in."

**Success:** controls remain visible and reachable; active, dirty and stale states are distinguishable without color alone; no clipping or overlap blocks a core task. Record `LAYOUT_CLIPPED` or `STATE_COLOR_ONLY` as applicable. Attach every condition finding to issue #56 using the aggregate appendix.

## Condition rotation

Each session should cover the persona's core tasks at baseline, then a subset of varied conditions. Across the pilot, all five display conditions and keyboard-only, Narrator and NVDA must be represented. Do not ask an assistive-technology participant to disclose a diagnosis; record the condition code only.

## Debrief and cleanup

1. Ask what was confusing, but do not write verbatim quotes; translate the answer to a finding code.
2. Confirm whether the participant wants any optional local recording deleted.
3. Delete personal scheduling details.
4. Validate local rows with `npm run study:check`.
5. Generate the aggregate and review it before any issue attachment.
6. Reset or discard the disposable VM. Never copy participant artifacts into the repository.
