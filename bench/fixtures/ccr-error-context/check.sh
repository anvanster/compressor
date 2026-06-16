#!/usr/bin/env sh
# Success check for ccr-error-context. The model must report the 5 stack FRAMES
# of the ONE real FATAL crash into stack.txt, EXACTLY — name + path:line:col.
#
# Why exact (not name-only): every decoy crash block now draws its frames from
# the SAME function-name pool as the real crash, so a name-only check would pass
# on a decoy. The gate therefore requires:
#   (1) the file exists (an untouched workspace FAILS — never a vacuous pass);
#   (2) all FIVE exact real frames are present (full `at fn (path:line:col)`);
#   (3) NO foreign `at ...` frame is present — so dumping `grep -A5 <header>`
#       across the decoys, or pasting a decoy block, FAILS. The only way to
#       satisfy (2)+(3) is to recover the real block from its (cut) position.
#
# Usage: `sh check.sh [WORKDIR]`. WORKDIR defaults to the current directory; the
# harness passes the agent workspace explicitly so this script can live and run
# OUTSIDE that workspace (the agent must never be able to read the answer key).
set -eu

work=${1:-.}
f="$work/stack.txt"
[ -f "$f" ] || { echo "FAIL: stack.txt missing" >&2; exit 1; }

# (2) every real frame must be present, verbatim.
for frame in \
  'at chargeWithRetry (billing/retry.js:88:17)' \
  'at applyVolumePricing (billing/pricing.js:142:9)' \
  'at settleInvoice (billing/invoice.js:57:23)' \
  'at processOrder (orders/process.js:204:11)' \
  'at handleRequest (server/router.js:319:7)'
do
  grep -qF "$frame" "$f" || { echo "FAIL: missing frame: $frame" >&2; exit 1; }
done

# (3) no foreign frame: count `at <fn> (...)` lines that are NOT one of the five.
# A decoy paste or a whole grep -A5 dump introduces extra frame lines and fails.
extra=$(grep -E '^\s*at [A-Za-z]+ \(' "$f" \
  | grep -vF 'at chargeWithRetry (billing/retry.js:88:17)' \
  | grep -vF 'at applyVolumePricing (billing/pricing.js:142:9)' \
  | grep -vF 'at settleInvoice (billing/invoice.js:57:23)' \
  | grep -vF 'at processOrder (orders/process.js:204:11)' \
  | grep -vF 'at handleRequest (server/router.js:319:7)' \
  | wc -l | tr -d ' ')
if [ "$extra" != "0" ]; then
  echo "FAIL: $extra foreign stack frame(s) present — not the real crash's 5 frames" >&2
  exit 1
fi

echo "PASS: exactly the five real stack frames present"
