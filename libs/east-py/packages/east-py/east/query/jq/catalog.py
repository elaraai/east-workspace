#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The builtin catalog: every builtin of jq 1.8 and East's additions. The twin of ``catalog.ts``.

The catalog's data — each builtin's name, status, arities and the reason one is
unavailable — is not copied by hand: ``make query-corpus`` in ``libs/east``
writes ``_catalog.json`` from TypeScript's catalog, and a TypeScript spec fails
while the file is stale. The typing rules, the checker's rule for each builtin
a query may call, are python functions keyed by the builtin's name;
``tests/test_query_catalog.py`` holds their keys to the file's.
"""

from __future__ import annotations

import json
import math
import re
from collections.abc import Callable
from dataclasses import dataclass, replace
from functools import cmp_to_key
from pathlib import Path
from typing import TYPE_CHECKING, Any

from east.datetime_format import DateTimeFormatTokenType
from east.query.jq.messages import MESSAGES, edit
from east.query.jq.parse import node as jq_node
from east.query.jq.print import json_string
from east.query.jq.regex import js_regex_error, validate_cross_platform
from east.query.jq.shapes import (
    ERROR,
    MANY,
    MAYBE,
    ONE,
    ZERO,
    Facts,
    Member,
    Mult,
    Result,
    TypeShape,
    cases_of_type,
    descend_types,
    describe_type,
    dict_key,
    dict_value,
    either,
    fields_of,
    is_ordered,
    members_of,
    node_of,
    nullable_payload,
    or_null,
    then,
    type_equal,
    typed,
    unify,
    union,
    unwrap,
)
from east.query.jq.spans import JqNode
from east.query.jq.strftime import format_tokens
from east.serialization.beast2 import encode_beast2_with_header_for
from east.types.types import (
    ArrayType,
    BooleanType,
    DateTimeType,
    DictType,
    EastType,
    FloatType,
    IntegerType,
    NeverType,
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
    is_immutable_type,
)
from east.utils.ordering import compare_for

if TYPE_CHECKING:
    from east.query.jq.check import CallContext

#: A builtin's typing rule.
Typing = Callable[["CallContext"], Result]


@dataclass(frozen=True)
class Builtin:
    """A catalog entry.

    ``status`` is ``supported``; ``excluded`` (host access and nondeterminism);
    ``unavailable`` (no East definition, with ``reason``); ``not_yet``; or
    ``tooling`` (tooling-only). ``typing`` is the checker's rule, for a builtin
    a query may call.
    """

    status: str
    arities: tuple[int, ...]
    reason: str | None = None
    typing: Typing | None = None


# ─── Helpers ─────────────────────────────────────────────────────────────


def one(type_: EastType, mult: Mult = ONE) -> Result:
    return Result(typed(type_), mult)


def _error() -> Result:
    return Result(ERROR, ONE)


def _types_of(result: Result) -> list[EastType]:
    """A result's members' types."""
    return [m.shape.type for m in members_of(result.shape)]


def per_member(_ctx: CallContext, input_: Result, each: Callable[[TypeShape], Result]) -> Result:
    """Applies a rule to each member of the call's input, and unions the outcomes."""
    if input_.shape.kind == "error":
        return _error()
    members: list[Member] = []
    mult: Mult | None = None
    for member in members_of(input_.shape):
        out = each(member.shape)
        if out.shape.kind == "error":
            return _error()
        members.extend(members_of(out.shape))
        mult = out.mult if mult is None else either(mult, out.mult)
    return Result(union(members), mult if mult is not None else ZERO)


def on_input(ctx: CallContext, expected: str, rule: Callable[[EastType, TypeShape], Result | None]) -> Result:
    """Requires the input's members to be of some kind, typing each with ``rule``."""
    def each(member: TypeShape) -> Result:
        t = unwrap(member.type)
        out = rule(t, member)
        if out is not None:
            return out
        return input_mismatch(ctx, expected, member.type)
    return per_member(ctx, ctx.input, each)


def input_mismatch(ctx: CallContext, expected: str, type_: EastType) -> Result:
    """The diagnostic for an input of the wrong type."""
    if ctx.input.partial is not None and nullable_payload(unwrap(type_)) is not None:
        return ctx.narrow_first(type_)
    if ctx.input.stream is not None and expected.startswith("an array"):
        return ctx.on_element(type_)
    if unwrap(type_).type == "DateTime" and expected == "a string":
        return ctx.mismatch("type_mismatch", MESSAGES.date_as_string(ctx.name))
    # An input that can be null: the fix skips the nulls.
    skip = ctx.skip_nulls() if nullable_payload(unwrap(type_)) is not None else None
    return ctx.mismatch("type_mismatch", MESSAGES.input(ctx.name, expected, describe_type(type_)), None,
                        [] if skip is None else [skip])


def element_of(t: EastType) -> EastType | None:
    """The element type of an array-like value as jq sees it: arrays, sets, vectors; matrix rows."""
    if t.type in ("Array", "Set", "Vector"):
        return t.value
    if t.type == "Matrix":
        return ArrayType(t.value)
    return None


def elements(member: TypeShape) -> Result | None:
    """The elements of an array-like input, with their facts."""
    t = unwrap(member.type)
    element = element_of(t)
    if element is None:
        return None
    facts = member.facts.element if t.type == "Array" and member.facts is not None and member.facts.kind == "elements" \
        else None
    return Result(typed(element, facts), ONE)


def values_of(member: TypeShape) -> Result | None:
    """The values ``.[]`` gives: array-like elements, dict values, struct fields."""
    t = unwrap(member.type)
    direct = elements(member)
    if direct is not None:
        return direct
    if t.type == "Dict":
        facts = member.facts.value if member.facts is not None and member.facts.kind == "values" else None
        return Result(typed(dict_value(t), facts), ONE)
    if t.type == "Struct":
        known = member.facts.fields if member.facts is not None and member.facts.kind == "fields" else None
        return Result(union([Member(typed(f, None if known is None else known.get(name)), None)
                             for name, f in fields_of(t).items()]), ONE)
    return None


def is_number(t: EastType) -> bool:
    return t.type in ("Integer", "Float")


def literal_integer(ctx: CallContext, i: int, what: str) -> int | None:
    """A literal argument that must be a non-negative Integer written in the query."""
    literal = ctx.literal(i)
    if literal is None or literal.type.type != "Integer" or literal.value < 0:
        ctx.fail("type_mismatch", MESSAGES.literal_argument(ctx.name, what, "a non-negative Integer"), arg=i)
        return None
    return literal.value


def literal_string(ctx: CallContext, i: int, what: str) -> str | None:
    """A literal argument that must be a String written in the query."""
    literal = ctx.literal(i)
    if literal is None or literal.type.type != "String":
        ctx.fail("type_mismatch", MESSAGES.literal_argument(ctx.name, what, "a string"), arg=i)
        return None
    return literal.value


@dataclass(frozen=True)
class _Arg:
    result: Result
    type: EastType


def arg_of(ctx: CallContext, i: int, expected: str, allowed: Callable[[EastType], bool],
           input_: Result | None = None, coerce: EastType | None = None) -> _Arg | None:
    """Checks an argument that must give values of one type among ``allowed``."""
    result = ctx.arg(i, input_)
    if result.shape.kind == "error":
        return None
    t = ctx.collect(result, i)
    if t is None:
        return None
    if not allowed(unwrap(t)):
        # A literal of another type the argument's type is written as: an ISO-8601 string for a DateTime.
        coerced = None if coerce is None else coerce_argument(ctx, i, coerce, "value")
        if coerced is _NOT_ISO:
            return None
        if coerced is not None:
            return _Arg(one(coerced), coerced)  # type: ignore[arg-type]
        ctx.fail("type_mismatch", MESSAGES.argument(ctx.name, ordinal(i), expected, describe_type(t)), arg=i)
        return None
    return _Arg(result, t)


#: What :func:`coerce_argument` gives for a string that is not an ISO-8601 date, which it has reported.
_NOT_ISO: Any = object()


def coerce_argument(ctx: CallContext, i: int, wanted: EastType, as_: str) -> Any:
    """Argument ``i`` rewritten as ``wanted`` is written.

    When it is a literal of another type (``as_`` ``"value"``), or an array
    literal of them (``"elements"``, each element a ``wanted``): an ISO-8601
    string as a DateTime, an Integer as a Float.

    Returns:
        The argument's new type; ``None`` when it is no such literal; or
        ``_NOT_ISO`` when it is a string that is not an ISO-8601 date, which
        the rewrite has reported.
    """
    reported = ctx.problems()
    coerced = ctx.coerce_arg(i, wanted) if as_ == "value" else ctx.coerce_arg_elements(i, wanted)
    if coerced is not None:
        return coerced
    return _NOT_ISO if ctx.problems() > reported else None


