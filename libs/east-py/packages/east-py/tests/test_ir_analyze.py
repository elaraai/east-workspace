#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``east.ir.analyze`` — the python twin of ``analyze.ts`` (#627).

The validation cases of ``libs/east/src/analyze.spec.ts`` ported (the JS
backend's ``isAsync`` enrichment has no meaning for east-c and is not
ported), plus one pin per rule the TypeScript analyzer enforces, each on IR
hand-built with ``east.ir.builders`` so the rule — not the builder — is what
fails. Messages are the TypeScript analyzer's.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from east import (
    ArrayType,
    BooleanType,
    East,
    FloatType,
    FunctionType,
    IntegerType,
    NeverType,
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
)
from east.ir.analyze import IRAnalysisError, analyze_ir
from east.ir.builders import (
    ir_as,
    ir_assign,
    ir_block,
    ir_break,
    ir_builtin,
    ir_call,
    ir_error,
    ir_for_array,
    ir_function,
    ir_get_field,
    ir_ifelse,
    ir_label,
    ir_let,
    ir_match,
    ir_new_array,
    ir_return,
    ir_struct,
    ir_trycatch,
    ir_unwrap_recursive,
    ir_value,
    ir_variable,
    ir_variant,
    ir_wrap_recursive,
)
from east.types.type_of_type import LocationType
from east.types.types import recursive_type

# ── helpers ─────────────────────────────────────────────────────────────────


def fn(out, body, params=()):
    """A Function node over ``params`` (``(name, type)`` pairs)."""
    variables = [ir_variable(t, n) for n, t in params]
    return ir_function(FunctionType([t for _n, t in params], out), [], variables, body)


def var(name, t, mutable=False):
    return ir_variable(t, name, mutable=mutable)


def value(t, v):
    return ir_value(t, v)


def raises(ir, pattern, platforms=None):
    with pytest.raises(IRAnalysisError, match=pattern):
        analyze_ir(ir, platforms)


# ── analyze.spec.ts: basic validation ───────────────────────────────────────


def test_accepts_a_valid_function():
    built = East.function([], IntegerType, lambda b: b.return_(42))
    analyze_ir(built._east_ir)  # every East.function already ran this; explicit here


def test_rejects_an_unknown_platform_function():
    unknown = East.platform("unknownFunc", [], NullType)
    built = East.function([], NullType, lambda b: b.return_(unknown()))
    raises(built._east_ir, r"Platform function 'unknownFunc' not found", platforms=[])


def test_missing_platform_is_fine_without_an_implementation_list():
    unknown = East.platform("unknownFunc", [], NullType)
    built = East.function([], NullType, lambda b: b.return_(unknown()))
    analyze_ir(built._east_ir)  # compiled later with East.compile — checked there


def test_optional_platform_may_be_missing():
    maybe = East.platform("analytics", [StringType], NullType, optional=True)
    built = East.function([], NullType, lambda b: b.return_(maybe("x")))
    analyze_ir(built._east_ir, platforms=[])
    assert built._east_ir.value["body"].value["value"].value["optional"] is True


def test_compile_reports_the_missing_platform():
    """analyze.spec.ts: compile() throws when a platform is not provided."""
    log = East.platform("log", [StringType], NullType)
    built = East.function([], NullType, lambda b: b.do(log("hello")))
    with pytest.raises(IRAnalysisError, match=r"Platform function 'log' not found"):
        East.compile(built, platform=[])
    fetch = East.asyncPlatform("asyncFetch", [StringType], StringType)
    built = East.asyncFunction([], StringType, lambda b: b.return_(fetch("url")))
    with pytest.raises(IRAnalysisError, match=r"Platform function 'asyncFetch' not found"):
        East.compileAsync(built, platform=[])


def test_platform_signature_is_checked_against_the_implementation():
    log = East.platform("log", [StringType], NullType)
    built = East.function([], NullType, lambda b: b.do(log("hello")))
    ok = SimpleNamespace(name="log", inputs=[StringType], output=NullType)
    analyze_ir(built._east_ir, platforms=[ok])
    wrong_out = SimpleNamespace(name="log", inputs=[StringType], output=IntegerType)
    raises(built._east_ir, r"Platform function 'log' return type expected to be", [wrong_out])
    wrong_in = SimpleNamespace(name="log", inputs=[IntegerType], output=NullType)
    raises(built._east_ir, r"argument 1 requires exact type match", [wrong_in])
    wrong_arity = SimpleNamespace(name="log", inputs=[], output=NullType)
    raises(built._east_ir, r"expects 0 arguments but got 1", [wrong_arity])
    dup = [ok, ok]
    raises(built._east_ir, r"Duplicate platform function definition", dup)


