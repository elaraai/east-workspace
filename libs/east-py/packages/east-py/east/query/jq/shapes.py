#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The checker's view of a stream: how many outputs a filter gives, and the type of each.

The twin of ``shapes.ts``, with what narrowing has proved about each output.

Types are python's type values. Where TypeScript reads a type's parts off the
type object (``t.fields``, ``t.cases``, ``t.node``), python reads them with the
helpers here; a recursive type's node is its wrapper's inner type with each
reference closed over the wrapper (``_close_recursive_refs``), which is what
TypeScript's ``node`` is.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, NamedTuple

from east.serialization.json_schema import _flat_option_payload
from east.types.types import (
    ArrayType,
    DictType,
    EastType,
    FloatType,
    NeverType,
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
    _close_recursive_refs,
    is_type_equal,
)


class Mult(NamedTuple):
    """How many outputs a filter gives: at least ``lo``, at most ``hi``, a ``hi`` of 2 standing for more than one."""

    #: 1 when the filter always gives at least one output.
    lo: int
    #: 0 for none, 1 for at most one, 2 for any number.
    hi: int


#: Exactly one output.
ONE = Mult(1, 1)
#: None or one output.
MAYBE = Mult(0, 1)
#: No output: `empty`, `error`, `break`.
ZERO = Mult(0, 0)
#: Any number of outputs.
MANY = Mult(0, 2)
#: At least one output, possibly more.
SOME = Mult(1, 2)


def piped(a: Mult, b: Mult) -> Mult:
    """The multiplicity of ``a | b``: each output of ``a`` feeds ``b``."""
    lo = 1 if a.lo == 1 and b.lo == 1 else 0
    hi = 0 if a.hi == 0 or b.hi == 0 else (2 if a.hi == 2 or b.hi == 2 else 1)
    return Mult(lo, hi)


def also(a: Mult, b: Mult) -> Mult:
    """The multiplicity of ``a, b``: the outputs of ``a``, then those of ``b``."""
    return Mult(1 if a.lo == 1 or b.lo == 1 else 0, min(2, a.hi + b.hi))


def either(a: Mult, b: Mult) -> Mult:
    """The multiplicity of a choice between two filters: ``if``, ``//``, ``try``."""
    return Mult(1 if a.lo == 1 and b.lo == 1 else 0, max(a.hi, b.hi))


def wire_multiplicity(m: Mult) -> str:
    """The multiplicity a checked query records."""
    if m.hi == 2:
        return "many"
    return "one" if m.hi == 1 and m.lo == 1 else "maybe"


@dataclass(frozen=True, eq=False)
class Facts:
    """What narrowing has proved about a value, following its type's structure.

    - ``cases``: a variant holds one of ``cases``; ``payload`` is what is known
      about the payload when there is only one.
    - ``fields``: facts about some fields of a struct.
    - ``elements``: facts about every element of an array, set or vector.
    - ``values``: facts about every value of a dict.
    - ``present``: an option holds a value.
    """

    kind: str
    cases: tuple[str, ...] = ()
    payload: Facts | None = None
    fields: dict[str, Facts] = field(default_factory=dict)
    element: Facts | None = None
    value: Facts | None = None


@dataclass(frozen=True, eq=False)
class TypeShape:
    """An output of an East type, with what narrowing has proved about it."""

    type: EastType
    facts: Facts | None = None
    kind: str = "type"


@dataclass(frozen=True, eq=False)
class Member:
    """One member of a union: an output of one of several types, and the variant case it was read from."""

    shape: TypeShape
    case: str | None = None


@dataclass(frozen=True, eq=False)
class UnionShape:
    """Outputs of different types, one member per type."""

    members: tuple[Member, ...]
    kind: str = "union"


@dataclass(frozen=True, eq=False)
class ErrorShape:
    """A diagnostic was reported here; everything built on it is unchecked."""

    kind: str = "error"


#: The outputs of a filter as the checker knows them.
Shape = TypeShape | UnionShape | ErrorShape

#: The shape after a reported problem.
ERROR: Shape = ErrorShape()


