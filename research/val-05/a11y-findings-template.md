# Assistive-technology findings appendix for issue #56

**Status:** no sessions have been run; **no findings are attached yet**. This is an issue-ready template, not evidence of accessibility conformance.

Attach only the reviewed output from `npm run study:aggregate` and this appendix. Do not attach local rows, recordings, screenshots or participant paths. Every reproduction must use the checksummed synthetic fixtures and app steps; never quote a participant.

## Required condition coverage

| Condition | Code | Required evidence |
|---|---|---|
| 100% scaling | `scale_100` | Core task baseline |
| 150% scaling | `scale_150` | Core task repeat |
| 200% scaling | `scale_200` | Core task repeat, clipping and reflow check |
| Forced colors | `forced_colors` | Non-color state cues and visible focus |
| Minimum window | `min_window` | 720×500 decorated geometry reachability |
| Keyboard only | `keyboard_only` | Focus order, focus return and no trap |
| Windows Narrator | `narrator` | Names, roles, states and announcements |
| NVDA | `nvda` | Names, roles, states and announcements |

## Findings table

| ID | Condition | Assistive technology | Task | Finding code | Severity | Count | Synthetic reproduction | Owner | Release blocker | Route |
|---|---|---|---|---|---|---:|---|---|---|---|
| _none_ | _none_ | _none_ | _none_ | _none_ | none | 0 | _no session yet_ | _pending_ | _pending_ | #56 |

For each real finding, replace the placeholder row with one aggregate row from the report. Add a short reproduction using only fixture names and app actions. Classify a `high` or `blocker` finding as a release blocker unless a maintainer records an explicit, dated decision otherwise. Link related keyboard or localization findings to issue #62 rather than duplicating issue #42.

## Publication checklist

- [ ] At least five sessions or an approved smaller-pilot record exists.
- [ ] Narrator, NVDA, keyboard-only, 200% scaling and forced-colors conditions are represented.
- [ ] `npm run study:check` is clean.
- [ ] The report contains only counts, medians and controlled codes.
- [ ] A human has reviewed the appendix for context risks.
- [ ] Critical findings have an owner and an explicit release decision.
- [ ] No participant document, personal path, prompt, voice recording or personal identifier is attached.
