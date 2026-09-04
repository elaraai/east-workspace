#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""A regex you cannot read as a regex."""
from east import East, StringType

PREFIX = "INV"
PATTERN = f"^{PREFIX}-[0-9]+$"  # expect: no-python-string-building


@East.function([StringType], StringType)
def normalised(b, s):
    return East.String.regex_replace(s, PATTERN, "", "")
