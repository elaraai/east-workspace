#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""East text through python's entry points (#964).

A string's East text escapes ``\\`` and ``"``, and a quoted name's ``\\`` and a
backtick: every other character is written as itself, as TypeScript and east-c
write it. ``parse_east`` and ``compile_from_east`` read text through east-c, so
they refuse what the grammar refuses — an escape it has no meaning for, a field
missing, trailing input — with east-c's message, where ``parse_east`` once read
``"a\\tb"`` as ``atb``. Text holding a NUL is read and written at its length.

A string is double-quoted: ``parse_east`` once read a single-quoted one, which
TypeScript refuses (#1135). And a back-reference TypeScript writes — under a
quoted field or case name, a Dict key holding ``]``, through a Ref — reads back
to the one container, which prints as the same text again (#1135); one to a
container of another type than the text expects there is refused (#1139).
"""

import pytest
from east.serialization._beast2_eastc import beast2_auto_to_east_text

from east import (
    ArrayType,
    DictType,
    East,
    EastDict,
    EastError,
    IntegerType,
    NullType,
    RefType,
    StringType,
    StructType,
    VariantType,
    coerce_to,
    compile_from_east,
    equal_for,
    variant,
)
from east.ir.builders import ir_function, ir_value
from east.serialization.beast2 import encode_beast2_with_header_for
from east.serialization.east_parser import parse_east
from east.serialization.east_printer import print_east
from east.types.type_of_type import IRType
from east.types.types import FunctionType

# Every C0 control character, a NUL first among them, DEL, a quote and a
# backslash: only the last two are escaped
EVERY_CONTROL = "".join(chr(c) for c in range(32)) + '\x7f"\\'

INTS = ArrayType(IntegerType)


@pytest.mark.parametrize(
    "text",
    [
        pytest.param('"a\\tb"', id="tab escape"),
        pytest.param('"a\\u0009b"', id="unicode escape"),
        pytest.param('"a\\nb"', id="newline escape"),
    ],
)
def test_parse_east_refuses_an_escape_the_grammar_has_no_meaning_for(text):
    with pytest.raises(ValueError, match="unexpected escape sequence in string"):
        parse_east(StringType, text)


def test_parse_east_refuses_trailing_input_and_a_missing_field():
    with pytest.raises(ValueError, match="unexpected input after parsed value"):
        parse_east(StringType, '"ok" more')
    with pytest.raises(ValueError, match="missing required field 'b'"):
        parse_east(StructType([("a", IntegerType), ("b", IntegerType)]), "(a=1)")


def test_parse_east_refuses_a_single_quoted_string():
    with pytest.raises(ValueError, match="expected '\"', got '''"):
        parse_east(StringType, "'a'")


@pytest.mark.parametrize(
    ("typ", "text"),
    [
        pytest.param(
            StructType([("a b", INTS), ("c", INTS)]),
            "(`a b`=[1, 2], c=1#.`a b`)",
            id="under a quoted field name",
        ),
        pytest.param(
            StructType([("d", DictType(StringType, INTS)), ("x", INTS)]),
            '(d={"a]b":[1, 2]}, x=1#.d["a]b"])',
            id="under a Dict key holding ]",
        ),
        pytest.param(
            StructType([("v", VariantType([("my case", INTS), ("other", NullType)])), ("x", INTS)]),
            "(v=.`my case` [1, 2], x=1#.v.`my case`)",
            id="under a quoted case name",
        ),
        pytest.param(
            StructType([("r", RefType(INTS)), ("x", INTS)]),
            "(r=&[1, 2], x=1#.r[])",
            id="through a Ref",
        ),
    ],
)
def test_a_back_reference_typescript_writes_reads_back_to_one_container_and_prints_again(typ, text):
    # A reference read back as a copy would print as a second array
    assert print_east(parse_east(typ, text), typ) == text


def test_a_back_reference_reads_back_as_the_one_python_object():
    value = parse_east(StructType([("a b", INTS), ("c", INTS)]), "(`a b`=[1, 2], c=1#.`a b`)")
    assert value["a b"] is value["c"]


def test_parse_east_refuses_a_back_reference_to_nothing_the_text_holds():
    with pytest.raises(ValueError, match=r"undefined reference 1#\.c at \.b"):
        parse_east(StructType([("a", INTS), ("b", INTS)]), "(a=[1], b=1#.c)")


def test_parse_east_refuses_a_back_reference_to_a_container_of_another_type():
    # Read, `b` would be an array where a Dict belongs
    with pytest.raises(
        ValueError, match=r"invalid reference 1#\.a: it names a value of another type at \.b"
    ):
        parse_east(
            StructType([("a", INTS), ("b", DictType(IntegerType, IntegerType))]), "(a=[1], b=1#.a)"
        )


def test_a_string_of_every_control_character_prints_as_itself_and_parses_back():
    printed = print_east(EVERY_CONTROL, StringType)
    assert printed == '"' + EVERY_CONTROL.replace("\\", "\\\\").replace('"', '\\"') + '"'
    assert equal_for(StringType)(parse_east(StringType, printed), EVERY_CONTROL)


def test_a_string_in_a_struct_as_a_dict_key_and_in_a_variant_round_trips():
    typ = StructType(
        [
            ("s", StringType),
            ("d", DictType(StringType, StringType)),
            ("v", VariantType([("text", StringType)])),
        ]
    )
    value = coerce_to(
        {
            "s": "line\nbreak\ttab",
            "d": EastDict(StringType, StringType, {"key\nwith\x01controls": '"quoted" \\'}),
            "v": variant("text", "\x00\x1f", VariantType([("text", StringType)])),
        },
        typ,
    )
    printed = print_east(value, typ)
    # The text TypeScript's printer writes for the same value
    assert (
        printed
        == '(s="line\nbreak\ttab", d={"key\nwith\x01controls":"\\"quoted\\" \\\\"}, v=.text "\x00\x1f")'
    )
    assert equal_for(typ)(parse_east(typ, printed), value)


@pytest.mark.parametrize(
    ("name", "field_text", "case_text"),
    [
        ("a\\", "(`a\\\\`=1)", ".`a\\\\` 1"),
        ("a`", "(`a\\``=1)", ".`a\\`` 1"),
        ("a\\b\\c", "(`a\\\\b\\\\c`=1)", ".`a\\\\b\\\\c` 1"),
        ("a`b`c", "(`a\\`b\\`c`=1)", ".`a\\`b\\`c` 1"),
        ("x\\y z", "(`x\\\\y z`=1)", ".`x\\\\y z` 1"),
    ],
)
def test_a_name_holding_backslashes_and_backticks_prints_each_escaped_and_parses_back(
    name, field_text, case_text
):
    struct = StructType([(name, IntegerType)])
    fields = coerce_to({name: 1}, struct)
    assert print_east(fields, struct) == field_text
    assert equal_for(struct)(parse_east(struct, field_text), fields)

    cases = VariantType([(name, IntegerType), ("other", NullType)])
    case = variant(name, 1, cases)
    assert print_east(case, cases) == case_text
    assert equal_for(cases)(parse_east(cases, case_text), case)


def test_the_print_and_parse_builtins_write_and_read_the_same_text():
    assert East.String.print(StringType, "a\x00b\tc") == '"a\x00b\tc"'
    assert equal_for(StringType)(East.String.parse(StringType, '"a\x00b\tc"'), "a\x00b\tc")
    with pytest.raises(EastError, match="unexpected escape sequence in string"):
        East.String.parse(StringType, '"a\\tb"')


def test_a_beast2_value_converts_to_text_with_its_nul():
    text = beast2_auto_to_east_text(encode_beast2_with_header_for(StringType)("a\x00b\tc"))
    assert text == '"a\x00b\tc"'


def _returning(literal):
    """The East text of a function returning the String ``literal``."""
    ir = ir_function(FunctionType([], StringType), [], [], ir_value(StringType, literal))
    return print_east(ir, IRType)


def test_compile_from_east_keeps_a_literal_nul_and_control_characters():
    assert compile_from_east(_returning("a\x00b\tc"))() == "a\x00b\tc"


def test_compile_from_east_refuses_an_escape_rather_than_compile_a_wrong_literal():
    text = _returning("a\tb")
    assert text.count("\t") == 1
    with pytest.raises(RuntimeError, match="unexpected escape sequence in string"):
        compile_from_east(text.replace("\t", "\\t"))
