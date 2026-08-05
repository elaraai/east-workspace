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

import mmap
import os
from typing import TYPE_CHECKING, Any, TypedDict

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
    _beast2_read_type,
    _beast2_splice_extents,
    _beast2_splice_tail,
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

    Anything exposing the buffer protocol — bytes, bytearray, memoryview, an
    ``mmap`` — passes through untouched, so east-c borrows it zero-copy and an
    mmap keeps resident memory at one segment. Only genuine streams (a
    ``read`` method and no buffer) are read fully into memory.

    The buffer check must come first: ``mmap`` also has ``read()``, and taking
    the stream branch would both copy the whole file into RAM and advance the
    mmap's file position, so a second call on the same object saw empty bytes.
    """
    if isinstance(source, (bytes, bytearray, memoryview)):
        return source
    try:
        memoryview(source)
    except TypeError:
        pass
    else:
        return source
    if hasattr(source, "read"):
        return source.read()
    return source


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


def read_beast2_type(source):
    """The type schema embedded in a self-describing beast2 blob (v4 or v5).

    A v5 (and v4) container always carries its root type; this reads it back
    without decoding any value, so tooling can inspect exports it knows
    nothing about — and loaders can be regenerated from artifacts alone.

    Args:
        source: A path, or any buffer (``bytes``, ``bytearray``,
            ``memoryview``, an ``mmap``).

    Returns:
        The blob's root type, as the ordinary python type descriptor.
    """
    if isinstance(source, (str, os.PathLike)):
        path = os.fspath(source)
        with open(path, "rb") as f:
            if os.fstat(f.fileno()).st_size == 0:
                raise ValueError(f"{path}: Data too short for Beast2 format: 0 bytes")
            with mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ) as mm:
                try:
                    return _beast2_read_type(mm)
                except ValueError as exc:
                    raise ValueError(f"{path}: {exc}") from None
    return _beast2_read_type(_as_buffer(source))


# ── Managed file interface (issue #481 W1) ────────────────────────────────
#
# Path + East type in, East values out: `Beast2File` owns the fd + mmap and
# east-c does every byte-level operation, so user code never touches buffers,
# iterators, or batch sizes. The read surface mirrors the corresponding eager
# collection's read surface name-for-name; the write mode re-batches whatever
# it is handed into target-sized segments.

#: Managed segment size (rows per segment) when the caller doesn't override.
_TARGET_SEGMENT_ROWS = 8192


class Beast2File:
    """Managed read access to one beast2 v5 collection file.

    Opened by :func:`open_beast2_file`, which returns the root-kind flavor
    (:class:`Beast2ArrayFile`, :class:`Beast2DictFile`, :class:`Beast2SetFile`)
    so the file mirrors its collection's read surface. The file is mmapped —
    bytes enter the OS page cache per accessed frame and are never resident as
    process memory; only decoded segments are.

    Every access decodes at most one segment unless documented otherwise
    (``load()`` decodes them all — into one collection, still one segment of
    input-side memory at a time). Close via ``with`` or :meth:`close`.
    """

    def __init__(self, path, collection_type=None):
        self.path = os.fspath(path)
        """The opened file's path."""
        self._file = open(self.path, "rb")  # noqa: SIM115 — the file object owns the handle
        self._mm: mmap.mmap | None = None
        self._pages: Beast2Pages | None = None
        try:
            size = os.fstat(self._file.fileno()).st_size
            if size < 8:
                raise ValueError(f"Data too short for Beast2 format: {size} bytes")
            self._mm = mmap.mmap(self._file.fileno(), 0, access=mmap.ACCESS_READ)
            head = bytes(self._mm[:8])
            if head == BEAST2_V4_MAGIC:
                raise ValueError(
                    "open_beast2_file needs a v5 blob; this is a v4 container — "
                    "decode_beast2_with_header_for still decodes v4 whole, or "
                    "re-encode with version 5 for paged access"
                )
            if head != BEAST2_V5_MAGIC:
                raise ValueError("open_beast2_file: not a beast2 v5 container")
            self.wire_type = _beast2_read_type(self._mm)
            """The root type the file itself declares in its header."""
            if collection_type is not None and collection_type != self.wire_type:
                from east.serialization.east_printer import print_type

                raise ValueError(
                    "open_beast2_file: declared type does not match the file — "
                    f"declared {print_type(collection_type)}, the file carries "
                    f"{print_type(self.wire_type)}"
                )
            self.collection_type = collection_type if collection_type is not None else self.wire_type
            """The root collection type reads decode with (the wire type when
            none was declared)."""
            _check_segmented(self.collection_type)
            try:
                self._pages = Beast2Pages(self.collection_type, self._mm)
            except RuntimeError as exc:
                # An index-less v5 blob degrades to stream-only access
                # (segments()/load()); anything else is a real error.
                if "no index" not in str(exc):
                    raise
        except BaseException:
            self.close()
            raise

    # ----- lifecycle -------------------------------------------------------

    @property
    def closed(self) -> bool:
        """Whether :meth:`close` has run."""
        return self._mm is None and self._pages is None

    def close(self) -> None:
        """Release the pager, the mapping, and the file. Idempotent.

        Raises:
            BufferError: When something still borrows the mapping — an
                unexhausted :meth:`segments` iterator is the usual cause;
                exhaust or drop it first.
        """
        self._pages = None
        if self._mm is not None:
            try:
                self._mm.close()
            except BufferError:
                raise BufferError(
                    "Beast2File.close(): live readers still borrow the mapping "
                    "(an unexhausted segments() iterator?) — exhaust or drop "
                    "them first"
                ) from None
            self._mm = None
        if not self._file.closed:
            self._file.close()

    def __enter__(self) -> Beast2File:
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    def _check_open(self) -> None:
        if self._mm is None:
            raise ValueError(f"I/O operation on closed Beast2File {self.path!r}")

    def _require_pages(self) -> Beast2Pages:
        self._check_open()
        if self._pages is None:
            raise RuntimeError(
                "beast2 v5: blob carries no index — random access needs one "
                "(write with the index enabled, the default)"
            )
        return self._pages

    # ----- file-only members (every root kind) -----------------------------

    @property
    def indexed(self) -> bool:
        """Whether the blob carries the trailing paging index."""
        return self._pages is not None

    @property
    def segment_count(self) -> int:
        """Number of segments (requires the index)."""
        return self._require_pages().segment_count

    @property
    def self_contained(self) -> bool:
        """Whether segments decode independently (requires the index)."""
        return self._require_pages().self_contained

    def segments(self):
        """Yield one decoded collection per segment, in stream order.

        O(one segment) of decoded memory; process each batch with the native
        eager methods rather than iterating its elements from python.
        """
        self._check_open()
        core = _Beast2ReaderCore(self.collection_type, self._mm)
        try:
            while True:
                segment = core.next()
                if segment is None:
                    return
                yield segment
        finally:
            del core

    def load(self):
        """Decode the whole collection, entirely inside east-c.

        The mmap is borrowed zero-copy, so input-side memory stays at one
        inflated segment regardless of file size; the returned collection is
        the only O(value) allocation.
        """
        self._check_open()
        return decode_beast2_with_header_for(self.collection_type)(self._mm)

    def __len__(self) -> int:
        """Element count from the index, O(1).

        Exact for Array roots. For Set/Dict roots it is the sum of per-segment
        counts — exact when segments are key-disjoint (what our writers
        produce; keyed reads verify the boundaries they land on), an upper
        bound otherwise.
        """
        return self._require_pages().element_count

    def _segment(self, i: int):
        return self._require_pages().segment(i)

    def _segment_starts(self) -> list[int]:
        starts = [0]
        for c in self._require_pages().counts:
            starts.append(starts[-1] + c)
        return starts


