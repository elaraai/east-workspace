#!/bin/bash
# Run east-c / east-c-std compliance suites.
#
# Usage: run_compliance.sh [ir-dir] [test-binary]
#   ir-dir       directory of exported IR .json files (default: /tmp/east-test-ir)
#   test-binary  the compliance harness (default: build/.../test_compliance)
#
# Runs the harness against each IR file and fails (exit 1) if any suite fails.
# The harness binaries exit non-zero on failure, so this relies on exit codes —
# no timeout/grep -oP/parallel — which keeps it portable across Linux, macOS,
# and Git Bash on Windows. The same script serves both east-c and east-c-std
# (they differ only in these two arguments).
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="${SCRIPT_DIR}/../../../build"
IR_DIR="${1:-/tmp/east-test-ir}"
TEST_BIN="${2:-${BUILD_DIR}/packages/east-c/test_compliance}"

# Allow a .exe binary (Windows / cross-build) to be passed without the suffix.
if [ ! -x "$TEST_BIN" ] && [ -x "${TEST_BIN}.exe" ]; then
    TEST_BIN="${TEST_BIN}.exe"
fi

if [ ! -x "$TEST_BIN" ]; then
    echo "Error: compliance binary not found/executable: $TEST_BIN (run: make build)"
    exit 1
fi
if [ ! -d "$IR_DIR" ]; then
    echo "Error: IR directory not found: $IR_DIR (run: make test-export)"
    exit 1
fi

pass=0
fail=0
for ir in "$IR_DIR"/*.json; do
    [ -e "$ir" ] || { echo "Error: no IR .json files in $IR_DIR"; exit 1; }
    name="$(basename "$ir" .json)"
    echo "── $name ──────────────────────────────────────────"
    if "$TEST_BIN" "$ir"; then
        pass=$((pass + 1))
    else
        rc=$?
        fail=$((fail + 1))
        # Print the exit code (hex too) — on Windows a crash exits with the
        # NTSTATUS, distinguishing a stack overflow (0xC00000FD) from other
        # faults (e.g. access violation 0xC0000005).
        printf '::error::compliance suite failed: %s (exit %d / 0x%x)\n' "$name" "$rc" "$rc"
    fi
done

echo "========================================="
echo "  Compliance: $pass passed, $fail failed"
echo "========================================="
[ "$fail" -eq 0 ]
