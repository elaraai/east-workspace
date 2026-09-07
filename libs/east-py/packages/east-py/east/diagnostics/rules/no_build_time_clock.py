#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``no-build-time-clock``: reading the clock at module scope freezes the
BUILD moment into the program. East source is compiled and deployed; a
constant computed as "two hours ago" means two hours before the deploy, and
means something different every day after it. Author the datetime, or read
the clock at RUNTIME — inside a platform function, or ``east_py_std``'s
``time_now()`` in a body — so a read inside a ``def`` is never flagged, and
neither is a script's ``if __name__ == "__main__":`` block, which an import
never runs. The TypeScript rule of the same name.
"""

from __future__ import annotations

import ast

from east.diagnostics.scope import import_time_nodes
from east.diagnostics.types import Body, Context

MESSAGE = ("a module-scope clock read bakes the BUILD moment into the deployed program — author "
           "the datetime as a constant, or read the clock at runtime: inside a platform function, "
           "or east_py_std's time_now() in a body")

#: ``datetime.now()`` / ``datetime.utcnow()`` / ``datetime.today()``
_DATETIME_READS = frozenset({"now", "utcnow", "today"})
#: ``time.time()`` and friends — the module-level clock functions
_TIME_READS = frozenset({"time", "time_ns", "monotonic", "monotonic_ns", "perf_counter"})


class NoBuildTimeClock:
    name = "no-build-time-clock"
    code = 19
    category = "warning"
    description = ("No clock read at module scope of East source — it bakes the build moment into "
                   "the deployed program.")

    def check(self, body: Body, ctx: Context) -> None:
        # A read inside any callable runs at runtime; only module scope bakes in.
        del body, ctx

    def check_module(self, ctx: Context) -> None:
        for node in import_time_nodes(ctx):
            if isinstance(node, ast.Call) and _is_clock_read(node):
                ctx.report(node, self, MESSAGE)


def _is_clock_read(node: ast.Call) -> bool:
    func = node.func
    if not isinstance(func, ast.Attribute):
        return False
    if func.attr in _DATETIME_READS:
        root = func.value
        name = root.attr if isinstance(root, ast.Attribute) else getattr(root, "id", "")
        return name in ("datetime", "date")
    return func.attr in _TIME_READS and isinstance(func.value, ast.Name) and func.value.id == "time"