class Beast2ArrayFile(Beast2File):
    """A beast2 v5 Array file, mirroring the ``EastArray`` read surface."""

    @property
    def element_type(self):
        """The array's element type."""
        return self.collection_type.value

    def has(self, index: int) -> bool:
        """Whether ``index`` is within bounds (``0 <= index < len``)."""
        return 0 <= int(index) < len(self)

    def get(self, index: int) -> Any:
        """Element at ``index``; a bad index raises East's bounds error.

        Same contract as ``EastArray.get``: ``0 <= index < len`` or
        ``Array index N out of bounds``. Decodes only the owning segment.
        """
        if not self.has(index):
            from east.runtime.errors import EastError

            raise EastError(f"Array index {int(index)} out of bounds", [])
        return self._require_pages().element(int(index))

    def get_or_default(self, index: int, default: Any) -> Any:
        """Element at ``index``, or ``default`` when out of bounds."""
        return self._require_pages().element(int(index)) if self.has(index) else default

    def try_get(self, index: int):
        """``some(element)`` when ``index`` is in bounds, else ``none``."""
        from east.types.values.primitives import east_null
        from east.types.values.structural import EastVariant

        if self.has(index):
            return EastVariant("some", self._require_pages().element(int(index)))
        return EastVariant("none", east_null)

    def __getitem__(self, index):
        """Pythonic protocol read: negative indexing, ``IndexError`` out of
        bounds, contiguous slices — mirroring the eager array protocol."""
        if isinstance(index, slice):
            start, stop, step = index.indices(len(self))
            if step != 1:
                raise ValueError("Beast2ArrayFile slices are contiguous (step 1)")
            return self.slice(start, stop)
        n = len(self)
        i = int(index)
        if i < 0:
            i += n
        if not 0 <= i < n:
            raise IndexError("array index out of range")
        return self._require_pages().element(i)

    def slice(self, start: int, end: int):
        """New in-memory array of the half-open row range ``[start, end)``.

        Bounds clamp exactly like ``EastArray.slice``; only the covered
        segments are decoded, one at a time.
        """
        from east.types.values.collections import EastArray

        n = len(self)
        s = min(max(int(start), 0), n)
        e = min(max(int(end), 0), n)
        out: Any = EastArray(self.element_type, [])
        if e <= s:
            return out
        starts = self._segment_starts()
        for seg_idx in range(len(starts) - 1):
            base, nxt = starts[seg_idx], starts[seg_idx + 1]
            if nxt <= s:
                continue
            if base >= e:
                break
            segment = self._segment(seg_idx)
            out.extend(segment.slice(max(s - base, 0), min(e - base, nxt - base)))
        return out

    def get_keys(self, indices):
        """Gather elements at the given indices, in order, batched.

        Same contract as ``EastArray.get_keys``; the file groups the indices
        by owning segment and decodes each owning segment exactly once.
        """
        from east.types.values.collections import EastArray

        wanted = [int(i) for i in indices]
        n = len(self)
        for i in wanted:
            if not 0 <= i < n:
                from east.runtime.errors import EastError

                raise EastError(f"Array index {i} out of bounds", [])
        starts = self._segment_starts()
        import bisect

        owners = [bisect.bisect_right(starts, i) - 1 for i in wanted]
        cache: dict[int, Any] = {}
        for seg_idx in owners:
            if seg_idx not in cache:
                cache[seg_idx] = self._segment(seg_idx)
        return EastArray(
            self.element_type,
            [cache[o][i - starts[o]] for o, i in zip(owners, wanted, strict=True)],
        )

    def find_sorted_first(self, target: Any, key: Any = None) -> int:
        """Leftmost insertion index for ``target``, global across segments
        (``EastArray.find_sorted_first`` over the whole file).

        east-c binary-searches the segment *fences* — each segment's first
        element, decoded from a bounded probe of its frame — to pick the
        boundary segment, decodes only that one, and adds its base. Assumes
        the file's rows are sorted, exactly like the eager builtin.
        """
        if key is not None:
            raise ValueError(
                "find_sorted key= projections are not supported on Beast2File — "
                "the file pages by element order; load() the array (or scan "
                "segments()) for projected searches"
            )
        return self._require_pages()._core.find_sorted(target, False)

    def find_sorted_last(self, target: Any, key: Any = None) -> int:
        """Rightmost insertion index for ``target``, global across segments
        (``EastArray.find_sorted_last`` over the whole file); same fence
        search and one-segment decode as :meth:`find_sorted_first`.
        """
        if key is not None:
            raise ValueError(
                "find_sorted key= projections are not supported on Beast2File — "
                "the file pages by element order; load() the array (or scan "
                "segments()) for projected searches"
            )
        return self._require_pages()._core.find_sorted(target, True)

    def find_sorted_range(self, target: Any, key: Any = None):
        """Half-open ``{start, end}`` span of rows equal to ``target``
        (``EastArray.find_sorted_range`` over the whole file) — both ends via
        the fence search; the boundary segment usually decodes once and the
        second probe hits the pager's segment cache.
        """
        if key is not None:
            raise ValueError(
                "find_sorted key= projections are not supported on Beast2File — "
                "the file pages by element order; load() the array (or scan "
                "segments()) for projected searches"
            )
        from east.types.construct import struct
        from east.types.types import IntegerType, StructType

        pages = self._require_pages()
        return struct(
            {"start": pages._core.find_sorted(target, False),
             "end": pages._core.find_sorted(target, True)},
            StructType([("start", IntegerType), ("end", IntegerType)]),
        )


