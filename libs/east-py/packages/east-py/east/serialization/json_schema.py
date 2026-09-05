#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""JSON Schema for East types — the python twin of ``jsonSchemaFor``.

Emits a schema describing the East-JSON encoding of an East type, so a
third-party producer can validate a payload before sending it and cannot
produce something the reader would then reject. The document is deterministic
and matches what the TypeScript implementation emits byte for byte: key order,
``$defs`` names and case order are fixed by the type, never by process state.
"""

from typing import Any, Literal

from east.types.types import EastType

# The releases a contract can be published in. A consumer's validator pins one,
# so the document has to be emitted in the one they can actually read; this
# selects the SPELLING of the schema, never the encoding it describes.
JsonSchemaDraft = Literal["2020-12", "draft-07", "openapi-3.0"]

JsonSchema = dict[str, Any]

_SCHEMA_URI: dict[str, str | None] = {
    "2020-12": "https://json-schema.org/draft/2020-12/schema",
    "draft-07": "http://json-schema.org/draft-07/schema#",
    # An OpenAPI 3.0 schema object lives inside an OpenAPI document and carries
    # no $schema of its own; stamping one would make the fragment invalid.
    "openapi-3.0": None,
}

_I64_MAX = "9223372036854775807"
_I64_MIN_ABS = "9223372036854775808"


def _bounded_digit_pattern(max_digits: str) -> str:
    """A regex alternation matching every decimal string from 1 to ``max_digits``.

    Zero is excluded so the sign can be attached without admitting ``-0``, which
    the encoder never emits.

    Generated rather than hand-written because the obvious approximation --
    ``[1-9][0-9]{0,18}`` for i64 -- accepts every 19-digit value up to
    9999999999999999999, so an unsigned 64-bit id would pass a producer's
    validator and then fail on receipt.
    """
    k = len(max_digits)
    alts: list[str] = []
    # Every shorter length is unconditionally below the bound; there are none to
    # add when the bound is itself a single digit.
    if k >= 2:
        alts.append("[1-9]" if k == 2 else f"[1-9][0-9]{{0,{k - 2}}}")

    prefix = ""
    for i in range(k):
        digit = int(max_digits[i])
        lo = 1 if i == 0 else 0
        if digit > lo:
            cls = str(lo) if digit - 1 == lo else f"[{lo}-{digit - 1}]"
            rest = k - i - 1
            tail = "" if rest == 0 else ("[0-9]" if rest == 1 else f"[0-9]{{{rest}}}")
            alts.append(f"{prefix}{cls}{tail}")
        prefix += max_digits[i]
    alts.append(max_digits)
    return "|".join(alts)


def _integer_pattern() -> str:
    """The exact accepted form of East JSON's ``Integer`` encoding."""
    return (
        f"^(?:0|(?:{_bounded_digit_pattern(_I64_MAX)})"
        f"|-(?:{_bounded_digit_pattern(_I64_MIN_ABS)}))$"
    )


# The canonical text DateTime encodes to -- always UTC, always three fractional
# digits, always an explicit +00:00 offset. Stricter than the historic decoder,
# deliberately: that also accepts a Z suffix and any numeric offset, neither of
# which the encoder ever emits. Calendar-impossible dates such as 30 February
# still match -- no regex a schema can carry rules them out -- and are rejected
# when the date is constructed.
_DATETIME_PATTERN = (
    r"^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])"
    r"T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}\+00:00$"
)

# `0x` and an even count of lowercase hex.
_BLOB_PATTERN = "^0x(?:[0-9a-f]{2})*$"

# The non-finite floats JSON cannot hold, as the encoder spells them. Sorted for
# determinism.
_FLOAT_SPECIALS = ["-0.0", "-Infinity", "Infinity", "NaN"]


