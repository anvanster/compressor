# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.0] - 2026-09-12

### Added

- **The CLI hooks now attribute their savings to a project.** `compressor
  savings --by project` and the HTML report were added in 0.4.0 but only the VS
  Code extension populated the field, so everything a hook recorded grouped
  under `unattributed`. Hook events now carry a label for the agent's working
  directory, using the same key and algorithm as the extension
  (`~/.compressor/project-salt`), so one folder gets one label whichever tool
  recorded the event.
  The key is read synchronously: a hook process often lives for a single tool
  call, and an asynchronous load would miss the only event it will ever record.
  A missing key costs that run its label and is created in the background for
  the next one; labelling never blocks or breaks a hook.
  `COMPRESSOR_PROJECT_LABEL=name` opts into clear-text folder names, matching
  the extension's `compressor.projectLabel`; hashed remains the default because
  a savings report gets shared. New exports: `currentProjectLabel` and
  `readProjectSaltSync`.

## [0.4.0] - 2026-09-11

### Added

- **Per-project savings attribution.** `LedgerEvent` gained an optional
  `project` label, `readLedger` now carries it through, and `aggregateSavings`
  accepts a `'project'` dimension (with `UNATTRIBUTED` for events that have no
  label — exported so every consumer groups them under one spelling rather than
  splitting the bucket). `renderSavingsHtml` adds a **by project** chart, but
  only once some event carries a label, so existing ledgers do not gain a chart
  with a single meaningless bar; `foldTail` and `PROJECT_ROW_LIMIT` cap it so a
  machine with many repos does not produce an unbounded SVG. The field is
  optional in both directions: older ledgers read unchanged, and older library
  versions reading a newer ledger simply ignore it, so no migration is needed.
  Nothing in the CLI populates the field yet — the VS Code extension is the
  first writer — so `compressor savings` gains the section only once a writer
  starts recording labels.
- **Shared project labelling, with a machine-local key.** New
  `src/ledger/project.ts`: `projectLabel`, `ensureProjectSalt`,
  `readProjectSalt`, `resolveProjectSaltPath`, `normalizeProjectLabelMode`,
  `HASHED_PREFIX` and `ProjectLabelMode`. Labels default to a keyed SHA-256
  digest of the workspace path, because a savings report gets shared and plain
  digests of guessable project names could be brute-forced. The key is created
  on first use at `~/.compressor/project-salt` (owner-only, `COMPRESSOR_PROJECT_SALT`
  to override) and is deliberately **not** derived from `COMPRESSOR_LEDGER_DIR`:
  the ledger directory is the shareable unit, so the key must never sit inside
  it. Creation is exclusive and a loser adopts the winner's key, so a hook
  process and the editor racing at first use cannot end up with two keys and
  split one project into two rows. A key that cannot be read or created yields
  no label at all rather than an unsalted digest. The labeller lives here, not
  in a consumer, so every writer into one ledger produces the same label for the
  same folder. All of it is exported from the package root, with a regression
  test pinning that surface (see 0.3.3). `compressor savings --by project` selects
  the new dimension in the terminal too, folded to the same row cap as the HTML
  report so both surfaces agree.

### Changed

- **The ledger's privacy contract now names its one identifying field.** The
  header on `ledger/write.ts` still promises sizes and transform ids only, and
  now states that `project` is the sole exception, that it is never a path, and
  that a writer recording a readable name must make it an explicit opt-in —
  because every writer shares one ledger and the weakest one sets the privacy of
  the whole file.
- **`parseEvent` drops a bad project label instead of rejecting the line.**
  Every other malformed field still discards the whole event; throwing away real
  savings data over a cosmetic label would contradict the ledger's fail-open
  posture. Labels are validated as non-empty, within `PROJECT_LABEL_MAX` (64,
  the width the bar chart is sized for) and free of control characters. Unknown
  fields are still discarded: the rebuild remains a whitelist, since the ledger
  is a file users share and re-import and the report renders it.

## [0.3.4] - 2026-06-16

### Added

- **Lossless JSON-minify tier + MCP tool reach.** Tool output that is JSON is
  now losslessly minified — a string-aware whitespace strip that preserves every
  number/string byte-exact (never `JSON.parse`→`stringify`, so big ints, `1e10`,
  and trailing zeros survive intact), routed so JSON never reaches the line-based
  tiers that would corrupt it, and failing open on any doubt. Enabled in
  `optimized` and `slim` (`full` untouched). The Claude Code PostToolUse hook
  matcher now also covers MCP tools (`Read|Bash|Grep|Glob|mcp__.*`), so the tier
  reaches MCP JSON output — measured ~12% of tool-output tokens, previously
  unreachable. Verified lossless on 890 real tool outputs (0 corrupted). Existing
  installs need to re-run `compressor init` to pick up the new matcher.
- **`compressor benchmark --competitor <name>`** — add a third-party
  instruction pack as an output-only arm for a head-to-head. The real upstream
  pack loads from `<suiteDir>/../competitors` and is delivered via the same
  output-style channel as compressor (only the instruction body differs; no
  hook, since these tools are output-shaping). Ships `caveman` (the viral
  juliusbrussee/caveman skill) and `bench/suites/caveman.json`. First result in
  [docs/COMPRESSOR-VS-CAVEMAN.md](COMPRESSOR-VS-CAVEMAN.md): at 100% success on
  every arm, compressor cut ~49–52% of token cost vs Caveman's ~42%, and on the
  log-heavy task Caveman *increased* context (+19%) where compressor's hook cut
  it −25%.

## [0.3.3] - 2026-06-14

### Fixed

