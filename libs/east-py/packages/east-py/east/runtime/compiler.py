#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""East IR compiler — delegates to east-c for compilation and execution.

All IR compilation, builtin resolution, and execution happens in east-c.
Python only provides platform function callbacks via the platform bridge.
"""

from collections.abc import Callable
from typing import Any

from east.runtime.platform import PlatformFunction

# Re-export constants used by serialization (bridge references these)
EAST_IR_ATTR = "_east_ir"
EAST_CAPTURES_ATTR = "_east_captures"


def compile_from_json(
    json_data: bytes,
    platform: list[PlatformFunction] | None = None,
    is_async: bool = False,
) -> Callable:
    """Compile East IR directly from JSON bytes — fast path, no Python round-trip."""
    from east.runtime._compiler_eastc import compile_eastc_from_json

    return compile_eastc_from_json(json_data, platform or [], is_async)


def compile_from_beast2(
    beast2_data: bytes,
    platform: list[PlatformFunction] | None = None,
    is_async: bool = False,
) -> Callable:
    """Compile East IR from BEAST2 bytes with header — fast path, no Python round-trip."""
    from east.runtime._compiler_eastc import compile_eastc_from_beast2

    return compile_eastc_from_beast2(beast2_data, platform or [], is_async)


def eager_stats() -> dict[str, int]:
    """Counters for how eager-method callbacks actually executed (#409).

    Under the strict surface (#625) an eager callback is captured into a
    native function or refused — there is no per-element python path, so
    nothing measures one. The counters cover what can still vary:

    - ``kernel_direct`` — calls where a precompiled function's native value
      was passed straight to the builtin (no capture needed).
    - ``c_to_py_decodes`` — values boxed C→python (the bridge's decode
      counter): an eager method that quietly decodes a whole collection to
      python shows up here, correct results notwithstanding.
    - ``beast2_segments_projected`` / ``beast2_segments_whole`` and the
      ``beast2_projection_declined_*`` reasons — beast2 column projection
      (#599) per segment decode, plus the compiled-body paged-loop pair.

    Use the delta around a hot call to see how it ran::

        before = eager_stats()
        rows.map(k)
        assert eager_stats()["kernel_direct"] == before["kernel_direct"] + 1
    """
    from east.runtime._compiler_eastc import _eager_counters_snapshot

    return _eager_counters_snapshot()


def compile_from_value(
    ir_value: Any,
    platform: list[PlatformFunction] | None = None,
    is_async: bool = False,
) -> Callable:
    """Compile East IR from a homoiconic IR value — an ``EastVariant``
    conforming to ``IRType``, e.g. one built with :mod:`east.ir.builders`.

    The value converts directly to a C value and compiles with no
    serialization round-trip; this is the kernel tracer's path (#398).
    """
    from east.runtime._compiler_eastc import compile_eastc_from_value

    return compile_eastc_from_value(ir_value, platform or [], is_async)


def compile_from_east(
    east_text: str,
    platform: list[PlatformFunction] | None = None,
    is_async: bool = False,
) -> Callable:
    """Compile East IR from East text format — fast path, no Python round-trip."""
    from east.runtime._compiler_eastc import compile_eastc_from_east

    return compile_eastc_from_east(east_text, platform or [], is_async)
