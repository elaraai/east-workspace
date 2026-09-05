#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""An authored constant, and a clock read that happens at runtime."""
from datetime import datetime

from east import East, DateTimeType

CUTOFF = datetime(2026, 6, 30, 7, 0, 0)


def stamped_now():
    return datetime.now()
