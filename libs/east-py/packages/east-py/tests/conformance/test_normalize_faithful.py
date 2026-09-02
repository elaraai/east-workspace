#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The normalizer is faithful to the TypeScript lowering (#627, #639).

``east_ir_normalize`` renames variables and labels in the order
``ast_to_ir.ts`` mints them and recomputes captures in TypeScript's Set
order. The lowering advances one counter for every variable it mints,
named or not (#639): a slot the author named carries that name, a slot the
author did not carries ``_N`` with N the minting index. So over the whole
exported compliance corpus: every unnamed slot must normalize to ITSELF
(the same ``_N`` — the traversal orders agree, or the deviation names its
path), every named slot to a canonical ``_k``, every binder to a fresh
index, and labels, captured flags and structure must come back exactly as
TypeScript wrote them.
"""

from __future__ import annotations

import glob
import json
import os
import re

import pytest
from east.runtime._compiler_eastc import diff_ir, normalize_ir

from east.expression.finalize import _node_children
from east.serialization.json import decode_json_for, encode_json_for
from east.types.type_of_type import IRType

IR_DIR = os.environ.get("EAST_TEST_IR_DIR", "/tmp/east-test-ir")
FILES = sorted(glob.glob(os.path.join(IR_DIR, "*.json")))

pytestmark = pytest.mark.skipif(not FILES, reason=f"no exported IR corpus in {IR_DIR}")


def _json(ir) -> str:
    text = encode_json_for(IRType)(ir)
    return text.decode("utf-8") if isinstance(text, bytes) else text


CAPTURED = re.compile(r'"captured":(true|false)')
LOC = re.compile(r'"loc_id":"?(\d+)"?')
SYNTHETIC = re.compile(r"_\d+")

#: the Variable-holding fields of the node kinds that BIND a variable
BINDERS = {
    "Function": ("parameters",), "AsyncFunction": ("parameters",), "Let": ("variable",),
    "ForArray": ("value", "key"), "ForDict": ("value", "key"), "ForSet": ("key",),
    "TryCatch": ("message", "stack"),
}


def _walk(ir):
    """Every node in document order."""
    stack = [ir]
    while stack:
        node = stack.pop()
        yield node
        stack.extend(reversed(list(_node_children(node))))


def _variables(ir) -> list[str]:
    return [n.value["name"] for n in _walk(ir) if n.type == "Variable"]


def _binders(ir) -> list[str]:
    names: list[str] = []
    for n in _walk(ir):
        for field in BINDERS.get(n.type, ()):
            held = n.value[field]
            names.extend(v.value["name"] for v in (held if field == "parameters" else [held]))
        if n.type == "Match":
            names.extend(c["variable"].value["name"] for c in n.value["cases"])
    return names


def _labels(ir) -> list[str]:
    return [n.value["label"]["name"] for n in _walk(ir) if n.type in ("While", "ForArray", "ForSet", "ForDict", "Break", "Continue")]


@pytest.mark.parametrize("path", FILES, ids=[os.path.basename(f) for f in FILES])
def test_typescript_program_normalizes_in_the_lowerings_order(path):
    """Normalization renumbers recursive type ids and zeroes loc_ids, so the
    comparison is on what the LOWERING chose: every slot TypeScript left
    unnamed keeps its ``_N`` (the index the normalizer reaches it at is the
    index the lowering minted it at), every named slot becomes a canonical
    ``_k``, the binders take the indices 0..m-1 once each, and every label
    and ``captured`` flag comes back exactly as TypeScript wrote it."""
    with open(path, encoding="utf-8") as f:
        raw = json.load(f)
    ir = decode_json_for(IRType)(json.dumps(raw["ir"]))
    normalized = normalize_ir(ir)
    before, after = _variables(ir), _variables(normalized)
    assert len(before) == len(after)
    for i, (a, b) in enumerate(zip(before, after, strict=True)):
        assert SYNTHETIC.fullmatch(b), f"{os.path.basename(path)}: variable {i} normalized to {b!r}, not a canonical _N"
        if SYNTHETIC.fullmatch(a):
            assert a == b, (f"{os.path.basename(path)}: variable {i} minted as {b!r}, "
                            f"TypeScript minted {a!r} — the traversal orders differ")
    binders = _binders(normalized)
    assert sorted(int(name[1:]) for name in binders) == list(range(len(binders))), "one fresh index per binder"
    assert _labels(ir) == _labels(normalized), "labels are the lowering's"
    before_json, after_json = _json(ir), _json(normalized)
    assert CAPTURED.findall(before_json) == CAPTURED.findall(after_json), "captured flags"
    assert set(LOC.findall(after_json)) <= {"0"}, "every loc_id is 0"
    assert diff_ir(normalized, normalize_ir(normalized), normalize=False) is None, "idempotent"
    assert diff_ir(ir, normalized) is None, "a renaming of the same program"
