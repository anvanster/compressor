#!/usr/bin/env sh
# Success check for ccr-analysis-block. The model must report the 6 audited
# `metric: NAME=VALUE` pairs of the ONE real rollup into metrics.txt, EXACTLY.
#
# Why exact (not name-only / not "all six names present"): every decoy block now
# carries the SAME six metric NAMES with WRONG values, and decoy `metric:` lines
# reuse the real names too. So the gate requires:
#   (1) the file exists (an untouched workspace FAILS — never a vacuous pass);
#   (2) all SIX exact real pairs are present (NAME=VALUE, verbatim);
#   (3) NO foreign pair: no line carrying a real metric NAME with a value other
#       than the real one. So pasting a decoy block, or dumping `grep -A8` across
#       the decoys, or `grep '^metric:'`, FAILS. The only way to satisfy (2)+(3)
#       is to recover the real block from its (cut) position.
#
# Usage: `sh check.sh [WORKDIR]`. WORKDIR defaults to the current directory; the
# harness passes the agent workspace explicitly so this script can live and run
# OUTSIDE that workspace (the agent must never be able to read the answer key).
set -eu

work=${1:-.}
f="$work/metrics.txt"
[ -f "$f" ] || { echo "FAIL: metrics.txt missing" >&2; exit 1; }

# (2) every real pair must be present, verbatim.
for pair in \
  'orders_total=48217' \
  'revenue_usd=1039482' \
  'refunds_total=1322' \
  'active_users=90431' \
  'error_rate_ppm=47' \
  'p99_latency_ms=812'
do
  grep -qF "$pair" "$f" || { echo "FAIL: missing $pair" >&2; exit 1; }
done

# (3) no foreign pair: any line mentioning a real NAME with a wrong VALUE fails.
# We grep each real name, then subtract the one correct pair; anything left is a
# decoy value the model copied (a decoy block or a keyword-grep dump).
check_name() {
  name=$1; good=$2
  bad=$(grep -E "(^|[^A-Za-z_])${name}=" "$f" | grep -vF "${name}=${good}" | wc -l | tr -d ' ')
  if [ "$bad" != "0" ]; then
    echo "FAIL: foreign value(s) for ${name} present — not the real audited rollup" >&2
    exit 1
  fi
}
check_name orders_total 48217
check_name revenue_usd 1039482
check_name refunds_total 1322
check_name active_users 90431
check_name error_rate_ppm 47
check_name p99_latency_ms 812

echo "PASS: exactly the six audited metrics present"
