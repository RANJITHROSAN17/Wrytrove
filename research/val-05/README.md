# VAL-05 study kit

This directory is the pre-recruitment kit for issue #69. It contains **no participant data** and no completed sessions. Read [the master protocol](../../docs/VALIDATION-STUDY-VAL-05.md) first.

## Status

- Protocol version: 0.1
- Maintainer approval: v0.1 approved on 19 November 2026 UTC; any applicable local human-subjects, privacy or legal review remains separate
- Recruiting: not performed in this environment
- Sessions completed: zero
- Product decisions changed, confirmed or rejected: zero
- Telemetry: none; the tools in this kit make no network calls

## Files

| File | Purpose |
|---|---|
| [consent-script.md](consent-script.md) | Plain-language script read before any task |
| [privacy-plan.md](privacy-plan.md) | Data inventory, retention, commit gate and breach response |
| [facilitator-script.md](facilitator-script.md) | Session flow, neutral task wording and condition rotation |
| [observation-template.csv](observation-template.csv) | Header-only, coded row template; no free text |
| [observation-codebook.json](observation-codebook.json) | Allowed codes, task IDs and severity definitions |
| [a11y-findings-template.md](a11y-findings-template.md) | Issue-ready appendix for #56, with no findings yet |
| [decision-ledger.md](decision-ledger.md) | Six pre-registered decisions and evidence rules |
| [pilot-size-record.md](pilot-size-record.md) | Reason for zero sessions and exception template |
| [fixtures/](fixtures/README.md) | Synthetic, checksummed files for every workflow |
| [records/](records/README.md) | Local-only, Git-ignored coded observations |

## Commands

From the repository root:

```sh
npm run study:check
npm run study:aggregate research/val-05/records/observations.csv
node scripts/validation/study-evidence.mjs fixtures research/val-05 --write
```

The first command verifies fixture checksums, scans every study artifact, rejects media files and validates any local coded rows. The second prints an aggregate report; redirect it to a local file only after human review. The third regenerates the fixture manifest **only** when a maintainer intentionally changes a synthetic fixture.

Never place a real document, personal path, participant prompt, voice recording, screenshot or personal identifier in this directory. Local records are ignored by Git except for their README. Attach only a reviewed aggregate to an issue.
