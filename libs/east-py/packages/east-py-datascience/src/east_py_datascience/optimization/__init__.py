#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Iterative coordinate-descent optimization for East.

The three optimization functions (``optimization_iterative``,
``optimization_iterative_incremental``, ``optimization_iterative_grouped``)
are C-level implementations registered via PyCapsule callbacks; they are not
directly callable from Python.  What each name exports is the DECLARATION an
East body calls; register the implementations with ``optimization_impl`` at
``East.compile``.  The East type definitions (config and result types) are
re-exported here for building inputs with ``coerce_to`` and validating
outputs.

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
    optimization_iterative,
    optimization_iterative_grouped,
    optimization_iterative_incremental,
)

__all__ = [
    # Platform registration
    "optimization_impl",
    # The declarations an East body calls
    "optimization_iterative",
    "optimization_iterative_incremental",
    "optimization_iterative_grouped",
    # East type definitions
    "InitialStrategyType",
    "EvaluationOrderType",
    "ModeType",
    "IterativeConfigType",
    "IterativeResultType",
]
