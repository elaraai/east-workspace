#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Parallel platform functions for East — multiprocessing-based.

Architecture mirrors the C-side `east_std_parallel_map_factory` (in east-c-std):
encode the East function once via beast2, split the input array into chunks,
ship each chunk + the function bytes to a worker process. Each worker decodes
locally, executes the function over its chunk, and returns the encoded result
array. The parent decodes and concatenates.

Why multiprocessing.Pool (not the C-side fork() impl):
The `east_std_parallel_map_factory` C function works correctly when called
from a pure-C runtime (east-c CLI, compliance tests). When invoked from a
Python process the forked child inherits the GIL state from a thread that
no longer exists, so any Python C-API call from `east_call`'s function
dispatch deadlocks. Python's multiprocessing.Pool re-initializes interpreter
state in the worker, sidestepping that problem.

The C implementation remains the canonical impl for native targets — both
implementations use beast2 as the cross-process wire format so the protocol
is identical.
"""

from __future__ import annotations

import multiprocessing
import os
from typing import TYPE_CHECKING, Any

from east.runtime.platform import generic_platform_function, platform_functions
from east.serialization.beast2 import (
    decode_beast2_with_header_for,
    encode_beast2_with_header_for,
)
from east.types.types import ArrayType, FunctionType

if TYPE_CHECKING:
    from east.runtime.platform import PlatformFunction


# Use 'fork' on Linux/macOS — faster startup. Workers initialise their own
# interpreter state cleanly via multiprocessing's bookkeeping (this is what
# distinguishes it from raw fork() where the GIL state from the parent
# thread is inherited but invalid).
_MP_CONTEXT = multiprocessing.get_context("fork")


def _serialize_chunks(
    array: list, num_workers: int
) -> list[list]:
    """Split `array` into `num_workers` roughly-equal chunks (preserving
    order — workers' results are concatenated in order)."""
    n = len(array)
    chunk_size = (n + num_workers - 1) // num_workers
    return [array[i : i + chunk_size] for i in range(0, n, chunk_size)]


def _build_worker_platform() -> list:
    """Workers re-import the standard platform impls rather than receiving
    them via pickle from the parent: the parent's platform list often
    contains unpicklable closures (e.g. test framework callbacks), and the
    standard impls are stateless / globally-shared anyway. State.bind etc
    are NOT supported across worker boundaries — the mapping function must
    be a pure function of its input (matching the C-side impl's contract).

    Function-level import to avoid a circular dependency at module load
    (east_py_std/__init__.py imports `parallel_impl` from this module)."""
    from east_py_std import platform as _all_platform
    return list(_all_platform)


def _worker(
    fn_bytes: bytes,
    chunk_bytes: bytes,
    fn_type: Any,
    array_t_type: Any,
    array_r_type: Any,
) -> bytes:
    """Runs in a worker process. Decodes function + chunk, applies fn over
    each item, returns encoded result array bytes."""
    platform = _build_worker_platform()
    fn = decode_beast2_with_header_for(fn_type, {"platform": platform})(fn_bytes)
    chunk = decode_beast2_with_header_for(array_t_type)(chunk_bytes)

    results = [fn(item) for item in chunk]

    return encode_beast2_with_header_for(array_r_type)(results)


@generic_platform_function(
    name="parallel_map",
    type_parameters=["T", "R"],
    is_async=True,
)
def _parallel_map_factory(
    platform: list[PlatformFunction] | None, T: Any, R: Any  # noqa: N803
) -> Any:
    """Returns the parallel_map implementation specialised for type
    parameters [T, R]. Factory signature is `(platform_list, *type_params)`
    matching east-py's GenericPlatformFunction convention.

    The mapping function (an East-compiled callable) carries `_east_ir`
    metadata; we serialise it via beast2 to ship across process boundaries.
    """
    del platform  # workers re-import standard impls — see _build_worker_platform
    fn_type = FunctionType([T], R)
    array_t_type = ArrayType(T)
    array_r_type = ArrayType(R)

    async def _parallel_map(array: Any, fn: Any) -> Any:
        items = list(array)
        n = len(items)
        if n == 0:
            return []

        # For tiny arrays sequential beats fork+IPC overhead. Threshold
        # mirrors the C-side impl in east-c-std/parallel.c.
        if n <= 4:
            return [fn(item) for item in items]

        num_workers = min(os.cpu_count() or 4, n)

        # Encode once: function bytes are shared across all worker tasks.
        fn_encode = encode_beast2_with_header_for(fn_type)
        chunk_encode = encode_beast2_with_header_for(array_t_type)
        result_decode = decode_beast2_with_header_for(array_r_type)

        fn_bytes = fn_encode(fn)
        chunks = _serialize_chunks(items, num_workers)
        chunk_bytes_list = [chunk_encode(chunk) for chunk in chunks]

        with _MP_CONTEXT.Pool(processes=num_workers) as pool:
            result_bytes_list = pool.starmap(
                _worker,
                [
                    (fn_bytes, cb, fn_type, array_t_type, array_r_type)
                    for cb in chunk_bytes_list
                ],
            )

        # Decode each chunk's result and concatenate in order.
        decoded: list = []
        for rb in result_bytes_list:
            decoded.extend(result_decode(rb))
        return decoded

    return _parallel_map


# Collected from the @generic_platform_function decoration above.
parallel_impl = platform_functions(__name__)


__all__ = ["parallel_impl"]