def ordinal(i: int) -> str:
    names = ["first", "second", "third", "fourth", "fifth"]
    return names[i] if i < len(names) else f"{i + 1}th"


def add_type(t: EastType) -> EastType | None:
    """The type ``+`` gives on values of one type, and whether adding nothing gives its identity."""
    u = unwrap(t)
    payload = nullable_payload(u)
    if payload is not None:
        return add_type(payload)
    if u.type in ("Integer", "Float", "String", "Array", "Dict"):
        return u
    if u.type == "Null":
        return NullType
    if u.type == "Struct":
        return or_null(u)
    return None


_NAMED_GROUP = re.compile(r"\(\?<([a-zA-Z_][a-zA-Z0-9_]*)>")


def check_regex(ctx: CallContext, i: int, flags: str) -> list[str] | None:
    """Validates a regular expression written in the query as an East one; gives its named groups."""
    literal = ctx.literal(i)
    if literal is None:
        r = arg_of(ctx, i, "a string", lambda t: t.type == "String")
        return None if r is None else []
    if literal.type.type != "String":
        ctx.fail("type_mismatch", MESSAGES.argument(ctx.name, ordinal(i), "a string", describe_type(literal.type)), arg=i)
        return None
    pattern: str = literal.value
    reason = js_regex_error(pattern, flags.replace("g", ""))
    if reason is not None:
        ctx.fail("type_mismatch", MESSAGES.regex(ctx.source(i), reason), arg=i)
        return None
    errors = validate_cross_platform(pattern, flags.replace("g", ""))
    if errors:
        ctx.fail("type_mismatch", MESSAGES.regex(ctx.source(i), re.sub(r"\.\Z", "", errors[0])), arg=i)
        return None
    return [m.group(1) for m in _NAMED_GROUP.finditer(pattern)]


def check_flags(ctx: CallContext, i: int | None) -> str | None:
    """A regex's flags, written in the query: ``g`` and ``i``."""
    if i is None:
        return ""
    flags = literal_string(ctx, i, "flags")
    if flags is None:
        return None
    for flag in flags:
        if flag not in ("g", "i"):
            ctx.fail("unsupported", MESSAGES.regex_flag(flag), arg=i)
            return None
    return flags


_compare_string = cmp_to_key(compare_for(StringType))
_encode_tokens = encode_beast2_with_header_for(ArrayType(DateTimeFormatTokenType))
_encode_strings = encode_beast2_with_header_for(ArrayType(StringType))
_encode_boolean = encode_beast2_with_header_for(BooleanType)


def rewrite_format(ctx: CallContext) -> bool:
    """Rewrites a strftime/strptime format argument as its tokens."""
    fmt = literal_string(ctx, 0, "format")
    if fmt is None:
        return False
    tokens, code = format_tokens(fmt)
    if tokens is None:
        ctx.fail("unsupported", MESSAGES.format_code(code or ""), arg=0)
        return False
    ctx.rewrite_arg(0, jq_node("literal", _encode_tokens(tokens)))
    return True


def date_input(ctx: CallContext, then_type: EastType) -> Result:
    """A DateTime input, or a number of epoch seconds as jq's date builtins take."""
    return on_input(ctx, "a DateTime or epoch seconds",
                    lambda t, _m: one(then_type) if t.type == "DateTime" or is_number(t) else None)


def math_rule(output: str) -> Typing:
    """The typing of a builtin on numbers, promoting Integer to Float."""
    def typing(ctx: CallContext) -> Result:
        def rule(t: EastType, _m: TypeShape) -> Result | None:
            if not is_number(t):
                return None
            if output == "same":
                return one(t)
            if output == "Integer":
                return one(IntegerType)
            return one(FloatType)
        return on_input(ctx, "a number", rule)
    return typing


def math2(ctx: CallContext) -> Result:
    """The typing of a builtin of two number arguments."""
    a = arg_of(ctx, 0, "a number", is_number)
    b = arg_of(ctx, 1, "a number", is_number)
    if a is None or b is None:
        return _error()
    return one(FloatType, then(a.result.mult, b.result.mult))


def selector(keep: Callable[[EastType], str]) -> Typing:
    """A type selector: each member is kept, dropped, or kept when present."""
    def typing(ctx: CallContext) -> Result:
        def each(member: TypeShape) -> Result:
            t = unwrap(member.type)
            payload = nullable_payload(t)
            if payload is not None:
                inner = keep(unwrap(payload))
                null_kept = keep(NullType)
                if inner == "drop" and null_kept == "drop":
                    return Result(typed(NeverType), ZERO)
                if inner == "drop":
                    return Result(typed(NullType), MAYBE)
                if null_kept == "drop":
                    return Result(typed(payload), MAYBE)
                return Result(member, ONE)
            k = keep(t)
            if k == "drop":
                return Result(typed(NeverType), ZERO)
            return Result(member, ONE if k == "keep" else MAYBE)
        return per_member(ctx, ctx.input, each)
    return typing


def is_scalar(t: EastType) -> bool:
    """Whether a type is a jq scalar: not an array, set, dict, struct, vector or matrix."""
    u = unwrap(t)
    payload = nullable_payload(u)
    if payload is not None:
        return is_scalar(payload)
    return u.type not in ("Array", "Set", "Dict", "Struct", "Vector", "Matrix") and u.type != "Variant"


def each_element(ctx: CallContext, i: int, expected: str, on_each: Callable[[Result, Result], Result | None],
                 arrays_only: bool = False) -> Result:
    """Runs a filter argument on each element of the input."""
    def each(member: TypeShape) -> Result:
        element = elements(member) if arrays_only else values_of(member)
        if element is None:
            return input_mismatch(ctx, expected, member.type)
        per = ctx.arg(i, element)
        if per.shape.kind == "error":
            return _error()
        out = on_each(element, per)
        return out if out is not None else _error()
    return per_member(ctx, ctx.input, each)


def array_of(ctx: CallContext, per: Result) -> Result | None:
    """An array of a result's outputs, carrying their facts."""
    t = ctx.collect(per)
    if t is None:
        return None
    facts = Facts("elements", element=per.shape.facts) \
        if isinstance(per.shape, TypeShape) and per.shape.facts is not None else None
    return Result(typed(ArrayType(t), facts), ONE)


def settle(ctx: CallContext, argument: int, start: EastType) -> EastType | None:
    """A filter that repeats: the one type its input and outputs settle on, by fixpoint."""
    t = start
    for _round in range(8):
        out = ctx.arg(argument, one(t))
        if out.shape.kind == "error":
            return None
        nxt = ctx.collect(out, argument)
        if nxt is None:
            return None
        merged = unify(t, nxt)
        if merged is None:
            ctx.fail("cannot_infer", MESSAGES.accumulator(ctx.name, describe_type(t), describe_type(nxt)))
            return None
        if type_equal(merged, t):
            return t
        t = merged
    ctx.fail("cannot_infer", MESSAGES.accumulator(ctx.name, describe_type(start), describe_type(t)))
    return None


def flattened(t: EastType, depth: int) -> EastType:
    """The type of ``.[]`` taken ``depth`` times on arrays, for flatten."""
    u = unwrap(t)
    if depth == 0 or u.type != "Array":
        return t
    inner = unwrap(u.value)
    if inner.type != "Array":
        return t
    return flattened(ArrayType(inner.value), depth - 1)


def without_fields(t: EastType, names: list[str]) -> EastType:
    """A struct without some fields."""
    u = unwrap(t)
    if u.type != "Struct":
        return t
    return StructType([(name, f) for name, f in fields_of(u).items() if name not in names])


@dataclass(frozen=True)
class DelStep:
    """A step of a path ``del`` deletes at: a field, an index or key, a slice, ``.[]``, or ``select``."""

    kind: str
    name: str | None = None
    node: JqNode | None = None
    path: str | None = None


def del_paths(n: JqNode, path: str) -> list[list[DelStep]] | None:
    """The paths ``del``'s argument names, each as its steps from ``.``."""
    def at(step: str) -> str:
        return step if path == "" else f"{path}.{step}"

    def extend(target: JqNode, step: str, last: DelStep) -> list[list[DelStep]] | None:
        inner = del_paths(target, at(step))
        return None if inner is None else [[*steps, last] for steps in inner]

    kind = n.type
    v = n.value
    if kind == "identity":
        return [[]]
    if kind == "comma":
        left = del_paths(v["left"], at("comma.left"))
        right = del_paths(v["right"], at("comma.right"))
        return None if left is None or right is None else [*left, *right]
    if kind == "pipe":
        left = del_paths(v["left"], at("pipe.left"))
        right = del_paths(v["right"], at("pipe.right"))
        return None if left is None or right is None else [[*lsteps, *rsteps] for lsteps in left for rsteps in right]
    if kind == "field":
        return extend(v["target"], "field.target", DelStep("field", name=v["name"]))
    if kind == "index":
        return extend(v["target"], "index.target", DelStep("index", node=v["index"], path=at("index.index")))
    if kind == "slice":
        return extend(v["target"], "slice.target", DelStep("slice", path=path))
    if kind == "iterate":
        return extend(v["target"], "iterate.target", DelStep("iterate"))
    if kind == "call":
        if v["name"] == "select" and len(v["args"]) == 1:
            return [[DelStep("select", path=at("call.args[0]"))]]
        if v["name"] == "empty" and len(v["args"]) == 0:
            return []
        return None
    return None


