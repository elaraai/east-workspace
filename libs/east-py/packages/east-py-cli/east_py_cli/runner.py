#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""IR compilation and execution — uses east-c backend directly.

All formats (JSON, BEAST2, East text) go straight from raw bytes to C
with no Python IR round-trip.
"""

import os
import sys
from pathlib import Path
from time import perf_counter
from typing import Any

try:
    import resource  # Unix-only (getrusage); not present on Windows
except ImportError:  # pragma: no cover - Windows has no `resource` module
    resource = None  # type: ignore[assignment]

from east.runtime.compiler import compile_from_beast2, compile_from_east, compile_from_json
from east.runtime.platform import PlatformFunction
from east.serialization.east_printer import print_east, print_type

from east_py_cli.loader import detect_format, load_value, save_value


def _format_size(n: int) -> str:
    if n < 1024:
        return f"{n} B"
    if n < 1024 * 1024:
        return f"{n / 1024:.1f} KB"
    return f"{n / (1024 * 1024):.1f} MB"


def _format_file_size(path: Path) -> str:
    try:
        return _format_size(Path(path).stat().st_size)
    except OSError:
        return "?"


# Batching mirrors east-node / east-c: an element cap, refined toward a
# wire-byte target from the writer's actual output as segments flush — wide
# rows shrink the batch so a segment never grossly overshoots the target.
# (Beast2FileWriter's own re-batching is ROW-based and passes batches at or
# under its row target through untouched, so byte adaptation must happen
# here.)
_EMIT_BATCH_CAP = 1000
_EMIT_TARGET_BYTES = 2 * 1024 * 1024

# Out-of-order Set/Dict emission buffers and spills sorted runs of at most
# this many elements (EAST_EMIT_RUN_ELEMENTS overrides; minimum 1) — the
# in-memory bound of the sink's spill/merge path (issue #518).
_EMIT_RUN_ELEMENTS_DEFAULT = 100_000


def _emit_run_elements() -> int:
    env = os.environ.get("EAST_EMIT_RUN_ELEMENTS", "")
    if env:
        try:
            value = int(env)
        except ValueError:
            value = 0
        if value >= 1:
            return value
    return _EMIT_RUN_ELEMENTS_DEFAULT

# east-node parity: indexed beast2 collection inputs at or above this many
# bytes open as lazy paged values (EAST_LAZY_INPUT_BYTES overrides; 0
# disables). The --stream input always opens lazily.
_LAZY_INPUT_BYTES_DEFAULT = 64 * 1024 * 1024


def _lazy_input_threshold() -> int:
    env = os.environ.get("EAST_LAZY_INPUT_BYTES", "")
    if env:
        try:
            value = int(env)
        except ValueError:
            value = -1
        if value >= 0:
            return value
    return _LAZY_INPUT_BYTES_DEFAULT


def _load_frozen_input(type_ptr: object, file_path: Path, param_type: Any) -> object:
    """An eagerly-decoded FROZEN input value — task inputs are immutable
    (mutating builtins raise the uniform copy-first error, and frozen
    collections compare by value). beast2 files decode frozen directly;
    other formats load as python values and re-freeze through the beast2
    round-trip, so every format honors the same contract."""
    from east.runtime._compiler_eastc import freeze_value, load_frozen_value

    if Path(file_path).suffix.lower() in (".beast2", ".beast"):
        return load_frozen_value(type_ptr, Path(file_path).read_bytes())
    return freeze_value(type_ptr, load_value(file_path, param_type))


class _EmitSink:
    """The ``--emit`` capability: an East function value whose implementation
    is a native east-c accumulator (issue #560 phase 2) — the compiled body
    calls it per row with NO python in the loop; this class keeps every
    policy decision (file management, byte-adaptive batch sizing, the
    spill/merge machinery) and runs only at batch boundaries.

    Emission order is unconstrained (issue #518). While Set/Dict emissions
    stay strictly ascending in East (key) order, segments stream straight to
    the output file — O(batch) memory, byte-identical to an always-ascending
    producer. On the first out-of-order key the file written so far is
    finalized (a complete canonical beast2 file of the prefix) and demoted to
    spill run #0; emissions then buffer to a bounded element cap
    (``EAST_EMIT_RUN_ELEMENTS``) and spill as sorted runs beside the output,
    and :meth:`finish` k-way merges runs + tail into the canonical output.
    Either way the finished file holds ascending key-disjoint segments — the
    beast2 v5 wire contract — so emission order is a cost concern, never a
    correctness one. Duplicate Set/Dict keys are a hard error in every path:
    immediately (in C) when adjacent in the stream, at spill/merge time
    otherwise (native sorted-container lengths are the detector, so equality
    is East equality throughout)."""

    def __init__(self, kind: str, emit_param_type: object, output_file: Path,
                 verbose: bool = False):
        from east import ArrayType, DictType, SetType, compare_for
        from east.serialization._beast2_eastc import _EmitAccumCore
        from east.serialization.beast2 import open_beast2_file

        if Path(output_file).suffix.lower() not in (".beast2", ".beast"):
            raise ValueError("--emit requires a .beast2 output file (-o)")
        if getattr(emit_param_type, "type", None) not in ("Function", "AsyncFunction"):
            raise ValueError(
                "--emit requires the function's trailing parameter to be the emit "
                "capability (a function type)"
            )
        ins = emit_param_type.value["inputs"]  # type: ignore[attr-defined]
        expected = 2 if kind == "dict" else 1
        if len(ins) != expected:
            raise ValueError(
                f"--emit {kind} expects an emit parameter taking {expected} "
                f"argument(s), got {len(ins)}"
            )
        self.kind = kind
        self.emit_types = list(ins)
        self.output_file = Path(output_file)
        self.out_type: Any = (
            DictType(ins[0], ins[1]) if kind == "dict"
            else SetType(ins[0]) if kind == "set"
            else ArrayType(ins[0])
        )
        self._cmp = None if kind == "array" else compare_for(ins[0])
        self._key_type = None if kind == "array" else ins[0]
        self._verbose = verbose
        self._written = 0
        self._next_batch = _EMIT_BATCH_CAP
        self._writer: Any = open_beast2_file(output_file, self.out_type, mode="w")
        self._runs: list[Path] = []
        self._run_cap = _emit_run_elements()
        self._spilled_bytes = 0
        self._accum = _EmitAccumCore(
            {"array": 0, "set": 1, "dict": 2}[kind], self.emit_types,
            self._next_batch, self._run_cap,
            self._flush, self._demote_to_runs, self._spill)

    def function_value(self):
        """The emit capability as a native East function value: per-row
        compare + append run inside east-c, python only per batch.

        Passed to a compiled body it rides the FunctionType parameter as the
        value itself (the runner's path — no python in the loop). It is also
        callable, so a harness driving a ``@platform_function`` straight from
        python can hand it over as the emit capability and a pure callback
        still pushes down (issue #592)."""
        return self._accum.function_value(self.emit_types)

    def emit(self, *args: object) -> None:
        """Python-boundary emission — the same C acceptance path the
        compiled body takes, one marshalled row at a time."""
        self._accum.emit(*args)

    def _container_from(self, parts: tuple) -> Any:
        """The writer batch for one drained accumulator batch.

        Ascending mode drains sorted unique rows, so the container build is
        a straight native construction; buffered mode drains arrival order,
        and the sorted-container build IS the run sort — a collapsed
        East-equal duplicate shows as a length mismatch and is named.
        """
        if self.kind == "array":
            return parts[0]
        if self.kind == "dict":
            from east.types.values.collections import EastDict

            keys, values = parts
            built: Any = EastDict(self.emit_types[0], self.emit_types[1])
            built.update_many(keys, values)
            if len(built) != len(keys):
                self._raise_duplicate_in(list(keys))
            return built
        built = parts[0].to_set()
        if len(built) != len(parts[0]):
            self._raise_duplicate_in(list(parts[0]))
        return built

    def _flush(self) -> None:
        parts = self._accum.take_batch()
        flushed = len(parts[0])
        if flushed == 0:
            return
        self._writer.write(self._container_from(parts))
        self._written += flushed
        # Refine toward the byte target from real output. bytes_written
        # includes the header — a slight average overestimate that only
        # makes batches marginally smaller (east-node/east-c parity).
        avg = max(1, self._writer.bytes_written // max(self._written, 1))
        self._next_batch = max(1, min(_EMIT_BATCH_CAP, _EMIT_TARGET_BYTES // avg))
        self._accum.set_limit(self._next_batch)

    def finish(self) -> None:
        if self._accum.mode == 0:
            self._flush()
            self._writer.close()
            return
        self._merge_runs()

    # ── Out-of-order (spill/merge) path ──────────────────────────────────

    def _run_path(self, i: int) -> Path:
        return Path(f"{self.output_file}.run{i}")

    def _duplicate_message(self, key: object | None) -> str:
        noun, part = ("Dict", "key") if self.kind == "dict" else ("Set", "element")
        key_type = self._key_type
        shown = "" if key is None or key_type is None else f": {print_east(key, key_type)}"
        return f"beast2 v5: duplicate {noun} {part} emitted{shown} — {noun} {part}s must be unique"

    def _demote_to_runs(self) -> None:
        # The prefix written so far is ascending, so closing the writer
        # yields a complete canonical beast2 file — demote it to run #0; the
        # accumulator switches itself to buffered (sort-in-the-sink) mode.
        self._flush()
        self._writer.close()
        self._writer = None
        run0 = self._run_path(0)
        os.replace(self.output_file, run0)
        if self._written > 0:
            self._runs.append(run0)
            self._spilled_bytes += run0.stat().st_size
        else:
            run0.unlink()
        noun = "Dict keys" if self.kind == "dict" else "Set elements"
        print(
            f"east emit: {noun} left ascending order at element "
            f"{self._accum.emitted}; establishing canonical order in the sink "
            f"(spill/merge)",
            file=sys.stderr,
        )

    def _sorted_container(self, items: list) -> Any:
        """The native sorted container for python-side ``items`` (the merge's
        re-batched stream) — East containers sort in east-c, so this IS the
        run sort. A collapsed East-equal duplicate shows as a length mismatch
        and is named."""
        from east.types.values.collections import EastArray, EastDict

        if self.kind == "dict":
            built: Any = EastDict(self.emit_types[0], self.emit_types[1])
            built.update_many([k for k, _ in items], [v for _, v in items])
        else:
            built = EastArray(self.emit_types[0], list(items)).to_set()
        if len(built) != len(items):
            self._raise_duplicate_in(
                [it[0] for it in items] if self.kind == "dict" else list(items))
        return built

    def _raise_duplicate_in(self, keys_list: list) -> None:
        # Error path only: sort a copy in East order and name the first
        # adjacent East-equal pair.
        from east import make_east_key

        cmp = self._cmp
        assert cmp is not None  # the spill/merge path exists only for set/dict
        keyed = make_east_key(self._key_type)
        keys = sorted(keys_list, key=keyed)
        for a, b in zip(keys, keys[1:], strict=False):
            if cmp(a, b) == 0:
                raise ValueError(self._duplicate_message(b))
        raise ValueError(self._duplicate_message(None))

    def _spill(self) -> None:
        parts = self._accum.take_batch()
        if len(parts[0]) == 0:
            return
        from east.serialization.beast2 import open_beast2_file

        built = self._container_from(parts)
        path = self._run_path(len(self._runs))
        with open_beast2_file(path, self.out_type, mode="w") as writer:
            writer.write(built)
        self._runs.append(path)
        self._spilled_bytes += path.stat().st_size

    def _merge_runs(self) -> None:
        """K-way merge the spilled runs and the in-memory tail into the
        canonical output file — O(run cap + one decoded segment per run)
        memory, with the cross-run duplicate check on the merged stream."""
        import heapq
        import mmap
        from contextlib import ExitStack
        from functools import cmp_to_key

        from east.serialization.beast2 import iter_beast2_segments_for, open_beast2_file

        tail = self._container_from(self._accum.take_batch()) \
            if self._accum.pending() else None
        cmp = self._cmp
        assert cmp is not None  # the spill/merge path exists only for set/dict
        keyed = cmp_to_key(cmp)
        sort_key = (lambda item: keyed(item[0])) if self.kind == "dict" else keyed

        def run_stream(source):
            for segment in iter_beast2_segments_for(self.out_type)(source):
                yield from (segment.items() if self.kind == "dict" else segment)

        with ExitStack() as stack:
            run_gens: list = []
            for path in self._runs:
                handle = stack.enter_context(open(path, "rb"))
                mapped = stack.enter_context(
                    mmap.mmap(handle.fileno(), 0, access=mmap.ACCESS_READ)
                )
                run_gens.append(run_stream(mapped))
            # east-c borrows each mmap zero-copy while its reader is live, so
            # the generators (and their reader cores) must drop BEFORE the
            # mmaps unwind — otherwise an error mid-merge dies on BufferError
            # instead of the real (duplicate-key) error. Registered after the
            # mmaps, so it unwinds first.
            stack.callback(lambda: [gen.close() for gen in run_gens])
            streams: list = list(run_gens)
            if tail is not None and len(tail) > 0:
                streams.append(iter(tail.items()) if self.kind == "dict" else iter(tail))

            # Context manager: an error (a cross-run duplicate) leaves the
            # partial output unfinalized — no terminator or index — exactly
            # like an error on the straight-through path.
            with open_beast2_file(self.output_file, self.out_type, mode="w") as writer:
                batch: list = []
                merged = 0
                next_batch = _EMIT_BATCH_CAP
                prev_key: object = None
                has_prev = False
                for item in heapq.merge(*streams, key=sort_key):
                    key = item[0] if self.kind == "dict" else item
                    if has_prev and cmp(prev_key, key) == 0:
                        raise ValueError(self._duplicate_message(key))
                    prev_key = key
                    has_prev = True
                    batch.append(item)
                    if len(batch) >= next_batch:
                        writer.write(self._sorted_container(batch))
                        merged += len(batch)
                        batch = []
                        avg = max(1, writer.bytes_written // max(merged, 1))
                        next_batch = max(1, min(_EMIT_BATCH_CAP, _EMIT_TARGET_BYTES // avg))
                if batch:
                    writer.write(self._sorted_container(batch))
        for path in self._runs:
            path.unlink(missing_ok=True)
        if self._verbose:
            print(
                f"  emit: merged {len(self._runs)} spilled run(s) + in-memory tail "
                f"({_format_size(self._spilled_bytes)} temp)",
                file=sys.stderr,
            )


def run_program(
    ir_file: Path,
    platform_fns: list[PlatformFunction],
    packages: list[str],
    input_files: list[Path],
    output_file: Path | None = None,
    verbose: bool = False,
    emit: str | None = None,
    stream_input: int | None = None,
) -> object:
    """Run an East IR program."""
    fmt = detect_format(ir_file)
    is_async = False

    t0 = perf_counter()

    # Compile directly from raw data — no Python IR round-trip, single file read
    if fmt == "json":
        data = ir_file.read_bytes()
        is_async = b'"AsyncFunction"' in data[:200]
        compiled = compile_from_json(data, platform_fns, is_async)
    elif fmt == "beast2":
        data = ir_file.read_bytes()
        compiled = compile_from_beast2(data, platform_fns, is_async)
    elif fmt == "east":
        text = ir_file.read_text(encoding="utf-8")
        is_async = "AsyncFunction" in text[:200]
        compiled = compile_from_east(text, platform_fns, is_async)
    else:
        raise ValueError(f"Unknown IR format: {fmt}")

    t1 = perf_counter()

    handle = compiled._eastc_handle  # type: ignore[attr-defined]
    input_types = handle.get_input_types()
    output_type = handle.get_output_type()

    # With --emit the body takes one trailing runner-provided parameter (the
    # emit capability) beyond the input files; the output file is written
    # incrementally by the sink instead of from the return value.
    file_params = len(input_types) - 1 if emit is not None and input_types else len(input_types)

    # Validate input count
    if len(input_files) != file_params:
        sig_params = ", ".join(print_type(t) for t in input_types)
        raise ValueError(
            f"Function expects {file_params} inputs, got {len(input_files)}\n"
            f"Signature: ({sig_params}) -> {print_type(output_type)}"
        )
    if stream_input is not None and not 0 <= stream_input < file_params:
        # east-node / east-c parity: `--stream 0` on a zero-input program is
        # an error, not a silent no-op.
        raise ValueError(f"--stream index {stream_input} out of range ({file_params} inputs)")

    sink = None
    if emit is not None:
        if output_file is None:
            raise ValueError("--emit requires an output file (-o)")
        # A zero-parameter function has no trailing parameter to be the emit
        # capability — the shaped error, not an IndexError.
        sink = _EmitSink(emit, input_types[-1] if input_types else None, output_file,
                         verbose=verbose)

    # Verbose header
    if verbose:
        print(f"Running: {ir_file}  ({_format_file_size(ir_file)})", file=sys.stderr)

        if packages:
            print(
                f"Platform: {len(packages)} package(s), {len(platform_fns)} function(s)",
                file=sys.stderr,
            )
            for p in packages:
                print(f"  - {p}", file=sys.stderr)

        print(
            f"Function: {len(input_types)} inputs, {'async' if is_async else 'sync'}",
            file=sys.stderr,
        )
        for i, (file_path, param_type) in enumerate(zip(input_files, input_types, strict=False)):
            print(f"  input {i}: {file_path}  ({_format_file_size(file_path)})", file=sys.stderr)
            print(f"    {print_type(param_type)}", file=sys.stderr)
        print("  return:", file=sys.stderr)
        print(f"    {print_type(output_type)}", file=sys.stderr)

    # Load inputs with type-directed parsing — always FROZEN (task inputs are
    # immutable; mutating one raises the uniform copy-first error). The
    # streamed input always opens as a lazy paged value (segment-fed
    # iteration + keyed reads at O(segment) decoded memory — #505); other
    # indexed beast2 collection inputs open lazily at or above the size
    # threshold — and because frozen collapses the shape gate,
    # nested-container element shapes open lazily too. Anything not pageable
    # falls back to the whole (frozen) decode, exactly like east-node's
    # runner.
    from east.runtime._compiler_eastc import open_paged_value

    threshold = _lazy_input_threshold()
    inputs = []
    for i, (file_path, param_type) in enumerate(zip(input_files, input_types, strict=False)):
        lazy = None
        want_lazy = i == stream_input or (
            threshold > 0 and Path(file_path).stat().st_size >= threshold
        )
        if (
            want_lazy
            and Path(file_path).suffix.lower() in (".beast2", ".beast")
            and getattr(param_type, "type", None) in ("Array", "Set", "Dict")
        ):
            lazy = open_paged_value(handle._input_types[i], Path(file_path).read_bytes(),
                                    frozen=True)
        if lazy is not None:
            inputs.append(lazy)
        else:
            inputs.append(_load_frozen_input(handle._input_types[i], file_path, param_type))

    # The emit capability rides the trailing FunctionType parameter as a
    # native East function value: the compiled body's per-row calls run the
    # east-c accumulator directly — compare + append in C, python only at
    # the batch boundaries (#560 phase 2).
    if sink is not None:
        inputs.append(sink.function_value())

    t2 = perf_counter()

    # Execute via east-c
    from east.runtime._compiler_eastc import _eastc_call

    result = _eastc_call(handle._compiled, handle._input_types, handle._output_type, tuple(inputs))

    t3 = perf_counter()

    # Output
    if sink is not None:
        # The sink wrote the output incrementally; the (Null) return value is
        # unused. Closing writes the terminator, index and footer.
        sink.finish()
        if verbose:
            print(
                f"Output: {sink.output_file}  ({_format_file_size(sink.output_file)})",
                file=sys.stderr,
            )
            print(f"  {print_type(sink.out_type)}", file=sys.stderr)
    elif output_file is not None:
        save_value(output_file, result, output_type)
        if verbose:
            print(f"Output: {output_file}  ({_format_file_size(output_file)})", file=sys.stderr)
            print(f"  {print_type(output_type)}", file=sys.stderr)
    else:
        print(print_east(result, output_type))

    t4 = perf_counter()

    if verbose:
        print("\nTiming:", file=sys.stderr)
        print(f"  Load:     {(t1 - t0) * 1000:8.1f} ms", file=sys.stderr)
        print(f"  Compile:  {(t2 - t1) * 1000:8.1f} ms", file=sys.stderr)
        print(f"  Execute:  {(t3 - t2) * 1000:8.1f} ms", file=sys.stderr)
        print(f"  Output:   {(t4 - t3) * 1000:8.1f} ms", file=sys.stderr)
        print(f"  Total:    {(t4 - t0) * 1000:8.1f} ms", file=sys.stderr)

        # ru_maxrss is in KB on Linux, bytes on macOS. resource is Unix-only
        # (absent on Windows), so peak-RSS reporting is skipped there.
        if resource is not None:
            peak_kb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
            if sys.platform == "darwin":
                peak_kb = peak_kb / 1024
            print("\nMemory:", file=sys.stderr)
            if peak_kb >= 1024:
                print(f"  Peak RSS: {peak_kb / 1024:8.1f} MB", file=sys.stderr)
            else:
                print(f"  Peak RSS: {peak_kb:8.0f} KB", file=sys.stderr)

    return result