# ── every rule, on hand-built IR ────────────────────────────────────────────


def test_value_node_type_must_match_its_literal():
    raises(fn(IntegerType, ir_value(IntegerType, "x")),
           r"Value node expected value of type .Integer but got .String")


def test_variable_must_be_in_scope():
    raises(fn(IntegerType, var("x", IntegerType)), r"Variable x not in scope")


def test_variable_type_and_mutability_must_match_the_binding():
    body = ir_block(IntegerType, [
        ir_let(NullType, var("x", IntegerType), value(IntegerType, 1)),
        var("x", StringType),
    ])
    raises(fn(IntegerType, body), r"Variable x has type .Integer but expected .String")
    body = ir_block(IntegerType, [
        ir_let(NullType, var("x", IntegerType), value(IntegerType, 1)),
        var("x", IntegerType, mutable=True),
    ])
    raises(fn(IntegerType, body), r"Variable x mutability mismatch")


def test_let_requires_the_exact_type():
    body = ir_block(FloatType, [
        ir_let(NullType, var("x", FloatType), value(IntegerType, 1)),
        var("x", FloatType),
    ])
    raises(fn(FloatType, body), r"Let statement requires exact type match")


def test_assign_rules():
    x = var("x", IntegerType, mutable=True)
    ok = ir_block(NullType, [ir_let(NullType, x, value(IntegerType, 1)),
                             ir_assign(NullType, x, value(IntegerType, 2))])
    analyze_ir(fn(NullType, ok))
    raises(fn(NullType, ir_assign(NullType, x, value(IntegerType, 2))),
           r"Cannot assign to variable x which is not in scope")
    c = var("c", IntegerType)
    raises(fn(NullType, ir_block(NullType, [ir_let(NullType, c, value(IntegerType, 1)),
                                            ir_assign(NullType, c, value(IntegerType, 2))])),
           r"Cannot reassign const variable c")
    raises(fn(NullType, ir_block(NullType, [ir_let(NullType, x, value(IntegerType, 1)),
                                            ir_assign(NullType, x, value(StringType, "s"))])),
           r"Assign statement requires exact type match")


def test_block_type_is_its_last_statements():
    raises(fn(IntegerType, ir_block(IntegerType, [value(StringType, "s")])),
           r"Block evaluates to type .String but expected .Integer")


def test_as_rules():
    narrow = VariantType([("some", IntegerType)])
    wide = OptionType(IntegerType)
    v = ir_variant(narrow, "some", value(IntegerType, 1))
    analyze_ir(fn(wide, ir_as(wide, v)))
    raises(fn(IntegerType, ir_as(IntegerType, value(StringType, "s"))),
           r"Cannot cast value of type .String to type .Integer")
    raises(fn(IntegerType, ir_as(IntegerType, ir_error(NeverType, value(StringType, "boom")))),
           r"Cannot cast .Never to type .Integer")
    raises(fn(IntegerType, ir_as(IntegerType, value(IntegerType, 1))),
           r"Unnecessary As node: value is already of type .Integer")


def test_function_rules():
    raises(ir_function(IntegerType, [], [], value(IntegerType, 1)),
           r"Expected Function type, got .Integer")
    raises(fn(IntegerType, value(StringType, "s")),
           r"Function body returns type .String but function signature expects .Integer")
    analyze_ir(fn(IntegerType, ir_return(NeverType, value(IntegerType, 1))))  # Never body is fine
    inner = ir_function(FunctionType([], IntegerType), [var("y", IntegerType)], [], var("y", IntegerType))
    raises(fn(FunctionType([], IntegerType), inner), r"Captured variable y not in scope")
    outer_body = ir_block(FunctionType([], IntegerType), [
        ir_let(NullType, var("y", StringType), value(StringType, "s")), inner])
    raises(fn(FunctionType([], IntegerType), outer_body),
           r"Captured variable y has type .String but expected .Integer")