def typed(type_: EastType, facts: Facts | None = None) -> TypeShape:
    """The shape of outputs of one type."""
    return TypeShape(type_, facts)


def union(members: list[Member] | tuple[Member, ...]) -> Shape:
    """A union of members, flattened, with members of the same type and case merged; one member is its own shape."""
    merged: list[Member] = []
    for member in members:
        if member.shape.type.type == "Never":
            continue
        if not any(m.case == member.case and type_equal(m.shape.type, member.shape.type) for m in merged):
            merged.append(member)
    if not merged:
        return typed(NeverType)
    if len(merged) == 1:
        return merged[0].shape
    return UnionShape(tuple(merged))


def members_of(shape: Shape) -> tuple[Member, ...]:
    """The members of a shape: one for a ``type`` shape."""
    if isinstance(shape, TypeShape):
        return (Member(shape, None),)
    if isinstance(shape, UnionShape):
        return shape.members
    return ()


# ─── A type's parts ──────────────────────────────────────────────────────

_NODES: dict[int, tuple[EastType, EastType]] = {}


def node_of(t: EastType) -> EastType:
    """A recursive wrapper's node: its inner type with each reference to it closed over it."""
    hit = _NODES.get(id(t))
    if hit is not None and hit[0] is t:
        return hit[1]
    payload = t.value
    if payload.type != "wrapper":
        raise ValueError(f"a recursive reference {payload.value} outside its wrapper")
    n = _close_recursive_refs(payload.value["inner"], {payload.value["id"]: t})
    _NODES[id(t)] = (t, n)
    return n


def fields_of(t: EastType) -> dict[str, EastType]:
    """A struct type's fields, in order, by name."""
    return {f["name"]: f["type"] for f in t.value}


def cases_of_type(t: EastType) -> dict[str, EastType]:
    """A variant type's cases, in order, by name."""
    return {c["name"]: c["type"] for c in t.value}


def dict_key(t: EastType) -> EastType:
    """A dict type's key type."""
    return t.value["key"]


def dict_value(t: EastType) -> EastType:
    """A dict type's value type."""
    return t.value["value"]


def type_equal(t1: EastType, t2: EastType, r1: EastType | None = None, r2: EastType | None = None) -> bool:
    """Whether two types are equal as TypeScript's ``isTypeEqual`` decides it.

    A recursive type's wrapper is transparent — the type equals its node, and
    anything its node equals — where east-py's ``is_type_equal`` holds a
    wrapper equal to wrappers only. The checker and the translator decide as
    TypeScript's do, so they give the same records and the same IR.
    """
    if r1 is None:
        r1 = t1
    if r2 is None:
        r2 = t2
    if t1 is t2:
        return True
    k1 = t1.type
    k2 = t2.type
    if k1 == "Recursive":
        n1 = node_of(t1)
        if k2 == "Recursive":
            # One recursive type can be two wrapper objects in python (type
            # interning hands back an equal one), where TypeScript's are one
            # object: east-py's equality of recursive types stands in for
            # TypeScript's identity.
            if is_type_equal(t1, t2):
                return True
            n2 = node_of(t2)
            if n1 is r1:
                return n2 is r2
            if n2 is r2:
                return False
            return type_equal(n1, n2, n1, n2)
        return type_equal(n1, t2, n1, r2)
    if k2 == "Recursive":
        n2 = node_of(t2)
        return type_equal(t1, n2, r1, n2)
    if k1 != k2:
        return False
    if k1 in ("Never", "Null", "Boolean", "Integer", "Float", "String", "DateTime", "Blob"):
        return True
    if k1 in ("Ref", "Array", "Set", "Vector", "Matrix"):
        return type_equal(t1.value, t2.value, r1, r2)
    if k1 == "Dict":
        return type_equal(dict_key(t1), dict_key(t2), r1, r2) and type_equal(dict_value(t1), dict_value(t2), r1, r2)
    if k1 in ("Struct", "Variant"):
        m1 = t1.value
        m2 = t2.value
        if len(m1) != len(m2):
            return False
        return all(a["name"] == b["name"] and type_equal(a["type"], b["type"], r1, r2) for a, b in zip(m1, m2, strict=True))
    if k1 in ("Function", "AsyncFunction"):
        i1 = t1.value["inputs"]
        i2 = t2.value["inputs"]
        if len(i1) != len(i2):
            return False
        if not all(type_equal(a, b, r1, r2) for a, b in zip(i1, i2, strict=True)):
            return False
        return type_equal(t1.value["output"], t2.value["output"], r1, r2)
    raise ValueError(f"Unknown type encountered during type equality check: {k1}")


