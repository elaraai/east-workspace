#!/bin/bash
# Run all east-c-std compliance tests in parallel.
# Usage: ./packages/east-c-std/scripts/test_compliance.sh [test-ir-dir] [test-binary]

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="${SCRIPT_DIR}/../../.."
BUILD_DIR="${PROJECT_DIR}/build"
IR_DIR="${1:-/tmp/east-node-std}"
TEST_BIN="${2:-${BUILD_DIR}/packages/east-c-std/test_std_compliance}"

if [ ! -x "$TEST_BIN" ]; then
    echo "Error: $(basename "$TEST_BIN") not found at $TEST_BIN"
    echo "Run: make build"
    exit 1
fi

if [ ! -d "$IR_DIR" ]; then
    echo "Error: IR directory not found at $IR_DIR"
    exit 1
fi

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

# Run all tests in parallel, each writing output to a temp file
PIDS=()
FILES=()
for f in "$IR_DIR"/*.json; do
    name=$(basename "$f" .json)
    outfile="$TMPDIR/$name.out"
    (timeout 30 "$TEST_BIN" "$f" > "$outfile" 2>&1; echo "EXIT:$?" >> "$outfile") &
    PIDS+=($!)
    FILES+=("$outfile")
done

# Wait for all
for pid in "${PIDS[@]}"; do
    wait "$pid" 2>/dev/null || true
done

# Collect totals
TOTAL_PASS=0
TOTAL_FAIL=0
TOTAL_CRASH=0

for f in "$IR_DIR"/*.json; do
    name=$(basename "$f" .json)
    outfile="$TMPDIR/$name.out"
    [ -f "$outfile" ] || continue

    exit_line=$(grep "^EXIT:" "$outfile" 2>/dev/null | tail -1)
    exit_code="${exit_line#EXIT:}"
    result_line=$(grep "^Results:" "$outfile" 2>/dev/null | tail -1)

    if [ -n "$result_line" ]; then
        passed=$(echo "$result_line" | grep -oP '\d+(?=/)')
        total=$(echo "$result_line" | grep -oP '(?<=/)\d+')
        failed=$((total - passed))
        TOTAL_PASS=$((TOTAL_PASS + passed))
        TOTAL_FAIL=$((TOTAL_FAIL + failed))
    elif [ "$exit_code" = "137" ] || [ "$exit_code" = "139" ] || [ "$exit_code" = "134" ]; then
        TOTAL_CRASH=$((TOTAL_CRASH + 1))
    else
        TOTAL_CRASH=$((TOTAL_CRASH + 1))
    fi
done

# Print individual test output (hidden in QUIET mode)
if [ "${EAST_QUIET:-}" != "1" ]; then
    for f in "$IR_DIR"/*.json; do
        name=$(basename "$f" .json)
        outfile="$TMPDIR/$name.out"
        if [ -f "$outfile" ]; then
            grep -E '^[▶✔✖ℹ]|^  [✔✖]' "$outfile" || true
        fi
    done
    echo ""
fi

# Truncate name to max length with ... in the middle
truncate_name() {
    local n="$1" max="$2"
    if [ "${#n}" -le "$max" ]; then
        echo "$n"
    else
        local half=$(( (max - 3) / 2 ))
        local tail_len=$(( max - 3 - half ))
        echo "${n:0:$half}...${n: -$tail_len}"
    fi
}

# Print results table
COL=40
printf "  %-${COL}s %8s %8s\n" "Suite" "Passed" "Failed"
printf "  %-${COL}s %8s %8s\n" "$(printf '%0.s─' $(seq 1 $COL))" "────────" "────────"
for f in "$IR_DIR"/*.json; do
    name=$(basename "$f" .json)
    display=$(truncate_name "$name" "$COL")
    outfile="$TMPDIR/$name.out"

    if [ ! -f "$outfile" ]; then
        printf "  %-${COL}s %8s %8s\n" "$display" "-" "MISSING"
        continue
    fi

    exit_line=$(grep "^EXIT:" "$outfile" 2>/dev/null | tail -1)
    exit_code="${exit_line#EXIT:}"
    result_line=$(grep "^Results:" "$outfile" 2>/dev/null | tail -1)

    if [ -n "$result_line" ]; then
        passed=$(echo "$result_line" | grep -oP '\d+(?=/)')
        total=$(echo "$result_line" | grep -oP '(?<=/)\d+')
        failed=$((total - passed))
        if [ "$failed" -eq 0 ]; then
            printf "  %-${COL}s %8s %8s\n" "$display" "$passed" "-"
        else
            printf "  %-${COL}s %8s %8s\n" "$display" "$passed" "$failed"
        fi
    elif [ "$exit_code" = "137" ] || [ "$exit_code" = "139" ] || [ "$exit_code" = "134" ]; then
        printf "  %-${COL}s %8s %8s\n" "$display" "-" "CRASH"
    else
        printf "  %-${COL}s %8s %8s\n" "$display" "-" "ERROR"
    fi
done

# Print failure details (errors, crashes, failed tests with messages/locations)
HAVE_FAILURES=0
for f in "$IR_DIR"/*.json; do
    name=$(basename "$f" .json)
    outfile="$TMPDIR/$name.out"
    [ -f "$outfile" ] || continue

    # Collect failure lines: ✖ lines and their indented detail lines (error msg, location)
    failure_block=$(grep -E '^  ✖|^    ' "$outfile" 2>/dev/null || true)
    # Collect FATAL ERROR from stderr (merged into outfile via 2>&1)
    fatal_block=$(grep -E '^FATAL ERROR:' "$outfile" 2>/dev/null || true)

    if [ -n "$failure_block" ] || [ -n "$fatal_block" ]; then
        if [ "$HAVE_FAILURES" -eq 0 ]; then
            echo ""
            echo "  Failures"
            echo "  ────────"
            HAVE_FAILURES=1
        fi
        echo ""
        echo "  $name"
        if [ -n "$failure_block" ]; then
            echo "$failure_block" | while IFS= read -r line; do
                echo "    $line"
            done
        fi
        if [ -n "$fatal_block" ]; then
            echo "$fatal_block" | while IFS= read -r line; do
                echo "    $line"
            done
        fi
    fi
done

echo ""
echo "========================================="
printf "  Total: %d passed, %d failed, %d crashed\n" "$TOTAL_PASS" "$TOTAL_FAIL" "$TOTAL_CRASH"
echo "========================================="
