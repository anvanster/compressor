#!/usr/bin/env sh
# Deterministic ~6000-line service log for the CCR savings A/B.
#
# HONEST-A/B INVARIANT (a relational, non-greppable predicate is the SOLE discriminator):
#
#   The answer is the 5 stack FRAMES of the ONE real crash. There are MANY decoy
#   crash blocks scattered through the head, middle, and tail — each carrying the
#   BYTE-IDENTICAL header `FATAL unhandled exception in request handler` and five
#   `  at <fn> (path:line:col)` frames drawn from the SAME function-name pool as
#   the real frames. So:
#     * `grep 'FATAL unhandled exception in request handler'`  → dozens of hits
#     * `grep -A5 'FATAL unhandled exception in request handler'` → dozens of
#        DIFFERENT 5-frame stacks, only one of which is the answer
#     * `grep -E '^\s+at '` → hundreds of frames
#     * `grep -i error` / `grep retry` → re-bloats with WARN/ERROR noise
#   None of these isolates the real 5 frames. The real crash is identifiable
#   ONLY by a RELATIONAL, NON-GREPPABLE predicate: every crash header is preceded
#   by a `>>> request rid=REQ-##### framesum=<N> <<<` line, and the real crash is
#   the UNIQUE one whose five frame LINE NUMBERS (the `:line:` field of each
#   `at fn (file:line:col)`) SUM to the `framesum` on its own header. Decoys carry
#   a deliberately WRONG framesum (never equal to their own frame-line sum). No
#   grep/PCRE can verify "the five line numbers below sum to this number" — it
#   requires reading the block and adding. So the model must have the block IN
#   CONTEXT:
#     * CCR OFF: the real crash is in the truncated MIDDLE; a plain re-run is
#       re-truncated to the same head/tail, and no narrow grep can pick the
#       framesum-matching block — the only correct route is pulling the whole
#       output back into context (re-bloat). The marker's grep/head hint does
#       not yield the answer.
#     * CCR ON: the marker carries `compressor retrieve <handle>`; the model
#       pulls back the exact cut middle and evaluates the predicate on the slice.
#
# Fully deterministic: byte-identical every run (no $RANDOM, no dates), so both
# arms see the same output and the A/B measures SAVINGS, not a quality gap.

set -eu

# Function-name pool — REAL frames and DECOY frames draw from the SAME pool, so
# a frame's function name never reveals whether it belongs to the real crash.
fn() {
  case $(( $1 % 10 )) in
    0) echo 'chargeWithRetry billing/retry.js' ;;
    1) echo 'applyVolumePricing billing/pricing.js' ;;
    2) echo 'settleInvoice billing/invoice.js' ;;
    3) echo 'processOrder orders/process.js' ;;
    4) echo 'handleRequest server/router.js' ;;
    5) echo 'validateCart cart/validate.js' ;;
    6) echo 'reserveStock inventory/reserve.js' ;;
    7) echo 'authorizePayment payments/authorize.js' ;;
    8) echo 'renderReceipt receipts/render.js' ;;
    9) echo 'emitWebhook hooks/emit.js' ;;
  esac
}

# Real frame line numbers sum (88+142+57+204+319 = 810): the value the model must
# verify against the `framesum` on the real crash's header.
REAL_FRAMESUM=810

# Emit a DECOY crash block: the SAME header + 5 frames from the pool, preceded by
# a header carrying a WRONG framesum (never equal to the block's own frame-line
# sum, and never equal to REAL_FRAMESUM). seed makes everything deterministic.
decoy_crash() {
  seed=$1
  # precompute the five frame line numbers and their sum
  ln=''
  s=0
  k=0
  while [ "$k" -lt 5 ]; do
    n=$(( (seed * 11 + k * 5) % 400 + 1 ))
    ln="$ln $n"
    s=$(( s + n ))
    k=$(( k + 1 ))
  done
  # WRONG framesum: the block's own sum + a nonzero offset, never the real one
  bad=$(( s + 1 ))
  if [ "$bad" -eq "$REAL_FRAMESUM" ]; then bad=$(( s + 2 )); fi
  printf '>>> request rid=REQ-D%05d framesum=%d <<<\n' "$seed" "$bad"
  echo 'FATAL unhandled exception in request handler'
  k=0
  for n in $ln; do
    set -- $(fn $(( seed * 3 + k * 7 + 1 )))
    printf '  at %s (%s:%d:%d)\n' "$1" "$2" "$n" $(( (seed * 7 + k) % 80 + 1 ))
    k=$(( k + 1 ))
  done
  echo 'FATAL aborting request, returning 500'
}

# ---- head region: ~2900 routine lines, decoy crashes + WARN/ERROR noise -------
i=1
while [ "$i" -le 2900 ]; do
  printf 'INFO  req[%05d] GET /api/v1/resource status=200 dur_ms=%d\n' \
    "$i" $(( (i * 5) % 300 ))
  if [ $(( i % 6 )) -eq 0 ]; then
    printf 'WARN  req[%05d] transient error: upstream slow, will retry\n' "$i"
  fi
  if [ $(( i % 11 )) -eq 0 ]; then
    printf 'ERROR cache[%05d] retry error code=503 (recovered)\n' "$i"
  fi
  # decoy crash blocks scattered through the head — SAME header, wrong frames.
  # Some land in the kept-head after truncation, so the model SEES that the
  # header is ambiguous and that grep -A5 cannot pick the answer.
  if [ $(( i % 70 )) -eq 0 ]; then
    decoy_crash "$i"
  fi
  i=$(( i + 1 ))
done

# ---- the REAL crash: ~middle of the output (~line 3000), in the cut ----------
# Header carries the REAL framesum = 88+142+57+204+319 = 810, the sum of the five
# frame line numbers below. This is the ONLY crash whose frame line numbers sum to
# its own framesum (the relational predicate). The REQ-D00000 rid is not a
# discriminator — only the framesum==sum relation identifies the real crash.
printf '>>> request rid=REQ-D00000 framesum=%d <<<\n' "$REAL_FRAMESUM"
echo 'FATAL unhandled exception in request handler'
echo '  at chargeWithRetry (billing/retry.js:88:17)'
echo '  at applyVolumePricing (billing/pricing.js:142:9)'
echo '  at settleInvoice (billing/invoice.js:57:23)'
echo '  at processOrder (orders/process.js:204:11)'
echo '  at handleRequest (server/router.js:319:7)'
echo 'FATAL aborting request, returning 500'

# ---- tail region: ~3100 more routine lines, decoy crashes + noise ------------
i=3001
while [ "$i" -le 6100 ]; do
  printf 'INFO  req[%05d] GET /api/v1/resource status=200 dur_ms=%d\n' \
    "$i" $(( (i * 5) % 300 ))
  if [ $(( i % 6 )) -eq 0 ]; then
    printf 'WARN  req[%05d] transient error: upstream slow, will retry\n' "$i"
  fi
  if [ $(( i % 11 )) -eq 0 ]; then
    printf 'ERROR cache[%05d] retry error code=503 (recovered)\n' "$i"
  fi
  if [ $(( i % 70 )) -eq 0 ]; then
    decoy_crash "$i"
  fi
  i=$(( i + 1 ))
done
