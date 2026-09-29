#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Each builtin of the catalog as East IR: the twin of ``translate-builtins.ts``.

The translation rules ``translate.py`` calls, one per builtin a query may use,
and the formats (``libs/east/devdocs/QUERY.md`` §10, §15). A rule writes a
call's outputs through the translator's continuation, with East builtins only.
Its arguments are generated as jq evaluates them: a value parameter (``$n``)
once per output, the first argument's outputs slowest; a filter parameter on
each input it is given.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from typing import TYPE_CHECKING, Any

from east.datetime_format import DateTimeFormatTokenType
from east.query.jq.catalog import BUILTINS, DelStep, del_paths
from east.query.jq.lower import UNKNOWN_LOC_ID, A, Label
from east.query.jq.shapes import (
    dict_key,
    dict_value,
    fields_of,
    jq_type_names,
    nullable_payload,
    type_equal,
    unify,
    unwrap,
)
from east.query.jq.spans import JqNode, child_path, jq_children
from east.serialization.east_printer import print_type
from east.types.types import (
    ArrayType,
    BlobType,
    BooleanType,
    DateTimeType,
    DictType,
    EastType,
    FloatType,
    FunctionType,
    IntegerType,
    NullType,
    OptionType,
    RefType,
    SetType,
    StringType,
    StructType,
)
from east.utils.ordering import compare_for

if TYPE_CHECKING:
    from east.query.jq.translate import Block, CallSite, Emit, Env, Translator, Value

#: A builtin's translation.
BuiltinRule = Callable[["Translator", "CallSite"], None]

_RULES: dict[str, BuiltinRule] = {}


def rule(names: str | tuple[str, ...], r: BuiltinRule) -> None:
    """Registers a rule for each of some names."""
    for name in (names,) if isinstance(names, str) else names:
        _RULES[name] = r


def _input(t: Translator, c: CallSite) -> A:
    """The call's input, as an expression."""
    return t.expr(c.x, c.path)


def _arg_env(t: Translator, c: CallSite, i: int, x: Value) -> Env:
    """The instance a call's argument is typed in, for an input."""
    return t.env_for(c.arg_paths[i], c.env, x)


def _values(t: Translator, c: CallSite, indices: list[int], b: Block, then: Callable[[Block, list[A]], None],
            x: Value | None = None) -> None:
    """Generates value arguments, each output as its collected type: the first's outputs slowest."""
    source = c.x if x is None else x

    def step(b2: Block, k: int, acc: list[A]) -> None:
        if k == len(indices):
            then(b2, acc)
            return
        i = indices[k]
        t.collected(c.args[i], c.arg_paths[i], b2, source, c.env, lambda b3, v: step(b3, k + 1, [*acc, v]))
    step(b, 0, [])


def _arg(t: Translator, c: CallSite, i: int, b: Block, x: Value, emit: Emit) -> None:
    """Generates a filter argument on an input."""
    t.gen(c.args[i], c.arg_paths[i], b, x, c.env, emit)


def _arg_type(t: Translator, c: CallSite, i: int, x: Value) -> EastType:
    """The one type an argument's outputs share on an input."""
    return t.type_at(c.arg_paths[i], _arg_env(t, c, i, x))


def _arg_is_one(t: Translator, c: CallSite, i: int, x: Value) -> bool:
    """Whether an argument gives exactly one output on an input."""
    r = t.result(c.arg_paths[i], _arg_env(t, c, i, x))
    return r is not None and r.mult.lo == 1 and r.mult.hi == 1


def _output_type(t: Translator, c: CallSite) -> EastType:
    """The call's own output type, as the checker gave it."""
    return t.type_at(c.path, c.env)


def _cannot(t: Translator, c: CallSite, b: Block, v: A, what: str) -> None:
    """Raises jq's error for an input a builtin cannot take: reached only inside ``try`` or after ``?``."""
    t.raise_(b, f"{_print_kind(v)} cannot be used with {c.name}: it needs {what}", c.path)


def _print_kind(v: A) -> str:
    names = jq_type_names(v.type)
    return names[0] if names else "a value"


def _float(t: Translator, b: Block, v: A, path: str) -> A:
    """A number as a Float."""
    return t.widen_to(b, t.open(v), FloatType, path)


def _is_number(typ: EastType) -> bool:
    return typ.type in ("Integer", "Float")


def _nothing(_b: Block) -> None:
    """A branch that does nothing."""


# ─── Selection and streams ───────────────────────────────────────────────

rule("empty", lambda _t, _c: None)


def _error_rule(t: Translator, c: CallSite) -> None:
    def raise_(b: Block, v: A) -> None:
        t.raise_(b, _message(t, b, v, c.path), c.path)
    if len(c.args) == 0:
        raise_(c.block, _input(t, c))
        return
    _arg(t, c, 0, c.block, c.x, raise_)


rule("error", _error_rule)


def _message(t: Translator, b: Block, v: A, path: str) -> A:
    """An error's message: a string as it is, anything else as its East text."""
    return t.tostring(b, v, path)


def _negate(t: Translator, v: A | bool, path: str) -> A | bool:
    return (not v) if isinstance(v, bool) else t.not_(v, path)


rule("not", lambda t, c: c.emit(c.block, t.as_expr(_negate(t, t.truthy(_input(t, c), c.path), c.path))))


def _select(t: Translator, c: CallSite) -> None:
    x = _input(t, c)
    _arg(t, c, 0, c.block, c.x, lambda b, condition: t.branch(b, t.truthy(condition, c.path), lambda b2: c.emit(b2, x),
                                                              _nothing, c.path))


rule("select", _select)


def _first(t: Translator, c: CallSite) -> None:
    if len(c.args) == 1:
        def run(b: Block, label: Label) -> None:
            def each(b2: Block, v: A) -> None:
                c.emit(b2, v)
                t.brk(b2, label)
            _arg(t, c, 0, b, c.x, each)
        t.once(c.block, run, c.path)
        return
    t.index_of(c.block, _input(t, c), t.int_(0), False, c.path, c.emit)


rule("first", _first)


def _last(t: Translator, c: CallSite) -> None:
    if len(c.args) == 1:
        typ = _arg_type(t, c, 0, c.x)
        option = OptionType(typ)
        last = t.declare(c.block, t.none(option), "last")
        _arg(t, c, 0, c.block, c.x, lambda b, v: t.assign(b, last, t.some(t.widen_to(b, v, typ, c.path), option)))
        t.match(c.block, last, {"some": c.emit}, c.path)
        return
    t.index_of(c.block, _input(t, c), t.int_(-1), False, c.path, c.emit)


rule("last", _last)


def _nth(t: Translator, c: CallSite) -> None:
    if len(c.args) == 1:
        _values(t, c, [0], c.block, lambda b, vs: t.index_of(b, _input(t, c), vs[0], False, c.path, c.emit))
        return

    def with_n(b: Block, vs: list[A]) -> None:
        n = vs[0]

        def counted(b2: Block) -> None:
            count = t.declare(b2, t.int_(0), "count")

            def run(b3: Block, label: Label) -> None:
                def each(b4: Block, v: A) -> None:
                    def hit(b5: Block) -> None:
                        c.emit(b5, v)
                        t.brk(b5, label)
                    t.if_else(b4, t.eq(count, n, c.path), hit, None, c.path)
                    t.assign(b4, count, t.add(count, t.int_(1), c.path))
                _arg(t, c, 1, b3, c.x, each)
            t.once(b2, run, c.path)
        t.if_else(b, t.lt(n, t.int_(0), c.path), lambda b2: t.raise_(b2, "nth doesn't support negative indices", c.path),
                  counted, c.path)
    _values(t, c, [0], c.block, with_n)


rule("nth", _nth)


def _limit(t: Translator, c: CallSite) -> None:
    def with_n(b: Block, vs: list[A]) -> None:
        n = vs[0]

        def positive(b3: Block) -> None:
            count = t.declare(b3, t.int_(0), "count")

            def run(b4: Block, label: Label) -> None:
                def each(b5: Block, v: A) -> None:
                    c.emit(b5, v)
                    t.assign(b5, count, t.add(count, t.int_(1), c.path))
                    t.if_else(b5, t.b("GreaterEqual", [IntegerType], [count, n], BooleanType, c.path),
                              lambda b6: t.brk(b6, label), None, c.path)
                _arg(t, c, 1, b4, c.x, each)
            t.once(b3, run, c.path)

        def non_negative(b2: Block) -> None:
            t.if_else(b2, t.lt(t.int_(0), n, c.path), positive, None, c.path)
        t.if_else(b, t.lt(n, t.int_(0), c.path), lambda b2: t.raise_(b2, "limit doesn't support negative count", c.path),
                  non_negative, c.path)
    _values(t, c, [0], c.block, with_n)


rule("limit", _limit)


def _skip(t: Translator, c: CallSite) -> None:
    def with_n(b: Block, vs: list[A]) -> None:
        n = vs[0]

        def counted(b2: Block) -> None:
            count = t.declare(b2, t.int_(0), "count")
            _arg(t, c, 1, b2, c.x, lambda b3, v: t.if_else(
                b3, t.lt(count, n, c.path), lambda b4: t.assign(b4, count, t.add(count, t.int_(1), c.path)),
                lambda b4: c.emit(b4, v), c.path))
        t.if_else(b, t.lt(n, t.int_(0), c.path), lambda b2: t.raise_(b2, "skip doesn't support negative count", c.path),
                  counted, c.path)
    _values(t, c, [0], c.block, with_n)


rule("skip", _skip)


def _isempty(t: Translator, c: CallSite) -> None:
    empty = t.declare(c.block, t.bool_(True), "empty")

    def run(b: Block, label: Label) -> None:
        def each(b2: Block, _v: A) -> None:
            t.assign(b2, empty, t.bool_(False))
            t.brk(b2, label)
        _arg(t, c, 0, b, c.x, each)
    t.once(c.block, run, c.path)
    c.emit(c.block, empty)


rule("isempty", _isempty)


def _range(t: Translator, c: CallSite) -> None:
    typ = _output_type(t, c)
    indices = list(range(len(c.args)))

    def with_args(b: Block, args: list[A]) -> None:
        def as_(v: A) -> A:
            return t.widen_to(b, v, typ, c.path)
        zero = t.float_(0.0) if typ.type == "Float" else t.int_(0)
        one = t.float_(1.0) if typ.type == "Float" else t.int_(1)
        if len(args) == 1:
            start, upto, by = zero, as_(args[0]), one
        elif len(args) == 2:
            start, upto, by = as_(args[0]), as_(args[1]), one
        else:
            start, upto, by = as_(args[0]), as_(args[1]), as_(args[2])
        i = t.declare(b, start, "i")
        by_constant = t.constant(by)
        by_value = None if by_constant is None else by_constant[0]

        def less(a: A, a2: A) -> A:
            return t.b("Less", [typ], [a, a2], BooleanType, c.path)
        # Up while below the end for a positive step, down while above it for a negative one; a zero step gives nothing.
        if by_value is None:
            going: A | None = t.b("BooleanOr", [], [
                t.b("BooleanAnd", [], [less(zero, by), less(i, upto)], BooleanType, c.path),
                t.b("BooleanAnd", [], [less(by, zero), less(upto, i)], BooleanType, c.path),
            ], BooleanType, c.path)
        elif by_value > 0:
            going = less(i, upto)
        elif by_value < 0:
            going = less(upto, i)
        else:
            going = None
        if going is None:
            return

        def body(b2: Block, _label: Label) -> None:
            value = t.declare(b2, i, "value", False)
            t.assign(b2, i, t.b("FloatAdd" if typ.type == "Float" else "IntegerAdd", [], [i, by], typ, c.path))
            c.emit(b2, value)
        t.while_loop(b, going, body, c.path)
    _values(t, c, indices, c.block, with_args)


rule("range", _range)


def _recurse(t: Translator, c: CallSite) -> None:
    if len(c.args) == 0:
        # `recurse` is `..`: jq defines both as `recurse(.[]?)`.
        t.descend(c.block, _input(t, c), c.path, c.emit)
        return
    # `recurse(f)`, `recurse(f; cond)`: the value, then f of it, and so on, depth first.
    typ = _output_type(t, c)
    start = t.widen_to(c.block, _input(t, c), typ, c.path)

    def step(b: Block, v: A, push: Emit) -> None:
        c.emit(b, v)

        def on_child(b2: Block, child: A) -> None:
            nxt = t.bind(b2, t.widen_to(b2, child, typ, c.path), "child")
            if len(c.args) == 2:
                _arg(t, c, 1, b2, nxt, lambda b3, condition: t.branch(b3, t.truthy(condition, c.path),
                                                                      lambda b4: push(b4, nxt), _nothing, c.path))
            else:
                push(b2, nxt)
        _arg(t, c, 0, b, v, on_child)
    t.walk_stack(c.block, start, [typ], c.path, step)


rule("recurse", _recurse)


def _repeat(t: Translator, c: CallSite) -> None:
    typ = _output_type(t, c)
    start = t.widen_to(c.block, _input(t, c), typ, c.path)

    def step(b: Block, v: A, push: Emit) -> None:
        c.emit(b, v)
        _arg(t, c, 0, b, v, lambda b2, nxt: push(b2, t.widen_to(b2, nxt, typ, c.path)))
    t.walk_stack(c.block, start, [typ], c.path, step)


rule("repeat", _repeat)


def _while(t: Translator, c: CallSite) -> None:
    typ = _output_type(t, c)
    start = t.widen_to(c.block, _input(t, c), typ, c.path)

    def step(b: Block, v: A, push: Emit) -> None:
        def holds(b3: Block) -> None:
            c.emit(b3, v)
            _arg(t, c, 1, b3, v, lambda b4, nxt: push(b4, t.widen_to(b4, nxt, typ, c.path)))
        _arg(t, c, 0, b, v, lambda b2, condition: t.branch(b2, t.truthy(condition, c.path), holds, _nothing, c.path))
    t.walk_stack(c.block, start, [typ], c.path, step)


rule("while", _while)