class Beast2DictFile(Beast2File):
    """A beast2 v5 Dict file, mirroring the ``EastDict`` read surface.

    Keyed point reads decode only the owning segment: east-c binary-searches
    the segment *fences* (each segment's first key, decoded from a bounded
    probe of its frame and cached) to pick the segment, decodes it through a
    small shared LRU, and answers from the in-segment b-tree. Requires the
    key-disjoint segments our writers produce — a violated landing boundary
    raises ``segments are not key-disjoint``.
    """

    @property
    def key_type(self):
        """The dict's key type."""
        return self.collection_type.value["key"]

    @property
    def value_type(self):
        """The dict's value type."""
        return self.collection_type.value["value"]

    def size(self) -> int:
        """Entry count from the index (see ``__len__`` for exactness)."""
        return len(self)

    def keys_set(self):
        """The set of keys, built by streaming segments and unioning natively."""
        from east.types.values.collections import EastSet

        out: Any = EastSet(self.key_type)
        for segment in self.segments():
            out.union_in_place(segment.keys_set())
        return out

    def items(self):
        """Yield ``(key, value)`` pairs in stream order, one segment resident
        at a time. A python-boundary convenience: every pair crosses into
        python — fine for small results, never the scan idiom for large files
        (stream :meth:`segments` and process each batch natively instead)."""
        for segment in self.segments():
            yield from segment.items()

    def keys(self):
        """Yield keys (same boundary caveat as :meth:`items`)."""
        for k, _v in self.items():
            yield k

    def values(self):
        """Yield values (same boundary caveat as :meth:`items`)."""
        for _k, v in self.items():
            yield v

    def __iter__(self):
        return self.keys()

    def get(self, key: Any, default: Any = None) -> Any:
        """Value for ``key``, or ``default`` if absent — the python
        ``dict.get`` boundary convenience, as on ``EastDict``. One fence
        search, at most one segment decode."""
        found, value = self._require_pages()._core.get_key(key)
        return value if found else default

    def get_or_default(self, key: Any, default: Any) -> Any:
        """Value for ``key``, or ``default`` if absent
        (``EastDict.get_or_default``)."""
        found, value = self._require_pages()._core.get_key(key)
        return value if found else default

    def try_get(self, key: Any):
        """``some(value)`` if ``key`` is present, else ``none``
        (``EastDict.try_get``)."""
        from east.types.values.primitives import east_null
        from east.types.values.structural import EastVariant

        found, value = self._require_pages()._core.get_key(key)
        return EastVariant("some", value) if found else EastVariant("none", east_null)

    def has(self, key: Any) -> bool:
        """Whether ``key`` is present (``EastDict.has``)."""
        found, _ = self._require_pages()._core.get_key(key)
        return found

    def get_keys(self, keys, fill):
        """Restrict to ``keys``, filling the absent ones — the
        ``EastDict.get_keys`` contract: a dict keyed exactly by ``keys``,
        existing values where present, ``fill(key)`` otherwise.

        east-c merges the sorted keys against the fences in one forward
        pass, so each owning segment decodes exactly once no matter how many
        keys land in it; ``fill`` runs only per missing key.
        """
        from east.types.values.collections import EastSet

        if not isinstance(keys, EastSet):
            keys = EastSet(self.key_type, keys)
        found, missing = self._require_pages()._core.get_keys(keys)
        for k in missing:
            found[k] = fill(k)
        return found

    def __getitem__(self, key):
        """Mapping read: the stored value, or ``KeyError`` — the same message
        the eager dict proxy raises."""
        found, value = self._require_pages()._core.get_key(key)
        if not found:
            from east.serialization.east_printer import print_east

            raise KeyError(f"Dict does not contain key {print_east(key, self.key_type)}")
        return value

    def __contains__(self, key):
        found, _ = self._require_pages()._core.get_key(key)
        return found