def _deletes_element(rest: list[DelStep]) -> bool:
    """Whether a step's remaining steps delete the element itself: none left, or only a ``select``."""
    return len(rest) == 0 or (len(rest) == 1 and rest[0].kind == "select")


def _after_delete(ctx: CallContext, type_: EastType, steps: list[DelStep]) -> EastType | None:  # noqa: C901
    """The type a value has after ``del`` deletes at a path."""
    if len(steps) == 0:
        return NullType
    t = unwrap(type_)
    if t.type == "Null":
        return NullType
    payload = nullable_payload(t)
    if payload is not None:
        inner = _after_delete(ctx, payload, steps)
        return None if inner is None else or_null(inner)
    step, rest = steps[0], steps[1:]

    def same(element: EastType) -> bool:
        if _deletes_element(rest):
            return True
        inner = _after_delete(ctx, element, rest)
        return inner is not None and type_equal(inner, element)

    literal_name = ctx.literal_of(step.node) if step.kind == "index" and step.node.type == "literal" else None
    name = step.name if step.kind == "field" else (
        literal_name.value if literal_name is not None and literal_name.type.type == "String" and t.type != "Dict"
        else None)
    if name is not None:
        if t.type == "Struct":
            fields = fields_of(t)
            if name not in fields:
                return t
            if _deletes_element(rest):
                if len(rest) == 0:
                    return without_fields(t, [name])
                return t if same(fields[name]) else None
            inner = _after_delete(ctx, fields[name], rest)
            if inner is None:
                return None
            return StructType([(n, inner if n == name else f) for n, f in fields.items()])
        if t.type == "Dict":
            return t if same(dict_value(t)) else None
        return None
    if step.kind in ("index", "slice"):
        if t.type == "Dict":
            return t if same(dict_value(t)) else None
        if t.type == "Array":
            return t if same(t.value) else None
        if t.type == "String" and step.kind == "slice" and len(rest) == 0:
            return t
        return None
    if step.kind == "iterate":
        if t.type in ("Array", "Dict"):
            element = t.value if t.type == "Array" else dict_value(t)
            if _deletes_element(rest):
                return t
            inner = _after_delete(ctx, element, rest)
            if inner is None:
                return None
            return ArrayType(inner) if t.type == "Array" else DictType(dict_key(t), inner)
        if t.type == "Struct":
            if _deletes_element(rest):
                return StructType([]) if len(rest) == 0 else None
            new_fields: list[tuple[str, EastType]] = []
            for field_name, f in fields_of(t).items():
                inner = _after_delete(ctx, f, rest)
                if inner is None:
                    return None
                new_fields.append((field_name, inner))
            return StructType(new_fields)
        return None
    if step.kind == "select":
        # The value is deleted (it becomes null) where the condition holds, or
        # what follows is; its type stays only when that leaves it as it was.
        if len(rest) == 0:
            return or_null(t)
        return t if same(t) else None
    return None


# ─── The catalog ─────────────────────────────────────────────────────────

_TYPINGS: dict[str, Typing] = {}


def _supported(name: str, typing: Typing) -> None:
    _TYPINGS[name] = typing


def _t_empty(_ctx: CallContext) -> Result:
    return Result(typed(NeverType), ZERO)


def _t_error(ctx: CallContext) -> Result:
    if len(ctx.args) == 1:
        message = ctx.arg(0)
        if message.shape.kind == "error":
            return _error()
    return Result(typed(NeverType), ZERO)


def _t_select(ctx: CallContext) -> Result:
    condition = ctx.arg(0)
    if condition.shape.kind == "error":
        return _error()
    if condition.mult.hi == 2:
        _duplicate_outputs(ctx)
    narrowed = ctx.narrow(ctx.input, condition.proves) if condition.proves is not None else ctx.input
    return Result(narrowed.shape, Mult(0, condition.mult.hi), access=(), stream=ctx.input.stream)


def _duplicate_outputs(ctx: CallContext) -> None:
    """The ``duplicate_outputs`` lint: ``select(f)`` where ``f`` gives many values."""
    arg_path = ctx.arg_paths[0]
    arg_range = ctx.arg_range(0)

    def many(path: str) -> bool:
        r = ctx.result_at(path)
        return r is not None and r.mult.hi == 2

    generator = None
    rest: str | None = None
    arg = ctx.args[0]
    if arg.type == "pipe" and many(f"{arg_path}.pipe.left"):
        generator = ctx.range_at(f"{arg_path}.pipe.left")
        right = ctx.range_at(f"{arg_path}.pipe.right")
        rest = None if right is None else ctx.slice(right.from_, right.to)
    else:
        # The first `[]` on the condition's leftmost path of reads and operators.
        n = arg
        path = arg_path
        while True:
            if n.type == "iterate" and many(path):
                generator = ctx.range_at(path)
                break
            if n.type == "binary":
                n = n.value["left"]
                path = f"{path}.binary.left"
                continue
            if n.type in ("field", "index", "slice", "iterate"):
                path = f"{path}.{n.type}.target"
                n = n.value["target"]
                continue
            break
        if generator is not None and arg_range is not None and generator.from_ == arg_range.from_:
            after = ctx.slice(generator.to, arg_range.to)
            rest = f"{'' if after.startswith('.') else '.'}{after}"
    if generator is None or rest is None or arg_range is None:
        ctx.warn("duplicate_outputs", MESSAGES.duplicate_outputs(ctx.source(0)))
        return
    text = ctx.slice(generator.from_, generator.to)
    ctx.warn("duplicate_outputs", MESSAGES.duplicate_outputs(text), [
        edit(f"Use any({text}; …)", arg_range.from_, arg_range.to, f"any({text}; {js_trim(rest)})"),
    ])


# JavaScript's WhiteSpace and LineTerminator: what `String.prototype.trim` removes.
_JS_SPACE = "\t\n\v\f\r              " \
    "    　﻿"


def js_trim(text: str) -> str:
    """``String.prototype.trim``: JavaScript's whitespace and line terminators, from both ends."""
    return text.strip(_JS_SPACE)


def _first_last(ctx: CallContext) -> Result:
    if len(ctx.args) == 1:
        f = ctx.arg(0)
        return Result(f.shape, Mult(f.mult.lo, 0 if f.mult.hi == 0 else 1))

    def rule(t: EastType, _m: TypeShape) -> Result | None:
        if t.type == "Null":
            return one(NullType)
        e = element_of(t)
        r = None if e is None else or_null(e)
        return None if r is None else one(r)
    return on_input(ctx, "an array", rule)


def _t_nth(ctx: CallContext) -> Result:
    n = arg_of(ctx, 0, "an Integer", lambda t: t.type == "Integer")
    if n is None:
        return _error()
    if len(ctx.args) == 2:
        f = ctx.arg(1)
        return Result(f.shape, Mult(0, 0 if f.mult.hi == 0 else 1))

    def rule(t: EastType, _m: TypeShape) -> Result | None:
        e = element_of(t)
        r = None if e is None else or_null(e)
        return None if r is None else one(r, n.result.mult)
    return on_input(ctx, "an array", rule)


def _limit_skip(ctx: CallContext) -> Result:
    n = arg_of(ctx, 0, "an Integer", lambda t: t.type == "Integer")
    f = ctx.arg(1)
    if n is None or f.shape.kind == "error":
        return _error()
    return Result(f.shape, Mult(0, f.mult.hi))


def _t_isempty(ctx: CallContext) -> Result:
    f = ctx.arg(0)
    return _error() if f.shape.kind == "error" else one(BooleanType)


def _js_ceil(x: float) -> float:
    return float(math.ceil(x)) if math.isfinite(x) else x


def _js_max0(x: float) -> float:
    return x if math.isnan(x) else max(0.0, x)


def _locale_count(count: float) -> str:
    """``count.toLocaleString("en-US")`` with its commas as spaces."""
    if math.isinf(count):
        return "∞" if count > 0 else "-∞"
    return f"{int(count):,}".replace(",", " ")


