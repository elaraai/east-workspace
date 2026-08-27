#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The normalizer is faithful to the TypeScript lowering (#627).

``east_ir_normalize`` renames variables and labels in the order
``ast_to_ir.ts`` mints them and recomputes captures in TypeScript's Set
order — so a TypeScript-built program must normalize to ITSELF, loc_ids
aside. Over the whole exported compliance corpus that is the strongest
available proof of the traversal order: any deviation names its path.
"""

from __future__ import annotations

import glob
import json
import os
import re

import pytest
from east.runtime._compiler_eastc import diff_ir, normalize_ir

from east.serialization.json import decode_json_for, encode_json_for
from east.types.type_of_type import IRType

IR_DIR = os.environ.get("EAST_TEST_IR_DIR", "/tmp/east-test-ir")
FILES = sorted(glob.glob(os.path.join(IR_DIR, "*.json")))

pytestmark = pytest.mark.skipif(not FILES, reason=f"no exported IR corpus in {IR_DIR}")


def _json(ir) -> str:
    text = encode_json_for(IRType)(ir)
    return text.decode("utf-8") if isinstance(text, bytes) else text


NAME = re.compile(r'"name":"([^"]*)"')
CAPTURED = re.compile(r'"captured":(true|false)')
LOC = re.compile(r'"loc_id":"?(\d+)"?')


@pytest.mark.parametrize("path", FILES, ids=[os.path.basename(f) for f in FILES])
def test_typescript_program_is_its_own_normal_form(path):
    """Normalization renumbers recursive type ids and zeroes loc_ids, so the
    comparison is on what the LOWERING chose: every name in document order
    (variables, labels — struct field and platform names ride along
    unchanged) and every ``captured`` flag must come back exactly as
    TypeScript wrote them, and every loc_id must be 0."""
    with open(path, encoding="utf-8") as f:
        raw = json.load(f)
    ir = decode_json_for(IRType)(json.dumps(raw["ir"]))
    normalized = normalize_ir(ir)
    before, after = _json(ir), _json(normalized)
    names_before, names_after = NAME.findall(before), NAME.findall(after)
    assert len(names_before) == len(names_after)
    first = next((i for i, (a, b) in enumerate(zip(names_before, names_after, strict=True))
                  if a != b), None)
    assert first is None, (
        f"{os.path.basename(path)}: name {first} minted as {names_after[first]!r}, "
        f"TypeScript wrote {names_before[first]!r}")
    assert CAPTURED.findall(before) == CAPTURED.findall(after), "captured flags"
    assert set(LOC.findall(after)) <= {"0"}, "every loc_id is 0"
    assert diff_ir(normalized, normalize_ir(normalized), normalize=False) is None, "idempotent"
