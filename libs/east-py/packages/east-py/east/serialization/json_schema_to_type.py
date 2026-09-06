#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Build an East type from a JSON Schema — the python twin of ``typeFromJsonSchema``.

The one place the full JSON Schema vocabulary is confronted, and it runs at
build time, so nothing it rejects can reach a runtime: a keyword East's type
system cannot express is a plain raise carrying the RFC 6901 pointer to the
offending node, never a surprise on someone's payload months later.
"""

from typing import Any

from east.types.types import (
    ArrayType,
    BlobType,
    BooleanType,
    DateTimeType,
    DictType,
    EastType,
    FloatType,
    IntegerType,
    MatrixType,
    NullType,
    RecursiveType,
    RefType,
    SetType,
    StringType,
    StructType,
    VariantType,
    VectorType,
)

JsonSchema = dict[str, Any]


class JsonSchemaUnsupportedError(Exception):
    """A schema that cannot be expressed as an East type.

    Carries the RFC 6901 pointer to the offending node, because a contract
    document is large and "unsupported keyword" without a location is not
    actionable.
    """

    def __init__(self, message: str, pointer: str) -> None:
        super().__init__(message if pointer == "" else f"{message} (at {pointer})")
        self.pointer = pointer


# Keywords East's type system has no counterpart for, and why.
_UNSUPPORTED: dict[str, str] = {
    "allOf": "East types have no intersection; rewrite it as one object schema",
    "not": "East types have no negation",
    "if": "East types have no conditionals",
    "then": "East types have no conditionals",
    "else": "East types have no conditionals",
    "anyOf": "East variants are discriminated; use oneOf with a constant tag per case",
    "patternProperties": "East has no pattern-keyed record; use a Dict encoding",
    "dependentSchemas": "East types have no conditionals",
    "dependentRequired": "East structs require every field",
    "propertyNames": "East has no constraint on property names",
    "unevaluatedProperties": "East structs are closed; use additionalProperties: false",
    "unevaluatedItems": "East arrays are homogeneous",
    "prefixItems": "East has no tuple type; use a Struct",
    "additionalItems": "East has no tuple type; use a Struct",
    "contains": "East has no containment constraint",
}


def _pointer_of(path: list[str]) -> str:
    if not path:
        return ""
    return "/" + "/".join(s.replace("~", "~0").replace("/", "~1") for s in path)


def _fail(message: str, path: list[str]) -> Any:
    raise JsonSchemaUnsupportedError(message, _pointer_of(path))


def _as_schema(value: Any, path: list[str], what: str) -> JsonSchema:
    if not isinstance(value, dict):
        _fail(f"expected {what} to be a schema object", path)
    return value


# The ``$schema`` values this converter recognises, normalised, and the release each names.
_SCHEMA_URI_DRAFTS: dict[str, str] = {
    "https://json-schema.org/draft/2020-12/schema": "2020-12",
    "https://json-schema.org/draft-07/schema": "draft-07",
}


def _draft_of_schema_uri(uri: str, path: list[str]) -> str:
    """The release a document declares.

    A document that declares a release is taken at its word, so one written for
    draft-04 (or a release later than these) is refused by name rather than
    structurally guessed at and quietly mis-read. The scheme and a trailing
    ``#`` carry no meaning in a ``$schema`` value, so both normalise away.

    Raises:
        JsonSchemaUnsupportedError: On a release this converter cannot read.
    """
    key = uri[:-1] if uri.endswith("#") else uri
    if key.startswith("http:"):
        key = "https:" + key[len("http:") :]
    draft = _SCHEMA_URI_DRAFTS.get(key)
    if draft is None:
        return _fail(
            f'type_from_json_schema cannot read the JSON Schema release "{uri}" — it reads '
            "2020-12, draft-07, and OpenAPI 3.0 schema objects, which carry no $schema of "
            "their own",
            path,
        )
    return draft


def _definitions(root: JsonSchema, draft: str | None) -> tuple[dict[str, JsonSchema], str]:
    """Where a document keeps its definitions.

    The declared release says which keyword to expect, but a document that
    declares one and uses the other still resolves: only the prefix its
    ``$ref``s are written against matters, and that is read back from whichever
    keyword is present.
    """
    order = ["definitions", "$defs"] if draft == "draft-07" else ["$defs", "definitions"]
    for keyword in order:
        found = root.get(keyword)
        if isinstance(found, dict):
            return found, keyword
    return {}, "definitions" if draft == "draft-07" else "$defs"


def _ref_target(ref: str, keyword: str) -> str | None:
    """The definition name a local ``$ref`` points at, or None when not local."""
    prefix = f"#/{keyword}/"
    if not ref.startswith(prefix):
        return None
    return ref[len(prefix) :].replace("~1", "/").replace("~0", "~")


def _collect_refs(node: Any, keyword: str, out: set[str]) -> None:
    """Every local definition name referenced anywhere inside a schema node."""
    if isinstance(node, list):
        for item in node:
            _collect_refs(item, keyword, out)
        return
    if not isinstance(node, dict):
        return
    for key, value in node.items():
        if key == "$ref" and isinstance(value, str):
            target = _ref_target(value, keyword)
            if target is not None:
                out.add(target)
            continue
        _collect_refs(value, keyword, out)


def _self_referential(defs: dict[str, JsonSchema], keyword: str) -> set[str]:
    """Definition names that reach themselves.

    Raises:
        JsonSchemaUnsupportedError: On a cycle spanning more than one
            definition — East supports self-recursion only.
    """
    edges: dict[str, set[str]] = {}
    for name, definition in defs.items():
        seen: set[str] = set()
        _collect_refs(definition, keyword, seen)
        edges[name] = seen

    cyclic: set[str] = set()
    for name in edges:
        stack = list(edges.get(name, set()))
        visited: set[str] = set()
        route: list[str] = []
        while stack:
            nxt = stack.pop()
            if nxt == name:
                cyclic.add(name)
                break
            if nxt in visited:
                continue
            visited.add(nxt)
            route.append(nxt)
            stack.extend(edges.get(nxt, set()))
        if name in cyclic:
            for via in route:
                if name in edges.get(via, set()):
                    raise JsonSchemaUnsupportedError(
                        f'definitions "{name}" and "{via}" are mutually recursive; '
                        "East supports self-recursion only",
                        f"/{keyword}/{name}",
                    )
    return cyclic


class _Context:
    def __init__(self, defs: dict[str, JsonSchema], keyword: str) -> None:
        self.defs = defs
        self.keyword = keyword
        self.cyclic = _self_referential(defs, keyword)
        self.building: dict[str, Any] = {}
        self.done: dict[str, EastType] = {}


def type_from_json_schema(schema: JsonSchema) -> EastType:
    """Build an East type from a JSON Schema document.

    Args:
        schema: ``dict`` - the schema document.

    Returns:
        ``EastType`` - the type the schema describes.

    Raises:
        JsonSchemaUnsupportedError: When the schema uses a keyword East's type
            system cannot express, naming the keyword and its RFC 6901 pointer.

    A document emitted by ``json_schema_for`` carries ``x-east-type``
    annotations and inverts exactly — JSON Schema alone cannot tell ``DateTime``
    from a ``String`` with ``format: date-time``, ``Set`` from ``Array``, or
    ``Dict`` from an array of two-property objects. A foreign document without
    those annotations still converts, under a documented structural mapping,
    but does not promise to round-trip.

    A ``$schema`` is honoured when present, and a release this cannot read — a
    draft-04 document, say — is refused by name instead of being structurally
    guessed at. It is not required: an OpenAPI 3.0 schema object is a fragment
    of a larger document and carries none, so demanding one would reject what
    ``json_schema_for(T, draft="openapi-3.0")`` emits.
    """
    declared = schema.get("$schema")
    draft: str | None = None
    if declared is not None:
        if not isinstance(declared, str):
            _fail('type_from_json_schema expected "$schema" to be a string', ["$schema"])
        draft = _draft_of_schema_uri(declared, ["$schema"])

    defs, keyword = _definitions(schema, draft)
    return _build(schema, _Context(defs, keyword), [])


def _build(node: JsonSchema, ctx: _Context, path: list[str]) -> EastType:  # noqa: PLR0911, PLR0912
    for keyword, reason in _UNSUPPORTED.items():
        if keyword in node:
            _fail(
                f'type_from_json_schema cannot express "{keyword}" — {reason}',
                [*path, keyword],
            )

    ref = node.get("$ref")
    if isinstance(ref, str):
        return _build_ref(ref, ctx, [*path, "$ref"])

    # An annotated document says outright what it came from.
    annotation = node.get("x-east-type")
    if isinstance(annotation, str):
        return _build_annotated(annotation, node, ctx, path)

    if "oneOf" in node:
        return _build_variant(node, ctx, path)

    kind = node.get("type")

    # OpenAPI 3.0 has no "null" type and spells it with `nullable`.
    if kind is None and node.get("nullable") is True:
        return NullType

    if isinstance(kind, list):
        _fail(
            f"type_from_json_schema cannot express a union of primitive types "
            f"[{', '.join(str(k) for k in kind)}] — East unions are discriminated variants",
            [*path, "type"],
        )

    if kind == "null":
        return NullType
    if kind == "boolean":
        return BooleanType
    if kind == "string":
        return StringType
    if kind == "number":
        return FloatType
    if kind == "integer":
        return IntegerType
    if kind == "array":
        return ArrayType(_build_items(node, ctx, path))
    if kind == "object":
        return _build_struct(node, ctx, path)
    if kind is None:
        _fail(
            'type_from_json_schema needs a "type" (or a $ref, oneOf, or x-east-type '
            "annotation) — an unconstrained schema has no East type",
            path,
        )
    return _fail(f'type_from_json_schema does not recognise the type "{kind}"', [*path, "type"])


def _build_ref(ref: str, ctx: _Context, path: list[str]) -> EastType:
    name = _ref_target(ref, ctx.keyword)
    if name is None:
        _fail(
            f'type_from_json_schema cannot resolve "{ref}" — only local '
            f"#/{ctx.keyword}/… references are supported",
            path,
        )
    marker = ctx.building.get(name)
    if marker is not None:
        return marker
    cached = ctx.done.get(name)
    if cached is not None:
        return cached
    definition = ctx.defs.get(name)
    if definition is None:
        _fail(f'type_from_json_schema cannot resolve "{ref}" — no such definition', path)

    def_path = [ctx.keyword, name]
    if name in ctx.cyclic:

        def builder(self_ref: Any) -> EastType:
            ctx.building[name] = self_ref
            try:
                return _build(definition, ctx, def_path)
            finally:
                del ctx.building[name]

        built = RecursiveType(builder)
    else:
        built = _build(definition, ctx, def_path)
    ctx.done[name] = built
    return built


def _build_items(node: JsonSchema, ctx: _Context, path: list[str]) -> EastType:
    items = node.get("items")
    if items is None:
        _fail(
            'type_from_json_schema needs "items" on an array — East arrays are homogeneous',
            path,
        )
    return _build(_as_schema(items, [*path, "items"], "items"), ctx, [*path, "items"])


def _build_struct(node: JsonSchema, ctx: _Context, path: list[str]) -> EastType:
    if node.get("additionalProperties") is not False:
        _fail(
            'type_from_json_schema needs "additionalProperties": false on an object — '
            "East structs are closed, so an open record has no East type",
            path,
        )
    properties = node.get("properties")
    if properties is None:
        _fail('type_from_json_schema needs "properties" on an object', path)
    props = _as_schema(properties, [*path, "properties"], "properties")

    required = node.get("required")
    required_names = set(required) if isinstance(required, list) else set()

    fields: list[tuple[str, EastType]] = []
    for name, value in props.items():
        if name not in required_names:
            _fail(
                f'type_from_json_schema needs every property required — "{name}" is optional, '
                "and East structs have no absent field; model it as an Option",
                [*path, "properties", name],
            )
        fields.append(
            (
                name,
                _build(
                    _as_schema(value, [*path, "properties", name], f'property "{name}"'),
                    ctx,
                    [*path, "properties", name],
                ),
            )
        )
    return StructType(fields)


def _tag_of(alternative: JsonSchema) -> str | None:
    """The constant tag an alternative pins, or None when it pins none."""
    properties = alternative.get("properties")
    if not isinstance(properties, dict):
        return None
    tag = properties.get("type")
    if not isinstance(tag, dict):
        return None
    constant = tag.get("const")
    if isinstance(constant, str):
        return constant
    # draft-04 (and so OpenAPI 3.0) has no `const`; a single-valued enum is the
    # same assertion.
    choices = tag.get("enum")
    if isinstance(choices, list) and len(choices) == 1 and isinstance(choices[0], str):
        return choices[0]
    return None


def _build_variant(node: JsonSchema, ctx: _Context, path: list[str]) -> EastType:
    alternatives = node.get("oneOf")
    if not isinstance(alternatives, list) or not alternatives:
        _fail('type_from_json_schema needs a non-empty "oneOf"', [*path, "oneOf"])

    cases: list[tuple[str, EastType]] = []
    seen: set[str] = set()
    for i, raw in enumerate(alternatives):
        alt_path = [*path, "oneOf", str(i)]
        alternative = _as_schema(raw, alt_path, f"oneOf[{i}]")
        tag = _tag_of(alternative)
        if tag is None:
            _fail(
                'type_from_json_schema needs each oneOf alternative to pin a constant "type" '
                "tag — an untagged union is not an East variant",
                alt_path,
            )
        properties = _as_schema(
            alternative.get("properties"), [*alt_path, "properties"], "properties"
        )
        payload = properties.get("value")
        if payload is None:
            _fail(
                'type_from_json_schema needs a "value" property on each variant case',
                [*alt_path, "properties"],
            )
        if tag in seen:
            _fail(f'type_from_json_schema found the variant case "{tag}" twice', alt_path)
        seen.add(tag)
        cases.append(
            (
                tag,
                _build(
                    _as_schema(payload, [*alt_path, "properties", "value"], "value"),
                    ctx,
                    [*alt_path, "properties", "value"],
                ),
            )
        )
    return VariantType(cases)


def _build_annotated(  # noqa: PLR0911
    annotation: str, node: JsonSchema, ctx: _Context, path: list[str]
) -> EastType:
    if annotation == "Integer":
        return IntegerType
    if annotation == "Float":
        return FloatType
    if annotation == "DateTime":
        return DateTimeType
    if annotation == "Blob":
        return BlobType
    if annotation == "Set":
        return SetType(_build_items(node, ctx, path))
    if annotation == "Vector":
        return VectorType(_build_items(node, ctx, path))
    if annotation == "Matrix":
        rows = _as_schema(node.get("items"), [*path, "items"], "items")
        return MatrixType(_build_items(rows, ctx, [*path, "items"]))
    if annotation == "Dict":
        entry = _as_schema(node.get("items"), [*path, "items"], "items")
        entry_path = [*path, "items"]
        properties = _as_schema(
            entry.get("properties"), [*entry_path, "properties"], "properties"
        )
        key = properties.get("key")
        value = properties.get("value")
        if key is None or value is None:
            _fail(
                'type_from_json_schema needs "key" and "value" on a Dict entry',
                [*entry_path, "properties"],
            )
        return DictType(
            _build(
                _as_schema(key, [*entry_path, "properties", "key"], "key"),
                ctx,
                [*entry_path, "properties", "key"],
            ),
            _build(
                _as_schema(value, [*entry_path, "properties", "value"], "value"),
                ctx,
                [*entry_path, "properties", "value"],
            ),
        )
    if annotation == "Ref":
        return RefType(_build_items(node, ctx, path))
    return _fail(
        f'type_from_json_schema does not recognise the x-east-type "{annotation}"',
        [*path, "x-east-type"],
    )


__all__ = [
    "JsonSchemaUnsupportedError",
    "type_from_json_schema",
]
