# compressor

Token optimization for AI coding agents. Three parts: **mode-switchable instruction packs** (full / optimized / slim) installed into Claude Code, GitHub Copilot, Cursor, and AGENTS.md-reading agents; **tool-output compression hooks** that shrink file reads and command output before they enter the model's context; and a **measurement harness** that runs real agent sessions and reports token deltas with success rates. The project's one rule: every optimization is measured or it doesn't ship — including the ideas that didn't survive measurement, which are documented below alongside the ones that did.

## Measured results

> **RETRACTION (2026-06-11).** Every benchmark result previously published here is
> **invalid**. All cells ran `claude --bare`, which — as we proved by direct probe —
> silently ignores output styles and hooks while honoring permissions. Every arm of
> every run was therefore an identical, unstyled, hookless baseline; all reported
> deltas were noise between identical configurations. The flaw was caught by the
> project's own instrumentation (an impossible-looking recovery-state join) and the
> harness is fixed: cells no longer use `--bare`, and **treatment-delivery canaries**
> now prove, in a real cell before any spend, that the style visibly shapes output
> and the hook observably fires — a run that cannot prove delivery refuses to start.
> What survives: the permission-denial discovery (real), task solvability (100%
> success across all cells), the harness infrastructure, and **live-session function**
> — the hook demonstrably compresses tool output and the ledger records it in real
> Claude Code sessions. What does not survive: every savings claim. Remeasurement is
> in progress; numbers will return with run ids when they are real.

The tables below are retained for the record with their original run ids, struck through in spirit: **do not cite them.**

All numbers come from benchmark runs against live Claude models (real API usage from result JSON and session transcripts, not estimates). Task success is checked by shell command, not judgment. Run ids refer to result files under `bench/results/`.

| What | Measured effect | Run |
|---|---|---|
| Compression hook, big-file work | Median context **−24%** (optimized) / **−75%** (slim) vs no hook on the wide-refactor task; tail cells roughly **−90%** (−90.1% optimized / −89.5% slim, worst cell vs worst cell; worst no-hook cells reached ~3.0M context tokens) | bench-20260610-114234, bench-20260610-123102 |
| Instruction packs, multi-turn conversations | Output **−11% to −24%** (optimized) / −5% to −25% (slim) vs full on three of four conversation types; the fourth (a short add-function exchange) was +3%/+4%, within noise | bench-20260610-183001 |
| Instruction packs, single-shot tasks | Output **−5.6%** (optimized) / **−2.3%** (slim) — consistent with −6.1%/−2.5% in an earlier run, but IQRs overlap at 3 trials; directional only | bench-20260610-114234 (earlier: bench-20260609-232940) |
| Behavior atoms (ablation) | Removing the behavior-atom group costs +6.6% output; on the wide-refactor task the median output nearly doubled (6,003 → 11,697 tokens, n=2 — the two no-behavior trials were 7,022 and 16,372) — they carry the instruction-pack effect | bench-20260610-124626 |
| Task success | **100% in every measured arm** — all modes, all ablations, hook on and off | all runs above |

Most cells ran 2–4 trials. Medians are reported; treat single-task deltas as directional unless stated otherwise.

### Negative results

A project that only publishes its wins is advertising. These were measured and rejected:

| Hypothesis | Result | Run |
|---|---|---|
| "Drop articles and filler words to save tokens" (the viral trick) | Refuted: −2.2% output vs an already-concise baseline — noise, with grammar damage as the only reliable effect. The atom stays in `src/packs/atoms.ts` as rejected, with the run id in its rationale | bench-20260610-124626 |
| Rewording truncation markers (deterrent / informative phrasing) discourages wasteful pagination | Negative: marker phrasing did not move pagination behavior (if anything the trend ran the other way, within binomial noise at n=3). Plain markers kept | bench-20260610-181302 |
| Output-discipline atoms help single-shot agentic tasks | No measurable marginal effect in ablation (−2.6%, noise). Their measured value is prose-heavy tasks (slim −20% on an architecture-summary task) and multi-turn conversations | bench-20260610-124626, bench-20260610-114234 |

## Install

Requires Node **>= 20**.

Install the CLI globally (recommended — also enables relocatable hook commands):

```sh
npm install -g @astudioplus/compressor
```

Or install from source:

```sh
git clone https://github.com/anvanster/compressor.git
cd compressor
npm install
npm run build      # compiles the CLI and bundles the hook entries (dist/hook.js, dist/copilot-hook.js)
npm link           # optional: puts `compressor` on your PATH
```

Without `npm link`, substitute `node /path/to/compressor/dist/cli/index.js` for `compressor` below. Note that the installed hook entries embed the absolute path of this clone — don't move the directory after running `init` (re-run `init` if you do).

## Quickstart

### Claude Code

```sh
cd your-project
compressor init                      # claude-code, mode optimized, project scope
compressor status
compressor set-mode slim             # switch modes
compressor set-mode full             # removes everything — a true baseline
```

What `init` installs at project scope:

