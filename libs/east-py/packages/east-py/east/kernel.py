#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Deprecated alias of :mod:`east.expression` (renamed in #625; one release).

Importing this module re-exports the whole ``east.expression`` surface and
registers submodule aliases, so ``from east.kernel import kernel`` and
``import east.kernel.errors`` both keep working while call sites migrate.
"""

import sys
import warnings

warnings.warn(
    "east.kernel is renamed east.expression (#625) — this alias will be "
    "removed in a future release",
    DeprecationWarning,
    stacklevel=2,
)

import east.expression as _expression  # noqa: E402
import east.expression.capture  # noqa: E402
import east.expression.control  # noqa: E402
import east.expression.errors  # noqa: E402
import east.expression.expr  # noqa: E402
import east.expression.finalize  # noqa: E402
import east.expression.function  # noqa: E402
import east.expression.helpers  # noqa: E402
import east.expression.lift  # noqa: E402
import east.expression.nodes  # noqa: E402
import east.expression.ops  # noqa: E402
import east.expression.project  # noqa: E402
from east.expression import *  # noqa: E402,F401,F403
from east.expression import (  # noqa: E402,F401
    _eligible,
    _lift,
    _tracing,
    capture_callback,
    trace,
    trace_builtin_call,
)

#: ``pushdown.try_push_down`` became ``capture.capture_callback`` (#625).
try_push_down = capture_callback

for _name, _mod in [
    ("control", east.expression.control),
    ("errors", east.expression.errors),
    ("expr", east.expression.expr),
    ("finalize", east.expression.finalize),
    ("function", east.expression.function),
    ("trace", east.expression.function),  # trace.py became function.py
    ("helpers", east.expression.helpers),
    ("lift", east.expression.lift),
    ("nodes", east.expression.nodes),
    ("ops", east.expression.ops),
    ("project", east.expression.project),
    ("capture", east.expression.capture),
    ("pushdown", east.expression.capture),  # pushdown.py became capture.py
]:
    sys.modules[f"east.kernel.{_name}"] = _mod

__all__ = _expression.__all__
