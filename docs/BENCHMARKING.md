# Benchmarking

compressor's rule is that every optimization is measured against real agent sessions or it doesn't ship. This document holds the current measured results and explains how to run the harness yourself. The full experimental record — every run, the methodology in depth, and the retracted first corpus — is in [MEASUREMENTS.md](MEASUREMENTS.md).

All numbers come from benchmark runs against live Claude models: real headless `claude` sessions in isolated per-cell config dirs, actual usage from the CLI's own accounting (result JSON and session transcripts, never tokenizer estimates), and binary success checks (shell commands, not judgment). Run ids refer to result files under `bench/results/`.

## Current measured results

> Validity note: every run below executed with **treatment-delivery canaries** — before any spend, a real micro-cell must prove the output style visibly shapes a reply and the hook observably fires. Runs before 2026-06-11 lacked this guard, were invalidated by a silent configuration flaw, and are retracted (see [MEASUREMENTS.md](MEASUREMENTS.md)); nothing below derives from them.

### Compression hook (run bench-20260612-110402)

Hook-on vs hook-off arms in one run, instructions held constant (`--hook-arms`), optimized mode, 5 trials per cell, claude-sonnet-4-6. Context volume = input + cache-write + cache-read tokens.

| Task | hook-off median | hook-on median | Effect |
|---|---|---|---|
| huge-log-diagnosis (3,800-line test log) | 472.7k | 396.7k | **−16.1%** — near-disjoint distributions (hook-on max 406k < hook-off median 473k) |
| diagnose-failing-test (moderate logs) | 143.1k | 143.6k | ~0 — reads sit under the compression thresholds |
| wide-refactor (3 × 1,100-line code files) | 301.9k | 351.4k | +16.4% median, **hook-on worse**, overlapping spreads — noise-level, but directionally consistent with truncation-induced re-reads (the run's 8 recovery reads cluster here) |

**Task success: 30/30 — compression caused zero failures.** Treatment delivery is provable inside the data: 10/15 hook-on cells carry truncation state in the recovery-state side channel, 0/15 hook-off cells do.

The honest reading: **the hook pays where tool output is redundant (logs, repeated lines), does nothing where output is moderate, and may cost where content is dense (code)** — truncating lines the model actually needs induces recovery re-reads that erase the savings. A content-kind-scoped hook (aggressive on logs, conservative on code) is the open product hypothesis this run raised; it has not been measured.

### Instruction packs, multi-turn conversations (run bench-20260612-113921)

Full vs optimized vs slim as installed product configurations (instruction pack + hook vs nothing), 4 scripted conversations × 4 trials, claude-sonnet-4-6. The conversation fixtures are small files, so the hook rarely triggers — these deltas are almost entirely instruction-driven.

| Conversation | full | optimized | Δ | slim | Δ |
|---|---|---|---|---|---|
| review diff → deep-dive → PR comment | 22,118 | 4,567 | **−79.4%** | 9,214 | −58.3% |
| bugfix → explain → hunt similar → summarize | 3,118 | 2,104 | **−32.5%** | 2,224 | −28.7% |
| explain codebase → how to extend → risks | 2,010 | 1,488 | −26.0% | 1,444 | −28.2% |
| implement → extend → explain → document | 5,265 | 4,740 | −10.0% | 3,794 | −27.9% |

(median output tokens per conversation)

**Task success: 48/48 — zero quality loss in any mode.** The review conversation's distributions are **fully disjoint**: the worst treated cell (15.2k tokens) is below the best untreated cell (18.8k) — every treated cell beat every untreated cell. Per-turn medians are lower in treated modes at every conversation turn (turn 3: full 708 vs optimized 410 / slim 352), which is the per-turn preamble/recap suppression mechanism made visible.

The honest headline: **−10% to −79% output reduction in conversational coding depending on conversation type, zero measured quality loss.** The effect is largest exactly where an unconstrained model writes the most prose (reviews, critiques).

### vs the viral Caveman prompt (run bench-20260614-020738)

Head-to-head against [juliusbrussee/caveman](https://github.com/juliusbrussee/caveman) — output-shaping pack vs compressor's input compression. At **100% success on every arm**, compressor cut **~49–52%** of token cost vs Caveman's **~42%**; on the log-heavy task Caveman *raised* context **+19%** (input-blind, extra tool calls) where compressor's hook cut it **−25%**. Caveman's only clean win was −7.6% output on the simplest prose Q&A. Full table + method: [COMPRESSOR-VS-CAVEMAN.md](COMPRESSOR-VS-CAVEMAN.md).

### Caveats that ride with every number above

- Small n: 4–5 trials per cell. Medians with spreads are reported; only the review conversation's separation is distribution-level. No statistical-significance claims.
- One model: everything above ran on claude-sonnet-4-6. No claim transfers to other models or agent CLIs.
- M2 is a product-level comparison (pack + hook vs nothing), not an instruction-isolated one — though the hook's contribution there is minimal per the M1 thresholds.
- Single-shot agentic tasks (one prompt, no conversation) showed only small effects in all measurements to date; conversation shape and prose-heaviness are the moderators that matter.

## Running the harness

Benchmarking is a **from-source feature** — the npm package ships the CLI, hooks, and library only; the harness needs the repo's `bench/` suites and fixtures.

```sh
git clone https://github.com/anvanster/compressor.git && cd compressor
npm install && npm run build
set -a; source config.local; set +a    # your credentials (gitignored file)

# the two headline runs above, verbatim:
node dist/cli/index.js benchmark --suite bench/suites/hookab.json \
  --modes optimized --hook-arms --trials 5 --auth subscription --max-cells 30
node dist/cli/index.js benchmark --suite bench/suites/interactive.json \
  --modes full,optimized,slim --trials 4 --auth subscription --max-cells 48

node dist/cli/index.js report                 # latest run: medians + IQR, deltas, data-quality flags
node dist/cli/index.js report --compare <runA> <runB> --format md
```

### Auth modes (who pays)

Cells strip the other mode's credential, so billing is deterministic:

- **`--auth api`** (default): bills `ANTHROPIC_API_KEY` under the hard `--max-budget-usd` ceiling (default $5). Cell credentials resolve inside the per-cell config dir, which holds none — a keyless cell fails "Not logged in", so your OAuth subscription is unreachable.
- **`--auth subscription`**: bills your Claude plan via `CLAUDE_CODE_OAUTH_TOKEN` (mint once with `claude setup-token`). This consumes your plan's 5-hour windows and weekly caps — big runs compete with your own sessions. The ceiling is `--max-cells` (group-atomic); progress reports tokens consumed; an error-streak breaker stops the run if the token dies or the usage window exhausts. Reported cost columns are API-equivalent figures, not dollars billed, and run meta records `authMode`.

### Safety rails (each exists because it caught a real failure)

- **Treatment-delivery canaries** — before any spend, one micro-cell must show the canary output style shaping a reply and a canary hook firing on a Read. A run that cannot prove delivery refuses to start. (Born from the retracted first corpus, where `claude --bare` silently disabled both.)
- **Hard ceilings, group-atomically enforced** — the stop decision is made once per task×trial group, so a mid-run stop can never leave some arms of a comparison measured and others skipped.
- **No-cost circuit breaker** (api mode) / **error-streak breaker** (subscription mode) — a run whose ceiling has become unenforceable stops instead of churning the grid.
- **Data-quality flags in `report`** — vacuous fixtures (check passed before the agent ran), silent model substitution (served model verified per cell), permission-denial retry inflation, error cells listed separately from task failures.
- **Per-cell isolation** — throwaway workspace, per-cell `CLAUDE_CONFIG_DIR` (replaces user settings, hooks, styles, plugins, memory, and credentials), `COMPRESSOR_NO_LEDGER=1` so synthetic compressions never pollute your live savings ledger.

### Experiment fan-outs (same-run arms)

Arms must share one run, one ceiling, and the same task×trial groups — separate runs give each arm its own truncation point and unbalance the comparison.

| Flag | Arms |
|---|---|
| `--hook-arms` | hook-on vs hook-off per hook-bearing variant, instructions held constant (the pure compression A/B) |
| `--hook-arg-arms '<label>=<args>,…'` | arbitrary per-arm hook arguments, e.g. `budget-on=,budget-off=--recovery-budget off` |
| `--marker-styles plain,deterrent,informative` | marker-phrasing arms |
| `--ablate <atom-ids>` / `--ablate-add <rejected-ids>` / `--ablate-group <output\|behavior>` | instruction-atom ablations vs the optimized baseline |

### CLI reference

| Command | What it does | Key flags (defaults) |
|---|---|---|
| `benchmark` | run the suite: cells = task × variant × trial, results as JSONL; canaries gate every real run | `--suite` (`bench/suites/basic.json`), `--modes` (`full,optimized,slim`), `--trials` (`5`), `--model` (`claude-sonnet-4-6`), `--auth api\|subscription` (`api`), `--max-budget-usd` (`5`, api), `--max-cells <n>` (subscription), `--no-hook`, `--hook-args <args>`, fan-out flags above, `--concurrency` (`2`), `--out` (`bench/results`) |
| `report` | aggregate a run: per-variant medians + IQR, per-task matrices, deltas vs full and vs ablation baselines, data-quality flags | `--run <id>` (latest), `--compare <runs...>`, `--format table\|md\|json` (`table`), `--out` (`bench/results`) |

### Suites

| Suite | Tasks | Exercises |
|---|---|---|
| `bench/suites/basic.json` | 6 single-shot coding tasks | the original gate suite |
| `bench/suites/main.json` | basic + 4 signal-amplifying tasks (prose-heavy reviews/explanations, a 3,800-line log, 3 × 1,100-line modules) | output atoms and the hook's tiers |
| `bench/suites/hookab.json` | the 3 heavy tasks | hook A/B instrument |
| `bench/suites/interactive.json` | 4 multi-turn conversations (via `claude -p --resume` chaining) | per-turn instruction effects |
| `bench/suites/ablate.json` | main minus the bimodal log task | ablation runs |

All command-check fixtures ship broken (the runner records `baselineCheckPassed` and the report flags vacuous tasks); answer-regex tasks use mechanism-aware lookahead patterns that a wrong-but-verbose answer does not satisfy.

## The retracted first corpus

Every benchmark result produced before 2026-06-11 (10 runs, $57.85) is retracted: cells ran `claude --bare`, which silently ignores output styles and hooks, so every arm was an identical unstyled, hookless baseline and all deltas were noise. The flaw, its discovery, what survived, and the full do-not-cite record are documented in [MEASUREMENTS.md](MEASUREMENTS.md) — kept public because the failure is more instructive than most results.
