#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``East.jq``: a typed jq query as East code, translated when the program is built.

The twin of ``libs/east/src/expr/query.ts`` (``libs/east/devdocs/QUERY.md``
§15). In a build, the query is parsed, checked against its inputs' types and
translated to ordinary East IR, so it runs wherever East runs; on values, it
is checked, translated, compiled once and run now, through ``evaluate_jq``'s
cache.
"""

from __future__ import annotations

from typing import Any

from east.types.types import ArrayType, EastType, StringType, StructType

#: The marker's type: the query's canonical text, and its inputs' names.
MARKER_TYPE = StructType([("east_jq", StringType), ("inputs", ArrayType(StringType))])


def jq(input: Any, program: str, result_type: EastType) -> Any:
    """A jq query over East values, as East code (TS ``East.jq``).

    Inside an ``East.function`` body the query is parsed, checked against its
    inputs' types and translated to ordinary East IR when the program is
    built, so it runs wherever East runs. On values it is checked, translated,
    compiled in east-c (once per query and input type) and run now.

    Args:
        input: The query's input: an expression or a value, or a dict of named
            expressions or values, which the query reads as an e3 root —
            ``.orders`` is the ``orders`` input, read alone, so a lazy input
            stays lazy. A value's type is its own (``type_of``); where that is
            narrower than the one meant (a variant's is its one case), run the
            query with ``evaluate_jq(program, value, input_type=...)``.
        program: The jq text.
        result_type: The query's result type: its outputs' type for a query
            that gives one output, an ``Option`` of it for one that gives at
            most one, an ``Array`` of it for one that gives any number. The
            query must check to exactly this type.

    Returns:
        The query's result, of ``result_type``: in a build, an expression of
        that type's class (an ``ArrayExpression`` for an ``Array``), whose
        methods chain; on values, the value.

    Raises:
        QueryError: When the query does not check, with the checker's
            diagnostics; when it does not check to ``result_type``, naming
            both types; and on values, when the query raises an error as it
            runs (``error(v)``, an integer division by zero, a date that does
            not parse), naming its line and column in the jq text. In a build
            it is a ``QueryBuildError``, an ``ExpressionError`` too, which the
            builder reports as it is; an error the query raises as it runs is
            then an East runtime error of the compiled function, located in
            the jq text.
        TypeError: When a value's East type cannot be told from the value.

    Example:
        >>> Order = StructType([("id", IntegerType), ("total", FloatType)])
        >>> big_orders = East.function(
        ...     [ArrayType(Order)], ArrayType(IntegerType),
        ...     lambda b, orders: East.jq(orders, "[.[] | select(.total > 1000) | .id]", ArrayType(IntegerType)))
        >>> East.compile(big_orders)([{"id": 1, "total": 250.0}, {"id": 2, "total": 1200.0}])
        [2]
    """
    from east.expression.lift import _tracing
    from east.types.values import is_east_struct

    named = isinstance(input, dict) and not is_east_struct(input)
    names = [str(n) for n in input] if named else []
    values = [input[n] for n in names] if named else [input]
    if not _tracing():
        return _evaluate(input, named, names, values, program, result_type)
    return _build(named, names, values, program, result_type)


def _build(named: bool, names: list[str], values: list[Any], program: str, result_type: EastType) -> Any:
    """The query in a build: its marker, one ``let`` per input, then the translation, as one block."""
    from east.expression.expr import Expression
    from east.expression.lift import _lift
    from east.expression.location import location_id
    from east.query.evaluate import QueryBuildError
    from east.query.jq.check import check_jq
    from east.query.jq.lower import A, external, lower
    from east.query.jq.parse import parse_jq
    from east.query.jq.print import print_jq
    from east.query.jq.translate import translate_jq
    from east.types.types import NullType

    exprs = [_lift(v) for v in values]
    input_type = StructType([(n, e.east_type) for n, e in zip(names, exprs, strict=True)]) if named \
        else exprs[0].east_type
    parsed = parse_jq(program)
    checked = check_jq(parsed, input_type, root=named)
    if checked.query is None:
        raise QueryBuildError(checked.diagnostics)
    translation = translate_jq(checked)
    _check_result_type(program, translation.result_type, result_type, QueryBuildError)
    loc = location_id()
    canonical = print_jq(parsed.program.value).text if parsed.program.type == "some" else program
    # The marker: the query as printers show it again.
    marker = A("Struct", MARKER_TYPE, loc, fields={
        "east_jq": A("Value", StringType, loc, value=canonical),
        "inputs": A("NewArray", ArrayType(StringType), loc, values=[A("Value", StringType, loc, value=n) for n in names]),
    })
    statements: list[A] = [marker]
    bound: dict[str, A] = {}
    for i, e in enumerate(exprs):
        variable = A("Variable", e.east_type, loc, mutable=False, name=names[i] if named else "input")
        statements.append(A("Let", NullType, loc, variable=variable, value=external(e.ir, e.east_type)))
        bound[names[i] if named else ""] = variable
    result = translation.build_ast(*(bound[i.name if i.name is not None else ""] for i in translation.inputs))
    statements.extend(result.statements)
    last = statements[-1]
    block = A("Block", last.type if last.type.type == "Never" else translation.result_type, loc,
              statements=statements)
    return Expression(lower(block), block.type)


def _evaluate(input: Any, named: bool, names: list[str], values: list[Any], program: str,
              result_type: EastType) -> Any:
    """The query run now over values, compiled once per query and input type."""
    from east.query.evaluate import QueryError, _compile, _run
    from east.types.values import type_of

    types = []
    for v in values:
        try:
            types.append(type_of(v))
        except TypeError as e:
            raise TypeError(f"East.jq: the East type of the input cannot be told from the value ({e}); run the query "
                            "with evaluate_jq(program, value, input_type=...)") from e
    input_type = StructType(list(zip(names, types, strict=True))) if named else types[0]
    compiled = _compile(program, input_type, named, False, None)
    _check_result_type(program, compiled.translation.result_type, result_type, QueryError)
    return _run(compiled, input)


def _check_result_type(program: str, given: EastType, expected: EastType, error: type[Exception]) -> None:
    """Refuses a result type that is not the query's, naming both, with ``error``: a ``QueryError`` class."""
    from east.query.jq.messages import report
    from east.query.jq.shapes import describe_type, type_equal
    from east.query.jq.spans import to_utf16

    if type_equal(expected, given):
        return
    message = f"type_mismatch: the query gives {describe_type(given)}, not the {describe_type(expected)} it was given."
    raise error([report(to_utf16(program), "type_mismatch", None, message)])


__all__ = ["MARKER_TYPE", "jq"]
