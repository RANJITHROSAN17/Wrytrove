# VAL-03 — Independent security assessment commissioning brief

**Status: preparation only.** This is a proposed scope and evidence kit for [#67](https://github.com/RANJITHROSAN17/Wrytrove/issues/67), not a contract, authorization to test, threat-model report, penetration test, finding or executive summary. No independent reviewer has been engaged or assessment performed as part of this change. The issue remains open until its acceptance criteria are met. Static checks and internal tests are not substitutes for independent testing.

## Commissioning and pre-test gate

The maintainer must select and contract a reviewer independent of Wrytrove's implementation, agree funding, dates, deliverables and retest terms, and obtain written authorization **before any testing**. The reviewer must disclose relevant conflicts; the maintainer must resolve them or choose another reviewer. Record the agreement privately where needed, and publish only a sanitized scope and status. This brief is a proposal until both parties sign off; a material scope or version change requires renewed approval and a recorded deviation.

Fill in and approve the following run record before testing. Empty fields block the start; use “not applicable” with a reason rather than leaving a field blank. Do not commit credentials, private contact information or private paths.

| Required field | Record before testing |
| --- | --- |
| Authorizing maintainer and independent reviewer / organization; conflict declaration | Pending |
| Written authorization reference, agreed start/end UTC, escalation and stop contacts | Pending (private reference) |
| Exact source commit, release/build version and installer SHA-256; source/build provenance | Pending; select the actual target, not just a version label |
| Windows build(s), WebView2, Tauri and dependency versions / lockfiles; tooling and configurations | Pending |
| Disposable machines, user profiles and sandbox roots; synthetic fixture inventory and outside-scope canaries | Pending |
| Test accounts and credential ownership, privileges, issuance, permitted destinations, expiry and revocation | Pending; synthetic/test credentials only |
| Approved endpoints, network isolation/mock strategy, test methods, limits and schedule | Pending |
| In-scope cases, exclusions, assumptions, known limitations and agreed deviations | Pending |
| Evidence storage/access, retention and deletion date, reporting channel, disclosure and retest terms | Pending |
| Maintainer and reviewer sign-off and date | Pending |

Use disposable Windows environments and synthetic documents, paths and canary secrets only. Never request or retain the maintainer's real Arena key or user documents. Use a reviewer-controlled mock transport/service for hostile responses and redirects; a live provider account or endpoint requires separate explicit authorization, provider permission, test credentials and spending/rate limits. Do not test third-party infrastructure, real users, production data or unrelated systems under this brief. If an actual secret or real document is encountered, stop the affected test, privately notify the maintainer, and agree containment/deletion; do not copy it into evidence.

## Proposed threat model

Assets include document bytes and integrity, unsaved recovery text and paths, filesystem access grants, API keys, selected text and model output, application identity and installer provenance. Trust boundaries include untrusted files/Markdown and model responses entering the webview; webview-to-native IPC; user-selected filesystem scope and OS handles; local profile storage; app-to-loopback and cloud-provider requests; and build-to-distribution artifacts.

Consider a malicious document or model response, a hostile local endpoint, a local actor able to manipulate paths within an explicitly authorized disposable test environment, and a network attacker where relevant. State the actor's access and prerequisites for each finding. A fully compromised OS/user profile, physical attacks, provider internals, upstream services and infrastructure, and denial-of-service against external systems are excluded unless separately authorized. An upstream defect that affects Wrytrove should still be reported privately to the maintainer for coordination with upstream. Local same-user attacks are not assumed to be prevented by recovery encryption or other controls; distinguish observed exposure from a broken stated boundary.

## Proposed test coverage and evidence

For each case, record configuration, entry point, actor and privileges, steps, expected boundary, actual result, impact, sanitized evidence and result (pass / fail / blocked / not tested). Capture hashes of synthetic canaries before and after destructive file tests. An untested or blocked case is not a pass. The reviewer should expand these starting points as their threat model requires.

| ID | Area and minimum questions | Starting points |
| --- | --- | --- |
| T01 | Capabilities, IPC and origin: can untrusted content navigate or invoke native commands, bypass CSP, or obtain permissions intended only for the bundled main webview? Exercise redirects and deceptive origins in a controlled environment. | `src-tauri/capabilities/`, `src-tauri/tauri.conf.json`, `src-tauri/src/lib.rs` |
| T02 | Paths: test canonicalization, scope containment, symlinks, Windows junctions/reparse points and parent swaps/TOCTOU. Verify outside-scope canaries and describe race prerequisites and repeatability. | `src-tauri/src/lib.rs`, `src-tauri/src/access_revocation.rs`, [Windows matrix](VALIDATION-MATRIX-VAL-02.md) |
| T03 | Native I/O: test read/write bounds, stale hash preconditions, concurrent modification, temporary replacement, interrupted operations and metadata/ACL behavior. Distinguish observed outcomes from crash/power-loss guarantees. | `src-tauri/src/lib.rs`, `src-tauri/src/large_file.rs` |
| T04 | Recovery and secrets: inspect IndexedDB/localStorage, persisted grants, key lifetime, deletion and residual data using synthetic canaries, including restarts and relevant settings. State what was inspected and what cannot be inferred about physical erasure. | `src/storage.ts`, `src/recovery-journal-store.ts`, `src/journal-key.ts`, `src/access-leases.ts` |
| T05 | Markdown: test parser/worker limits, DOM construction, links, images and resource loading with hostile synthetic input; look for script, navigation and resource escapes. | `src/markdown-render.ts`, `src/markdown.worker.ts`, `src/markdown-preview.ts` |
| T06 | AI egress: inspect consent, payloads, bounds, redirects, error and oversized responses, prompt injection, and leakage of canary text/keys to unintended destinations. Use controlled mocks; do not infer real provider behavior from a mock. | `src/ai.ts`, `src/arena.ts`, `src/bounded-json.ts`, `src/sensitive-text.ts` |
| T07 | Distribution: assess the actual installer, signature status, update path if any, artifact hashes/provenance and dependency/supply-chain exposure. Distinguish configuration review from tested release artifacts and upstream audits. | `docs/RELEASE-VERIFICATION.md`, `.github/workflows/windows.yml`, lockfiles |

## Findings, fixes and retest

Send the full report privately through the agreed channel; do not attach exploit details to public issues before coordinated disclosure. Each finding must include: ID and title; severity and rationale (prefer CVSS version/vector plus contextual impact, or explain an alternative); exploitability, attacker prerequisites and trust boundary; affected commit/build/version and code path; reproducible steps and observed versus expected behavior; sanitized evidence or private evidence reference; impact, limitations and remediation recommendation. Record negative, blocked and excluded tests as well. The reviewer and maintainer should agree severity or record disagreement.

For **each critical or high finding**, create a linked fix issue or private advisory/draft as appropriate. Keep exploit-enabling details private until disclosure is agreed; link the private record to a sanitized public tracking issue when safe. Record fix commit and build, then have the independent reviewer retest the original reproduction and relevant regressions against that exact build. Record date, environment, evidence reference and outcome (fixed, partially fixed, still reproducible or blocked); reopen or track residual risk when not fixed. A merged fix alone is not a retest. Map related work where applicable to [#46](https://github.com/RANJITHROSAN17/Wrytrove/issues/46), [#48](https://github.com/RANJITHROSAN17/Wrytrove/issues/48), [#49](https://github.com/RANJITHROSAN17/Wrytrove/issues/49) and [#54](https://github.com/RANJITHROSAN17/Wrytrove/issues/54); do not assume they cover every finding.

## Completion and publication gate

Before calling #67 complete, the maintainer and reviewer must confirm the pre-test record was approved, the full report is complete, every critical/high finding has its linked fix and retest result, and the [security policy](../SECURITY.md) accurately states coordinated disclosure and assessment limitations. Publish a **redacted executive summary after completion** with reviewer attribution/independence, dates, tested versions/build hashes, scope and exclusions, methods and limitations, severity counts, remediation and retest status, and remaining risks. Do not publish secrets, private paths, private evidence, exploit-enabling credentials or uncoordinated exploit details. Human-review the summary and obtain agreement from the reviewer and maintainer before publication. The full report may remain private. Do not claim the product is “secure” or “penetration-tested” before the report is complete; even afterward, describe only the actual scope and dates rather than implying a guarantee.