class Beast2SetFile(Beast2File):
    """A beast2 v5 Set file, mirroring the ``EastSet`` read surface.

    Membership decodes only the owning segment, found by a binary search
    over the segment fences — the same machinery as
    :class:`Beast2DictFile`'s keyed reads.
    """

    @property
    def element_type(self):
        """The set's element type."""
        return self.collection_type.value

    def __iter__(self):
        """Yield elements in stream order, one segment resident at a time
        (python-boundary convenience — stream :meth:`segments` for scans)."""
        for segment in self.segments():
            yield from segment

    def has(self, value: Any) -> bool:
        """Whether ``value`` is a member (``EastSet.has``) — one fence
        search, at most one segment decode."""
        found, _ = self._require_pages()._core.get_key(value)
        return found

    def __contains__(self, value):
        found, _ = self._require_pages()._core.get_key(value)
        return found


_FILE_KINDS = {"Array": Beast2ArrayFile, "Set": Beast2SetFile, "Dict": Beast2DictFile}


class Beast2FileWriter:
    """Managed write access: hand it rows, batches, or whole collections in
    any mix; it re-batches into target-sized segments and writes the index.

    Opened by ``open_beast2_file(path, T, mode="w")`` (or use
    :func:`write_beast2_file` for a value you already hold whole). Append-only
    streaming underneath (:class:`Beast2Writer`), so writer memory is one
    batch regardless of total size. Close via ``with`` or :meth:`close` — the
    index and footer are written on close.
    """

    def __init__(self, path, collection_type, *, codec: str = "deflate",
                 segment_rows: int | None = None):
        _check_segmented(collection_type)
        self.collection_type = collection_type
        """The declared root collection type (Array/Set/Dict)."""
        self.path = os.fspath(path)
        """The file being written."""
        self._target = _TARGET_SEGMENT_ROWS if segment_rows is None else int(segment_rows)
        if self._target <= 0:
            raise ValueError(f"segment_rows must be positive, got {segment_rows}")
        self._file = open(self.path, "wb")  # noqa: SIM115 — the writer owns the handle
        try:
            self._writer = Beast2Writer(collection_type, self._file, codec=codec)
        except BaseException:
            self._file.close()
            raise
        self._closed = False

    @property
    def segments(self) -> int:
        """Segments written so far."""
        return self._writer.segments

    def write(self, batch) -> None:
        """Append ``batch`` — an East collection of the declared type, or the
        matching python builtin (list/tuple, dict, set) — re-batched into
        segments of at most ~2x the managed target size."""
        if self._closed:
            raise ValueError("write() after close()")
        batch = self._coerce(batch)
        n = len(batch)
        if n == 0:
            return
        if n <= 2 * self._target:
            self._writer.write(batch)
            return
        for chunk in self._chunks(batch, n):
            self._writer.write(chunk)

    def close(self) -> None:
        """Write the terminator, index and footer, then close the file.
        Idempotent."""
        if not self._closed:
            self._closed = True
            try:
                self._writer.close()
            finally:
                self._file.close()

    def __enter__(self) -> Beast2FileWriter:
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    def _coerce(self, batch):
        from east.types.values.collections import EastArray, EastDict, EastSet

        kind = self.collection_type.type
        if kind == "Array" and isinstance(batch, (list, tuple)):
            return EastArray(self.collection_type.value, list(batch))
        if kind == "Dict" and isinstance(batch, dict):
            return EastDict(
                self.collection_type.value["key"], self.collection_type.value["value"], batch
            )
        if kind == "Set" and isinstance(batch, (set, frozenset)):
            return EastSet(self.collection_type.value, batch)
        return batch

    def _chunks(self, batch, n: int):
        """Split an oversized batch into target-sized segments, natively.

        Arrays slice; Sets go through one ordered array; Dicts go through one
        ordered pair array rebuilt per chunk with the bulk ``update_many``
        path. Chunk boundaries follow the collection's sorted order, so the
        segments stay key-disjoint — the shape W2's keyed reads require.
        """
        kind = self.collection_type.type
        if kind == "Array":
            for i in range(0, n, self._target):
                yield batch.slice(i, min(i + self._target, n))
            return
        if kind == "Set":
            ordered = batch.to_array()
            for i in range(0, n, self._target):
                yield ordered.slice(i, min(i + self._target, n)).to_set()
            return
        from east.types.types import StructType
        from east.types.values.collections import EastDict

        kt = self.collection_type.value["key"]
        vt = self.collection_type.value["value"]
        pair_t = StructType([("k", kt), ("v", vt)])
        pairs = batch.to_array(lambda k, v: {"k": k, "v": v}, out=pair_t)
        for i in range(0, n, self._target):
            chunk = pairs.slice(i, min(i + self._target, n))
            keys = chunk.map(lambda p: p["k"], out=kt)
            values = chunk.map(lambda p: p["v"], out=vt)
            rebuilt: Any = EastDict(kt, vt)
            rebuilt.update_many(keys, values)
            yield rebuilt


