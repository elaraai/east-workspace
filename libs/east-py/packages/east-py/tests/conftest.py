#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""CI runs no clocks.

A wall-clock assertion is a benchmark, not a test: on a shared CI runner
any timing ratio is flaky, and a flaky red on the pull request that really
regresses the thing being timed hides the regression in the noise. Every
test that asserts on elapsed time is marked ``perf`` and runs only under
``EAST_PERF=1`` (``make bench``); what CI pins is the MECHANISM the timing
claim rests on — a counter, a decode plan, a call count.
"""

import os

import pytest

PERF = os.environ.get("EAST_PERF") == "1"


def pytest_configure(config):
    config.addinivalue_line(
        "markers", "perf: asserts on elapsed time; runs only under EAST_PERF=1 (make bench)")


def pytest_collection_modifyitems(config, items):
    if PERF:
        return
    skip = pytest.mark.skip(reason="a wall-clock benchmark: EAST_PERF=1 (make bench) runs it")
    for item in items:
        if "perf" in item.keywords:
            item.add_marker(skip)