def _until(t: Translator, c: CallSite) -> None:
    typ = _output_type(t, c)
    start = t.widen_to(c.block, _input(t, c), typ, c.path)

    def step(b: Block, v: A, push: Emit) -> None:
        _arg(t, c, 0, b, v, lambda b2, condition: t.branch(
            b2, t.truthy(condition, c.path), lambda b3: c.emit(b3, v),
            lambda b3: _arg(t, c, 1, b3, v, lambda b4, nxt: push(b4, t.widen_to(b4, nxt, typ, c.path))), c.path))
    t.walk_stack(c.block, start, [typ], c.path, step)


rule("until", _until)


def _combinations(t: Translator, c: CallSite) -> None:
    def run(b: Block, lists: A) -> None:
        row = lists.type.value
        element = row.value
        n = t.declare(b, t.size(lists, c.path), "count", False)
        any_empty = t.declare(b, t.bool_(False), "anyEmpty")
        t.for_each(b, lists, lambda b2, lst, _k, _l: t.if_else(
            b2, t.eq(t.size(lst, c.path), t.int_(0), c.path), lambda b3: t.assign(b3, any_empty, t.bool_(True)), None,
            c.path), c.path, "list")

        def all_present(b2: Block) -> None:
            index = t.declare(b2, t.empty_array(IntegerType), "positions")
            t.for_each(b2, lists, lambda b3, _lst, _k, _l: t.push(b3, index, t.int_(0), c.path), c.path, "list")

            def loop(b3: Block, label: Label) -> None:
                combo = t.declare(b3, t.empty_array(element), "combination")
                t.for_each(b3, lists, lambda b4, lst, k, _l: t.push(b4, combo, t.b(
                    "ArrayGet", [element], [lst, t.b("ArrayGet", [IntegerType], [index, k], IntegerType, c.path)],  # type: ignore[list-item]
                    element, c.path), c.path), c.path, "list")
                c.emit(b3, combo)
                # The next combination: the last position fastest.
                k = t.declare(b3, t.add(n, t.int_(-1), c.path), "k")
                carry = t.declare(b3, t.bool_(True), "carry")

                def advance(b4: Block, _label: Label) -> None:
                    nxt = t.declare(b4, t.add(t.b("ArrayGet", [IntegerType], [index, k], IntegerType, c.path), t.int_(1),
                                              c.path), "next", False)

                    def within(b5: Block) -> None:
                        t.stmt(b5, t.b("ArrayUpdate", [IntegerType], [index, k, nxt], NullType, c.path))
                        t.assign(b5, carry, t.bool_(False))

                    def wrap(b5: Block) -> None:
                        t.stmt(b5, t.b("ArrayUpdate", [IntegerType], [index, k, t.int_(0)], NullType, c.path))
                        t.assign(b5, k, t.add(k, t.int_(-1), c.path))
                    t.if_else(b4, t.lt(nxt, t.size(t.b("ArrayGet", [row], [lists, k], row, c.path), c.path), c.path),
                              within, wrap, c.path)
                t.while_loop(b3, t.b("BooleanAnd", [], [carry, t.b("GreaterEqual", [IntegerType], [k, t.int_(0)],
                                                                    BooleanType, c.path)], BooleanType, c.path),
                             advance, c.path)
                t.if_else(b3, carry, lambda b4: t.brk(b4, label), None, c.path)
            t.while_loop(b2, True, loop, c.path)
        t.if_else(b, t.not_(any_empty, c.path), all_present, None, c.path)
    if len(c.args) == 0:
        run(c.block, t.bind(c.block, t.open(_input(t, c)), "lists"))
        return

    def with_n(b: Block, vs: list[A]) -> None:
        n = vs[0]
        lst = t.bind(b, t.open(_input(t, c)), "list")
        lists = t.declare(b, t.empty_array(lst.type), "lists")
        i = t.declare(b, t.int_(0), "i")

        def body(b2: Block, _label: Label) -> None:
            t.push(b2, lists, lst, c.path)
            t.assign(b2, i, t.add(i, t.int_(1), c.path))
        t.while_loop(b, t.lt(i, n, c.path), body, c.path)
        run(b, lists)
    _values(t, c, [0], c.block, with_n)


rule("combinations", _combinations)


def _walk(t: Translator, c: CallSite) -> None:  # noqa: C901
    typ = _output_type(t, c)
    # Bottom up: a value's parts are walked first, then f runs on it rebuilt.
    cells: list[tuple[EastType, A]] = []
    # Where the functions that walk recursive values are declared: before the walk, so every loop sees them.
    start = len(c.block.statements)
    declared = [0]

    def walk(b: Block, v: A) -> A:
        if v.type.type == "Recursive":
            return walk_recursive(b, v)
        return apply(b, rebuild(b, v))

    def apply(b: Block, v: A) -> A:
        out = t.one(c.args[0], c.arg_paths[0], b, v, c.env, _arg_type(t, c, 0, v))
        return t.bind(b, out, "walked")

    def rebuild(b: Block, v: A) -> A:  # noqa: C901
        o = t.open(v)
        ot = o.type
        # An option's value's parts, where it holds one; f runs once, on the whole.
        if nullable_payload(ot) is not None:
            return t.match_auto(o, {"none": lambda _b2, _p: t.null(c.path), "some": lambda b2, p: rebuild(b2, p)}, c.path)
        # A variant's payload is walked; its case's name is its type.
        if ot.type == "Variant":
            return t.map_payloads(o, lambda b2, _name, payload: walk(b2, payload), c.path)
        # A collection of Never is empty: nothing to walk.
        if (ot.type == "Array" and ot.value.type == "Never") or (ot.type == "Dict" and dict_value(ot).type == "Never"):
            return o
        if ot.type == "Array":
            state: dict[str, A] = {}
            decl = t.block()

            def each(b2: Block, item: A, _k: A | None, _l: Label) -> None:
                w = walk(b2, item)
                if "out" not in state:
                    state["out"] = t.declare(decl, t.empty_array(w.type), "array")
                t.push(b2, state["out"], w, c.path)
            t.for_each(b, o, each, c.path)
            b.statements[len(b.statements) - 1:len(b.statements) - 1] = decl.statements
            return state.get("out", o)
        if ot.type == "Dict":
            state = {}
            decl = t.block()

            def each_value(b2: Block, item: A, key: A | None, _l: Label) -> None:
                w = walk(b2, item)
                if "out" not in state:
                    state["out"] = t.declare(decl, t.value({}, DictType(dict_key(ot), w.type)), "dict")
                t.stmt(b2, t.b("DictInsert", [dict_key(ot), w.type], [state["out"], key, w], NullType, c.path))  # type: ignore[list-item]
            t.for_each(b, o, each_value, c.path)
            b.statements[len(b.statements) - 1:len(b.statements) - 1] = decl.statements
            return state.get("out", o)
        if ot.type == "Struct":
            s = t.bind(b, o, "struct")
            values: dict[str, A] = {}
            types: dict[str, EastType] = {}
            for name in fields_of(ot):
                values[name] = walk(b, t.field(s, name))
                types[name] = values[name].type
            # A recursive value keeps its type; a reference's value is read through it.
            vt = v.type
            rebuilt_type = vt if vt.type == "Recursive" and type_equal(StructType(list(types.items())), ot) \
                else StructType(list(types.items()))
            return t.struct(rebuilt_type, values)
        return v

    # A recursive value is walked by a function its own parts call, through a reference.
    def walk_recursive(b: Block, v: A) -> A:
        rt = v.type
        fn_type = FunctionType([rt], rt)
        cell = next((cl for ty, cl in cells if ty is rt), None)
        if cell is None:
            header = t.block()
            placeholder = t.lambda_([rt], rt, ["value"], lambda _bf, value: value, c.path)
            made = t.declare(header, A("NewRef", RefType(fn_type), UNKNOWN_LOC_ID, value=placeholder), "walk", False)
            cell = made
            cells.append((rt, made))

            def fn_body(bf: Block, value: A) -> A:
                rebuilt = rebuild(bf, value)
                return t.widen_to(bf, apply(bf, t.widen_to(bf, rebuilt, rt, c.path)), rt, c.path)
            fn = t.lambda_([rt], rt, ["value"], fn_body, c.path)
            t.stmt(header, t.b("RefUpdate", [fn_type], [made, fn], NullType, c.path))
            at = start + declared[0]
            c.block.statements[at:at] = header.statements
            declared[0] += len(header.statements)
        return t.bind(b, t.call_fn(t.b("RefGet", [fn_type], [cell], fn_type, c.path), [v], c.path), "walked")

    c.emit(c.block, t.widen_to(c.block, walk(c.block, _input(t, c)), typ, c.path))


rule("walk", _walk)


def _in_upper(t: Translator, c: CallSite) -> None:
    found = t.declare(c.block, t.bool_(False), "found")

    def test(b: Block, a: A, a2: A, label: Label) -> None:
        def hit(b2: Block) -> None:
            t.assign(b2, found, t.bool_(True))
            t.brk(b2, label)
        t.if_else(b, t.compare(b, "==", a, a2, c.path), hit, None, c.path)

    def run(b: Block, label: Label) -> None:
        if len(c.args) == 1:
            x = _input(t, c)
            _arg(t, c, 0, b, c.x, lambda b2, v: test(b2, v, x, label))
            return

        # `IN(src; s)` is `any(src == s; .)`: s's outputs slowest.
        def on_candidate(b2: Block, cand: A) -> None:
            bound = t.bind(b2, cand, "candidate")
            _arg(t, c, 0, b2, c.x, lambda b3, a: test(b3, a, bound, label))
        _arg(t, c, 1, b, c.x, on_candidate)
    t.once(c.block, run, c.path)
    c.emit(c.block, found)


rule("IN", _in_upper)


def _index_upper(t: Translator, c: CallSite) -> None:
    typ = _output_type(t, c)
    d = t.declare(c.block, t.value({}, typ), "index")

    def add(b: Block, row: A) -> None:
        bound = t.bind(b, row, "row")
        _arg(t, c, len(c.args) - 1, b, bound, lambda b2, key: t.put(b2, d, key, bound, c.path))
    if len(c.args) == 2:
        _arg(t, c, 0, c.block, c.x, add)
    else:
        t.iterate(c.block, _input(t, c), False, c.path, add)
    c.emit(c.block, d)


rule("INDEX", _index_upper)


def _del(t: Translator, c: CallSite) -> None:
    paths = del_paths(c.args[0], c.arg_paths[0])
    if paths is None:
        raise t.gap(f"del({t.text(c.arg_paths[0])})")
    c.emit(c.block, _delete_at(t, c, c.block, _input(t, c), paths))


rule("del", _del)


