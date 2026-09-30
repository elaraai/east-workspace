#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Values of a recursive type lower as TypeScript lowers them (#1044).

A value of a recursive type is a value of the type's node, wrapped in
``WrapRecursive`` (TS ``valueOrExprToAstTyped``): no Struct or Variant node
is typed with the wrapper, which both analyzers refuse. Lifting a value
(``East.value(v, T)``, ``b.const(v, T)``, a declared output) and widening a
literal to the type (``b.let(literal, T)``) give that form, which compiles,
runs, prints and rebuilds.
"""

from __future__ import annotations

from typing import Any

from east.runtime._compiler_eastc import diff_ir

from east import East
from east.codegen import to_python_source
from east.expression.lift import _unroll
from east.ir.builders import ir_function, ir_new_array, ir_value, ir_variant, ir_wrap_recursive
from east.types.construct import variant
from east.types.types import (
    ArrayType,
    FunctionType,
    IntegerType,
    NullType,
    VariantType,
    recursive_type,
)
from east.types.values import EastArray
from east.utils.ordering import equal_for

Tree = recursive_type(lambda self: VariantType([("leaf", IntegerType), ("node", ArrayType(self))]))
Node = _unroll(Tree)
#: ``node [leaf 1, leaf 2]``, a value of ``Tree``.
TREE = variant("node", EastArray(Tree, [variant("leaf", 1, Node), variant("leaf", 2, Node)]), Node)
Leaf = VariantType([("leaf", IntegerType)])
#: ``leaf 3`` as an expression of a narrower variant type, a literal to widen to ``Tree``.
LEAF_3 = East.value(variant("leaf", 3, Leaf), Leaf)

Nat = recursive_type(lambda self: VariantType([("succ", self), ("zero", NullType)]))
NatNode = _unroll(Nat)
#: ``succ succ zero``: variants all the way down, so a build hoists no part of it.
TWO = variant("succ", variant("succ", variant("zero", None, NatNode), NatNode), NatNode)


def _leaf(n: int) -> Any:
    """``leaf n`` as TypeScript's ``East.value`` lowers it."""
    return ir_wrap_recursive(Tree, ir_variant(Node, "leaf", ir_value(IntegerType, n)))


def test_east_value_of_a_recursive_value_is_typescripts_ir() -> None:
    # Outside a build nothing hoists, so the IR is the whole value: the form
    # TypeScript's East.value gives, a WrapRecursive around each node.
    got = East.value(TREE, Tree).ir
    expected = ir_wrap_recursive(Tree, ir_variant(Node, "node", ir_new_array(ArrayType(Tree), [_leaf(1), _leaf(2)])))
    fn_t = FunctionType([], Tree)
    assert diff_ir(ir_function(fn_t, [], [], expected), ir_function(fn_t, [], [], got)) is None


def test_a_recursive_value_in_a_build_compiles_and_runs() -> None:
    fn = East.function([], Tree, lambda _b: East.value(TREE, Tree))
    assert equal_for(Tree)(fn(), TREE)


def test_a_variant_literal_widened_to_a_recursive_type_compiles_and_runs() -> None:
    fn = East.function([], Tree, lambda b: b.let(LEAF_3, Tree))
    assert equal_for(Tree)(fn(), variant("leaf", 3, Node))


def test_a_function_holding_a_recursive_value_prints_and_rebuilds() -> None:
    fn = East.function([], Nat, lambda _b: East.value(TWO, Nat))
    namespace: dict[str, Any] = {}
    exec(compile(to_python_source(fn), "<printed>", "exec"), namespace)
    assert diff_ir(fn._east_ir, namespace["main"]._east_ir) is None
    assert equal_for(Nat)(namespace["main"](), TWO)
