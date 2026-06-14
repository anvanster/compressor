# compressor

Token optimization for AI coding agents. Two parts you install: **mode-switchable instruction packs** (full / optimized / slim) for Claude Code, GitHub Copilot, Cursor, OpenCode, and AGENTS.md-reading agents, and **tool-output compression hooks** that shrink file reads and command output before they enter the model's context. Every optimization is benchmarked against real agent sessions before it ships — current measured numbers, methodology, and the project's mistakes live in [docs/BENCHMARKING.md](docs/BENCHMARKING.md).

## Install

Requires Node **>= 20**.

One-line install from GitHub (builds from source, puts `compressor` on your PATH):

```sh
# macOS / Linux / WSL
curl -fsSL https://raw.githubusercontent.com/anvanster/compressor/main/install.sh | bash
```

```powershell
# Windows (PowerShell)
irm https://raw.githubusercontent.com/anvanster/compressor/main/install.ps1 | iex
```

Pin a tag/branch/commit with `COMPRESSOR_REF` (env var `$env:COMPRESSOR_REF` on Windows), e.g. `COMPRESSOR_REF=v0.3.0`.

Install the CLI globally (recommended — also enables relocatable hook commands):

```sh
npm install -g @astudioplus/compressor
```

Or install from source:

```sh
git clone https://github.com/anvanster/compressor.git
cd compressor
npm install
npm run build      # compiles the CLI and bundles the hook entries
npm link           # optional: puts `compressor` on your PATH
```

Without `npm link`, substitute `node /path/to/compressor/dist/cli/index.js` for `compressor` below. Note that source-checkout installs embed the absolute path of the clone in hook commands — don't move the directory after running `init` (re-run `init` if you do).

## Quickstart

### Claude Code

```sh
cd your-project
compressor init                      # claude-code, mode optimized, project scope
compressor status
compressor set-mode slim             # switch modes
compressor set-mode full             # removes everything — a true baseline
```

`init`, `set-mode`, and `uninstall` modify your agent config files, so they
first show the diff, warn you, and back up every changed file before writing
(in a terminal they also prompt to confirm). Preview without writing using
`--dry-run`; skip the prompt with `--yes`; turn off the backup with
`--no-backup`. Undo the last change with `compressor restore` (or
`compressor restore --list` to pick one).

What `init` installs at project scope:

- `.claude/output-styles/compressor-<mode>.md` — the instruction pack as an output style (system prompt, cache-friendly)
- `.claude/settings.json` — `outputStyle` set to `compressor-<mode>` (a pre-existing foreign `outputStyle` is stashed and restored on uninstall)
- `.claude/settings.local.json` — the PostToolUse hook entry (matcher `Read|Bash|Grep|Glob`). It carries a machine-specific absolute path, so it goes in the conventionally gitignored local file, never the shared `settings.json`

With `--global` everything goes to `~/.claude/` instead, hook included in `~/.claude/settings.json`. Changes take effect on the next session (`/clear` or a new session).

### GitHub Copilot

```sh
compressor init --agent copilot              # project: instructions + hook
compressor init --agent copilot --global     # machine-wide hook only (Copilot CLI)
```

Project scope installs a marked section in `.github/copilot-instructions.md` plus a `postToolUse` hook config at `.github/hooks/compressor.json`. Global scope installs the hook to `~/.copilot/hooks/compressor.json` (`$COPILOT_HOME` honored) — instructions have no user-global mechanism in Copilot, so global is hook-only.

The honest caveat (also shown by `compressor status`): with an absolute-path install, **compression is effective in Copilot CLI on this machine only** — the cloud agent and teammates who pull a committed `.github/hooks/compressor.json` get a fail-open no-op, and the VS Code IDE surface does not execute hook files at all (instructions still apply there). With a global npm install, `init` writes relocatable commands (`compressor-copilot-hook --mode <m>`) that work on any machine where the package is on PATH. Copilot `postToolUse` is fail-open by platform design, so a dead command never blocks the agent.

### Cursor

```sh
compressor init --agent cursor
```

Installs `.cursor/rules/compressor.mdc` (`alwaysApply: true`). A legacy `.cursorrules` file gets a marked section only if it already exists — it is never created. **Instructions only**: Cursor's hooks can replace MCP tool output but not built-in Read/Shell output, so the compression half of compressor does not apply.

### AGENTS.md

```sh
compressor init --agent agents-md
```

Upserts a marked section in `AGENTS.md`, read natively by Cursor, Copilot, Codex, Windsurf, OpenCode and others. Claude Code does **not** read AGENTS.md (use the claude-code adapter). Instructions only — no hook mechanism exists through this file.

### OpenCode

```sh
compressor init --agent opencode            # project: .opencode/plugins/compressor.js
compressor init --agent opencode --global   # machine-wide: ~/.config/opencode/plugins/
compressor init --agent agents-md           # instructions (OpenCode reads AGENTS.md natively)
```

