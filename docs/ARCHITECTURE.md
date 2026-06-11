# Architecture

compressor reduces the token spend of AI coding agents through three coordinated mechanisms:

1. **Instruction packs** (output side) — mode-switchable instruction atoms installed into each agent's native configuration surface.
2. **A tool-output compression hook** (input side) — a per-tool-call hook that shrinks tool results before they enter the model's context.
3. **A benchmark harness** — every optimization claim is measured against a real agent on real tasks, or it is labelled an estimate.

Three operating modes: **full** (no optimization — `set-mode full` *removes* all compressor artifacts, so the baseline is genuinely empty, not "empty instructions present"), **optimized** (concise output + context discipline + conservative compression), and **slim** (code-first responses + aggressive compression including log filtering).

This document is the map a contributor should read before touching anything.

---

## 1. Design principles

Each principle comes with its enforcement mechanism — a principle without one is a wish.

### Pure engine

`src/engine/` is pure functions: `compress(content, meta, policy, estimate) → {content, stats}`. No IO, no tool schemas, no dependencies — the token estimator is **injected** as a function parameter (`Estimator`), so the engine never imports `js-tiktoken` or anything else outside its own directory. The CLI and hook layers do all IO and all per-tool shape handling. Enforced by construction: the engine's import graph is closed over `src/engine/`, and the package exposes it as a standalone subpath export (`compressor/engine`) for a future proxy consumer.

### Fail-open hooks

A broken hook must never break the user's agent. Enforcement is layered:

- Every protocol handler (`src/hook/post-tool-use.ts`, `src/hook/copilot.ts`) and the shared core (`src/hook/core.ts`) wraps its work in catch-all blocks that return "emit nothing" — and for both platforms, no stdout + exit 0 means the original tool output passes through untouched.
- The exit path (`src/hook/exit.ts`) writes stdout *first*, then races pending ledger writes against a hard 250 ms cap; on timeout it terminates with SIGKILL (kernel-level, bypasses a libuv threadpool join that a hung network filesystem could otherwise wedge forever). The resulting non-zero exit makes the host ignore the call's output — which is still fail-open.
- Platform semantics, verified against live documentation: Claude Code's PostToolUse cannot block a tool result, and Copilot's `postToolUse` is fail-open **by platform design**. Copilot's `preToolUse` is fail-closed and is never used for compression.
- Install refuses to write a hook command whose bundle is missing on disk (`src/paths.ts`) — a fail-open hook with a dead command is a silent no-op, which is worse than an error at install time.

### Ownership discipline

compressor edits files it does not own, so it must be able to prove which bytes are its own:

- **Marked sections** — instruction text in shared files (`.github/copilot-instructions.md`, `AGENTS.md`, legacy `.cursorrules`) lives between `<!-- compressor:begin mode=<m> v=1 -->` and `<!-- compressor:end -->`. The begin marker is matched against a full-line grammar (never a prefix match), and marker lines inside closed fenced code blocks are ignored (`src/adapters/markers.ts`), so user prose can never be mistaken for a section boundary.
- **Owned files** — artifacts compressor creates wholesale (output-style files, `.cursor/rules/compressor.mdc`, `.github/hooks/compressor.json`) carry compressor's name and are overwritten/deleted without markers.
- **Exact-command predicates** — hook entries in shared JSON config are recognized by exact match on the resolved absolute command (any `--mode` value, with tolerance for a legacy unquoted form). Generic substrings such as `dist/hook.js` are deliberately *not* treated as ours: other tools use the same bundling layout.
- **Uninstall round-trips** — `init` → `uninstall` leaves `git diff` empty. A pre-existing foreign `outputStyle` value is stashed inside the rendered style file and restored on uninstall; foreign hook entries and foreign hook events are preserved verbatim; files compressor may not have created (`AGENTS.md`, `.cursorrules`, `copilot-instructions.md`) are never deleted, only de-sectioned.

### Byte-determinism of rendered artifacts