- **Export the backup/restore API from the package root.** 0.3.2 shipped the
  backup module but only re-exported it on the internal adapters barrel, so
  consumers importing from `@astudioplus/compressor` (the VS Code extension)
  could not reach `applyWithBackup` / `writeBackup` / `listBackups` /
  `readManifest` / `planRestore` / `resolveBackupDir` (or the `ApplyOptions` /
  `ApplyResult` / `BackupManifest` / `BackupSummary` types). They are now
  exported from the root, with a regression test pinning the public surface.

## [0.3.2] - 2026-06-14

### Added

- **Backups + a confirmation step for the file-mutating commands.** `init`,
  `set-mode`, and `uninstall` now back up every file they change (the recorded
  `before` state, as a JSON manifest under `~/.compressor/backups`, override
  with `COMPRESSOR_BACKUP_DIR`) BEFORE writing, warn that config files will
  change, and — in an interactive terminal — prompt to confirm. If the backup
  can't be written, nothing is modified. New flags: `--yes` (skip the prompt)
  and `--no-backup`. New `compressor restore` command (`--list`, `--from
  <file>`, `--dry-run`, `--yes`) undoes a change set; the restore is itself
  backed up first. Library exports: `applyWithBackup`, `writeBackup`,
  `listBackups`, `readManifest`, `planRestore`, `resolveBackupDir`.

## [0.3.1] - 2026-06-13

### Added

- **`by agent` breakdown in `compressor savings`.** The report (HTML + the VS
  Code webview) now renders a fourth section grouping savings by the agent that
  produced them, and the terminal supports `compressor savings --by agent`.
  Agents get friendly labels — `Claude Code`, `Copilot CLI`, `Copilot (VS Code)`
  (the extension's tools), `OpenCode` — so a single shared ledger makes it clear
  which surface saved what. `SavingsDimension` gains `'agent'`.
- **Engine primitives exported** from the package root — `skeleton`,
  `stripComments`, `langFromPath`, `hasLineNumbers`, and the `CodeLang` type —
  so consumers can build specialized read tools (the VS Code extension's code
  outline uses `skeleton` directly).

### Changed

- **Savings report adapts to the active editor theme.** Report colors and font
  are driven by `--vscode-*` variables with the previous values as fallbacks,
  so the VS Code webview is readable on any color scheme; the standalone
  `compressor savings --html` artifact renders identically in a browser.
- **Savings report bars are now two-tone and self-sizing.** Each bar's full
  length encodes the total original tokens (`estTokensIn`) and a bright accent
  segment shows the saved portion within it — a clearer "how much of this did
  compressor remove" visual. The per-row value moved to a fixed column whose
  width is sized into the SVG, fixing the truncated `(103,…`/`(105,…` labels.
  The left label column likewise auto-sizes to the longest label, so long
  `by agent` labels like `Copilot (VS Code)` no longer clip off the left edge.
  Applies to both the HTML report (`compressor savings --html` and the VS Code
  webview) and the terminal view (`█` saved / `░` remaining, `saved / total
  tok`). `SavingsRow` gains `totalChars`/`totalTokens`; bars carry a `<title>`
  hover with the full chars breakdown.

## [0.3.0] - 2026-06-12

### Fixed

- **Benchmark validity: cells no longer run `claude --bare`.** Probes proved
  `--bare` silently ignores output styles (both scopes) and hooks (settings
  file and `--settings`) while honoring `permissions` — every prior benchmark
  arm was an identical unstyled, hookless baseline, and the entire pre-2026-06-11
  results corpus is retracted (see docs/MEASUREMENTS.md). Isolation now rests on
  the per-cell `CLAUDE_CONFIG_DIR`, verified to also isolate credentials.
- **Treatment-delivery canaries** gate every real benchmark run: a micro-cell
  must show the canary output style visibly shaping a reply and a canary
  PostToolUse hook observably firing, or the run refuses to start.

### Added

- `benchmark --auth <api|subscription>`: subscription mode bills the operator's
  Claude plan via `CLAUDE_CODE_OAUTH_TOKEN` (`claude setup-token`), with a
  group-atomic `--max-cells` ceiling, token-consumption progress, an
  error-streak breaker, `authMode` in run meta, and report cost columns
  labelled as API-equivalent figures.
- Same-run experiment arms: `--hook-arg-arms '<label>=<args>,…'` (per-arm hook
  arguments) and `--hook-arms` (hook-on/off with instructions held constant).
- Hook entries accept `--recovery-budget <n|off>` (argv overrides the
  `COMPRESSOR_RECOVERY_BUDGET`/`COMPRESSOR_NO_RECOVERY_BUDGET` env vars), which
  is how benchmark arms vary the recovery budget.
- **OpenCode adapter** (`init --agent opencode`): installs a self-contained
  in-process compression plugin at `.opencode/plugins/compressor.js` (project)
  or `~/.config/opencode/plugins/` (global) — OpenCode's `tool.execute.after`
  hook mutates tool output directly, no subprocess on the hot path. Ledger
  events carry agent `opencode`; the recovery budget works via the in-band
  session id. Instructions reach OpenCode through the existing agents-md
  adapter (it reads `AGENTS.md` natively). Plugin format doc-verified against
  opencode.ai and the sst/opencode source; not yet live-verified, and `status`
  says so.

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

[0.3.0]: https://github.com/anvanster/compressor/releases/tag/v0.3.0
[0.2.0]: https://github.com/anvanster/compressor/releases/tag/v0.2.0
[0.1.2]: https://github.com/anvanster/compressor/releases/tag/v0.1.2
[0.1.1]: https://github.com/anvanster/compressor/releases/tag/v0.1.1
[0.1.0]: https://github.com/anvanster/compressor/releases/tag/v0.1.0