def test_call_rules():
    f = var("f", FunctionType([IntegerType], IntegerType))
    raises(fn(IntegerType, ir_call(IntegerType, value(IntegerType, 1), []), ()),
           r"Call expects Function type, got .Integer")
    raises(fn(IntegerType, ir_call(IntegerType, f, []), [("f", FunctionType([IntegerType], IntegerType))]),
           r"Function expects 1 arguments, got 0")
    raises(fn(IntegerType, ir_call(IntegerType, f, [value(StringType, "s")]),
              [("f", FunctionType([IntegerType], IntegerType))]),
           r"Function call argument 1 requires exact type match")
    raises(fn(StringType, ir_call(StringType, f, [value(IntegerType, 1)]),
              [("f", FunctionType([IntegerType], IntegerType))]),
           r"Function call return type expected to be .Integer but IR has .String")


def test_builtin_rules():
    raises(fn(IntegerType, ir_builtin(IntegerType, "NoSuchBuiltin", [], [])),
           r"Unknown builtin function 'NoSuchBuiltin'")
    raises(fn(IntegerType, ir_builtin(IntegerType, "IntegerAdd", [], [value(IntegerType, 1)])),
           r"Builtin function 'IntegerAdd' expects 2 arguments, but got 1")


def test_return_rules():
    raises(ir_return(NeverType, value(IntegerType, 1)), r"Return statement outside of function")
    raises(fn(IntegerType, ir_return(NeverType, value(StringType, "s"))),
           r"Return statement returns type .String but function signature expects .Integer")


def test_collection_element_rules():
    raises(fn(ArrayType(IntegerType), ir_new_array(ArrayType(IntegerType), [value(StringType, "s")])),
           r"Array element 0 has type .String but array expects .Integer")
    raises(fn(IntegerType, ir_new_array(IntegerType, [])), r"NewArray node must have Array type")


def test_for_array_rules():
    arr = ir_new_array(ArrayType(IntegerType), [value(IntegerType, 1)])
    loop = ir_for_array(NullType, arr, ir_label("l"), var("i", StringType), var("v", IntegerType),
                        value(NullType, None))
    raises(fn(NullType, loop), r"ForArray key must be Integer type")
    loop = ir_for_array(NullType, arr, ir_label("l"), var("i", IntegerType), var("v", StringType),
                        value(NullType, None))
    raises(fn(NullType, loop), r"ForArray value variable has type .String")
    loop = ir_for_array(NullType, value(IntegerType, 1), ir_label("l"), var("i", IntegerType),
                        var("v", IntegerType), value(NullType, None))
    raises(fn(NullType, loop), r"ForArray expects Array type, got .Integer")


def test_if_else_rules():
    ret = ir_return(NeverType, value(IntegerType, 1))
    raises(fn(IntegerType, ir_ifelse(NullType, [(value(IntegerType, 1), ret)], ret)),
           r"IfElse predicate 0 must be Boolean type")
    raises(fn(IntegerType, ir_ifelse(NullType, [(value(BooleanType, True), ret)], ret)),
           r"IfElse has all branches returning Never, so it must have type Never")
    # A Never-typed IfElse with a non-diverging arm fails the arm check first
    # (the TypeScript analyzer's order — its "not all branches diverge" rule
    # is shadowed by the branch typing rule, exactly as here).
    raises(fn(IntegerType, ir_ifelse(NeverType, [(value(BooleanType, True), ret)], value(NullType, None))),
           r"IfElse else branch returns type .Null but IfElse expects .Never")
    raises(fn(IntegerType, ir_ifelse(IntegerType, [(value(BooleanType, True), value(StringType, "s"))],
                                     value(IntegerType, 1))),
           r"IfElse branch 0 returns type .String but IfElse expects .Integer")


def test_error_and_try_catch_rules():
    raises(fn(IntegerType, ir_error(NeverType, value(IntegerType, 1))),
           r"Error message must be String type")
    stack = var("stack", ArrayType(LocationType))
    tc = ir_trycatch(IntegerType, value(IntegerType, 1), value(IntegerType, 2),
                     var("msg", IntegerType), stack)
    raises(fn(IntegerType, tc), r"TryCatch message variable must be String type")
    tc = ir_trycatch(IntegerType, value(IntegerType, 1), value(IntegerType, 2),
                     var("msg", StringType), var("stack", ArrayType(StringType)))
    raises(fn(IntegerType, tc), r"TryCatch stack variable must be")
    tc = ir_trycatch(IntegerType, value(IntegerType, 1), value(StringType, "s"),
                     var("msg", StringType), stack)
    raises(fn(IntegerType, tc), r"TryCatch catch body returns type .String")
    boom = ir_error(NeverType, value(StringType, "boom"))
    tc = ir_trycatch(IntegerType, boom, boom, var("msg", StringType), stack)
    raises(fn(IntegerType, tc), r"TryCatch has both try and catch bodies returning Never")