Prompt caching is strict prefix-match (doc-verified), so artifact churn can cost more than the instructions save. Rendered artifacts are pure functions of `(mode, agent)`: no timestamps, no hostnames, an explicit curated atom order (`MODE_ORDER` in `src/packs/modes.ts`) so object-key order can never reorder output. Same input, same bytes. Mode switches apply at session start (output styles are read once per session), which neutralizes in-session cache invalidation by construction.

### Measured or it doesn't ship

Every atom and threshold either carries benchmark data or is labelled an estimate. Rejected atoms stay in the codebase with their rejection rationale (and run id, once measured) so nobody re-adds them. The savings ledger reports estimated tokens and says so in every rendering; the only numbers presented as measured come from the benchmark harness, which reads authoritative usage fields from the agent's own result JSON and transcripts. Negative results are kept: the marker-phrasing experiment (run `bench-20260610-181302`) and `tokens.drop-articles` (run `bench-20260610-124626`) are both documented below as failures.

---

## 2. Module map

| Area | Responsibility |
|---|---|
| `src/engine/` | Pure compression: content-kind detection, per-mode policy, tier transforms (`tiers/structural.ts`, `tiers/code.ts`, `tiers/logs.ts`). No IO, no dependencies. |
| `src/tokens/` | Token counting, three sources never conflated: `cheapEstimator` (chars/3.5, hook hot path), `tiktokenEstimator` (lazily loaded, thresholds/UX only — undercounts Claude ~15–20%), `count_tokens` API (exact, optional). |
| `src/packs/` | Instruction atoms (`atoms.ts`, including rejected ones), mode composition (`modes.ts`), deterministic rendering per agent (`render.ts`). |
| `src/adapters/` | Per-agent install/uninstall/status/detect (`claude-code.ts`, `copilot.ts`, `cursor.ts`, `agents-md.ts`), marked-section machinery (`markers.ts`), change application and diff rendering for `--dry-run` (`apply.ts`). |
| `src/hook/` | Hook protocol layers: Claude Code (`post-tool-use.ts`), Copilot (`copilot.ts`), the protocol-independent core (`core.ts`), and the shared bounded exit path (`exit.ts`). |
| `src/claude/` | Claude Code transcript parsing — per-session usage from `~/.claude/projects/<encoded-cwd>/<session>.jsonl`, deduped by `requestId`, sidechains included. |
| `src/ledger/` | Append-only live savings ledger: fail-open writer (`write.ts`), tolerant reader (`read.ts`). |
| `src/bench/` | Benchmark harness: suite loading (`tasks.ts`), cell execution (`cell.ts`), scheduling/budget (`runner.ts`), ablation variants (`ablate.ts`), JSONL results + aggregation (`results.ts`). |
| `src/cli/` | `commander` wiring only (`index.ts`); one module per command under `commands/` (init, set-mode, status, uninstall, compress, count, stats, savings, benchmark, report, hook). |
| `src/hook-entry.ts`, `src/copilot-hook-entry.ts` | Standalone hook entry points, bundled by esbuild to `dist/hook.js` / `dist/copilot-hook.js` — no commander, no SDK, fast cold start. |
| `src/paths.ts` | Resolves the absolute hook commands and the package root; refuses to install missing bundles. |
| `src/index.ts` | Public API surface (engine, tokens, transcripts re-exports). |

Not yet published to npm — install is from source (`npm install && npm run build`).

---

## 3. Compression engine

`compress(content, meta, policy, estimate)` applies tiers in order; each tier is skipped unless the policy enables it and the content is over the relevant threshold.

### Tiers

| Tier | Transforms | Loss profile |
|---|---|---|
| 0 — passthrough | none | none |
| 1 — structural | strip ANSI/C0 controls; collapse blank runs (3+ → one); dedupe consecutive repeated lines (3+ → line + `[compressor: previous line repeated N more times]`); head/tail truncation over budget with a recoverable marker | near-lossless; every omission self-describing and recoverable |
| 2 — code-aware | strip comment-only/blank lines **preserving original line numbers**; skeleton view (imports + signatures, per-gap markers) above a larger threshold | lossy for comments/bodies; Edit string-matching and line navigation stay intact |
| 3 — log-aware | test logs → failures + summary; build logs → errors/warnings + status; unrecognized formats untouched | lossy; deterministic rules only |

