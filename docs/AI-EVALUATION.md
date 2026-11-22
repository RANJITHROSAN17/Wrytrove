# Offline-first AI evaluation harness

This opt-in developer tool exercises the AI action request framing, input policy, bounded response parsing and selected output invariants. It does not edit documents, send telemetry, call Arena, download models, or run a model in CI. The 36 bundled fixtures are synthetic. **Mock results test the harness and policies, not a model.**

## Network-free mock run

```sh
npm ci
npm run --silent ai:eval -- --mode mock
```

This invokes an injected fake provider with no network. The report identifies `provider: mock` and `routing: mocked`. `npm test` includes the synthetic suite and adversarial/malformed response tests; CI runs it without Ollama or cloud access.

## Opt-in Ollama run

Start your own Ollama server and install a model yourself. Only after reviewing the fixtures and the endpoint's actual routing, run:

```sh
npm run ai:eval -- --mode ollama --model qwen2.5-coder:1.5b --routing local-model --acknowledge-ollama-routing --hardware "synthetic test machine" --quantization "Q4" --output ./ai-report.json
```

The fixed endpoint is `http://127.0.0.1:11434/api/generate`, with redirects refused and a 60-second request timeout. A loopback server **can itself forward requests to a remote or cloud model**. `--acknowledge-ollama-routing` is required for any real-provider run; use `--routing cloud` for a cloud-backed model, or `--routing unknown` when unsure. The declaration is operator-supplied and is not verified. A direct cloud URL or Arena API is not supported. Do not send private fixtures until you have verified the model's routing and are authorized to send them. This is a separate CLI tool, not the in-app consent mechanism.

The output is aggregate JSON only: provider and routing declaration, model name, optional user-supplied hardware/quantization, status counts by category and reason, total time, median and p95 generation-fixture time, output character counts, and human-label counts if supplied. Fixture timing includes request preparation, transport, parsing and checks; it is not a model-only performance measurement. Those metadata fields and aggregate sizes/timings can themselves be sensitive; review before sharing. The tool does not upload them. The output file must not already exist. Without `--output`, aggregate JSON goes to stdout. Exit status 0 means all configured checks passed, 1 means at least one failed, and 2 means the harness could not run.

## User-provided fixtures and labels

Pass `--fixtures /path/to/fixtures.json` to replace the synthetic set with a JSON array of 1–100 fixtures. It is read locally, bounded to 1 MB, and **will be sent to the explicitly selected Ollama provider** in real mode. For example:

```json
[
  {
    "id": "example-1",
    "category": "prose",
    "action": "grammar",
    "selection": "The team were ready.",
    "expected": "output",
    "mustInclude": ["team"],
    "noNewNumbers": true,
    "mockOutput": "The team was ready."
  }
]
```

Allowed categories are `prose`, `markdown`, `code`, `injection`, `unicode`, `noop`, `policy`. Actions match the app's eight action IDs; a `custom` action needs an `instruction`. `expected` is `output`, `reject-input`, or `stale`. `mustInclude`, `mustExclude` and `noNewNumbers` are optional simple string checks, not semantic verification. `mockOutput` is optional and used only in mock mode. A stale case simulates the review target changing before a result is applied; it does not invoke a provider. Input NULs, empty selections, oversized selections and unpaired surrogates are rejected before sending; the harness's surrogate check is stricter than the app's current request builder.

Optional `--labels /path/to/labels.json` accepts an object mapping fixture IDs to `accepted`, `rejected`, or `unsure`, assigned by a human. Only totals are included by default. The tool never invents human labels. To inspect text locally for review, use `--include-text --output /private/new-file.json`; this explicitly exports fixture IDs, selections, prompts and valid responses, including failed invariant cases. Rejected malformed or oversized raw responses are not retained. Treat this file as sensitive; do not commit or share it without review. Use local paths outside the repository for private fixtures, labels and text reports.

## What a pass does and does not mean

A response must have valid bounded JSON and a nonempty, well-formed string without NULs, at most 20,000 UTF-16 code units **before** the app's output cleaner can truncate it. The network body is limited to 262,144 bytes. Required/forbidden tokens and optional number checks are deliberately narrow. For fenced originals the cleaner keeps the fences; delimiter tests verify how the app frames input. They cannot prove that a model follows its system prompt or resists prompt injection. Likewise, retained tokens and number checks do not prove factuality, correctness, formatting, citation validity, or absence of invented facts. Review every response yourself; this harness never applies it.

A passing mock suite is not a model evaluation. A passing real-provider run is not a security certification or a substitute for the authenticated-provider acceptance work in #68. Cloud routing, local models and mocked results must not be conflated. Never publish prompt/response text, custom fixture identifiers or labels without explicit review.