def _t_range(ctx: CallContext) -> Result:
    args = [arg_of(ctx, i, "a number", is_number) for i in range(len(ctx.args))]
    if any(a is None for a in args):
        return _error()
    is_float = any(unwrap(a.type).type == "Float" for a in args if a is not None)
    literals = [ctx.literal(i) for i in range(len(ctx.args))]
    if all(lit is not None and is_number(lit.type) for lit in literals):
        nums = [float(lit.value) for lit in literals if lit is not None]
        if len(nums) == 1:
            start, upto, by = 0.0, nums[0], 1.0
        elif len(nums) == 2:
            start, upto, by = nums[0], nums[1], 1.0
        else:
            start, upto, by = nums[0], nums[1], nums[2]
        if by > 0:
            count = _js_max0(_js_ceil((upto - start) / by))
        elif by < 0:
            count = _js_max0(_js_ceil((start - upto) / -by))
        else:
            count = 0.0
        if count == 0:
            return ctx.fail("type_mismatch", MESSAGES.empty_range(ctx.source()))
        if count > 1000:
            ctx.warn("long_range", MESSAGES.long_range(ctx.source(), _locale_count(count)))
    mult = ONE
    for a in args:
        if a is not None:
            mult = then(mult, a.result.mult)
    return Result(typed(FloatType if is_float else IntegerType), then(mult, MANY))


def _t_recurse(ctx: CallContext) -> Result:
    if len(ctx.args) == 0:
        # `recurse` is `..`: jq defines both as `recurse(.[]?)`.
        if ctx.refuse_root():
            return _error()
        if ctx.input.shape.kind == "error":
            return _error()
        return Result(union([Member(typed(t), None) for t in descend_types(_types_of(ctx.input))]), MANY)
    start = ctx.collect(ctx.input)
    if start is None:
        return _error()
    t = settle(ctx, 0, start)
    if t is None:
        return _error()
    if len(ctx.args) == 2:
        cond = ctx.arg(1, one(t))
        if cond.shape.kind == "error":
            return _error()
    return Result(typed(t), Mult(1, 2))


def _t_until(ctx: CallContext) -> Result:
    start = ctx.collect(ctx.input)
    if start is None:
        return _error()
    t = settle(ctx, 1, start)
    if t is None:
        return _error()
    cond = ctx.arg(0, one(t))
    if cond.shape.kind == "error":
        return _error()
    return one(t)


def _t_while(ctx: CallContext) -> Result:
    start = ctx.collect(ctx.input)
    if start is None:
        return _error()
    t = settle(ctx, 1, start)
    if t is None:
        return _error()
    cond = ctx.arg(0, one(t))
    if cond.shape.kind == "error":
        return _error()
    return Result(typed(t), MANY)


def _t_repeat(ctx: CallContext) -> Result:
    start = ctx.collect(ctx.input)
    if start is None:
        return _error()
    t = settle(ctx, 0, start)
    if t is None:
        return _error()
    return Result(typed(t), MANY)


def _t_combinations(ctx: CallContext) -> Result:
    if len(ctx.args) == 1:
        n = arg_of(ctx, 0, "an Integer", lambda t: t.type == "Integer")
        if n is None:
            return _error()
        return on_input(ctx, "an array", lambda t, _m: Result(typed(t), MANY) if t.type == "Array" else None)

    def rule(t: EastType, _m: TypeShape) -> Result | None:
        if t.type != "Array":
            return None
        inner = unwrap(t.value)
        return Result(typed(inner), MANY) if inner.type == "Array" else None
    return on_input(ctx, "an array of arrays", rule)


def _t_walk(ctx: CallContext) -> Result:
    if ctx.refuse_root():
        return _error()
    start = ctx.collect(ctx.input)
    if start is None:
        return _error()
    memo: dict[int, tuple[EastType, EastType | None]] = {}

    def rebuild_parts(t: EastType) -> EastType | None:
        """A value's parts, each walked: an option's value's, an array's elements, a dict's values, a struct's
        fields and a variant's payload (not its case's name, which is its type)."""
        u = unwrap(t)
        payload = nullable_payload(u)
        if payload is not None:
            p = rebuild_type(payload)
            if p is None:
                return None
            option = or_null(p)
            return OptionType(p) if option is None else option
        if u.type == "Array":
            e = walk_type(u.value)
            return None if e is None else ArrayType(e)
        if u.type == "Dict":
            v = walk_type(dict_value(u))
            return None if v is None else DictType(dict_key(u), v)
        if u.type == "Struct":
            fields: list[tuple[str, EastType]] = []
            for name, f in fields_of(u).items():
                w = walk_type(f)
                if w is None:
                    return None
                fields.append((name, w))
            return StructType(fields)
        if u.type == "Variant":
            cases: list[tuple[str, EastType]] = []
            for name, c in cases_of_type(u).items():
                w = walk_type(c)
                if w is None:
                    return None
                cases.append((name, w))
            return VariantType(cases)
        return t

    def rebuild_type(t: EastType) -> EastType | None:
        """A value's type rebuilt: a recursive value rebuilt as its node keeps its recursive type."""
        rebuilt = rebuild_parts(t)
        return t if rebuilt is not None and t.type == "Recursive" and type_equal(node_of(t), rebuilt) else rebuilt

    def walk_type(t: EastType) -> EastType | None:
        # A Never has no value to walk: an empty collection's elements.
        if t.type == "Never":
            return t
        hit = memo.get(id(t))
        if hit is not None and hit[0] is t:
            return hit[1]
        memo[id(t)] = (t, t)
        rebuilt = t if t.type == "Recursive" else rebuild_type(t)
        if rebuilt is None:
            return None
        out = ctx.arg(0, one(rebuilt))
        if out.shape.kind == "error":
            return None
        if out.mult.lo != 1 or out.mult.hi != 1:
            ctx.fail("unsupported", MESSAGES.unavailable("walk(f)", "f must give one output for each value"))
            return None
        result = ctx.collect(out)
        if result is None:
            return None
        if t.type == "Recursive" and not type_equal(result, t):
            ctx.fail("cannot_infer", MESSAGES.accumulator("walk", describe_type(t), describe_type(result)))
            return None
        memo[id(t)] = (t, result)
        return result

    t = walk_type(start)
    return _error() if t is None else one(t)


def _t_in_upper(ctx: CallContext) -> Result:
    parts = [ctx.arg(i) for i in range(len(ctx.args))]
    if any(p.shape.kind == "error" for p in parts):
        return _error()
    return one(BooleanType)


def _t_index_upper(ctx: CallContext) -> Result:
    if len(ctx.args) == 2:
        rows = ctx.arg(0)
    else:
        r = per_member(ctx, ctx.input, lambda member: _values_or_mismatch(ctx, member))
        rows = replace(r, mult=MANY)
    if rows.shape.kind == "error":
        return _error()
    row = ctx.collect(rows)
    if row is None:
        return _error()
    key = arg_of(ctx, len(ctx.args) - 1, "an immutable value", is_immutable_type, one(row))
    if key is None:
        return _error()
    return one(DictType(key.type, row))


def _values_or_mismatch(ctx: CallContext, member: TypeShape) -> Result:
    """The values ``.[]`` gives on a member, or the diagnostic for one that has none."""
    values = values_of(member)
    return input_mismatch(ctx, "an array", member.type) if values is None else values


def _t_del(ctx: CallContext) -> Result:
    paths = del_paths(ctx.args[0], ctx.arg_paths[0])
    if paths is None:
        return ctx.fail("unsupported", MESSAGES.unavailable(
            f"del({ctx.source(0)})", "del takes field reads, indexes, slices, .[], select and ,"), arg=0)
    # The path reads what it deletes, so it is checked as a read first.
    read = ctx.arg(0)
    if read.shape.kind == "error":
        return _error()

    def each(member: TypeShape) -> Result:
        t: EastType = member.type
        for steps in paths:
            nxt = _after_delete(ctx, t, steps)
            if nxt is None:
                return ctx.fail("ambiguous_output", MESSAGES.mixed_delete(f"del({ctx.source(0)})"), arg=0)
            t = nxt
        return one(t)
    return per_member(ctx, ctx.input, each)


def _struct_values(ctx: CallContext, t: EastType) -> EastType | Result:
    """The one type a struct's fields share, or the reported problem."""
    value: EastType = NeverType
    for f in fields_of(t).values():
        nxt = unify(value, f)
        if nxt is None:
            return ctx.fail("ambiguous_output", MESSAGES.no_common_type(describe_type(value), describe_type(f)))
        value = nxt
    return value


def _t_to_entries(ctx: CallContext) -> Result:
    if ctx.refuse_root():
        return _error()

    def rule(t: EastType, _m: TypeShape) -> Result | None:
        if t.type == "Dict":
            return one(ArrayType(StructType([("key", dict_key(t)), ("value", dict_value(t))])))
        if t.type == "Struct":
            value = _struct_values(ctx, t)
            if isinstance(value, Result):
                return value
            return one(ArrayType(StructType([("key", StringType), ("value", value)])))
        e = element_of(t)
        return None if e is None else one(ArrayType(StructType([("key", IntegerType), ("value", e)])))
    return on_input(ctx, "a dict, a struct or an array", rule)