Truncation runs last; because earlier tiers delete lines, the truncation marker trusts embedded Read line-number prefixes (`123→`) as authoritative for file coordinates and falls back to array positions only when no line-removing tier has run — otherwise it emits a count-based marker with no offset/limit claim.

### Policy thresholds (per mode, estimated tokens)

Transcribed from `src/engine/policy.ts` (`policyFor`):

| Mode | structural | codeAware | logAware | touch | truncateBudget | commentStrip | skeleton | logFilter |
|---|---|---|---|---|---|---|---|---|
| full | off | off | off | ∞ | ∞ | ∞ | ∞ | ∞ |
| optimized | on | on | off | 600 | 5,000 | 2,000 | ∞ | ∞ |
| slim | on | on | on | 300 | 5,000 | 1,000 | 6,000 | 800 |

Content below `touch` is never modified. Optimized deliberately does no log filtering — lossy tier 3 is slim-only. The slim `truncateBudget` of 5,000 is measured, not chosen: a 2,500 budget pushed the model into offset/limit pagination, and since targeted reads pass through by design, the recovery re-reads nullified all savings — the worst cell exceeded the uncompressed baseline (runs `bench-20260610-114234`, `bench-20260610-123102`). 5,000 stays under the recovery trigger.

### Marker styles

Three omission-marker phrasings exist (`plain`, `deterrent`, `informative`); **`plain` is the default everywhere**. The other two were built for the pagination-bimodality experiment — `deterrent` frames recovery as conditional, `informative` reports whether the omitted region contains error/failure/warning lines. The experiment came back **negative** (run `bench-20260610-181302`, 3 arms × 3 heavy tasks × 3–4 trials): marker phrasing does not move pagination behavior (the observed trend was the opposite of the intended one, within binomial noise at n=3). The styles and the `--marker-styles` benchmark fan-out are retained for future arms; the bimodality (paginate vs slurp on huge files) remains an open problem and likely needs a structural fix, not wording.

### Safety rules

- **Targeted-read passthrough** — when the model explicitly requested a range (Read `offset`/`limit`), the result passes through untouched. The model asked for exactly this; cutting it would be hostile.
- **Idempotency** — content already containing the omission marker (`[compressor:`) is never re-compressed, so `compress ∘ compress = compress` and recovered reads are never re-cut.
- **Recoverable markers** — every omission is marked, sized in estimated tokens, and carries an exact retrieval instruction (`Read <file> with offset=A and limit=N`, or "re-run with a narrower filter" for non-file content). Line numbers are never renumbered.
- **Marker-stripped decision math** — threshold checks, truncation boundaries, and the hook's savings floor are all computed over content *excluding marker lines*. Marker text is the experiment's treatment: the styles differ in length, and a marker-inclusive measurement would make arms diverge in *which lines they keep* (or whether they compress at all near a floor), not just in marker wording. The engine's `decide()` estimator and the hook core's `lengthSansMarkers` both enforce this; every style inserts the same *number* of marker lines, so decisions are identical across styles.

---

## 4. Instruction packs

### Atom model

Atoms, not blobs: each instruction is `{id, category: 'output' | 'behavior', text, modes, agents?}` in `src/packs/atoms.ts`. Modes are atom compositions; rendered artifacts embed an atom-ID manifest comment (`<!-- atoms: ... -->`) so `status` can report exactly what is installed and the benchmark can ablate atoms individually (`--ablate`), by category (`--ablate-group`), or add rejected ones back (`--ablate-add`). Render order is a curated explicit list, so output bytes are stable.

Active atoms: 8 output-category (`out.no-preamble`, `out.no-postamble`, `out.answer-first`, `out.no-recap`, `out.no-code-echo`, `out.minimal-formatting` — optimized only; `out.explanation-budget`, `out.code-only-default` — slim only) and 5 behavior-category (`beh.targeted-reads`, `beh.no-reread`, `beh.no-tool-echo`, `beh.surgical-edits`, `beh.bounded-commands`).

