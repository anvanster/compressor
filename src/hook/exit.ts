import process from 'node:process';
import { settleLedger } from '../ledger/write.ts';
import { settleCcr } from './ccr.ts';
import { settleRecovery } from './recovery.ts';

/** Hard cap on how long pending state writes may delay hook exit. */
export const SETTLE_CAP_MS = 250;

/** The slice of process.stdout the hook output path needs (injectable for tests). */
export interface HookStdout {
  on(event: 'error', listener: (error: Error) => void): unknown;
  write(chunk: string, callback?: (error?: Error | null) => void): boolean;
}

/**
 * Deliver hook output on stdout without ever crashing the process. When the
 * parent closes the pipe early (host shutdown, hook timeout race), the write
 * fails with EPIPE — which surfaces as an async 'error' EVENT on the stream,
 * not as a write() throw, so a try/catch alone cannot keep the always-exit-0
 * invariant: without a listener the event becomes an uncaught exception and a
 * non-zero exit (logged noise in Claude Code). The no-op listener absorbs the
 * event; the try/catch covers synchronous failures (already-destroyed fd).
 * Never throws (fail-open) — settle and exit proceed regardless.
 */
export async function writeHookOutput(
  output: string,
  stdout: HookStdout = process.stdout,
): Promise<void> {
  try {
    stdout.on('error', () => {});
    await new Promise<void>((resolve) => {
      stdout.write(output, () => resolve());
    });
  } catch {
    // fail-open: a closed/destroyed stdout must not break exit 0
  }
}

/**
 * Deliver hook output, give in-flight state writes (ledger appends +
 * recovery-budget records + CCR stash chunks) up to SETTLE_CAP_MS to flush, then guarantee
 * process termination. Shared by both bundled hook entries and the CLI
 * `hook` subcommands — every protocol surface gets the same hot-path bound.
 * Never throws (fail-open).
 *
 * Order matters: stdout is written BEFORE the settle race, so marker delivery
 * never serializes behind ledger filesystem latency.
 *
 * The cap alone only bounds the JS await. On modern Node (>= ~22),
 * process.exit() performs a clean shutdown that joins the libuv threadpool;
 * an appendFile blocked in open(2) (hung NFS/SMB home dir, dead FUSE mount,
 * reader-less FIFO) never returns, so that join never completes and the
 * process lives forever — stalling the agent for its hook timeout, or
 * indefinitely on hosts without one. When the race times out we therefore
 * terminate with SIGKILL: kernel-level, bypasses the threadpool join. The
 * resulting non-zero exit makes the host ignore this call's stdout, which is
 * still fail-open — the original tool output passes through unmodified.
 */
export async function settleThenExit(output: string | null): Promise<void> {
  if (output !== null) {
    // EPIPE-safe (no-op 'error' listener + try/catch inside) — see above
    await writeHookOutput(output);
  }
  // default true: if anything below throws, take the kernel-level exit
  let timedOut = true;
  try {
    let timer: NodeJS.Timeout | undefined;
    timedOut = await Promise.race([
      Promise.all([settleLedger(), settleRecovery(), settleCcr()]).then(() => false),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(true), SETTLE_CAP_MS);
      }),
    ]);
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  } catch {
    timedOut = true;
  }
  if (timedOut) {
    process.kill(process.pid, 'SIGKILL');
  }
  process.exit(0);
}
