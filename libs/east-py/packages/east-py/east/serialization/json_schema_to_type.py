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


def _spell(value: Any) -> str:
    """A schema scalar as a message spells it -- JSON's null/true/false, else itself.

    The TypeScript twin words the same refusals the same way.
    """
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    return str(value)


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


class _CycleGroup:
    """A cyclic group of definitions, and the one definition every cycle passes through."""

    def __init__(self, members: list[str], binder: str) -> None:
        self.members = members
        self.binder = binder


class _Scope:
    """A binder under construction: its self marker, and the members built beneath it.

    Members built inside the scope capture the marker, so they are shared only
    within it.
    """

    def __init__(self, marker: Any) -> None:
        self.marker = marker
        self.built: dict[str, EastType] = {}


def _cycle_groups(defs: dict[str, JsonSchema], keyword: str) -> dict[str, _CycleGroup]:
    """The cyclic groups among the definitions, each with its binder.

    East's rule is one recursive binder per strongly connected group of
    definitions, not one definition per cycle: ``Node -> NodeList -> Node``, the
    ordinary way a recursive schema is written, is one ``RecursiveType`` with
    the alias inlined. The binder is the first definition, in document order,
    whose removal leaves the rest of its group acyclic; document order alone
    decides it, so the TypeScript twin chooses the same one. Reachability is a
    closure, never a walk that stops at its first hit, so nothing here depends
    on the order ``$ref``s appear in -- nor on a ``set``'s iteration order.

    Raises:
        JsonSchemaUnsupportedError: On a group whose cycles do not all pass
            through one definition -- East binds one ``RecursiveType`` per
            group, so such a group would need two.
    """
    names = list(defs)
    edges: dict[str, list[str]] = {}
    for name in names:
        seen: set[str] = set()
        _collect_refs(defs[name], keyword, seen)
        edges[name] = [target for target in names if target in seen]

    def reach(start: str, allowed: set[str]) -> set[str]:
        """Every definition reachable from ``start`` through the ``allowed`` ones."""
        out: set[str] = set()
        stack = [start]
        while stack:
            at = stack.pop()
            for nxt in edges.get(at, []):
                if nxt not in allowed or nxt in out:
                    continue
                out.add(nxt)
                stack.append(nxt)
        return out

    everything = set(names)
    closure = {name: reach(name, everything) for name in names}

    groups: dict[str, _CycleGroup] = {}
    for name in names:
        if name in groups or name not in closure[name]:
            continue
        members = [
            other
            for other in names
            if other == name or (other in closure[name] and name in closure[other])
        ]
        binder: str | None = None
        for candidate in members:
            allowed = {member for member in members if member != candidate}
            if all(
                member == candidate or member not in reach(member, allowed) for member in members
            ):
                binder = candidate
                break
        if binder is None:
            quoted = [f'"{member}"' for member in members]
            listed = f"{', '.join(quoted[:-1])} and {quoted[-1]}"
            raise JsonSchemaUnsupportedError(
                f"definitions {listed} are mutually recursive in a way East cannot express — "
                "every cycle among them must pass through one definition, and East binds one "
                "RecursiveType per group",
                _pointer_of([keyword, name]),
            )
        group = _CycleGroup(members, binder)
        for member in members:
            groups[member] = group
    return groups


