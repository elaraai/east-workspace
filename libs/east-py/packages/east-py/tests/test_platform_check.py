#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Cross-backend platform-signature check parity (east-workspace#62).

Compiles TypeScript-exported IR against a deliberately drifted typed platform
registration and asserts the compile error message is byte-identical to the
TS analyzer's (captured into the sibling .error.txt fixture by
libs/east/test/platform_check.spec.ts). The drifted registrations below must
stay in lockstep with that spec and with east-c tests/test_platform_check.c.

Requires `make test-export` at the workspace root; skips otherwise.
"""

import tempfile
from pathlib import Path

import pytest


def _resolve_ir_dir(s: str) -> Path:
    # Mirror tests/test_compliance.py: on Windows the TS side writes under
    # %TEMP% via the MSYS /tmp rewrite, Python sees the literal path.
    p = Path(s)
    try:
        rel = p.relative_to("/tmp")
    except ValueError:
        return p
    return Path(tempfile.gettempdir()) / rel


FIXTURE_DIR = _resolve_ir_dir("/tmp/east-test-ir") / "platform_check"

CASES = ["arg_count", "input_type", "return_type", "match"]


def _registered_signature(case: str):
    """The drifted (registration-side) signature for a fixture case."""
    from east.types.types import ArrayType, FloatType, IntegerType, StructType

    return {
        "arg_count": ([IntegerType, IntegerType], IntegerType),
        "input_type": ([ArrayType(FloatType)], IntegerType),
        "return_type": ([IntegerType], StructType([("a", IntegerType)])),
        "match": ([IntegerType], IntegerType),
    }[case]


@pytest.mark.skipif(
    not FIXTURE_DIR.exists(),
    reason="platform_check fixtures missing — run `make test-export` at the workspace root",
)
@pytest.mark.parametrize("case", CASES)
def test_platform_signature_check(case: str):
    from east.runtime.compiler import compile_from_json
    from east.runtime.errors import EastError

    inputs, output = _registered_signature(case)

    def never_invoked(*_args):
        raise AssertionError("platform_check: never invoked")

    platform = [
        {
            "name": "compliance.check",
            "inputs": inputs,
            "output": output,
            "type": "sync",
            "fn": never_invoked,
        }
    ]

    data = (FIXTURE_DIR / f"{case}.json").read_bytes()

    if case == "match":
        # Well-typed control: identical declaration must compile clean.
        compile_from_json(data, platform, is_async=False)
        return

    expected = (FIXTURE_DIR / f"{case}.error.txt").read_text(encoding="utf-8").strip()
    with pytest.raises(EastError) as exc_info:
        compile_from_json(data, platform, is_async=False)
    assert str(exc_info.value) == expected
