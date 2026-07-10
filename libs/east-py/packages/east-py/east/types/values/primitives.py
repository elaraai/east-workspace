#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Scalar-ish value types with real methods: EastNull (unit) and EastBlob (bytes subclass)."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import east.types.values as _ev
from east.types.values._helpers import _call_builtin

if TYPE_CHECKING:
    from east.types.types import EastType


class EastNull:
    """East's canonical unit type.

    Represents the absence of a value, analogous to None but with
    distinct type identity for East's type system.
    """

    _instance: EastNull | None = None

    def __new__(cls) -> EastNull:
        """Ensure EastNull is a singleton."""
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __repr__(self) -> str:
        """Return East text format representation."""
        return "null"

    def __str__(self) -> str:
        """Return East text format representation."""
        return "null"

    def __eq__(self, other: object) -> bool:
        """EastNull equals only itself."""
        return isinstance(other, EastNull)

    def __hash__(self) -> int:
        """Hash for use in sets/dicts."""
        return hash(None)

    def __lt__(self, other: object) -> bool:
        """EastNull is not less than anything (including itself)."""
        if not isinstance(other, EastNull):
            return NotImplemented
        return False

    def __le__(self, other: object) -> bool:
        """EastNull is less than or equal to itself."""
        if not isinstance(other, EastNull):
            return NotImplemented
        return True

    def __gt__(self, other: object) -> bool:
        """EastNull is not greater than anything."""
        if not isinstance(other, EastNull):
            return NotImplemented
        return False

    def __ge__(self, other: object) -> bool:
        """EastNull is greater than or equal to itself."""
        if not isinstance(other, EastNull):
            return NotImplemented
        return True


# Singleton instance
east_null = EastNull()


# =============================================================================
# EastBlob - Immutable binary data
# =============================================================================


