#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Collection files in segments of a test's own size.

Every writer of a stored collection cuts it by the content-defined rule,
which holds a test-sized fixture in one segment; a test of what a reader does
at segment boundaries needs more of them than that. ``Beast2Writer`` makes each
batch it is given a segment, so this writes a value in batches of ``size``.
"""

from east import EastArray, EastDict, EastSet
from east.serialization.beast2 import Beast2Writer


def write_in_segments(path, collection_type, value, size, codec="deflate") -> None:
    """Write ``value`` to ``path`` in segments of ``size`` elements (pairs,
    for a Dict), in canonical order.

    Args:
        path: The file to create.
        collection_type: The Array, Set or Dict type.
        value: The collection — an East collection or the matching python
            builtin (list, set, dict).
        size: Elements per segment.
        codec: Segment codec, ``"deflate"`` or ``"none"``.
    """
    kind = collection_type.type
    if kind == "Array":
        items = list(value)
    elif kind == "Set":
        items = list(value if isinstance(value, EastSet) else EastSet(collection_type.value, value))
    else:
        key_t, value_t = collection_type.value["key"], collection_type.value["value"]
        items = list((value if isinstance(value, EastDict) else EastDict(key_t, value_t, value)).items())

    def batch_of(chunk):
        if kind == "Array":
            return EastArray(collection_type.value, chunk)
        if kind == "Set":
            return EastSet(collection_type.value, chunk)
        batch = EastDict(collection_type.value["key"], collection_type.value["value"])
        for key, item in chunk:
            batch[key] = item
        return batch

    with open(path, "wb") as stream, Beast2Writer(collection_type, stream, codec=codec) as writer:
        for i in range(0, len(items), size):
            writer.write(batch_of(items[i:i + size]))