class _EastJsonPatterns:
    """The exact lexical forms East JSON's scalar encodings take.

    Published so a reader can enforce precisely what :func:`json_schema_for`
    describes -- the contract and the check are then one definition, not two
    that have to be kept in step by hand.
    """

    @property
    def integer(self) -> str:
        """Decimal i64, no leading zeros, no sign on zero."""
        return _integer_pattern()

    @property
    def datetime(self) -> str:
        """RFC 3339 in UTC with three fractional digits and an explicit ``+00:00``."""
        return _DATETIME_PATTERN

    @property
    def blob(self) -> str:
        """``0x`` followed by an even count of lowercase hex digits."""
        return _BLOB_PATTERN

    @property
    def float_specials(self) -> list[str]:
        """The non-finite floats, as strings, in the order the schema lists them."""
        return list(_FLOAT_SPECIALS)


EAST_JSON_PATTERNS = _EastJsonPatterns()


def _defs_keyword(draft: str) -> str:
    """Where definitions live, and how they are referenced, in a given release."""
    return "$defs" if draft == "2020-12" else "definitions"


class _Context:
    """Per-walk state: the definitions being accumulated and the names assigned."""

    def __init__(self, draft: str) -> None:
        self.draft = draft
        self.defs: JsonSchema = {}
        # Recursive scope id -> definition name, in first-encounter order.
        self.names: dict[int, str] = {}


def json_schema_for(typ: EastType, draft: JsonSchemaDraft = "2020-12") -> JsonSchema:
    """Emit a JSON Schema describing the East-JSON encoding of an East type.

    Args:
        typ: ``EastType`` - the type to describe.
        draft: Which release to emit. Defaults to ``"2020-12"``.

    Returns:
        ``dict`` - a JSON Schema document.

    Raises:
        TypeError: If the type has no JSON form -- ``Never``, ``Function`` or
            ``AsyncFunction`` -- naming the offending type.

    Example:
        >>> from east.types.types import ArrayType, IntegerType, StringType, StructType
        >>> row = StructType([("sensor", StringType), ("litres", IntegerType)])
        >>> schema = json_schema_for(ArrayType(row), draft="draft-07")
        >>> schema["$schema"]
        'http://json-schema.org/draft-07/schema#'
    """
    if draft not in _SCHEMA_URI:
        raise ValueError(
            f"json_schema_for does not emit {draft!r}; expected one of {sorted(_SCHEMA_URI)}"
        )
    ctx = _Context(draft)
    body = _schema_of(typ, ctx)

    out: JsonSchema = {}
    uri = _SCHEMA_URI[draft]
    if uri is not None:
        out["$schema"] = uri
    out.update(body)
    if ctx.defs:
        out[_defs_keyword(draft)] = ctx.defs
    return out