# The key and value fields a from_entries entry can have, as jq accepts them.
KEY_FIELDS = ("key", "k", "name", "Name", "K", "Key")
VALUE_FIELDS = ("value", "v", "Value", "V")


def _from_entries(ctx: CallContext, entries: Result) -> Result:
    def each(member: TypeShape) -> Result:
        t = unwrap(member.type)
        if t.type != "Array":
            return input_mismatch(ctx, "an array of {key, value}", member.type)
        entry = unwrap(t.value)
        if entry.type != "Struct":
            return input_mismatch(ctx, "an array of {key, value}", member.type)
        fields = fields_of(entry)
        key = next((k for k in KEY_FIELDS if k in fields), None)
        value = next((v for v in VALUE_FIELDS if v in fields), None)
        if key is None:
            return input_mismatch(ctx, "an array of {key, value}", member.type)
        key_type = fields[key]
        if not is_immutable_type(key_type):
            return ctx.fail("type_mismatch", MESSAGES.mutable_key(f".{key}", describe_type(key_type)))
        return one(DictType(key_type, NullType if value is None else fields[value]))
    return per_member(ctx, entries, each)


def _t_with_entries(ctx: CallContext) -> Result:
    if ctx.refuse_root():
        return _error()

    def rule(t: EastType, _m: TypeShape) -> Result | None:
        if t.type == "Dict":
            return one(StructType([("key", dict_key(t)), ("value", dict_value(t))]))
        if t.type == "Struct":
            value = _struct_values(ctx, t)
            if isinstance(value, Result):
                return value
            return one(StructType([("key", StringType), ("value", value)]))
        return None
    entries = on_input(ctx, "a dict or a struct", rule)
    if entries.shape.kind == "error":
        return entries
    mapped = ctx.arg(0, Result(entries.shape, ONE))
    t = ctx.collect(mapped)
    if t is None:
        return _error()
    return _from_entries(ctx, one(ArrayType(t)))


def _t_pick(ctx: CallContext) -> Result:
    n = ctx.args[0]
    fields: list[str] = []
    while n.type == "field":
        fields.insert(0, n.value["name"])
        n = n.value["target"]
    if n.type != "identity" or len(fields) == 0:
        return ctx.fail("unsupported", MESSAGES.unavailable("pick of this path", "pick takes field reads: pick(.a.b)"),
                        arg=0)

    def build(t: EastType, rest: list[str]) -> EastType | None:
        u = unwrap(t)
        # `null`'s fields are null, so picking from it builds the path, null at its end, as jq does.
        if u.type == "Null":
            return StructType([(rest[0], NullType if len(rest) == 1 else build(NullType, rest[1:]))])  # type: ignore[list-item]
        if u.type != "Struct" or rest[0] not in fields_of(u):
            return None
        inner = fields_of(u)[rest[0]]
        picked = inner if len(rest) == 1 else build(inner, rest[1:])
        return None if picked is None else StructType([(rest[0], picked)])

    def each(member: TypeShape) -> Result:
        out = build(member.type, fields)
        return input_mismatch(ctx, f"a struct with .{'.'.join(fields)}", member.type) if out is None else one(out)
    return per_member(ctx, ctx.input, each)


def _t_transpose(ctx: CallContext) -> Result:
    def rule(t: EastType, _m: TypeShape) -> Result | None:
        if t.type != "Array":
            return None
        row = unwrap(t.value)
        if row.type == "Never":
            return one(ArrayType(ArrayType(NeverType)))
        if row.type != "Array":
            return None
        cell = or_null(row.value)
        return None if cell is None else one(ArrayType(ArrayType(cell)))
    return on_input(ctx, "an array of arrays", rule)


def _t_length(ctx: CallContext) -> Result:
    def rule(t: EastType, _m: TypeShape) -> Result | None:
        payload = nullable_payload(t)
        u = t if payload is None else unwrap(payload)
        if u.type in ("Null", "String", "Array", "Set", "Dict", "Vector", "Matrix", "Struct", "Blob", "Integer"):
            return one(IntegerType)
        if u.type == "Float":
            return one(FloatType)
        if u.type == "Variant":
            return one(IntegerType)
        return None
    return on_input(ctx, "a value with a length", rule)


def _keys(ctx: CallContext, is_sorted: bool) -> Result:
    def rule(t: EastType, member: TypeShape) -> Result | None:
        if t.type == "Dict":
            return one(ArrayType(dict_key(t)))
        if t.type == "Struct":
            names = list(fields_of(t))
            if ctx.is_root(member):
                ordered = sorted(names, key=_compare_string) if is_sorted else names
                ctx.rewrite(jq_node("literal", _encode_strings(ordered)))
            return one(ArrayType(StringType))
        if t.type == "Variant" and nullable_payload(t) is None:
            return one(ArrayType(StringType))
        return None if element_of(t) is None else one(ArrayType(IntegerType))
    return on_input(ctx, "a dict, a struct or an array", rule)


def _t_has(ctx: CallContext) -> Result:
    key = ctx.arg(0)
    if key.shape.kind == "error":
        return _error()
    key_type = ctx.collect(key, 0)
    if key_type is None:
        return _error()

    def rule(t: EastType, member: TypeShape) -> Result | None:
        if t.type == "Dict":
            the_key = unwrap(dict_key(t))
            if type_equal(unwrap(key_type), the_key):
                return one(BooleanType, key.mult)
            # A literal written as the key type is: an ISO-8601 string for a DateTime, an Integer for a Float.
            coerced = coerce_argument(ctx, 0, the_key, "value")
            if coerced is _NOT_ISO:
                return _error()
            if coerced is not None:
                return one(BooleanType, key.mult)
            return ctx.fail("type_mismatch", MESSAGES.key_type(
                "has", describe_type(dict_key(t)), ctx.source(0), describe_type(key_type)), arg=0)
        if t.type == "Struct":
            if unwrap(key_type).type != "String":
                return ctx.fail("type_mismatch", MESSAGES.key_type(
                    "has", "String", ctx.source(0), describe_type(key_type)), arg=0)
            literal = ctx.literal(0)
            if ctx.is_root(member) and literal is not None:
                ctx.rewrite(jq_node("literal", _encode_boolean(literal.value in fields_of(t))))
            return one(BooleanType, key.mult)
        if element_of(t) is not None:
            if unwrap(key_type).type == "Integer":
                return one(BooleanType, key.mult)
            return ctx.fail("type_mismatch", MESSAGES.key_type(
                "has", "Integer", ctx.source(0), describe_type(key_type)), arg=0)
        return None
    return on_input(ctx, "a dict, a struct or an array", rule)


def _t_in(ctx: CallContext) -> Result:
    container = ctx.arg(0)
    if container.shape.kind == "error":
        return _error()
    key_type = ctx.collect(ctx.input)
    if key_type is None:
        return _error()
    key = unwrap(key_type)

    # The input is a key of the argument: of a dict's key type, a struct's field name, an array's index.
    def each(member: TypeShape) -> Result:
        t = unwrap(member.type)
        if t.type == "Dict":
            wanted: EastType | None = unwrap(dict_key(t))
        elif t.type == "Struct":
            wanted = StringType
        else:
            wanted = IntegerType if element_of(t) is not None else None
        if wanted is None:
            return ctx.fail("type_mismatch", MESSAGES.argument(
                "in", "first", "a dict, a struct or an array", describe_type(member.type)), arg=0)
        if type_equal(key, wanted) or (wanted.type == "Float" and key.type == "Integer"):
            return one(BooleanType, container.mult)
        return ctx.fail("type_mismatch", MESSAGES.key_type("in", describe_type(wanted), "its input", describe_type(key_type)))
    return per_member(ctx, container, each)


def _t_map(ctx: CallContext) -> Result:
    if ctx.refuse_root():
        return _error()
    return each_element(ctx, 0, "an array", lambda _element, per: array_of(ctx, per))


def _t_map_values(ctx: CallContext) -> Result:
    if ctx.refuse_root():
        return _error()

    def each(member: TypeShape) -> Result:
        t = unwrap(member.type)
        if t.type in ("Array", "Dict"):
            element = values_of(member)
            assert element is not None
            per = ctx.arg(0, element)
            v = ctx.collect(per)
            if v is None:
                return _error()
            return one(ArrayType(v) if t.type == "Array" else DictType(dict_key(t), v))
        if t.type == "Struct":
            fields: list[tuple[str, EastType]] = []
            for name, f in fields_of(t).items():
                per = ctx.arg(0, one(f))
                if per.shape.kind == "error":
                    return _error()
                if per.mult.lo != 1:
                    return ctx.fail("unsupported", MESSAGES.unavailable(
                        "map_values(f) on a struct", "f must give an output for every field, which a struct cannot lose"))
                v = ctx.collect(per)
                if v is None:
                    return _error()
                fields.append((name, v))
            return one(StructType(fields))
        return input_mismatch(ctx, "an array, a dict or a struct", member.type)
    return per_member(ctx, ctx.input, each)