def open_beast2_file(path, collection_type=None, mode: str = "r", *,
                     codec: str = "deflate", segment_rows: int | None = None):
    """Open a beast2 v5 collection file, managed end to end.

    Read mode returns the root-kind flavor of :class:`Beast2File`
    (:class:`Beast2ArrayFile` / :class:`Beast2DictFile` /
    :class:`Beast2SetFile`) over an owned mmap; write mode returns a
    :class:`Beast2FileWriter` that re-batches into target-sized segments.

    Args:
        path: The file to open.
        collection_type: The root Array/Set/Dict type. Optional when reading —
            a v5 file is self-describing, so the header supplies it; when
            given it is validated against the header and a mismatch fails at
            open instead of decoding garbage. Required for write mode.
        mode: ``"r"`` (default) or ``"w"``.
        codec: Write mode only — segment codec, ``"deflate"`` (default) or
            ``"none"``.
        segment_rows: Write mode only — rows per segment; managed when
            omitted.

    Returns:
        A :class:`Beast2File` flavor (read) or :class:`Beast2FileWriter`
        (write); both are context managers.
    """
    if mode == "r":
        if codec != "deflate" or segment_rows is not None:
            raise ValueError("codec/segment_rows are write-mode options")
        resolved = collection_type if collection_type is not None else read_beast2_type(path)
        kind = _check_segmented(resolved)
        return _FILE_KINDS[kind](path, collection_type if collection_type is not None else resolved)
    if mode == "w":
        if collection_type is None:
            raise ValueError(
                "open_beast2_file: write mode requires collection_type — only "
                "an existing file can supply its own type"
            )
        return Beast2FileWriter(path, collection_type, codec=codec,
                                segment_rows=segment_rows)
    raise ValueError(f"open_beast2_file mode must be 'r' or 'w', not {mode!r}")


