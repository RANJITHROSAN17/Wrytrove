# VAL-05 pre-registered product decision ledger

**Status:** awaiting evidence. **No decision has been changed, confirmed or explicitly rejected.** The aggregator returns `insufficient_evidence` for every row until at least five distinct sessions, all five personas, all required display and assistive conditions, and all core tasks are present.

Pre-registering the rules prevents a small pilot from being reinterpreted after the fact. Each outcome below is a recommendation for maintainer sign-off, not an automatic code change. A severe accessibility barrier is not averaged away.

| ID | Candidate decision | Evidence rule | Possible outcomes | Route | Current status |
|---|---|---|---|---|---|
| D1 | Keep saved-file search explicit and label disk versus unsaved sources before expanding search | At least 80% independent completion on T04 with fewer than two source-confusion signals confirms the explicit label; repeated confusion changes the priority and wording for unified search | `confirm`, `change` | #50 | pending |
| D2 | Keep review-first compare, explicit accept or reject, and one-step undo as the gate for replacements | At least 80% independent completion on T05 with fewer than two unclear or failed signals confirms the gate; repeated confusion changes the review controls before wider compare work | `confirm`, `change` | #52 | pending |
| D3 | Keep AI off by default and require destination, payload and cancellation to be understandable before any send | At least 80% independent completion on T08 with fewer than two comprehension signals confirms the consent design; repeated confusion changes wording or preflight behavior | `confirm`, `change` | #54, #68 | pending |
| D4 | Treat keyboard-only, Narrator, NVDA, 200% scaling, forced-colors and minimum-window barriers as release gates | Any high or blocker finding, focus trap, missing name, color-only state, clipping or missing announcement changes the release decision; otherwise strong independent completion confirms the protocol, not conformance | `confirm`, `change` | #56, #62 | pending |
| D5 | Do not add default product analytics to understand routine editing | At least 80% independent completion across core tasks without telemetry explicitly rejects adding default analytics for this release; otherwise the question remains open | `reject`, `insufficient_evidence` | #69 | pending |
| D6 | Keep first-run installation and uninstall low-ceremony while leaving ordinary files untouched | At least 80% independent completion on T01 with no install or uninstall confusion confirms the portable-file onboarding wedge; otherwise change the installer guidance or ownership wording | `confirm`, `change` | #46 | pending |

## After sessions

1. Run `npm run study:check`.
2. Run `npm run study:aggregate` and review the output.
3. Copy at least three evidence-backed outcomes into this ledger with session count, relevant task rates, finding codes and a dated maintainer decision.
4. Attach the aggregate to issue #69 and the accessibility appendix to issue #56.
5. Open or update the routed implementation issue with a synthetic reproduction for every changed decision.
6. Leave any outcome that lacks evidence as `insufficient_evidence`; do not close #69 on a plan alone.

## Sign-off

| Decision | Evidence summary | Maintainer decision | Date |
|---|---|---|---|
| D1 | _pending_ | _pending_ | _pending_ |
| D2 | _pending_ | _pending_ | _pending_ |
| D3 | _pending_ | _pending_ | _pending_ |
| D4 | _pending_ | _pending_ | _pending_ |
| D5 | _pending_ | _pending_ | _pending_ |
| D6 | _pending_ | _pending_ | _pending_ |