def _delete_at(t: Translator, c: CallSite, b: Block, v: A, paths: list[list[DelStep]]) -> A:  # noqa: C901
    """A value without what some paths name, all deleted at once as jq deletes them."""
    if not paths:
        return v
    if any(len(p) == 0 for p in paths):
        return t.null(c.path)
    e = t.open(v)
    typ = e.type
    if typ.type == "Null":
        return e
    payload = nullable_payload(typ)
    if payload is not None:
        # An option: the deletion inside its value, when it has one.
        inner = _delete_at(t, c, t.block(), t.placeholder(payload), paths).type
        option = OptionType(inner)
        return t.match_value(e, {"none": lambda _b2, _p: t.none(option),
                                 "some": lambda b2, p: t.some(_delete_at(t, c, b2, p, paths), option)}, option, c.path)
    # A select as the whole path: the value is deleted, becoming null, where the condition holds.
    selects = [p for p in paths if len(p) == 1 and p[0].kind == "select"]
    if selects:
        kept = t.bind(b, _delete_at(t, c, b, e, [p for p in paths if not any(p is s for s in selects)]), "kept")
        deleted = t.declare(b, t.bool_(False), "deleted")
        for p in selects:
            step = p[0]
            t.gen(_node_at(c, step.path), step.path, b, e, c.env, lambda b2, condition: t.branch(  # type: ignore[arg-type]
                b2, t.truthy(condition, c.path), lambda b3: t.assign(b3, deleted, t.bool_(True)), _nothing, c.path))
        option = OptionType(kept.type)
        return t.if_value(deleted, lambda _b2: t.none(option), lambda _b2: t.some(kept, option), option, c.path)

    def name_of(step: DelStep) -> str | None:
        if step.kind == "field":
            return step.name
        if step.kind == "index" and typ.type != "Dict":
            literal = t.literal_of(step.node)
            if literal is not None and literal[0].type == "String":
                return literal[1]
        return None

    if typ.type == "Struct":
        fields = fields_of(typ)
        s = t.bind(b, e, "struct")
        removed: set[str] = set()
        nested: dict[str, list[list[DelStep]]] = {}
        for p in paths:
            first, rest = p[0], p[1:]
            names = list(fields) if first.kind == "iterate" else [name_of(first)]
            for name in names:
                if name is None:
                    raise t.gap(f"del of {first.kind} on {print_type(typ)}")
                if name not in fields:
                    continue
                if not rest:
                    removed.add(name)
                else:
                    nested[name] = [*nested.get(name, []), rest]
        values: dict[str, A] = {}
        types: dict[str, EastType] = {}
        for name in fields:
            if name in removed:
                continue
            rests = nested.get(name)
            values[name] = t.field(s, name) if rests is None else t.bind(b, _delete_at(t, c, b, t.field(s, name), rests),
                                                                        name)
            types[name] = values[name].type
        return t.struct(StructType(list(types.items())), values)
    if typ.type in ("Array", "Dict"):
        is_array = typ.type == "Array"
        d = t.bind(b, e, "container")
        size = t.declare(b, t.size(d, c.path), "size", False) if is_array else None

        # Each path's bounds, or every index or key it gives.
        targets: list[tuple[str, Any]] = []
        for p in paths:
            first = p[0]
            if first.kind == "iterate":
                targets.append(("none", None))
                continue
            if first.kind == "slice":
                slice_node = _node_at(c, first.path)  # type: ignore[arg-type]

                def bound(option: Any, step: str, fallback: A, first: DelStep = first) -> A:
                    if option.type == "none":
                        return t.bound_of(b, None, fallback, size, c.path)  # type: ignore[arg-type]
                    at = child_path(first.path, step)  # type: ignore[arg-type]
                    return t.bound_of(b, t.one(option.value, at, b, c.x, c.env, _arg_type_at(t, c, at)), fallback, size,  # type: ignore[arg-type]
                                      c.path)
                targets.append(("range", (bound(slice_node.value["from"], "slice.from.some", t.int_(0)),
                                          bound(slice_node.value["to"], "slice.to.some", size))))  # type: ignore[arg-type]
                continue
            k_type = IntegerType if is_array else dict_key(typ)
            keys = t.declare(b, t.empty_array(k_type), "keys")

            def add(b2: Block, key: A, k_type: EastType = k_type, keys: A = keys) -> None:
                k = t.bind(b2, t.widen_to(b2, key, k_type, c.path), "key")
                # A negative index counts from the end.
                if is_array:
                    k_value = t.if_value(t.lt(k, t.int_(0), c.path), lambda _b3: t.add(k, size, c.path),  # type: ignore[arg-type]
                                         lambda _b3: k, IntegerType, c.path)
                else:
                    k_value = k
                t.push(b2, keys, k_value, c.path)
            name = name_of(first)
            if name is not None:
                add(b, t.str_(name, c.path))
            else:
                t.collected(first.node, first.path, b, c.x, c.env, add)  # type: ignore[arg-type]
            targets.append(("keys", keys))

        # Paths through every element to something inside it change each alike: they apply first.
        def through_each(p: list[DelStep]) -> bool:
            return p[0].kind == "iterate" and len(p) > 1 and not (len(p) == 2 and p[1].kind == "select")
        everywhere = [p[1:] for p in paths if through_each(p)]
        state: dict[str, A] = {}
        declared = t.block()

        def each(b2: Block, item: A, key: A | None, _l: Label) -> None:
            current = item if not everywhere else t.bind(b2, _delete_at(t, c, b2, item, everywhere), "element")
            cell = t.declare(b2, current, "element")
            dropped = t.declare(b2, t.bool_(False), "dropped")
            for k, p in enumerate(paths):
                if through_each(p):
                    continue
                rest = p[1:]

                def handle(b3: Block, rest: list[DelStep] = rest) -> None:
                    if not rest:
                        t.assign(b3, dropped, t.bool_(True))
                        return
                    if len(rest) == 1 and rest[0].kind == "select":
                        step = rest[0]
                        t.gen(_node_at(c, step.path), step.path, b3, cell, c.env, lambda b4, condition: t.branch(  # type: ignore[arg-type]
                            b4, t.truthy(condition, c.path), lambda b5: t.assign(b5, dropped, t.bool_(True)), _nothing,
                            c.path))
                        return
                    t.assign(b3, cell, t.widen_to(b3, _delete_at(t, c, b3, cell, [rest]), cell.type, c.path))
                target_kind, target = targets[k]
                if target_kind == "none":
                    handle(b2)
                    continue
                if target_kind == "range":
                    in_range = t.b("BooleanAnd", [], [t.b("LessEqual", [IntegerType], [target[0], key], BooleanType,  # type: ignore[list-item]
                                                          c.path), t.lt(key, target[1], c.path)], BooleanType, c.path)  # type: ignore[arg-type]
                    t.if_else(b2, in_range, handle, None, c.path)
                    continue

                def matching(b3: Block, kv: A, _i: A | None, label: Label, handle: Callable[[Block], None] = handle) -> None:
                    def hit(b4: Block) -> None:
                        handle(b4)
                        t.brk(b4, label)
                    t.if_else(b3, t.eq(kv, key, c.path), hit, None, c.path)  # type: ignore[arg-type]
                t.for_each(b2, target, matching, c.path, "key")
            element = cell.type
            if "out" not in state:
                state["out"] = t.declare(declared, t.empty_array(element) if is_array
                                         else t.value({}, DictType(dict_key(typ), element)), "array" if is_array else "dict")
            result = state["out"]

            def keep(b3: Block) -> None:
                if is_array:
                    t.push(b3, result, cell, c.path)
                else:
                    t.stmt(b3, t.b("DictInsert", [dict_key(typ), element], [result, key, cell], NullType, c.path))  # type: ignore[list-item]
            t.if_else(b2, t.not_(dropped, c.path), keep, None, c.path)
        t.for_each(b, d, each, c.path)
        # The result is declared before the loop, once the elements' type after deletion is known.
        b.statements[len(b.statements) - 1:len(b.statements) - 1] = declared.statements
        return state.get("out", d)
    if typ.type == "String":
        t.raise_(b, "Cannot delete fields from string", c.path)
        return e
    raise t.gap(f"del on {print_type(typ)}")


def _node_at(c: CallSite, path: str) -> JqNode:
    """The node at a path inside the call's first argument."""
    def walk(n: JqNode, at: str) -> JqNode | None:
        if at == path:
            return n
        for child in jq_children(n):
            if child.node is None:
                continue
            child_at = child_path(at, child.step)
            if path == child_at or path.startswith(f"{child_at}."):
                return walk(child.node, child_at)
        return None
    found = walk(c.args[0], c.arg_paths[0])
    if found is None:
        raise ValueError(f"translateJq: no node at {path}")
    return found


def _arg_type_at(t: Translator, c: CallSite, path: str) -> EastType:
    """The collected type of a node inside the call's argument."""
    return t.type_at(path, t.env_for(path, c.env, c.x))


def _to_entries(t: Translator, c: CallSite) -> None:
    typ = _output_type(t, c)
    entry = typ.value
    value_type = fields_of(entry)["value"]
    out = t.declare(c.block, t.empty_array(entry), "entries")
    x = t.open(_input(t, c))
    xt = x.type
    if xt.type == "Struct":
        s = t.bind(c.block, x, "struct")
        for name in fields_of(xt):
            t.push(c.block, out, t.struct(entry, {"key": t.str_(name, c.path),
                                                  "value": t.widen_to(c.block, t.field(s, name), value_type, c.path)}),
                   c.path)
    elif xt.type == "Dict":
        t.for_each(c.block, x, lambda b, value, key, _l: t.push(b, out, t.struct(entry, {
            "key": key, "value": t.widen_to(b, value, value_type, c.path)}), c.path), c.path)  # type: ignore[dict-item]
    else:
        array = t.as_array(c.block, x, c.path)
        if array is None:
            _cannot(t, c, c.block, x, "a dict, a struct or an array")
            return
        t.for_each(c.block, array, lambda b, value, index, _l: t.push(b, out, t.struct(entry, {
            "key": index, "value": t.widen_to(b, value, value_type, c.path)}), c.path), c.path)  # type: ignore[dict-item]
    c.emit(c.block, out)


rule("to_entries", _to_entries)

# The key and value fields a from_entries entry can have, as jq accepts them.
_KEY_FIELDS = ("key", "k", "name", "Name", "K", "Key")
_VALUE_FIELDS = ("value", "v", "Value", "V")


def _add_entry(t: Translator, c: CallSite, b: Block, d: A, entry: A) -> None:
    """Adds ``{key, value}`` entries to a dict."""
    e = t.open(entry)
    fields = fields_of(e.type)
    key = next((k for k in _KEY_FIELDS if k in fields), None)
    value = next((v for v in _VALUE_FIELDS if v in fields), None)
    if key is None:
        raise t.gap("a from_entries entry without a key")
    s = t.bind(b, e, "entry")
    t.put(b, d, t.field(s, key), t.null(c.path) if value is None else t.field(s, value), c.path)


def _from_entries(t: Translator, c: CallSite) -> None:
    d = t.declare(c.block, t.value({}, _output_type(t, c)), "dict")
    t.for_each(c.block, _input(t, c), lambda b, entry, _k, _l: _add_entry(t, c, b, d, entry), c.path, "entry")
    c.emit(c.block, d)


rule("from_entries", _from_entries)


def _with_entries(t: Translator, c: CallSite) -> None:
    d = t.declare(c.block, t.value({}, _output_type(t, c)), "dict")
    x = t.open(_input(t, c))
    xt = x.type

    def each(b: Block, entry: A) -> None:
        _arg(t, c, 0, b, entry, lambda b2, mapped: _add_entry(t, c, b2, d, mapped))
    if xt.type == "Dict":
        entry_type = StructType([("key", dict_key(xt)), ("value", dict_value(xt))])
        t.for_each(c.block, x, lambda b, value, key, _l: each(b, t.bind(b, t.struct(entry_type, {"key": key, "value": value}),  # type: ignore[dict-item]
                                                                             "entry")), c.path)
    elif xt.type == "Struct":
        value_type: EastType | None = None
        for f in fields_of(xt).values():
            value_type = f if value_type is None else _unify_or_fail(t, value_type, f)
        entry_type = StructType([("key", StringType), ("value", NullType if value_type is None else value_type)])
        s = t.bind(c.block, x, "struct")
        for name in fields_of(xt):
            each(c.block, t.bind(c.block, t.struct(entry_type, {
                "key": t.str_(name, c.path), "value": t.widen_to(c.block, t.field(s, name), value_type, c.path)}), "entry"))  # type: ignore[arg-type]
    else:
        _cannot(t, c, c.block, x, "a dict or a struct")
        return
    c.emit(c.block, d)


rule("with_entries", _with_entries)


def _unify_or_fail(t: Translator, a: EastType, b: EastType) -> EastType:
    """The one type two types unify to."""
    u = unify(a, b)
    if u is None:
        raise t.gap(f"{print_type(a)} and {print_type(b)} have no one type")
    return u


def _pick(t: Translator, c: CallSite) -> None:
    n = c.args[0]
    names: list[str] = []
    while n.type == "field":
        names.insert(0, n.value["name"])
        n = n.value["target"]

    def build(b: Block, v: A, rest: list[str]) -> A:
        # `null`'s fields are null.
        inner = t.null(c.path) if v.type.type == "Null" else t.field(v, rest[0])
        picked = inner if len(rest) == 1 else build(b, t.bind(b, inner, rest[0]), rest[1:])
        return t.struct(StructType([(rest[0], picked.type)]), {rest[0]: picked})
    c.emit(c.block, build(c.block, t.bind(c.block, t.open(_input(t, c)), "value"), names))


rule("pick", _pick)


def _transpose(t: Translator, c: CallSite) -> None:
    typ = _output_type(t, c)
    # No rows, so nothing to transpose.
    if t.open(_input(t, c)).type.value.type == "Never":
        c.emit(c.block, t.value([], typ, c.path))
        return
    row = typ.value
    cell = row.value
    rows = t.bind(c.block, t.open(_input(t, c)), "rows")
    width = t.declare(c.block, t.int_(0), "width")
    t.for_each(c.block, rows, lambda b, r, _k, _l: t.if_else(
        b, t.lt(width, t.size(r, c.path), c.path), lambda b2: t.assign(b2, width, t.size(r, c.path)), None, c.path),
        c.path, "row")
    out = t.declare(c.block, t.empty_array(row), "transposed")
    i = t.declare(c.block, t.int_(0), "column")

    def body(b: Block, _label: Label) -> None:
        column = t.declare(b, t.empty_array(cell), "cells")

        def each(b2: Block, r: A, _k: A | None, _l: Label) -> None:
            inner = r.type.value
            t.push(b2, column, t.widen_to(b2, t.b("ArrayTryGet", [inner], [r, i], OptionType(inner), c.path), cell, c.path),
                   c.path)
        t.for_each(b, rows, each, c.path, "row")
        t.push(b, out, column, c.path)
        t.assign(b, i, t.add(i, t.int_(1), c.path))
    t.while_loop(c.block, t.lt(i, width, c.path), body, c.path)
    c.emit(c.block, out)


rule("transpose", _transpose)

# ─── Collections ─────────────────────────────────────────────────────────


def _length(t: Translator, c: CallSite) -> None:
    x = t.open(_input(t, c))

    def length(b: Block, v: A, emit: Emit) -> None:
        o = t.open(v)
        ty = o.type
        kind = ty.type
        if kind == "Null":
            emit(b, t.int_(0))
        elif kind == "String":
            emit(b, t.b("StringLength", [], [o], IntegerType, c.path))
        elif kind == "Array":
            emit(b, t.size(o, c.path))
        elif kind == "Set":
            emit(b, t.b("SetSize", [ty.value], [o], IntegerType, c.path))
        elif kind == "Dict":
            emit(b, t.b("DictSize", [dict_key(ty), dict_value(ty)], [o], IntegerType, c.path))
        elif kind == "Vector":
            emit(b, t.b("VectorLength", [ty.value], [o], IntegerType, c.path))
        elif kind == "Matrix":
            emit(b, t.b("MatrixRows", [ty.value], [o], IntegerType, c.path))
        elif kind == "Blob":
            emit(b, t.b("BlobSize", [], [o], IntegerType, c.path))
        elif kind == "Struct":
            emit(b, t.int_(len(ty.value)))
        elif kind == "Integer":
            emit(b, t.b("IntegerAbs", [], [o], IntegerType, c.path))
        elif kind == "Float":
            emit(b, t.b("FloatAbs", [], [o], FloatType, c.path))
        elif kind == "Variant":
            if nullable_payload(ty) is not None:
                t.match(b, o, {"none": lambda b2, _p: emit(b2, t.int_(0)), "some": lambda b2, p: length(b2, p, emit)},
                        c.path)
                return
            # jq sees a variant as {type, value}.
            emit(b, t.int_(2))
        else:
            _cannot(t, c, b, o, "a value with a length")
    length(c.block, x, c.emit)


rule("length", _length)
rule("utf8bytelength", lambda t, c: c.emit(c.block, t.b("BlobSize", [], [t.b(
    "StringEncodeUtf8", [], [t.open(_input(t, c))], BlobType, c.path)], IntegerType, c.path)))


def _sorted_strings(names: list[str]) -> list[str]:
    """Names in East's order of strings."""
    from functools import cmp_to_key

    return sorted(names, key=cmp_to_key(compare_for(StringType)))