def unwrap(type_: EastType) -> EastType:
    """A type with its recursive wrapper and references read through: what a value of it is made of."""
    t = type_
    while True:
        if t.type == "Recursive":
            t = node_of(t)
        elif t.type == "Ref":
            t = t.value
        else:
            return t


def nullable_payload(type_: EastType) -> EastType | None:
    """The payload of an option jq sees as ``null`` or the value: East JSON's flat options.

    Args:
        type_: A type.

    Returns:
        The ``some`` payload's type, or ``None`` when the type is not a flat
        option (jq then sees it as ``{type, value}``).
    """
    if type_.type != "Variant":
        return None
    if _flat_option_payload(type_) is None:
        return None
    return cases_of_type(type_).get("some")


def can_be_null(type_: EastType) -> bool:
    """Whether jq sees values of a type as ``null``: Null, or a flat option."""
    return type_.type == "Null" or nullable_payload(type_) is not None


def or_null(type_: EastType) -> EastType | None:
    """The type jq's ``T`` or ``null`` becomes: ``Option<T>``, or ``T`` when it can already be ``null``.

    Returns:
        The type, or ``None`` when no type holds both: ``T`` is an option jq
        sees as ``{type, value}``, and wrapping it again would too.
    """
    if type_.type == "Never":
        return NullType
    if can_be_null(type_):
        return type_
    option = OptionType(type_)
    return None if nullable_payload(option) is None else option


def unify(a: EastType, b: EastType) -> EastType | None:  # noqa: C901
    """The one type two outputs can share, as jq's typed outputs unify.

    - Equal types unify to themselves, and ``Never`` to the other.
    - A reference is read through, as jq sees its value: ``Ref<T>`` and ``U``
      unify as ``T`` and ``U`` do.
    - A recursive type and its node unify to the recursive type; another
      recursive type only with ``null``, or an option of it.
    - Integer and Float unify to Float.
    - ``null`` and ``T`` unify to ``Option<T>``; ``Option<T>`` and ``U`` to ``Option<T ⊔ U>``.
    - Arrays, sets, dicts and vectors unify element-wise.
    - Structs with the same field names unify field by field, in the first's
      field order; ``Struct{}`` unifies with any dict.
    - Variants unify case by case, taking every case of both.

    Returns:
        Their common type, or ``None`` when they have none.
    """
    if type_equal(a, b):
        return a
    if a.type == "Never":
        return b
    if b.type == "Never":
        return a
    if a.type == "Ref":
        return unify(a.value, b)
    if b.type == "Ref":
        return unify(a, b.value)
    if a.type == "Recursive" and type_equal(node_of(a), b):
        return a
    if b.type == "Recursive" and type_equal(node_of(b), a):
        return b
    if (a.type == "Integer" and b.type == "Float") or (a.type == "Float" and b.type == "Integer"):
        return FloatType

    # null and T.
    if a.type == "Null":
        return or_null(b)
    if b.type == "Null":
        return or_null(a)
    a_payload = nullable_payload(a)
    b_payload = nullable_payload(b)
    if a_payload is not None or b_payload is not None:
        inner = unify(a_payload if a_payload is not None else a, b_payload if b_payload is not None else b)
        return None if inner is None else or_null(inner)
    if a.type == "Recursive" or b.type == "Recursive":
        return None

    kind = a.type
    if kind == "Array":
        if b.type != "Array":
            return None
        element = unify(a.value, b.value)
        return None if element is None else ArrayType(element)
    if kind == "Set":
        if b.type != "Set" or not type_equal(a.value, b.value):
            return None
        return a
    if kind == "Dict":
        if b.type == "Struct" and len(b.value) == 0:
            return a
        if b.type != "Dict" or not type_equal(dict_key(a), dict_key(b)):
            return None
        value = unify(dict_value(a), dict_value(b))
        return None if value is None else DictType(dict_key(a), value)
    if kind == "Struct":
        if b.type == "Dict" and len(a.value) == 0:
            return b
        if b.type != "Struct":
            return None
        a_fields = fields_of(a)
        b_fields = fields_of(b)
        if len(a_fields) != len(b_fields) or not all(name in b_fields for name in a_fields):
            return None
        fields: list[tuple[str, EastType]] = []
        for name, f in a_fields.items():
            unified = unify(f, b_fields[name])
            if unified is None:
                return None
            fields.append((name, unified))
        return StructType(fields)
    if kind == "Variant":
        if b.type != "Variant":
            return None
        cases = dict(cases_of_type(a))
        for name, payload in cases_of_type(b).items():
            if name in cases:
                merged = unify(cases[name], payload)
                if merged is None:
                    return None
                cases[name] = merged
            else:
                cases[name] = payload
        return VariantType(list(cases.items()))
    return None


