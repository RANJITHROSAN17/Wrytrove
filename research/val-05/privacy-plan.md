# VAL-05 privacy and data-minimization plan

## Principle

Collect the minimum needed to answer the research questions. Observe **behavior and coded outcomes**, not people or their documents. No participant document, personal path, participant prompt, voice recording or personal identifier may be committed or sent to telemetry. The study tools have no network calls and no analytics.

## Data inventory

| Class | Location | Contents | Commit policy |
|---|---|---|---|
| Protocol artifacts | This directory and the master protocol | Scripts, codebook, templates, decision rules | Reviewed and committed; no participant data |
| Synthetic fixtures | `fixtures/` | Invented text, code and notes plus a checksum manifest | Reviewed and committed; no real user content |
| Coded observations | `records/` | Session code, persona code, task ID, condition codes, completion, time, counts, comprehension, severity and one finding code | Local only; ignored by Git except the README |
| Environment log | Local facilitator device | Build, Windows, WebView2, display scale, forced-colors state, keyboard layout, Narrator or NVDA version | Local only; no participant identifier; no issue attachment |
| Facilitator working notes | Local facilitator device | Controlled codes only; no verbatim quotes | Delete after translation to coded rows |
| Optional recordings | Local facilitator device | Screen or voice recording only with separate explicit consent | Never committed; delete after analysis or on request |
| Aggregate report | Generated locally | Counts, medians, controlled codes and decision recommendations | Human review required before attaching to #69 or #56 |

## Prohibited in any committed or shared artifact

- participant names, contact details, account names, handles or other personal identifiers;
- real user documents, document excerpts, personal paths, file listings, prompts or model responses;
- provider keys, credential-like strings or authentication material;
- screen recordings, voice recordings, audio or video files, unredacted screenshots;
- free-text quotes, verbatim participant comments or unstructured narrative that could identify someone;
- telemetry, analytics events, hidden network requests or automatic issue uploads.

The [observation template](observation-template.csv) has no free-text column. The [codebook](observation-codebook.json) is the only vocabulary allowed in local rows. If an observation does not fit a code, use `OTHER_REDACTED` and write a separate bug with a **synthetic reproduction**; do not paste what the participant said or typed.

## Collection and storage

1. Assign a session code such as `S01`. Keep recruitment or scheduling details in a separate channel and delete them after scheduling.
2. Copy checksummed synthetic fixtures into a disposable workspace. Never open a participant's files.
3. Record one coded row per task and condition using the header-only template.
4. Keep local rows in `records/`, which Git ignores except for its README.
5. Run `npm run study:check` after each session and before any report is shared.
6. Generate an aggregate with `npm run study:aggregate`. Review it manually for context risks that a scanner cannot detect.
7. Attach only the reviewed aggregate and the [accessibility appendix template](a11y-findings-template.md) output to issues.

## Retention and deletion

- Delete optional recordings after analysis or immediately on request, whichever comes first.
- Delete facilitator working notes once coded rows are validated.
- Delete local coded rows after the aggregate report is approved, or within 90 days, whichever comes first.
- Keep only the aggregate report, decision ledger updates and synthetic reproductions. These contain no participant artifacts.
- If consent is withdrawn, stop the session and delete that session's local rows and any optional recording.

## Commit and review gate

`npm run study:check` verifies fixture checksums; rejects unexpected binary, image, audio and video artifacts; scans study text for contact-like strings, absolute or personal paths, web addresses, credential-like strings and embedded media; validates any local CSV against the exact schema; and detects fixture text pasted into records. The CI workflow runs the same check on committed artifacts.

The scanner is **not** a guarantee that prose contains no names. Before publishing a report, a human must confirm that it contains only aggregates and controlled codes. A smaller pilot needs the [pilot-size record](pilot-size-record.md) approved before recruiting.

## Breach response

If prohibited data appears in a row, report, screenshot or recording:

1. Stop the session and do not copy the artifact elsewhere.
2. Delete the local artifact and any derived recording.
3. Tell the participant what happened and honor any withdrawal request.
4. Notify the maintainer through a private channel; do not paste the data into a public issue.
5. Record a synthetic, content-free lesson in the protocol and add a regression case to the guard if needed.

## Approval

| Role | Name or team | Decision | Date |
|---|---|---|---|
| Maintainer | Project maintainer (Arena session) | Approved v0.1 | 19 November 2026 UTC |
| Privacy reviewer | _separate reviewer where required_ | _pending_ | _pending_ |
| Human-subjects or legal review, where applicable | _separate reviewer where required_ | _pending_ | _pending_ |

Maintainer approval is for version 0.1 only and does not replace a separate privacy, human-subjects or legal review where that is required. A changed consent script, fixture set or observation schema requires a new version and a new sign-off.
