#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The decoded weight a pager's cache counts (#1129), held to the shared fixture
every runtime reads: ``libs/east/test/fixtures/paged-weights.beast2``, which
``make paged-weights`` in libs/east writes.

Each case's blob is an indexed Array of one segment holding the case's value.
Reading that element through the pager's cache — east-c's, which every lazy
file of this runtime reads through — leaves the cache weighing the value and
the Array of one around it: the number TypeScript's and east-c's caches give
the same segment."""

from pathlib import Path

import pytest
from east.serialization._beast2_eastc import _Beast2PagesCore

from east.serialization.beast2 import decode_beast2_with_header_for, read_beast2_type

FIXTURE = Path(__file__).resolve().parents[5] / "east" / "test" / "fixtures" / "paged-weights.beast2"

#: The one-segment Array around each case's value: its node (104) and its one slot (8).
SEGMENT_OF_ONE = 104 + 8


def _cases():
    assert FIXTURE.is_file(), f"{FIXTURE} is missing: `make paged-weights` in libs/east writes it"
    data = FIXTURE.read_bytes()
    return list(decode_beast2_with_header_for(read_beast2_type(data))(data))


CASES = _cases()


def test_the_fixture_holds_a_value_of_every_kind():
    assert len(CASES) >= 30


@pytest.mark.parametrize("case", CASES, ids=[case["name"] for case in CASES])
def test_the_cache_weighs_each_case_as_every_runtime_does(case):
    blob = bytes(case["blob"])
    pages = _Beast2PagesCore(read_beast2_type(blob), blob)
    pages.element(0)
    stats = pages.cache_stats()
    assert stats["segments"] == 1
    assert stats["weight"] == SEGMENT_OF_ONE + case["weight"]