def descend_types(types: list[EastType] | tuple[EastType, ...]) -> list[EastType]:
    """The types ``..`` and ``recurse`` give on values of some types.

    Each type, then the types of the values inside it, depth first, each
    once. Inside a value are an option's value, the elements of an array,
    set or vector, a matrix's rows, a dict's values, a struct's fields, and a
    variant's case name and payloads (jq's ``{type, value}``).

    Args:
        types: The input's types.

    Returns:
        The types, in the order the walk first meets them.
    """
    seen: list[EastType] = []

    def visit(type_: EastType) -> None:
        if any(type_equal(s, type_) for s in seen):
            return
        seen.append(type_)
        t = unwrap(type_)
        payload = nullable_payload(t)
        if payload is not None:
            visit(payload)
            return
        kind = t.type
        if kind in ("Array", "Set", "Vector"):
            visit(t.value)
        elif kind == "Matrix":
            visit(ArrayType(t.value))
        elif kind == "Dict":
            visit(dict_value(t))
        elif kind == "Struct":
            for f in fields_of(t).values():
                visit(f)
        elif kind == "Variant":
            visit(StringType)
            for c in cases_of_type(t).values():
                visit(c)

    for type_ in types:
        visit(type_)
    return seen


def unify_shape(shape: Shape) -> EastType | None:
    """The one type a shape's outputs share: ``Never`` for none, ``None`` when they have none."""
    if isinstance(shape, ErrorShape):
        return None
    if isinstance(shape, TypeShape):
        return shape.type
    t: EastType = NeverType
    for member in shape.members:
        n = unify(t, member.shape.type)
        if n is None:
            return None
        t = n
    return t


def describe_type(type_: EastType, depth: int = 2) -> str:
    """Prints a type for a diagnostic, as jq's users read one.

    ``Integer``, ``Option<Float>``, ``Array<String>``, ``Dict<String, Float>``,
    ``Struct{id: Integer, total: Float}``, ``Variant{cancelled, pending, shipped}``.
    A struct deeper than ``depth`` prints as ``Struct{…}``, and one with more
    than six fields lists six and ``…``. A recursive type prints its node, and
    a reference back into it as ``…``.
    """
    seen: list[EastType] = []

    def show(t: EastType, level: int) -> str:
        kind = t.type
        if kind in ("Never", "Null", "Boolean", "Integer", "Float", "String", "DateTime", "Blob"):
            return kind
        if kind in ("Array", "Set", "Ref", "Vector", "Matrix"):
            return f"{kind}<{show(t.value, level)}>"
        if kind == "Dict":
            return f"Dict<{show(dict_key(t), level)}, {show(dict_value(t), level)}>"
        if kind == "Variant":
            payload = nullable_payload(t)
            if payload is not None:
                return f"Option<{show(payload, level)}>"
            cases = cases_of_type(t)
            if len(cases) == 2 and "none" in cases and "some" in cases:
                return f"Option<{show(cases['some'], level)}>"
            return f"Variant{{{', '.join(cases)}}}"
        if kind == "Struct":
            fields = list(fields_of(t).items())
            if level >= depth:
                return "Struct{}" if not fields else "Struct{…}"
            shown = [f"{name}: {show(f, level + 1)}" for name, f in fields[:6]]
            return f"Struct{{{', '.join(shown)}{', …' if len(fields) > 6 else ''}}}"
        if kind == "Recursive":
            if any(s is t for s in seen):
                return "…"
            seen.append(t)
            text = show(node_of(t), level)
            seen.pop()
            return text
        if kind in ("Function", "AsyncFunction"):
            inputs = ", ".join(show(i, level) for i in t.value["inputs"])
            return f"{kind}([{inputs}], {show(t.value['output'], level)})"
        return kind

    return show(type_, 0)


