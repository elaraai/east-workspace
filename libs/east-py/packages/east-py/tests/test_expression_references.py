#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""A call of a built function holds a reference to it, and the copy is made
once, when the IR is needed (#1459) — pinned against the copy it replaces.

Each program is built twice: by reference, and with every callee's skeleton
hidden from the embed, so every call copies the callee's final form at the
call as it did before. The two builds must agree exactly — the IR with its
names and loc_ids (``diff_ir`` unnormalized), the source maps, the platform
dependencies and the export — and so must what they compute.
"""

from __future__ import annotations

import pytest
from east.runtime._compiler_eastc import diff_ir

import east.expression.lift as lift
from east import East, none, some, variant
from east.expression.function import deferred_builds
from east.functions import FunctionManifestType
from east.types.types import (
    ArrayType,
    IntegerType,
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
)
from east.types.values import EastArray, EastStruct
from east.utils.ordering import equal_for

Row = StructType([("id", StringType), ("qty", IntegerType)])
Shape = VariantType([("circle", IntegerType), ("square", IntegerType)])
log = East.platform("t.ref_log", [StringType], NullType)
show = East.platform("t.ref_show", [IntegerType], NullType)


class _Hidden:
    """An artifact as an embed sees it with its skeleton hidden: copied."""

    def __init__(self, artifact):
        self._artifact = artifact

    def __getattr__(self, name):
        if name == "_east_skeleton":
            raise AttributeError(name)
        return getattr(self._artifact, name)


def _copied(program, monkeypatch):
    """``program``'s functions, every call in them copied at the call."""
    real = lift._lift_artifact
    with monkeypatch.context() as m:
        m.setattr(lift, "_lift_artifact", lambda value: real(_Hidden(value)))
        return program()


# ── the programs: each calls built functions in a shape of its own ───────────


def nested():
    """Three levels, each binding names the next one's callee binds too."""
    @East.function([IntegerType], IntegerType)
    def tenfold(b, kind):
        return kind * 10

    @East.function([IntegerType], IntegerType)
    def bump(b, e):
        kind = b.const(e + 1)
        return tenfold(kind)

    def caller(b, kind):
        kind = b.const(kind, IntegerType)
        return bump(kind + 100) + tenfold(kind)

    return {"tenfold": tenfold, "bump": bump, "top": East.function([IntegerType], IntegerType, caller)}


def callbacks():
    """A callee with a callback, called from a callback and from the body."""
    @East.function([ArrayType(IntegerType)], IntegerType)
    def total(b, xs):
        kind = b.const(xs.map(lambda b, x: x * 3))
        return kind.sum()

    def caller(b, xss):
        sums = b.const(xss.map(lambda b, xs: total(xs)))
        return sums.sum() + total(sums)

    return {"total": total, "top": East.function([ArrayType(ArrayType(IntegerType))], IntegerType, caller)}


def unnamed():
    """Generated names in the callee, and in the caller before and after its calls."""
    @East.function([ArrayType(IntegerType)], IntegerType)
    def indexed(b, xs):
        b.const(xs.map(lambda b, x, i: x + i))
        return xs.map(lambda b, x: x * 2).sum()  # the map's unnamed index slot

    def caller(b, xs):
        before = b.const(xs.map(lambda b, x: x + 1))
        middle = indexed(before)
        after = b.const(xs.map(lambda b, x: x - 1))
        return middle + after.sum() + indexed(after)

    return {"indexed": indexed, "top": East.function([ArrayType(IntegerType)], IntegerType, caller)}


def shared():
    """One call read twice, and a call of a call."""
    @East.function([IntegerType], IntegerType)
    def square(b, x):
        y = b.const(x * x)
        return y + 1

    def caller(b, x):
        twice = square(x)
        return twice + twice + square(twice)

    return {"square": square, "top": East.function([IntegerType], IntegerType, caller)}


def as_value():
    """A built function bound, and handed to a callback slot."""
    @East.function([IntegerType], IntegerType)
    def inc(b, x):
        return x + 1

    def caller(b, xs):
        f = b.const(inc)
        mapped = b.const(xs.map(inc))
        return mapped.map(lambda b, x: f(x)).sum()

    return {"inc": inc, "top": East.function([ArrayType(IntegerType)], IntegerType, caller)}


def statements():
    """A callee binding through loops, labels, a match, a try and a catch."""
    @East.function([ArrayType(Row), Shape], IntegerType)
    def tally(b, rows, shape):
        acc = b.let(0)

        def step(b, row, index, label):
            b.if_(row.qty < 0, lambda b: b.break_(label))
            b.assign(acc, acc + row.qty * index)

        b.for_(rows, step)
        b.match_(shape, {"circle": lambda b, r: b.assign(acc, acc + r),
                         "square": lambda b, s: b.assign(acc, acc + s * s)})
        b.try_(lambda b: b.assign(acc, acc + rows.get(9).qty)) \
            .catch(lambda b, message, stack: b.assign(acc, acc + stack.size()))
        n = b.let(0)

        def loop(b, label):
            b.if_(n > 3, lambda b: b.break_(label))
            b.assign(n, n + 1)

        b.while_(n < 10, loop)
        return acc + n

    def caller(b, rows, shape):
        acc = b.const(rows.size())
        return tally(rows, shape) + acc + tally(rows, shape)

    return {"tally": tally, "top": East.function([ArrayType(Row), Shape], IntegerType, caller)}


def effects():
    """Callees that mutate an argument and that raise."""
    @East.function([ArrayType(IntegerType)], NullType)
    def push(b, xs):
        b.do(xs.push_last(1))

    @East.function([IntegerType], IntegerType)
    def check(b, x):
        b.if_(x < 0, lambda b: b.error("negative"))
        return x

    def caller(b, xs):
        b.do(push(xs))
        return check(xs.size())

    return {"push": push, "check": check,
            "top": East.function([ArrayType(IntegerType)], IntegerType, caller)}


def platforms():
    """A callee calling a platform function, after the caller's own."""
    @East.function([StringType], NullType)
    def shout(b, s):
        b.do(log(s.upper_case()))

    def caller(b, s, n):
        b.do(show(n))
        b.do(shout(s))
        b.do(shout(s + "!"))

    return {"shout": shout, "top": East.function([StringType, IntegerType], NullType, caller)}


def stdlib():
    """The standard library's functions, built on their first use."""
    def caller(b, n, s):
        printed = b.const(East.String.print(IntegerType, n))
        return printed + East.String.print(IntegerType, n + 1) + s.upper_case()

    return {"top": East.function([IntegerType, StringType], StringType, caller)}


def options():
    """A callee matching an option, called with one built per element."""
    @East.function([OptionType(IntegerType)], IntegerType)
    def value_or(b, o):
        return o.match({"some": lambda b, v: v, "none": lambda b, _: 0})

    def caller(b, xs):
        firsts = b.const(xs.map(lambda b, x: value_or(East.if_else(x > 0, some(x), none))))
        return firsts.sum()

    return {"value_or": value_or, "top": East.function([ArrayType(IntegerType)], IntegerType, caller)}


def underscores():
    """A callee binding ``_``, called where ``_`` is in scope: the copy names its
    ``_`` ``__2``, which is no hint one copy further out, so the copy there
    draws a generated name for it — and the names drawn after it must not
    shift."""
    @East.function([OptionType(IntegerType)], IntegerType)
    def value_or(b, o):
        return o.match({"some": lambda b, v: v, "none": lambda b, _: 0})

    @East.function([ArrayType(OptionType(IntegerType))], IntegerType)
    def total(b, xs):
        first = b.const(xs.map(lambda b, _, i: value_or(xs.get(i))).sum())
        return first + xs.map(lambda b, o: value_or(o)).size()

    def caller(b, xs):
        return xs.map(lambda b, _: total(xs)).sum() + xs.map(lambda b, o: value_or(o)).size()

    return {"value_or": value_or, "total": total,
            "top": East.function([ArrayType(OptionType(IntegerType))], IntegerType, caller)}


def asynchronous():
    """Async functions calling an async function."""
    @East.asyncFunction([IntegerType], IntegerType)
    def inc(b, x):
        kind = b.const(x + 1)
        return kind

    def caller(b, kind):
        return inc(kind) + inc(kind * 2)

    return {"inc": inc, "top": East.asyncFunction([IntegerType], IntegerType, caller)}


PROGRAMS = [nested, callbacks, unnamed, shared, as_value, statements, effects, platforms, stdlib,
            options, underscores, asynchronous]


@pytest.mark.parametrize("program", PROGRAMS, ids=lambda p: p.__name__)
def test_a_reference_builds_the_ir_the_copy_built(program, monkeypatch):
    by_reference, copied = program(), _copied(program, monkeypatch)
    for name, built in by_reference.items():
        other = copied[name]
        assert diff_ir(built._east_ir, other._east_ir, normalize=False) is None, name
        assert built._east_source_map.entries() == other._east_source_map.entries(), name
        assert getattr(built, "_east_platforms", ()) == getattr(other, "_east_platforms", ()), name
    assert equal_for(FunctionManifestType)(East.export_functions("p", "1", by_reference),
                                           East.export_functions("p", "1", copied))


def test_what_the_functions_compute_is_what_the_copies_compute(monkeypatch):
    rows = EastArray(Row, [EastStruct({"id": "a", "qty": 2}), EastStruct({"id": "b", "qty": 5})])
    cases = [
        (nested, "top", (7,)),
        (callbacks, "top", (EastArray(ArrayType(IntegerType), [EastArray(IntegerType, [1, 2]),
                                                               EastArray(IntegerType, [3])]),)),
        (unnamed, "top", (EastArray(IntegerType, [4, 5, 6]),)),
        (shared, "top", (3,)),
        (as_value, "top", (EastArray(IntegerType, [1, 2, 3]),)),
        (statements, "top", (rows, variant("square", 3, Shape))),
        (options, "top", (EastArray(IntegerType, [-1, 4, 0, 9]),)),
    ]
    for program, name, args in cases:
        assert program()[name](*args) == _copied(program, monkeypatch)[name](*args), program.__name__


def test_a_function_raising_in_a_callee_names_the_same_lines(monkeypatch):
    from east import EastError

    def raised(fn):
        with pytest.raises(EastError) as info:
            fn(EastArray(IntegerType, []))
        return info.value

    # `check` raises for a negative size, which no array has: call it on -1
    @East.function([IntegerType], IntegerType)
    def check(b, x):
        b.if_(x < 0, lambda b: b.error("negative"))
        return x

    def program():
        return {"top": East.function([ArrayType(IntegerType)], IntegerType,
                                     lambda b, xs: check(xs.size() - 1))}

    one, other = raised(program()["top"]), raised(_copied(program, monkeypatch)["top"])
    assert one.message == other.message
    assert list(one.location) == list(other.location)


def test_a_deferred_build_by_reference_writes_what_an_eager_one_writes():
    from east.serialization.beast2 import encode_beast2_with_header_for
    from east.types.type_of_type import IRType

    encode = encode_beast2_with_header_for(IRType)
    eager = nested()
    with deferred_builds():
        deferred = nested()
        for name, built in eager.items():
            assert encode(deferred[name]._east_ir) == encode(built._east_ir), name
            assert deferred[name]._east_source_map.entries() == built._east_source_map.entries(), name
