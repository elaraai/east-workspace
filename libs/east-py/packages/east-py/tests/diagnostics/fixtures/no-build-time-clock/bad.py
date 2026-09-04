#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""The build machine's clock, frozen into the program."""
import time
from datetime import datetime

from east import East, DateTimeType

CUTOFF = datetime.now()  # expect: no-build-time-clock
STAMPED = time.time()  # expect: no-build-time-clock