def test_struct_and_field_rules():
    S = StructType([("a", IntegerType), ("b", StringType)])
    raises(fn(S, ir_struct(S, [("a", value(IntegerType, 1))])),
           r"Struct type has 2 fields but struct value has 1 fields")
    raises(fn(S, ir_struct(S, [("b", value(StringType, "s")), ("a", value(IntegerType, 1))])),
           r"Struct has field a at position 0, but value does not")
    raises(fn(S, ir_struct(S, [("a", value(StringType, "s")), ("b", value(StringType, "s"))])),
           r"Struct field a has type .String but struct type expects .Integer")
    ok = ir_struct(S, [("a", value(IntegerType, 1)), ("b", value(StringType, "s"))])
    raises(fn(IntegerType, ir_get_field(IntegerType, "c", ok)), r"Struct does not have field c")
    raises(fn(StringType, ir_get_field(StringType, "a", ok)),
           r"GetField result type .String does not match field type .Integer")
    raises(fn(IntegerType, ir_get_field(IntegerType, "a", value(IntegerType, 1))),
           r"GetField expects Struct type, got .Integer")


def test_variant_and_match_rules():
    opt = OptionType(IntegerType)
    raises(fn(opt, ir_variant(opt, "other", value(IntegerType, 1))),
           r"Variant type does not have case other")
    raises(fn(opt, ir_variant(opt, "some", value(StringType, "s"))),
           r"Variant case some value has type .String but variant type expects .Integer")
    subject = ir_variant(opt, "some", value(IntegerType, 1))
    raises(fn(IntegerType, ir_match(IntegerType, subject, [("some", var("x", IntegerType), var("x", IntegerType))])),
           r"Match has 1 cases but variant type has 2 cases")
    cases = [("none", var("n", NullType), value(IntegerType, 0)),
             ("some", var("x", StringType), value(IntegerType, 1))]
    raises(fn(IntegerType, ir_match(IntegerType, subject, cases)),
           r"Match case some variable has type .String but variant case has type .Integer")
    cases = [("none", var("n", NullType), value(IntegerType, 0)),
             ("some", var("x", IntegerType), value(StringType, "s"))]
    raises(fn(IntegerType, ir_match(IntegerType, subject, cases)),
           r"Match case some returns type .String but Match expects .Integer")
    never = ir_error(NeverType, value(StringType, "boom"))
    cases = [("none", var("n", NullType), never), ("some", var("x", IntegerType), never)]
    raises(fn(IntegerType, ir_match(IntegerType, subject, cases)),
           r"Match has all cases returning Never, so it must have type Never")
    raises(fn(IntegerType, ir_match(IntegerType, value(IntegerType, 1), [])),
           r"Match expects Variant type, got .Integer")


def test_recursive_wrap_and_unwrap_rules():
    R = recursive_type(lambda self: VariantType([("nil", NullType), ("cons", self)]))
    from east.expression.lift import _unroll

    inner_t = _unroll(R)
    leaf = ir_variant(inner_t, "nil", value(NullType, None))
    analyze_ir(fn(R, ir_wrap_recursive(R, leaf)))
    raises(fn(R, ir_wrap_recursive(R, value(IntegerType, 1))), r"WrapRecursive value has type .Integer")
    wrapped = ir_wrap_recursive(R, leaf)
    analyze_ir(fn(inner_t, ir_unwrap_recursive(inner_t, wrapped)))
    raises(fn(IntegerType, ir_unwrap_recursive(IntegerType, wrapped)),
           r"UnwrapRecursive result type .Integer does not match recursive type")


def test_break_outside_a_loop_is_not_the_analyzers_business():
    # Labels are matched at run time by name; the analyzer only types the
    # node (Never), exactly as the TypeScript analyzer does.
    analyze_ir(fn(NullType, ir_block(NullType, [ir_break(NeverType, ir_label("l")),
                                                value(NullType, None)])))


def test_location_is_named_when_a_source_map_is_given():
    built = East.function([IntegerType], IntegerType, lambda x: x)
    body = ir_get_field(IntegerType, "a", value(IntegerType, 1))
    bad = fn(IntegerType, body)
    with pytest.raises(IRAnalysisError, match=r"at loc_id 0$"):
        analyze_ir(bad, source_map=built._east_source_map)
