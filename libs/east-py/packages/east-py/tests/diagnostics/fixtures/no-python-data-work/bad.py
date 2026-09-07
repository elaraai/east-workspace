#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""The cleaning left behind in python by a migration: the null check is
decided about the PROXY, once, at build time."""
from east import East, StringType


def _clean(v):  # expect: no-python-data-work
    return v.trim() if v is not None else ""


@East.function([StringType], StringType)
def parsed(b, s):
    return _clean(s)
