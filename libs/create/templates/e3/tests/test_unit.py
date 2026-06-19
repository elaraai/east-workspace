"""Run TypeScript-exported IR tests through the east-c Python bridge.

Generate IR first:  npm run test:export
Then run:           uv run pytest -v
"""

from pathlib import Path

from east.runtime.compiler import compile_from_json
from east.runtime.platform import PlatformFunction
from east.runtime._compiler_eastc import _eastc_call
from east.types.types import FunctionType, NullType, StringType

try:
    from east_py_std import platform as std_platform
except ImportError:
    std_platform = []

try:
    from east_py_io import platform as io_platform
except ImportError:
    io_platform = []

# A project-owned platform module (scaffolded by `--platform`). Absent unless
# that feature is on, so this import is best-effort.
try:
    from platform_module import platform as project_platform
except ImportError:
    project_platform = []

TEST_IR_DIR = Path("dist/test-ir")


def _get_ir_files():
    if not TEST_IR_DIR.exists():
        return []
    return sorted(TEST_IR_DIR.glob("*.json"))


def run_one(ir_file: Path) -> tuple[int, int]:
    """Compile and run one IR test file. Returns (passed, failed)."""
    data = ir_file.read_bytes()
    is_async = b'"AsyncFunction"' in data[:100]

    passed = 0
    failed = 0

    def describe_impl(name, test_fn):
        if callable(test_fn):
            try:
                test_fn()
            except Exception:
                pass

    def test_impl(name, test_fn):
        nonlocal passed, failed
        try:
            if callable(test_fn):
                test_fn()
            passed += 1
        except Exception:
            failed += 1

    def test_pass():
        pass

    def test_fail(msg):
        raise AssertionError(msg)

    test_names = {"describe", "test", "testPass", "testFail"}
    platform = [
        pf for pf in std_platform if pf["name"] not in test_names
    ] + [
        pf for pf in io_platform if pf["name"] not in test_names
    ] + [
        pf for pf in project_platform if pf["name"] not in test_names
    ] + [
        PlatformFunction(name="describe", inputs=[StringType, FunctionType([], NullType)], output=NullType, type="sync", fn=describe_impl),
        PlatformFunction(name="test", inputs=[StringType, FunctionType([], NullType)], output=NullType, type="sync", fn=test_impl),
        PlatformFunction(name="testPass", inputs=[], output=NullType, type="sync", fn=test_pass),
        PlatformFunction(name="testFail", inputs=[StringType], output=NullType, type="sync", fn=test_fail),
    ]

    compiled = compile_from_json(data, platform, is_async=is_async)
    handle = compiled._eastc_handle
    _eastc_call(handle._compiled, handle._input_types, handle._output_type, ())
    return passed, failed


def pytest_generate_tests(metafunc):
    if "ir_file" in metafunc.fixturenames:
        files = _get_ir_files()
        metafunc.parametrize("ir_file", files, ids=[f.stem for f in files])


def test_ir(ir_file):
    passed, failed = run_one(ir_file)
    assert failed == 0, f"{failed} test(s) failed in {ir_file.stem}"
    assert passed > 0, f"No tests ran in {ir_file.stem}"
