#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``East.jq`` and ``evaluate_jq`` (#926 Y3): the twin of ``libs/east/test/query.spec.ts``.

Every corpus case that checks runs over the shared fixture
(``libs/east/test/fixtures/query-fixture.beast2``) three ways: through
``evaluate_jq``, through ``East.jq`` on values, and through ``East.jq`` in an
``East.function`` body. Each gives the output the corpus holds, which is what
TypeScript's runs give (E1). The tests also cover ``East.jq``'s IR, a call of
the ``Query`` builtin, which IR analysis holds to its query (E2, #1041 B4), the
checked program as written and how a literal is read (B5, #1138: the twins of
``query.check.spec.ts``'s and ``query.parse.spec.ts``'s), the errors a query
raises (E4), and the translator's own cases.
"""

from __future__ import annotations

from functools import cmp_to_key
from pathlib import Path
from typing import Any

import pytest

from east import East
from east.ir.analyze import IRAnalysisError
from east.ir.builders import const_value_of
from east.query import (
    JqLiteralType,
    JqType,
    QueryCallType,
    QueryError,
    check_jq,
    evaluate_jq,
    parse_jq,
    print_jq,
    translate_jq,
)
from east.query.jq.spans import jq_children
from east.runtime.compiler import compile_from_value
from east.runtime.errors import EastError
from east.serialization.beast2 import (
    decode_beast2_with_header_for,
    encode_beast2_with_header_for,
    read_beast2_type,
)
from east.serialization.east_printer import print_for
from east.types.construct import none, some, variant
from east.types.type_of_type import IRType
from east.types.types import (
    ArrayType,
    DateTimeType,
    DictType,
    EastType,
    FloatType,
    FunctionType,
    IntegerType,
    NullType,
    OptionType,
    RecursiveType,
    StringType,
    StructType,
    is_type_equal,
)
from east.types.values import EastArray, EastDict, EastStruct
from east.utils.ordering import compare_for, equal_for

FIXTURES = Path(__file__).resolve().parents[4] / "east" / "test" / "fixtures"


def _decode(name: str) -> tuple[EastType, Any]:
    """A self-describing beast2 fixture's type and value."""
    path = FIXTURES / name
    assert path.is_file(), f"{path} is missing: `make query-corpus` in libs/east writes it"
    data = path.read_bytes()
    t = read_beast2_type(data)
    return t, decode_beast2_with_header_for(t)(data)


FIXTURE_ROOT, FIXTURE = _decode("query-fixture.beast2")
_CORPUS_TYPE, _CORPUS = _decode("query-corpus.beast2")
#: The corpus's cases that check: each has its output over the fixture.
OUTPUT_CASES = [e for e in _CORPUS["cases"] if e["case"]["output"].type == "some"]
#: The fixture's fields, which a root case reads as inputs of their own.
ROOT_FIELDS = [f["name"] for f in FIXTURE_ROOT.value]


def assert_value(t: EastType, actual: Any, expected: Any, message: str = "") -> None:
    """Asserts two East values of a type are equal, as East compares them."""
    show = print_for(t)
    assert equal_for(t)(actual, expected), f"{message} {show(actual)} is not {show(expected)}"


# ─── The corpus over the fixture (E1) ────────────────────────────────────

#: The cases whose output east-c prints as other East text than TypeScript's
#: printer, with the issue that makes the printers agree. Their values are
#: the values TypeScript's translation gives. Each must still print
#: differently, so the list shrinks when the printers agree.
PRINTED_DIFFERENTLY = {
    "identity-root": "#985: TypeScript prints a function value as its signature, east-c as λ",
}


def _run_on_values(entry: Any, result_type: EastType) -> Any:
    """The case through ``East.jq`` on values: the fixture, or its fields for a root case."""
    c = entry["case"]
    given = {name: FIXTURE[name] for name in ROOT_FIELDS} if c["root"] else FIXTURE
    return East.jq(given, c["program"], result_type)


def _run_in_a_body(entry: Any, result_type: EastType) -> Any:
    """The case through ``East.jq`` in an ``East.function`` over the fixture."""
    c = entry["case"]

    def body(_b: Any, root: Any) -> Any:
        given = {name: root[name] for name in ROOT_FIELDS} if c["root"] else root
        return East.jq(given, c["program"], result_type)
    return East.compile(East.function([FIXTURE_ROOT], result_type, body))(FIXTURE)


def _typescripts_value(entry: Any, checked: Any) -> Any:
    """The case's value from TypeScript's translation, run on east-c."""
    run = compile_from_value(decode_beast2_with_header_for(IRType)(bytes(entry["translated"].value)))
    return run(*[FIXTURE if i.name is None else FIXTURE[i.name] for i in translate_jq(checked).inputs])


@pytest.mark.parametrize("entry", OUTPUT_CASES, ids=[e["case"]["name"] for e in OUTPUT_CASES])
def test_the_corpus_over_the_fixture(entry: Any) -> None:
    c = entry["case"]
    checked = check_jq(c["program"], c["input"], root=c["root"])
    result_type = translate_jq(checked).result_type
    show = print_for(result_type)
    runs = {
        "evaluate_jq": evaluate_jq(checked, FIXTURE),
        "East.jq on values": _run_on_values(entry, result_type),
        "East.jq in a body": _run_in_a_body(entry, result_type),
    }
    expected = c["output"].value
    divergence = PRINTED_DIFFERENTLY.get(c["name"])
    if divergence is None:
        for how, got in runs.items():
            assert show(got) == expected, f"{c['name']} through {how}"
        return
    typescripts = _typescripts_value(entry, checked)
    for how, got in runs.items():
        assert show(got) != expected, f"{c['name']} prints as TypeScript's now: drop it from PRINTED_DIFFERENTLY ({divergence})"
        assert_value(result_type, got, typescripts, f"{c['name']} through {how}")


def test_every_case_printed_differently_is_in_the_corpus() -> None:
    names = {e["case"]["name"] for e in OUTPUT_CASES}
    assert set(PRINTED_DIFFERENTLY) <= names


# ─── The query editor's default query (E2) ───────────────────────────────

#: ``Query Editor Spec.md`` §4.7: the default query, as the editor prints it.
DEFAULT_QUERY = "\n".join([
    ".customers as $customers",
    "| .orders",
    '| map(select(.status.type == "shipped") | select(.total >= 100 and (.status.value.date | year) == 2026))',
    "| map(. + {name: $customers[.customer_id].name, region: $customers[.customer_id].region})",
    "| map({order: .id, customer: .name, region, total, shipped: .status.value.date})",
    "| sort_by(-.total)",
    "| .[:10]",
])


def test_the_default_query_gives_its_ten_rows_as_jq_gives_them() -> None:
    rows = evaluate_jq(DEFAULT_QUERY, FIXTURE, input_type=FIXTURE_ROOT, root=True)
    assert len(rows) == 10
    assert_value(ArrayType(IntegerType), EastArray(IntegerType, [r["order"] for r in rows]),
                 EastArray(IntegerType, [1035, 1026, 1014, 1031, 1023, 1021, 1002, 1007, 1012, 1036]))
    assert_value(ArrayType(FloatType), EastArray(FloatType, [r["total"] for r in rows]),
                 EastArray(FloatType, [2381.61, 1913.4, 1765.97, 1537.52, 1352.32, 1225.5, 1171.58, 1162.92, 1109.6,
                                       1041.68]))


def test_east_jqs_ir_is_a_call_of_the_query_builtin_with_every_input() -> None:
    fields = {f["name"]: f["type"] for f in FIXTURE_ROOT.value}
    datasets = StructType([("customers", fields["customers"]), ("forecast", fields["forecast"]),
                           ("orders", fields["orders"])])
    checked = check_jq(DEFAULT_QUERY, datasets, root=True)
    result_type = translate_jq(checked).result_type
    fn = East.function([FIXTURE_ROOT], result_type, lambda _b, root: East.jq(
        {"customers": root["customers"], "forecast": root["forecast"], "orders": root["orders"]},
        DEFAULT_QUERY, result_type))
    call = fn._east_ir.value["body"]
    assert call.type == "Call"
    builtin = call.value["function"]
    assert builtin.type == "Builtin" and builtin.value["builtin"] == "Query"
    # The query as the constant its first argument holds: the program as written, and the root's input names.
    query = const_value_of(builtin.value["arguments"][0])
    expected = variant("v1", {"inputs": some(["customers", "forecast", "orders"]), "program": checked.program},
                       QueryCallType)
    assert equal_for(QueryCallType)(query, expected)
    assert print_jq(query.value["program"]).text == DEFAULT_QUERY.replace("\n", " ")
    # The translation, whose type carries the query's types, takes every input, forecast too, which the query
    # does not read; the call passes each.
    assert builtin.value["arguments"][1].type == "Function"
    translation_type = builtin.value["type_parameters"][0]
    assert translation_type.type == "Function" and len(translation_type.value["inputs"]) == 3
    arguments = list(call.value["arguments"])
    assert [a.type for a in arguments] == ["GetField", "GetField", "GetField"]
    assert [a.value["field"] for a in arguments] == ["customers", "forecast", "orders"]


# ─── The Query builtin (#1041) ───────────────────────────────────────────

Numbers = ArrayType(IntegerType)
#: The query as the builtin carries it — its program as written, and no input
#: names for a query of one input — as a constant built outside any build, so
#: a build embeds it as it stands.
DOUBLED = East.value(variant("v1", {"inputs": none, "program": check_jq("map(. * 2)", Numbers).program},
                             QueryCallType), QueryCallType)


def test_a_query_of_one_input_carries_no_names() -> None:
    fn = East.function([Numbers], Numbers, lambda _b, xs: East.jq(xs, "map(. * 2)", Numbers))
    call = fn._east_ir.value["body"]
    query = const_value_of(call.value["function"].value["arguments"][0])
    assert query.value["inputs"].type == "none"
    assert print_jq(query.value["program"]).text == "map(. * 2)"
    assert len(list(call.value["arguments"])) == 1


def test_running_a_call_of_the_query_builtin_runs_its_translation() -> None:
    translation_type = FunctionType([Numbers], Numbers)
    translation = East.function([Numbers], Numbers, lambda _b, xs: xs.map(lambda _b2, x: x * 2))
    fn = East.function([Numbers], Numbers, lambda _b, xs: East.builtin(
        "Query", [translation_type], [DOUBLED, translation], translation_type)(xs))
    assert_value(Numbers, East.compile(fn)(_numbers(1, 2)), _numbers(2, 4))


def test_ir_analysis_refuses_a_translation_that_does_not_take_the_querys_inputs() -> None:
    # B4: the query takes one input, the translation two.
    translation_type = FunctionType([Numbers, Numbers], Numbers)
    translation = East.function([Numbers, Numbers], Numbers, lambda _b, xs, _ys: xs)
    with pytest.raises(IRAnalysisError, match=r"Builtin function 'Query': its query takes one input, but its "
                                              r"translation is of type \.Function"):
        East.function([Numbers], Numbers, lambda _b, xs: East.builtin(
            "Query", [translation_type], [DOUBLED, translation], translation_type)(xs, xs))


def test_ir_analysis_refuses_a_query_that_is_not_a_constant() -> None:
    # B4: the query is read from a parameter.
    translation_type = FunctionType([Numbers], Numbers)
    translation = East.function([Numbers], Numbers, lambda _b, xs: xs)
    with pytest.raises(IRAnalysisError, match=r"Builtin function 'Query' takes its query as a constant"):
        East.function([QueryCallType, Numbers], Numbers, lambda _b, query, xs: East.builtin(
            "Query", [translation_type], [query, translation], translation_type)(xs))


def test_ir_analysis_refuses_a_call_without_its_one_type_parameter() -> None:
    translation_type = FunctionType([Numbers], Numbers)
    translation = East.function([Numbers], Numbers, lambda _b, xs: xs)
    with pytest.raises(IRAnalysisError, match=r"Builtin function 'Query' takes 1 type parameter, got 0"):
        East.function([Numbers], Numbers, lambda _b, xs: East.builtin(
            "Query", [], [DOUBLED, translation], translation_type)(xs))


def test_a_query_inside_a_callback_keeps_its_constant() -> None:
    # The build's common-subexpression pass leaves a Query call's arguments as
    # East.jq built them: hoisted out of the callback, the query would be a
    # variable read, which IR analysis refuses.
    sums = East.function([ArrayType(Numbers)], Numbers,
                         lambda _b, rows: rows.map(lambda _b2, row: East.jq(row, "map(. * 2) | add", IntegerType)))
    assert_value(Numbers, sums(EastArray(Numbers, [_numbers(1, 2), _numbers(3)])), _numbers(6, 6))


# ─── The checked program and how a literal is read (#1041, #1138) ────────

_same_literal = equal_for(JqLiteralType)
_same_program = equal_for(JqType)


def _literals_of(program: Any) -> list[Any]:
    """A program's literals, in the order written."""
    found: list[Any] = []

    def visit(n: Any) -> None:
        if n.type == "literal":
            found.append(n.value)
        for child in jq_children(n):
            if child.node is not None:
                visit(child.node)
    visit(program)
    return found


def test_keys_on_the_root_is_answered_from_the_roots_type_and_reads_nothing_the_program_keeping_the_call() -> None:
    checked = check_jq("keys", FIXTURE_ROOT, root=True)
    assert list(checked.diagnostics) == [] and checked.reads == []
    assert checked.program.type == "call"
    assert is_type_equal(checked.element_type, ArrayType(StringType))


def test_a_checked_program_gives_the_type_it_was_checked_against_a_roots_datasets_each_read_its_own_input() -> None:
    rooted = check_jq(".orders | length", FIXTURE_ROOT, root=True)
    assert is_type_equal(rooted.input_type, FIXTURE_ROOT)
    assert rooted.reads == ["orders"]
    plain = check_jq(".orders | length", FIXTURE_ROOT)
    assert is_type_equal(plain.input_type, FIXTURE_ROOT)
    assert plain.reads == []


def test_an_iso_string_compared_with_a_datetime_is_read_as_one_the_program_keeping_the_string() -> None:
    program = '.orders[] | select(.status.type == "shipped" and .status.value.date >= "2026-01-01") | .id'
    checked = check_jq(program, FIXTURE_ROOT)
    assert list(checked.diagnostics) == []
    assert print_jq(checked.program).text == program
    assert any(_same_literal(literal, variant("string", "2026-01-01", JqLiteralType))
               for literal in _literals_of(checked.program))
    # Its type there is a DateTime.
    read = checked.type_at("pipe.right.pipe.left.call.args[0].binary.right.binary.right")
    assert read is not None and is_type_equal(read.type, DateTimeType)


def test_a_literal_is_read_as_a_datetime_only_where_its_calls_input_is_one_each_call_of_a_def_alike() -> None:
    program = ('def later: . >= "2026-01-01"; [(first(.orders[] | select(.status.type == "shipped")) '
               '| .status.value.date | later), ("2025-12-31" | later)]')
    checked = check_jq(program, FIXTURE_ROOT)
    assert list(checked.diagnostics) == []
    literal = "def.body.binary.right"
    as_date = checked.type_at(literal, ">def.rest.array.some.comma.left.pipe.right.pipe.right")
    as_text = checked.type_at(literal, ">def.rest.array.some.comma.right.pipe.right")
    assert as_date is not None and is_type_equal(as_date.type, DateTimeType), "where the input is a DateTime"
    assert as_text is not None and is_type_equal(as_text.type, StringType), "where the input is a String"


def test_a_strftime_format_stays_the_string_as_written_which_the_translator_makes_tokens_of() -> None:
    program = 'first(.orders[] | select(.status.type == "shipped")) | .status.value.date | strftime("%Y-%m")'
    checked = check_jq(program, FIXTURE_ROOT)
    assert list(checked.diagnostics) == []
    assert print_jq(checked.program).text == program
    assert any(_same_literal(literal, variant("string", "%Y-%m", JqLiteralType))
               for literal in _literals_of(checked.program))


def test_an_integer_an_operand_makes_a_float_stays_an_integer_literal_which_its_translation_widens() -> None:
    checked = check_jq(".orders | map(.total * 2)", FIXTURE_ROOT)
    assert print_jq(checked.program).text == ".orders | map(.total * 2)"
    two = checked.type_at("pipe.right.call.args[0].binary.right")
    assert two is not None and is_type_equal(two.type, IntegerType)
    product = checked.type_at("pipe.right.call.args[0]")
    assert product is not None and is_type_equal(product.type, FloatType)


def test_a_literal_is_the_typed_east_value_it_writes_and_prints_back_as_written_1001_and_1001_0_apart() -> None:
    text = '[1001, 1001.0, "C01", true, false, null, 9223372036854775807, 1e+21]'
    parsed = parse_jq(text)
    assert parsed.program.type == "some", [d["message"] for d in parsed.diagnostics]
    program = parsed.program.value
    expected = [
        variant("integer", 1001, JqLiteralType), variant("float", 1001.0, JqLiteralType),
        variant("string", "C01", JqLiteralType), variant("boolean", True, JqLiteralType),
        variant("boolean", False, JqLiteralType), variant("null", None, JqLiteralType),
        variant("integer", 9223372036854775807, JqLiteralType), variant("float", 1e21, JqLiteralType),
    ]
    literals = _literals_of(program)
    assert len(literals) == len(expected)
    for i, (literal, wanted) in enumerate(zip(literals, expected, strict=True)):
        assert _same_literal(literal, wanted), f"literal {i}"
    assert not _same_literal(expected[0], expected[1]), "an Integer is not the Float of its value"
    assert print_jq(program).text == text
    # It reads back, in both layouts, as itself with the spans the printer gave.
    for printed in (print_jq(program), print_jq(program, layout="pipeline")):
        again = parse_jq(printed.text)
        assert list(again.diagnostics) == [] and again.program.type == "some", printed.text
        assert _same_program(again.program.value, program), printed.text
        assert again.spans == printed.spans, printed.text


def test_a_decoded_program_prints_each_literal_as_written_however_often_its_parts_are_read_afresh() -> None:
    # A decoded program makes the nodes under an array part — a call's
    # arguments — afresh each time they are read, so a literal the printer read
    # can be gone before it is done, its id another literal's. The printer
    # keeps each it read, and so prints every literal as written: forty of
    # them, each under a call's arguments, printed twenty times over.
    text = "[" + ", ".join(f"limit({i}; {i})" for i in range(1, 41)) + "]"
    parsed = parse_jq(text)
    assert parsed.program.type == "some", [d["message"] for d in parsed.diagnostics]
    decoded = decode_beast2_with_header_for(JqType)(encode_beast2_with_header_for(JqType)(parsed.program.value))
    assert [print_jq(decoded).text for _ in range(20)] == [text] * 20


# ─── The result type ─────────────────────────────────────────────────────


def test_the_result_is_an_expression_of_its_result_type_so_its_methods_chain() -> None:
    xs = EastArray(IntegerType, [1, 2, 3])
    doubled = East.function([ArrayType(IntegerType)], IntegerType,
                            lambda _b, xs: East.jq(xs, "map(. * 2)", ArrayType(IntegerType)).sum())
    assert_value(IntegerType, East.compile(doubled)(xs), 12)
    counted = East.function([ArrayType(IntegerType)], IntegerType,
                            lambda _b, xs: East.jq(xs, "length", IntegerType).add(1))
    assert_value(IntegerType, East.compile(counted)(xs), 4)


def test_east_jq_takes_its_result_type() -> None:
    with pytest.raises(TypeError, match="result_type"):
        East.jq(EastArray(IntegerType, [1]), "map(. * 2)")


# ─── Errors (E4) ─────────────────────────────────────────────────────────

Order = StructType([("id", IntegerType), ("total", OptionType(StringType))])


def test_a_runtime_error_names_its_line_and_column_in_the_jq_text() -> None:
    fn = East.function([IntegerType], IntegerType, lambda _b, x: East.jq(x, "1 | . % 0", IntegerType))
    with pytest.raises(EastError) as e:
        East.compile(fn)(1)
    assert e.value.message == "Division by zero"
    at = e.value.location[0]
    assert (at["filename"], at["line"], at["column"]) == ("jq", 1, 5)


def test_evaluate_jq_gives_a_runtime_error_as_one_runtime_diagnostic_at_the_node_that_raised_it() -> None:
    with pytest.raises(QueryError) as e:
        evaluate_jq("[.[] | 10 / .]", EastArray(IntegerType, [5, 0]), input_type=ArrayType(IntegerType))
    assert len(e.value.diagnostics) == 1
    d = e.value.diagnostics[0]
    assert (d["code"], d["message"]) == ("runtime", "runtime: Division by zero")
    assert d["span"].type == "some"
    assert (d["span"].value["offset"], d["span"].value["length"]) == (7, 6)
    assert str(e.value) == "jq 1:8: runtime: Division by zero"


def test_east_jq_on_values_raises_a_runtime_error_as_query_error() -> None:
    with pytest.raises(QueryError, match=r"^jq 1:8: runtime: Division by zero$"):
        East.jq(EastArray(IntegerType, [5, 0]), "[.[] | 10 / .]", ArrayType(FloatType))


def test_east_jq_raises_query_error_with_check_jqs_message_for_a_query_that_does_not_check() -> None:
    message = check_jq(".[0].totl", ArrayType(Order)).diagnostics[0]["message"]
    with pytest.raises(QueryError) as e:
        East.function([ArrayType(Order)], IntegerType, lambda _b, orders: East.jq(orders, ".[0].totl", IntegerType))
    assert e.value.diagnostics[0]["code"] == "unknown_field"
    assert str(e.value) == f"jq 1:5: {message}"


def test_east_jq_names_both_types_for_a_wrong_result_type() -> None:
    wrong = "type_mismatch: the query gives Array<Integer>, not the Integer it was given."
    with pytest.raises(QueryError, match=f"^{wrong}$"):
        East.function([ArrayType(IntegerType)], IntegerType, lambda _b, xs: East.jq(xs, "map(. * 2)", IntegerType))
    with pytest.raises(QueryError, match=f"^{wrong}$"):
        East.jq(EastArray(IntegerType, [1]), "map(. * 2)", IntegerType)


def test_evaluate_jq_needs_an_input_type_with_a_programs_text() -> None:
    with pytest.raises(TypeError, match="needs input_type"):
        evaluate_jq(".", 1)


def test_east_jq_on_values_needs_values_whose_type_it_can_tell() -> None:
    with pytest.raises(TypeError, match="evaluate_jq"):
        East.jq([1, 2], "length", IntegerType)


# ─── The translation ─────────────────────────────────────────────────────


def test_a_roots_inputs_are_the_fields_the_query_reads_in_the_order_it_reads_them() -> None:
    checked = check_jq(".customers as $c | .orders | map($c[.customer_id].name)", FIXTURE_ROOT, root=True)
    assert [i.name for i in translate_jq(checked).inputs] == ["customers", "orders"]


def test_max_outputs_stops_a_many_query_one_output_past_the_limit() -> None:
    fn = translate_jq(check_jq(".orders[] | .id", FIXTURE_ROOT), max_outputs=3).fn()
    assert_value(ArrayType(IntegerType), East.compile(fn)(FIXTURE), EastArray(IntegerType, [1001, 1002, 1003, 1004]))


def test_build_gives_a_translation_that_is_one_value_as_that_value_not_a_block_of_it() -> None:
    translation = translate_jq(check_jq("1", NullType))
    assert translation.build(None).ir.type == "Value"


@East.generic_platform_function(type_parameters=["F"], inputs=["F"], output=StringType, name="jq_signature")
def _jq_signature(_platform: Any, F: EastType) -> Any:  # noqa: N803 — the type argument, as the factory convention names it
    return lambda _f: "(price, region) => demand"


def test_the_tooling_builtins_call_the_hosts_platform_functions() -> None:
    checked = check_jq(".model | signature", FIXTURE_ROOT, tooling=True)
    got = evaluate_jq(checked, FIXTURE, tooling=True, platform=[_jq_signature.east_platform_function])
    assert got == "(price, region) => demand"


def test_builtins_lists_each_builtin_a_query_may_call_with_its_arity_in_order() -> None:
    names = list(evaluate_jq("builtins", None, input_type=NullType))
    assert "map/1" in names and "range/3" in names and "now/0" not in names and "signature/0" not in names
    assert names == sorted(names, key=cmp_to_key(compare_for(StringType)))


def test_a_recursive_def_with_value_parameters_is_a_function_reached_through_a_reference() -> None:
    checked = check_jq("def fib($n): if $n < 2 then $n else fib($n - 1) + fib($n - 2) end; fib(15)", NullType)
    assert evaluate_jq(checked, None) == 610


def test_walk_rebuilds_a_recursive_value_bottom_up() -> None:
    doubled = evaluate_jq('.bom | walk(if type == "number" then . * 2 else . end) | [recurse(.children[]) | .cost] | add',
                          FIXTURE, input_type=FIXTURE_ROOT)
    original = evaluate_jq(".bom | [recurse(.children[]) | .cost] | add", FIXTURE, input_type=FIXTURE_ROOT)
    assert doubled == original * 2


def _numbers(*ns: int) -> Any:
    return EastArray(IntegerType, list(ns))


def test_del_deletes_every_path_at_once_as_jq_does() -> None:
    assert_value(Numbers, evaluate_jq("del(.[0], .[2])", _numbers(1, 2, 3, 4), input_type=Numbers), _numbers(2, 4))
    assert_value(Numbers, evaluate_jq("del(.[] | select(. == 2))", _numbers(1, 2, 3), input_type=Numbers),
                 _numbers(1, 3))
    assert_value(Numbers, evaluate_jq("del(.[1:])", _numbers(1, 2, 3), input_type=Numbers), _numbers(1))


def test_an_update_deletes_an_array_element_when_it_gives_no_output() -> None:
    assert_value(Numbers, evaluate_jq("map_values(select(. > 1))", _numbers(1, 2, 3), input_type=Numbers),
                 _numbers(2, 3))
    assert_value(Numbers, evaluate_jq(".[] |= empty", _numbers(1, 2, 3), input_type=Numbers), _numbers())


def test_an_updates_index_past_the_end_of_an_array_is_an_error_where_jq_pads_with_nulls() -> None:
    with pytest.raises(QueryError) as e:
        evaluate_jq(".[5] |= 3", _numbers(1, 2), input_type=Numbers)
    assert e.value.diagnostics[0]["code"] == "runtime"


def test_a_struct_field_an_update_gives_no_value_only_sometimes_raises_an_error_there() -> None:
    point = StructType([("x", IntegerType), ("y", IntegerType)])
    assert_value(point, evaluate_jq(".x |= select(. > 0)", EastStruct({"x": 1, "y": 2}), input_type=point),
                 EastStruct({"x": 1, "y": 2}))
    with pytest.raises(QueryError, match="cannot be deleted"):
        evaluate_jq(".x |= select(. > 0)", EastStruct({"x": -1, "y": 2}), input_type=point)


def test_a_walk_updates_the_values_inside_a_value_that_it_had_before_its_own_update() -> None:
    part = RecursiveType(lambda self: StructType([("children", ArrayType(self)), ("sku", StringType)]))

    def node(sku: str, *children: Any) -> Any:
        return EastStruct({"children": EastArray(part, list(children)), "sku": sku})
    tree = node("A", node("B", node("C")))
    skus = evaluate_jq("(.. | objects | .children) |= . + . | [recurse(.children[]) | .sku]", tree, input_type=part)
    assert_value(ArrayType(StringType), skus, EastArray(StringType, ["A", "B", "C", "C", "B", "C"]))


def test_descend_and_recurse_walk_a_value_typed_as_a_recursive_types_node() -> None:
    # The node's children are the recursive type, which equals the node: a
    # kind already seen, which must still make the walk the recursive one.
    # East.jq on a recursive value types it so: type_of cannot see the wrapper.
    from east.query.jq.shapes import node_of

    part = RecursiveType(lambda self: StructType([("children", ArrayType(self)), ("sku", StringType)]))

    def node(sku: str, *children: Any) -> Any:
        return EastStruct({"children": EastArray(part, list(children)), "sku": sku})
    tree = node("A", node("B", node("C")))
    skus = ArrayType(StringType)
    expected = EastArray(StringType, ["A", "B", "C"])
    assert_value(skus, evaluate_jq("[.. | objects | .sku]", tree, input_type=node_of(part)), expected)
    assert_value(skus, evaluate_jq("[recurse | .sku?]", tree, input_type=node_of(part)), expected)
    assert_value(skus, East.jq(tree, "[.. | objects | .sku]", skus), expected)


def test_a_literal_read_as_a_float_where_one_kind_of_value_meets_it_stays_an_integer_for_another() -> None:
    # #1138
    row = StructType([("n", IntegerType), ("x", FloatType)])
    assert_value(row, evaluate_jq("(.. | numbers) |= . + 1", EastStruct({"n": 1, "x": 0.5}), input_type=row),
                 EastStruct({"n": 2, "x": 1.5}))


def test_evaluate_jq_caches_a_querys_compiled_function() -> None:
    first = evaluate_jq("map(. + 1)", _numbers(1), input_type=Numbers)
    again = evaluate_jq("map(. + 1)", _numbers(2), input_type=Numbers)
    assert_value(ArrayType(Numbers), EastArray(Numbers, [first, again]), EastArray(Numbers, [_numbers(2), _numbers(3)]))


def test_a_query_over_a_dict_of_struct_keys_looks_up_by_the_keys_type() -> None:
    cell = StructType([("region", StringType), ("week", IntegerType)])
    cells = EastDict(cell, FloatType)
    cells.insert(EastStruct({"region": "NSW", "week": 1}), 1080.0)
    found = evaluate_jq('.[{region: "NSW", week: 1}]', cells, input_type=DictType(cell, FloatType))
    assert_value(OptionType(FloatType), found, some(1080.0))
