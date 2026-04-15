"""Tests that run TypeScript-exported IR tests.

This module loads IR test files exported from TypeScript via `npm run test:export`
and executes them in Python to verify cross-implementation compatibility.

To generate the test IR files:
    npm run test:export
"""

import asyncio
from pathlib import Path
from typing import Any

import pytest
from east.runtime.compiler import compile, compile_async
from east.runtime.platform import PlatformFunction
from east.serialization.json import decode_json_for
from east.types.type_of_type import IRType
from east.types.types import FunctionType, NullType, StringType

from east_py_std import platform as std_platform
from east_py_io import platform as io_platform

# Path where TypeScript exports test IR
TEST_IR_DIR = Path("/tmp/e3-ui-showcase-tests")


def get_test_ir_files():
    """Get list of exported test IR JSON files."""
    if not TEST_IR_DIR.exists():
        return []
    files = list(TEST_IR_DIR.glob("*.json"))
    return sorted(files)


@pytest.fixture
def test_platforms(subtests):
    """Platform functions for tests - combines platform with test tracking."""
    executed_tests = []
    failures = []
    current_test_stack = []

    async def describe_impl(name: str, test_fn: Any) -> None:
        executed_tests.append(("describe", name))
        current_test_stack.append(("describe", name))
        with subtests.test(msg=f"[{name}]"):
            try:
                if callable(test_fn):
                    result = test_fn()
                    if asyncio.iscoroutine(result):
                        await result
            finally:
                current_test_stack.pop()

    async def test_impl_fn(name: str, test_fn: Any) -> None:
        test_path = " > ".join(n for _, n in current_test_stack) + f" > {name}"
        executed_tests.append(("test", name, test_path))
        current_test_stack.append(("test", name))
        with subtests.test(msg=test_path):
            try:
                if callable(test_fn):
                    result = test_fn()
                    if asyncio.iscoroutine(result):
                        await result
            except Exception as e:
                failures.append({"path": test_path, "error": str(e)})
                raise
            finally:
                current_test_stack.pop()

    def test_pass_impl() -> None:
        pass

    def test_fail_impl(message: str) -> None:
        raise AssertionError(message)

    test_platform_fns = [
        PlatformFunction(
            name="describe",
            inputs=[StringType, FunctionType([], NullType)],
            output=NullType,
            type="async",
            fn=describe_impl,
        ),
        PlatformFunction(
            name="test",
            inputs=[StringType, FunctionType([], NullType)],
            output=NullType,
            type="async",
            fn=test_impl_fn,
        ),
        PlatformFunction(
            name="testPass",
            inputs=[],
            output=NullType,
            type="sync",
            fn=test_pass_impl,
        ),
        PlatformFunction(
            name="testFail",
            inputs=[StringType],
            output=NullType,
            type="sync",
            fn=test_fail_impl,
        ),
    ]

    test_fn_names = {"describe", "test", "testPass", "testFail"}
    combined_platform = [
        pf for pf in std_platform if pf["name"] not in test_fn_names
    ] + [
        pf for pf in io_platform if pf["name"] not in test_fn_names
    ] + test_platform_fns

    return combined_platform, executed_tests, failures


@pytest.mark.parametrize(
    "test_file",
    get_test_ir_files(),
    ids=lambda p: p.stem,
)
def test_typescript_exported_ir(test_file, test_platforms):
    """Test that TypeScript-exported IR executes correctly in Python."""
    platform_fns, executed_tests, failures = test_platforms

    with open(test_file, "rb") as f:
        json_data = f.read()

    decoder = decode_json_for(IRType)
    ir = decoder(json_data)

    is_async_ir = ir.type == "AsyncFunction"
    compiled_test = (
        compile_async(ir, platform_fns) if is_async_ir else compile(ir, platform_fns)
    )

    print(f"\n{test_file.stem} test cases:", flush=True)
    if is_async_ir:
        asyncio.run(compiled_test())
    else:
        compiled_test()

    assert len(executed_tests) > 0, f"Test {test_file.stem} didn't execute any tests"

    test_count = sum(1 for t in executed_tests if t[0] == "test")
    if failures:
        pytest.fail(f"{len(failures)}/{test_count} test(s) failed")


def test_typescript_test_ir_directory_exists():
    """Verify that TypeScript test IR directory exists."""
    if not TEST_IR_DIR.exists():
        pytest.skip(
            f"Test IR directory {TEST_IR_DIR} not found. "
            "Run 'npm run test:export' to generate test files."
        )
    files = get_test_ir_files()
    assert len(files) > 0, f"No test IR files found in {TEST_IR_DIR}"