- `.claude/output-styles/compressor-<mode>.md` — the instruction pack as an output style (system prompt, cache-friendly)
- `.claude/settings.json` — `outputStyle` set to `compressor-<mode>` (a pre-existing foreign `outputStyle` is stashed and restored on uninstall)
- `.claude/settings.local.json` — the PostToolUse hook entry (`node "<clone>/dist/hook.js" --mode <mode>`, matcher `Read|Bash|Grep|Glob`). It carries a machine-specific absolute path, so it goes in the conventionally gitignored local file, never the shared `settings.json`

With `--global` everything goes to `~/.claude/` instead, hook included in `~/.claude/settings.json`. Changes take effect on the next session (`/clear` or a new session).

### GitHub Copilot

```sh
compressor init --agent copilot              # project: instructions + hook
compressor init --agent copilot --global     # machine-wide hook only (Copilot CLI)
```

Project scope installs a marked section in `.github/copilot-instructions.md` plus a `postToolUse` hook config at `.github/hooks/compressor.json`. Global scope installs the hook to `~/.copilot/hooks/compressor.json` (`$COPILOT_HOME` honored) — instructions have no user-global mechanism in Copilot, so global is hook-only.

The honest caveat (also shown by `compressor status`): **compression is effective in Copilot CLI on this machine only.** The hook command is an absolute local path, so the Copilot cloud agent and teammates who pull a committed `.github/hooks/compressor.json` get a fail-open no-op, and the VS Code IDE surface does not execute hook files at all (instructions still apply there). Copilot `postToolUse` is fail-open by platform design, so a dead command never blocks the agent.

### Cursor

```sh
compressor init --agent cursor
```

Installs `.cursor/rules/compressor.mdc` (`alwaysApply: true`). A legacy `.cursorrules` file gets a marked section only if it already exists — it is never created. **Instructions only**: Cursor's hooks can replace MCP tool output but not built-in Read/Shell output, so the compression half of compressor does not apply.

### AGENTS.md

```sh
compressor init --agent agents-md
```

Upserts a marked section in `AGENTS.md`, read natively by Cursor, Copilot, Codex, Windsurf and others. Claude Code does **not** read AGENTS.md (use the claude-code adapter). Instructions only — no hook mechanism exists through this file.

Multiple agents in one go: `compressor init --agent claude-code copilot agents-md`.

### Support matrix

| Agent | Instruction pack | Compression hook | Global scope |
|---|---|---|---|
| claude-code | yes (output style) | yes (PostToolUse) [^1] | yes (style + hook) |
| copilot | yes (project only) | yes — Copilot CLI on this machine only [^2] | hook only [^3] |
| cursor | yes (`.mdc` rules) | no [^4] | no (per-project standard) |
| agents-md | yes (marked section) | no | no (per-project standard) |

[^1]: At project scope the hook entry lives in `.claude/settings.local.json` because it embeds a machine-specific absolute path.
[^2]: The installed command is an absolute local path: cloud agent and teammates get a fail-open no-op; the VS Code IDE runs no hook files.
[^3]: `~/.copilot/hooks/compressor.json`, loaded by Copilot CLI only; Copilot has no user-global instructions mechanism.
[^4]: Cursor `postToolUse` can replace MCP tool output only; built-in Read/Shell output cannot be rewritten.

## Modes

| Mode | Instructions | Tool-output compression |
|---|---|---|
| `full` | none — `set-mode full` **removes** every compressor artifact and the hook, giving a true baseline rather than "empty instructions present" | none (passthrough) |
| `optimized` | answer-first output discipline plus context discipline (targeted reads, no re-reads, no tool-output echo) — 11 atoms | tier 1 structural (ANSI strip, blank-run collapse, repeated-line dedupe, recoverable truncation at ~5,000 est. tokens) + comment-strip above ~2,000 est. tokens; output below ~600 est. tokens is never touched |
| `slim` | optimized plus code-first responses under a hard ~10% explanation budget — 12 atoms | tiers 1–2 (skeleton view above ~6,000 est. tokens) plus log-aware filtering (test failures + summary, build errors) above ~800 est. tokens; touch floor ~300 |

Every omission is marked, sized, and recoverable — truncation markers state the exact `Read offset/limit` to retrieve the omitted lines, line numbers are never renumbered, and targeted reads (explicit offset/limit) pass through untouched. The hook is fail-open: any error means the original output passes through unchanged. Thresholds are estimated tokens (cheap estimator — used for thresholds only, never for reported savings).

## CLI reference

