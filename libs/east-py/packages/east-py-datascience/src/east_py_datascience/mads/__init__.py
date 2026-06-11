#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""MADS derivative-free optimization for East - NOMAD blackbox optimization via PyNomadBBO.

The ``*_impl`` functions are plain Python callables taking and returning East
values - import them directly from a project's own ``@platform_function`` to
reuse the implementations without an IR round-trip. The East type definitions
(config, constraint, and result types) are re-exported here for building inputs
with ``coerce_to`` and validating outputs.
"""

from east_py_datascience.mads.mads import (
    MADSBoundsType,
    MADSConfigType,
    MADSConstraintType,
    MADSDirectionType,
    MADSResultType,
    mads_impl,
    mads_optimize_impl,
)

__all__ = [
    # Platform registration
    "mads_impl",
    # Directly-callable implementations
    "mads_optimize_impl",
    # East type definitions
    "MADSBoundsType",
    "MADSConstraintType",
    "MADSDirectionType",
    "MADSConfigType",
    "MADSResultType",
]