class EastBlob(bytes):
    """East blob type - immutable binary data.

    Extends bytes directly, so it works anywhere bytes is expected.
    Provides East-specific formatting (hexadecimal representation).

    Example:
        data: EastBlob = EastBlob(b"\\x01\\x02\\x03")
        compressed: EastBlob = EastBlob(gzip.compress(data))

        # Works as bytes
        len(data)  # 3
        data[0]    # 1
    """

    __slots__ = ()

    def __new__(cls, data: bytes | bytearray | list[int] | EastBlob) -> EastBlob:
        """Create an EastBlob from various byte sources."""
        if isinstance(data, (EastBlob, bytes, bytearray)):
            return super().__new__(cls, data)
        if isinstance(data, list):
            return super().__new__(cls, bytes(data))
        raise TypeError(f"Cannot create EastBlob from {type(data)}")

    @property
    def data(self) -> bytes:
        """Access underlying bytes (for compatibility)."""
        return bytes(self)

    def __hash__(self) -> int:
        """Hash based on bytes content."""
        return super().__hash__()

    def __repr__(self) -> str:
        """Return East hexadecimal format."""
        if len(self) == 0:
            return "0x"
        # Limit display for very large blobs
        if len(self) > 256:
            hex_str = self[:256].hex()
            return f"0x{hex_str}..."
        return f"0x{self.hex()}"

    def __str__(self) -> str:
        """Return East hexadecimal format."""
        return repr(self)

    # ----- Eager value methods --------------------------------------------

    def size(self) -> int:
        """Number of bytes in the blob (east-c BlobSize).

        Returns:
            The byte length, equivalent to ``len(self)``.
        """
        return len(self)

    def get_uint8(self, index: int) -> int:
        """Unsigned byte at ``index`` (east-c BlobGetUint8).

        Args:
            index: Zero-based byte position.

        Returns:
            The byte value at ``index`` as an integer in ``[0, 255]``.
        """
        return self[index]

    def decode_utf8(self) -> str:
        """Decode the bytes as a UTF-8 string (east-c BlobDecodeUtf8).

        Returns:
            The decoded text as an East String.

        Raises:
            EastError: If the bytes are not valid UTF-8.
        """
        from east.types.types import StringType

        return _call_builtin("BlobDecodeUtf8", [], [self], StringType)

    def decode_utf16(self) -> str:
        """Decode the bytes as a UTF-16 string (east-c BlobDecodeUtf16).

        Returns:
            The decoded text as an East String.

        Raises:
            EastError: If the bytes are not valid UTF-16.
        """
        from east.types.types import StringType

        return _call_builtin("BlobDecodeUtf16", [], [self], StringType)

    def decode_csv(self, element_type: EastType, config: Any = None) -> Any:
        """Decode CSV bytes into an Array of ``element_type`` (east-c BlobDecodeCsv).

        Args:
            element_type: East type of each decoded row (a ``StructType``);
                each CSV record is parsed into a value of this type, yielding
                the array element. The array wrapping is applied internally —
                pass the row type, not ``ArrayType(row)``.
            config: Optional CSV decode configuration (delimiter, header
                handling, etc.) shaped as ``CsvParseConfigType``; ``None``
                uses the defaults.

        Returns:
            An EastArray whose element type is ``element_type``, one entry per
            parsed CSV record.

        Raises:
            ValueError: If the CSV cannot be decoded (malformed input, a field
                that fails to parse as its column type, or a missing required
                column).
        """
        from east.serialization.csv import decode_csv_for
        from east.types.types import ArrayType

        return decode_csv_for(ArrayType(element_type), config)(bytes(self))

    def decode_beast2(self, typ: EastType) -> Any:
        """Decode beast2-encoded bytes as a value of ``typ`` (east-c BlobDecodeBeast2).

        Uses the with-header (full) beast2 format, byte-compatible with the
        ``BlobDecodeBeast2`` builtin (and TS ``decodeBeast2For``). It is the
        serialization-layer equivalent of that builtin rather than calling
        through to it. The headerless beast2 codec cannot represent mutable
        containers (Array/Set/Dict/Ref) and is not interoperable with the
        builtin, so it must not be used here.

        Args:
            typ: East type the bytes were encoded as; required to drive
                decoding, which is type-directed.

        Returns:
            The decoded East value of type ``typ``.
        """
        from east.serialization.beast2 import decode_beast2_with_header_for

        return decode_beast2_with_header_for(typ)(bytes(self))

    @staticmethod
    def encode_beast2(value: Any) -> EastBlob:
        """Encode an East value to beast2 bytes (east-c BlobEncodeBeast2).

        Uses the with-header (full) beast2 format, byte-compatible with the
        ``BlobEncodeBeast2`` builtin (and TS ``encodeBeast2For``). It is the
        serialization-layer equivalent of that builtin rather than calling
        through to it; the encoding type is inferred from ``value`` via
        ``type_of``. The headerless codec is not used because it cannot encode
        mutable containers (Array/Set/Dict/Ref) and is not interoperable with
        the builtin.

        Args:
            value: Any East value to serialize.

        Returns:
            An EastBlob holding the beast2-encoded bytes.
        """
        from east.serialization.beast2 import encode_beast2_with_header_for

        return EastBlob(encode_beast2_with_header_for(_ev.type_of(value))(value))


# =============================================================================
# Runtime storage dtype for Vector / Matrix element types
# =============================================================================
#
# Vector/Matrix carry a *logical* element type (Float / Integer / Boolean) in
# the East type system. The backing NumPy buffer may use any storage dtype that
# is compatible with that logical element — e.g. a Vector<Float> may be backed
# by float32 for half-memory, zero-copy torch interop. The logical element is
# what the East type system sees; the storage dtype is a runtime property of the
# buffer. The C bridge canonicalizes the buffer to the dtype below when a value
# crosses into east-c (where Vector/Matrix are stored at these fixed widths).

# Canonical (default) storage dtype per logical element, matching the east-c