Installs an in-process compression plugin: OpenCode's `tool.execute.after` hook mutates tool output directly (no subprocess — the cheapest hot path of any integration). Plugins load at startup; restart any running opencode session. Instructions come via the agents-md adapter.

Multiple agents in one go: `compressor init --agent claude-code copilot agents-md opencode`.

### Support matrix

| Agent | Instruction pack | Compression hook | Global scope |
|---|---|---|---|
| claude-code | yes (output style) | yes (PostToolUse) [^1] | yes (style + hook) |
| copilot | yes (project only) | yes — Copilot CLI [^2] | hook only [^3] |
| cursor | yes (`.mdc` rules) | no [^4] | no (per-project standard) |
| agents-md | yes (marked section) | no | no (per-project standard) |
| opencode | via agents-md (OpenCode reads `AGENTS.md` natively) | yes — in-process plugin [^5] | yes (`~/.config/opencode/plugins`) |

[^1]: At project scope the hook entry lives in `.claude/settings.local.json` because it embeds a machine-specific absolute path (npm installs with the bins on PATH get relocatable `compressor-hook` commands instead).
[^2]: Absolute-path installs work on this machine only; relocatable installs (global npm) work wherever the package is on PATH. The VS Code IDE runs no hook files.
[^3]: `~/.copilot/hooks/compressor.json`, loaded by Copilot CLI only; Copilot has no user-global instructions mechanism.
[^4]: Cursor `postToolUse` can replace MCP tool output only; built-in Read/Shell output cannot be rewritten.
[^5]: OpenCode plugins run in-process (`tool.execute.after` mutates the tool output string directly) — no subprocess on the hot path. The plugin file format is doc-verified against opencode.ai and the sst/opencode source; not yet live-verified against a running OpenCode install, and `status` says so.

## Modes

| Mode | Instructions | Tool-output compression |
|---|---|---|
| `full` | none — `set-mode full` **removes** every compressor artifact and the hook, giving a true baseline rather than "empty instructions present" | none (passthrough) |
| `optimized` | answer-first output discipline plus context discipline (targeted reads, no re-reads, no tool-output echo) — 11 atoms | tier 1 structural (ANSI strip, blank-run collapse, repeated-line dedupe, recoverable truncation at ~5,000 est. tokens) + comment-strip above ~2,000 est. tokens; output below ~600 est. tokens is never touched |
| `slim` | optimized plus code-first responses under a hard ~10% explanation budget — 12 atoms | tiers 1–2 (skeleton view above ~6,000 est. tokens) plus log-aware filtering (test failures + summary, build errors) above ~800 est. tokens; touch floor ~300 |

Every omission is marked, sized, and recoverable — truncation markers state the exact `Read offset/limit` to retrieve the omitted lines, line numbers are never renumbered, and targeted reads (explicit offset/limit) pass through untouched. The hook is fail-open: any error means the original output passes through unchanged.

## What the savings look like

**A repetitive command output, compressed by the hook before the model sees it.** A 402-line build log becomes 4 lines; the marker tells the model what was collapsed:

```text
[INFO] building module graph... ok
[compressor: previous line repeated 399 more times]
FAIL: type error in engine.ts
Error: exit 1
```

**A large file read, truncated recoverably.** A 916-line file keeps its head and tail; the omitted middle is one marker line carrying the exact retrieval instruction, and original line numbers are preserved so edits and navigation still work:

```text
   354→  max: 100,
[compressor: lines 355-916 omitted (~4749 est tokens) — Read src/telemetry.mjs with offset=355 and limit=562 to retrieve]
   356→  let mask = 0;
```

**Your accumulated savings, from the live ledger.** Every worthwhile compression in a real session (at least 200 chars and 10% saved) appends one privacy-safe event — sizes and transform ids only, never paths or content:

```text
$ compressor savings --by tool
saved 127,041 chars (exact) ≈ 36,300 tokens (estimated — cheap estimator, not billable counts) · last 30 days
events: 8 (last 30 days)

by tool:
  bash  ████████████████████████████████████████  ≈ 35,162 tok
  read  █                                         ≈ 1,138 tok
```

`compressor savings --html report.html` writes a self-contained report (inline SVG, no JS, no network). Kill switch: `COMPRESSOR_NO_LEDGER=1`.

Benchmarked effect sizes (real agent sessions, success-checked): the hook cut context volume **−16%** on log-heavy work, and the instruction packs cut conversational output **−10% to −79%** depending on conversation type, with zero measured quality loss. Effects are domain-specific — full numbers, distributions, run ids, and caveats in [docs/BENCHMARKING.md](docs/BENCHMARKING.md).

## CLI reference

