#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""The pattern spelled out, and an f-string that stays in python."""
from east import East, StringType

PATTERN = "^INV-[0-9]+$"
LOG_LINE = f"checked {PATTERN}"


@East.function([StringType], StringType)
def normalised(b, s):
    return East.String.regex_replace(s, PATTERN, "", "")
