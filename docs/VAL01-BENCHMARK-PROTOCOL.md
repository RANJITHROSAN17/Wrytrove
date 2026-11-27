# VAL-01 Competitor & Morrow Benchmark Protocol

This protocol defines the repeatable, synthetic-only benchmark matrix for Wrytrove and reference editors (VS Code, Zed, Notepad++, MarkText, Joplin) on supported Windows hardware.

## Rules

1. **No unpaired claims**: Never compare products across different hardware, OS builds, or warm/cold states.
2. **20 MiB boundary**: Workloads above Wrytrove's 20 MiB editor limit (100 MiB, 500 MiB) must be labeled `unsupported` / `degraded-mode` rather than omitted.
3. **Synthetic fixtures only**: Use `scripts/val01-benchmark-fixtures.mjs` to generate identical UTF-8 inputs and record their SHA-256 checksums.

## Workload Matrix

- Cold start to interactive and first keystroke
- Open 1 MiB, 5 MiB, 20 MiB (supported) and 100 MiB, 500 MiB (unsupported/degraded-mode) UTF-8 fixtures
- Tab switch, scrolling, typing latency, Markdown preview update, search, replace preview, save, and close
- 5,000-file workspace Quick Open / search
- Idle and active private working set, CPU, and disk activity
- Median and p95 latencies across >= 5 runs per cell
