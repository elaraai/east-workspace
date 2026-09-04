#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""The build machine's files and environment, baked in."""
import json
import os
from pathlib import Path

from east import East, StringType

ROWS = json.load(open("seed.json"))  # expect: no-compile-time-data-injection
NOTES = Path("notes.txt").read_text()  # expect: no-compile-time-data-injection
REGION = os.environ["AWS_REGION"]  # expect: no-compile-time-data-injection
