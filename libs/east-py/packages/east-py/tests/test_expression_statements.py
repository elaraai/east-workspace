#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The statement surface — python's twin of the TypeScript ``$`` builder (#627).

These pin SPELLING behaviour only: which IR node each statement spelling
builds, how the TypeScript builder's assembly and typing rules apply
(``Let``/``Assign`` are Null, ``Return``/``Break``/``Continue``/``Error``
are Never, a branch pads to Null, a body's returned value is its last
statement, an all-diverging chain is Never, a statement after a diverging
one is unreachable), who receives the block and what a misused block
raises, and that every built program still executes. What the builtins
COMPUTE is the compliance corpus's business.
"""

from __future__ import annotations

import pytest

from east import (
    ArrayType,
    DictType,
    East,
    FloatType,
    IntegerType,
    NullType,
    OptionType,
    SetType,
    StringType,
    StructType,
    VariantType,
    east_null,
    none,
    some,
)
from east.expression import Block, ExpressionError
from east.types.types import recursive_type


def body_of(built):
    node = built._east_ir
    if node.type == "Block":
        node = node.value["statements"][len(node.value["statements"]) - 1]
    return node.value["body"]


def stmts(node):
    assert node.type == "Block", node.type
    return list(node.value["statements"])


def kinds(node):
    return [s.type for s in stmts(node)]


# ── who receives the block ───────────────────────────────────────────────────


def test_a_body_declaring_one_more_parameter_receives_the_block():
    seen = []

    def body(b, x):
        seen.append(b)
        return x + 1

    built = East.function([IntegerType], IntegerType, body)
    assert isinstance(seen[0], Block)
    assert built(1) == 2
    plain = East.function([IntegerType], IntegerType, lambda x: x + 1)  # no block: as always
    assert plain(1) == 2


def test_the_decorator_form_builds_the_same_artifact_and_keeps_the_name():
    @East.function([IntegerType], IntegerType)
    def double(b, x):
        y = b.let(x)
        b.assign(y, y * 2)
        return y

    assert double.__name__ == "double"
    assert double(4) == 8
    assert kinds(body_of(double)) == ["Let", "Assign", "Variable"]

    @East.asyncFunction([], IntegerType)
    def seven(b):
        b.return_(7)

    assert seven._east_is_async and seven.__name__ == "seven"


def test_a_body_with_the_wrong_parameter_count_is_named():
    with pytest.raises(ExpressionError, match=r"declares 3 parameter\(s\) — it takes 1 .* or 2"):
        East.function([IntegerType], IntegerType, lambda a, b, c: a)


def test_a_statement_on_an_outer_block_inside_a_nested_body_raises():
    def body(b, x):
        b.if_(x > 0, lambda _inner: b.assign(b.let(1), 2))  # the OUTER b
        return x

    with pytest.raises(ExpressionError, match="OUTER block while a nested body is open"):
        East.function([IntegerType], IntegerType, body)


def test_a_statement_on_a_closed_block_raises():
    kept = []

    def body(b, x):
        def arm(b):
            kept.append(b)

        b.if_(x > 0, arm)
        kept[0].let(1)  # the arm's block, after the arm returned

    with pytest.raises(ExpressionError, match="body has already returned"):
        East.function([IntegerType], IntegerType, body)


def test_a_callback_declaring_the_full_signature_plus_one_receives_the_block():
    def body(xs):
        def step(b, v, i):
            t = b.let(v * 2)
            b.if_(i == 0, lambda b: b.assign(t, 0))
            return t

        return xs.map(step)

    built = East.function([ArrayType(IntegerType)], ArrayType(IntegerType), body)
    cb = body_of(built).value["arguments"][1]
    assert cb.type == "Function" and kinds(cb.value["body"]) == ["Let", "IfElse", "Variable"]
    assert list(built([5, 6])) == [0, 12]


def test_statements_inside_an_expression_form_are_spelled_east_block():
    def body(b, v):
        return v.match({
            "some": lambda x: East.block(lambda b: (b.do(x + 1), x * 2)[1]),
            "none": lambda _n: 0,
        })

    built = East.function([OptionType(IntegerType)], IntegerType, body)
    arm = body_of(built).value["cases"][1]["body"]
    assert arm.type == "Block" and kinds(arm) == ["Builtin", "Builtin"]
    assert built(some(3)) == 6 and built(none) == 0


# ── let / const / assign ─────────────────────────────────────────────────────


def test_let_and_const_bind_variables_with_the_typescript_flags():
    def body(b, x):
        a = b.let(x + 1)
        c = b.const(a * 2)
        b.assign(a, c)
        return a

    built = East.function([IntegerType], IntegerType, body)
    let_a, let_c, assign, ret = stmts(body_of(built))
    assert let_a.type == "Let" and let_a.value["type"].type == "Null"
    assert let_a.value["variable"].value["mutable"] is True
    assert let_c.value["variable"].value["mutable"] is False
    assert assign.type == "Assign" and assign.value["type"].type == "Null"
    assert ret.type == "Variable"
    assert built(4) == 10


def test_a_const_cannot_be_reassigned_and_types_are_checked():
    with pytest.raises(ExpressionError, match="defined as const"):
        East.function([IntegerType], IntegerType, lambda b, x: b.assign(b.const(x), 1) or x)
    with pytest.raises(ExpressionError, match="the variable holds Integer"):
        East.function([IntegerType], IntegerType, lambda b, x: b.assign(b.let(x), "s") or x)
    with pytest.raises(ExpressionError, match="Can only assign to a variable"):
        East.function([IntegerType], IntegerType, lambda b, x: b.assign(x + 1, 2) or x)


def test_a_typed_let_widens_its_value():
    opt = OptionType(IntegerType)

    def body(b, x):
        v = b.let(some(x), opt)  # a literal variant re-typed to the Option
        w = b.let(v, opt)        # an expression of the exact type: no As
        return w

    built = East.function([IntegerType], opt, body)
    let_v, let_w, _ret = stmts(body_of(built))
    assert let_v.value["variable"].value["type"] == opt
    assert let_v.value["value"].type == "Variant" and let_v.value["value"].value["type"] == opt
    assert let_w.value["value"].type == "Variable"
    assert built(3) == some(3)


def test_a_narrower_expression_under_a_typed_let_gets_an_as():
    narrow = VariantType([("some", IntegerType)])
    wide = OptionType(IntegerType)

    def body(b, v):
        w = b.let(v, wide)
        return w

    built = East.function([narrow], wide, body)
    let_w, _ = stmts(body_of(built))
    assert let_w.value["value"].type == "As"
    assert let_w.value["value"].value["type"] == wide


def test_the_expression_forms_refuse_the_old_statement_spellings():
    with pytest.raises(ExpressionError, match=r"b\.let\(value\[, type\]\)"):
        East.function([IntegerType], IntegerType, lambda x: East.let(x))
    with pytest.raises(ExpressionError, match=r"b\.while_\(predicate, body\)"):
        East.function([IntegerType], IntegerType, lambda x: East.while_(True, lambda: None))
    with pytest.raises(ExpressionError, match=r"b\.for_\(collection, body\)"):
        East.function([ArrayType(IntegerType)], IntegerType, lambda xs: East.for_(xs, lambda: None))


# ── return / do / unreachable ────────────────────────────────────────────────


def test_return_is_never_typed_and_the_function_type_keeps_the_declared_output():
    built = East.function([IntegerType], IntegerType, lambda b, x: b.return_(x + 1))
    body = body_of(built)
    assert body.type == "Return" and body.value["type"].type == "Never"
    assert built._east_ir.value["type"].value["output"] == IntegerType
    assert built(1) == 2


def test_do_then_return_of_the_same_expression_does_not_duplicate_it():
    def body(b, x):
        y = x + 1
        b.do(y)
        b.return_(y)

    built = East.function([IntegerType], IntegerType, body)
    assert body_of(built).type == "Return"
    assert built(1) == 2


def test_returned_value_already_last_statement_is_not_appended_twice():
    def body(b, x):
        y = b.do(x + 1)
        return y

    built = East.function([IntegerType], IntegerType, body)
    assert body_of(built).type == "Builtin"


def test_a_statement_after_a_diverging_one_is_unreachable():
    def body(b, x):
        b.return_(x)
        b.do(x + 1)

    with pytest.raises(ExpressionError, match="Unreachable statement detected"):
        East.function([IntegerType], IntegerType, body)


def test_return_type_is_checked_against_the_declared_output():
    with pytest.raises(ExpressionError, match="the function returns Integer"):
        East.function([IntegerType], IntegerType, lambda b, x: b.return_("s"))


# ── if_ / else_if / else_ ────────────────────────────────────────────────────


def test_if_chain_shape_and_null_typing():
    def body(b, x):
        r = b.let("small")
        b.if_(x > 10, lambda b: b.assign(r, "big")) \
            .else_if(x > 5, lambda b: b.assign(r, "mid")) \
            .else_(lambda b: None)
        return r

    built = East.function([IntegerType], StringType, body)
    _let, ifelse, _ret = stmts(body_of(built))
    assert ifelse.type == "IfElse" and ifelse.value["type"].type == "Null"
    assert len(ifelse.value["ifs"]) == 2
    assert ifelse.value["ifs"][0]["body"].type == "Assign"
    assert ifelse.value["else_body"].type == "Value"
    assert [built(v) for v in (1, 7, 12)] == ["small", "mid", "big"]


def test_if_without_else_has_a_null_else_body_and_a_branch_pads_to_null():
    def body(b, x):
        b.if_(x > 0, lambda b: x + 1)  # an Integer value: padded with null
        return x

    built = East.function([IntegerType], IntegerType, body)
    ifelse, _ = stmts(body_of(built))
    arm = ifelse.value["ifs"][0]["body"]
    assert arm.type == "Block" and kinds(arm) == ["Builtin", "Value"]
    assert arm.value["type"].type == "Null"
    assert ifelse.value["else_body"].type == "Value"


def test_a_body_may_return_the_if_chain_itself():
    def body(b, x):
        r = b.let(0)
        b.if_(x > 0, lambda b: b.if_(x > 5, lambda b: b.assign(r, 2)))  # returns the IfBuilder
        return r

    built = East.function([IntegerType], IntegerType, body)
    assert built(7) == 2 and built(1) == 0


def test_an_all_diverging_if_chain_is_never_and_ends_the_body():
    def body(b, x):
        b.if_(x > 0, lambda b: b.return_("pos")).else_(lambda b: b.return_("nonpos"))

    built = East.function([IntegerType], StringType, body)
    body_node = body_of(built)
    assert body_node.type == "IfElse" and body_node.value["type"].type == "Never"
    assert built(1) == "pos" and built(-1) == "nonpos"


def test_if_predicate_must_be_boolean():
    with pytest.raises(ExpressionError, match="expected to have type Boolean"):
        East.function([IntegerType], IntegerType, lambda b, x: b.if_(x, lambda b: None) and x)


# ── match_ ───────────────────────────────────────────────────────────────────


def test_match_statement_is_null_typed_with_null_bodies_for_missing_cases():
    opt = OptionType(IntegerType)

    def body(b, v):
        out = b.let(0)
        b.match_(v, {"some": lambda b, x: b.assign(out, x)})
        return out

    built = East.function([opt], IntegerType, body)
    _let, match, _ret = stmts(body_of(built))
    assert match.type == "Match" and match.value["type"].type == "Null"
    bodies = {c["case"]: c["body"] for c in match.value["cases"]}
    assert bodies["none"].type == "Value" and bodies["some"].type == "Assign"
    assert built(some(5)) == 5 and built(none) == 0


def test_match_statement_rejects_an_unknown_case():
    opt = OptionType(IntegerType)
    with pytest.raises(ExpressionError, match="has no case 'other'"):
        East.function([opt], IntegerType, lambda b, v: b.match_(v, {"other": lambda b, x: None}) and 0)


# ── while_ / for_ / break_ / continue_ ───────────────────────────────────────


def test_while_statement_with_a_labelled_break():
    def body(b, n):
        i = b.let(0)
        acc = b.let(0)

        def loop(b, label):
            b.if_(i >= n, lambda b: b.break_(label))
            b.assign(acc, acc + i)
            b.assign(i, i + 1)

        b.while_(True, loop)
        return acc

    built = East.function([IntegerType], IntegerType, body)
    _i, _acc, loop, _ret = stmts(body_of(built))
    assert loop.type == "While" and loop.value["type"].type == "Null"
    brk = loop.value["body"].value["statements"][0].value["ifs"][0]["body"]
    assert brk.type == "Break" and brk.value["type"].type == "Never"
    assert brk.value["label"]["name"] == loop.value["label"]["name"]
    assert built(5) == 10


def test_for_statement_over_array_set_and_dict():
    def over_array(b, xs):
        s = b.let(0)
        b.for_(xs, lambda b, v, i, label: b.assign(s, s + v + i))
        return s

    def over_set(b, xs):
        s = b.let(0)
        b.for_(xs, lambda b, k: b.assign(s, s + k))
        return s

    def over_dict(b, d):
        s = b.let(0)
        b.for_(d, lambda b, v, k: b.assign(s, s + v))
        return s

    a = East.function([ArrayType(IntegerType)], IntegerType, over_array)
    assert stmts(body_of(a))[1].type == "ForArray"
    assert a([10, 20, 30]) == 63
    b_ = East.function([SetType(IntegerType)], IntegerType, over_set)
    assert stmts(body_of(b_))[1].type == "ForSet"
    assert b_({1, 2, 3}) == 6
    d = East.function([DictType(StringType, IntegerType)], IntegerType, over_dict)
    assert stmts(body_of(d))[1].type == "ForDict"
    assert d({"a": 1, "b": 2}) == 3


def test_continue_statement_and_the_bare_jump_inside_a_statement_loop():
    def body(b, xs):
        s = b.let(0)

        def step(b, v, i, label):
            b.if_(v < 0, lambda b: b.continue_(label))
            b.assign(s, s + v)

        b.for_(xs, step)
        return s

    built = East.function([ArrayType(IntegerType)], IntegerType, body)
    assert built([1, -5, 2]) == 3

    def bare(b, xs):
        s = b.let(0)

        def step(b, v, i, label):
            b.if_(v < 0, lambda b: East.break_())  # the sugar's jump, resolved to this loop
            b.assign(s, s + v)

        b.for_(xs, step)
        return s

    built = East.function([ArrayType(IntegerType)], IntegerType, bare)
    assert built([1, 2, -1, 5]) == 3


def test_a_jump_needs_the_loops_label():
    with pytest.raises(ExpressionError, match="takes the label the loop body received"):
        East.function([IntegerType], IntegerType, lambda b, x: b.break_("outer") or x)
    with pytest.raises(ExpressionError, match=r"b\.break_\(label\)"):
        East.function([IntegerType], IntegerType,
                      lambda b, x: b.while_(True, lambda b, label: East.break_(label)) or x)


def test_for_over_a_scalar_raises():
    with pytest.raises(ExpressionError, match="only loop over arrays, sets and dictionaries"):
        East.function([IntegerType], IntegerType, lambda b, x: b.for_(x, lambda b, v: None) and x)


# ── try_ ─────────────────────────────────────────────────────────────────────


def test_try_catch_finally_statement_shape():
    def body(b, x):
        r = b.let("ok")
        log = b.let(0)
        b.try_(lambda b: b.assign(r, East.if_else(x > 0, "pos", East.error("neg")))) \
            .catch(lambda b, msg: b.assign(r, msg)) \
            .finally_(lambda b: b.assign(log, 1))
        return r

    built = East.function([IntegerType], StringType, body)
    _r, _log, tc, _ret = stmts(body_of(built))
    assert tc.type == "TryCatch" and tc.value["type"].type == "Null"
    assert tc.value["catch_body"].type == "Assign"
    assert tc.value["finally_body"].type == "Assign"
    assert built(1) == "pos" and built(-1) == "neg"


def test_try_is_never_when_both_bodies_diverge_and_catch_runs_once():
    def body(b, x):
        b.try_(lambda b: b.return_(x)).catch(lambda b, m: b.return_(0))

    built = East.function([IntegerType], IntegerType, body)
    assert body_of(built).type == "TryCatch" and body_of(built).value["type"].type == "Never"
    with pytest.raises(ExpressionError, match="more than once"):
        East.function([IntegerType], IntegerType,
                      lambda b, x: b.try_(lambda b: None).catch(lambda b, m: None).catch(lambda b, m: None) or x)


# ── block(fn) / error / do ───────────────────────────────────────────────────


def test_block_expression_form_yields_its_returned_value():
    def body(x):
        return East.block(lambda b: (b.do(x + 1), x * 2)[1])

    built = East.function([IntegerType], IntegerType, body)
    blk = body_of(built)
    assert blk.type == "Block" and kinds(blk) == ["Builtin", "Builtin"]
    assert built(3) == 6


def test_block_expression_without_a_value_must_diverge():
    def no_value(b):
        b.do(East.value(1))

    with pytest.raises(ExpressionError, match="block without return must have type Never"):
        East.function([IntegerType], IntegerType, lambda x: East.block(no_value))


def test_error_statement_is_never_typed_and_ends_the_arm():
    def body(b, x):
        b.if_(x < 0, lambda b: b.error("neg"))
        return x

    built = East.function([IntegerType], IntegerType, body)
    ifelse, _ = stmts(body_of(built))
    arm = ifelse.value["ifs"][0]["body"]
    assert arm.type == "Error" and arm.value["type"].type == "Never"
    assert built(2) == 2
    with pytest.raises(Exception, match="neg"):
        built(-1)


def test_a_dropped_error_expression_is_refused():
    def arm(b):
        East.error("neg")  # evaluated and thrown away

    with pytest.raises(ExpressionError, match="thrown away"):
        East.function([IntegerType], IntegerType, lambda b, x: b.if_(x < 0, arm) and x)


def test_error_is_never_typed_and_absorbed_by_if_else():
    built = East.function([IntegerType], IntegerType,
                          lambda x: East.if_else(x < 0, East.error("neg"), x))
    ifelse = body_of(built)
    assert ifelse.value["type"] == IntegerType
    assert ifelse.value["ifs"][0]["body"].type == "Error"
    assert ifelse.value["ifs"][0]["body"].value["type"].type == "Never"
    assert built(2) == 2


# ── nested functions, calls, callbacks ───────────────────────────────────────


def test_a_nested_function_is_an_inline_function_node_with_captures():
    def body(b, x):
        f = b.const(East.function([IntegerType], IntegerType, lambda y: y + x))
        return f(1) + f(2)

    built = East.function([IntegerType], IntegerType, body)
    let_f, ret = stmts(body_of(built))
    fn_node = let_f.value["value"]
    assert fn_node.type == "Function"
    assert [c.value["name"] for c in fn_node.value["captures"]] == ["__k0"]
    assert ret.value["arguments"][0].type == "Call"
    assert built(10) == 23


def test_a_nested_decorated_function_receives_its_own_block():
    def body(b, x):
        @East.function([IntegerType], IntegerType)
        def bump(b, y):
            t = b.let(y + x)
            b.assign(t, t * 2)
            return t

        f = b.const(bump)
        return f(1)

    built = East.function([IntegerType], IntegerType, body)
    let_f, _ret = stmts(body_of(built))
    assert kinds(let_f.value["value"].value["body"]) == ["Let", "Assign", "Variable"]
    assert built(10) == 22


def test_a_function_typed_expression_serves_as_a_callback():
    def body(b, xs, x):
        f = b.const(East.function([IntegerType, IntegerType], IntegerType, lambda v, i: v + x))
        return xs.map(f)

    built = East.function([ArrayType(IntegerType), IntegerType], ArrayType(IntegerType), body)
    _let, ret = stmts(body_of(built))
    assert ret.type == "Builtin" and ret.value["arguments"][1].type == "Variable"
    assert list(built([1, 2], 10)) == [11, 12]


def test_an_async_function_may_await_a_nested_async_function():
    def body(b):
        inner = b.const(East.asyncFunction([], IntegerType, lambda b: b.return_(7)))
        b.return_(inner())

    built = East.asyncFunction([], IntegerType, body)
    _let, ret = stmts(body_of(built))
    assert ret.value["value"].type == "CallAsync"
    with pytest.raises(ExpressionError, match="CallAsync"):
        East.function([], IntegerType,
                      lambda b: b.const(East.asyncFunction([], IntegerType, lambda: 1))())


# ── value / as_ / wrap_recursive / unwrap ────────────────────────────────────


def test_value_builds_typed_literals_and_containers():
    def body(b, x):
        f = East.value(1, FloatType)
        arr = East.value([1, 2], ArrayType(IntegerType))
        s = East.value({"a": 1}, StructType([("a", IntegerType)]))
        _blob = b.const(East.value(b"\x01\x02"))
        return arr.size() + s.a + East.if_else(f > 0.5, 1, 0)

    built = East.function([IntegerType], IntegerType, body)
    let_blob, _ret = stmts(body_of(built))
    assert let_blob.value["value"].type == "Value"
    assert let_blob.value["value"].value["type"].type == "Blob"
    assert built(0) == 4


def test_as_widens_only_a_strict_subtype():
    narrow = VariantType([("some", IntegerType)])
    wide = OptionType(IntegerType)
    built = East.function([narrow], wide, lambda v: East.as_(v, wide))
    assert body_of(built).type == "As"
    same = East.function([wide], wide, lambda v: East.as_(v, wide))
    assert body_of(same).type == "Variable"
    with pytest.raises(ExpressionError, match="not a subtype"):
        East.function([IntegerType], StringType, lambda v: East.as_(v, StringType))


def test_recursive_values_wrap_and_unwrap():
    Tree = recursive_type(lambda self: StructType([("v", IntegerType), ("kids", ArrayType(self))]))

    def body(t):
        leaf = East.wrap_recursive({"v": 1, "kids": East.value([], ArrayType(Tree))}, Tree)
        return t.unwrap().v + leaf.unwrap().v

    built = East.function([Tree], IntegerType, body)
    assert body_of(built).value["arguments"][0].type == "GetField"
    assert body_of(built).value["arguments"][0].value["struct"].type == "UnwrapRecursive"
    assert body_of(built).value["arguments"][1].value["struct"].value["value"].type == "WrapRecursive"


# ── platform declarations ───────────────────────────────────────────────────


def test_platform_optional_generic_and_widening_arguments():
    narrow = VariantType([("some", IntegerType)])
    wide = OptionType(IntegerType)
    log = East.platform("log", [wide], NullType, optional=True)
    gen = East.genericPlatform("show", ["T"], ["T"], StringType)

    def body(b, v):
        b.do(log(v))
        return gen([IntegerType], 1)

    built = East.function([narrow], StringType, body)
    do_log, ret = stmts(body_of(built))
    assert do_log.value["optional"] is True
    assert do_log.value["arguments"][0].type == "As"
    assert ret.type == "Platform" and list(ret.value["type_parameters"]) == [IntegerType]
    assert built._east_platforms == (("log", False), ("show", False))


# ── cse=False ────────────────────────────────────────────────────────────────


def test_cse_false_builds_exactly_what_the_body_spells():
    def body(x):
        y = x + 1
        return y * y

    shared = East.function([IntegerType], IntegerType, body)
    assert body_of(shared).type == "Block"  # the shared node bound to a Let
    exact = East.function([IntegerType], IntegerType, body, cse=False)
    assert body_of(exact).type == "Builtin"
    assert exact(2) == 9 == shared(2)


def test_a_mutable_variable_is_never_bound_once_by_cse():
    def body(b, x):
        a = b.let(x)
        y = a + 1
        b.assign(a, 10)
        return y + y

    built = East.function([IntegerType], IntegerType, body)
    assert built(1) == 22  # both reads see the assigned value


def test_east_null_is_an_explicit_null_statement():
    def body(b, x):
        b.do(x)
        return east_null

    built = East.function([IntegerType], NullType, body)
    assert kinds(body_of(built)) == ["Variable", "Value"]
