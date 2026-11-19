# Large-file validation (AUD-06 / #51)

## Boundaries

The native viewer reopens authorized regular files and reads a bounded range from one file descriptor per call. It does not map a file that an external process might truncate, retain an open descriptor after close, or change the ordinary editor's save limit. Native ranges are at most 256 KiB, and the UI queues them one at a time; visible windows are 32 KiB plus up to three UTF-8 lookahead bytes. The 1 GiB limit is checked before offering to load the first window and when reading ranges. Reads recheck Wrytrove's native scope and revocation record, and reject a different size or metadata fingerprint. This is best-effort change detection, not a snapshot or a defense against a local process able to manipulate the file or its parent directories concurrently.

Edit mode keeps its 20 MiB hard cap. If Chromium exposes a valid heap measurement, the editable cutoff can drop to one twelfth of the reported available heap (six times input bytes for in-memory representations, with half the headroom reserved). This is a conservative policy, not a commitment about WebView heap use. Devices without a usable measurement keep the existing cap. The viewer does not depend on this measurement for its bounded allocations.

Only whole LF/CRLF-delimited lines up to 256 KiB are searched; regexes cannot match across LF. The worker has a 1.5-second budget per request, the overall search has a two-minute budget, and results are capped at 200. A cancelled IPC read can finish in the background, but its result is discarded and no further chunks are scheduled for that search. No partial scan is reported as complete. Closing drops the viewer's text, query, and results. Export is an explicit action.

## Reproduce the portable measurements

Run `npm ci` and `npm run benchmark:large-file`. The harness creates exact 100 MiB and 500 MiB UTF-8 logs under the system temporary directory, with a single match in the last line. Each size runs in a fresh Node process, reads and decodes the first window, scans to EOF using the production search core in a worker, and measures worker termination after one delivered chunk on a separate scan. It records process peak RSS (including Node, TypeScript setup and worker overhead) and deletes the fixtures. Newly created files are likely cached; these are not cold-disk or desktop UI timings.

Example run, Linux x64 sandbox, Node 22.22.3 (one run per size):

| Fixture | First window | Full literal scan | Worker termination | Baseline / peak RSS |
| --- | ---: | ---: | ---: | ---: |
| 100 MiB | 1.08 ms | 761 ms | 1.25 ms | 118.9 / 134.1 MiB |
| 500 MiB | 1.17 ms | 3,630 ms | 1.44 ms | 122.7 / 140.3 MiB |

Playwright covers the viewer and real browser search worker against synthetic native IPC. The native unit tests exercise sparse logical 100/500 MiB files, invalid ranges, source mutation, and Unix special-file/link rejection. Neither the portable harness nor the mocked browser tests verify real Windows I/O, IPC, or WebView2 memory.

## Windows x64 release verification

1. Run `cargo test --manifest-path src-tauri/Cargo.toml --lib --locked` and the Windows installer workflow. Create real fixtures with `npm run benchmark:large-file -- --fixtures <directory>` (requires 600 MiB free space; files are retained for this test).
2. On the supported benchmark machine, record the build, Windows/WebView2 version, storage and RAM. With a fresh app instance for each file, use Windows Performance Recorder or Process Explorer to record baseline and peak working set for the app and its WebView2 process tree. Capture first-window latency (click to visible text), full search latency (`WRYTROVE_LAST_MATCH`), and cancellation latency (click to visible partial status). Repeat for cold and warm runs and report median and range.
3. Scroll inside a window, navigate to the final byte, jump from the final match, cancel another scan, then close during I/O. Confirm usable interaction, correct range coordinates, and no unexpected editor tab, recovery content or AI traffic. Try changing/truncating the source between ranges, and verify that the viewer requests a reopen instead of treating the scan as complete.
