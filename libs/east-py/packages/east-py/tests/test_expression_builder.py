#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The strict builder trio: East.function / East.platform / East.compile (#625).

AUTHORING-SPELLING pins only (test policy, #623): the builder API's
signatures, its build-time errors, the platform-declaration discipline, the
uncompiled-call contract, and the retired spellings. Execution semantics of
the IR these produce are pinned by the TS compliance corpus; the thin
execution assertions here prove the authoring path yields working artifacts,
not what the builtins compute.
"""

import asyncio

import pytest

from east import (
    East,
    EastArray,
    ExpressionError,
    IntegerType,
    NullType,
    StringType,
    StructType,
)
from east.runtime.errors import EastError
from east.runtime.platform import PlatformFunction

ROW = StructType([("sku", StringType), ("qty", IntegerType)])


# ─── East.function: signature discipline ────────────────────────────────────


def test_function_requires_a_list_of_east_types():
    with pytest.raises(TypeError, match="LIST of parameter East"):
        East.function(IntegerType, IntegerType, lambda x: x)
    with pytest.raises(TypeError, match="parameter type 1 is not an East type"):
        East.function([IntegerType, int], IntegerType, lambda a, b: a)


def test_function_requires_the_declared_output():
    with pytest.raises(TypeError, match="requires the declared output"):
        East.function([IntegerType], lambda x: x, None)
    with pytest.raises(TypeError, match="body must be callable"):
        East.function([IntegerType], IntegerType, 42)


def test_declared_output_is_enforced_naming_both_types():
    with pytest.raises(ExpressionError, match="produced Integer, declared out is String"):
        East.function([IntegerType], StringType, lambda x: x * 2)


def test_declared_output_types_the_root_expression():
    # The declared out is the root's type context (#541): a body returning a
    # general variant needs no other hint.
    from east import variant
    from east.types.types import VariantType

    Status = VariantType([("ok", IntegerType), ("err", StringType)])
    build = East.function([IntegerType], Status,
                          lambda x: East.if_else(x > 0, variant("ok", x),
                                                 variant("err", "neg")))
    assert build(3).type == "ok"
    assert build(-1).type == "err"


def test_zero_parameter_function():
    assert East.function([], IntegerType, lambda: 40 + 2)() == 42


def test_untraceable_bodies_raise_through_the_builder():
    with pytest.raises(ExpressionError, match="cannot be traced"):
        East.function([ROW], IntegerType, lambda r: r.qty if r.qty > 0 else 0)
    with pytest.raises(ExpressionError, match="constant-fold"):
        East.function([ROW], StringType, lambda r: f"<{r.sku}>")


# ─── the artifact: native execution, bind, composition ──────────────────────


def test_artifact_runs_natively_through_eager_methods():
    from east.runtime.compiler import eager_stats

    double = East.function([ROW], IntegerType, lambda r: r.qty * 2)
    rows = EastArray(ROW, [{"sku": "a", "qty": 1}, {"sku": "b", "qty": 2}])
    before = eager_stats()["kernel_direct"]
    assert list(rows.map(double)) == [2, 4]
    assert eager_stats()["kernel_direct"] == before + 1  # rode straight in


def test_artifact_composes_by_splicing_into_another_build():
    amount = East.function([ROW], IntegerType, lambda r: r.qty * 10)
    plus_one = East.function([ROW], IntegerType, lambda r: amount(r) + 1)
    assert plus_one({"sku": "a", "qty": 4}) == 41


def test_artifact_bind_is_by_reference():
    from east import EastDict
    from east.types.types import DictType

    table = EastDict(StringType, IntegerType, {"a": 5})
    look = East.function([StringType, DictType(StringType, IntegerType)],
                         IntegerType, lambda k, t: t.get_or_default(k, 0))
    bound = look.bind(table)
    assert bound("a") == 5
    table["a"] = 7          # bind is live, unlike a capture snapshot
    assert bound("a") == 7


def test_calling_a_bound_function_lowers_to_call_ir():
    from east import EastDict
    from east.types.types import DictType

    table = EastDict(StringType, IntegerType, {"a": 5})
    look = East.function([StringType, DictType(StringType, IntegerType)],
                         IntegerType, lambda k, t: t.get_or_default(k, 0)).bind(table)
    outer = East.function([ROW], IntegerType, lambda r: look(r.sku) + r.qty)
    assert outer({"sku": "a", "qty": 1}) == 6


# ─── East.platform: declaration handles ─────────────────────────────────────


def test_platform_declaration_validates_its_signature():
    with pytest.raises(TypeError, match="non-empty string"):
        East.platform("", [IntegerType], IntegerType)
    with pytest.raises(TypeError, match="LIST of input East"):
        East.platform("p", IntegerType, IntegerType)
    with pytest.raises(TypeError, match="output must be an East type"):
        East.platform("p", [IntegerType], int)


def test_platform_handle_is_expression_level_only():
    log = East.platform("t.log", [StringType], NullType)
    with pytest.raises(ExpressionError, match="expression-level"):
        log("hello")


def test_platform_call_checks_arity_and_types_at_build():
    log = East.platform("t.log", [StringType], NullType)
    with pytest.raises(ExpressionError, match="takes 1 argument"):
        East.function([StringType], NullType, lambda s: log(s, s))
    with pytest.raises(ExpressionError, match="argument 0 has East type Integer"):
        East.function([IntegerType], NullType, lambda x: log(x))


def test_async_declaration_in_a_sync_body_is_a_build_error():
    aecho = East.asyncPlatform("t.aecho", [IntegerType], IntegerType)
    with pytest.raises(ExpressionError, match="East.asyncFunction"):
        East.function([IntegerType], IntegerType, lambda x: aecho(x))


# ─── uncompiled-call contract + East.compile ────────────────────────────────


def test_platform_declaring_function_raises_until_compiled():
    log = East.platform("t.greet", [StringType], NullType)
    greet = East.function(
        [StringType], NullType,
        lambda name: log(East.String.concat("hello ", name)))
    with pytest.raises(EastError, match=r"Platform function 't\.greet' is not "
                                        r"available — compile with East\.compile"):
        greet("bob")
    seen: list[str] = []
    compiled = East.compile(greet, platform=[PlatformFunction(
        name="t.greet", inputs=[StringType], output=NullType, type="sync",
        fn=seen.append)])
    compiled("bob")
    assert seen == ["hello bob"]


def test_platform_declaring_function_still_composes():
    log = East.platform("t.audit", [IntegerType], NullType)
    audit = East.function([IntegerType], NullType, lambda x: log(x))
    outer = East.function([IntegerType], NullType, lambda x: audit(x * 2))
    with pytest.raises(EastError, match=r"'t\.audit' is not available"):
        outer(3)
    seen: list[int] = []
    East.compile(outer, platform=[PlatformFunction(
        name="t.audit", inputs=[IntegerType], output=NullType, type="sync",
        fn=seen.append)])(3)
    assert seen == [6]


def test_compile_validates_platform_signatures_with_the_ts_error():
    log = East.platform("t.sig", [StringType], NullType)
    f = East.function([StringType], NullType, lambda s: log(s))
    with pytest.raises(EastError, match="requires exact type match"):
        East.compile(f, platform=[PlatformFunction(
            name="t.sig", inputs=[IntegerType], output=NullType, type="sync",
            fn=lambda s: None)])


def test_compile_missing_platform_matches_ts_stub_behavior():
    # TS compiles a missing platform to a stub that throws at the call —
    # East.compile mirrors that (the runtime message is east-c's).
    log = East.platform("t.absent", [StringType], NullType)
    f = East.function([StringType], NullType, lambda s: log(s))
    compiled = East.compile(f, platform=[])
    with pytest.raises(EastError, match="Unknown platform function"):
        compiled("x")


def test_compile_accepts_raw_ir_values_and_rejects_garbage():
    from east.ir.builders import ir_function, ir_variable
    from east.types.types import FunctionType

    fn_ir = ir_function(FunctionType([IntegerType], IntegerType), [],
                        [ir_variable(IntegerType, "x")],
                        ir_variable(IntegerType, "x"))
    assert East.compile(fn_ir)(7) == 7
    with pytest.raises(TypeError, match="East.function result or a homoiconic IR"):
        East.compile(lambda x: x)


def test_compile_and_compile_async_enforce_the_matching_builder():
    aecho = East.asyncPlatform("t.pair", [IntegerType], IntegerType)
    af = East.asyncFunction([IntegerType], IntegerType, lambda x: aecho(x))
    with pytest.raises(TypeError, match="East.compileAsync"):
        East.compile(af)
    sf = East.function([IntegerType], IntegerType, lambda x: x)
    with pytest.raises(TypeError, match="East.compile\\(fn"):
        East.compileAsync(sf)


# ─── East.asyncFunction / East.compileAsync ─────────────────────────────────


def test_async_function_compiles_and_awaits():
    # A sync platform declaration inside an async function is the clean
    # execution path (an async IMPL under an outer asyncio.run trips the
    # bridge's own loop — the corpus drives those through _eastc_call).
    probe = East.platform("t.aprobe", [IntegerType], IntegerType)
    af = East.asyncFunction([IntegerType], IntegerType, lambda x: probe(x))
    with pytest.raises(EastError, match=r"compile with East\.compileAsync"):
        af(1)
    compiled = East.compileAsync(af, platform=[PlatformFunction(
        name="t.aprobe", inputs=[IntegerType], output=IntegerType, type="sync",
        fn=lambda x: x + 41)])
    assert asyncio.run(compiled(1)) == 42


def test_async_declaration_builds_inside_async_function():
    aecho = East.asyncPlatform("t.abuild", [IntegerType], IntegerType)
    af = East.asyncFunction([IntegerType], IntegerType, lambda x: aecho(x))

    async def impl(x):
        return x + 1

    compiled = East.compileAsync(af, platform=[PlatformFunction(
        name="t.abuild", inputs=[IntegerType], output=IntegerType,
        type="async", fn=impl)])
    assert callable(compiled)


# ─── the old vocabulary is gone (#625) ──────────────────────────────────────


def test_the_kernel_spellings_no_longer_exist():
    """``kernel()``, the ``east.kernel`` module and the ``Kernel*`` class
    aliases were retired outright rather than shimmed: one builder, one set
    of names."""
    import importlib

    import east
    import east.expression

    for namespace in (east, east.expression, East):
        assert not hasattr(namespace, "kernel")
    for name in ("KernelExpr", "KernelTraceError"):
        assert not hasattr(east, name)
        assert not hasattr(east.expression, name)
    with pytest.raises(ImportError):
        importlib.import_module("east.kernel")
    assert issubclass(ExpressionError, TypeError)
