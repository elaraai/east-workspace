#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Iterative coordinate-descent optimization for East.

The three optimization functions (``optimization_iterative``,
``optimization_iterative_incremental``, ``optimization_iterative_grouped``)
are C-level implementations registered via PyCapsule callbacks; they are not
directly callable from Python.  Register them in your platform with
``optimization_impl`` and call them from East code.  The East type definitions
(config and result types) are re-exported here for building inputs with
``coerce_to`` and validating outputs.

See ``optimization.py`` module docstring for full signatures and field-level
documentation of ``IterativeConfigType`` and ``IterativeResultType``.
"""

from east_py_datascience.optimization.optimization import (
    EvaluationOrderType,
    InitialStrategyType,
    IterativeConfigType,
    IterativeResultType,
    ModeType,
    optimization_impl,
)

__all__ = [
    # Platform registration
    "optimization_impl",
    # East type definitions
    "InitialStrategyType",
    "EvaluationOrderType",
    "ModeType",
    "IterativeConfigType",
    "IterativeResultType",
]