def _schema_of(t: EastType, ctx: _Context) -> JsonSchema:  # noqa: PLR0911, PLR0912
    """The schema for one type node, accumulating recursive definitions."""
    kind = t.type

    if kind == "Never":
        raise TypeError(
            "json_schema_for cannot describe Never — it has no values, "
            "so no JSON document satisfies it"
        )
    if kind == "Function":
        raise TypeError("json_schema_for cannot describe Function — JSON has no function form")
    if kind == "AsyncFunction":
        raise TypeError(
            "json_schema_for cannot describe AsyncFunction — JSON has no function form"
        )

    if kind == "Null":
        # OpenAPI 3.0 predates the "null" type; `nullable` plus a closed enum is
        # the documented equivalent.
        if ctx.draft == "openapi-3.0":
            return {"nullable": True, "enum": [None]}
        return {"type": "null"}

    if kind == "Boolean":
        return {"type": "boolean"}

    if kind == "String":
        return {"type": "string"}

    if kind == "Integer":
        # A JSON number cannot round-trip the upper half of i64, so East JSON
        # encodes Integer as a decimal string and the pattern pins the range.
        return {"type": "string", "pattern": _integer_pattern(), "x-east-type": "Integer"}

    if kind == "Float":
        return {
            "oneOf": [
                {"type": "number"},
                {"type": "string", "enum": list(_FLOAT_SPECIALS)},
            ],
            "x-east-type": "Float",
        }

    if kind == "DateTime":
        return {
            "type": "string",
            "format": "date-time",
            "pattern": _DATETIME_PATTERN,
            "x-east-type": "DateTime",
        }

    if kind == "Blob":
        return {"type": "string", "pattern": _BLOB_PATTERN, "x-east-type": "Blob"}

    if kind == "Array":
        return {"type": "array", "items": _schema_of(t.value, ctx)}

    if kind == "Set":
        return {
            "type": "array",
            "items": _schema_of(t.value, ctx),
            "uniqueItems": True,
            "x-east-type": "Set",
        }

    if kind == "Vector":
        return {"type": "array", "items": _schema_of(t.value, ctx), "x-east-type": "Vector"}

    if kind == "Matrix":
        # Rows are equal-length, which no release can express without $data; the
        # reader enforces it.
        return {
            "type": "array",
            "items": {"type": "array", "items": _schema_of(t.value, ctx)},
            "x-east-type": "Matrix",
        }

    if kind == "Ref":
        # A Ref encodes as a one-element array, or as a relative pointer once
        # the same target has been written already.
        return {
            "oneOf": [
                {"type": "array", "items": _schema_of(t.value, ctx), "minItems": 1, "maxItems": 1},
                {
                    "type": "object",
                    "properties": {"$ref": {"type": "string"}},
                    "required": ["$ref"],
                    "additionalProperties": False,
                },
            ],
            "x-east-type": "Ref",
        }

    if kind == "Dict":
        return {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "key": _schema_of(t.value["key"], ctx),
                    "value": _schema_of(t.value["value"], ctx),
                },
                "required": ["key", "value"],
                "additionalProperties": False,
            },
            "uniqueItems": True,
            "x-east-type": "Dict",
        }

    if kind == "Struct":
        properties: JsonSchema = {}
        for field in t.value:
            properties[field["name"]] = _schema_of(field["type"], ctx)
        return {
            "type": "object",
            "properties": properties,
            "required": [field["name"] for field in t.value],
            "additionalProperties": False,
        }

    if kind == "Variant":
        alternatives = []
        for case in t.value:
            # draft-04 (and so OpenAPI 3.0) has no `const`; a single-valued enum
            # asserts the same thing.
            tag: JsonSchema = (
                {"enum": [case["name"]]} if ctx.draft == "openapi-3.0" else {"const": case["name"]}
            )
            alternatives.append(
                {
                    "type": "object",
                    "properties": {"type": tag, "value": _schema_of(case["type"], ctx)},
                    "required": ["type", "value"],
                    "additionalProperties": False,
                }
            )
        return {"oneOf": alternatives}

    if kind == "Recursive":
        payload = t.value
        if payload.type == "ref":
            name = ctx.names.get(payload.value)
            if name is None:
                raise TypeError(
                    f"json_schema_for: unresolved recursive reference {payload.value}"
                )
            return {"$ref": f"#/{_defs_keyword(ctx.draft)}/{name}"}
        wrapper = payload.value
        # Named by first-encounter order, never by scope id: ids come from a
        # process-global counter, so using them would make the document differ
        # between runs and between languages.
        name = f"Recursive{len(ctx.names) + 1}"
        ctx.names[wrapper["id"]] = name
        # Reserve the slot before recursing so a back-reference resolves.
        ctx.defs[name] = {}
        ctx.defs[name] = _schema_of(wrapper["inner"], ctx)
        return {"$ref": f"#/{_defs_keyword(ctx.draft)}/{name}"}

    raise TypeError(f"json_schema_for: unhandled type {kind}")


__all__ = [
    "EAST_JSON_PATTERNS",
    "JsonSchema",
    "JsonSchemaDraft",
    "json_schema_for",
]
