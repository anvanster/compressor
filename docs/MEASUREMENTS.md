# Measurements

> **RETRACTION (2026-06-11) — every result in this document is invalid.**
> Direct probes proved that `claude --bare` (used by every benchmark cell in every
> run below) silently ignores output styles — from both the user and project scope —
> and hooks — both from settings files and from `--settings` — while honoring the
> `permissions` key. Every "optimized", "slim", "hook-on", ablation, and marker arm
> was therefore configured identically to `full`: an unstyled, hookless baseline.
> All reported deltas, including the negative results, were noise between identical
> configurations. The flaw surfaced when a recovery-state join over the
> 2026-06-11 budget experiment returned an impossible zero, and was confirmed by a
> four-cell probe matrix (bare/no-bare × settings-file/`--settings`).
>
> Still valid: §1's methodology and infrastructure; the permission-denial discovery
> (run bench-20260609-231151 — that mechanism was real and its fix measurable);
> task solvability (100% success in every cell); live-session *function* of the
> hook, styles, and ledger (verified in real sessions, where styles and hooks do
> load). Not valid: every savings number, every arm comparison, every verdict in
> §3, and the slim truncate-budget retune rationale.
>
> The harness is fixed (cells run without `--bare`; per-cell `CLAUDE_CONFIG_DIR`
> isolation was verified to hold on its own, including credential isolation — a
> keyless cell fails with "Not logged in" rather than reaching the operator's
> OAuth subscription), and **treatment-delivery canaries** now prove style and
> hook delivery in a real cell before a run may spend anything. This document is
> retained as the honest record of the first corpus and will be superseded by
> remeasured results.

This document is the experimental record for compressor: what was measured, how, and what those measurements ruled in or out. It is the baseline state of affairs as of 2026-06-10. Every measured number cites its run id; raw per-cell data lives in `bench/results/<run-id>.jsonl` with run configuration in the adjacent `.meta.json`. Numbers that are estimates are labelled as estimates. Protocol claims marked *doc-verified* were checked against live vendor documentation, not recalled from memory.

Three conventions, applied throughout:

- **Negative results are reported as negative results.** Two experiments in this record refuted their own hypotheses; they are documented with the same prominence as the wins.
- **Small-n caveats are stated where they apply.** Most runs use 2–4 trials per cell. Medians and IQRs are reported, and deltas whose IQRs overlap are called directional, not significant.
- **No estimated number is ever presented as a measured saving.** All reported token figures come from the Claude CLI's own usage accounting (result JSON and session transcripts), never from a tokenizer estimate.

## 1. Methodology

### The harness

The benchmark harness (`src/bench/`, driven by `compressor benchmark`) measures one *cell* at a time, where a cell = (task × variant × trial):

1. **Isolated workspace.** The task's fixture repository is copied to a fresh temp directory and `git init`-ed. A second temp directory serves as a per-cell `CLAUDE_CONFIG_DIR` scratch, fully isolating the cell from the operator's `~/.claude` and relocating its session transcript somewhere the harness can read it.
2. **Real agent, real model.** The cell invokes the actual `claude` binary: `claude -p "<prompt>" --output-format json --model <pinned> --settings cell.json`. Cells deliberately do **not** use `--bare` — probe-verified 2026-06-11, `--bare` silently ignores output styles and hooks, which is precisely what invalidated the first corpus (see the retraction). Isolation holds without it: the per-cell `CLAUDE_CONFIG_DIR` scratch dir replaces the user scope entirely (settings, hooks, styles, plugins, memory, and credential lookup), so the operator's own configuration cannot leak into a cell. Treatment-delivery canaries prove style and hook delivery in a real cell before any spend. Multi-turn tasks chain turns with `--resume <session-id>`.
3. **Actual usage, never estimators.** Token figures come from the result JSON's `usage`/`modelUsage`/`total_cost_usd` fields, with per-turn and multi-turn breakdowns from the session transcript (deduplicated by `requestId`, sidechains included). Neither of the codebase's two estimators contributes to a reported number: the hook's size thresholds use the cheap chars/3.5 estimator (the hook hot path never loads a tokenizer), and `js-tiktoken` — which undercounts Claude's tokenizer by roughly 15–20% (doc-verified) — is used only by the CLI `count` and `compress` commands, labelled "estimated" wherever it surfaces. Neither ever appears in a reported saving.
4. **Hard budget ceiling.** Scheduling stops when cumulative spend reaches `--max-budget-usd`. The stop is group-atomic: cells are grouped by task × trial across all variants, and the stop decision is taken once per group, so a ceiling trip cannot leave one arm of a comparison measured and another skipped. This guard postdates run bench-20260610-123102, whose data contains exactly that asymmetry (one trial-4 arm completed, its counterpart skipped — see §3.2); later runs skip whole groups symmetrically (e.g. run bench-20260610-181302).
5. **Trials with median + IQR.** The harness defaults to 5 trials; the runs to date used 1–4 (cost-bounded). Single-trial runs are smoke tests and are not interpreted.
6. **Binary success checks.** Every task carries an objective check — a test command (`node --test …`) or an answer regex. No LLM judging contributes to any number in this document. Success rate is the quality-regression alarm: a variant that saves tokens by failing tasks would show up here first.

