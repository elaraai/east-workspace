#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Beast v2 binary format for East types.

All encode/decode is handled by east-c via the _beast2_eastc Cython extension.
The decode entry points dispatch on the container magic's version byte, so v4
and v5 blobs decode through the same functions; only encoding picks a version,
and ``encode_beast2_with_header_for(T, version=4)`` is the escape hatch for a
reader that predates v5 (the default is v5). The v5 streaming APIs below
(``Beast2Writer``, ``iter_beast2_segments_for``) give bounded-memory encode
and decode of large collections (issue #416); the wire specification lives in
libs/east/src/serialization/beast2/v5/SPEC.md.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, TypedDict

if TYPE_CHECKING:
    from collections.abc import Iterable, Iterator

    from east.runtime.platform import PlatformFunction

# Beast v2 magic bytes: 0x89 "East" CRLF 0x01
BEAST2_MAGIC_BYTES = bytes([137, 69, 97, 115, 116, 13, 10, 1])

#: v4 container magic (the current default write format).
BEAST2_V4_MAGIC = bytes([0x89, 0x45, 0x61, 0x73, 0x74, 0x0D, 0x0A, 0x04])
#: v5 container magic (the segment-terminated record stream).
BEAST2_V5_MAGIC = bytes([0x89, 0x45, 0x61, 0x73, 0x74, 0x0D, 0x0A, 0x05])

_SEGMENTED = ("Array", "Set", "Dict")


class Beast2DecodeOptions(TypedDict, total=False):
    """Options for decoding, allowing function compilation.

    Attributes:
        platform: List of platform functions available for function compilation
    """

    platform: list[PlatformFunction]


from east.serialization._beast2_eastc import (  # type: ignore[import-not-found]  # noqa: E402
    _Beast2PagesCore,
    _Beast2ReaderCore,
    _Beast2WriterCore,
    _encode_beast2_v5,
    decode_beast2_for,
    decode_beast2_with_header_for,
    encode_beast2_for,
    encode_beast2_with_header_for,
)


def _check_segmented(collection_type) -> str:
    kind = getattr(collection_type, "type", None)
    if kind not in _SEGMENTED:
        raise TypeError(f"beast2 v5 streams hold Array, Set or Dict values, not {kind!r}")
    return kind


class Beast2Writer:
    """Stream a large collection to ``stream`` one v5 segment at a time.

    Each :meth:`write` encodes one batch — a value of the declared collection
    type — as one root segment, so peak memory is one batch plus its aliased
    containers, never the whole collection. The header is written on
    construction and :meth:`close` appends the terminator plus (by default)
    the paging index and footer, so the output is append-only end to end.
    Usable as a context manager; :meth:`close` is idempotent.

    The resulting blob decodes through the ordinary entry points
    (``decode_beast2_with_header_for`` merges every segment) or segment by
    segment via :func:`iter_beast2_segments_for`.
    """

    def __init__(self, collection_type, stream, *, codec: str = "deflate",
                 self_contained: bool = True, index: bool = True):
        _check_segmented(collection_type)
        self._core = _Beast2WriterCore(collection_type, codec, self_contained, index)
        self._stream = stream
        self._closed = False
        self.segments = 0
        stream.write(self._core.take())

    def write(self, batch) -> None:
        """Encode ``batch`` (a value of the declared type) as one segment.

        Empty batches are skipped — a segment count is never zero, so the
        stream terminator stays unambiguous.
        """
        if self._closed:
            raise ValueError("write() after close()")
        if not len(batch):
            return
        self._core.write(batch)
        self.segments += 1
        self._stream.write(self._core.take())

    def close(self) -> None:
        """Write the terminator (and index + footer). Idempotent."""
        if not self._closed:
            self._closed = True
            self._core.finish()
            self._stream.write(self._core.take())

    def __enter__(self) -> Beast2Writer:
        return self

    def __exit__(self, *exc) -> None:
        self.close()


def encode_beast2_v5_for(collection_or_value_type, *, codec: str = "deflate",
                         index: bool = False):
    """Curried whole-value v5 encoder: ``encode(value) -> bytes``.

    Any root type is accepted; ``index=True`` additionally writes the paging
    index + footer for Array/Set/Dict roots. Decode with the ordinary
    ``decode_beast2_with_header_for`` (entry points dispatch on the magic).
    """

    def encode(value) -> bytes:
        return _encode_beast2_v5(collection_or_value_type, value, codec, index)

    return encode


def encode_beast2_segments_for(collection_type, *, codec: str = "deflate",
                               self_contained: bool = True, index: bool = True):
    """Curried batch encoder: ``encode(batches) -> bytes``.

    ``batches`` is an iterable of values of the declared collection type; each
    non-empty batch becomes one segment. The in-memory convenience form of
    :class:`Beast2Writer` — use the writer to stream to a file.
    """
    _check_segmented(collection_type)

    def encode(batches: Iterable) -> bytes:
        import io

        buf = io.BytesIO()
        with Beast2Writer(collection_type, buf, codec=codec,
                          self_contained=self_contained, index=index) as writer:
            for batch in batches:
                writer.write(batch)
        return buf.getvalue()

    return encode


def iter_beast2_segments_for(collection_type, options: Beast2DecodeOptions | None = None):
    """Curried streaming decoder: ``segments(source)`` yields one decoded
    collection per v5 root segment, in stream order, with O(segment) decoded
    memory — the caller merges (or processes each batch and drops it).

    ``source`` is ``bytes``, ``bytearray``, ``memoryview``, an ``mmap``, or a
    readable binary stream (streams are read fully into memory first; pass an
    ``mmap`` for large files to keep resident memory at one segment).
    """
    del options  # decoded functions are compiled by east-c's own registries
    _check_segmented(collection_type)

    def segments(source) -> Iterator:
        core = _Beast2ReaderCore(collection_type, _as_buffer(source))
        while True:
            segment = core.next()
            if segment is None:
                return
            yield segment

    return segments


def _as_buffer(source):
    """Normalize a source to a buffer-protocol object east-c can borrow.

    Streams are read fully into memory; pass an ``mmap`` for a large file so
    resident memory stays at one segment.
    """
    if isinstance(source, (bytes, bytearray, memoryview)):
        return source
    if hasattr(source, "read"):
        return source.read()
    return source  # buffer-protocol objects (e.g. mmap)


def read_beast2_index(collection_type, source) -> tuple[int, int] | None:
    """Return ``(segment_count, element_count)`` from a v5 blob's trailing
    index, or ``None`` when the blob carries no index. ``element_count`` is
    exact for Array roots and an upper bound for Set/Dict roots (cross-segment
    duplicates collapse on merge)."""
    core = _Beast2ReaderCore(collection_type, _as_buffer(source))
    return core.counts()


class Beast2Pages:
    """Random access over an indexed, self-contained v5 collection blob.

    The index is read once on construction, so :attr:`element_count` and
    :attr:`counts` are O(1); :meth:`segment` seeks to and decodes exactly one
    segment, and :meth:`element` decodes only the segment owning a row.

    Requires a blob written with the index enabled (:class:`Beast2Writer`'s
    default). Random access *additionally* requires self-contained segments —
    :attr:`self_contained` reports the flag, and :meth:`segment` refuses rather
    than returning values whose cross-segment backrefs cannot be resolved.

    The pages object borrows the source bytes: keep them alive and unchanged
    for as long as you call :meth:`segment` / :meth:`element`. Pass an ``mmap``
    for a large file so resident memory stays at one segment.
    """

    def __init__(self, collection_type, source):
        _check_segmented(collection_type)
        self._core = _Beast2PagesCore(collection_type, _as_buffer(source))
        self.segment_count: int = self._core.segment_count()
        """Number of segments in the blob."""
        self.element_count: int = self._core.element_count()
        """Sum of the per-segment counts. Exact for Array roots; an upper bound
        for Set/Dict roots, where cross-segment duplicates collapse on merge."""
        self.self_contained: bool = self._core.self_contained()
        """Whether segments are independently decodable (required to seek)."""
        self.counts: tuple[int, ...] = self._core.counts()
        """Per-segment element (pair) counts, in segment order."""

    def segment(self, i: int):
        """Decode segment ``i`` — one seek, one frame, nothing else read."""
        if i < 0:
            raise IndexError(f"beast2 v5: segment index must not be negative, got {i}")
        return self._core.segment(i)

    def element(self, row: int):
        """Decode the single element at ``row`` (Array roots only)."""
        if row < 0:
            raise IndexError(f"beast2 v5: element index must not be negative, got {row}")
        return self._core.element(row)

    def __len__(self) -> int:
        return self.element_count

    def __getitem__(self, row: int):
        return self.element(row)


def open_beast2_pages_for(collection_type, options: Beast2DecodeOptions | None = None):
    """Curried paging opener: ``open(source) -> Beast2Pages``.

    ``source`` is ``bytes``, ``bytearray``, ``memoryview``, an ``mmap``, or a
    readable binary stream. The east-c counterpart of TypeScript's
    ``openBeast2PagesFor``.
    """
    del options  # decoded functions are compiled by east-c's own registries
    _check_segmented(collection_type)

    def opener(source) -> Beast2Pages:
        return Beast2Pages(collection_type, source)

    return opener


__all__ = [
    "Beast2DecodeOptions",
    "Beast2Writer",
    "encode_beast2_for",
    "decode_beast2_for",
    "encode_beast2_with_header_for",
    "decode_beast2_with_header_for",
    "encode_beast2_v5_for",
    "encode_beast2_segments_for",
    "iter_beast2_segments_for",
    "read_beast2_index",
    "Beast2Pages",
    "open_beast2_pages_for",
    "BEAST2_MAGIC_BYTES",
    "BEAST2_V4_MAGIC",
    "BEAST2_V5_MAGIC",
]
