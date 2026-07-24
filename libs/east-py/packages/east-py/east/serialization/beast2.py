#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Beast v2 binary format for East types.

All encode/decode is handled by east-c via the _beast2_eastc Cython extension.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, TypedDict

if TYPE_CHECKING:
    from east.runtime.platform import PlatformFunction

# Beast v2 magic bytes: 0x89 "East" CRLF 0x01
BEAST2_MAGIC_BYTES = bytes([137, 69, 97, 115, 116, 13, 10, 1])


class Beast2DecodeOptions(TypedDict, total=False):
    """Options for decoding, allowing function compilation.

    Attributes:
        platform: List of platform functions available for function compilation
    """

    platform: list[PlatformFunction]


from east.serialization._beast2_eastc import (  # type: ignore[import-not-found]  # noqa: E402
    decode_beast2_for,
    decode_beast2_with_header_for,
    encode_beast2_for,
    encode_beast2_with_header_for,
)

# ─── Chunked container (issue #414) ─────────────────────────────────────────
#
# The v4 full container is globally sectioned (type/string/value tables span
# the whole blob), so it cannot be appended to — encoding a large collection
# requires the whole value AND its whole image in memory. The chunked
# container bounds both sides at one chunk:
#
#     chunk_magic[8]                        0x89 "East" 0x0D 0x0A 0x43
#     repeat: varint(byte_len > 0), blob    one COMPLETE beast2 v4 container
#                                           holding a value of the SAME
#                                           declared collection type
#     varint(0)                             terminator (required)
#
# The declared type must be Array<T>, Set<T>, or Dict<K, V>. Decoding merges
# chunks in order: Array chunks concatenate, Set chunks union, Dict chunks
# insert with later chunks overwriting duplicate keys (update semantics).
# Zero chunks decode to the empty collection. Bytes after the terminator are
# an error (strict whole-stream, like every East parser).

#: Chunked-container magic: the full container's magic with 0x04 -> 0x43 'C'.
BEAST2_CHUNKED_MAGIC = bytes([0x89, 0x45, 0x61, 0x73, 0x74, 0x0D, 0x0A, 0x43])

_CHUNKABLE = ("Array", "Set", "Dict")


def _check_chunkable(collection_type) -> str:
    kind = getattr(collection_type, "type", None)
    if kind not in _CHUNKABLE:
        raise TypeError(
            f"beast2 chunked containers hold Array, Set or Dict values, not {kind!r}"
        )
    return kind


def _encode_uvarint(n: int) -> bytes:
    out = bytearray()
    while True:
        low = n & 0x7F
        n >>= 7
        if n:
            out.append(low | 0x80)
        else:
            out.append(low)
            return bytes(out)


def _read_uvarint(view, pos: int) -> tuple[int, int]:
    result = 0
    shift = 0
    while True:
        if pos >= len(view):
            raise ValueError("beast2 chunked: truncated varint")
        byte = view[pos]
        pos += 1
        result |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return result, pos
        shift += 7
        if shift > 63:
            raise ValueError("beast2 chunked: varint overflow")


class Beast2ChunkWriter:
    """Stream a large collection to ``stream`` one chunk at a time.

    Each :meth:`write` encodes one batch — a complete value of the declared
    collection type — as a self-contained beast2 container, so peak memory is
    one batch plus its image, never the whole collection. Usable as a context
    manager; :meth:`close` writes the terminator (idempotent).
    """

    def __init__(self, collection_type, stream):
        _check_chunkable(collection_type)
        self._encode = encode_beast2_with_header_for(collection_type)
        self._stream = stream
        self._closed = False
        self.chunks = 0
        stream.write(BEAST2_CHUNKED_MAGIC)

    def write(self, batch) -> None:
        """Encode ``batch`` (a value of the declared type) as one chunk.

        Empty batches are skipped — a chunk is never zero-length, so the
        terminator stays unambiguous.
        """
        if self._closed:
            raise ValueError("write() after close()")
        if not len(batch):
            return
        blob = self._encode(batch)
        self._stream.write(_encode_uvarint(len(blob)))
        self._stream.write(blob)
        self.chunks += 1

    def close(self) -> None:
        if not self._closed:
            self._closed = True
            self._stream.write(_encode_uvarint(0))

    def __enter__(self) -> Beast2ChunkWriter:
        return self

    def __exit__(self, *exc) -> None:
        self.close()