def _t_add(ctx: CallContext) -> Result:
    if ctx.refuse_root():
        return _error()
    if len(ctx.args) == 1:
        values = ctx.arg(0)
    else:
        values = per_member(ctx, ctx.input, lambda member: _values_or_mismatch(ctx, member))
    if values.shape.kind == "error":
        return _error()
    t = ctx.collect(values)
    if t is None:
        return _error()
    if t.type == "Never":
        return one(NullType)
    added = add_type(t)
    if added is None:
        return ctx.mismatch("type_mismatch", MESSAGES.input(
            "add", "numbers, strings, arrays, structs or dicts", describe_type(t)))
    return one(added)


def _any_all(ctx: CallContext) -> Result:
    if len(ctx.args) == 2:
        gen = ctx.arg(0)
        if gen.shape.kind == "error":
            return _error()
        cond = ctx.arg(1, Result(gen.shape, ONE))
        return cond if cond.shape.kind == "error" else one(BooleanType)
    return _each_element_or_self(ctx)


def _each_element_or_self(ctx: CallContext) -> Result:
    def each(member: TypeShape) -> Result:
        element = values_of(member)
        if element is None:
            return input_mismatch(ctx, "an array", member.type)
        if len(ctx.args) == 1:
            cond = ctx.arg(0, element)
            if cond.shape.kind == "error":
                return cond
        return one(BooleanType)
    return per_member(ctx, ctx.input, each)


def _t_flatten(ctx: CallContext) -> Result:
    depth = 1000
    if len(ctx.args) == 1:
        d = literal_integer(ctx, 0, "depth")
        if d is None:
            return _error()
        depth = d
    return on_input(ctx, "an array", lambda t, _m: one(flattened(t, depth)) if t.type == "Array" else None)


def _t_sort(ctx: CallContext) -> Result:
    def rule(t: EastType, _m: TypeShape) -> Result | None:
        e = element_of(t)
        if e is None or t.type == "Matrix":
            return None
        return one(ArrayType(e)) if is_ordered(e) else None
    return on_input(ctx, "an array of ordered values", rule)


def _by_rule(output: str) -> Typing:
    def typing(ctx: CallContext) -> Result:
        def on_each(element: Result, per: Result) -> Result | None:
            key = ctx.collect(per, 0)
            if key is None:
                return None
            if not is_ordered(key):
                return ctx.fail("type_mismatch", MESSAGES.argument(
                    ctx.name, "first", "an ordered key", describe_type(key)), arg=0)
            e = element.shape.type if isinstance(element.shape, TypeShape) else NeverType
            facts = Facts("elements", element=element.shape.facts) \
                if isinstance(element.shape, TypeShape) and element.shape.facts is not None else None
            if output == "groups":
                return Result(typed(ArrayType(ArrayType(e)),
                                    Facts("elements", element=facts) if facts is not None else None), ONE)
            if output == "element":
                element_or_null = or_null(e)
                return one(e if element_or_null is None else element_or_null)
            return Result(typed(ArrayType(e), facts), ONE)
        return each_element(ctx, 0, "an array", on_each, True)
    return typing


def _t_unique(ctx: CallContext) -> Result:
    def rule(t: EastType, _m: TypeShape) -> Result | None:
        e = element_of(t)
        return one(ArrayType(e)) if e is not None and is_ordered(e) else None
    return on_input(ctx, "an array of ordered values", rule)


def _min_max(ctx: CallContext) -> Result:
    def rule(t: EastType, _m: TypeShape) -> Result | None:
        e = element_of(t)
        if e is None or not is_ordered(e):
            return None
        r = or_null(e)
        return None if r is None else one(r)
    return on_input(ctx, "an array of ordered values", rule)


def _t_reverse(ctx: CallContext) -> Result:
    def rule(t: EastType, _m: TypeShape) -> Result | None:
        if t.type == "String":
            return one(StringType)
        if t.type == "Null":
            return one(ArrayType(NeverType))
        e = element_of(t)
        return None if e is None else one(ArrayType(e))
    return on_input(ctx, "an array or a string", rule)


def _containment(ctx: CallContext) -> Result:
    """``contains`` and ``inside``: whether one value holds another, as jq's ``contains`` decides it."""
    other = ctx.arg(0)
    if other.shape.kind == "error":
        return _error()
    ot = ctx.collect(other, 0)
    if ot is None:
        return _error()

    def each(member: TypeShape) -> Result:
        def holds(arg: EastType) -> bool:
            return _containable(member.type, arg) if ctx.name == "contains" else _containable(arg, member.type)

        if holds(ot):
            return one(BooleanType, other.mult)
        # Literals written as the input's type is: ISO-8601 strings for DateTimes, alone or in an array.
        element = element_of(unwrap(member.type))
        coerced = coerce_argument(ctx, 0, element, "elements") \
            if element is not None and unwrap(ot).type == "Array" \
            else coerce_argument(ctx, 0, unwrap(member.type), "value")
        if coerced is _NOT_ISO:
            return _error()
        if coerced is not None and holds(coerced):
            return one(BooleanType, other.mult)
        # An input that can be null holds only null: skip the nulls.
        if nullable_payload(unwrap(member.type)) is not None:
            return input_mismatch(ctx, "a value", member.type)
        # jq raises for values whose containment it cannot check: in a lenient place, at run time.
        relation = "held in" if ctx.name == "contains" else "holding"
        return ctx.mismatch("type_mismatch", MESSAGES.argument(
            ctx.name, "first", f"a value {relation} {describe_type(member.type)}", describe_type(ot)), 0)
    return per_member(ctx, ctx.input, each)


def _containable(outer: EastType, inner: EastType) -> bool:
    """Whether values of type ``inner`` can be held in values of type ``outer``."""
    a = unwrap(outer)
    b = unwrap(inner)
    if b.type == "Never":
        return True
    if a.type == "String" and b.type == "String":
        return True
    # Arrays, sets, vectors and matrices are all arrays to jq.
    ea = element_of(a)
    eb = element_of(b)
    if ea is not None and eb is not None:
        return _containable(ea, eb)
    if a.type == "Struct" and b.type == "Struct":
        fields = fields_of(a)
        # A field the outer struct lacks is never held: the answer is false, not an error.
        return all(name not in fields or _containable(fields[name], f) for name, f in fields_of(b).items())
    if a.type == "Dict" and b.type == "Dict":
        return type_equal(unwrap(dict_key(a)), unwrap(dict_key(b))) and _containable(dict_value(a), dict_value(b))
    if a.type == "Dict" and b.type == "Struct" and len(b.value) == 0:
        return True
    return is_scalar(a) and is_scalar(b) and unify(a, b) is not None


def _index_rule(output: str) -> Typing:
    def typing(ctx: CallContext) -> Result:
        x = ctx.arg(0)
        if x.shape.kind == "error":
            return _error()
        xt = ctx.collect(x, 0)
        if xt is None:
            return _error()

        def found() -> Result:
            return one(ArrayType(IntegerType) if output == "all" else or_null(IntegerType), x.mult)  # type: ignore[arg-type]

        def rule(t: EastType, _m: TypeShape) -> Result | None:
            u = unwrap(xt)
            if t.type == "String":
                return found() if u.type == "String" else ctx.fail("type_mismatch", MESSAGES.argument(
                    ctx.name, "first", "a string", describe_type(xt)), arg=0)
            element = element_of(t)
            if element is None:
                return None

            # An element, or an array: a run of elements.
            def fits(given: EastType) -> bool:
                g = unwrap(given)
                wanted = g.value if g.type == "Array" else given
                return wanted.type == "Never" or unify(element, wanted) is not None

            if fits(xt):
                return found()
            # Literals written as the elements' type is: an ISO-8601 string for a DateTime, alone or in an array.
            coerced = coerce_argument(ctx, 0, element, "elements" if u.type == "Array" else "value")
            if coerced is _NOT_ISO:
                return _error()
            if coerced is not None and fits(coerced):
                return found()
            # An array that is itself an element: jq reads an array as a run of elements.
            if u.type == "Array" and unify(element, u) is not None:
                return ctx.fail("type_mismatch", MESSAGES.run_argument(
                    ctx.name, describe_type(element), describe_type(u.value), f"{ctx.name}([{ctx.source(0)}])"), arg=0)
            return ctx.fail("type_mismatch", MESSAGES.argument(
                ctx.name, "first", f"{describe_type(element)}, or an array of it", describe_type(xt)), arg=0)
        return on_input(ctx, "a string or an array", rule)
    return typing