def _keys(t: Translator, c: CallSite) -> None:
    x = t.open(_input(t, c))
    xt = x.type
    if xt.type == "Dict":
        out = t.declare(c.block, t.empty_array(dict_key(xt)), "keys")
        t.for_each(c.block, x, lambda b, _value, key, _l: t.push(b, out, key, c.path), c.path)  # type: ignore[arg-type]
        c.emit(c.block, out)
        return
    if xt.type == "Struct":
        names = list(fields_of(xt))
        c.emit(c.block, t.value(_sorted_strings(names) if c.name == "keys" else names, ArrayType(StringType), c.path))
        return
    if xt.type == "Variant":
        c.emit(c.block, t.value(["type", "value"], ArrayType(StringType), c.path))
        return
    array = t.as_array(c.block, x, c.path)
    if array is None:
        _cannot(t, c, c.block, x, "a dict, a struct or an array")
        return
    c.emit(c.block, t.b("ArrayRange", [], [t.int_(0), t.size(array, c.path), t.int_(1)], ArrayType(IntegerType), c.path))


rule(("keys", "keys_unsorted"), _keys)


def _has(t: Translator, c: CallSite, b: Block, container: A, key: A) -> A | None:
    """Whether a container has a key: a dict's key, a struct's field name, an array's index."""
    o = t.open(container)
    ot = o.type
    if ot.type == "Dict":
        return t.b("DictHas", [dict_key(ot), dict_value(ot)], [o, t.widen_to(b, key, dict_key(ot), c.path)], BooleanType,
                   c.path)
    if ot.type == "Struct":
        names = list(fields_of(ot))
        known = t.constant(key)
        if known is not None and isinstance(known[0], str):
            return t.bool_(known[0] in names, c.path)
        return t.b("SetHas", [StringType], [t.value(_sorted_strings(names), SetType(StringType), c.path), key], BooleanType,
                   c.path)
    array = t.as_array(b, o, c.path)
    if array is None:
        return None
    k = t.bind(b, key, "index")
    return t.b("BooleanAnd", [], [t.b("LessEqual", [IntegerType], [t.int_(0), k], BooleanType, c.path),
                                  t.lt(k, t.size(array, c.path), c.path)], BooleanType, c.path)


def _has_rule(t: Translator, c: CallSite) -> None:
    def with_key(b: Block, vs: list[A]) -> None:
        x = _input(t, c)
        result = _has(t, c, b, x, vs[0])
        if result is None:
            _cannot(t, c, b, x, "a dict, a struct or an array")
            return
        c.emit(b, result)
    _values(t, c, [0], c.block, with_key)


rule("has", _has_rule)


def _in(t: Translator, c: CallSite) -> None:
    x = _input(t, c)

    def on_container(b: Block, container: A) -> None:
        result = _has(t, c, b, container, x)
        if result is None:
            _cannot(t, c, b, container, "a dict, a struct or an array")
            return
        c.emit(b, result)
    _arg(t, c, 0, c.block, c.x, on_container)


rule("in", _in)


def _map(t: Translator, c: CallSite) -> None:
    element = _output_type(t, c).value
    out = t.declare(c.block, t.empty_array(element), "mapped")
    t.iterate(c.block, _input(t, c), False, c.path, lambda b, item: _arg(t, c, 0, b, item,
                                                                         lambda b2, v: t.push(b2, out, v, c.path)))
    c.emit(c.block, out)


rule("map", _map)


def _map_values(t: Translator, c: CallSite) -> None:
    x = t.open(_input(t, c))
    xt = x.type
    typ = _output_type(t, c)

    def first(b: Block, v: A, then: Callable[[Block, A], None]) -> None:
        def run(b2: Block, label: Label) -> None:
            def each(b3: Block, w: A) -> None:
                then(b3, w)
                t.brk(b3, label)
            _arg(t, c, 0, b2, v, each)
        t.once(b, run, c.path)
    if xt.type == "Array":
        out = t.declare(c.block, t.empty_array(typ.value), "mapped")
        t.for_each(c.block, x, lambda b, item, _k, _l: first(b, item, lambda b2, w: t.push(b2, out, w, c.path)), c.path)
        c.emit(c.block, out)
        return
    if xt.type == "Dict":
        out = t.declare(c.block, t.value({}, typ), "mapped")
        t.for_each(c.block, x, lambda b, item, key, _l: first(b, item, lambda b2, w: t.stmt(b2, t.b(
            "DictInsert", [dict_key(typ), dict_value(typ)], [out, key, t.widen_to(b2, w, dict_value(typ), c.path)],  # type: ignore[list-item]
            NullType, c.path))), c.path)
        c.emit(c.block, out)
        return
    if xt.type == "Struct":
        s = t.bind(c.block, x, "struct")
        fields: dict[str, A] = {}
        for name, f in fields_of(typ).items():
            value = t.field(s, name)
            fields[name] = t.bind(c.block, t.one(c.args[0], c.arg_paths[0], c.block, value, c.env, f), name)
        c.emit(c.block, t.struct(typ, fields))
        return
    _cannot(t, c, c.block, x, "an array, a dict or a struct")


rule("map_values", _map_values)


def _add_into(t: Translator, c: CallSite, b: Block, acc: A, v: A, typ: EastType) -> None:
    """``a + b`` for ``add``, as the checker types it: numbers, strings, arrays, dicts; struct merges."""
    o = t.open(v)
    ot = o.type
    if ot.type == "Null":
        return
    if nullable_payload(ot) is not None:
        t.match(b, o, {"some": lambda b2, p: _add_into(t, c, b2, acc, p, typ)}, c.path)
        return
    kind = typ.type
    if kind == "Integer":
        t.assign(b, acc, t.b("IntegerAdd", [], [acc, o], IntegerType, c.path))
    elif kind == "Float":
        t.assign(b, acc, t.b("FloatAdd", [], [acc, _float(t, b, o, c.path)], FloatType, c.path))
    elif kind == "String":
        t.assign(b, acc, t.concat(acc, o, c.path))
    elif kind == "Array":
        t.stmt(b, t.b("ArrayAppend", [typ.value], [acc, t.widen_to(b, o, typ, c.path)], NullType, c.path))
    elif kind == "Dict":
        t.for_each(b, t.widen_to(b, o, typ, c.path), lambda b2, value, key, _l: t.put(b2, acc, key, value, c.path), c.path)  # type: ignore[arg-type]
    else:
        # Structs of one type: the later one's fields win, which is all of them.
        payload = nullable_payload(typ)
        if payload is not None:
            t.assign(b, acc, t.some(t.widen_to(b, o, payload, c.path), typ))
            return
        raise t.gap(f"add of {print_type(ot)}")


def _add(t: Translator, c: CallSite) -> None:
    typ = _output_type(t, c)
    if typ.type == "Null":
        # The values' type has no identity to add: jq's null.
        if len(c.args) == 1:
            _arg(t, c, 0, c.block, c.x, lambda _b, _v: None)
        c.emit(c.block, t.null(c.path))
        return
    kind = typ.type
    if kind == "Integer":
        start = t.int_(0)
    elif kind == "Float":
        start = t.float_(0.0)
    elif kind == "String":
        start = t.str_("")
    elif kind == "Array":
        start = t.empty_array(typ.value)
    elif kind == "Dict":
        start = t.value({}, typ)
    else:
        start = t.none(typ)
    acc = t.declare(c.block, start, "sum")

    def each(b: Block, v: A) -> None:
        _add_into(t, c, b, acc, v, typ)
    if len(c.args) == 1:
        _arg(t, c, 0, c.block, c.x, each)
    else:
        t.iterate(c.block, _input(t, c), False, c.path, each)
    c.emit(c.block, acc)


rule("add", _add)


def _any_all(t: Translator, c: CallSite) -> None:
    is_any = c.name == "any"
    # any: true at the first true; all: false at the first false.
    result = t.declare(c.block, t.bool_(not is_any), "result")

    def test(b: Block, v: A, label: Label) -> None:
        truth = t.truthy(v, c.path)

        def decided(b2: Block) -> None:
            t.assign(b2, result, t.bool_(is_any))
            t.brk(b2, label)
        t.branch(b, truth if is_any else _negate(t, truth, c.path), decided, _nothing, c.path)

    def run(b: Block, label: Label) -> None:
        if len(c.args) == 2:
            _arg(t, c, 0, b, c.x, lambda b2, g: _arg(t, c, 1, b2, g, lambda b3, v: test(b3, v, label)))
        elif len(c.args) == 1:
            t.iterate(b, _input(t, c), False, c.path, lambda b2, item: _arg(t, c, 0, b2, item,
                                                                             lambda b3, v: test(b3, v, label)))
        else:
            t.iterate(b, _input(t, c), False, c.path, lambda b2, item: test(b2, item, label))
    t.once(c.block, run, c.path)
    c.emit(c.block, result)


rule(("any", "all"), _any_all)


def _flatten(t: Translator, c: CallSite) -> None:
    typ = _output_type(t, c)
    element = typ.value
    out = t.declare(c.block, t.empty_array(element), "flat")

    def into(b: Block, v: A) -> None:
        vt = t.open(v).type
        if type_equal(vt, element) or vt.type != "Array":
            t.push(b, out, v, c.path)
            return
        t.for_each(b, v, lambda b2, item, _k, _l: into(b2, item), c.path)
    t.for_each(c.block, _input(t, c), lambda b, item, _k, _l: into(b, item), c.path)
    c.emit(c.block, out)


rule("flatten", _flatten)


def _elements_of(t: Translator, c: CallSite, b: Block) -> A | None:
    """An array's elements as an array."""
    return t.as_array(b, t.open(_input(t, c)), c.path)


def _sort_by(t: Translator, c: CallSite, array: A, key_type: EastType, key: Callable[[A], A]) -> A:
    """Sorts an array by East's total order of a key the function gives each element."""
    element = array.type.value
    fn = t.lambda_([element], key_type, ["item"], lambda _bf, item: key(item), c.path)
    return t.b("ArraySort", [element, key_type], [array, fn], array.type, c.path)


def _sort(t: Translator, c: CallSite) -> None:
    array = _elements_of(t, c, c.block)
    if array is None:
        _cannot(t, c, c.block, _input(t, c), "an array")
        return
    element = array.type.value
    c.emit(c.block, _sort_by(t, c, array, element, lambda item: item))


rule("sort", _sort)


def _keyed(t: Translator, c: CallSite, b: Block) -> tuple[A, EastType, EastType] | None:
    """Each element with the key a filter gives it: the filter's one output, or the array of its outputs."""
    array = _elements_of(t, c, b)
    if array is None:
        _cannot(t, c, b, _input(t, c), "an array")
        return None
    element = array.type.value
    sample = t.placeholder(element)
    is_one = _arg_is_one(t, c, 0, sample)
    output_key = _arg_type(t, c, 0, sample)
    key_type = output_key if is_one else ArrayType(output_key)
    pair = StructType([("key", key_type), ("value", element)])
    pairs = t.declare(b, t.empty_array(pair), "keyed")

    def each(b2: Block, item: A, _k: A | None, _l: Label) -> None:
        if is_one:
            key = t.one(c.args[0], c.arg_paths[0], b2, item, c.env, key_type)
            t.push(b2, pairs, t.struct(pair, {"key": key, "value": item}), c.path)
            return
        keys = t.declare(b2, t.empty_array(output_key), "keys")
        _arg(t, c, 0, b2, item, lambda b3, k: t.push(b3, keys, k, c.path))
        t.push(b2, pairs, t.struct(pair, {"key": keys, "value": item}), c.path)
    t.for_each(b, array, each, c.path)
    return pairs, key_type, element


def _sort_pairs(t: Translator, c: CallSite, pairs: A, key_type: EastType) -> A:
    """Pairs sorted by their keys (stable)."""
    return _sort_by(t, c, pairs, key_type, lambda p: t.field(p, "key"))


def _sort_by_rule(t: Translator, c: CallSite) -> None:
    k = _keyed(t, c, c.block)
    if k is None:
        return
    pairs, key_type, element = k
    ordered = t.bind(c.block, _sort_pairs(t, c, pairs, key_type), "sorted")
    out = t.declare(c.block, t.empty_array(element), "sorted")
    t.for_each(c.block, ordered, lambda b, p, _k, _l: t.push(b, out, t.field(p, "value"), c.path), c.path, "pair")
    c.emit(c.block, out)


rule("sort_by", _sort_by_rule)


def _groups(t: Translator, c: CallSite, b: Block, k: tuple[A, EastType, EastType],
            each: Callable[[Block, A], None]) -> None:
    """Runs of equal keys in sorted pairs, as arrays of their values, in key order."""
    pairs, key_type, element = k
    ordered = t.bind(b, _sort_pairs(t, c, pairs, key_type), "sorted")
    group = t.declare(b, t.empty_array(element), "group")
    last = t.declare(b, t.none(OptionType(key_type)), "key")

    def step(b2: Block, p: A, _k: A | None, _l: Label) -> None:
        key = t.bind(b2, t.field(p, "key"), "key")
        same = t.match_value(last, {"none": lambda _b3, _p: t.bool_(False),
                                    "some": lambda _b3, previous: t.eq(previous, key, c.path)}, BooleanType, c.path)

        def new_key(b3: Block) -> None:
            def flush(b4: Block) -> None:
                each(b4, t.bind(b4, t.b("ArrayCopy", [element], [group], ArrayType(element), c.path), "group"))
                t.stmt(b4, t.b("ArrayClear", [element], [group], NullType, c.path))
            t.if_else(b3, t.lt(t.int_(0), t.size(group, c.path), c.path), flush, None, c.path)
            t.assign(b3, last, t.some(key, OptionType(key_type)))
        t.if_else(b2, t.not_(same, c.path), new_key, None, c.path)
        t.push(b2, group, t.field(p, "value"), c.path)
    t.for_each(b, ordered, step, c.path, "pair")
    t.if_else(b, t.lt(t.int_(0), t.size(group, c.path), c.path), lambda b2: each(b2, group), None, c.path)


def _group_by(t: Translator, c: CallSite) -> None:
    k = _keyed(t, c, c.block)
    if k is None:
        return
    out = t.declare(c.block, t.empty_array(ArrayType(k[2])), "groups")
    _groups(t, c, c.block, k, lambda b, group: t.push(b, out, group, c.path))
    c.emit(c.block, out)


