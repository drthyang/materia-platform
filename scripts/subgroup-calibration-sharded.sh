#!/usr/bin/env bash
# The subgroup search's calibration, each dataset's step 1 split over PROCS
# processes (shard i fits every PROCS-th candidate from the i-th), the datasets
# in the order given, the whole run capped at CAP_MIN minutes (default 29: no
# dataset starts after CAP_MIN − 3, every process is killed at CAP_MIN). A
# dataset counts once all its shards are in (the report merges them).
# Usage: scripts/subgroup-calibration-sharded.sh OUT_DIR PROCS "truth|level|seed;…"
set -euo pipefail
OUT=${1:?output directory}
PROCS=${2:?processes}
JOBS=${3:?datasets}
CAP_MIN=${CAP_MIN:-29}
mkdir -p "$OUT"
start=$(date +%s)
stop_ms=$(( (start + (CAP_MIN - 3) * 60) * 1000 ))
n=$(tr ';' '\n' <<<"$JOBS" | grep -c .)
echo "{\"start\": $start, \"procs\": $PROCS, \"capMin\": $CAP_MIN, \"jobs\": $n, \"sharded\": true}" > "$OUT/run.json"
pids=()
for ((p = 0; p < PROCS; p++)); do
  env -u MATERIA_DATA_DIR SUBGROUP_CALIBRATION_OUT="$OUT/results-$p.jsonl" SUBGROUP_CALIBRATION_JOBS="$JOBS" SUBGROUP_CALIBRATION_SHARD="$p/$PROCS" SUBGROUP_CALIBRATION_STOP="$stop_ms" \
    timeout $((CAP_MIN * 60)) npx vitest run src/app/pdfSubgroupSearchCalibration.test.ts > "$OUT/log-$p.txt" 2>&1 &
  pids+=($!)
done
for pid in "${pids[@]}"; do wait "$pid" || true; done
echo "{\"start\": $start, \"end\": $(date +%s), \"procs\": $PROCS, \"capMin\": $CAP_MIN, \"jobs\": $n, \"sharded\": true}" > "$OUT/run.json"
