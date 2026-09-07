#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""The build machine's files and environment, baked into the program."""
import os
from pathlib import Path

from east import East, StringType

SOURCE = open(__file__).read()  # expect: no-compile-time-data-injection
NOTES = Path(__file__).read_text()  # expect: no-compile-time-data-injection
REGION = os.environ.get("AWS_REGION", "ap-southeast-2")  # expect: no-compile-time-data-injection


@East.function([StringType], StringType)
def describe(b, s):
    region = b.const(REGION, StringType)
    source = b.const(SOURCE, StringType)
    notes = b.const(NOTES, StringType)
    return region + source + notes + s
