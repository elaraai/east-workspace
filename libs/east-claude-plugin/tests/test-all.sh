#!/usr/bin/env bash
# Run all tests
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "========================================"
echo "  Running all tests"
echo "========================================"
echo ""

FAILED=0

run_test() {
    local test_script="$1"
    local test_name=$(basename "$test_script" .sh)

    echo ">>> $test_name"
    if "$SCRIPT_DIR/$test_script"; then
        echo ""
    else
        echo "!!! $test_name FAILED"
        FAILED=$((FAILED + 1))
        echo ""
    fi
}

# Fast tests first
run_test "test-scripts-syntax.sh"
run_test "test-project-east.sh"
run_test "test-project-e3.sh"

# Slow tests (Docker) - skip if no docker or if --quick flag
if [ "$1" != "--quick" ] && command -v docker &> /dev/null; then
    run_test "test-docker-builds.sh"
else
    echo ">>> Skipping Docker tests (use without --quick to include)"
    echo ""
fi

echo "========================================"
if [ $FAILED -gt 0 ]; then
    echo "  $FAILED test(s) FAILED"
    exit 1
else
    echo "  All tests PASSED"
fi
echo "========================================"