rule("group_by", _group_by)


def _unique_by(t: Translator, c: CallSite) -> None:
    k = _keyed(t, c, c.block)
    if k is None:
        return
    element = k[2]
    out = t.declare(c.block, t.empty_array(element), "unique")
    _groups(t, c, c.block, k, lambda b, group: t.push(b, out, t.b("ArrayGet", [element], [group, t.int_(0)], element,
                                                                  c.path), c.path))
    c.emit(c.block, out)


rule("unique_by", _unique_by)


def _min_max_by(t: Translator, c: CallSite) -> None:
    k = _keyed(t, c, c.block)
    if k is None:
        return
    pairs, key_type, element = k
    is_min = c.name == "min_by"
    pair = pairs.type.value
    best = t.declare(c.block, t.none(OptionType(pair)), "best")

    def each(b: Block, p: A, _k: A | None, _l: Label) -> None:
        # The first least for min_by, the last greatest for max_by, as jq keeps them.
        def against(_b2: Block, current: A) -> A:
            if is_min:
                return t.lt(t.field(p, "key"), t.field(current, "key"), c.path)
            return t.b("GreaterEqual", [key_type], [t.field(p, "key"), t.field(current, "key")], BooleanType, c.path)
        better = t.match_value(best, {"none": lambda _b2, _p: t.bool_(True), "some": against}, BooleanType, c.path)
        t.if_else(b, better, lambda b2: t.assign(b2, best, t.some(p, OptionType(pair))), None, c.path)
    t.for_each(c.block, pairs, each, c.path, "pair")
    option = OptionType(element)
    out = _output_type(t, c)
    if nullable_payload(option) is not None:
        c.emit(c.block, t.match_value(best, {"none": lambda _b, _p: t.none(option),
                                             "some": lambda _b, current: t.some(t.field(current, "value"), option)},
                                      option, c.path))
        return
    # An element that can be null already is the answer as it is, and no element is its null.
    c.emit(c.block, t.match_value(best, {
        "none": lambda b, _p: t.widen_to(b, t.null(c.path), out, c.path),
        "some": lambda b, current: t.widen_to(b, t.field(current, "value"), out, c.path),
    }, out, c.path))


rule(("min_by", "max_by"), _min_max_by)


def _unique(t: Translator, c: CallSite) -> None:
    array = _elements_of(t, c, c.block)
    if array is None:
        _cannot(t, c, c.block, _input(t, c), "an array")
        return
    element = array.type.value
    ordered = t.bind(c.block, _sort_by(t, c, array, element, lambda item: item), "sorted")
    out = t.declare(c.block, t.empty_array(element), "unique")

    def each(b: Block, item: A, _k: A | None, _l: Label) -> None:
        size = t.bind(b, t.size(out, c.path), "size")
        repeat = t.if_value(t.lt(t.int_(0), size, c.path),
                            lambda _b2: t.eq(t.b("ArrayGet", [element], [out, t.add(size, t.int_(-1), c.path)], element,
                                                 c.path), item, c.path),
                            lambda _b2: t.bool_(False), BooleanType, c.path)
        t.if_else(b, t.not_(repeat, c.path), lambda b2: t.push(b2, out, item, c.path), None, c.path)
    t.for_each(c.block, ordered, each, c.path)
    c.emit(c.block, out)


rule("unique", _unique)


def _min_max(t: Translator, c: CallSite) -> None:
    array = _elements_of(t, c, c.block)
    if array is None:
        _cannot(t, c, c.block, _input(t, c), "an array")
        return
    element = array.type.value
    option = OptionType(element)
    best = t.declare(c.block, t.none(option), "best")

    def each(b: Block, item: A, _k: A | None, _l: Label) -> None:
        def against(_b2: Block, current: A) -> A:
            if c.name == "min":
                return t.lt(item, current, c.path)
            return t.b("GreaterEqual", [element], [item, current], BooleanType, c.path)
        better = t.match_value(best, {"none": lambda _b2, _p: t.bool_(True), "some": against}, BooleanType, c.path)
        t.if_else(b, better, lambda b2: t.assign(b2, best, t.some(item, option)), None, c.path)
    t.for_each(c.block, array, each, c.path)
    out = _output_type(t, c)
    if nullable_payload(option) is not None:
        c.emit(c.block, t.widen_to(c.block, best, out, c.path))
        return
    # An element that can be null already is the answer as it is, and no element is its null.
    c.emit(c.block, t.match_value(best, {"none": lambda b, _p: t.widen_to(b, t.null(c.path), out, c.path),
                                         "some": lambda b, v: t.widen_to(b, v, out, c.path)}, out, c.path))


rule(("min", "max"), _min_max)


def _reverse(t: Translator, c: CallSite) -> None:
    x = t.open(_input(t, c))
    xt = x.type
    if xt.type == "Null":
        c.emit(c.block, t.empty_array(_output_type(t, c).value))
        return
    if xt.type == "String":
        code_points = t.b("StringSplit", [], [x, t.str_("")], ArrayType(StringType), c.path)
        c.emit(c.block, t.b("ArrayStringJoin", [], [t.b("ArrayReverse", [StringType], [code_points], ArrayType(StringType),
                                                        c.path), t.str_("")], StringType, c.path))
        return
    array = t.as_array(c.block, x, c.path)
    if array is None:
        _cannot(t, c, c.block, x, "an array or a string")
        return
    c.emit(c.block, t.b("ArrayReverse", [array.type.value], [array], array.type, c.path))


rule("reverse", _reverse)


def _contains(t: Translator, c: CallSite, b: Block, a: A, a2: A) -> A:  # noqa: C901
    """Whether ``a`` holds ``a2``, as jq's ``contains`` decides it."""
    # Sets, vectors and matrices are arrays to jq.
    def array(v: A) -> A:
        if _array_like(v.type) and v.type.type != "Array":
            converted = t.as_array(b, v, c.path)
            assert converted is not None  # every array-like value has its array
            return converted
        return v

    va = array(t.open(a))
    vb = array(t.open(a2))
    ta = va.type
    tb = vb.type
    if ta.type == "String" and tb.type == "String":
        return t.b("StringContains", [], [va, vb], BooleanType, c.path)
    if ta.type == "Array" and tb.type == "Array":
        # `[]` is held by every array, and an empty array holds only `[]`.
        if tb.value.type == "Never":
            return t.bool_(True, c.path)
        if ta.value.type == "Never":
            return t.eq(t.size(vb, c.path), t.int_(0), c.path)
        outer = t.bind(b, va, "outer")
        every = t.declare(b, t.bool_(True), "contains")

        def per_wanted(b2: Block, wanted: A, _k: A | None, each_label: Label) -> None:
            found = t.declare(b2, t.bool_(False), "found")

            def per_item(b3: Block, item: A, _k2: A | None, inner: Label) -> None:
                def hit(b4: Block) -> None:
                    t.assign(b4, found, t.bool_(True))
                    t.brk(b4, inner)
                t.if_else(b3, _contains(t, c, b3, item, wanted), hit, None, c.path)
            t.for_each(b2, outer, per_item, c.path)

            def missing(b3: Block) -> None:
                t.assign(b3, every, t.bool_(False))
                t.brk(b3, each_label)
            t.if_else(b2, t.not_(found, c.path), missing, None, c.path)
        t.for_each(b, vb, per_wanted, c.path, "wanted")
        return every
    if ta.type == "Struct" and tb.type == "Struct":
        fields = fields_of(ta)
        outer = t.bind(b, va, "outer")
        inner = t.bind(b, vb, "inner")
        all_held: A | None = None
        for name in fields_of(tb):
            # A field the outer struct lacks is not held.
            if name not in fields:
                return t.bool_(False, c.path)
            held = t.bind(b, _contains(t, c, b, t.field(outer, name), t.field(inner, name)), "held")
            all_held = held if all_held is None else t.b("BooleanAnd", [], [all_held, held], BooleanType, c.path)
        return t.bool_(True, c.path) if all_held is None else all_held
    # `{}` is held by every dict.
    if ta.type == "Dict" and tb.type == "Struct":
        return t.bool_(True, c.path)
    if ta.type == "Dict" and tb.type == "Dict":
        k_type = dict_key(ta)
        v_type = dict_value(ta)
        outer = t.bind(b, va, "outer")
        every = t.declare(b, t.bool_(True), "contains")

        def per_entry(b2: Block, value: A, key: A | None, label: Label) -> None:
            def not_held(b3: Block, _p: A | None = None) -> None:
                t.assign(b3, every, t.bool_(False))
                t.brk(b3, label)
            t.match(b2, t.b("DictTryGet", [k_type, v_type], [outer, key], OptionType(v_type), c.path), {  # type: ignore[list-item]
                "none": not_held,
                "some": lambda b3, held: t.if_else(b3, t.not_(_contains(t, c, b3, held, value), c.path),
                                                   lambda b4: not_held(b4), None, c.path),
            }, c.path)
        t.for_each(b, vb, per_entry, c.path)
        return every
    # Values of two kinds (a lenient place lets them by) raise, as jq does.
    names_a = jq_type_names(ta)
    names_b = jq_type_names(tb)
    ka = names_a[0] if names_a else None
    kb = names_b[0] if names_b else None
    if ka != kb or (ka or "") in ("array", "object"):
        return t.failure(f"{ka or 'a value'} and {kb or 'a value'} cannot have their containment checked", c.path)
    return t.compare(b, "==", va, vb, c.path)


rule("contains", lambda t, c: _values(t, c, [0], c.block, lambda b, vs: t.give(b, _contains(t, c, b, _input(t, c), vs[0]),
                                                                              c.emit)))
rule("inside", lambda t, c: _values(t, c, [0], c.block, lambda b, vs: t.give(b, _contains(t, c, b, vs[0], _input(t, c)),
                                                                            c.emit)))


def _indices(t: Translator, c: CallSite, b: Block, s: A, sub: A) -> A:
    """Every index where a string occurs in another, overlapping ones included, in code points."""
    out = t.declare(b, t.empty_array(IntegerType), "indices")
    length = t.declare(b, t.b("StringLength", [], [s], IntegerType, c.path), "length", False)

    def search(b2: Block) -> None:
        start = t.declare(b2, t.int_(0), "from")

        def loop(b3: Block, label: Label) -> None:
            rest = t.b("StringSubstring", [], [s, start, length], StringType, c.path)
            at = t.declare(b3, t.b("StringIndexOf", [], [rest, sub], IntegerType, c.path), "at", False)
            t.if_else(b3, t.lt(at, t.int_(0), c.path), lambda b4: t.brk(b4, label), None, c.path)
            t.push(b3, out, t.add(start, at, c.path), c.path)
            t.assign(b3, start, t.add(t.add(start, at, c.path), t.int_(1), c.path))
        t.while_loop(b2, True, loop, c.path)
    t.if_else(b, t.lt(t.int_(0), t.b("StringLength", [], [sub], IntegerType, c.path), c.path), search, None, c.path)
    return out


def _indices_in(t: Translator, c: CallSite, b: Block, array: A, x: A) -> A:
    """Every position at which an array holds an element equal to a value, or a run of its elements."""
    out = t.declare(b, t.empty_array(IntegerType), "indices")
    a = t.bind(b, array, "array")
    element = a.type.value
    xo = t.open(x)
    if xo.type.type != "Array":
        t.for_each(b, a, lambda b2, item, index, _l: t.if_else(
            b2, t.compare(b2, "==", item, xo, c.path), lambda b3: t.push(b3, out, index, c.path), None, c.path), c.path)  # type: ignore[arg-type]
        return out
    run = t.bind(b, xo, "run")
    n = t.declare(b, t.size(run, c.path), "length", False)
    last = t.declare(b, t.b("IntegerSubtract", [], [t.size(a, c.path), n], IntegerType, c.path), "last", False)

    def search(b2: Block) -> None:
        i = t.declare(b2, t.int_(0), "start")

        def loop(b3: Block, _label: Label) -> None:
            same = t.declare(b3, t.bool_(True), "same")

            def each(b4: Block, wanted: A, k: A | None, label: Label) -> None:
                item = t.b("ArrayGet", [element], [a, t.add(i, k, c.path)], element, c.path)  # type: ignore[arg-type]

                def differ(b5: Block) -> None:
                    t.assign(b5, same, t.bool_(False))
                    t.brk(b5, label)
                t.if_else(b4, t.not_(t.compare(b4, "==", item, wanted, c.path), c.path), differ, None, c.path)
            t.for_each(b3, run, each, c.path, "wanted")
            t.if_else(b3, same, lambda b4: t.push(b4, out, i, c.path), None, c.path)
            t.assign(b3, i, t.add(i, t.int_(1), c.path))
        t.while_loop(b2, t.b("LessEqual", [IntegerType], [i, last], BooleanType, c.path), loop, c.path)
    t.if_else(b, t.lt(t.int_(0), n, c.path), search, None, c.path)
    return out


def _index_rule(t: Translator, c: CallSite) -> None:
    def with_sub(b: Block, vs: list[A]) -> None:
        sub = vs[0]
        x = t.open(_input(t, c))
        if x.type.type == "String":
            found_all = _indices(t, c, b, x, sub)
        else:
            array = t.as_array(b, x, c.path)
            assert array is not None  # the checker gives index an array-like input or a string
            found_all = _indices_in(t, c, b, array, sub)
        if c.name == "indices":
            c.emit(b, found_all)
            return
        option = OptionType(IntegerType)
        size = t.bind(b, t.size(found_all, c.path), "count")
        position = t.int_(0) if c.name == "index" else t.add(size, t.int_(-1), c.path)
        c.emit(b, t.if_value(t.eq(size, t.int_(0), c.path), lambda _b2: t.none(option),
                             lambda _b2: t.some(t.b("ArrayGet", [IntegerType], [found_all, position], IntegerType, c.path),
                                                option), option, c.path))
    _values(t, c, [0], c.block, with_sub)


rule(("index", "rindex", "indices"), _index_rule)


