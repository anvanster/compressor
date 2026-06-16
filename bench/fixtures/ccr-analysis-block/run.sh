#!/usr/bin/env sh
# Deterministic ~6000-line diagnostic dump for the CCR savings A/B.
#
# HONEST-A/B INVARIANT (a relational, non-greppable predicate is the SOLE discriminator):
#
#   The answer is the 6 audited `metric: NAME=VALUE` pairs of the ONE real rollup.
#   There are MANY decoy `=== ANALYSIS SECTION ===` blocks scattered through the
#   head, middle, and tail — each carrying the BYTE-IDENTICAL delimiter lines AND
#   the SAME six metric NAMES (orders_total, revenue_usd, ...) with values in the
#   SAME magnitude as the real ones. Plus hundreds of `metric: NAME=VALUE` lines
#   using those same real names interleaved in the routine log. So:
#     * `grep '=== ANALYSIS SECTION ==='`     → dozens of hits
#     * `grep -A8 '=== ANALYSIS SECTION ==='`  → dozens of DIFFERENT 6-pair blocks
#     * `grep '^metric:'`                      → hundreds of pairs
#     * a magnitude/digit-count grep           → can't separate real from decoy
#       (decoy values share the real digit counts)
#   None of these isolates the 6 real pairs. The discriminator is a RELATIONAL,
#   NON-GREPPABLE predicate: every ANALYSIS block is preceded by a
#       `>>> audit run=AUD-##### checksum=<N> <<<`
#   line, and the real rollup is the UNIQUE block whose six metric VALUES SUM to
#   the `checksum` printed on its own header line. Decoys carry a deliberately
#   WRONG checksum (never equal to their own sum). No grep/PCRE can verify
#   "the six values on the next lines sum to this number" — it requires reading
#   the block and adding. So the model must have the block IN CONTEXT:
#     * CCR OFF: the real block is in the truncated MIDDLE; a plain re-run is
#       re-truncated to the same head/tail, and no narrow grep can pick the
#       checksum-matching block — the only correct route is pulling the whole
#       output back into context (re-bloat). The marker's grep/head hint does
#       not yield the answer.
#     * CCR ON: the marker carries `compressor retrieve <handle>`; the model
#       pulls back the exact cut middle and evaluates the checksum predicate on
#       the far smaller slice.
#   Real values overlap decoy magnitudes (a magnitude grep can't filter them),
#   yet no decoy reproduces a real pair (disjoint per-value bands below).
#
# Fully deterministic (no $RANDOM, no dates): byte-identical every run, so both
# arms see the same output and the A/B measures SAVINGS, not a quality gap.

set -eu

# Real rollup values and their checksum (= the sum the model must verify).
# 48217+1039482+1322+90431+47+812 = 1180311
REAL_CHECKSUM=1180311

# Emit a DECOY analysis block: the SAME delimiter + the SAME six metric NAMES with
# WRONG values, preceded by a header carrying a WRONG checksum (never equal to the
# block's own value sum, and never equal to REAL_CHECKSUM). seed makes everything
# deterministic.
#
# Decoy values overlap the real magnitudes but live in per-value bands chosen so
# NO decoy line can ever equal a real pair (so each real NAME=VALUE appears
# exactly once in the whole dump). The decoy checksum is offset by +1 from the
# block's own sum, guaranteeing the relational predicate fails for every decoy.
decoy_block() {
  seed=$1
  # Each decoy value = real value + (1..range): same magnitude as the real value,
  # but ALWAYS strictly greater, so a decoy can NEVER equal a real pair while a
  # magnitude grep (digit count) cannot separate real from decoy.
  v1=$(( 48217   + 1 + (seed * 13) % 40000 ))
  v2=$(( 1039482 + 1 + (seed * 31) % 900000 ))
  v3=$(( 1322    + 1 + (seed * 7)  % 4000 ))
  v4=$(( 90431   + 1 + (seed * 17) % 50000 ))
  v5=$(( 47      + 1 + (seed * 3)  % 600 ))
  v6=$(( 812     + 1 + (seed * 23) % 1500 ))
  sum=$(( v1 + v2 + v3 + v4 + v5 + v6 ))
  # WRONG checksum: the block's own sum + a nonzero offset, and never the real one
  bad=$(( sum + 1 ))
  if [ "$bad" -eq "$REAL_CHECKSUM" ]; then bad=$(( sum + 2 )); fi
  printf '>>> audit run=AUD-D%05d checksum=%d <<<\n' "$seed" "$bad"
  echo '=== ANALYSIS SECTION ==='
  echo 'analysis: candidate rollup values'
  printf 'metric: orders_total=%d\n'    "$v1"
  printf 'metric: revenue_usd=%d\n'     "$v2"
  printf 'metric: refunds_total=%d\n'   "$v3"
  printf 'metric: active_users=%d\n'    "$v4"
  printf 'metric: error_rate_ppm=%d\n'  "$v5"
  printf 'metric: p99_latency_ms=%d\n'  "$v6"
  echo '=== END ANALYSIS SECTION ==='
}

