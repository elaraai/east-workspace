#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Python's jq front end and translator make what TypeScript's make, case by case (#926 Y1, Y2; #1041 B1).

``libs/east/test/fixtures/query-corpus.beast2`` holds what TypeScript's front
end made of every case of the corpus (``libs/east/test/query.corpus.ts``): its
canonical text, its checked query, its diagnostics and, for a case that
checks, its translation's IR and the call of the ``Query`` builtin ``East.jq``
makes of it. Python's must make the same:

- **Y1**: the canonical text equal, the checked ``QueryType`` — its program
  as written, and whether it reads a root — byte for byte, and the
  diagnostics equal: codes, messages, UTF-16 spans, suggestions and fixes,
  the non-BMP case's included;
- **Y2**: the translation equal to TypeScript's under east-c's IR normaliser
  (``diff_ir``), which sets locations and names aside;
- **B1**: the call of the ``Query`` builtin — an East function of the checked
  input's fields (a root's each field, or the one input) whose body is the
  call ``East.jq`` makes: the query as a ``QueryCallType`` constant, its
  translation, and every input — equal to TypeScript's under the normaliser.

``make query-corpus`` in ``libs/east`` rewrites the file.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from east.runtime._compiler_eastc import diff_ir

from east import East
from east.expression.location import source_map_scope
from east.query import (
    CheckJqResult,
    QueryErrorType,
    QueryType,
    check_jq,
    parse_jq,
    print_jq,
    translate_jq,
)
from east.serialization.beast2 import (
    decode_beast2_with_header_for,
    encode_beast2_with_header_for,
    read_beast2_type,
)
from east.serialization.east_printer import print_for
from east.types.type_of_type import IRType
from east.types.types import ArrayType
from east.utils.ordering import equal_for

CORPUS = Path(__file__).resolve().parents[4] / "east" / "test" / "fixtures" / "query-corpus.beast2"


def _cases() -> list[Any]:
    """The corpus's cases, in corpus order."""
    assert CORPUS.is_file(), f"{CORPUS} is missing: `make query-corpus` in libs/east writes it"
    data = CORPUS.read_bytes()
    return list(decode_beast2_with_header_for(read_beast2_type(data))(data)["cases"])


CASES = _cases()
#: The cases that check, with TypeScript's translation.
TRANSLATED = [entry for entry in CASES if entry["translated"].type == "some"]
#: The cases that check, with the call of the ``Query`` builtin TypeScript's ``East.jq`` makes of them (#1041).
CALLED = [entry for entry in CASES if entry["called"].type == "some"]

_encode_query = encode_beast2_with_header_for(QueryType)
_Diagnostics = ArrayType(QueryErrorType)
_same_diagnostics = equal_for(_Diagnostics)
_print_diagnostics = print_for(_Diagnostics)
_print_query = print_for(QueryType)
_decode_ir = decode_beast2_with_header_for(IRType)


def _name(entry: Any) -> str:
    return entry["case"]["name"]


def _check(entry: Any) -> CheckJqResult:
    c = entry["case"]
    return check_jq(c["program"], c["input"], root=c["root"])


def called_ir(checked: CheckJqResult) -> Any:
    """A checked case's call of the ``Query`` builtin, as the corpus fixture holds it (TypeScript's ``calledIR``).

    An East function of the checked input's fields (a root's each field, or
    the one input) whose body is the call ``East.jq`` makes.
    """
    translation = translate_jq(checked)
    input_type = checked.input_type
    params = [f["type"] for f in input_type.value] if checked.source.root else [input_type]
    return East.function(params, translation.result_type, lambda _b, *inputs: translation.call(*inputs))._east_ir


@pytest.mark.parametrize("entry", CASES, ids=[_name(e) for e in CASES])
def test_the_canonical_text_is_typescripts(entry: Any) -> None:
    parsed = parse_jq(entry["case"]["program"])
    canonical = print_jq(parsed.program.value).text if parsed.program.type == "some" else ""
    assert canonical == entry["canonical"]


@pytest.mark.parametrize("entry", CASES, ids=[_name(e) for e in CASES])
def test_the_checked_query_and_diagnostics_are_typescripts(entry: Any) -> None:
    checked = _check(entry)
    diagnostics = list(entry["diagnostics"])
    assert _same_diagnostics(checked.diagnostics, diagnostics), (
        f"\n python: {_print_diagnostics(checked.diagnostics)}\n     ts: {_print_diagnostics(diagnostics)}")
    expected = entry["checked"]
    if expected.type == "none":
        assert checked.query is None, "the query checks in python, where it does not in TypeScript"
        return
    assert checked.query is not None, "the query checks in TypeScript, where it does not in python"
    assert _encode_query(checked.query) == _encode_query(expected.value), (
        f"\n python: {_print_query(checked.query)}\n     ts: {_print_query(expected.value)}")


@pytest.mark.parametrize("entry", TRANSLATED, ids=[_name(e) for e in TRANSLATED])
def test_the_translation_is_typescripts_under_the_normaliser(entry: Any) -> None:
    with source_map_scope():
        ir = translate_jq(_check(entry)).function_ir()
    difference = diff_ir(_decode_ir(bytes(entry["translated"].value)), ir)
    assert difference is None, str(difference)


def test_every_case_that_checks_has_its_translation() -> None:
    assert [_name(e) for e in CASES if e["checked"].type == "some"] == [_name(e) for e in TRANSLATED]


@pytest.mark.parametrize("entry", CALLED, ids=[_name(e) for e in CALLED])
def test_the_query_call_is_typescripts_under_the_normaliser(entry: Any) -> None:
    difference = diff_ir(entry["called"].value, called_ir(_check(entry)))
    assert difference is None, str(difference)


def test_every_case_that_checks_has_its_query_call() -> None:
    assert [_name(e) for e in CASES if e["checked"].type == "some"] == [_name(e) for e in CALLED]