def _t_bsearch(ctx: CallContext) -> Result:
    x = ctx.arg(0)
    if x.shape.kind == "error":
        return _error()

    def rule(t: EastType, _m: TypeShape) -> Result | None:
        e = element_of(t)
        xt = ctx.collect(x, 0)
        if e is None or xt is None:
            return None
        if unify(e, xt) is not None:
            return one(IntegerType, x.mult)
        # A literal written as the elements' type is: an ISO-8601 string for a DateTime.
        coerced = coerce_argument(ctx, 0, e, "value")
        if coerced is _NOT_ISO:
            return _error()
        if coerced is not None and unify(e, coerced) is not None:
            return one(IntegerType, x.mult)
        return ctx.fail("type_mismatch", MESSAGES.argument(
            "bsearch", "first", describe_type(e), describe_type(xt)), arg=0)
    return on_input(ctx, "a sorted array", rule)


def _t_join(ctx: CallContext) -> Result:
    sep = arg_of(ctx, 0, "a string", lambda t: t.type == "String")
    if sep is None:
        return _error()

    def rule(t: EastType, _m: TypeShape) -> Result | None:
        e = element_of(t)
        if e is None:
            return None
        payload = nullable_payload(unwrap(e))
        u = unwrap(e if payload is None else payload)
        return one(StringType, sep.result.mult) if u.type in ("String", "Integer", "Float", "Boolean", "Null") else None
    return on_input(ctx, "an array of strings, numbers, booleans or nulls", rule)


def _t_type(_ctx: CallContext) -> Result:
    return Result(typed(StringType), ONE, type_of=())


def _data_value(ctx: CallContext) -> Result:
    if ctx.refuse_root():
        return _error()
    return on_input(ctx, "a data value",
                    lambda t, _m: None if t.type in ("Function", "AsyncFunction") else one(StringType))


def _t_tonumber(ctx: CallContext) -> Result:
    def rule(t: EastType, _m: TypeShape) -> Result | None:
        if is_number(t):
            return one(t)
        return one(FloatType) if t.type == "String" else None
    return on_input(ctx, "a string or a number", rule)


def _t_abs(ctx: CallContext) -> Result:
    def rule(t: EastType, _m: TypeShape) -> Result | None:
        if t.type in ("Null", "Boolean") or nullable_payload(t) is not None:
            return None
        return one(t)
    return on_input(ctx, "a number, or a value above every number", rule)


def _affix(output: EastType) -> Typing:
    def typing(ctx: CallContext) -> Result:
        s = arg_of(ctx, 0, "a string", lambda t: t.type == "String")
        if s is None:
            return _error()
        return on_input(ctx, "a string", lambda t, _m: one(output, s.result.mult) if t.type == "String" else None)
    return typing


def _on_string(output: EastType) -> Typing:
    def typing(ctx: CallContext) -> Result:
        return on_input(ctx, "a string", lambda t, _m: one(output) if t.type == "String" else None)
    return typing


def _t_split(ctx: CallContext) -> Result:
    if len(ctx.args) == 2:
        return ctx.fail("unsupported", MESSAGES.unavailable("split(re; flags)", "East regular expressions have no regex split"))
    sep = arg_of(ctx, 0, "a string", lambda t: t.type == "String")
    if sep is None:
        return _error()
    return on_input(ctx, "a string",
                    lambda t, _m: one(ArrayType(StringType), sep.result.mult) if t.type == "String" else None)


def _t_test(ctx: CallContext) -> Result:
    flags = check_flags(ctx, 1 if len(ctx.args) == 2 else None)
    if flags is None or check_regex(ctx, 0, flags) is None:
        return _error()
    return on_input(ctx, "a string", lambda t, _m: one(BooleanType) if t.type == "String" else None)


def _sub_rule(name: str) -> Typing:
    def typing(ctx: CallContext) -> Result:
        flags = check_flags(ctx, 2 if len(ctx.args) == 3 else None)
        if flags is None:
            return _error()
        groups = check_regex(ctx, 0, flags)
        if groups is None:
            return _error()
        replacement = ctx.args[1]

        def capture(n: JqNode) -> bool:
            return (n.type == "field" and n.value["target"].type == "identity" and n.value["name"] in groups) \
                or n.type == "variable"

        literal = ctx.literal(1)
        ok = (replacement.type == "literal" and literal is not None and literal.type.type == "String") \
            or capture(replacement) \
            or (replacement.type == "string" and all(part.type == "text" or capture(part.value)
                                                     for part in replacement.value))
        if not ok:
            return ctx.fail("type_mismatch", MESSAGES.replacement(name), arg=1)
        # The replacement reads the named groups: check it on them, as strings.
        r = ctx.arg(1, one(StructType([(g, StringType) for g in dict.fromkeys(groups)])))
        if r.shape.kind == "error":
            return r
        return on_input(ctx, "a string", lambda t, _m: one(StringType) if t.type == "String" else None)
    return typing


def _t_format(ctx: CallContext) -> Result:
    name = literal_string(ctx, 0, "format name")
    if name is None:
        return _error()
    fmt = BUILTINS.get(f"@{name}")
    if fmt is None or fmt.status != "supported":
        return ctx.fail("unsupported", MESSAGES.unavailable(
            f'format("{name}")', "it is not a format a query can use"), arg=0)
    assert fmt.typing is not None
    return fmt.typing(ctx)


def _any_data(ctx: CallContext) -> Result:
    return on_input(ctx, "a data value", lambda _t, _m: one(StringType))


def _cells(ctx: CallContext) -> Result:
    def rule(t: EastType, _m: TypeShape) -> Result | None:
        e = element_of(t)
        return one(StringType) if e is not None and is_scalar(e) else None
    return on_input(ctx, "an array of scalars", rule)


def _t_sh(ctx: CallContext) -> Result:
    def rule(t: EastType, _m: TypeShape) -> Result | None:
        if is_scalar(t):
            return one(StringType)
        e = element_of(t)
        return one(StringType) if e is not None and is_scalar(e) else None
    return on_input(ctx, "a string or an array of scalars", rule)


def _date_parts(ctx: CallContext) -> Result:
    return on_input(ctx, "a DateTime", lambda t, _m: one(IntegerType) if t.type == "DateTime" else None)


UNITS = ("millisecond", "second", "minute", "hour", "day", "week")


def _unit(ctx: CallContext, i: int) -> bool:
    u = literal_string(ctx, i, "unit")
    if u is None:
        return False
    if u not in UNITS:
        ctx.fail("type_mismatch", MESSAGES.argument(ctx.name, ordinal(i), f"one of {', '.join(UNITS)}", json_string(u)),
                 arg=i)
        return False
    return True


def _t_datetime_add(ctx: CallContext) -> Result:
    n = arg_of(ctx, 0, "an Integer", lambda t: t.type == "Integer")
    if n is None or not _unit(ctx, 1):
        return _error()
    return on_input(ctx, "a DateTime", lambda t, _m: one(DateTimeType, n.result.mult) if t.type == "DateTime" else None)


def _t_datetime_diff(ctx: CallContext) -> Result:
    other = arg_of(ctx, 0, "a DateTime", lambda t: t.type == "DateTime", None, DateTimeType)
    if other is None or not _unit(ctx, 1):
        return _error()
    return on_input(ctx, "a DateTime",
                    lambda t, _m: one(IntegerType, other.result.mult) if t.type == "DateTime" else None)


def _t_call(ctx: CallContext) -> Result:
    f = ctx.arg(0)
    if f.shape.kind == "error":
        return _error()
    ft = ctx.collect(f, 0)
    if ft is None:
        return _error()
    fn = unwrap(ft)
    if fn.type == "AsyncFunction":
        return ctx.fail("unsupported", MESSAGES.async_call(), arg=0)
    if fn.type != "Function":
        return ctx.fail("type_mismatch", MESSAGES.input("call", "a function value", describe_type(ft)), arg=0)
    inputs = list(fn.value["inputs"])
    if len(inputs) != len(ctx.args) - 1:
        return ctx.fail("arity", MESSAGES.arity("the function value", [len(inputs)], len(ctx.args) - 1))
    mult = f.mult
    for i in range(1, len(ctx.args)):
        want = inputs[i - 1]
        a = ctx.arg(i)
        if a.shape.kind == "error":
            return _error()
        got = ctx.collect(a, i)
        if got is None:
            return _error()
        fits = type_equal(unwrap(got), unwrap(want)) \
            or (unwrap(want).type == "Float" and unwrap(got).type == "Integer") \
            or _call_struct_fits(got, want)
        if not fits:
            return ctx.fail("type_mismatch", MESSAGES.argument(
                "call", ordinal(i), describe_type(want), describe_type(got)), arg=i)
        mult = then(mult, a.mult)
    return one(fn.value["output"], mult)


