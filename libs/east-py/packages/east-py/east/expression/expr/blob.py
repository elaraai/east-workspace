#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``BlobExpression`` — TS ``BlobExpr`` (``libs/east/src/expr/blob.ts``)."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from east.expression.errors import ExpressionError
from east.expression.expr.base import Expression
from east.expression.lift import _lift
from east.expression.nodes import _builtin
from east.types.types import ArrayType, EastType, IntegerType, StringType

if TYPE_CHECKING:
    from east.expression.expr.array import ArrayExpression
    from east.expression.expr.integer import IntegerExpression
    from east.expression.expr.string import StringExpression


class BlobExpression(Expression):
    """A Blob-typed expression (immutable bytes): size, byte access, text
    decoding, and the BEAST / CSV decoders."""

    __slots__ = ()
    _kind = "Blob"

    def size(self) -> IntegerExpression:
        """Traced BlobSize: the number of bytes."""
        return self._expr(_builtin("BlobSize", IntegerType, [], [self.ir]), IntegerType)

    def get_uint8(self, offset: Any) -> IntegerExpression:
        """Traced BlobGetUint8: the byte at ``offset`` (0-255; an East runtime
        error when out of bounds)."""
        i = self._typed("get_uint8", offset, IntegerType)
        return self._expr(_builtin("BlobGetUint8", IntegerType, [], [self.ir, i.ir]), IntegerType)

    def decode_utf8(self) -> StringExpression:
        """Traced BlobDecodeUtf8 (an East runtime error on invalid UTF-8)."""
        return self._expr(_builtin("BlobDecodeUtf8", StringType, [], [self.ir]), StringType)

    def decode_utf16(self) -> StringExpression:
        """Traced BlobDecodeUtf16 (little-endian without a BOM)."""
        return self._expr(_builtin("BlobDecodeUtf16", StringType, [], [self.ir]), StringType)

    def decode_beast(self, typ: EastType, version: str = "v1") -> Expression:
        """Traced BlobDecodeBeast / BlobDecodeBeast2: decode East's binary
        format as a value of ``typ``. ``'v2'`` names the beast2 FAMILY — the
        decoder dispatches on the blob's magic byte, so every released
        container version reads."""
        if not isinstance(typ, EastType):
            raise ExpressionError(".decode_beast() takes an East type")
        if version == "v1":
            builtin = "BlobDecodeBeast"
        elif version == "v2":
            builtin = "BlobDecodeBeast2"
        else:
            raise ExpressionError(f"Unsupported Beast version: {version!r} (expected 'v1' or 'v2')")
        return self._expr(_builtin(builtin, typ, [typ], [self.ir]), typ)

    def open_beast(self, typ: EastType) -> Expression:
        """Traced BlobOpenBeast2 (TS ``openBeast``): open an indexed beast2 v5
        collection blob as a FROZEN lazy paged value of ``typ`` — ``size``,
        keyed reads and ``b.for_`` loops answer from the segment index, and
        anything else hydrates the whole value once (#657). ``typ`` must be an
        Array, Set or Dict type. A blob that cannot page (an index-less blob
        such as ``East.Blob.encode_beast(v, 'v2')`` writes, a v4 container, an
        element shape carrying a Ref or a function) decodes whole, frozen; a
        v5 header of another type is an East runtime error."""
        if not isinstance(typ, EastType) or typ.type not in ("Array", "Set", "Dict"):
            raise ExpressionError(".open_beast() takes an Array, Set or Dict type")
        return self._expr(_builtin("BlobOpenBeast2", typ, [typ], [self.ir]), typ)

    def decode_csv(self, struct_type: EastType, config: Any = None, **options: Any) -> ArrayExpression:
        """Traced BlobDecodeCsv: the CSV bytes as an Array of ``struct_type``
        rows. ``config`` is a ``CsvParseConfigType`` value; the keyword
        ``options`` are ``east.serialization.csv.csv_parse_config``'s
        (``delimiter=…``, ``has_header=…``, ``null_strings=…``, …)."""
        from east.serialization.csv import CsvParseConfigType, csv_parse_config

        if not isinstance(struct_type, EastType) or struct_type.type != "Struct":
            raise ExpressionError(".decode_csv() takes the row StructType")
        if config is not None and options:
            raise ExpressionError(".decode_csv() takes a config value OR keyword options, not both")
        cfg = _lift(config if config is not None else csv_parse_config(**options),
                    hint=CsvParseConfigType)
        out = ArrayType(struct_type)
        return self._expr(
            _builtin("BlobDecodeCsv", out, [struct_type, CsvParseConfigType], [self.ir, cfg.ir]),
            out,
        )
