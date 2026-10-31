#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""A recursive type is written under a hash of its type table.

So its id, and the IR that holds it, depends on the type alone: not on what
the process built before it, nor on which runtime built it. The four ids are
pinned in TypeScript's ``east/src/type_of_type.recursive_id.spec.ts`` and
east-c's ``tests/test_recursive_type_id.c`` as well.
"""

from __future__ import annotations

import subprocess
import sys

from east._eastc_bridge import canonicalize_type

from east.types.type_of_type import EastTypeType, IRType
from east.types.types import (
    ArrayType,
    IntegerType,
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
    is_type_equal,
    recursive_type,
)
from east.types.values import EastVariant

Tree = recursive_type(lambda self: VariantType([("leaf", IntegerType), ("node", ArrayType(self))]))
Forest = recursive_type(
    lambda self: StructType([("trees", ArrayType(Tree)), ("name", StringType), ("next", OptionType(self))])
)


def _wrapper_id(t: EastVariant) -> int:
    assert t.type == "Recursive" and t.value.type == "wrapper"
    return t.value.value["id"]


def test_a_recursive_types_id_is_the_hash_of_its_type_table_the_same_in_every_runtime():
    assert _wrapper_id(Tree) == 1820754330669801663
    assert _wrapper_id(Forest) == 3797356837675649521
    assert _wrapper_id(EastTypeType) == 1407501298113036788
    assert _wrapper_id(IRType) == 4094604686657949362


def test_a_recursive_type_keeps_its_id_inside_another_so_one_type_is_written_once():
    trees = Forest.value.value["inner"].value[0]["type"]
    assert _wrapper_id(trees.value) == _wrapper_id(Tree)


def test_two_types_that_differ_inside_their_bodies_have_different_ids_and_are_unequal():
    strings = recursive_type(lambda self: VariantType([("leaf", StringType), ("node", ArrayType(self))]))
    assert _wrapper_id(strings) != _wrapper_id(Tree)
    assert not is_type_equal(strings, Tree)


def test_a_type_crossing_from_east_c_carries_its_own_id_whatever_id_it_went_in_with():
    ref = EastVariant("Recursive", EastVariant("ref", 7))
    body = EastVariant("Variant", [{"name": "leaf", "type": IntegerType}, {"name": "node", "type": ArrayType(ref)}])
    foreign = EastVariant("Recursive", EastVariant("wrapper", {"id": 7, "inner": body}))
    assert _wrapper_id(canonicalize_type(foreign)) == _wrapper_id(Tree)
    assert is_type_equal(foreign, Tree)


def test_a_wrapper_inside_another_of_its_id_gives_the_outer_one_its_binding_back():
    # No writer nests a wrapper in one of its own id; crafted bytes can. Each
    # ref is its own object, so the conversion cache cannot answer for it.
    inner_ref = EastVariant("Recursive", EastVariant("ref", 5))
    outer_ref = EastVariant("Recursive", EastVariant("ref", 5))
    inner = EastVariant("Recursive", EastVariant("wrapper", {
        "id": 5,
        "inner": EastVariant("Variant", [{"name": "end", "type": NullType}, {"name": "next", "type": inner_ref}]),
    }))
    after = EastVariant("Variant", [{"name": "none", "type": NullType}, {"name": "some", "type": outer_ref}])
    outer = EastVariant("Recursive", EastVariant("wrapper", {
        "id": 5,
        "inner": EastVariant("Struct", [{"name": "a", "type": inner}, {"name": "b", "type": after}]),
    }))
    canonical = canonicalize_type(outer)
    assert canonical.type == "Recursive" and canonical.value.type == "wrapper"


_SAME_PROGRAM = """
import hashlib
import sys

from east import East
from east.serialization.beast2 import encode_beast2_with_header_for
from east.types.type_of_type import IRType
from east.types.types import ArrayType, IntegerType, StructType, VariantType, recursive_type

if sys.argv[1] == "others-first":
    for i in range(3):
        recursive_type(lambda self, i=i: StructType([(f"f{i}", ArrayType(self))]))
Tree = recursive_type(lambda self: VariantType([("leaf", IntegerType), ("node", ArrayType(self))]))
same = East.function([Tree], Tree, lambda b, tree: tree)
print(hashlib.sha256(encode_beast2_with_header_for(IRType)(same._east_ir)).hexdigest())
"""


def _ir_digest_in_a_fresh_process(mode: str) -> str:
    result = subprocess.run(
        [sys.executable, "-c", _SAME_PROGRAM, mode], capture_output=True, text=True, timeout=300, check=False
    )
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()


def test_a_functions_ir_is_the_same_in_two_processes_whatever_each_built_before_it():
    assert _ir_digest_in_a_fresh_process("others-first") == _ir_digest_in_a_fresh_process("alone")
