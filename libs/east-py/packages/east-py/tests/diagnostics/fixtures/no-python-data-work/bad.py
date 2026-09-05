#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""The cleaning left behind in python by a migration."""
from east import East, FloatType, StringType


def _clean(v):  # expect: no-python-data-work
    return float(v.strip())


@East.function([StringType], FloatType)
def parsed(b, s):
    return _clean(s)