def _bsearch(t: Translator, c: CallSite) -> None:
    def with_target(b: Block, vs: list[A]) -> None:
        target = vs[0]
        array = _elements_of(t, c, b)
        if array is None:
            _cannot(t, c, b, _input(t, c), "a sorted array")
            return
        element = array.type.value
        common = _unify_or_fail(t, element, target.type)
        a = t.bind(b, array if type_equal(common, element) else t.widen_to(b, array, ArrayType(common), c.path),
                   "sorted")
        x = t.bind(b, t.widen_to(b, target, common, c.path), "target")
        identity = t.lambda_([common], common, ["item"], lambda _bf, item: item, c.path)
        # The first position whose element is not less than the target: where it is, or would be inserted.
        at = t.declare(b, t.b("ArrayFindSortedFirst", [common, common], [a, x, identity], IntegerType, c.path), "at",
                       False)
        found = t.declare(b, t.bool_(False), "found")
        t.if_else(b, t.lt(at, t.size(a, c.path), c.path), lambda b2: t.assign(
            b2, found, t.eq(t.b("ArrayGet", [common], [a, at], common, c.path), x, c.path)), None, c.path)
        # jq's −1 − the insertion point when the value is not there.
        c.emit(b, t.if_value(found, lambda _b2: at,
                             lambda _b2: t.b("IntegerSubtract", [], [t.int_(-1), at], IntegerType, c.path), IntegerType,
                             c.path))
    _values(t, c, [0], c.block, with_target)


rule("bsearch", _bsearch)


def _cell_text(t: Translator, b: Block, v: A, path: str, null_text: str, nan_text: str) -> A:
    """A scalar as text for join and the text formats.

    A string as it is, an Integer in decimal, a Float as jq writes a number, a
    boolean as ``true`` or ``false``, null as ``null_text``, and NaN as ``nan_text``.
    """
    o = t.open(v)
    ot = o.type
    if ot.type == "String":
        return o
    if ot.type == "Null":
        return t.str_(null_text, path)
    if nullable_payload(ot) is not None:
        return t.match_value(o, {"none": lambda _b2, _p: t.str_(null_text, path),
                                 "some": lambda b2, p: _cell_text(t, b2, p, path, null_text, nan_text)}, StringType, path)
    if ot.type == "Float":
        return _jq_number(t, b, o, path, nan_text)
    return t.b("Print", [ot], [o], StringType, path)


def _jq_number(t: Translator, b: Block, f: A, path: str, nan_text: str) -> A:
    """A Float as jq writes a number.

    −0.0 as ``-0``, ±Infinity as ``±1.7976931348623157e+308``, NaN as
    ``nan_text``, and any other as :func:`_jq_digits` writes it.
    """
    x = t.bind(b, f, "number")

    def text(s: str) -> Callable[[Block], A]:
        return lambda _b2: t.str_(s, path)

    def finite(b2: Block) -> A:
        return _jq_digits(t, b2, x, path)

    def not_negative_zero(_b2: Block) -> A:
        return t.if_value(t.eq(x, t.float_(-0.0), path), text("-0"), finite, StringType, path)

    def not_zero(_b2: Block) -> A:
        return t.if_value(t.eq(x, t.float_(0.0), path), text("0"), not_negative_zero, StringType, path)

    def not_negative_infinity(_b2: Block) -> A:
        return t.if_value(t.eq(x, t.float_(-math.inf), path), text("-1.7976931348623157e+308"), not_zero, StringType,
                          path)

    def not_infinity(_b2: Block) -> A:
        return t.if_value(t.eq(x, t.float_(math.inf), path), text("1.7976931348623157e+308"), not_negative_infinity,
                          StringType, path)
    return t.if_value(t.is_nan(x, path), text(nan_text), not_infinity, StringType, path)


def _jq_digits(t: Translator, b: Block, x: A, path: str) -> A:
    """A finite, non-zero Float as jq 1.8 writes one it computed (``jvp_dtoa_fmt``).

    The shortest digits that read back as it, which East's JSON writes too;
    placed fixed-point, or as ``d.ddde±XX`` (at least two exponent digits)
    where the decimal point falls four or more places before the digits, or
    more than fifteen past their end. So ``0.0001``, ``1e-05``, ``1e+16``,
    ``123456789012345680000`` and ``1.5e+300``.
    """
    s_type = StringType
    i_type = IntegerType

    def length(s: A) -> A:
        return t.b("StringLength", [], [s], i_type, path)

    def slice_(s: A, start: A, end: A) -> A:
        return t.b("StringSubstring", [], [s, start, end], s_type, path)

    def strip(s: A, pattern: str) -> A:
        return t.b("RegexReplace", [], [s, t.str_(pattern), t.str_(""), t.str_("")], s_type, path)

    def minus(a: A, a2: A) -> A:
        return t.b("IntegerSubtract", [], [a, a2], i_type, path)

    def at_most(a: A, a2: A) -> A:
        return t.b("LessEqual", [i_type], [a, a2], BooleanType, path)

    def zeros(n: A) -> A:
        return t.b("StringRepeat", [], [t.str_("0"), n], s_type, path)

    # East's JSON of the number: an optional -, digits with an optional point, and an optional exponent.
    json = t.bind(b, t.b("StringPrintJSON", [FloatType], [x], s_type, path), "json")
    negative = t.bind(b, t.b("StringStartsWith", [], [json, t.str_("-")], BooleanType, path), "negative")
    body = t.bind(b, t.if_value(negative, lambda _b2: slice_(json, t.int_(1), length(json)), lambda _b2: json, s_type,
                                path), "body")
    e = t.bind(b, t.b("StringIndexOf", [], [body, t.str_("e")], i_type, path), "e")
    mantissa = t.bind(b, t.if_value(t.lt(e, t.int_(0), path), lambda _b2: body, lambda _b2: slice_(body, t.int_(0), e),
                                    s_type, path), "mantissa")
    exponent = t.bind(b, t.if_value(
        t.lt(e, t.int_(0), path), lambda _b2: t.int_(0),
        lambda _b2: t.b("Parse", [i_type], [t.b("StringReplace", [], [
            slice_(body, t.add(e, t.int_(1), path), length(body)), t.str_("+"), t.str_("")], s_type, path)], i_type, path),
        i_type, path), "exponent")
    dot = t.bind(b, t.b("StringIndexOf", [], [mantissa, t.str_(".")], i_type, path), "dot")
    whole = t.bind(b, t.if_value(t.lt(dot, t.int_(0), path), lambda _b2: mantissa,
                                 lambda _b2: slice_(mantissa, t.int_(0), dot), s_type, path), "whole")
    fraction = t.bind(b, t.if_value(t.lt(dot, t.int_(0), path), lambda _b2: t.str_(""),
                                    lambda _b2: slice_(mantissa, t.add(dot, t.int_(1), path), length(mantissa)), s_type,
                                    path), "fraction")
    # The significant digits, and where the decimal point falls among them.
    all_digits = t.bind(b, t.concat(whole, fraction, path), "all")
    lead = t.bind(b, strip(all_digits, "^0+"), "lead")
    digits = t.bind(b, strip(lead, "0+$"), "digits")
    count = t.bind(b, length(digits), "count")
    point = t.bind(b, minus(t.add(length(whole), exponent, path), minus(length(all_digits), length(lead))), "point")
    exponential = t.b("BooleanOr", [], [at_most(point, t.int_(-4)), t.lt(t.add(count, t.int_(15), path), point, path)],
                      BooleanType, path)

    def scientific(b2: Block) -> A:
        power = t.bind(b2, t.add(point, t.int_(-1), path), "power")
        magnitude = t.bind(b2, t.b("Print", [i_type], [t.b("IntegerAbs", [], [power], i_type, path)], s_type, path),
                           "magnitude")
        first = t.if_value(t.lt(t.int_(1), count, path),
                           lambda _b3: t.concat(t.concat(slice_(digits, t.int_(0), t.int_(1)), t.str_("."), path),
                                                slice_(digits, t.int_(1), count), path),
                           lambda _b3: digits, s_type, path)
        sign = t.if_value(t.lt(power, t.int_(0), path), lambda _b3: t.str_("e-"), lambda _b3: t.str_("e+"), s_type, path)
        padded = t.if_value(t.lt(length(magnitude), t.int_(2), path), lambda _b3: t.concat(t.str_("0"), magnitude, path),
                            lambda _b3: magnitude, s_type, path)
        return t.concat(t.concat(first, sign, path), padded, path)

    def fixed(_b2: Block) -> A:
        return t.if_value(
            at_most(point, t.int_(0)),
            lambda _b3: t.concat(t.concat(t.str_("0."), zeros(minus(t.int_(0), point)), path), digits, path),
            lambda _b3: t.if_value(
                at_most(count, point),
                lambda _b4: t.concat(digits, zeros(minus(point, count)), path),
                lambda _b4: t.concat(t.concat(slice_(digits, t.int_(0), point), t.str_("."), path),
                                     slice_(digits, point, count), path),
                s_type, path),
            s_type, path)
    text = t.bind(b, t.if_value(exponential, scientific, fixed, s_type, path), "text")
    return t.if_value(negative, lambda _b2: t.concat(t.str_("-"), text, path), lambda _b2: text, s_type, path)


def _join(t: Translator, c: CallSite) -> None:
    def with_sep(b: Block, vs: list[A]) -> None:
        parts = t.declare(b, t.empty_array(StringType), "parts")
        # jq's join writes a number as tojson does: NaN as null.
        t.for_each(b, _input(t, c), lambda b2, item, _k, _l: t.push(
            b2, parts, _cell_text(t, b2, item, c.path, "", "null"), c.path), c.path)
        c.emit(b, t.b("ArrayStringJoin", [], [parts, vs[0]], StringType, c.path))
    _values(t, c, [0], c.block, with_sep)


rule("join", _join)

# ─── Types and conversion ────────────────────────────────────────────────


def _type(t: Translator, c: CallSite) -> None:
    x = t.open(_input(t, c))
    payload = nullable_payload(x.type)
    if payload is not None:
        names = jq_type_names(payload)
        name = names[0] if names else "null"
        c.emit(c.block, t.match_value(x, {"none": lambda _b, _p: t.str_("null", c.path),
                                          "some": lambda _b, _p: t.str_(name, c.path)}, StringType, c.path))
        return
    names = jq_type_names(x.type)
    c.emit(c.block, t.str_(names[0] if names else "null", c.path))


rule("type", _type)


def _selector(keep: Callable[[EastType], str],
              test: Callable[[Translator, Block, A, str], A] | None = None) -> BuiltinRule:
    """A type selector: the input when its kind is kept; ``maybe`` tests the value itself."""
    def typing(t: Translator, c: CallSite) -> None:
        x = t.open(_input(t, c))
        xt = x.type

        def emit_kept(b: Block, v: A, verdict: str) -> None:
            if verdict == "keep":
                c.emit(b, v)
                return
            if verdict == "maybe" and test is not None:
                t.if_else(b, test(t, b, v, c.path), lambda b2: c.emit(b2, v), None, c.path)
        payload = nullable_payload(xt)
        if payload is not None:
            inner = keep(unwrap(payload))
            null_kept = keep(NullType)
            if inner == "drop" and null_kept == "drop":
                return
            if inner != "drop" and null_kept != "drop":
                c.emit(c.block, x)
                return

            def on_none(b: Block, _p: A) -> None:
                if null_kept != "drop":
                    c.emit(b, t.null(c.path))
            t.match(c.block, x, {"none": on_none, "some": lambda b, p: emit_kept(b, p, inner)}, c.path)
            return
        emit_kept(c.block, x, keep(xt))
    return typing


def _is_scalar(typ: EastType) -> bool:
    u = unwrap(typ)
    payload = nullable_payload(u)
    if payload is not None:
        return _is_scalar(payload)
    return u.type not in ("Array", "Set", "Dict", "Struct", "Vector", "Matrix", "Variant")


def _array_like(typ: EastType) -> bool:
    return typ.type in ("Array", "Set", "Vector", "Matrix")


def _is_nan(t: Translator, b: Block, v: A, path: str) -> A:
    """Whether a number is NaN."""
    return t.is_nan(_float(t, b, v, path), path)


def _is_infinite(t: Translator, b: Block, v: A, path: str) -> A:
    f = t.bind(b, _float(t, b, v, path), "number")
    return t.b("BooleanOr", [], [t.eq(f, t.float_(math.inf), path), t.eq(f, t.float_(-math.inf), path)], BooleanType, path)


def _is_infinite_or_nan(t: Translator, b: Block, v: A, path: str) -> A:
    return t.b("BooleanOr", [], [_is_infinite(t, b, v, path), _is_nan(t, b, v, path)], BooleanType, path)


def _is_normal(t: Translator, b: Block, v: A, path: str) -> A:
    f = t.bind(b, _float(t, b, v, path), "number")
    magnitude = t.b("FloatAbs", [], [f], FloatType, path)
    return t.b("BooleanAnd", [], [t.not_(_is_infinite_or_nan(t, b, f, path), path),
                                  t.b("GreaterEqual", [FloatType], [magnitude, t.float_(2.0 ** -1022)], BooleanType, path)],
               BooleanType, path)


rule("arrays", _selector(lambda ty: "keep" if _array_like(ty) else "drop"))
rule("objects", _selector(lambda ty: "keep" if ty.type in ("Struct", "Dict", "Variant") else "drop"))
rule("iterables", _selector(lambda ty: "keep" if _array_like(ty) or ty.type in ("Struct", "Dict") else "drop"))
rule("booleans", _selector(lambda ty: "keep" if ty.type == "Boolean" else "drop"))
rule("numbers", _selector(lambda ty: "keep" if _is_number(ty) else "drop"))
rule("strings", _selector(lambda ty: "keep" if ty.type == "String" else "drop"))
rule("nulls", _selector(lambda ty: "keep" if ty.type == "Null" else "drop"))
rule("values", _selector(lambda ty: "drop" if ty.type == "Null" else "keep"))
rule("scalars", _selector(lambda ty: "keep" if _is_scalar(ty) else "drop"))
rule("normals", _selector(lambda ty: "maybe" if _is_number(ty) else "drop", _is_normal))
rule("finites", _selector(lambda ty: "keep" if ty.type == "Integer" else "maybe" if ty.type == "Float" else "drop",
                          lambda t, b, v, path: t.not_(_is_infinite_or_nan(t, b, v, path), path)))
