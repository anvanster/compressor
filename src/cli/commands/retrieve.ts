import process from 'node:process';
import { readChunk } from '../../hook/ccr.ts';
import { writeHookOutput } from '../../hook/exit.ts';
import type { HookStdout } from '../../hook/exit.ts';

export interface RetrieveOptions {
  /** an optional 1-based inclusive line range "A-B" to slice from the chunk */
  lines?: string;
}

// `compressor retrieve <handle> [--lines a-b]` — the model-facing half of CCR
// (internal/CCR-PLAN.md §3). A non-file compression marker emits
// `compressor retrieve <handle>`; the model runs THIS via Bash to pull the exact
// omitted bytes back instead of re-running the original command. The hook's
// passthrough guard (isCompressorRetrieve, /\bcompressor\s+retrieve\b/i) keeps
// the retrieved output from being re-compressed — which is why the command MUST
// be named `retrieve`.
//
// This is a THIN surface over the frozen stash store: all handle validation,
// path confinement, symlink refusal, O_NOFOLLOW reads, and the line-range slice
// live in ccr.ts::readChunk. The CLI re-implements NONE of it — it parses the
// optional --lines flag, calls readChunk, and maps the result to stdout/stderr +
// an exit code. The store is session-less on read (readChunk searches the
// session dirs under the SAME COMPRESSOR_CCR_DIR the hook wrote to; both default
// to os.tmpdir()/compressor-ccr), so retrieve works with no session id.

/** The miss note: a stash miss is exactly today's fail-open — re-run the command. */
function missNote(handle: string): string {
  return (
    `compressor: chunk ${handle} not found ` +
    `(expired, never stashed, or wrong --lines) — re-run the original command to regenerate it\n`
  );
}

/**
 * Parse a `--lines A-B` value into a 1-based inclusive range. Returns undefined
 * (retrieve the whole chunk) when the value is absent or malformed — A and B must
 * each be a positive integer and the dash must separate exactly two of them.
 * Malformed is degrade-not-fail: the whole chunk comes back, with a brief stderr
 * note so the model can correct the flag.
 */
function parseRange(value: string | undefined): { start: number; end: number } | undefined {
  if (value === undefined) {
    return undefined;
  }
  const match = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(value);
  if (match === null) {
    return undefined;
  }
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < 1) {
    return undefined;
  }
  return { start, end };
}

/**
 * Print the exact stashed bytes for `handle` (or a 1-based inclusive line
 * sub-range via --lines) to stdout. On a miss — bad/expired handle, a rejected
 * (e.g. traversal) handle, the kill switch, or any store error — write a concise
 * re-run note to stderr and set a NON-ZERO exit code so the model sees the miss.
 *
 * NEVER throws (fail-open): a thrown readChunk or write is caught and treated as
 * a miss. There are no pending writes to settle here (retrieve only reads), so —
 * unlike the hook — it does NOT join settleThenExit; the normal CLI exit applies.
 *
 * The hit case delivers stdout via writeHookOutput (src/hook/exit.ts): the model
 * runs `compressor retrieve | head`/`grep -q`/`less`, and an early-closing reader
 * makes the write fail with EPIPE — surfaced as an async 'error' EVENT on the
 * stream, NOT a write() throw, so the try/catch below cannot cover it. Without
 * the no-op 'error' listener writeHookOutput attaches, Node turns that event into
 * an uncaught exception that dumps a stack trace into the model's shell and exits
 * abnormally. Reusing writeHookOutput absorbs the EPIPE and awaits the write.
 */
export async function runRetrieve(
  handle: string,
  opts: RetrieveOptions,
  stdout: HookStdout = process.stdout,
): Promise<void> {
  try {
    const range = parseRange(opts.lines);
    if (opts.lines !== undefined && range === undefined) {
      // malformed --lines: degrade to whole-chunk retrieval, but say so.
      process.stderr.write(
        `compressor: ignoring malformed --lines '${opts.lines}' ` +
          '(expected A-B, two positive integers) — retrieving the whole chunk\n',
      );
    }
    // readChunk validates the handle (strict allowlist, reject) and is fail-open
    // (null on bad handle / miss / any error): the CLI never re-validates.
    const text = await readChunk(handle, range);
    if (text === null) {
      process.stderr.write(missNote(handle));
      process.exitCode = 1;
      return;
    }
    // EXACT bytes — no added or trimmed characters (fidelity is the point).
    // EPIPE-safe: writeHookOutput attaches a no-op 'error' listener + awaits the
    // write callback, so `retrieve | head`/`grep -q`/`less` cannot crash this.
    // stdout is injectable (defaults to process.stdout) so the EPIPE path can be
    // exercised deterministically without swapping the global stream.
    await writeHookOutput(text, stdout);
  } catch {
    // FAIL-OPEN: any unexpected error is just a miss → the re-run note + exit 1.
    process.stderr.write(missNote(handle));
    process.exitCode = 1;
  }
}