@dataclass(frozen=True)
class Proof:
    """What a condition proves when it is true.

    ``case``: the variant at a field path from ``.`` holds one of ``cases``;
    ``type``: the value at the path has one of the jq types ``types``.
    """

    kind: str
    path: tuple[str, ...]
    cases: tuple[str, ...] = ()
    types: tuple[str, ...] = ()


#: The names jq's ``type`` gives, and East's additions for its own types.
JQ_TYPE_NAMES = ("null", "boolean", "number", "string", "array", "object", "datetime", "blob", "function")


def jq_type_names(type_: EastType) -> list[str]:
    """The names ``type`` can give for values of a type: an option's ``null`` and its payload's."""
    t = unwrap(type_)
    payload = nullable_payload(t)
    if payload is not None:
        return ["null", *jq_type_names(payload)]
    kind = t.type
    return {
        "Never": [], "Null": ["null"], "Boolean": ["boolean"], "Integer": ["number"], "Float": ["number"],
        "String": ["string"], "Array": ["array"], "Set": ["array"], "Vector": ["array"], "Matrix": ["array"],
        "Dict": ["object"], "Struct": ["object"], "Variant": ["object"], "DateTime": ["datetime"],
        "Blob": ["blob"], "Function": ["function"], "AsyncFunction": ["function"],
    }.get(kind, [])


def narrow_types(shape: Shape, types: tuple[str, ...] | list[str]) -> Shape:
    """Narrows a shape to the outputs whose jq type is one of some names: what ``select(type == "object")`` keeps."""
    if isinstance(shape, ErrorShape):
        return shape
    members: list[Member] = []
    for member in members_of(shape):
        t = unwrap(member.shape.type)
        payload = nullable_payload(t)
        if payload is not None:
            keeps_null = "null" in types
            keeps_value = any(name in types for name in jq_type_names(payload))
            if keeps_null and keeps_value:
                members.append(member)
            elif keeps_value:
                members.append(Member(typed(payload), member.case))
            elif keeps_null:
                members.append(Member(typed(NullType), member.case))
            continue
        if any(name in types for name in jq_type_names(t)):
            members.append(member)
    return union(members)


@dataclass(frozen=True)
class CaseOf:
    """The output is ``.P.type`` of a variant at path ``P``, with the cases it can hold."""

    path: tuple[str, ...]
    variant: EastType
    cases: tuple[str, ...]


@dataclass(frozen=True)
class Partial:
    """The output is an option only because some cases of a variant lack the field read."""

    case_name: str
    leaf: str
    at: str


@dataclass(frozen=True, eq=False)
class Result:
    """What the checker knows about a filter's outputs.

    - ``shape`` and ``mult``: the outputs' types and how many there are.
    - ``access``: the field names from the filter's input to its output, when
      the filter only reads fields.
    - ``case_of``: the output is ``.P.type`` of a variant at path ``P``.
    - ``proves``: what the output being true proves about the input.
    - ``partial``: the output is an option only because some cases lack the field.
    - ``stream``: the output is an element of the stream the ``[]`` at this path makes.
    - ``type_of``: the output is the jq type name of the value at this field path.
    """

    shape: Shape
    mult: Mult
    access: tuple[str, ...] | None = None
    case_of: CaseOf | None = None
    proves: tuple[Proof, ...] | None = None
    partial: Partial | None = None
    stream: str | None = None
    type_of: tuple[str, ...] | None = None