rule("tostring", lambda t, c: c.emit(c.block, t.tostring(c.block, _input(t, c), c.path)))


def _tojson(t: Translator, v: A, path: str) -> A:
    """East's JSON text of a value."""
    o = t.open(v)
    return t.b("StringPrintJSON", [o.type], [o], StringType, path)


rule("tojson", lambda t, c: c.emit(c.block, _tojson(t, _input(t, c), c.path)))


def _tonumber(t: Translator, c: CallSite) -> None:
    x = t.open(_input(t, c))
    if _is_number(x.type):
        c.emit(c.block, x)
        return
    c.emit(c.block, t.b("Parse", [FloatType], [x], FloatType, c.path))


rule("tonumber", _tonumber)


def _toboolean(t: Translator, c: CallSite) -> None:
    x = t.open(_input(t, c))
    if x.type.type == "Boolean":
        c.emit(c.block, x)
        return
    c.emit(c.block, t.b("Parse", [BooleanType], [x], BooleanType, c.path))


rule("toboolean", _toboolean)


def _builtins(t: Translator, c: CallSite) -> None:
    names: list[str] = []
    for name, b in BUILTINS.items():
        if name.startswith("@") or not (b.status == "supported" or (b.status == "tooling" and t.tooling)):
            continue
        for arity in b.arities:
            names.append(f"{name}/{arity}")
    c.emit(c.block, t.value(_sorted_strings(names), ArrayType(StringType), c.path))


rule("builtins", _builtins)
rule("infinite", lambda t, c: c.emit(c.block, t.float_(math.inf, c.path)))
rule("nan", lambda t, c: c.emit(c.block, t.float_(math.nan, c.path)))
rule("isinfinite", lambda t, c: c.emit(c.block, _is_infinite(t, c.block, _input(t, c), c.path)))
rule("isnan", lambda t, c: c.emit(c.block, _is_nan(t, c.block, _input(t, c), c.path)))
rule("isnormal", lambda t, c: c.emit(c.block, _is_normal(t, c.block, _input(t, c), c.path)))
# jq's own definition: a number that is not infinite, so NaN is finite.
rule("isfinite", lambda t, c: c.emit(c.block, t.not_(_is_infinite(t, c.block, _input(t, c), c.path), c.path)))


def _abs(t: Translator, c: CallSite) -> None:
    # jq's `if . < 0 then -. else . end`: a value above every number is given back; null and a boolean raise.
    x = t.open(_input(t, c))
    xt = x.type
    if xt.type == "Integer":
        c.emit(c.block, t.b("IntegerAbs", [], [x], IntegerType, c.path))
    elif xt.type == "Float":
        c.emit(c.block, t.b("FloatAbs", [], [x], FloatType, c.path))
    elif xt.type in ("Null", "Boolean"):
        t.negate(c.block, x, c.path, c.emit)
    else:
        c.emit(c.block, x)


rule("abs", _abs)

# ─── Strings ─────────────────────────────────────────────────────────────


def _on_string(indices: list[int], body: Callable[[Translator, CallSite, Block, A, list[A]], None]) -> BuiltinRule:
    """A rule on a string input with value arguments."""
    def typing(t: Translator, c: CallSite) -> None:
        def with_args(b: Block, args: list[A]) -> None:
            s = t.open(_input(t, c))
            if s.type.type != "String":
                _cannot(t, c, b, s, "a string")
                return
            body(t, c, b, s, args)
        _values(t, c, indices, c.block, with_args)
    return typing


rule("startswith", _on_string([0], lambda t, c, b, s, args: c.emit(b, t.b("StringStartsWith", [], [s, args[0]],
                                                                            BooleanType, c.path))))
rule("endswith", _on_string([0], lambda t, c, b, s, args: c.emit(b, t.b("StringEndsWith", [], [s, args[0]],
                                                                          BooleanType, c.path))))


def _trim_start(t: Translator, _b: Block, s: A, prefix: A, path: str) -> A:
    """A string without a prefix, when it has it."""
    return t.if_value(t.b("StringStartsWith", [], [s, prefix], BooleanType, path),
                      lambda _b2: t.b("StringSubstring", [], [s, t.b("StringLength", [], [prefix], IntegerType, path),
                                                              t.b("StringLength", [], [s], IntegerType, path)], StringType,
                                      path),
                      lambda _b2: s, StringType, path)


def _trim_end(t: Translator, _b: Block, s: A, suffix: A, path: str) -> A:
    return t.if_value(t.b("StringEndsWith", [], [s, suffix], BooleanType, path),
                      lambda _b2: t.b("StringSubstring", [], [s, t.int_(0), t.b(
                          "IntegerSubtract", [], [t.b("StringLength", [], [s], IntegerType, path),
                                                  t.b("StringLength", [], [suffix], IntegerType, path)], IntegerType,
                          path)], StringType, path),
                      lambda _b2: s, StringType, path)


def _trims(t: Translator, c: CallSite, b: Block, x: A, args: list[A]) -> None:
    s = t.bind(b, x, "string")
    affix = args[0]
    if c.name == "ltrimstr":
        c.emit(b, _trim_start(t, b, s, affix, c.path))
        return
    if c.name == "rtrimstr":
        c.emit(b, _trim_end(t, b, s, affix, c.path))
        return
    c.emit(b, _trim_end(t, b, t.bind(b, _trim_start(t, b, s, affix, c.path), "trimmed"), affix, c.path))


rule(("ltrimstr", "rtrimstr", "trimstr"), _on_string([0], _trims))


def _string_builtin(builtin: str) -> Callable[[Translator, CallSite, Block, A, list[A]], None]:
    """A rule's body calling a builtin of the string alone."""
    def body(t: Translator, c: CallSite, b: Block, s: A, _args: list[A]) -> None:
        c.emit(b, t.b(builtin, [], [s], StringType, c.path))
    return body


for _name, _builtin in (("trim", "StringTrim"), ("ltrim", "StringTrimStart"), ("rtrim", "StringTrimEnd"),
                        ("ascii_downcase", "StringLowerCase"), ("ascii_upcase", "StringUpperCase")):
    rule(_name, _on_string([], _string_builtin(_builtin)))
rule("split", _on_string([0], lambda t, c, b, s, args: c.emit(b, t.split(b, s, args[0], c.path))))


def _regex_flags(t: Translator, c: CallSite, i: int | None) -> tuple[str, bool]:
    """A regex's flags, as written in the query: East's ``i`` when jq's is there, and whether ``g`` is."""
    if i is None:
        return "", False
    literal = t.literal_of(c.args[i])
    text = literal[1] if literal is not None and isinstance(literal[1], str) else ""
    return ("i" if "i" in text else ""), "g" in text


def _test(t: Translator, c: CallSite) -> None:
    flags, _global = _regex_flags(t, c, 1 if len(c.args) == 2 else None)

    def with_pattern(b: Block, vs: list[A]) -> None:
        s = t.open(_input(t, c))
        if s.type.type != "String":
            _cannot(t, c, b, s, "a string")
            return
        c.emit(b, t.b("RegexContains", [], [s, vs[0], t.str_(flags)], BooleanType, c.path))
    _values(t, c, [0], c.block, with_pattern)


rule("test", _test)


def _sub(t: Translator, c: CallSite) -> None:
    flags, is_global = _regex_flags(t, c, 2 if len(c.args) == 3 else None)
    every = c.name == "gsub" or is_global

    def with_pattern(b: Block, vs: list[A]) -> None:
        pattern = vs[0]
        s = t.open(_input(t, c))
        if s.type.type != "String":
            _cannot(t, c, b, s, "a string")
            return
        # East's replace is global; `sub` anchors a lazy prefix so only the first match is replaced.
        re = pattern if every else t.concat(t.concat(t.str_("^([\\s\\S]*?)(?:"), pattern, c.path), t.str_(")"), c.path)
        replacement = t.bind(b, _replacement_of(t, c, b), "replacement")
        full = replacement if every else t.concat(t.str_("$1"), replacement, c.path)
        c.emit(b, t.b("RegexReplace", [], [s, re, t.str_(flags), full], StringType, c.path))
    _values(t, c, [0], c.block, with_pattern)


rule(("sub", "gsub"), _sub)


def _replacement_of(t: Translator, c: CallSite, b: Block) -> A:
    """A sub/gsub replacement as East's replacement text: ``$`` doubled, each ``\\(.name)`` as ``$<name>``."""
    n = c.args[1]

    def escape(text: str) -> str:
        return text.replace("$", "$$")

    def part(p: JqNode) -> A:
        if p.type == "field":
            return t.str_(f"$<{p.value['name']}>")
        if p.type == "variable":
            bound = c.env.vars.get(p.value)
            if bound is None:
                raise t.gap(f"${p.value} is not bound")
            return t.b("StringReplace", [], [t.tostring(b, t.expr(bound, c.path), c.path), t.str_("$"), t.str_("$$")],
                       StringType, c.path)
        raise t.gap(f"a replacement of {p.type}")
    if n.type == "literal":
        return t.str_(escape(t.literal(n)[1]))
    if n.type == "string":
        acc = t.str_("")
        for p in n.value:
            acc = t.concat(acc, t.str_(escape(p.value)) if p.type == "text" else part(p.value), c.path)
        return acc
    return part(n)


def _format(t: Translator, c: CallSite) -> None:
    literal = t.literal_of(c.args[0])
    name = literal[1] if literal is not None else ""
    fmt = FORMATS.get(name)
    if fmt is None:
        raise t.gap(f'format("{name}")')
    c.emit(c.block, fmt(t, c.block, _input(t, c), c.path))


rule("format", _format)

# ─── Formats ─────────────────────────────────────────────────────────────

#: A format: a value as text.
Format = Callable[["Translator", "Block", A, str], A]


def _replace_all(t: Translator, s: A, pairs: list[tuple[str, str]], path: str) -> A:
    """Replaces each of some characters in a string."""
    out = s
    for old, new in pairs:
        out = t.b("StringReplace", [], [out, t.str_(old), t.str_(new)], StringType, path)
    return out


def _cells(t: Translator, b: Block, v: A, path: str, cell: Callable[[Block, A], A], separator: str) -> A:
    """Each cell of an array of scalars as text, joined."""
    parts = t.declare(b, t.empty_array(StringType), "cells")
    t.for_each(b, v, lambda b2, item, _k, _l: t.push(b2, parts, cell(b2, item), path), path)
    return t.b("ArrayStringJoin", [], [parts, t.str_(separator)], StringType, path)


def _is_string_cell(t: Translator, v: A) -> bool:
    """Whether a scalar is a string, through its option."""
    ot = t.open(v).type
    payload = nullable_payload(ot)
    return (ot if payload is None else payload).type == "String"


def _string_cell(t: Translator, v: A, f: Callable[[A], A], path: str, null_text: str) -> A:
    """A string cell's text: ``f`` of the string, or ``null_text`` for an absent one."""
    o = t.open(v)
    if nullable_payload(o.type) is None:
        return f(o)
    return t.match_value(o, {"none": lambda _b2, _p: t.str_(null_text, path), "some": lambda _b2, s: f(s)}, StringType, path)


# RFC 4648's alphabet.
_BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"


def _bytes_of(t: Translator, b: Block, v: A, path: str) -> A:
    """The bytes ``@base64`` encodes: a Blob's own, or the UTF-8 of any other value's text."""
    o = t.open(v)
    ot = o.type
    if ot.type == "Blob":
        return o
    payload = nullable_payload(ot)
    if payload is not None and unwrap(payload).type == "Blob":
        return t.match_value(o, {
            "none": lambda _b2, _p: t.b("StringEncodeUtf8", [], [t.str_("null", path)], BlobType, path),
            "some": lambda b2, p: _bytes_of(t, b2, p, path),
        }, BlobType, path)
    return t.b("StringEncodeUtf8", [], [t.tostring(b, o, path)], BlobType, path)


def _base_encode(t: Translator, b: Block, v: A, path: str, alphabet: str, bits: int, group: int) -> A:
    """Base-2ᵏ text of a value's bytes, RFC 4648 with padding: ``bits`` bits a character, in groups of ``group`` bytes."""
    data = t.declare(b, _bytes_of(t, b, v, path), "bytes", False)
    size = t.declare(b, t.b("BlobSize", [], [data], IntegerType, path), "size", False)
    letters = t.declare(b, t.value(list(alphabet), ArrayType(StringType), path), "alphabet", False)
    out = t.declare(b, t.empty_array(StringType), "letters")
    chars = (group * 8) // bits
    i = t.declare(b, t.int_(0), "i")

    def body(b2: Block, _label: Label) -> None:
        # The group's bytes as one integer, then its characters, the unused ones padding.
        n = t.declare(b2, t.int_(0), "group")
        used = t.declare(b2, t.int_(0), "used")
        for k in range(group):
            at = t.add(i, t.int_(k), path)
            t.assign(b2, n, t.b("IntegerMultiply", [], [n, t.int_(256)], IntegerType, path))

            def take(b3: Block, k: int = k) -> None:
                t.assign(b3, n, t.add(n, t.b("BlobGetUint8", [], [data, t.add(i, t.int_(k), path)], IntegerType, path),
                                      path))
                t.assign(b3, used, t.add(used, t.int_(1), path))
            t.if_else(b2, t.lt(at, size, path), take, None, path)
        # A group of `used` bytes gives ceil(used × 8 / bits) characters.
        shown = t.declare(b2, t.b("IntegerDivide", [], [t.add(t.b("IntegerMultiply", [], [used, t.int_(8)], IntegerType,
                                                                    path), t.int_(bits - 1), path), t.int_(bits)],
                                  IntegerType, path), "shown", False)
        for k in range(chars):
            shift = bits * (chars - 1 - k)
            index = t.b("IntegerRemainder", [], [t.b("IntegerDivide", [], [n, t.int_(2 ** shift)], IntegerType, path),
                                                 t.int_(2 ** bits)], IntegerType, path)

            def letter(b3: Block, index: A = index) -> None:
                t.push(b3, out, t.b("ArrayGet", [StringType], [letters, index], StringType, path), path)
            t.if_else(b2, t.lt(t.int_(k), shown, path), letter, lambda b3: t.push(b3, out, t.str_("="), path), path)
        t.assign(b2, i, t.add(i, t.int_(group), path))
    t.while_loop(b, t.lt(i, size, path), body, path)
    return t.b("ArrayStringJoin", [], [out, t.str_("")], StringType, path)