# ---- head region: ~2900 routine INFO lines, decoy blocks + decoy metric lines -
i=1
while [ "$i" -le 2900 ]; do
  printf 'INFO  worker[%04d] processed batch ok latency_ms=%d queue_depth=%d\n' \
    "$i" $(( (i * 7) % 200 )) $(( (i * 3) % 64 ))
  # interleaved decoy metric lines REUSING the real names (no `noise_` prefix),
  # so `grep -v noise` cannot strip them and a keyword grep stays bloated.
  if [ $(( i % 8 )) -eq 0 ]; then
    case $(( i % 6 )) in
      0) printf 'metric: orders_total=%d\n'   $(( 48217   + 1 + (i * 19) % 40000 )) ;;
      1) printf 'metric: revenue_usd=%d\n'     $(( 1039482 + 1 + (i * 29) % 900000 )) ;;
      2) printf 'metric: refunds_total=%d\n'   $(( 1322    + 1 + (i * 5)  % 4000 )) ;;
      3) printf 'metric: active_users=%d\n'    $(( 90431   + 1 + (i * 11) % 50000 )) ;;
      4) printf 'metric: error_rate_ppm=%d\n'  $(( 47      + 1 + (i * 2)  % 600 )) ;;
      5) printf 'metric: p99_latency_ms=%d\n'  $(( 812     + 1 + (i * 37) % 1500 )) ;;
    esac
  fi
  # decoy analysis blocks scattered through the head — SAME delimiter + names,
  # wrong values. Some land in the kept-head after truncation, so the model SEES
  # the delimiter is ambiguous and grep -A cannot pick the answer.
  if [ $(( i % 70 )) -eq 0 ]; then
    decoy_block "$i"
  fi
  i=$(( i + 1 ))
done

# ---- the REAL analysis block: ~middle of the output (~line 3000), in the cut --
# Header carries the REAL checksum = the sum of the six real values below. This
# is the ONLY block whose six values sum to its own checksum (the relational
# predicate). Its AUD-D00000 run-id is not a discriminator — a decoy could share
# any run-id; only the checksum==sum relation identifies the real block.
printf '>>> audit run=AUD-D00000 checksum=%d <<<\n' "$REAL_CHECKSUM"
echo '=== ANALYSIS SECTION ==='
echo 'analysis: candidate rollup values'
echo 'metric: orders_total=48217'
echo 'metric: revenue_usd=1039482'
echo 'metric: refunds_total=1322'
echo 'metric: active_users=90431'
echo 'metric: error_rate_ppm=47'
echo 'metric: p99_latency_ms=812'
echo '=== END ANALYSIS SECTION ==='

# ---- tail region: ~3100 more routine INFO lines, decoy blocks + decoy metrics -
i=3001
while [ "$i" -le 6100 ]; do
  printf 'INFO  worker[%04d] processed batch ok latency_ms=%d queue_depth=%d\n' \
    "$i" $(( (i * 7) % 200 )) $(( (i * 3) % 64 ))
  if [ $(( i % 8 )) -eq 0 ]; then
    case $(( i % 6 )) in
      0) printf 'metric: orders_total=%d\n'   $(( 48217   + 1 + (i * 19) % 40000 )) ;;
      1) printf 'metric: revenue_usd=%d\n'     $(( 1039482 + 1 + (i * 29) % 900000 )) ;;
      2) printf 'metric: refunds_total=%d\n'   $(( 1322    + 1 + (i * 5)  % 4000 )) ;;
      3) printf 'metric: active_users=%d\n'    $(( 90431   + 1 + (i * 11) % 50000 )) ;;
      4) printf 'metric: error_rate_ppm=%d\n'  $(( 47      + 1 + (i * 2)  % 600 )) ;;
      5) printf 'metric: p99_latency_ms=%d\n'  $(( 812     + 1 + (i * 37) % 1500 )) ;;
    esac
  fi
  if [ $(( i % 70 )) -eq 0 ]; then
    decoy_block "$i"
  fi
  i=$(( i + 1 ))
done