class _Context:
    def __init__(self, defs: dict[str, JsonSchema], keyword: str) -> None:
        self.defs = defs
        self.keyword = keyword
        # Every definition on a cycle, mapped to its group.
        self.groups = _cycle_groups(defs, keyword)
        # Binders currently under construction.
        self.building: dict[str, _Scope] = {}
        # Completed definitions that capture no marker, so a shared one is built once.
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

    OpenAPI 3.0's ``nullable: true`` beside a type is refused rather than
    dropped: East JSON has no bare null for any type but ``Null``, so the only
    reading would silently admit a schema whose nulls the reader then rejects
    — model the value as an Option instead.

    Cycles among definitions become ``RecursiveType``s, one per cycle group:
    ``Node -> NodeList -> Node`` is one type with the alias inlined. A group
    whose cycles do not all pass through one definition would need two
    binders, which East does not support, and is refused naming the group.

    A ``$schema`` is honoured when present, and a release this cannot read — a
    draft-04 document, say — is refused by name instead of being structurally
    guessed at. It is not required: an OpenAPI 3.0 schema object is a fragment
    of a larger document and carries none, so demanding one would reject what
    ``json_schema_for(T, draft="openapi-3.0")`` emits.
    """
    # An explicit null is present, not absent -- exactly as the TypeScript twin
    # reads it -- so it is refused as a non-string rather than ignored.
    draft: str | None = None
    if "$schema" in schema:
        declared = schema["$schema"]
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

    # OpenAPI 3.0 spells "this or null" as `nullable: true`. East JSON has no
    # bare null for any type but Null itself -- an Option is a tagged object --
    # so the only reading is the Null spelling: `nullable` with no type, $ref,
    # oneOf or annotation. Beside anything else it would be dropped silently,
    # and the reader would then refuse the nulls the partner's contract permits.
    if node.get("nullable") is True and any(
        key in node for key in ("type", "$ref", "oneOf", "x-east-type")
    ):
        _fail(
            'type_from_json_schema cannot express "nullable" beside a type — East JSON has no '
            "bare null for it; model the value as an Option (a oneOf tagged none and some)",
            [*path, "nullable"],
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

    # OpenAPI 3.0 has no "null" type and spells it with `nullable`.
    if "type" not in node and node.get("nullable") is True:
        return NullType

    kind = node.get("type")

    if isinstance(kind, list):
        _fail(
            f"type_from_json_schema cannot express a union of primitive types "
            f"[{', '.join(_spell(k) for k in kind)}] — East unions are discriminated variants",
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
    if "type" not in node:
        _fail(
            'type_from_json_schema needs a "type" (or a $ref, oneOf, or x-east-type '
            "annotation) — an unconstrained schema has no East type",
            path,
        )
    return _fail(
        f'type_from_json_schema does not recognise the type "{_spell(kind)}"', [*path, "type"]
    )


def _build_ref(ref: str, ctx: _Context, path: list[str]) -> EastType:
    name = _ref_target(ref, ctx.keyword)
    if name is None:
        _fail(
            f'type_from_json_schema cannot resolve "{ref}" — only local '
            f"#/{ctx.keyword}/… references are supported",
            path,
        )
    if name not in ctx.defs:
        _fail(f'type_from_json_schema cannot resolve "{ref}" — no such definition', path)
    def_path = [ctx.keyword, name]
    definition = _as_schema(ctx.defs[name], def_path, f'definition "{name}"')

    group = ctx.groups.get(name)
    if group is None:
        # On no cycle: nothing it builds captures a marker, so build once and share.
        if name in ctx.done:
            return ctx.done[name]
        built = _build(definition, ctx, def_path)
        ctx.done[name] = built
        return built

    scope = ctx.building.get(group.binder)
    if name == group.binder:
        if scope is not None:
            return scope.marker
        if name in ctx.done:
            return ctx.done[name]

        def builder(self_ref: Any) -> EastType:
            ctx.building[name] = _Scope(self_ref)
            try:
                return _build(definition, ctx, def_path)
            finally:
                del ctx.building[name]

        bound = RecursiveType(builder)
        ctx.done[name] = bound
        return bound

    if scope is not None:
        # Inside its binder: the member captures the marker, so it is built
        # inline and shared only within this scope.
        if name in scope.built:
            return scope.built[name]
        built = _build(definition, ctx, def_path)
        scope.built[name] = built
        return built

    # Outside its binder: references to the binder resolve to the completed
    # RecursiveType, so the member captures nothing and can be shared.
    if name in ctx.done:
        return ctx.done[name]
    built = _build(definition, ctx, def_path)
    ctx.done[name] = built
    return built


def _build_items(node: JsonSchema, ctx: _Context, path: list[str]) -> EastType:
    if "items" not in node:
        _fail(
            'type_from_json_schema needs "items" on an array — East arrays are homogeneous',
            path,
        )
    return _build(_as_schema(node["items"], [*path, "items"], "items"), ctx, [*path, "items"])


def _build_struct(node: JsonSchema, ctx: _Context, path: list[str]) -> EastType:
    if node.get("additionalProperties") is not False:
        _fail(
            'type_from_json_schema needs "additionalProperties": false on an object — '
            "East structs are closed, so an open record has no East type",
            path,
        )
    if "properties" not in node:
        _fail('type_from_json_schema needs "properties" on an object', path)
    props = _as_schema(node["properties"], [*path, "properties"], "properties")

    required = node.get("required")
    required_names = (
        {entry for entry in required if isinstance(entry, str)}
        if isinstance(required, list)
        else set()
    )

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
        if "value" not in properties:
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
                    _as_schema(properties["value"], [*alt_path, "properties", "value"], "value"),
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
        if "key" not in properties or "value" not in properties:
            _fail(
                'type_from_json_schema needs "key" and "value" on a Dict entry',
                [*entry_path, "properties"],
            )
        return DictType(
            _build(
                _as_schema(properties["key"], [*entry_path, "properties", "key"], "key"),
                ctx,
                [*entry_path, "properties", "key"],
            ),
            _build(
                _as_schema(properties["value"], [*entry_path, "properties", "value"], "value"),
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
