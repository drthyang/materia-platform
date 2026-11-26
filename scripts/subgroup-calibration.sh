#!/usr/bin/env bash
# The subgroup search's calibration (THY-72): the datasets sharded over PROCS
# vitest processes, the whole run capped at CAP_MIN minutes (default 29: no
# dataset starts after CAP_MIN − 4, every process is killed at CAP_MIN).
# Usage: scripts/subgroup-calibration.sh OUT_DIR [PROCS]
# Then: node scripts/subgroup-calibration-report.mjs OUT_DIR
set -euo pipefail
OUT=${1:?output directory}
PROCS=${2:-12}
CAP_MIN=${CAP_MIN:-29}
CUBIC_SEEDS=${CUBIC_SEEDS:-6}
TRUTH_SEEDS=${TRUTH_SEEDS:-2}
GATA_SEEDS=${GATA_SEEDS:-1}
mkdir -p "$OUT"
jobs=()
# The heaviest first: GaTa4Se8, then the tilts, then cubic.
for s in $(seq 1 "$GATA_SEEDS"); do for l in 0.05 0.1 0.15; do jobs+=("GaTa4Se8 P-42_1m|$l|$s"); done; done
for s in $(seq 1 "$TRUTH_SEEDS"); do for t in "a-b+a-" "a-a-a-"; do for l in 0.05 0.1 0.15; do jobs+=("$t|$l|$s"); done; done; done
for s in $(seq 1 "$CUBIC_SEEDS"); do for l in 0.05 0.1 0.15; do jobs+=("cubic|$l|$s"); done; done
start=$(date +%s)
stop_ms=$(( (start + (CAP_MIN - 4) * 60) * 1000 ))
echo "{\"start\": $start, \"procs\": $PROCS, \"capMin\": $CAP_MIN, \"jobs\": ${#jobs[@]}}" > "$OUT/run.json"
pids=()
for ((p = 0; p < PROCS; p++)); do
  list=""
  for ((j = p; j < ${#jobs[@]}; j += PROCS)); do list+="${jobs[$j]};"; done
  [ -z "$list" ] && continue
  env -u MATERIA_DATA_DIR SUBGROUP_CALIBRATION_OUT="$OUT/results-$p.jsonl" SUBGROUP_CALIBRATION_JOBS="$list" SUBGROUP_CALIBRATION_STOP="$stop_ms" \
    timeout $((CAP_MIN * 60)) npx vitest run src/app/pdfSubgroupSearchCalibration.test.ts > "$OUT/log-$p.txt" 2>&1 &
  pids+=($!)
done
for pid in "${pids[@]}"; do wait "$pid" || true; done
echo "{\"start\": $start, \"end\": $(date +%s), \"procs\": $PROCS, \"capMin\": $CAP_MIN, \"jobs\": ${#jobs[@]}}" > "$OUT/run.json"
