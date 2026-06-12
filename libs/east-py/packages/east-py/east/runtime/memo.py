#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Content-addressed memoization for platform functions.

A development/test cache in the spirit of e3's content-addressable task
cache: the platform-function boundary is the cache boundary. The key is
sha256 over the function's name, the configured salts, and the per-input
digests of the BEAST2 (with-header) encodings coerced through the declared
input types; the value is the BEAST2 (with-header) encoding of the output,
decoded back through the declared output type — so a hit is indistinguishable
downstream from a fresh compute, and the type-directed decode is itself the
validation.

Memoization is OFF by default everywhere. ``@memoize`` only marks a platform
function as eligible — the author's assertion that it is pure in its East
inputs (no filesystem/network/database effects, replay acceptable). It
activates only when a cache directory is configured at runtime, via
:func:`configure_memo` or the ``EAST_MEMO_DIR`` environment variable
(``EAST_MEMO_SALT`` optionally salts every key). In production dataflow this
stays inert — e3 already content-addresses task outputs; double-caching would
waste disk and hide staleness.

The key recipe is runtime-agnostic (BEAST2 + sha256), so other East runtimes
can mirror it and share a cache directory:

    key = sha256(name \\x00 salt \\x00 fn_salt \\x00
                 sha256(beast2_full(input_0)) ... sha256(beast2_full(input_n)))
    file = <dir>/<name>-<key[:24]>.beast2     (beast2-full encoded output)

Code changes are invisible to the key — bump the salt (or clear the
directory) after editing a memoized function's implementation.
"""

from __future__ import annotations

import hashlib
import logging
import os
import tempfile
from collections.abc import Callable
from pathlib import Path
from typing import Any

from east.serialization.beast2 import (
    decode_beast2_with_header_for,
    encode_beast2_with_header_for,
)
from east.types.coercion import coerce_to

_log = logging.getLogger("east.memo")

_DIR: str | None = None
_SALT: str = ""
_CONFIGURED = False

_MISS = object()


def configure_memo(directory: str | None, salt: str = "") -> None:
    """Activate (or deactivate) memoization for ``@memoize`` platform functions.

    Takes precedence over the ``EAST_MEMO_DIR`` / ``EAST_MEMO_SALT``
    environment variables. Passing ``None`` deactivates memoization even when
    the environment variables are set.

    Args:
        directory: Cache directory (created on first save), or ``None`` to
            deactivate.
        salt: Extra string mixed into every cache key — bump it to invalidate
            after code changes, which the input-derived keys cannot see.
    """
    global _DIR, _SALT, _CONFIGURED
    _DIR, _SALT, _CONFIGURED = directory, salt, True


def _active() -> tuple[str, str] | None:
    """The (directory, salt) to memoize under, or None when inactive."""
    if _CONFIGURED:
        return (_DIR, _SALT) if _DIR else None
    directory = os.environ.get("EAST_MEMO_DIR")
    if not directory:
        return None
    return directory, os.environ.get("EAST_MEMO_SALT", "")


def memoize(fn: Callable[..., Any] | None = None, *, salt: str = "") -> Callable[..., Any]:
    """Content-addressed memo over one ``@platform_function``.

    Apply ABOVE ``@platform_function`` (it reads the declared input/output
    types off the wrapper), or call inline on an already-decorated function::

        @memoize                       # or @memoize(salt="v2")
        @platform_function(inputs=[...], output=ModelType)
        def train(train_fold, val_fold, config): ...

        cached_load = memoize(other_pkg.load, salt=content_digest)  # inline

    Only mark functions that are pure in their East inputs: on a hit the
    function body is SKIPPED, so a memoized function that writes files, rows,
    or requests silently drops those effects. Stochastic-but-pure functions
    (model fits) memoize their first realization — usually what a test
    harness wants, never what a certification run wants.

    Inert until activated; see :func:`configure_memo` / ``EAST_MEMO_DIR``.
    The module registry entry is updated in place, so East-runtime calls
    through ``platform_functions(__name__)`` share the cache with direct
    Python calls.

    Args:
        fn: The platform function to wrap (omit when parameterizing).
        salt: Per-function extra key salt, alongside the global one.

    Returns:
        The memoizing wrapper (or, with ``fn`` omitted, a decorator).

    Raises:
        TypeError: If ``fn`` is not a platform function — e.g. ``@memoize``
            was applied below ``@platform_function`` instead of above it.
    """
    if fn is None:
        return lambda f: memoize(f, salt=salt)

    pf = getattr(fn, "east_platform_function", None)
    if pf is None:
        raise TypeError(
            "@memoize must be applied above @platform_function "
            f"(no east_platform_function found on {fn!r})"
        )
    fn_salt = salt

    def _key(directory: str, global_salt: str, args: tuple) -> Path:
        h = hashlib.sha256()
        for part in (pf["name"], global_salt, fn_salt):
            h.update(part.encode())
            h.update(b"\x00")
        for arg, typ in zip(args, pf["inputs"], strict=True):
            encoded = encode_beast2_with_header_for(typ)(coerce_to(arg, typ))
            h.update(hashlib.sha256(encoded).digest())
        return Path(directory) / f"{pf['name']}-{h.hexdigest()[:24]}.beast2"

    def _load(args: tuple) -> tuple[Path | None, Any]:
        active = _active()
        if active is None:
            return None, _MISS
        path = _key(active[0], active[1], args)
        if path.exists():
            _log.info("hit %s (%s)", pf["name"], path)
            return path, decode_beast2_with_header_for(pf["output"])(path.read_bytes())
        return path, _MISS

    def _store(path: Path, out: Any) -> None:
        encoded = encode_beast2_with_header_for(pf["output"])(
            coerce_to(out, pf["output"])
        )
        path.parent.mkdir(parents=True, exist_ok=True)
        # Atomic publish: a crash mid-write must never leave a truncated blob,
        # and concurrent writers of one key converge on identical content.
        with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as tmp:
            try:
                tmp.write(encoded)
            except BaseException:
                Path(tmp.name).unlink(missing_ok=True)
                raise
        os.replace(tmp.name, path)
        _log.info("save %s (%s)", pf["name"], path)

    if pf["type"] == "async":

        async def run(*args: Any) -> Any:
            path, hit = _load(args)
            if hit is not _MISS:
                return hit
            out = await fn(*args)
            if path is not None:
                _store(path, out)
            return out
    else:

        def run(*args: Any) -> Any:
            path, hit = _load(args)
            if hit is not _MISS:
                return hit
            out = fn(*args)
            if path is not None:
                _store(path, out)
            return out

    run.__name__ = getattr(fn, "__name__", pf["name"])
    run.__doc__ = fn.__doc__
    # Re-point the SAME registry dict at the memoized callable, so calls
    # through platform_functions(__name__) and direct calls share the cache.
    pf["fn"] = run
    run.east_platform_function = pf  # type: ignore[attr-defined]
    return run