def encode_beast2_chunked_for(collection_type):
    """Curried chunked encoder: ``encode(batches) -> bytes``.

    ``batches`` is an iterable of values of the declared collection type;
    each becomes one chunk. The in-memory convenience form of
    :class:`Beast2ChunkWriter` — use the writer to stream to a file.
    """
    _check_chunkable(collection_type)

    def encode(batches) -> bytes:
        import io

        buf = io.BytesIO()
        with Beast2ChunkWriter(collection_type, buf) as writer:
            for batch in batches:
                writer.write(batch)
        return buf.getvalue()

    return encode


def iter_beast2_chunks_for(collection_type, options: Beast2DecodeOptions | None = None):
    """Curried streaming decoder: ``chunks(source)`` yields one decoded
    collection per chunk, in stream order — the caller merges (or processes
    each batch and drops it, keeping decode memory at one chunk).

    ``source`` is ``bytes`` or a readable binary stream.
    """
    _check_chunkable(collection_type)
    decode = decode_beast2_with_header_for(collection_type, options)

    def chunks(source):
        if isinstance(source, (bytes, bytearray, memoryview)):
            view = memoryview(source)
            if bytes(view[:8]) != BEAST2_CHUNKED_MAGIC:
                raise ValueError("beast2 chunked: bad magic")
            pos = 8
            while True:
                length, pos = _read_uvarint(view, pos)
                if length == 0:
                    if pos != len(view):
                        raise ValueError(
                            f"beast2 chunked: {len(view) - pos} bytes after the terminator"
                        )
                    return
                if pos + length > len(view):
                    raise ValueError("beast2 chunked: truncated chunk")
                yield decode(bytes(view[pos:pos + length]))
                pos += length
        else:
            if source.read(8) != BEAST2_CHUNKED_MAGIC:
                raise ValueError("beast2 chunked: bad magic")
            while True:
                length = _stream_uvarint(source)
                if length == 0:
                    if source.read(1):
                        raise ValueError("beast2 chunked: bytes after the terminator")
                    return
                blob = source.read(length)
                if len(blob) != length:
                    raise ValueError("beast2 chunked: truncated chunk")
                yield decode(blob)

    return chunks


def _stream_uvarint(stream) -> int:
    result = 0
    shift = 0
    while True:
        byte = stream.read(1)
        if not byte:
            raise ValueError("beast2 chunked: truncated varint")
        result |= (byte[0] & 0x7F) << shift
        if not byte[0] & 0x80:
            return result
        shift += 7
        if shift > 63:
            raise ValueError("beast2 chunked: varint overflow")


def decode_beast2_chunked_for(collection_type, options: Beast2DecodeOptions | None = None):
    """Curried chunked decoder: ``decode(source) -> collection``, merging
    every chunk. Array chunks concatenate; Set chunks union; Dict chunks
    insert with later chunks overwriting duplicate keys."""
    kind = _check_chunkable(collection_type)
    chunks = iter_beast2_chunks_for(collection_type, options)

    def decode(source):
        from east.types.values import EastArray, EastDict, EastSet

        acc: object
        if kind == "Array":
            acc = EastArray(collection_type.value)
        elif kind == "Set":
            acc = EastSet(collection_type.value)
        else:
            acc = EastDict(collection_type.value["key"], collection_type.value["value"])
        for chunk in chunks(source):
            if kind == "Array":
                acc.extend(chunk)
            elif kind == "Set":
                for element in chunk:
                    acc.add(element)
            else:
                for key, value in chunk.items():
                    acc[key] = value
        return acc

    return decode


__all__ = [
    "Beast2DecodeOptions",
    "encode_beast2_for",
    "decode_beast2_for",
    "encode_beast2_with_header_for",
    "decode_beast2_with_header_for",
    "encode_beast2_chunked_for",
    "decode_beast2_chunked_for",
    "iter_beast2_chunks_for",
    "Beast2ChunkWriter",
    "BEAST2_MAGIC_BYTES",
    "BEAST2_CHUNKED_MAGIC",
]