def refine(shape: Shape, path: tuple[str, ...] | list[str], cases: tuple[str, ...] | list[str]) -> Shape:
    """Narrows a shape: the variant at ``path`` holds only ``cases``.

    Returns:
        The shape with the fact added, or the shape unchanged when the path
        does not lead to a variant.
    """
    if isinstance(shape, ErrorShape):
        return shape
    if isinstance(shape, UnionShape):
        return union([Member(refine(m.shape, path, cases), m.case) for m in shape.members])  # type: ignore[arg-type]
    facts = _refine_facts(shape.type, shape.facts, tuple(path), tuple(cases))
    return shape if facts is None else typed(shape.type, facts)


def _refine_facts(type_: EastType, facts: Facts | None, path: tuple[str, ...], cases: tuple[str, ...]) -> Facts | None:
    t = unwrap(type_)
    payload = nullable_payload(t)
    if payload is not None:
        inner = _refine_facts(payload, facts.payload if facts is not None and facts.kind == "present" else None,
                              path, cases)
        return None if inner is None else Facts("present", payload=inner)
    if len(path) == 0:
        if t.type != "Variant":
            return None
        known = facts.cases if facts is not None and facts.kind == "cases" else None
        all_cases = cases_of_type(t)
        kept = tuple(c for c in cases if c in all_cases and (known is None or c in known))
        single = (facts.payload if len(kept) == 1 and facts is not None and facts.kind == "cases"
                  and len(facts.cases) == 1 else None)
        return Facts("cases", cases=_unique(kept), payload=single)
    if t.type != "Struct":
        return None
    name, rest = path[0], path[1:]
    fields = fields_of(t)
    if name not in fields:
        return None
    known_fields = facts.fields if facts is not None and facts.kind == "fields" else {}
    inner = _refine_facts(fields[name], known_fields.get(name), rest, cases)
    if inner is None:
        return None
    updated = dict(known_fields)
    updated[name] = inner
    return Facts("fields", fields=updated)


def _unique(names: tuple[str, ...]) -> tuple[str, ...]:
    """The names once each, in first order: a set, as TypeScript's ``new Set`` keeps it."""
    return tuple(dict.fromkeys(names))


def cases_of(type_: EastType, facts: Facts | None) -> list[str]:
    """The cases a variant can hold, given what is known about it."""
    t = unwrap(type_)
    if t.type != "Variant":
        return []
    names = list(cases_of_type(t))
    return [c for c in names if c in facts.cases] if facts is not None and facts.kind == "cases" else names


def is_ordered(type_: EastType) -> bool:
    """Whether values of a type can be sorted and compared by East's total order: every data type."""
    seen: set[int] = set()
    alive: list[Any] = []

    def check(t: EastType) -> bool:
        if id(t) in seen:
            return True
        seen.add(id(t))
        alive.append(t)
        kind = t.type
        if kind in ("Function", "AsyncFunction"):
            return False
        if kind in ("Array", "Ref", "Set"):
            return check(t.value)
        if kind == "Dict":
            return check(dict_key(t)) and check(dict_value(t))
        if kind == "Struct":
            return all(check(f) for f in fields_of(t).values())
        if kind == "Variant":
            return all(check(c) for c in cases_of_type(t).values())
        if kind == "Recursive":
            return check(node_of(t))
        return True

    return check(type_)


__all__ = [
    "ERROR", "MANY", "MAYBE", "ONE", "SOME", "ZERO", "JQ_TYPE_NAMES",
    "CaseOf", "ErrorShape", "Facts", "Member", "Mult", "Partial", "Proof", "Result", "Shape", "TypeShape",
    "UnionShape", "also", "can_be_null", "cases_of", "cases_of_type", "descend_types", "describe_type", "dict_key",
    "dict_value", "either", "fields_of", "is_ordered", "jq_type_names", "members_of", "narrow_types", "node_of",
    "nullable_payload", "or_null", "piped", "refine", "type_equal", "typed", "unify", "unify_shape", "unwrap",
    "wire_multiplicity",
]