def _call_struct_fits(got: EastType, want: EastType) -> bool:
    """A struct argument fits a struct input field by field, with Integer → Float."""
    g = unwrap(got)
    w = unwrap(want)
    if g.type != "Struct" or w.type != "Struct":
        return False
    gf = fields_of(g)
    wf = fields_of(w)
    if len(wf) != len(gf) or not all(n in gf for n in wf):
        return False
    return all(
        type_equal(unwrap(gf[n]), unwrap(wf[n]))
        or (unwrap(wf[n]).type == "Float" and unwrap(gf[n]).type == "Integer")
        or _call_struct_fits(gf[n], wf[n])
        for n in wf
    )


def _tooling(output: EastType) -> Typing:
    def typing(ctx: CallContext) -> Result:
        return on_input(ctx, "a function value",
                        lambda t, _m: one(output) if t.type in ("Function", "AsyncFunction") else None)
    return typing


# Selection and streams.
_supported("empty", _t_empty)
_supported("error", _t_error)
_supported("not", lambda _ctx: one(BooleanType))
_supported("select", _t_select)
_supported("first", _first_last)
_supported("last", _first_last)
_supported("nth", _t_nth)
_supported("limit", _limit_skip)
_supported("skip", _limit_skip)
_supported("isempty", _t_isempty)
_supported("range", _t_range)
_supported("recurse", _t_recurse)
_supported("until", _t_until)
_supported("while", _t_while)
_supported("repeat", _t_repeat)
_supported("combinations", _t_combinations)
_supported("walk", _t_walk)
_supported("IN", _t_in_upper)
_supported("INDEX", _t_index_upper)
_supported("del", _t_del)
_supported("to_entries", _t_to_entries)
_supported("from_entries", lambda ctx: _from_entries(ctx, ctx.input))
_supported("with_entries", _t_with_entries)
_supported("pick", _t_pick)
_supported("transpose", _t_transpose)
# Collections.
_supported("length", _t_length)
_supported("utf8bytelength", _on_string(IntegerType))
_supported("keys", lambda ctx: _keys(ctx, True))
_supported("keys_unsorted", lambda ctx: _keys(ctx, False))
_supported("has", _t_has)
_supported("in", _t_in)
_supported("map", _t_map)
_supported("map_values", _t_map_values)
_supported("add", _t_add)
_supported("any", _any_all)
_supported("all", _any_all)
_supported("flatten", _t_flatten)
_supported("sort", _t_sort)
for _name, _output in (("sort_by", "array"), ("group_by", "groups"), ("unique_by", "array"), ("min_by", "element"),
                       ("max_by", "element")):
    _supported(_name, _by_rule(_output))
_supported("unique", _t_unique)
_supported("min", _min_max)
_supported("max", _min_max)
_supported("reverse", _t_reverse)
_supported("contains", _containment)
_supported("inside", _containment)
for _name, _output in (("index", "first"), ("rindex", "last"), ("indices", "all")):
    _supported(_name, _index_rule(_output))
_supported("bsearch", _t_bsearch)
_supported("join", _t_join)
# Types and conversion.
_supported("type", _t_type)
_supported("arrays", selector(lambda t: "keep" if element_of(t) is not None else "drop"))
_supported("objects", selector(lambda t: "keep" if t.type in ("Struct", "Dict", "Variant") else "drop"))
_supported("iterables", selector(lambda t: "keep" if element_of(t) is not None or t.type in ("Struct", "Dict")
                                 else "drop"))
_supported("booleans", selector(lambda t: "keep" if t.type == "Boolean" else "drop"))
_supported("numbers", selector(lambda t: "keep" if is_number(t) else "drop"))
_supported("strings", selector(lambda t: "keep" if t.type == "String" else "drop"))
_supported("nulls", selector(lambda t: "keep" if t.type == "Null" else "drop"))
_supported("values", selector(lambda t: "drop" if t.type == "Null" else "keep"))
_supported("scalars", selector(lambda t: "keep" if is_scalar(t) else "drop"))
_supported("normals", selector(lambda t: "maybe" if is_number(t) else "drop"))
_supported("finites", selector(lambda t: "keep" if t.type == "Integer" else "maybe" if t.type == "Float" else "drop"))
_supported("tostring", _data_value)
_supported("tojson", _data_value)
_supported("tonumber", _t_tonumber)
_supported("toboolean", lambda ctx: on_input(ctx, "a string or a boolean",
                                             lambda t, _m: one(BooleanType) if t.type in ("String", "Boolean") else None))
_supported("builtins", lambda _ctx: one(ArrayType(StringType)))
_supported("infinite", lambda _ctx: one(FloatType))
_supported("nan", lambda _ctx: one(FloatType))
for _name in ("isfinite", "isinfinite", "isnan", "isnormal"):
    _supported(_name, lambda ctx: on_input(ctx, "a number", lambda t, _m: one(BooleanType) if is_number(t) else None))
_supported("abs", _t_abs)
# Strings.
_supported("startswith", _affix(BooleanType))
_supported("endswith", _affix(BooleanType))
for _name in ("ltrimstr", "rtrimstr", "trimstr"):
    _supported(_name, _affix(StringType))
for _name in ("trim", "ltrim", "rtrim", "ascii_downcase", "ascii_upcase"):
    _supported(_name, _on_string(StringType))
_supported("split", _t_split)
_supported("test", _t_test)
_supported("sub", _sub_rule("sub"))
_supported("gsub", _sub_rule("gsub"))
_supported("format", _t_format)
# Formats.
for _name in ("@text", "@json", "@html", "@uri", "@base64"):
    _supported(_name, _any_data)
_supported("@csv", _cells)
_supported("@tsv", _cells)
_supported("@sh", _t_sh)
# Math.
for _name in ("floor", "ceil", "round", "trunc"):
    _supported(_name, math_rule("Integer"))
for _name in ("sqrt", "log", "log2", "log10", "exp", "exp2", "exp10", "sin", "cos", "tan", "fabs"):
    _supported(_name, math_rule("Float"))
for _name in ("pow", "fmin", "fmax", "fmod"):
    _supported(_name, math2)
# DateTime.
for _name in ("todate", "todateiso8601"):
    _supported(_name, lambda ctx: date_input(ctx, StringType))
for _name in ("fromdate", "fromdateiso8601"):
    _supported(_name, lambda ctx: on_input(ctx, "a string",
                                           lambda t, _m: one(DateTimeType) if t.type == "String" else None))
_supported("strftime", lambda ctx: date_input(ctx, StringType) if rewrite_format(ctx) else _error())
_supported("strptime", lambda ctx: on_input(ctx, "a string",
                                            lambda t, _m: one(DateTimeType) if t.type == "String" else None)
           if rewrite_format(ctx) else _error())
for _name in ("year", "month", "day", "hour", "minute", "second", "millisecond", "weekday", "epoch_ms"):
    _supported(_name, _date_parts)
_supported("datetime_add", _t_datetime_add)
_supported("datetime_diff", _t_datetime_diff)
# Function values.
_supported("call", _t_call)
for _name, _out in (("signature", StringType), ("source", StringType), ("calls", ArrayType(StringType)),
                    ("captures", ArrayType(StringType))):
    _supported(_name, _tooling(_out))

_DATA: dict[str, Any] = json.loads((Path(__file__).parent / "_catalog.json").read_text(encoding="utf-8"))

#: The catalog: every builtin of jq 1.8 and East's additions, by name, and each format by ``@name``.
BUILTINS: dict[str, Builtin] = {
    b["name"]: Builtin(b["status"], tuple(b["arities"]), b.get("reason"),
                       _TYPINGS.get(b["name"]) if b["status"] in ("supported", "tooling") else None)
    for b in _DATA["builtins"]
}

#: The builtins and formats TypeScript's translator has a rule for, as ``_catalog.json`` lists them.
TRANSLATED_BUILTINS: tuple[str, ...] = tuple(_DATA["translations"])
TRANSLATED_FORMATS: tuple[str, ...] = tuple(_DATA["formats"])

#: The typing rules, by the builtin's name: for the catalog-drift test.
TYPING_RULES: dict[str, Typing] = dict(_TYPINGS)


def is_jq_builtin(name: str) -> bool:
    """Whether a name is a builtin a jq query can call, whether or not a query may use it.

    Args:
        name: The name, as written in the query.

    Returns:
        ``True`` for one of jq 1.8's builtins or one of East's additions.
    """
    return not name.startswith("@") and name in BUILTINS


__all__ = [
    "BUILTINS", "Builtin", "DelStep", "KEY_FIELDS", "TRANSLATED_BUILTINS", "TRANSLATED_FORMATS", "TYPING_RULES",
    "UNITS", "VALUE_FIELDS", "del_paths", "element_of", "is_jq_builtin", "is_scalar", "values_of",
]