### Measured verdict: behavior atoms carry the effect

Group ablation (run `bench-20260610-124626`, 9 tasks × 2 trials, 100% task success in all variants):

- **Behavior atoms** (context discipline) are the only instruction category with a measured marginal effect: removing them cost +6.6% output overall, and on the wide-refactor task output doubled (6,003 → 11,697 tokens).
- **Output atoms** showed no measurable marginal effect in single-shot agentic runs (−2.6%, within noise). Their proven value case is prose tasks — slim cut the summarize-architecture task's output by 20% (run `bench-20260610-114234`) — and they are kept on that basis, documented honestly: unproven in single-shot agentic use, no harm measured.
- In **multi-turn conversations** the packs do considerably better: optimized −11% to −24% output versus full (slim −5% to −25%) on three of the four conversation tasks, at 100% success (run `bench-20260610-183001`; the fourth, add-function, was +3–4% — noise) — roughly 2–4× the single-shot effect (−5.6% optimized / −2.3% slim, run `bench-20260610-114234`), because per-turn recap suppression compounds across turns. Prose turns that *request* explanation correctly stay full-length in all modes.

### Rejected atoms

Rejected atoms stay in `atoms.ts` with rationale (transcribed here) so nobody re-adds them; `--ablate-add` exists to re-test them against data.

| Atom | Rejection rationale |
|---|---|
| `tokens.drop-articles` ("omit articles and filler words") | ~1 token saved per article, output-only; degrades grammar and pushes the model off its training distribution for single-digit savings. Empirically refuted: run `bench-20260610-124626` measured optimized-plus-tokens-drop-articles at −2.2% output vs optimized — noise, no benefit on top of a concise baseline. |
| `tokens.no-politeness-words` ("never say please/thank you") | Micro-optimization already subsumed by `out.no-postamble`; word-level bans distract the model more than they save. |

### Render targets

| Agent | Artifact form |
|---|---|
| claude-code | Output style file `compressor-<mode>.md`: frontmatter (`description`, `keep-coding-instructions: true` — the default is false and would drop the built-in engineering prompt), manifest comment, sections "Code-first responses" (slim), "Output discipline", "Context discipline". Activated via `outputStyle` in settings. |
| copilot, agents-md, legacy `.cursorrules` | Marked section: begin marker + manifest + `## Response & context discipline (compressor)` + atom bullets. |
| cursor | `.cursor/rules/compressor.mdc`: mandatory frontmatter (`description` doubles as the mode manifest, `alwaysApply: true`) + manifest + bullets. A plain `.md` in that directory is silently ignored by Cursor. |

---

## 5. Hook protocols

Two protocol layers share one core. Protocol facts below are doc-verified against the live vendor documentation; payload field names, tool-name mapping, and response envelopes live in the protocol layers — the core never sees them.

### Claude Code — PostToolUse (`dist/hook.js`)

