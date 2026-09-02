#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Name parity with the TypeScript surface (#623 part 2).

Every method of a TypeScript expression class (``libs/east/src/expr/*.ts``)
exists on its python twin under the snake_cased name, on the
``Expression`` class AND on the eager value class — for a scalar, whose
python value class (``int``/``float``/``str``/``bool``/``datetime``) takes no
methods, the eager twin is the namespace function of the same name on
``East.<Type>``, value first; every stdlib function (``expr/libs/*.ts``)
exists on its ``East.<Type>`` namespace; and every python-only name on an
expression class is DECLARED here with its reason (a deprecated python-idiom
alias, a python protocol method, a convenience) — so a TypeScript rename
shows up as a failing test, and a python name that drifts from TypeScript
cannot appear unannounced.

The TypeScript sources are read from the monorepo checkout; outside it the
module skips.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from east import East
from east.expression.expr import (
    array,
    blob,
    boolean,
    datetime,
    integer,
    matrix,
    null,
    ref,
    string,
    struct,
    variant,
    vector,
)
from east.expression.expr import (
    dict as dict_,
)
from east.expression.expr import (
    float as float_,
)
from east.expression.expr import (
    set as set_,
)
from east.expression.expr.base import Expression
from east.types.values import (
    EastArray,
    EastBlob,
    EastDict,
    EastMatrix,
    EastRef,
    EastSet,
    EastStruct,
    EastVariant,
    EastVector,
)

TS_EXPR = Path(__file__).resolve().parents[4] / "east" / "src" / "expr"
pytestmark = pytest.mark.skipif(
    not (TS_EXPR / "array.ts").exists(), reason="the TypeScript sources are not checked out here")

_KEYWORDS = {"constructor", "if", "for", "while", "switch", "return", "function", "new", "throw"}
#: a method: `  name(`, `  name<T>(`, `  name<` (a signature continued on the
#: next line), or a property alias `  name = this.other;`
_METHOD = re.compile(
    r"^  (?P<mods>(?:(?:public|private|protected|static|readonly|async|get|set|override) )*)"
    r"(?P<name>[a-zA-Z_]\w*)\s*(?:[<(]|= this\.)")
#: python keywords a TypeScript name collides with: the python twin carries a
#: trailing underscore (`and` → `and_`), the one rename the language forces
_PY_KEYWORDS = {"and": "and_", "or": "or_", "not": "not_"}


def snake(name: str) -> str:
    """``printCompactSI`` → ``print_compact_si``: an acronym stays one word."""
    out = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1_\2", name)
    out = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", out).lower()
    return _PY_KEYWORDS.get(out, out)


def ts_class_methods(file: str, cls: str) -> set[str]:
    """The method names declared in ``export class <cls>`` of ``file``."""
    src = (TS_EXPR / file).read_text(encoding="utf-8")
    # `export class X`, `class X`, or struct.ts's `const _X = class X<…>`
    m = re.search(r"class " + cls + r"\b.*?^\}", src, re.M | re.S)
    assert m, f"class {cls} not found in {file}"
    names = set()
    for line in m.group(0).splitlines():
        mm = _METHOD.match(line)
        if not mm or mm.group("name") in _KEYWORDS:
            continue
        # a private helper is not surface; neither is a `_`-prefixed one
        if "private" in mm.group("mods") or "protected" in mm.group("mods"):
            continue
        if mm.group("name").startswith("_"):
            continue
        names.add(mm.group("name"))
    return names


def ts_class_aliases(file: str, cls: str) -> set[str]:
    """The property aliases (``  name = this.other;``) of ``export class
    <cls>`` — the ``eq``/``lt``/``plus`` family, which every python twin
    carries on the expression class but a namespace does not repeat."""
    src = (TS_EXPR / file).read_text(encoding="utf-8")
    m = re.search(r"class " + cls + r"\b.*?^\}", src, re.M | re.S)
    assert m, f"class {cls} not found in {file}"
    return {mm.group(1) for mm in re.finditer(r"^  ([a-zA-Z_]\w*) = this\.", m.group(0), re.M)}


def ts_lib_functions(file: str) -> set[str]:
    """The keys of the ``export default { … }`` object of ``libs/<file>``."""
    src = (TS_EXPR / "libs" / file).read_text(encoding="utf-8")
    m = re.search(r"^export default \{.*?^\}", src, re.M | re.S)
    assert m, f"no default export in {file}"
    names = set()
    for line in m.group(0).splitlines():
        # a method-style key `  name(` / `  name<`, or an object key
        # `  name: Expr.function(` (indented two or four spaces); a parameter
        # of a signature continued over several lines is indented deeper and
        # never followed by `Expr.function`
        mm = (re.match(r"^ {2}([a-zA-Z]\w*)\s*[<(]", line)
              or re.match(r"^ {2,4}([a-zA-Z]\w*):\s*Expr\.function", line))
        if mm and mm.group(1) not in _KEYWORDS:
            names.add(mm.group(1))
    return names


def public_names(obj: object) -> set[str]:
    return {n for n in dir(obj) if not n.startswith("_")}


_BASE = public_names(Expression)

#: (TypeScript file, class, traced python class, eager python class)
CLASSES = [
    ("array.ts", "ArrayExpr", array.ArrayExpression, EastArray),
    ("set.ts", "SetExpr", set_.SetExpression, EastSet),
    ("dict.ts", "DictExpr", dict_.DictExpression, EastDict),
    ("integer.ts", "IntegerExpr", integer.IntegerExpression, None),
    ("float.ts", "FloatExpr", float_.FloatExpression, None),
    ("string.ts", "StringExpr", string.StringExpression, None),
    ("boolean.ts", "BooleanExpr", boolean.BooleanExpression, None),
    ("datetime.ts", "DateTimeExpr", datetime.DateTimeExpression, None),
    ("blob.ts", "BlobExpr", blob.BlobExpression, EastBlob),
    ("variant.ts", "VariantExpr", variant.VariantExpression, EastVariant),
    ("struct.ts", "StructExpr", struct.StructExpression, EastStruct),
    ("ref.ts", "RefExpr", ref.RefExpression, EastRef),
    ("vector.ts", "VectorExpr", vector.VectorExpression, EastVector),
    ("matrix.ts", "MatrixExpr", matrix.MatrixExpression, EastMatrix),
    ("null.ts", "NullExpr", null.NullExpression, None),
]

#: Python-only names on the TRACED classes, each with its reason. A name
#: not listed here and not in TypeScript fails the test.
DEPRECATED = "deprecated python-idiom alias (warns; the TS name is canonical)"
PROTOCOL = "python protocol / eager-surface twin"
ALLOWED_EXTRAS: dict[str, dict[str, str]] = {
    "ArrayExpr": {
        "extend": PROTOCOL, "pop": PROTOCOL, "flatten_to_array": DEPRECATED,
        "fold": DEPRECATED, "reversed": DEPRECATED, "set_at": DEPRECATED,
        "sorted": DEPRECATED, "get_or_default": "convenience over get(i, onMissing)",
        "group_by": "eager-surface twin (group_to_arrays with the identity value)",
        "to_vector": "VectorFromArray as a method (#601; TS spells East.Vector.fromArray)",
        "unique": "eager-surface twin (to_set with the identity key)",
    },
    "SetExpr": {
        "intersect": DEPRECATED, "diff": DEPRECATED, "sym_diff": DEPRECATED,
        "is_subset": DEPRECATED, "is_disjoint": DEPRECATED, "group_fold": DEPRECATED,
        "flat_map": DEPRECATED + " — a Set spells it flatten_to_array in TypeScript",
    },
    "DictExpr": {
        "keys_set": DEPRECATED, "update_at": DEPRECATED, "merge_key": DEPRECATED,
        "group_fold": DEPRECATED,
        "flat_map": DEPRECATED + " — a Dict spells it flatten_to_array in TypeScript",
        "get_or_default": "convenience over get(k, onMissing)",
        "every": "convenience the TypeScript Dict lacks (its Set has it)",
        "some": "convenience the TypeScript Dict lacks (its Set has it)",
        "sum": "convenience the TypeScript Dict lacks (its Set has it)",
    },
    "FloatExpr": {
        "floor": DEPRECATED + " — East.Float.round_floor(x); math.floor(x) stays",
        "ceil": DEPRECATED + " — East.Float.round_ceil(x); math.ceil(x) stays",
        "trunc": DEPRECATED + " — East.Float.round_trunc(x); math.trunc(x) stays",
        "round": DEPRECATED + " — East.Float.round_half(x)",
    },
    "StringExpr": {
        "upper": DEPRECATED, "lower": DEPRECATED, "strip": DEPRECATED,
        "lstrip": DEPRECATED, "rstrip": DEPRECATED, "size": DEPRECATED,
        "regex_contains": "the StringRegexContains builtin (TypeScript has no method spelling)",
        "regex_index_of": "the StringRegexIndexOf builtin (TypeScript has no method spelling)",
        "regex_replace": "the StringRegexReplace builtin (TypeScript has no method spelling)",
        "try_parse": "the Option-returning parse (the eager `try_parse` twin)",
    },
    "DateTimeExpr": {"print_format": DEPRECATED},
    "VariantExpr": {
        "is_some": "Option convenience (a Match over the two cases)",
        "is_none": "Option convenience (a Match over the two cases)",
        "unwrap_or": "Option convenience (a Match over the two cases)",
    },
    "VectorExpr": {"maximum": DEPRECATED, "minimum": DEPRECATED},
    "MatrixExpr": {"num_rows": DEPRECATED, "num_cols": DEPRECATED},
    "RefExpr": {"set": DEPRECATED},
    "StructExpr": {
        "field": "get_field under the eager EastStruct spelling",
        "keys": "the eager EastStruct.keys() twin (the field names)",
    },
}


@pytest.mark.parametrize("file, cls, traced, eager", CLASSES, ids=[c[1] for c in CLASSES])
def test_every_typescript_method_exists_on_the_traced_class(file, cls, traced, eager):
    want = {snake(n) for n in ts_class_methods(file, cls)}
    have = public_names(traced)
    missing = sorted(want - have)
    assert not missing, f"{cls}: TypeScript methods with no python twin: {missing}"


@pytest.mark.parametrize("file, cls, traced, eager", CLASSES, ids=[c[1] for c in CLASSES])
def test_every_python_extra_on_the_traced_class_is_declared(file, cls, traced, eager):
    want = {snake(n) for n in ts_class_methods(file, cls)}
    have = public_names(traced)
    extras = sorted(have - want - _BASE)
    undeclared = [n for n in extras if n not in ALLOWED_EXTRAS.get(cls, {})]
    assert not undeclared, (
        f"{cls}: python-only names not in TypeScript and not declared in ALLOWED_EXTRAS: "
        f"{undeclared}")
    stale = sorted(set(ALLOWED_EXTRAS.get(cls, {})) - set(extras))
    assert not stale, f"{cls}: ALLOWED_EXTRAS lists names that are gone or now in TypeScript: {stale}"


#: TypeScript methods that are traced-only — an expression combinator with no
#: eager twin on the value class: `equals`/`notEquals` are python's `==`/`!=`.
TRACED_ONLY: dict[str, set[str]] = {
    "*": {"equals", "not_equals", "eq", "equal", "ne", "not_equal"},
}


@pytest.mark.parametrize(
    "file, cls, traced, eager", [c for c in CLASSES if c[3] is not None],
    ids=[c[1] for c in CLASSES if c[3] is not None])
def test_every_typescript_method_exists_on_the_eager_class(file, cls, traced, eager):
    want = ({snake(n) for n in ts_class_methods(file, cls)}
            - TRACED_ONLY["*"] - TRACED_ONLY.get(cls, set()))
    have = public_names(eager)
    missing = sorted(want - have)
    assert not missing, f"{cls}: TypeScript methods with no eager twin on {eager.__name__}: {missing}"


#: (TypeScript file, class, the namespace carrying the scalar's value twins)
SCALARS = [
    ("integer.ts", "IntegerExpr", East.Integer),
    ("float.ts", "FloatExpr", East.Float),
    ("string.ts", "StringExpr", East.String),
    ("boolean.ts", "BooleanExpr", East.Boolean),
    ("datetime.ts", "DateTimeExpr", East.DateTime),
]

#: scalar methods with no namespace twin: the comparison family is the root
#: `East.equal/not_equal/less/…` (and python's operators on values); `and`/
#: `or`/`ifElse` take BODIES, which on values are python's own `and`/`or`/
#: `if` (the value form of `ifElse` is the root `East.if_else`)
_NO_NAMESPACE_TWIN = {
    "equals", "not_equals", "less_than", "less_than_or_equal", "greater_than",
    "greater_than_or_equal", "and_", "or_", "if_else",
}


@pytest.mark.parametrize("file, cls, space", SCALARS, ids=[c[1] for c in SCALARS])
def test_every_scalar_method_has_a_namespace_twin(file, cls, space):
    """``x.add_days(n)`` on an expression is ``East.DateTime.add_days(x, n)``
    on a value: the namespace is the scalar's eager class."""
    want = ({snake(n) for n in ts_class_methods(file, cls) - ts_class_aliases(file, cls)}
            - _NO_NAMESPACE_TWIN)
    have = public_names(space)
    missing = sorted(want - have)
    assert not missing, (
        f"{cls}: TypeScript methods with no eager twin on East.{cls[:-4]}: {missing}")


#: (stdlib file, the namespace carrying it)
LIBS = [
    ("integer.ts", East.Integer), ("float.ts", East.Float), ("datetime.ts", East.DateTime),
    ("string.ts", East.String), ("blob.ts", East.Blob), ("array.ts", East.Array),
    ("set.ts", East.Set), ("dict.ts", East.Dict), ("vector.ts", East.Vector),
    ("matrix.ts", East.Matrix),
]


@pytest.mark.parametrize("file, space", LIBS, ids=[f[0] for f in LIBS])
def test_every_stdlib_function_exists_on_its_namespace(file, space):
    want = {snake(n) for n in ts_lib_functions(file)}
    assert want, f"no functions parsed from libs/{file}"
    have = public_names(space)
    missing = sorted(want - have)
    assert not missing, f"libs/{file}: stdlib functions with no python twin on the namespace: {missing}"


def test_the_root_names():
    for name in ("str", "min", "max", "clamp", "function", "value", "equal", "less", "compile",
                 "print", "is_", "diff", "apply_patch", "compose_patch", "invert_patch"):
        assert hasattr(East, name), f"East.{name} (a TypeScript root name) is missing"
