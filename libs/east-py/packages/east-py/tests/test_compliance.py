#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Compliance tests — runs TypeScript-exported IR through east-c via Python bridge.

Output matches east-c's run_compliance.sh. Usage:
  python tests/test_compliance.py           # parallel, verbose (default)
  python tests/test_compliance.py -q        # parallel, summary only
  python tests/test_compliance.py Array     # single file, verbose
"""

import io
import os
import sys
import time
from pathlib import Path

TEST_IR_DIR = Path("/tmp/east-test-ir")


def get_test_ir_files(ir_dir: Path | None = None):
    d = ir_dir or TEST_IR_DIR
    if not d.exists():
        return []
    return sorted(d.glob("*.json"))


def run_one(ir_file: Path, out: io.StringIO | None = None, extra_platform: list | None = None) -> tuple[int, int]:
    """Run a single IR file. Returns (passed, failed). Writes east-c style output to `out`."""
    from east.runtime.compiler import compile_from_json
    from east.runtime.platform import PlatformFunction
    from east.types.types import FunctionType, NullType, StringType

    data = ir_file.read_bytes()
    is_async = b'"AsyncFunction"' in data[:100]

    passed = 0
    failed = 0
    depth = 0

    def describe_impl(name, test_fn):
        nonlocal depth
        t0 = time.perf_counter()
        depth += 1
        if out and depth == 1:
            out.write(f"[>] {name}\n")
        try:
            if callable(test_fn):
                test_fn()
        except Exception:
            pass
        finally:
            depth -= 1
            if out and depth == 0:
                dur = (time.perf_counter() - t0) * 1000
                mark = "[+]" if failed == 0 else "[x]"
                out.write(f"{mark} {name} ({dur:.6f}ms)\n")

    def test_impl(name, test_fn):
        nonlocal passed, failed
        t0 = time.perf_counter()
        ok = True
        err = None
        try:
            if callable(test_fn):
                test_fn()
        except Exception as e:
            ok = False
            err = e
        dur = (time.perf_counter() - t0) * 1000
        if out:
            indent = "  " * depth
            mark = "[+]" if ok else "[x]"
            out.write(f"{indent}{mark} {name} ({dur:.6f}ms)\n")
            # Print why it failed (the East testFail message or the raised
            # exception), matching east-c's harness — otherwise the log only
            # says which test failed, not why.
            if not ok and err is not None:
                out.write(f"{indent}    {err}\n")
        if ok:
            passed += 1
        else:
            failed += 1

    def test_pass():
        pass

    def test_fail(msg):
        raise AssertionError(msg)

    platform = [
        PlatformFunction(name="describe", inputs=[StringType, FunctionType([], NullType)], output=NullType, type="sync", fn=describe_impl),
        PlatformFunction(name="test", inputs=[StringType, FunctionType([], NullType)], output=NullType, type="sync", fn=test_impl),
        PlatformFunction(name="testPass", inputs=[], output=NullType, type="sync", fn=test_pass),
        PlatformFunction(name="testFail", inputs=[StringType], output=NullType, type="sync", fn=test_fail),
    ]

    # Filter out test harness functions from extra_platform — we provide our own
    # with counting/logging above
    test_names = {"describe", "test", "testPass", "testFail"}
    filtered_extra = [pf for pf in (extra_platform or []) if pf["name"] not in test_names]
    all_platform = platform + filtered_extra
    compiled = compile_from_json(data, all_platform, is_async=is_async)
    handle = compiled._eastc_handle
    from east.runtime._compiler_eastc import _eastc_call
    _eastc_call(handle._compiled, handle._input_types, handle._output_type, ())

    if out:
        out.write(f"[i] tests {passed + failed}\n")

    return passed, failed


def _load_platform_module(module_name: str) -> list:
    """Import a platform module and return its platform list."""
    import importlib
    mod = importlib.import_module(module_name)
    return mod.platform


def _run_one_subprocess(ir_file: Path, verbose: bool, platform_modules: list[str] | None = None) -> tuple[str, int, int, str, str]:
    """Run in subprocess. Returns (name, passed, failed, output_text, error)."""
    try:
        extra = []
        for mod_name in (platform_modules or []):
            extra.extend(_load_platform_module(mod_name))
        buf = io.StringIO() if verbose else None
        p, f = run_one(ir_file, out=buf, extra_platform=extra)
        return (ir_file.stem, p, f, buf.getvalue() if buf else "", "")
    except Exception as e:
        return (ir_file.stem, 0, 0, "", str(e))


def main():
    import argparse

    # Auto-detect EAST_QUIET env var
    env_quiet = os.environ.get("EAST_QUIET") == "1"

    parser = argparse.ArgumentParser(description="East compliance test runner")
    parser.add_argument("file", nargs="?", help="Single IR file or stem name")
    parser.add_argument("-q", "--quiet", action="store_true", help="Summary only")
    parser.add_argument("--ir-dir", type=Path, default=TEST_IR_DIR, help="IR directory")
    parser.add_argument("-p", "--platform", action="append", default=[], help="Platform module(s) to import")
    args = parser.parse_args()

    quiet = args.quiet or env_quiet
    ir_dir = args.ir_dir
    platform_modules = args.platform

    # Single file mode
    if args.file:
        f = Path(args.file)
        if not f.exists():
            f = ir_dir / f"{args.file}.json"
        extra = []
        for mod_name in platform_modules:
            extra.extend(_load_platform_module(mod_name))
        buf = io.StringIO()
        p, fl = run_one(f, out=buf, extra_platform=extra)
        sys.stdout.write(buf.getvalue())
        print(f"\nResults: {p}/{p + fl} passed")
        sys.exit(1 if fl > 0 else 0)

    files = get_test_ir_files(ir_dir)
    if not files:
        print(f"Error: No test IR files in {ir_dir}")
        sys.exit(1)

    # Run each IR file in its own isolated subprocess by re-invoking this script.
    # ProcessPoolExecutor reuses workers, causing ML libraries (PyTorch, sklearn,
    # XGBoost) loaded by early tasks to corrupt state for later ones. A fresh process
    # per file avoids this entirely.
    import re
    import subprocess

    platform_flags: list[str] = []
    for mod_name in (platform_modules or []):
        platform_flags += ['-p', mod_name]

    total_pass = total_fail = total_crash = 0

    t_start = time.perf_counter()
    for f in files:
        name = f.stem
        cmd = [sys.executable, __file__, str(f), '--ir-dir', str(ir_dir)] + platform_flags + ['-q']
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        out = result.stdout + result.stderr
        m = re.search(r'Results:\s*(\d+)/(\d+)', out)
        if m:
            p, total = int(m.group(1)), int(m.group(2))
            fl = total - p
            total_pass += p
            total_fail += fl
            if fl == 0:
                print(f"  [+] {name} ({p}/{total})", flush=True)
            else:
                print(f"  [x] {name} ({p}/{total}, {fl} failed)", flush=True)
                if not quiet:
                    sys.stdout.write(out)
        elif result.returncode != 0:
            total_crash += 1
            stderr_first = out.strip().splitlines()[-1] if out.strip() else f"exit {result.returncode}"
            print(f"  [!] {name} ({stderr_first})", flush=True)

    wall = (time.perf_counter() - t_start) * 1000

    print()
    print("=" * 41)
    print(f"  Total: {total_pass} passed, {total_fail} failed, {total_crash} crashed")
    print(f"  Wall:  {wall:.0f}ms")
    print("=" * 41)
    sys.exit(1 if (total_fail + total_crash) > 0 else 0)


# ─── Pytest integration ──────────────────────────────────────────────────

def pytest_generate_tests(metafunc):
    if "test_file" in metafunc.fixturenames:
        files = get_test_ir_files()
        metafunc.parametrize("test_file", files, ids=[f.stem for f in files])


def test_compliance(test_file):
    p, f = run_one(test_file)
    assert f == 0, f"{f} test(s) failed in {test_file.stem}"
    assert p > 0, f"No tests executed in {test_file.stem}"


if __name__ == "__main__":
    main()