| Aspect | Behavior (doc-verified) |
|---|---|
| Config surface | `hooks.PostToolUse` entry with matcher `Read\|Bash\|Grep\|Glob`; command `node "<pkg>/dist/hook.js" --mode <m>` (absolute path resolved at install time — works without a global npm install, faster cold start) |
| stdin payload | snake_case: `tool_name`, `tool_input`, `tool_response` (the tool's **structured output object**, schema varies per tool), `tool_use_id`, `duration_ms` |
| Replacement | `{"hookSpecificOutput": {"hookEventName": "PostToolUse", "updatedToolOutput": …}}` — **must match the tool's output shape** (e.g. Bash: `{stdout, stderr, interrupted, isImage}`) |
| No-op | emit nothing, exit 0 — original output passes through |
| Firing | tool **success** only; PostToolUseFailure is a separate event, so failures pass through uncompressed — correct, error output is diagnostic |
| Non-mechanisms | `decision: "block"` is not used for compression (the model still sees the original output); `updatedMCPToolOutput` exists for MCP tools but `updatedToolOutput` works for all |
| Settings merge | hooks and permissions **merge across settings scopes** — a `--settings` file alone cannot silence the user's global hooks. Consequence one: at project scope our machine-specific hook command is written to `.claude/settings.local.json` (personal, conventionally gitignored), never the shared `settings.json`; global scope keeps everything in `~/.claude/settings.json`. Consequence two: the benchmark must isolate with `--bare`, not `--settings` alone. |

### Copilot — postToolUse (`dist/copilot-hook.js`)

| Aspect | Behavior (doc-verified) |
|---|---|
| Config surface | `.github/hooks/compressor.json` (project; any `<name>.json` in that directory is read) or `<copilotHome>/hooks/compressor.json` (user scope, CLI ≥ 1.0.21; `$COPILOT_HOME` honored, absolute paths only) |
| Fail-open semantics | `postToolUse` is fail-open **by platform design** (non-zero exit, timeout, dead command ⇒ original result stands). `preToolUse` is fail-closed — never used for compression. |
| stdin payload | camelCase dialect (event registered as `postToolUse`): `{sessionId, timestamp, cwd, toolName, toolArgs, toolResult: {resultType: "success", textResultForLlm}}`. The PascalCase event-name dialect uses snake_case fields instead. `toolArgs` is typed `unknown` in the reference and arrives on the wire as a JSON-encoded string in the CLI docs' example — both forms are accepted, anything else degrades to "no file path, not targeted" (conservative). |
| Replacement | `{"modifiedResult": {"resultType": "success", "textResultForLlm": …}}` — the schema carries exactly one string |
| Tool filtering | no matcher support: the hook filters by `toolName` itself (`view` → read, `bash`/`powershell` → bash, `grep`/`glob` → search, anything else → other) |
| Success-only guard | fires only after successful tool calls; if a non-success result ever arrives the hook emits nothing — emitting `modifiedResult` (which forces `resultType: "success"`) would rewrite a failure into a success |
| Entry shape | `{type: "command", bash: <cmd>, powershell: <cmd>, timeoutSec: 10}` — both platform keys; the timeout is capped well under the 30 s default so a wedged process cannot stall the agent |
| Surfaces (limitation) | hook files run in Copilot **CLI and cloud agent only**; the IDE runs none. The installed command is an absolute path on the installing machine, so compression is effective in **Copilot CLI on this machine only** — for the cloud agent or a teammate's clone the entry is a dead command that degrades to a fail-open no-op. `status` says so rather than implying a cloud benefit. |

### Shared core (`src/hook/core.ts`)

- **Savings floor** — a rewrite is applied only when it clears *both* floors: at least 200 saved chars *and* at least 10% of the input. Below either floor the saving is noise, and the hook leaves the output alone rather than churn the context (and the prompt cache). The floors are measured marker-stripped (see §3).
- **Shape preservation** — `pickLeaf` finds the single compressible string in a response of unknown shape: a bare string directly, a Bash `stdout` field when present, otherwise the longest string leaf anywhere in the structure. `rebuildWithLeaf` deep-clones the response and replaces only that leaf, so the emitted replacement automatically matches the tool's output shape, siblings intact.
- **Ledger integration** — worthwhile compressions append a fire-and-forget event to the ledger (§7). The exit path gives pending writes at most 250 ms to settle, then SIGKILLs; ledger latency never delays the agent.

---

## 6. Adapters

All adapters implement the same contract (`detect` / `install(mode)` / `uninstall` / `status`), plan changes as before/after file pairs (every mutating command supports `--dry-run` with a diff), and derive truth from disk — there is no state file to drift.

| Adapter | Project-scope artifacts | Global scope | Ownership mechanism | Uninstall semantics |
|---|---|---|---|---|
| claude-code | `.claude/output-styles/compressor-<mode>.md` (owned file); `outputStyle` key in `.claude/settings.json`; hook entry in `.claude/settings.local.json` | same layout under `~/.claude/`, hook entry in `settings.json` (personal file) | `compressor-` prefix on style names; exact-command predicate on hook entries | style files deleted; stashed foreign `outputStyle` restored; only our hook entries stripped; settings files deleted only when empty |
| copilot | marked section in `.github/copilot-instructions.md`; postToolUse entry in `.github/hooks/compressor.json` | `<copilotHome>/hooks/compressor.json`, **hook only** — instructions have no user-global mechanism | markers; exact-command predicate on `bash`/`powershell` fields; namespaced config file | section removed (file itself never deleted); our entries stripped, foreign events untouched; the config file is deleted only when nothing but its version stub remains |
| cursor | `.cursor/rules/compressor.mdc` (owned: overwritten wholesale on install); marked section in legacy `.cursorrules` **only if the file pre-exists** — never created | refused (Cursor rules are per-project) | owned file name; markers in the legacy file; `status` surfaces hand-edits to the `.mdc` as "locally modified — install will overwrite" | `.mdc` deleted unconditionally; `.cursorrules` de-sectioned, never deleted |
| agents-md | marked section in `AGENTS.md` | refused (per-project standard) | markers | section removed; file never deleted — whether compressor created it is not derivable from disk, so err on keeping |

Capability asymmetries, stated plainly:

- **Cursor and AGENTS.md get instructions only.** Cursor ships a hooks system, but its `postToolUse` can replace output for MCP tools only and `beforeReadFile` is permission-only — compressor-style rewriting of built-in Read/Shell output is not currently possible there.
- **AGENTS.md ecosystem note** — `AGENTS.md` is plain Markdown read natively by Cursor, Copilot, Codex, Windsurf and others; **Claude Code does not read it** (hence the dedicated claude-code adapter). Because Cursor and Copilot also read it, `status` warns when both an agent-specific section and an AGENTS.md section are installed: that means duplicated instructions.
- Copilot project installs live in the cwd's `.github/` — one install per repo folder in a VS Code multi-root workspace.

---

## 7. Ledger and savings

The live ledger answers "what has the hook actually been doing on my machine?" without a benchmark run.

**Event schema** (`src/ledger/write.ts`): `{ts, agent: 'claude-code' | 'copilot', tool, mode, charsIn, charsOut, estTokensIn, estTokensOut, transforms: [ids]}`, appended as JSONL to monthly files under `~/.compressor/ledger/` (override: `COMPRESSOR_LEDGER_DIR`).

- **Privacy posture** — events carry sizes and transform ids only. No file paths, no content, nothing leaves the machine.
- **Fail-open + settle cap** — the writer never rejects; every error is swallowed. Hook entries give in-flight appends at most 250 ms before exiting (§5). The reader is equally tolerant: garbage lines are skipped, a missing directory is an empty ledger.
- **Kill switch** — `COMPRESSOR_NO_LEDGER=1` disables recording before any IO is attempted. The benchmark harness sets it in every cell so synthetic benchmark compressions can never pollute the user's live ledger.
- **Estimated vs measured** — ledger token numbers come from the cheap estimator (chars/3.5) and every rendering says so: chars are exact, tokens are "estimated — cheap estimator, not billable counts". Measured savings come from `compressor benchmark`; the ledger never claims otherwise. `compressor savings` (`--since`, `--by day|tool|mode`, `--html` for a self-contained no-JS report) always states its lookback window, and its empty states distinguish "no ledger at all — hook not installed?" from "no events inside this window — the hook is fine".

---

## 8. Benchmark harness

A run is a grid of cells, cell = (task × variant × trial). Variants are modes plus ablation arms (`--ablate`, `--ablate-group`, `--ablate-add`, `--no-hook`, `--marker-styles`). Suites are JSON (`bench/suites/`): `basic` (6 tasks), `main` (10, adds prose-heavy and big-tool-output tasks), `hookab` (3 heavy tasks for hook A/B), `ablate` (9), `interactive` (4 scripted multi-turn conversations).

### Cell anatomy

1. Copy the fixture repo to a temp workspace (filtering out `fix.patch.json` — the answer key for scripted test stubs; copying it would hand the agent the literal solution), `git init` best-effort.
2. Write the variant's artifacts: the output-style file, and a cell settings JSON carrying `outputStyle`, the hook entry (when the variant has one), and `permissions.defaultMode: "bypassPermissions"` — headless cells must work unprompted, and denied Edit/Bash calls corrupt the measurement (observed live in run bench-20260609-231151: denial-retry loops ran cells to as many as 53 turns with the correct fix in hand, against 3–11 turns once permissions were granted).
3. Invoke `claude --bare -p "<prompt>" --output-format json --model <pinned> --settings cell.json` in the workspace. Isolation is belt-and-braces: `--bare` skips user hooks/plugins/CLAUDE.md entirely (doc-verified necessity — hooks merge across scopes, so `--settings` alone cannot silence them), and a per-cell `CLAUDE_CONFIG_DIR` scratch dir fully isolates `~/.claude` and relocates transcripts to where the cell can read them. `COMPRESSOR_NO_LEDGER=1` keeps the cell out of the live ledger.
4. Usage comes from the result JSON (`usage`, `modelUsage`, `total_cost_usd`); per-turn breakdowns and tool-call counts come from the session transcript, deduped by `requestId` (the same API response can appear on multiple lines), sidechains included.
5. Success is judged by a binary check — a shell command (`npm test`, `grep -q`, …) or an answer-regex over the result text. No vibes.

### Budget and scheduling

- `--max-budget-usd` is a hard ceiling: scheduling stops once spend reaches it (known minor: in-flight cells can overshoot by up to concurrency × max-cell-cost).
- **No-cost circuit breaker** — cells that report no cost (timeouts, auth via subscription/Bedrock) still bill real money the ceiling cannot see; after 3 consecutive no-cost cells the ceiling is unenforceable and the runner stops scheduling rather than burn the whole grid.
- **Group-atomic scheduling** — variants are the innermost loop, and the stop decision is made once per task×trial group and shared by the whole group, so a mid-group ceiling trip cannot leave some arms of a comparison measured and others skipped. This guard was added after run bench-20260610-123102, whose data contains exactly that asymmetry (one trial-4 arm measured, the other skipped); later runs skip whole groups symmetrically. The report layer asserts balance post-hoc (`balanceWarning`) and the `--marker-styles` fan-out exists precisely so experiment arms share one run, one ceiling, and the same groups.

### Multi-turn cells

Tasks may declare `turns`: the first prompt runs normally, each follow-up resumes via `claude -p --resume <session-id>`, chaining from the previous turn (sessions can fork ids on resume). The final transcript is authoritative for whole-conversation usage and is cross-checked against the summed per-turn result JSONs; divergence beyond 25% flags the cell as data-quality-suspect instead of silently reporting a wrong total. Command checks run once after the final turn; answer-regex checks treat any single turn's text as the answer.

### Data-quality flags

The report refuses to let bad cells masquerade as data: it flags **vacuous fixtures** (the success check already passed before the agent ran), **model substitution** (served models from `modelUsage` don't match the requested model — fallback can substitute silently), **permission denials** (usage inflated by retries), unknown served models, skipped cells, errored cells, and the usage cross-check above.

### Offline e2e

`test/fixtures/fake-claude.mjs` is a scripted stand-in selected via `COMPRESSOR_CLAUDE_BIN`; the e2e tests drive the real suite, fixtures, runner, aggregation and report through it with no network and no spend, including the non-vacuous-fixture property (check fails before the agent, passes after).

### Headline results (for orientation; full records accompany each run id)

- **Hook**: on big-file work, median context −24% (optimized) / −75% (slim) versus no-hook, with roughly −90% tails (−90.1% optimized / −89.5% slim, worst cell vs worst cell) — no-hook cells reached 3.0M context tokens (runs `bench-20260610-114234`, `bench-20260610-123102`). The huge-log task is bimodal (paginate vs slurp) in both arms; the hook effect is not separable from agent strategy there, and the bimodality is unsolved.
- **Packs, multi-turn**: −11% to −24% output (optimized; slim −5% to −25%) on three of four conversation tasks; the fourth moved +3–4%, within noise (run `bench-20260610-183001`).
- **Packs, single-shot**: −5.6% (optimized) / −2.3% (slim) output (run `bench-20260610-114234`) — directional at 3 trials, IQRs overlap.
- **Task success was 100% in every measured arm** — compression has not been observed to damage task quality.