| Command | What it does | Key flags (defaults) |
|---|---|---|
| `init` | install the instruction pack + hook for the given agents | `--agent <name...>` (`claude-code`), `--mode optimized\|slim` (`optimized`), `--global`, `--dry-run` |
| `set-mode <full\|optimized\|slim>` | switch mode; `full` removes all compressor artifacts (true baseline) | `--agent <name...>` (`claude-code`), `--global`, `--dry-run` |
| `status` | show installation state per agent — derived from files and markers, no state file to drift | `--global` |
| `uninstall` | remove all compressor-owned artifacts | `--agent <name...>` (`claude-code`), `--global`, `--dry-run` |
| `compress` | compress stdin to stdout via the engine; stats on stderr | `--mode` (`optimized`), `--kind read\|bash\|search\|other` (`other`), `--file-path <path>`, `--marker-style plain\|deterrent\|informative` |
| `count <file...>` | token counts per file — estimated by default | `--exact` (Anthropic `count_tokens`, needs `ANTHROPIC_API_KEY`), `--model` (`claude-sonnet-4-6`) |
| `stats` | aggregate actual token usage from Claude Code transcripts | `--project <path>` (cwd), `--since` (`30d`) |
| `savings` | show what the compression hook saved (live ledger, estimated tokens) | `--since` (`30d`, or `all`), `--by day\|tool\|mode` (`day`), `--html <path>`, `--ledger-dir <dir>` |
| `benchmark` | run the benchmark suite: cells = task × variant × trial, results as JSONL | `--suite` (`bench/suites/basic.json`), `--modes` (`full,optimized,slim`), `--trials` (`5`), `--model` (`claude-sonnet-4-6`), `--ablate <ids>`, `--ablate-add <ids>`, `--ablate-group <output\|behavior>`, `--no-hook`, `--hook-args <args>`, `--marker-styles <styles>`, `--concurrency` (`2`), `--max-budget-usd` (`5`), `--out` (`bench/results`) |
| `report` | aggregate a run: per-variant medians + IQR, deltas vs full and vs ablation baselines | `--run <id>` (latest), `--compare <runs...>`, `--format table\|md\|json` (`table`), `--out` (`bench/results`) |
| `hook post-tool-use` | Claude Code PostToolUse protocol entry: payload on stdin, updated output on stdout | `--mode` (`optimized`), `--marker-style` |
| `hook copilot-post-tool-use` | Copilot postToolUse protocol entry: payload on stdin, `modifiedResult` JSON on stdout | `--mode` (`optimized`), `--marker-style` |

## Seeing your savings

Three views, deliberately not conflated:

- **`compressor savings`** — the live ledger. Every time the hook makes a worthwhile compression (at least 200 chars and 10% saved) during a real session, it appends an event to `~/.compressor/ledger/<YYYY-MM>.jsonl`. Events carry **sizes and transform ids only — no file paths, no content**. Token numbers here are estimates from a cheap chars/3.5 estimator and are labelled as such (chars are exact; the roughly 15–20% undercount of Claude tokenization belongs to the `js-tiktoken` estimator used by `count` and `compress`, not to this one). `--html` writes a self-contained report (inline SVG, no JS, no network). Kill switch: `COMPRESSOR_NO_LEDGER=1` disables all recording before any IO. The ledger is fail-open — a broken ledger never breaks your agent.
- **`compressor stats`** — raw token usage aggregated from your local Claude Code transcripts (the authoritative usage fields). Currently shows usage totals, not a before/after comparison.
- **`compressor benchmark`** + **`compressor report`** — the measured numbers. Real `claude` headless sessions in isolated per-cell config dirs, real API usage, binary success checks, budget ceiling, medians + IQR. Everything in the tables above came from here.

## Limitations

Stated plainly, because the alternative is users discovering them:

- **Copilot compression runs in Copilot CLI (and potentially the cloud agent), never the IDE.** With a global npm install, `init` writes relocatable hook commands (`compressor-copilot-hook --mode <m>`) that work on any machine where `@astudioplus/compressor` is on PATH — a committed `.github/hooks/compressor.json` then works for teammates who install the package (and for the cloud agent only if the config is on the default branch *and* the package exists in its environment). Source-checkout installs keep absolute local paths by design (dev builds). The Copilot IDE surface runs no hook files at all.
- **Cursor and AGENTS.md get instructions only.** No mechanism exists to rewrite built-in tool output there.
- **Pagination bimodality: structural fix implemented, not yet measured.** On the huge-log task the agent sometimes paginates (~457k context) and sometimes slurps the file (~248k) regardless of hook arm, and a marker-phrasing experiment failed to move it (run bench-20260610-181302). The hook now budgets recovery reads (the first 3 targeted reads of a previously-truncated file pass through untouched; further ones are compressed; `COMPRESSOR_RECOVERY_BUDGET` tunes, `COMPRESSOR_NO_RECOVERY_BUDGET=1` disables) — whether this moves the bimodality has not yet been benchmarked.
- **Output atoms are unproven in single-shot agentic use.** Ablation showed no marginal effect there; their measured value is prose tasks and multi-turn conversations. No harm measured either.
- **Sample sizes are small.** Most results are 2–4 trials per cell; headline numbers are medians and the per-mode aggregate deltas have overlapping IQRs. Negative and directional results are labelled as such.
- **Benchmarking is a from-source feature.** The npm package ships the CLI, hooks, and library only; `compressor benchmark` needs the repo's `bench/` suites and fixtures.

## Further reading

- **Benchmarking and methodology**: [docs/MEASUREMENTS.md](docs/MEASUREMENTS.md) — harness design, isolation, run records, and how to reproduce the numbers above.
- **Architecture**: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — engine tiers, adapter contracts, hook protocols, and the design decisions behind them.

## License

MIT — see [LICENSE](LICENSE).