### Why the guards exist

Each data-quality mechanism in the harness was added because it caught, or was added in response to, a real problem:

| Guard | The incident behind it |
|---|---|
| **Answer-key filter** | Seven of the ten fixtures ship a `fix.patch.json` (a scripted solution used by the harness's own tests; the three answer-regex tasks have none). An early review found it being copied into the agent's workspace — handing the model the literal answer. The runner now filters it out of every workspace copy. |
| **Permission-denial flag + `bypassPermissions`** | The first live run (bench-20260609-231151) had 10 of 12 cells fail — with the *correct fix present in the answer text*. Headless cells were being denied Edit/Bash permission and spun in retry loops — cells ran to as many as 53 turns, against 3–11 turns in the post-fix smoke run (bench-20260609-232654) — inflating usage and corrupting the measurement. Cell settings now set `permissions.defaultMode: bypassPermissions`, and every cell records a `permissionDenials` count so a recurrence is flagged rather than silently absorbed. |
| **Served-model verification** | `--model` pins the *requested* model, but fallback can silently substitute another. Every cell records the served model(s) from `modelUsage` keys, so a partially-degraded run is detectable after the fact. |
| **Vacuous-fixture guard** | Before the agent runs, the success command is executed against the untouched fixture and recorded as `baselineCheckPassed`. A fixture whose tests already pass would measure nothing; this makes that failure mode visible per cell. (All measurement runs to date: zero baseline-already-passing cells.) |
| **No-cost circuit breaker** | Cells that time out or error report no cost — but still bill real API spend, which the dollar ceiling cannot see. A review found the budget was therefore defeatable by a streak of failing cells. After 3 consecutive no-cost cells the runner stops scheduling instead of burning the rest of the grid. |
| **Multi-turn usage cross-check** | For conversation cells, the final transcript's totals are cross-checked against the summed per-turn result JSONs. Divergence beyond 25% flags the cell as data-quality-suspect (resumed sessions can fork ids without full history; per-turn JSONs can be cumulative) rather than silently reporting a wrong total. |
| **Ledger kill switch** | Hook-bearing cells run the real compression hook, which normally appends events to the live savings ledger (`~/.compressor/ledger`). Benchmark cells set `COMPRESSOR_NO_LEDGER=1` so synthetic benchmark traffic cannot contaminate what `compressor savings` reports about real sessions. |

One known limitation of the ceiling: it can overshoot by up to concurrency × max-cell-cost, because in-flight cells finish after the stop decision. Observed in three of the eight runs: bench-20260610-114234 ($12.52 against a $12 ceiling), bench-20260610-123102 ($7.46 against $6 — the largest), and bench-20260610-181302 ($8.21 against $8).

## 2. The run ledger

Every benchmark run to date, chronological. Spend figures are summed from per-cell `total_cost_usd` in the raw JSONL. All runs on `claude-sonnet-4-6` unless noted.

| Run id | Date | Configuration | Spend | Headline |
|---|---|---|---|---|
| bench-20260609-231151 | 2026-06-09 | basic suite × {full, slim} × 1 trial, claude-haiku-4-5 | $1.28 | **Diagnostic.** 10/12 cells failed with correct fixes in the answer text — headless permission denials, retry loops inflating usage. Led to `bypassPermissions` in cell settings and the `permissionDenials` flag. Not a measurement. |
| bench-20260609-232654 | 2026-06-09 | basic suite × {full, slim} × 1 trial, claude-haiku-4-5 | $0.32 | Post-fix smoke: 12/12 pass, zero flags. Single-trial — deltas not interpreted. |
| bench-20260609-232940 | 2026-06-09 | basic suite × {full, optimized, slim} × 3 trials | $3.02 | First measurement: 54/54 pass. Output: optimized −6.1%, slim −2.5% vs full; cost −0.9% / −2.5%. IQRs overlap heavily — directional, not significant at 3 trials. |
| bench-20260610-114234 | 2026-06-10 | main suite (10 tasks) × {full, optimized, slim} × 3 trials, hook on | $12.52 | Main run: 88/90 cells (2 skipped at the $12 ceiling), 100% success on every completed cell. Aggregate output −5.6% / −2.3%. Per-task: the hook roughly halves context on heavy tasks (huge-log 457k→249k; wide-refactor 411k→278k). Pagination bimodality discovered on huge-log. |
| bench-20260610-123102 | 2026-06-10 | hookab suite (3 heavy tasks) × {optimized, slim} × 4 trials, `--no-hook` | $7.46 | Hook A/B (vs the hook-on arms of the main run): no-hook wide-refactor tails reach 3.0M–3.1M context tokens; hook-on medians −24% (optimized) / −75% (slim). 19/19 completed cells pass in both arms. |
| bench-20260610-124626 | 2026-06-10 | ablate suite (9 tasks) × {optimized, −output-atoms, −behavior-atoms, +drop-articles} × 2 trials | $8.63 | Ablation gate: 72/72 pass. Behaviour atoms carry the effect (removing them: +6.6% output); output atoms show no marginal effect in single-shot agentic use (−2.6%, noise); `tokens.drop-articles` refuted (−2.2%, noise). |
| bench-20260610-181302 | 2026-06-10 | hookab suite × 3 marker-style arms × 3–4 trials | $8.21 | **Negative result.** Marker phrasing does not reduce pagination — measured trend was the opposite of the hypothesis, within binomial noise at n=3. `plain` stays the default. |
| bench-20260610-183001 | 2026-06-10 | interactive suite (4 conversations) × {full, optimized, slim} × 3 trials | $6.76 | Multi-turn: 35/36 cells (1 infra error), 100% success on completed cells. Per-conversation output −11% to −24% (optimized) — the instruction packs' best case, roughly 2–4× their single-shot effect. One task regressed (+3%); see §3.4. |

Total spend across all eight runs: $48.22.

## 3. Findings

### 3.1 Where the tokens go: input dwarfs output, and cache traffic dominates

Token destination across all 88 completed cells of the main run (run bench-20260610-114234):

| Destination | Tokens | Share |
|---|---|---|
| Cache reads | 6,418,413 | 77.2% |
| Cache creation | 1,583,810 | 19.1% |
| Output | 307,032 | 3.7% |
| Uncached input | 704 | ~0% |

Output is under 4% of token volume in these agentic runs; effectively all input flows through the prompt cache. This is why output-shaping instructions move cost so little: in the first measurement (run bench-20260609-232940), optimized cut output by 6.1% but cost by only 0.9% — per-cell cost is dominated by cache traffic, not output. The pre-project research that motivated the design observed the same shape at larger scale: roughly 1000:1 input:output (33M vs 31K tokens over a 170-turn real session) — a planning-stage observation from one session, not a harness measurement.

The practical consequence: **the big lever is the input side** — compressing tool output before it enters context, and shaping the model's reading behaviour — not making the model terser.

### 3.2 The hook is the product

The PostToolUse compression hook compresses tool output (Read/Bash/Grep/Glob results) before it enters context. On tasks with large files or logs, this is where the material savings live.

Per-task median context (input + cache creation + cache read), hook on (run bench-20260610-114234, n=3 per cell, n=2 where the budget ceiling skipped trial 3):

| Task | full | optimized | slim |
|---|---|---|---|
| huge-log-diagnosis | 457k | 249k (−46%) | 457k (0%) |
| wide-refactor | 411k | 278k (−32%) | 288k (−30%) |
| diagnose-failing-test (moderate logs) | 40k | 43k | 40k |

The diagnose row is the honest control: with tool outputs under the touch thresholds, the hook does nothing, and nothing changes. The slim huge-log row is explained in §3.3.

The A/B run (bench-20260610-123102, same tasks and model, `--no-hook`) scheduled 4 trials but tripped its budget ceiling in trial 4: 5 of the 6 trial-4 cells were skipped. This run predates the harness's group-atomic stop (§1), so the skip was asymmetric — the diagnose-failing-test trial-4 cell completed in the optimized arm while its slim counterpart was skipped. The wide-refactor comparison below is unaffected (3 completed cells per arm). The run shows what the hook is protecting against. Per-cell context on wide-refactor:

| Arm | Per-cell context |
|---|---|
| optimized, no hook | 349k, 363k, **3,008k** |
| slim, no hook | 411k, 1,136k, **3,123k** |
| optimized, hook on (run bench-20260610-114234) | 258k, 297k |
| slim, hook on (run bench-20260610-114234) | 249k, 328k |

Medians: −24% (optimized) and −75% (slim) with the hook on; the no-hook worst cases — cells that ballooned past 3.0M context tokens — are cut by roughly 90% (3,008k → 297k optimized; 3,123k → 328k slim, worst cell vs worst cell). Success was 19/19 completed cells in both arms: no quality price was measured for the compression. Caveats: the hook-on arm is n=2 per mode (ceiling skip) and the comparison is across two runs rather than within one, albeit on identical tasks, fixtures, and model. The tail behaviour, not the median, is the strongest part of this result: without the hook, a single unlucky trajectory costs more than entire benchmark runs.

### 3.3 The pagination interior optimum, and a negative follow-up

The huge-log task is bimodal in *both* hook arms: trajectories cluster near ~248k context (good) or ~457k (the full uncompressed log's weight). The mechanism, from per-cell analysis of runs bench-20260610-114234 and -123102:

- Targeted reads (`offset`/`limit` in the tool input) pass through the hook *by design* — compressing a range the model explicitly asked for would be hostile.
- slim's original truncation budget (2,500 estimated tokens) was aggressive enough that the model responded by paginating: issuing recovery reads for the truncated ranges. Those pass through untouched, so the savings were nullified — slim's worst huge-log cell (512k) exceeded the full-arm median (457k).
- optimized's 5,000-token budget sat under the recovery trigger and kept its −46%.

Compression aggressiveness therefore has an **interior optimum**: truncate too hard and the model reads it all back, uncompressed. The measured tune was applied: slim's `truncateBudget` was raised from 2,500 to 5,000 (`src/engine/policy.ts`, with the rationale in a comment citing the runs).

**Follow-up experiment — negative.** Hypothesis: rewording the truncation marker could discourage full pagination. Run bench-20260610-181302 fanned three marker styles (`plain`, `informative`, `deterrent`) across the heavy tasks, 3–4 trials each. Result: pagination fractions on huge-log were plain 1/3, informative 2/3, deterrent 3/3 — the *opposite* of the intended trend, and within binomial noise at n=3 either way. wide-refactor produced ~1.1M-token catastrophic cells in both the plain (1,147k) and deterrent (1,085k) arms. Verdict: marker phrasing does not move pagination behaviour; `plain` remains the default, and the bimodality fix most likely requires a structural intervention (for example, recovery-read budgets in the hook) rather than wording. The `--marker-styles` fan-out infrastructure is retained for future arms.

### 3.4 Instruction packs: modest single-shot, real in multi-turn

The packs' single-shot effect is small and, at 3 trials, not statistically separable:

| Run | optimized output | slim output | Note |
|---|---|---|---|
| bench-20260609-232940 (basic suite) | −6.1% | −2.5% | IQRs overlap heavily (full [1,244–2,078] vs optimized [1,341–2,083]) — directional only |
| bench-20260610-114234 (main suite) | −5.6% | −2.3% | Cost −6.1% / −3.2%; same caveat |

Two single-shot observations worth keeping: slim cut the prose-heavy summarize-architecture task's output by 20% (10,219 → 8,172 median, run bench-20260610-114234) — the output atoms' one clear single-shot win; and review-diff showed full-arm context ranging 20k–73k across three trials purely from agent strategy, which makes 3-trial deltas on that task noise.

Multi-turn conversations are where the packs earn their keep. Run bench-20260610-183001 (4 scripted conversations × 3 modes × 3 trials, 35/36 cells, 100% success in every mode on completed cells) — per-conversation output medians vs full:

| Conversation | full (median tokens) | optimized | slim |
|---|---|---|---|
| bugfix-conversation | 4,954 | −24% | −17% |
| explain-conversation | 6,468 | −23% | −5% |
| review-conversation | 9,843 | −11% | −25% |
| add-function-conversation | 9,433 | **+3%** | **+4%** |

(The explain full-arm baseline is n=2; one cell was lost to an infrastructure error on its third turn.)

For optimized that is roughly 2–4× the single-shot effect (−11% to −24% per conversation against −6.1% single-shot). The mechanism is compounding: in a default conversation the model re-summarizes its work every turn, and the `out.no-recap` / `out.no-preamble` family suppresses that on *each* turn, so the saving accumulates with conversation length. Two honest notes: the add-function conversation regressed slightly (+3%/+4%) — at n=3 this is within noise, but it is reported, not hidden; and prose turns ("explain for a reviewer", "draft a PR comment") stayed full-length in all modes — the atoms suppress unrequested recap, not requested explanation, which is the desired behaviour.

The defensible multi-turn claim, with its caveat: **−5% to −25% output reduction across the six improving task×mode cells (−11% to −24% for optimized) in conversational coding at zero measured quality cost, at n=3 trials** (run bench-20260610-183001).

### 3.5 Ablation verdicts: behaviour beats output, and a rejected atom stays rejected

Run bench-20260610-124626 (9 tasks × 2 trials per variant, 72/72 pass, 100% success in every variant) ablated whole atom categories against the optimized baseline:

| Variant | Median output vs optimized | Verdict |
|---|---|---|
| optimized − behaviour atoms | **+6.6%** (2,040 → 2,174) | Behaviour atoms carry the measurable effect. On wide-refactor specifically, removing them doubled output: 6,003 → 11,697 median. |
| optimized − output atoms | −2.6% (2,040 → 1,986) | No measurable marginal effect in single-shot agentic use — removing them *helped*, within noise. Their proven value is elsewhere: prose tasks (slim −20% on summarize-architecture, run bench-20260610-114234) and the multi-turn compounding of §3.4. No harm measured. |
| optimized + `tokens.drop-articles` | −2.2% (2,040 → 1,995) | **Refuted.** The viral "drop articles and filler words" instruction adds nothing on top of a concise baseline — the delta is noise. The atom remains in `src/packs/atoms.ts` as a rejected atom, with this run cited in its rationale, and can be re-demonstrated via `--ablate-add`. |

The ranking matches the token-destination economics of §3.1: atoms that change what the model *reads and does* (targeted reads, no re-reads, bounded commands, surgical edits) move more tokens than atoms that change how it *talks*.

## 4. Open questions

| Question | State |
|---|---|
| Pagination bimodality — structural fix | Unsolved. Marker phrasing refuted (run bench-20260610-181302); the next candidate is structural (e.g. recovery-read budgets in the hook). Until then, huge-log-class tasks remain bimodal in both hook arms. |
| Output atoms in single-shot agentic use | Unproven. No measured marginal effect (run bench-20260610-124626); kept because they are harmless there, demonstrably useful on prose tasks and in multi-turn. A higher-trial single-shot run could still change this verdict in either direction. |
| Cursor full coverage | Cursor receives instructions only — its hook mechanism replaces MCP tool output, not built-in tool output, so the compression hook does not apply. A proxy is the candidate mechanism. (Similarly, AGENTS.md consumers get instructions only, and the Copilot hook works in the Copilot CLI on the installing machine only — the hook command is an absolute local path.) |
| Multi-turn at higher trial counts | The §3.4 numbers are n=3 per cell. The effect direction is consistent across three of four conversations, but the magnitudes (and the add-function +3%) need n≥5 to firm up. |
| Cross-model validity | Every measurement run requested `claude-sonnet-4-6` (the two smoke runs, not interpreted for deltas, requested `claude-haiku-4-5`); per-cell `servedModels` were verified and also contain dated `claude-haiku-4-5` ids from subagent/fallback traffic alongside the requested model. No claim in this document is known to transfer to other models or other agent CLIs. |
| Hook A/B in a single run | The §3.2 comparison crosses two runs (same suite, fixtures, model). A single run with hook-on and hook-off arms interleaved would remove the residual cross-run risk. |

## 5. Reproduction

### Prerequisites

- Node ≥ 20; build from source (the package is not yet published to npm):

  ```sh
  npm install
  npm run build
  ```

  Then either `npm link` (to get `compressor` on PATH) or invoke `node dist/cli/index.js` directly. Run benchmark commands from the repository root: the default suite path is cwd-relative and `bench/` fixtures ship in the repo, not in the npm package.
- The `claude` CLI installed (the runs above used v2.1.170). The harness can point at a different binary via `COMPRESSOR_CLAUDE_BIN`.
- `ANTHROPIC_API_KEY` exported: cell credentials resolve inside the per-cell `CLAUDE_CONFIG_DIR`, which holds none — probe-verified: a keyless cell fails with "Not logged in" rather than reaching the operator's OAuth subscription — so the API key is the only auth path. **All spend is real API spend.**
- Costs below are what the recorded runs actually spent; your numbers will vary with model behaviour. The `--max-budget-usd` ceiling stops *scheduling* when reached but can overshoot by up to concurrency × max-cell-cost (in-flight cells); budget accordingly.

### Commands per run class

Smoke (sanity only — single trial, deltas are noise; ~$0.3, ceiling $2):

```sh
compressor benchmark --suite bench/suites/basic.json --modes full,slim \
  --trials 1 --model claude-haiku-4-5 --max-budget-usd 2
```

Single-shot pack measurement (≈ run bench-20260609-232940; ~$3, ceiling $5):

```sh
compressor benchmark --suite bench/suites/basic.json --modes full,optimized,slim \
  --trials 3 --max-budget-usd 5
```

Main suite, hook on (≈ run bench-20260610-114234; ~$12.5 — it hit its $12 ceiling):

```sh
compressor benchmark --suite bench/suites/main.json --modes full,optimized,slim \
  --trials 3 --max-budget-usd 12
```

Hook A/B, heavy tasks, hook off (≈ run bench-20260610-123102; ~$7.5 against a $6 ceiling — the largest of the three overshoot cases above). Compare against the hook-on run with `report --compare`:

```sh
compressor benchmark --suite bench/suites/hookab.json --modes optimized,slim \
  --trials 4 --no-hook --max-budget-usd 6
compressor report --compare <hook-on-run-id> <no-hook-run-id>
```

Ablation gate (≈ run bench-20260610-124626; ~$8.6, ceiling $9):

```sh
compressor benchmark --suite bench/suites/ablate.json --modes optimized \
  --ablate-group output,behavior --ablate-add tokens.drop-articles \
  --trials 2 --max-budget-usd 9
```

Marker-style experiment (≈ run bench-20260610-181302; ~$8.2, ceiling $8):

```sh
compressor benchmark --suite bench/suites/hookab.json --modes optimized \
  --marker-styles plain,deterrent,informative --trials 4 --max-budget-usd 8
```

Multi-turn conversations (≈ run bench-20260610-183001; ~$6.8, ceiling $10):

```sh
compressor benchmark --suite bench/suites/interactive.json --modes full,optimized,slim \
  --trials 3 --max-budget-usd 10
```

### Reading results

```sh
compressor report --run <run-id> --format md     # per-variant medians+IQR, deltas vs full, ablation deltas
compressor report --format table                  # latest run in bench/results
```

Raw data: `bench/results/<run-id>.jsonl` (one cell per line: usage, cost, success, served models, permission denials, tool calls, errors) and `bench/results/<run-id>.meta.json` (suite, variants, trials, model, ceiling). When interpreting a run, check `servedModels` (model fallback), `permissionDenials` (should be 0), `baselineCheckPassed` (should be `false` for command-checked tasks), and `error` fields (budget skips and infra failures) before trusting the aggregates — the harness records these precisely so that a bad run announces itself.
