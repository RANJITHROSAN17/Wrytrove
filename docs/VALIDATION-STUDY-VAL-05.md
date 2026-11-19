# VAL-05 — User interviews, task study and assistive-technology validation

**Issue:** #69
**Status:** pre-recruitment kit; maintainer v0.1 sign-off recorded; **no sessions have been run and no product decision has been changed**
**Prepared:** 19 November 2026 UTC
**Source:** release-readiness follow-up from the 2026-11 architectural audit

This is the execution protocol for issue #69. It is a **template and evidence toolkit**, not a completed user study. The architectural audit inferred priorities from source, documentation and competitor behavior. It did not observe users. This protocol exists so that a future pilot can test the proposed wedge — portable files, low ceremony, safe recovery and reviewable AI — without collecting participant documents, paths, prompts, voice recordings or personal identifiers.

## 1. What this change provides

- [Participant-facing consent script](../research/val-05/consent-script.md)
- [Privacy and data-minimization plan](../research/val-05/privacy-plan.md)
- [Synthetic fixture set with checksum manifest](../research/val-05/fixtures/README.md)
- [Anonymized observation template](../research/val-05/observation-template.csv) and [controlled codebook](../research/val-05/observation-codebook.json)
- [Facilitator script and task matrix](../research/val-05/facilitator-script.md)
- [Assistive-technology findings template for issue #56](../research/val-05/a11y-findings-template.md)
- [Pre-registered product decision ledger](../research/val-05/decision-ledger.md)
- [Pilot-size record](../research/val-05/pilot-size-record.md)
- `npm run study:check`: verifies fixture checksums, scans study artifacts for prohibited data, rejects media files and validates local coded rows.
- `npm run study:aggregate`: converts local coded rows into an aggregate summary by persona, condition and pre-registered decision. It refuses to infer any product decision until evidence coverage is met.

The guard is a safety net, not a proof of anonymity. A human must still review any report before it is attached to an issue. No real interview, observation, screen recording, voice recording, participant path, participant document, participant prompt or personal identifier is present in this repository.

## 2. Approval gate before recruiting

The project maintainer approved version 0.1 on 19 November 2026 UTC. Where local human-subjects review, institutional review, privacy review or legal review applies, obtain that separately before recruiting. CI success is not ethical approval, and this sign-off does not replace a separate reviewer where one is required.

| Artifact | Version | Reviewer | Decision | Date |
|---|---|---|---|---|
| Consent script | 0.1 | Project maintainer (Arena session) | Approved v0.1 | 19 November 2026 UTC |
| Synthetic fixtures and checksums | 0.1 | Project maintainer (Arena session) | Approved v0.1 | 19 November 2026 UTC |
| Privacy plan | 0.1 | Project maintainer (Arena session) | Approved v0.1 | 19 November 2026 UTC |
| Anonymized observation template and codebook | 0.1 | Project maintainer (Arena session) | Approved v0.1 | 19 November 2026 UTC |
| Facilitator and assistive-technology scripts | 0.1 | Project maintainer (Arena session) | Approved v0.1 | 19 November 2026 UTC |

If any artifact changes after approval, increment its version and repeat sign-off. Keep approval evidence outside the participant record. Do not recruit from a public issue thread with personal details; a separate scheduling channel must be used and deleted after scheduling.

## 3. Research questions

1. Can representative Windows users understand that files remain ordinary, portable files and that recovery is not a backup?
2. Is low-ceremony open, edit and save discoverable without turning safety controls into obstacles?
3. Can users distinguish disk content, unsaved editor content, external changes and recovery drafts?
4. Is review-before-apply understandable for AI or pasted replacements?
5. Can users understand when AI is off, when consent would be required, and what destination a request would use?
6. Do keyboard-only, Narrator, NVDA, 200% scaling, forced-colors and minimum-window conditions expose release-blocking barriers?

These are learning questions, not a claim of statistical representativeness. A small pilot can invalidate a hypothesis or find a severe barrier; it cannot prove conformance or broad market demand.

## 4. Participants and pilot size

Recruit at least five sessions, with at least one participant in each workflow:

| Persona code | Workflow | Required perspective |
|---|---|---|
| `writer` | Markdown, focus and typewriter modes | Writes prose and cares about calm reading and preview |
| `developer` | Code editing and workspace search | Makes quick edits and expects predictable search |
| `note_taker` | Tags, wikilinks, backlinks and daily notes | Navigates a plain-file note collection |
| `privacy_sensitive` | Recovery and AI decisions | Wants to understand local storage, consent and data flow |
| `assistive_tech` | Keyboard-only, Narrator or NVDA | Navigates without relying on sight, color or a pointer |

One person may cover more than one workflow, but coverage must still be recorded by persona code. Do not record diagnosis, age, contact details or other identifying attributes in the observation file. Assistive-technology version and Windows build belong in a separate environment log with no participant identifier.

Zero sessions were run while preparing this kit: a code sandbox has no consent authority, recruited participants, consumer Windows desktop, Narrator/NVDA session or observer. A smaller pilot may only be proposed with the documented reason, mitigation and sign-off in the [pilot-size record](../research/val-05/pilot-size-record.md). The issue remains open until sessions are completed or that exception is approved and the evidence is attached.

## 5. Environment and repeatability

Run on a disposable Windows 10 or Windows 11 profile with a current supported WebView2 runtime. Record the Wrytrove build, Windows build, WebView2 version, display scale, forced-colors state, window geometry, Narrator or NVDA version and keyboard layout in a local environment log.

Before each session:

1. Copy the [synthetic fixtures](../research/val-05/fixtures/README.md) into a fresh disposable workspace.
2. Run `npm run study:check`.
3. Disable product analytics; the study tools make no network calls.
4. Do not enter a real provider key. Do not connect a live provider for this study.
5. Use a session code such as `S01`; keep any recruitment or scheduling details separate.
6. Read the [consent script](../research/val-05/consent-script.md) and stop immediately if consent is not given.

Reset fixtures between tasks. If a participant starts typing personal text, stop, discard the disposable copy and restart from the checksummed original. No participant's own files may be opened.

## 6. Task matrix

The [facilitator script](../research/val-05/facilitator-script.md) contains neutral wording, exact setup and success criteria. Every task uses synthetic fixtures only.

| ID | Task | Primary personas | Related issues |
|---|---|---|---|
| T01 | First-run install, open a synthetic document and uninstall without changing that document | all | #46 |
| T02 | Open, edit, save and save-as; explain saved versus unsaved state | writer, developer | #49 |
| T03 | Detect an external disk change, compare the draft and avoid silent overwrite | privacy_sensitive, developer | #47, #49 |
| T04 | Search a workspace, identify whether a result comes from disk or an unsaved buffer, and open it | developer | #50 |
| T05 | Review a synthetic replacement, accept or reject it, then undo an accepted change | developer, writer | #52 |
| T06 | Navigate tags, wikilinks, backlinks and a daily note | note_taker | #57 |
| T07 | Use bounded Markdown preview and describe inert link and image behavior | writer, note_taker | #59 |
| T08 | Decide whether to enable recovery or AI; inspect consent and destination, then cancel before any send | privacy_sensitive | #54, #68 |
| T09 | Change a setting and restore it using the keyboard | all | #62 |
| T10 | Repeat the core path with keyboard only; verify focus order, focus return and no trap | assistive_tech, all | #56 |
| T11 | Identify editor, tabs, dialogs, search results, review actions and status messages with Narrator and NVDA | assistive_tech | #56 |
| T12 | Repeat essential tasks at 100%, 150% and 200% scaling, forced colors and the minimum supported window size | assistive_tech, all | #56, #62 |

Minimum supported window geometry is 720×500 for a decorated Windows window; the existing automated browser check uses a narrower webview box to allow for chrome. At 200% scaling and in forced colors, active, dirty and stale states must remain distinguishable without relying on color alone. Automated DOM checks are useful regression evidence but are not a substitute for these sessions.

## 7. Observation and analysis

Use only the [header-only observation template](../research/val-05/observation-template.csv) and the [codebook](../research/val-05/observation-codebook.json). Each row contains a session code, persona code, task ID, condition codes, completion code, time, counts, comprehension code, severity code and one finding code. There are no free-text columns, no verbatim quotes and no document excerpts.

Local rows belong in `research/val-05/records/`, which is ignored by Git except for its README. After each session, run `npm run study:check`. The guard rejects extra columns, unknown codes, malformed rows, absolute or personal paths, contact-like strings, credential-like strings, media files, fixture text pasted into records, and other prohibited artifacts. It cannot detect every possible name in prose; human review remains mandatory.

Generate the aggregate with:

```sh
npm run study:aggregate research/val-05/records/observations.csv
```

The output contains only counts, medians, controlled codes and pre-registered decision recommendations. With insufficient coverage every decision stays `insufficient_evidence`; the tool will not fabricate a changed, confirmed or rejected product decision. It also produces an accessibility appendix routed to issue #56. Attach only the human-reviewed aggregate and appendix to issues. Never attach local rows or recordings.

## 8. Pre-registered decisions

The [decision ledger](../research/val-05/decision-ledger.md) defines six candidate decisions and the evidence rules for changing, confirming or explicitly rejecting each one. At least three evidence-backed decisions are required by #69. Coverage requires at least five distinct sessions, all five personas, every required display and assistive condition, and every core task. Otherwise the ledger remains pending.

A severe accessibility barrier is not averaged away. Any `high` or `blocker` finding in keyboard-only, Narrator, NVDA, 200% scaling, forced-colors or minimum-window conditions must be written up with a synthetic reproduction and attached to issue #56, with an explicit owner and release decision.

## 9. Definition of Done mapping

| #69 acceptance criterion | State after this change |
|---|---|
| Consent script, synthetic fixtures, privacy plan and anonymized observation template approved before recruiting | **Maintainer v0.1 approval recorded.** Any applicable local human-subjects, privacy or legal review remains separate. No recruiting has occurred. |
| At least five sessions or a documented reason for a smaller pilot completed | **Not complete.** Zero sessions; reason and exception template recorded. |
| Core task success, time, errors and qualitative findings summarized by persona | **Tool ready; no data.** Aggregator refuses to summarize from uncontrolled text. |
| Narrator/NVDA, keyboard-only, 200% scaling and forced-colors findings attached to #56 | **Template ready; no findings.** No manual AT session has been run. |
| At least three product decisions changed, confirmed or explicitly rejected based on evidence | **Ledger ready; no decisions made.** Coverage gate returns insufficient evidence. |
| No participant document, path, prompt, voice recording or personal identifier committed or sent to telemetry | **Guard and ignored-record boundary in place; no sessions to leak.** Human review still required before publishing any report. |

**Do not close issue #69 because this protocol exists.** Close it only when approval, sessions or a signed pilot exception, persona summaries, AT findings and evidence-backed decisions are attached, and `npm run study:check` remains clean.