def write_beast2_file(path, collection_type, value, *, codec: str = "deflate",
                      segment_rows: int | None = None) -> None:
    """Write ``value`` (a collection of the declared type, of any size) to
    ``path`` as one indexed v5 file — re-batched into target-sized segments,
    so the result pages well. One call, no knobs needed.

    Args:
        path: The file to create (overwritten if present).
        collection_type: The root Array/Set/Dict type.
        value: The collection to write.
        codec: Segment codec, ``"deflate"`` (default) or ``"none"``.
        segment_rows: Rows per segment; managed when omitted.
    """
    with Beast2FileWriter(path, collection_type, codec=codec,
                          segment_rows=segment_rows) as writer:
        writer.write(value)


# ── Splice: merge v5 files without re-encoding (issue #484) ───────────────
#
# A self-contained segment's bytes are position-independent by design (REF
# deltas are relative and never cross a segment boundary), so merging N files
# is: keep one header, byte-copy every source's segment-frame range, write one
# terminator and one merged index. No value ever decodes or re-encodes.
#
# east-c owns every byte of container grammar — `_beast2_splice_extents`
# parses each source's geometry and `_beast2_splice_tail` builds the merged
# terminator + index + footer, both composed from the same internals the C
# readers and writers use. Python owns only the file descriptors: open,
# sendfile, rename, and errors that name the offending path.


def _copy_range(dest_file, src_file, start: int, count: int) -> None:
    """Append ``count`` bytes from ``src_file`` at ``start`` to ``dest_file``.

    ``os.sendfile`` keeps the copy in the kernel where the platform has it
    (Linux/BSD/macOS); elsewhere — or on fd pairs that refuse it — a chunked
    seek-and-read loop does the same work portably. ``dest_file`` must be
    unbuffered so python-side writes and fd-level copies stay in sync.
    """
    remaining = count
    offset = start
    if hasattr(os, "sendfile"):
        try:
            while remaining:
                sent = os.sendfile(dest_file.fileno(), src_file.fileno(), offset, remaining)
                if sent == 0:
                    raise ValueError("unexpected end of source during splice")
                offset += sent
                remaining -= sent
            return
        except OSError:
            pass  # sendfile unsupported for this fd pair — fall back
    src_file.seek(offset)
    while remaining:
        chunk = src_file.read(min(remaining, 1 << 20))
        if not chunk:
            raise ValueError("unexpected end of source during splice")
        dest_file.write(chunk)
        remaining -= len(chunk)


def splice_beast2_files(path, collection_type, sources, *, verify: bool = False) -> tuple[int, int]:
    """Merge indexed v5 collection files into one, by byte copy.

    Keeps the first source's header, copies every source's segment frames
    through untouched (``os.sendfile`` — no decode, no re-encode), and writes
    one merged trailing index. The output is structurally indistinguishable
    from a single writer's file; row order is source order, and Set/Dict
    sources merge on decode with the ordinary segment semantics.

    ``sources`` is a sequence or any iterable of paths, **consumed lazily** —
    pass a generator that yields each shard as it completes and the
    destination grows incrementally. The destination is written to a
    temporary sibling and renamed on success, so it is complete or absent.

    Every source must be v5, indexed, self-contained, carry no source map,
    and declare a byte-identical type section; violations fail naming the
    offending path.

    Args:
        path: The destination file (overwritten if present).
        collection_type: The root Array/Set/Dict type of every source.
        sources: Paths of the files to merge, in order.
        verify: When True, run east-c's sequential segment reader over the
            finished destination — the whole-stream validator (frames,
            terminator, index consistency) at O(one segment) memory.

    Returns:
        ``(segment_count, element_count)`` of the merged file (elements are
        exact for Array roots; the per-segment sum for Set/Dict roots).
    """
    _check_segmented(collection_type)
    dest = os.fspath(path)
    tmp = dest + ".splice-tmp"
    ref_prefix: bytes | None = None
    ref_path: str | None = None
    offsets: list[int] = []
    counts: list[int] = []
    dest_file = None
    written = 0
    try:
        for source in sources:
            src_path = os.fspath(source)
            with open(src_path, "rb") as src_file:
                if os.fstat(src_file.fileno()).st_size == 0:
                    raise ValueError(f"{src_path}: Data too short for Beast2 format: 0 bytes")
                with mmap.mmap(src_file.fileno(), 0, access=mmap.ACCESS_READ) as mm:
                    try:
                        extents = _beast2_splice_extents(mm)
                    except ValueError as exc:
                        raise ValueError(f"{src_path}: {exc}") from None
                    if not extents["self_contained"]:
                        raise ValueError(
                            f"{src_path}: blob has cross-segment aliasing — splice "
                            "requires self-contained segments (the writer default)"
                        )
                    if not extents["source_map_empty"]:
                        raise ValueError(
                            f"{src_path}: blob carries a source map — splice supports "
                            "data collections only"
                        )
                    prefix_end = extents["prefix_end"]
                    prefix = bytes(mm[8:prefix_end])
                    if ref_prefix is None:
                        ref_prefix, ref_path = prefix, src_path
                        dest_file = open(tmp, "wb", buffering=0)  # noqa: SIM115 — outlives the loop; closed in finally
                        dest_file.write(bytes(mm[:prefix_end]))
                        written = prefix_end
                    elif prefix != ref_prefix:
                        raise ValueError(
                            f"{src_path}: type section differs from {ref_path} — "
                            "splice sources must share one declared type"
                        )
                shift = written - prefix_end
                span = extents["segments_end"] - prefix_end
                if span:
                    _copy_range(dest_file, src_file, prefix_end, span)
                    written += span
                offsets.extend(o + shift for o in extents["offsets"])
                counts.extend(extents["counts"])
        if dest_file is None:
            raise ValueError("splice_beast2_files: at least one source is required")

        dest_file.write(_beast2_splice_tail(offsets, counts, written))
        dest_file.close()
        dest_file = None
        os.replace(tmp, dest)
    except BaseException:
        if dest_file is not None:
            dest_file.close()
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise

    if verify:
        with open(dest, "rb") as f, mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ) as mm:
            total = 0
            for segment in iter_beast2_segments_for(collection_type)(mm):
                total += len(segment)
            if total != sum(counts):
                raise ValueError(
                    f"splice verification failed: decoded {total} elements, "
                    f"index says {sum(counts)}"
                )
    return len(offsets), sum(counts)


