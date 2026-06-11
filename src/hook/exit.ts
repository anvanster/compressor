import process from 'node:process';
import { settleLedger } from '../ledger/write.ts';

/** Hard cap on how long pending ledger appends may delay hook exit. */
export const SETTLE_CAP_MS = 250;

/**
 * Deliver hook output, give in-flight ledger appends up to SETTLE_CAP_MS to
 * flush, then guarantee process termination. Shared by both bundled hook
 * entries and the CLI `hook` subcommands — every protocol surface gets the
 * same hot-path bound. Never throws (fail-open).
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
  try {
    if (output !== null) {
      await new Promise<void>((resolve) => {
        process.stdout.write(output, () => resolve());
      });
    }
  } catch {
    // fail-open: EPIPE etc. — still settle the ledger and exit below
  }
  // default true: if anything below throws, take the kernel-level exit
  let timedOut = true;
  try {
    let timer: NodeJS.Timeout | undefined;
    timedOut = await Promise.race([
      settleLedger().then(() => false),
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
