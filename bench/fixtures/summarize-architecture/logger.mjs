/**
 * Request log middleware. Entries land in ctx.state under 'log' (and in the
 * shared sink passed by the app) — deterministic sequence numbers, no
 * wall-clock reads, so output is reproducible.
 */
export function requestLog(sink = []) {
  let seq = 0;
  return async (ctx, next) => {
    seq += 1;
    const id = seq;
    const log = ctx.state.get('log') ?? [];
    ctx.state.set('log', log);
    const enter = `#${id} -> ${ctx.request.method} ${ctx.request.path}`;
    log.push(enter);
    sink.push(enter);
    await next();
    const exit = `#${id} <- ${ctx.response.status ?? 'unset'}`;
    log.push(exit);
    sink.push(exit);
  };
}