def _uri_table() -> list[str]:
    """The text each byte is percent-encoded as, or kept as: jq's unreserved characters."""
    table: list[str] = []
    for byte in range(256):
        ch = chr(byte)
        table.append(ch if (ch.isascii() and (ch.isalnum() or ch in "-_.~")) else f"%{byte:02X}")
    return table


def _uri(t: Translator, b: Block, v: A, path: str) -> A:
    data = t.declare(b, t.b("StringEncodeUtf8", [], [t.tostring(b, v, path)], BlobType, path), "bytes", False)
    table = t.declare(b, t.value(_uri_table(), ArrayType(StringType), path), "encoded", False)
    out = t.declare(b, t.empty_array(StringType), "parts")
    i = t.declare(b, t.int_(0), "i")

    def body(b2: Block, _label: Label) -> None:
        t.push(b2, out, t.b("ArrayGet", [StringType], [table, t.b("BlobGetUint8", [], [data, i], IntegerType, path)],
                            StringType, path), path)
        t.assign(b2, i, t.add(i, t.int_(1), path))
    t.while_loop(b, t.lt(i, t.b("BlobSize", [], [data], IntegerType, path), path), body, path)
    return t.b("ArrayStringJoin", [], [out, t.str_("")], StringType, path)


# jq writes NaN in a CSV or TSV cell as nothing, and elsewhere as null.
def _csv_cell(t: Translator, b: Block, item: A, path: str) -> A:
    if _is_string_cell(t, item):
        return _string_cell(t, item, lambda s: t.concat(t.concat(t.str_('"'), _replace_all(t, s, [('"', '""')], path), path),
                                                         t.str_('"'), path), path, "")
    return _cell_text(t, b, item, path, "", "")


def _tsv_cell(t: Translator, b: Block, item: A, path: str) -> A:
    if _is_string_cell(t, item):
        return _string_cell(t, item, lambda s: _replace_all(t, s, [("\\", "\\\\"), ("\t", "\\t"), ("\n", "\\n"),
                                                                   ("\r", "\\r")], path), path, "")
    return _cell_text(t, b, item, path, "", "")


def _sh(t: Translator, b: Block, v: A, path: str) -> A:
    def quote(s: A) -> A:
        return t.concat(t.concat(t.str_("'"), _replace_all(t, s, [("'", "'\\''")], path), path), t.str_("'"), path)

    def cell(b2: Block, item: A) -> A:
        if _is_string_cell(t, item):
            return _string_cell(t, item, quote, path, "null")
        return _cell_text(t, b2, item, path, "null", "null")
    o = t.open(v)
    if not _array_like(o.type):
        return cell(b, o)
    return _cells(t, b, o, path, cell, " ")


#: Each format, by name.
FORMATS: dict[str, Format] = {
    "text": lambda t, b, v, path: t.tostring(b, v, path),
    "json": lambda t, _b, v, path: _tojson(t, v, path),
    "html": lambda t, b, v, path: _replace_all(t, t.tostring(b, v, path), [
        ("&", "&amp;"), ("<", "&lt;"), (">", "&gt;"), ("'", "&apos;"), ('"', "&quot;")], path),
    "uri": _uri,
    "base64": lambda t, b, v, path: _base_encode(t, b, v, path, _BASE64, 6, 3),
    "csv": lambda t, b, v, path: _cells(t, b, v, path, lambda b2, item: _csv_cell(t, b2, item, path), ","),
    "tsv": lambda t, b, v, path: _cells(t, b, v, path, lambda b2, item: _tsv_cell(t, b2, item, path), "\t"),
    "sh": _sh,
}

def _format_rule(name: str) -> BuiltinRule:
    """A format called by name: ``@base64``."""
    def run(t: Translator, c: CallSite) -> None:
        c.emit(c.block, FORMATS[name](t, c.block, _input(t, c), c.path))
    return run


# Formats called by name, `@base64`, and through `format("base64")`.
for _format_name in FORMATS:
    rule(f"@{_format_name}", _format_rule(_format_name))

# ─── Math ────────────────────────────────────────────────────────────────

for _name, _fn in (("floor", "roundFloor"), ("ceil", "roundCeil"), ("round", "roundHalf"), ("trunc", "roundTrunc")):
    def _rounding(t: Translator, c: CallSite, fn: str = _fn) -> None:
        x = t.open(_input(t, c))
        c.emit(c.block, x if x.type.type == "Integer" else t.round(fn, x, c.block, c.path))
    rule(_name, _rounding)

def _float_builtin(builtin: str) -> BuiltinRule:
    """A builtin of a number, as a Float."""
    def run(t: Translator, c: CallSite) -> None:
        c.emit(c.block, t.b(builtin, [], [_float(t, c.block, _input(t, c), c.path)], FloatType, c.path))
    return run


for _name, _builtin in (("sqrt", "FloatSqrt"), ("log", "FloatLog"), ("exp", "FloatExp"), ("sin", "FloatSin"),
                        ("cos", "FloatCos"), ("tan", "FloatTan"), ("fabs", "FloatAbs")):
    rule(_name, _float_builtin(_builtin))


def _logs(t: Translator, c: CallSite) -> None:
    base = 2.0 if c.name == "log2" else 10.0
    x = _float(t, c.block, _input(t, c), c.path)
    c.emit(c.block, t.b("FloatDivide", [], [t.b("FloatLog", [], [x], FloatType, c.path),
                                           t.b("FloatLog", [], [t.float_(base)], FloatType, c.path)], FloatType, c.path))


rule(("log2", "log10"), _logs)
rule(("exp2", "exp10"), lambda t, c: c.emit(c.block, t.b("FloatPow", [], [t.float_(2.0 if c.name == "exp2" else 10.0),
                                                                          _float(t, c.block, _input(t, c), c.path)],
                                                         FloatType, c.path)))


def _math2(t: Translator, c: CallSite) -> None:
    def with_args(b: Block, vs: list[A]) -> None:
        x = t.bind(b, _float(t, b, vs[0], c.path), "a")
        y = t.bind(b, _float(t, b, vs[1], c.path), "b")
        if c.name == "pow":
            c.emit(b, t.b("FloatPow", [], [x, y], FloatType, c.path))
        elif c.name == "fmod":
            c.emit(b, t.b("FloatRemainder", [], [x, y], FloatType, c.path))
        elif c.name == "fmin":
            # As C's: a NaN gives the other number. East orders NaN above every number.
            c.emit(b, t.if_value(t.lt(y, x, c.path), lambda _b2: y, lambda _b2: x, FloatType, c.path))
        else:
            other = t.b("BooleanOr", [], [_is_nan(t, b, y, c.path), t.lt(y, x, c.path)], BooleanType, c.path)
            c.emit(b, t.if_value(_is_nan(t, b, x, c.path), lambda _b2: y,
                                 lambda _b2: t.if_value(other, lambda _b3: x, lambda _b3: y, FloatType, c.path), FloatType,
                                 c.path))
    _values(t, c, [0, 1], c.block, with_args)


rule(("pow", "fmin", "fmax", "fmod"), _math2)

# ─── DateTime ────────────────────────────────────────────────────────────


def _rfc3339_tokens() -> list[Any]:
    """RFC 3339 as East's JSON writes a DateTime: ``2026-09-07T00:00:00.000+00:00``."""
    from east.types.values import EastVariant, east_null

    def tok(case: str) -> Any:
        return EastVariant(case, east_null)

    def lit(text: str) -> Any:
        return EastVariant("literal", text)
    return [tok("year4"), lit("-"), tok("month2"), lit("-"), tok("day2"), lit("T"), tok("hour24_2"), lit(":"),
            tok("minute2"), lit(":"), tok("second2"), lit("."), tok("millisecond3"), lit("+00:00")]


def _date_of(t: Translator, b: Block, v: A, path: str) -> A:
    """A DateTime, or epoch seconds as jq's date builtins take them."""
    o = t.open(v)
    ot = o.type
    if ot.type == "DateTime":
        return o
    if ot.type == "Integer":
        ms = t.b("IntegerMultiply", [], [o, t.int_(1000)], IntegerType, path)
    else:
        ms = t.round("roundFloor", t.b("FloatMultiply", [], [o, t.float_(1000.0)], FloatType, path), b, path)
    return t.b("DateTimeFromEpochMilliseconds", [], [ms], DateTimeType, path)


def _todate(t: Translator, c: CallSite) -> None:
    tokens = t.value(_rfc3339_tokens(), ArrayType(DateTimeFormatTokenType), c.path)
    c.emit(c.block, t.b("DateTimePrintFormat", [], [_date_of(t, c.block, _input(t, c), c.path), tokens], StringType, c.path))


rule(("todate", "todateiso8601"), _todate)


def _fromdate(t: Translator, c: CallSite) -> None:
    quoted = t.concat(t.concat(t.str_('"'), t.open(_input(t, c)), c.path), t.str_('"'), c.path)
    c.emit(c.block, t.b("StringParseJSON", [DateTimeType], [quoted], DateTimeType, c.path))


rule(("fromdate", "fromdateiso8601"), _fromdate)


def _tokens_of(t: Translator, c: CallSite) -> A:
    """The format tokens the checker wrote for a strftime/strptime format."""
    literal = t.literal_of(c.args[0])
    if literal is None or literal[0].type != "Array":
        raise t.gap(f"{c.name} without its format's tokens")
    return t.value(list(literal[1]), ArrayType(DateTimeFormatTokenType), c.arg_paths[0])


rule("strftime", lambda t, c: c.emit(c.block, t.b("DateTimePrintFormat", [], [
    _date_of(t, c.block, _input(t, c), c.path), _tokens_of(t, c)], StringType, c.path)))
rule("strptime", lambda t, c: c.emit(c.block, t.b("DateTimeParseFormat", [], [t.open(_input(t, c)), _tokens_of(t, c)],
                                                  DateTimeType, c.path)))
def _date_part(builtin: str) -> BuiltinRule:
    """A part of a DateTime, as an Integer."""
    def run(t: Translator, c: CallSite) -> None:
        c.emit(c.block, t.b(builtin, [], [t.open(_input(t, c))], IntegerType, c.path))
    return run


for _name, _builtin in (("year", "DateTimeGetYear"), ("month", "DateTimeGetMonth"), ("day", "DateTimeGetDayOfMonth"),
                        ("hour", "DateTimeGetHour"), ("minute", "DateTimeGetMinute"), ("second", "DateTimeGetSecond"),
                        ("millisecond", "DateTimeGetMillisecond"), ("weekday", "DateTimeGetDayOfWeek"),
                        ("epoch_ms", "DateTimeToEpochMilliseconds")):
    rule(_name, _date_part(_builtin))

# A unit's length in milliseconds.
_UNIT_MS = {"millisecond": 1, "second": 1000, "minute": 60_000, "hour": 3_600_000, "day": 86_400_000,
            "week": 604_800_000}


def _unit_ms(t: Translator, c: CallSite, i: int) -> A:
    literal = t.literal_of(c.args[i])
    unit = literal[1] if literal is not None else None
    ms = None if unit is None else _UNIT_MS.get(unit)
    if ms is None:
        raise t.gap(f"the unit {unit or '?'}")
    return t.int_(ms, c.arg_paths[i])


rule("datetime_add", lambda t, c: _values(t, c, [0], c.block, lambda b, vs: c.emit(b, t.b(
    "DateTimeAddMilliseconds", [], [t.open(_input(t, c)), t.b("IntegerMultiply", [], [vs[0], _unit_ms(t, c, 1)],
                                                              IntegerType, c.path)], DateTimeType, c.path))))
rule("datetime_diff", lambda t, c: _values(t, c, [0], c.block, lambda b, vs: c.emit(b, t.b(
    "IntegerDivide", [], [t.b("DateTimeDurationMilliseconds", [], [t.open(_input(t, c)), t.open(vs[0])], IntegerType,
                              c.path), _unit_ms(t, c, 1)], IntegerType, c.path))))

# ─── Function values ─────────────────────────────────────────────────────


def _call(t: Translator, c: CallSite) -> None:
    def with_args(b: Block, vs: list[A]) -> None:
        f = t.open(vs[0])
        inputs = f.type.value["inputs"]
        c.emit(b, t.call_fn(f, [_call_argument(t, b, a, inputs[i], c.path) for i, a in enumerate(vs[1:])], c.path))
    _values(t, c, list(range(len(c.args))), c.block, with_args)


rule("call", _call)


def _call_argument(t: Translator, b: Block, v: A, want: EastType, path: str) -> A:
    """An argument as a function's input: an Integer as a Float, a struct field by field."""
    o = t.open(v)
    ot = o.type
    w = unwrap(want)
    if type_equal(ot, w):
        return t.widen_to(b, o, want, path)
    if ot.type == "Struct" and w.type == "Struct":
        s = t.bind(b, o, "argument")
        fields = {name: _call_argument(t, b, t.field(s, name), f, path) for name, f in fields_of(w).items()}
        return t.struct(want, fields)
    return t.widen_to(b, o, want, path)


for _name, _output in (("signature", StringType), ("source", StringType), ("calls", ArrayType(StringType)),
                       ("captures", ArrayType(StringType))):
    def _tooling(t: Translator, c: CallSite, name: str = _name, output: EastType = _output) -> None:
        f = t.open(_input(t, c))
        # A host platform function the tooling provides (#931).
        c.emit(c.block, A("Platform", output, t.loc(c.path), name=f"jq_{name}", type_parameters=[f.type], arguments=[f],
                          is_async=False, optional=False))
    rule(_name, _tooling)

#: Every builtin's rule, by name as called; formats as ``@name``.
BUILTIN_RULES: dict[str, BuiltinRule] = _RULES

__all__ = ["BUILTIN_RULES", "FORMATS", "Format"]
