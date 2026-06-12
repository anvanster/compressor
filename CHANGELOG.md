# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-06-11

### Added

- **Relocatable hook commands.** New bins `compressor-hook` and
  `compressor-copilot-hook` run the hook bundles directly (no CLI startup cost).
  When installed from npm with the bins on PATH, `init`/`set-mode` write
  PATH-based hook commands instead of absolute paths — a committed
  `.github/hooks/compressor.json` then works for any machine with the package
  installed. Source checkouts keep absolute dev-build paths (dogfooding tracks
  development). `--hook-command <auto|absolute|relocatable>` for explicit
  control; ownership matching claims both forms, so re-running `init` upgrades
  old absolute installs in place.
- **Recovery-read budget** (structural fix for pagination recovery): after the
  hook truncates a file, the first 3 targeted (offset/limit) reads of that file
  pass through untouched — recovery stays legitimate — and further ones are
  compressed. Session-scoped, fail-open state under the OS temp dir;
  `COMPRESSOR_RECOVERY_BUDGET=<n>` tunes, `COMPRESSOR_NO_RECOVERY_BUDGET=1`
  disables. Effect on the measured huge-log bimodality not yet benchmarked.
- `--dry-run` now prints the body of newly created files (capped at 40 lines).

### Fixed

- Hook entries always exit 0 on stdout EPIPE (parent closing the pipe early no
  longer surfaces a hook error).
- Copilot global uninstall prunes the empty `~/.copilot/hooks` directory it
  created and never deletes a pre-existing user config whose `version` differs
  from the one compressor writes (or that carries unknown top-level keys).
- Engine skeleton view retains top-level `const`/`let`/`var` arrow-function
  declarations in TS/JS files.
- Test-suite hermeticity: no test writes the developer's real savings ledger.

## [0.1.2] - 2026-06-10

### Changed

- `compressor status` is clearer: it now names the scope it reports on
  (`project: <cwd>` or `user-level (machine-wide)`), so a global package install
  in an unconfigured directory no longer reads as "broken". Redundant
  "not installed — not installed" lines collapse to "not installed", and a
  cross-scope install renders as "not installed (global); installed at project
  level" instead of the contradictory "installed — not installed (global)".
  When nothing is configured, status prints the `init` command to run.

## [0.1.1] - 2026-06-10

### Fixed

- Package-root discovery keyed on the literal name `compressor`, so after the
  rename to `@astudioplus/compressor` every CLI command threw "could not locate
  the compressor package root" when installed from npm. Discovery now keys on the
  `compressor` bin entry, which survives any scope/name change. Regression test
  added. (0.1.0 was unusable when installed; 0.1.1 is the first working release.)
- `compressor --version` now reports the package version.

## [0.1.0] - 2026-06-10

Initial release. (Broken when installed from npm — see 0.1.1.)

### Added

#### Engine
- Pure, dependency-free compression engine: `compress(content, meta, policy, estimator)` with injected token estimator.
- Tier 1 (structural): ANSI stripping, blank-run collapse, repeated-line dedupe, head/tail truncation with recoverable markers stating exact `Read offset/limit`.
- Tier 2 (code-aware): comment/blank-line stripping with original line numbers preserved; skeleton view (imports + signatures) above threshold.
- Tier 3 (log-aware, slim only): test logs reduced to failures + summary, build logs to errors/warnings + status.
- Per-mode policy thresholds; targeted reads (explicit offset/limit) always pass through; idempotency guard on the omission marker; fail-open on any error.
- Content-kind detection (code / test log / build log / generic) and configurable marker styles (plain / deterrent / informative).

#### Packs
- Instruction atoms (`{id, category, text, modes}`): 13 active output- and behavior-discipline atoms composing the `optimized` and `slim` modes; `full` removes all artifacts for a true baseline.
- Rejected atoms retained in the catalog with empirical rationale (e.g. `tokens.drop-articles`), reproducible via benchmark `--ablate-add`.
- Deterministic renderers (no timestamps, byte-stable for prompt caching) with embedded atom-ID manifests: Claude Code output style, Copilot/AGENTS.md/legacy-`.cursorrules` marked sections, Cursor `.mdc`.

#### Adapters
- `claude-code`: output style + `outputStyle` settings entry + surgical PostToolUse hook merge; project hook entry written to `.claude/settings.local.json`; foreign `outputStyle` stashed and restored on uninstall; project and global scope.
- `copilot`: marked section in `.github/copilot-instructions.md` + `postToolUse` hook config in `.github/hooks/compressor.json`; `--global` installs a machine-wide hook to `~/.copilot/hooks/` (`$COPILOT_HOME` honored).
- `cursor`: `.cursor/rules/compressor.mdc` (`alwaysApply`); legacy `.cursorrules` updated only when pre-existing (instructions only).
- `agents-md`: marked section in `AGENTS.md` (instructions only).
- Shared conventions: marker-based idempotent upserts, ownership predicates that never touch foreign entries, `--dry-run` diffs, `status` derived from files with honest per-agent capability notes.

#### Hooks
- Claude Code PostToolUse hook (`dist/hook.js`, bundled, no CLI dependency): shape-preserving replacement of `tool_response` via `updatedToolOutput`; matcher `Read|Bash|Grep|Glob`; fail-open.
- Copilot CLI `postToolUse` hook (`dist/copilot-hook.js`): `toolResult.textResultForLlm` in, `modifiedResult` out; self-filters by tool name (no matcher support); fail-open.
- Shared protocol-independent hook core (leaf picking, worthwhileness floor of 200 chars / 10%, shape-preserving rebuild).

#### Benchmark harness
- Runner driving headless `claude --bare -p` per cell (task × variant × trial) with per-cell `CLAUDE_CONFIG_DIR` isolation, pinned and verified served model, cost ceiling with no-cost circuit breaker, and data-quality flags.
- Token accounting from result JSON and session transcripts (deduped, sidechains included) — never from estimators.
- Binary success checks per task; suites (`basic`, `main`, `hookab`, `ablate`, `interactive`) with zero-dependency fixtures.
- Ablation variants: per-atom (`--ablate`), rejected-atom demonstration (`--ablate-add`), category groups (`--ablate-group`), `--no-hook` arms, and marker-style fan-out (`--marker-styles`).
- `report`: per-variant medians + IQR, deltas vs full and vs ablation baselines, run comparison, table/md/json output.

#### Ledger and savings
- Append-only local savings ledger written by the hooks: monthly JSONL under `~/.compressor/ledger/`, sizes and transform ids only (no paths, no content), fail-open, `COMPRESSOR_NO_LEDGER=1` kill switch.
- `savings` command: totals and day/tool/mode breakdowns with explicit "estimated" labelling and window labels; optional self-contained HTML report (inline SVG, no JS).
- `stats` command: actual usage aggregated from local Claude Code transcripts.
- `count` command: estimated token counts per file, `--exact` via the Anthropic `count_tokens` endpoint.

[0.2.0]: https://github.com/anvanster/compressor/releases/tag/v0.2.0
[0.1.2]: https://github.com/anvanster/compressor/releases/tag/v0.1.2
[0.1.1]: https://github.com/anvanster/compressor/releases/tag/v0.1.1
[0.1.0]: https://github.com/anvanster/compressor/releases/tag/v0.1.0