| Command | What it does | Key flags (defaults) |
|---|---|---|
| `init` | install the instruction pack + hook for the given agents | `--agent <name...>` (`claude-code`), `--mode optimized\|slim` (`optimized`), `--global`, `--dry-run`, `--hook-command auto\|absolute\|relocatable` (`auto`: PATH-based `compressor-hook` commands when npm-installed with the bins on PATH; absolute dev-build paths in source checkouts) |
| `set-mode <full\|optimized\|slim>` | switch mode; `full` removes all compressor artifacts (true baseline) | `--agent <name...>` (`claude-code`), `--global`, `--dry-run`, `--hook-command` (as `init`) |
| `status` | show installation state per agent — derived from files and markers, no state file to drift | `--global` |
| `uninstall` | remove all compressor-owned artifacts | `--agent <name...>` (`claude-code`), `--global`, `--dry-run` |
| `compress` | compress stdin to stdout via the engine; stats on stderr | `--mode` (`optimized`), `--kind read\|bash\|search\|other` (`other`), `--file-path <path>`, `--marker-style plain\|deterrent\|informative` |
| `count <file...>` | token counts per file — estimated by default | `--exact` (Anthropic `count_tokens`, needs `ANTHROPIC_API_KEY`), `--model` (`claude-sonnet-4-6`) |
| `stats` | aggregate actual token usage from Claude Code transcripts | `--project <path>` (cwd), `--since` (`30d`) |
| `savings` | show what the compression hook saved (live ledger, estimated tokens) | `--since` (`30d`, or `all`), `--by day\|tool\|mode` (`day`), `--html <path>`, `--ledger-dir <dir>` |
| `hook post-tool-use` | Claude Code PostToolUse protocol entry: payload on stdin, updated output on stdout | `--mode` (`optimized`), `--marker-style`, `--recovery-budget <n\|off>` (overrides `COMPRESSOR_RECOVERY_BUDGET`/`COMPRESSOR_NO_RECOVERY_BUDGET`) |
| `hook copilot-post-tool-use` | Copilot postToolUse protocol entry: payload on stdin, `modifiedResult` JSON on stdout | `--mode` (`optimized`), `--marker-style`, `--recovery-budget <n\|off>` |

Installed hooks run as the dedicated bins `compressor-hook` / `compressor-copilot-hook` (the bundled entries directly — no CLI startup on the hot path); the `compressor hook …` subcommands exist for protocol testing.

The benchmarking commands (`compressor benchmark`, `compressor report`) are a from-source feature for measuring compressor itself — documented in [docs/BENCHMARKING.md](docs/BENCHMARKING.md).

## Seeing your savings

Three views, deliberately not conflated:

- **`compressor savings`** — the live ledger (see the example above). Token numbers here are estimates from a cheap chars/3.5 estimator and are labelled as such; chars are exact. The ledger is fail-open — a broken ledger never breaks your agent.
- **`compressor stats`** — raw token usage aggregated from your local Claude Code transcripts (the authoritative usage fields). Currently shows usage totals, not a before/after comparison.
- **Benchmarks** — the measured before/after numbers, from real headless agent sessions with success checks: [docs/BENCHMARKING.md](docs/BENCHMARKING.md).

## Limitations

Stated plainly, because the alternative is users discovering them:

- **Copilot compression runs in Copilot CLI (and conditionally the cloud agent), never the IDE.** Relocatable installs (global npm) work for teammates who install the package; the cloud agent additionally needs the config on the default branch and the package in its environment. The Copilot IDE surface runs no hook files at all.
- **Cursor and AGENTS.md get instructions only.** No mechanism exists to rewrite built-in tool output there.
- **Compression pays where output is redundant (logs, repeated lines) and can cost where it is dense (code).** The measured hook effect is −16% context on log-heavy work, ~0 on moderate output, and slightly negative on dense code files where the model re-reads truncated content — see [docs/BENCHMARKING.md](docs/BENCHMARKING.md). The recovery-read budget (first 3 targeted re-reads pass through, further ones are compressed; `COMPRESSOR_RECOVERY_BUDGET` tunes, `COMPRESSOR_NO_RECOVERY_BUDGET=1` disables) bounds the re-read cost; its behavioral effect is not yet benchmarked.
- **The OpenCode plugin is doc-verified, not yet live-verified** against a running OpenCode install — `compressor status` says so until it is.

## Further reading

- **Benchmarks and measured results**: [docs/BENCHMARKING.md](docs/BENCHMARKING.md) — current numbers with run ids, how to run the harness, auth modes, and safety rails.
- **Methodology and run record**: [docs/MEASUREMENTS.md](docs/MEASUREMENTS.md) — the full experimental record, including the retracted first corpus and what it taught.
- **Architecture**: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — engine tiers, adapter contracts, hook protocols, and the design decisions behind them.

## License

MIT — see [LICENSE](LICENSE).