# ── Fork-parallel writes (issue #484) ─────────────────────────────────────
#
# Shards are for CPUs and live for minutes; segments are for memory and live
# forever: N workers each write a private temp shard and the parent splices
# them, in partition order, into ONE file that is byte-identical to a single
# writer writing the same batches. Where the platform has fork (Linux, macOS)
# the workers are forked processes, so whatever expensive context `produce`
# closes over is inherited copy-on-write and east-c's single-threadedness is
# never in play — each child owns a whole address space. Where it doesn't
# (Windows), the same contract runs inline, sequentially: identical output,
# no parallelism to lose.


def _produce_batches(produce, partition):
    """Normalize ``produce``'s result: one East collection is one batch."""
    from east.types.values.collections import EastArray, EastDict, EastSet

    result = produce(partition)
    if isinstance(result, (EastArray, EastDict, EastSet, list, tuple, dict, set, frozenset)):
        return [result]
    return result


def _write_one_shard(shard_path, collection_type, produce, partition, codec, segment_rows):
    with Beast2FileWriter(shard_path, collection_type, codec=codec,
                          segment_rows=segment_rows) as writer:
        for batch in _produce_batches(produce, partition):
            writer.write(batch)


def _forked_shards(dest, collection_type, partitions, produce, processes, codec,
                   segment_rows):
    """Yield each partition's finished shard path, in partition order.

    Runs up to ``processes`` forked children at once; a child writes its shard
    then ``os._exit(0)``, or writes its traceback to a ``.err`` sidecar and
    exits 1. The generator launches queued partitions as slots free and blocks
    only when the next-in-order shard is not yet done, so splicing overlaps
    the remaining children's work. Any child failure raises after terminating
    the rest; the caller cleans up files.
    """
    import contextlib
    import signal

    running: dict[int, int] = {}  # pid -> partition index
    done: set[int] = set()
    next_index = 0
    launched = 0

    def shard_path(i: int) -> str:
        return f"{dest}.shard{i}.tmp"

    def launch(i: int) -> None:
        nonlocal launched
        pid = os.fork()
        if pid == 0:
            # Child: never return into the parent's control flow, never run
            # its buffered-IO flushes or cleanup — os._exit only.
            code = 1
            try:
                _write_one_shard(shard_path(i), collection_type, produce,
                                 partitions[i], codec, segment_rows)
                code = 0
            except BaseException:
                import traceback

                try:
                    with open(shard_path(i) + ".err", "w") as err:
                        traceback.print_exc(file=err)
                except OSError:
                    pass
            finally:
                os._exit(code)
        running[pid] = i
        launched += 1

    def reap_one() -> None:
        pid, status = os.waitpid(-1, 0)
        i = running.pop(pid)
        failed = not (os.WIFEXITED(status) and os.WEXITSTATUS(status) == 0)
        if failed:
            for other in running:
                with contextlib.suppress(ProcessLookupError):
                    os.kill(other, signal.SIGTERM)
            while running:
                gone, _ = os.waitpid(-1, 0)
                running.pop(gone, None)
            detail = f"partition {i} "
            if os.WIFSIGNALED(status):
                detail += f"died with signal {os.WTERMSIG(status)}"
            else:
                detail += f"exited with status {os.WEXITSTATUS(status)}"
            err_path = shard_path(i) + ".err"
            if os.path.exists(err_path):
                with open(err_path) as err:
                    detail += ":\n" + err.read()
            raise RuntimeError(f"write_beast2_file_parallel: {detail}")
        done.add(i)

    try:
        while next_index < len(partitions):
            while launched < len(partitions) and len(running) < processes:
                launch(launched)
            if next_index in done:
                yield shard_path(next_index)
                next_index += 1
                continue
            reap_one()
    finally:
        # A failure (or an abandoned generator) must not leak children.
        for pid in list(running):
            with contextlib.suppress(ProcessLookupError):
                os.kill(pid, signal.SIGTERM)
        while running:
            try:
                gone, _ = os.waitpid(-1, 0)
            except ChildProcessError:
                break
            running.pop(gone, None)


