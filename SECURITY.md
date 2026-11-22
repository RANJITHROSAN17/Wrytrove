# Security policy

## Reporting a vulnerability

**Do not open a public issue.** Use GitHub's private reporting:
[Security → Report a vulnerability](https://github.com/RANJITHROSAN17/Wrytrove/security/advisories/new).

Include what you did, what happened, and the version (`package.json`) plus your Windows build.
A proof of concept helps; a screenshot is enough to start. Use synthetic files and test credentials;
do not send real API keys, user documents or other secrets. If private reporting is unavailable,
do not post exploit details publicly; wait until a private channel is agreed with the maintainer.

Expect an acknowledgement within **72 hours**. Wrytrove is a single-maintainer preview project
with no security team and no bug bounty — that is stated plainly so nobody waits for a reward
that does not exist.

## Coordinated disclosure

The maintainer will triage reports privately, discuss impact and remediation with the reporter,
and coordinate fixes and retesting as appropriate. Please allow time for investigation and agree
on the timing and content of any public advisory together; there is no guaranteed fix or disclosure
deadline. If a dependency or provider is affected, the maintainer and reporter should coordinate
with its security team without sharing sensitive details publicly. A public advisory or tracking
issue should omit secrets, private paths and exploit-enabling details until disclosure is agreed.

## What is in scope

| Area | Why it matters |
| --- | --- |
| Native file access (`src-tauri/`) | bounded reads, symlink/reparse-point handling, folder scope |
| Tauri IPC permissions | the capability allowlist and remote-navigation denial |
| `src/arena.ts` | the optional API-key panel: key handling, request validation, confirmation |
| `src/sensitive-text.ts` | the credential-shape warning. Fallible by design — a *silent* miss is the bug, not an imperfect match |
| `src/bounded-json.ts` | size/parse bounds on Ollama and provider responses |
| Session recovery (`src/storage.ts`) and draft journal (`src/recovery-journal-store.ts`) | unencrypted local storage of document contents and unsaved drafts |

Out of scope for routine reports: the unsigned installer triggering SmartScreen by itself
(documented, expected), attacks requiring an already-compromised machine, and vulnerabilities
in CodeMirror, Tauri or model providers themselves. Report upstream defects to their owners;
if they affect Wrytrove, also notify the maintainer privately so remediation can be coordinated.
These reporting boundaries are not permission to test third-party systems.

## Independent assessment status and limitations

No independent penetration assessment has been completed. The [proposed commissioning brief](docs/INDEPENDENT-SECURITY-ASSESSMENT-VAL-03.md)
describes the intended scope and exclusions, but is not an executed assessment or authorization to
test. In particular, provider infrastructure and internals, real user data, physical attacks and
fully compromised machines are not covered by that proposal. The actual assessment, its versions,
methods, exclusions and remaining risks must be agreed and reported before any assessment claim.
Static checks and automated tests do not establish that the product is secure.

## What the project already admits

This section exists because a security policy that overstates its coverage is worse than none.

- **No complete security audit has been performed.** `docs/IMPLEMENTATION-0.4.0.md` says so, and
  the README repeats it next to the download.
- **The command screen and secret warning are heuristics.** They are not sandboxes or redaction.
- **Session recovery is unencrypted.** The README says it is "**not** a backup"; it is also not
  private from anyone with access to your user profile. Unsaved text is kept in a local draft journal
  as well as the session snapshot. Encryption of drafts exists in the code but is not yet enabled, because
  no OS-protected key provider is wired in.
- **Folder access can outlive the view.** Tauri's persisted scope may retain access after a
  folder is closed or the app restarts.
- **Parent-path races remain.** Bounded no-follow reads reject direct links and reparse points;
  they do not close every time-of-check/time-of-use window.

## Supported versions

Only the current preview line receives fixes. There are no long-term support branches; see
`CHANGELOG.md` for what changed and `docs/IMPLEMENTATION-0.4.0.md#verification-and-limits` for
what remains unverified on consumer Windows.
