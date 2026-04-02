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
            out.write(f"\u25b6 {name}\n")
        try:
            if callable(test_fn):
                test_fn()
        except Exception:
            pass
        finally:
            depth -= 1
            if out and depth == 0:
                dur = (time.perf_counter() - t0) * 1000
                mark = "\u2714" if failed == 0 else "\u2716"
                out.write(f"{mark} {name} ({dur:.6f}ms)\n")

    def test_impl(name, test_fn):
        nonlocal passed, failed
        t0 = time.perf_counter()
        ok = True
        try:
            if callable(test_fn):
                test_fn()
        except Exception:
            ok = False
        dur = (time.perf_counter() - t0) * 1000
        if out:
            indent = "  " * depth
            mark = "\u2714" if ok else "\u2716"
            out.write(f"{indent}{mark} {name} ({dur:.6f}ms)\n")
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
        out.write(f"\u2139 tests {passed + failed}\n")

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
    parser = argparse.ArgumentParser(description="East compliance test runner")
    parser.add_argument("file", nargs="?", help="Single IR file or stem name")
    parser.add_argument("-q", "--quiet", action="store_true", help="Summary only")
    parser.add_argument("--ir-dir", type=Path, default=TEST_IR_DIR, help="IR directory")
    parser.add_argument("-p", "--platform", action="append", default=[], help="Platform module(s) to import")
    args = parser.parse_args()

    quiet = args.quiet
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

    # Parallel execution — print as each file completes (like east-c's run_compliance.sh)
    import concurrent.futures

    total_pass = total_fail = total_crash = 0

    t_start = time.perf_counter()
    with concurrent.futures.ProcessPoolExecutor() as pool:
        futures = {pool.submit(_run_one_subprocess, f, not quiet, platform_modules): f for f in files}
        for future in concurrent.futures.as_completed(futures):
            name, p, fl, output, err = future.result()
            if err:
                total_crash += 1
                print(f"  CRASH {name} ({err})", flush=True)
            else:
                total_pass += p
                total_fail += fl
                if not quiet:
                    sys.stdout.write(output)
                    sys.stdout.flush()
                else:
                    total = p + fl
                    if fl == 0:
                        print(f"  PASS  {name} ({p}/{total})", flush=True)
                    else:
                        print(f"  FAIL  {name} ({p}/{total}, {fl} failed)", flush=True)

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