def write_beast2_file_parallel(path, collection_type, partitions, produce, *,
                               processes: int | None = None, strategy: str = "auto",
                               codec: str = "deflate", segment_rows: int | None = None,
                               keep_shards: bool = False, verify: bool = False) -> tuple[int, int]:
    """Write one indexed v5 file from partitioned work, in parallel where the
    platform allows.

    ``produce(partition)`` runs once per partition and returns the batches for
    that partition's rows — an iterable of East collections (or python
    builtins), or a single collection meaning one batch. Each partition writes
    a private temp shard through a managed writer, and the shards splice —
    **in partition order**, incrementally, as they finish — into ``path``. The
    result is byte-identical to one writer writing the same batches, so
    readers never learn how many processes wrote it.

    On POSIX (Linux, macOS) the partitions run in **forked** children, so any
    expensive context ``produce`` closes over is built once, pre-fork, and
    inherited copy-on-write — and east-c needs no thread safety, because each
    child owns a whole process. Call before starting any threads. On Windows
    the same contract runs inline, sequentially.

    Args:
        path: The destination file (overwritten if present).
        collection_type: The root Array/Set/Dict type.
        partitions: The work descriptors, one per shard; any sequence.
        produce: ``produce(partition) -> batches``; runs in the worker.
        processes: Maximum concurrent children (default: CPU count, capped at
            the partition count). Ignored by the inline strategy.
        strategy: ``"auto"`` (default — fork where available, else inline),
            ``"fork"`` (error where unavailable), or ``"inline"``.
        codec: Segment codec, ``"deflate"`` (default) or ``"none"``.
        segment_rows: Rows per segment; managed when omitted.
        keep_shards: Leave the per-partition shard files behind (debugging).
        verify: Re-walk the spliced result with east-c's sequential reader.

    Returns:
        ``(segment_count, element_count)`` of the finished file.
    """
    parts = list(partitions)
    if not parts:
        raise ValueError("write_beast2_file_parallel: at least one partition is required")
    if strategy not in ("auto", "fork", "inline"):
        raise ValueError(f"strategy must be 'auto', 'fork' or 'inline', not {strategy!r}")
    has_fork = hasattr(os, "fork")
    if strategy == "fork" and not has_fork:
        raise ValueError(
            "strategy='fork' needs os.fork (Linux/macOS); this platform runs "
            "strategy='inline'"
        )
    use_fork = has_fork if strategy == "auto" else strategy == "fork"
    dest = os.fspath(path)

    shard_paths = [f"{dest}.shard{i}.tmp" for i in range(len(parts))]
    try:
        if use_fork:
            workers = min(len(parts), processes or os.cpu_count() or 4)
            sources = _forked_shards(dest, collection_type, parts, produce, workers,
                                     codec, segment_rows)
        else:

            def _inline():
                for i, partition in enumerate(parts):
                    _write_one_shard(shard_paths[i], collection_type, produce,
                                     partition, codec, segment_rows)
                    yield shard_paths[i]

            sources = _inline()
        result = splice_beast2_files(dest, collection_type, sources, verify=verify)
    except BaseException:
        for shard in shard_paths:
            for leftover in (shard, shard + ".err"):
                if os.path.exists(leftover):
                    os.unlink(leftover)
        raise
    if not keep_shards:
        for shard in shard_paths:
            if os.path.exists(shard):
                os.unlink(shard)
    return result


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
    "read_beast2_type",
    "Beast2Pages",
    "open_beast2_pages_for",
    "Beast2File",
    "Beast2ArrayFile",
    "Beast2DictFile",
    "Beast2SetFile",
    "Beast2FileWriter",
    "open_beast2_file",
    "write_beast2_file",
    "write_beast2_file_parallel",
    "splice_beast2_files",
    "BEAST2_MAGIC_BYTES",
    "BEAST2_V4_MAGIC",
    "BEAST2_V5_MAGIC",
]
