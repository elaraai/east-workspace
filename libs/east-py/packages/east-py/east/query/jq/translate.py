#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The jq translator: a checked program as ordinary East IR. The twin of ``translate.ts``.

A filter is generated with a continuation that receives each of its outputs:
``a | b`` generates ``b`` in ``a``'s continuation, ``.[]`` is a loop, and early
exit (``first``, ``limit``, ``label``) is a labelled break out of every loop
between (``libs/east/devdocs/QUERY.md`` §15). Every value is built by an East
builtin, so a query runs wherever East IR runs.

The program is written as East's typed AST (``east.query.jq.lower``), rule for
rule as TypeScript writes it, and lowered with ``ast_to_ir``'s rules, so the
two translators give the same IR under east-c's normaliser.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from typing import Any

from east.query.jq.lower import UNKNOWN_LOC_ID, A, Label, external, variable
from east.query.jq.print import literal_value
from east.query.jq.shapes import (
    Facts,
    Result,
    Shape,
    TypeShape,
    cases_of,
    cases_of_type,
    dict_key,
    dict_value,
    fields_of,
    members_of,
    node_of,
    nullable_payload,
    type_equal,
    unify,
    unify_shape,
    unwrap,
)
from east.query.jq.spans import (
    JqNode,
    JqPattern,
    child_path,
    from_utf16,
    jq_children,
    to_query_span,
)
from east.serialization.east_printer import print_type
from east.types.types import (
    ArrayType,
    BooleanType,
    DictType,
    EastType,
    FloatType,
    FunctionType,
    IntegerType,
    NeverType,
    NullType,
    OptionType,
    RefType,
    StringType,
    StructType,
    VariantType,
    is_subtype,
)

#: A value the translation passes along: an expression (an AST node), or the root.
Expr = A


@dataclass(frozen=True)
class RootValue:
    """The input of a program checked as an e3 root: each field it reads, an input of its own."""

    fields: dict[str, A]
    root: bool = True


Value = A | RootValue


class Block:
    """A block being written: its statements."""

    __slots__ = ("statements",)

    def __init__(self) -> None:
        self.statements: list[A] = []


#: What receives each output of a filter: the block to write in, and the output.
Emit = Callable[[Block, A], None]


@dataclass(frozen=True)
class Update:
    """A position's new value in an update: the value, and whether its ``none`` deletes the position."""

    value: A
    optional: bool


#: What gives a position's new value in an update, from its old value, or ``None`` when it never gives one.
UpdateFn = Callable[[Block, A], "Update | None"]


@dataclass(frozen=True)
class _Binding:
    """A ``def`` or a filter parameter in scope."""

    kind: str
    path: str
    node: JqNode | None = None
    env_thunk: Callable[[], Env] | None = None
    arg: JqNode | None = None
    env: Env | None = None


@dataclass(frozen=True)
class Env:
    """What is in scope where a node is generated."""

    vars: dict[str, Value]
    defs: dict[str, _Binding]
    labels: dict[str, Label]
    #: Which instance of a def's body this is, as the checker names it.
    instance: str
    #: Recursive defs being generated, by their instance signature: the reference holding each one's function.
    recursion: dict[str, A] = field(default_factory=dict)


@dataclass(frozen=True)
class CallSite:
    """A call of a builtin being translated."""

    name: str
    path: str
    args: list[JqNode]
    arg_paths: list[str]
    block: Block
    x: Value
    env: Env
    emit: Emit


#: A builtin's translation.
BuiltinRule = Callable[["Translator", CallSite], None]


class TranslationError(Exception):
    """Raised when a checked program holds something the translator cannot express.

    The checker refuses what a query may not do, so this marks a gap in the
    translation, never a mistake in the query.
    """

    def __init__(self, message: str) -> None:
        super().__init__(f"translateJq: {message}")


def is_root(value: Value) -> bool:
    """Whether a value is the root."""
    return isinstance(value, RootValue)


def _fits(t: EastType, shape: Shape) -> bool:
    """Whether a value of a type is one a node's records were made for."""
    if shape.kind == "type":
        return type_equal(t, shape.type)  # type: ignore[union-attr]
    if shape.kind == "union":
        return any(type_equal(t, m.shape.type) for m in shape.members)  # type: ignore[union-attr]
    return False


def _holds_never(t: EastType) -> bool:
    """Whether a type holds Never below its top: East's casts do not take such a type."""
    seen: list[EastType] = []

    def visit(u: EastType, top: bool) -> bool:
        if u.type == "Never":
            return not top
        if any(s is u for s in seen):
            return False
        seen.append(u)
        kind = u.type
        if kind in ("Array", "Ref", "Set", "Vector", "Matrix"):
            return visit(u.value, False)
        if kind == "Dict":
            return visit(dict_key(u), False) or visit(dict_value(u), False)
        if kind in ("Struct", "Variant"):
            return any(visit(m["type"], False) for m in u.value)
        if kind == "Recursive":
            return visit(node_of(u), False)
        return False

    return visit(t, True)


def _same_type(a: EastType, b: EastType) -> bool:
    """Whether values of type ``b`` are values of type ``a``: equal, or ``a`` recursive with ``b`` its node."""
    return type_equal(a, b) or (a.type == "Recursive" and type_equal(node_of(a), b))


def _block_type(block: Block) -> EastType:
    """A block's type: its last statement's, or Null when it has none."""
    return block.statements[-1].type if block.statements else NullType


def _node_type(t: EastType) -> EastType:
    """A recursive type's node, else the type."""
    return node_of(t) if t.type == "Recursive" else t


def _value_ast(v: Any, t: EastType, loc_id: int) -> A:
    """A constant of a type, as ``valueOrExprToAstTyped`` writes one."""
    kind = t.type
    if kind in ("Null", "Boolean", "Integer", "Float", "String", "DateTime", "Blob"):
        return A("Value", t, loc_id, value=v)
    if kind == "Ref":
        return A("NewRef", t, loc_id, value=_value_ast(v, t.value, loc_id))
    if kind == "Array":
        return A("NewArray", t, loc_id, values=[_value_ast(x, t.value, loc_id) for x in v])
    if kind == "Set":
        return A("NewSet", t, loc_id, values=[_value_ast(x, t.value, loc_id) for x in v])
    if kind == "Dict":
        entries = v.items() if isinstance(v, dict) else v
        return A("NewDict", t, loc_id, values=[(_value_ast(k, dict_key(t), loc_id), _value_ast(x, dict_value(t), loc_id))
                                               for k, x in entries])
    if kind == "Struct":
        return A("Struct", t, loc_id, fields={name: _value_ast(v[name], ft, loc_id) for name, ft in fields_of(t).items()})
    if kind == "Variant":
        case = v.type
        case_type = cases_of_type(t)[case]
        return A("Variant", t, loc_id, case=case, value=_value_ast(v.value, case_type, loc_id))
    if kind == "Recursive":
        return A("WrapRecursive", t, loc_id, value=_value_ast(v, node_of(t), loc_id))
    raise TranslationError(f"a constant of {print_type(t)}")


class Translator:
    """The translator for one checked program."""

    def __init__(self, checked: Any, max_outputs: int | None = None, tooling: bool = False) -> None:
        self.checked = checked
        self.max_outputs = max_outputs
        self.tooling = tooling
        self._literals: dict[bytes, tuple[EastType, Any]] = {}
        self._locs: dict[str, int] = {}
        self._retyped: dict[str, str | None] = {}

    def gap(self, message: str) -> TranslationError:
        """The error for a gap in the translation."""
        return TranslationError(message)

    # ─── Building IR ────────────────────────────────────────────────────────

    def loc(self, path: str) -> int:
        """The location of a node in the jq text, as the IR's source map holds it: file ``jq``, its line and column."""
        known = self._locs.get(path)
        if known is not None:
            return known
        from east.expression.location import current_source_map

        source_map = current_source_map()
        span = self.checked.source.spans.get(path)
        loc_id = UNKNOWN_LOC_ID
        if source_map is not None and span is not None:
            s = to_query_span(self.checked.source.units, span.from_, span.to)
            loc_id = source_map.intern_stack((("jq", s["line"], s["column"]),))
        self._locs[path] = loc_id
        return loc_id

    def type(self, e: A) -> EastType:
        return e.type

    def block(self) -> Block:
        return Block()

    def ended(self, b: Block) -> bool:
        """Whether a block has ended: its last statement breaks, raises or returns."""
        return len(b.statements) > 0 and b.statements[-1].type.type == "Never"

    def b(self, name: str, type_parameters: list[EastType], args: list[A], output: EastType, path: str) -> A:
        """A call of an East builtin."""
        return A("Builtin", output, self.loc(path), builtin=name, type_parameters=list(type_parameters),
                 arguments=list(args))

    def value(self, v: Any, t: EastType, path: str = "") -> A:
        """A constant of a type."""
        return _value_ast(v, t, self.loc(path))

    def int_(self, n: int, path: str = "") -> A:
        return self.value(int(n), IntegerType, path)

    def float_(self, n: float, path: str = "") -> A:
        return self.value(float(n), FloatType, path)

    def str_(self, s: str, path: str = "") -> A:
        return self.value(s, StringType, path)

    def bool_(self, v: bool, path: str = "") -> A:
        return self.value(bool(v), BooleanType, path)

    def null(self, path: str = "") -> A:
        return self.value(None, NullType, path)

    def as_(self, e: A, t: EastType) -> A:
        """A value as a wider type it is a subtype of, through a recursive wrapper where one is between."""
        source = e.type
        if t.type == "Recursive" and source.type != "Recursive" and source.type != "Never":
            return A("WrapRecursive", t, UNKNOWN_LOC_ID, value=self.as_(e, node_of(t)))
        if source.type == "Recursive" and t.type != "Recursive":
            return self.as_(self.open(e), t)
        if type_equal(source, t):
            return e
        if not is_subtype(source, t):
            raise self.gap(f"{print_type(source)} is not a {print_type(t)}")
        return A("As", t, UNKNOWN_LOC_ID, value=e)

    def some(self, payload: A, option_type: EastType) -> A:
        p = cases_of_type(option_type)["some"]
        return A("Variant", option_type, UNKNOWN_LOC_ID, case="some", value=self.as_(payload, p))

    def none(self, option_type: EastType) -> A:
        return A("Variant", option_type, UNKNOWN_LOC_ID, case="none",
                 value=A("Value", NullType, UNKNOWN_LOC_ID, value=None))

    def variant_of(self, t: EastType, name: str, payload: A) -> A:
        """A case of a variant type, wrapped when the type is recursive."""
        node_t = _node_type(t)
        p = cases_of_type(node_t)[name]
        built = A("Variant", node_t, UNKNOWN_LOC_ID, case=name, value=self.as_(payload, p))
        return A("WrapRecursive", t, UNKNOWN_LOC_ID, value=built) if t.type == "Recursive" else built

    def struct(self, t: EastType, values: dict[str, A]) -> A:
        """A struct of a type from its fields' values, wrapped when the type is recursive."""
        node_t = _node_type(t)
        fields: dict[str, A] = {}
        for name, field_type in fields_of(node_t).items():
            v = values.get(name)
            if v is None:
                raise self.gap(f"no value for the field {name}")
            fields[name] = self.as_(v, field_type)
        built = A("Struct", node_t, UNKNOWN_LOC_ID, fields=fields)
        return A("WrapRecursive", t, UNKNOWN_LOC_ID, value=built) if t.type == "Recursive" else built

    def field(self, s: A, name: str) -> A:
        """A field of a struct value."""
        opened = self.open(s)
        field_type = fields_of(opened.type).get(name) if opened.type.type == "Struct" else None
        if field_type is None:
            raise self.gap(f".{name} is not a field of {print_type(opened.type)}")
        return A("GetField", field_type, UNKNOWN_LOC_ID, field=name, struct=opened)

    def open(self, e: A) -> A:
        """A value read through its recursive wrapper and references: what jq sees."""
        v = e
        while True:
            t = v.type
            if t.type == "Recursive":
                v = A("UnwrapRecursive", node_of(t), UNKNOWN_LOC_ID, value=v)
            elif t.type == "Ref":
                v = self.b("RefGet", [t.value], [v], t.value, "")
            else:
                return v

    def call_fn(self, fn: A, args: list[A], path: str) -> A:
        """A call of a function value."""
        t = fn.type
        inputs = t.value["inputs"]
        return A("Call", t.value["output"], self.loc(path), function=fn,
                 arguments=[self.as_(a, inputs[i]) for i, a in enumerate(args)])

    def lambda_(self, inputs: list[EastType], output: EastType, names: list[str],
                body: Callable[..., A | None], path: str) -> A:
        """An East function value, built from a body that gives its result."""
        parameters = [variable(t, names[i] if i < len(names) else None) for i, t in enumerate(inputs)]
        b = Block()
        result = body(b, *parameters)
        if result is not None and not self.ended(b):
            b.statements.append(self.as_(result, output))
        s = b.statements
        if not s:
            body_ast = A("Value", NullType, UNKNOWN_LOC_ID, value=None)
        elif len(s) == 1:
            body_ast = s[0]
        else:
            body_ast = A("Block", s[-1].type, UNKNOWN_LOC_ID, statements=s)
        return A("Function", FunctionType(inputs, output), self.loc(path), parameters=parameters, body=body_ast)

    def round(self, name: str, v: A, b: Block, path: str) -> A:
        """A function of East's float library, called on a number."""
        return self.call_fn(_library_function(name), [self.widen_to(b, v, FloatType, path)], path)

    # ─── Statements ─────────────────────────────────────────────────────────

    def declare(self, b: Block, init: A, name: str, mutable: bool = True, t: EastType | None = None) -> A:
        """Declares a variable holding a value: ``let`` when ``mutable``, else ``const``."""
        vt = init.type if t is None else t
        var = variable(vt, name, mutable)
        b.statements.append(A("Let", NullType, UNKNOWN_LOC_ID, variable=var, value=self.as_(init, vt)))
        return var

    def bind(self, b: Block, e: A, name: str) -> A:
        """A value bound to a variable of its own, unless it is one already or a constant: computed once."""
        if e.ast_type in ("Variable", "Value"):
            return e
        return self.declare(b, e, name, False)

    def assign(self, b: Block, var: A, value: A) -> None:
        if self.ended(b):
            return
        v = var
        if v.ast_type == "UnwrapRecursive":
            v = v.value
        if v.ast_type != "Variable":
            raise self.gap("an assignment to something not a variable")
        b.statements.append(A("Assign", NullType, UNKNOWN_LOC_ID, variable=v, value=self.as_(value, v.type)))

    def stmt(self, b: Block, e: A) -> None:
        """An expression evaluated for its effect."""
        if self.ended(b):
            return
        b.statements.append(e)

    def raise_(self, b: Block, message: A | str, path: str) -> None:
        """A runtime error, located at a node."""
        if self.ended(b):
            return
        m = self.str_(message, path) if isinstance(message, str) else message
        b.statements.append(A("Error", NeverType, self.loc(path), message=m))

    def brk(self, b: Block, label: Label) -> None:
        if self.ended(b):
            return
        b.statements.append(A("Break", NeverType, UNKNOWN_LOC_ID, label=label))

    def body(self, inner: Block) -> A:
        """A block's statements as one body, closed as the builder closes a block: null-terminated."""
        s = inner.statements
        if not s:
            return A("Value", NullType, UNKNOWN_LOC_ID, value=None)
        if len(s) == 1 and is_subtype(s[0].type, NullType):
            return s[0]
        if not is_subtype(s[-1].type, NullType):
            s.append(A("Value", NullType, UNKNOWN_LOC_ID, value=None))
        return A("Block", s[-1].type, UNKNOWN_LOC_ID, statements=s)

    def block_value(self, build: Callable[[Block], A], t: EastType) -> A:
        """A block that gives a value: its statements, then the value."""
        inner = Block()
        v = build(inner)
        if self.ended(inner):
            return A("Block", NeverType, UNKNOWN_LOC_ID, statements=inner.statements)
        value_ast = self.as_(v, t)
        if not inner.statements:
            return value_ast
        return A("Block", t, UNKNOWN_LOC_ID, statements=[*inner.statements, value_ast])

    def for_each(self, b: Block, collection: A, each: Callable[[Block, A, A | None, Label], None], path: str,
                 name: str = "item") -> None:
        """Loops over an array, set, dict, vector or matrix: each element (a set's key; a dict's value, and its key)."""
        if self.ended(b):
            return
        c = self.open(collection)
        t = c.type
        label = Label(self.loc(path))
        inner = Block()
        if t.type == "Array":
            value = variable(t.value, name)
            key = variable(IntegerType, "index")
            each(inner, value, key, label)
            b.statements.append(A("ForArray", NullType, label.loc_id, label=label, array=c, key=key, value=value,
                                  body=self.body(inner)))
            return
        if t.type == "Set":
            key = variable(t.value, name)
            each(inner, key, None, label)
            b.statements.append(A("ForSet", NullType, label.loc_id, label=label, set=c, key=key, body=self.body(inner)))
            return
        if t.type == "Dict":
            value = variable(dict_value(t), name)
            key = variable(dict_key(t), "key")
            each(inner, value, key, label)
            b.statements.append(A("ForDict", NullType, label.loc_id, label=label, dict=c, key=key, value=value,
                                  body=self.body(inner)))
            return
        if t.type == "Vector":
            self.for_each(b, self.b("VectorToArray", [t.value], [c], ArrayType(t.value), path), each, path, name)
            return
        if t.type == "Matrix":
            self.for_each(b, self.b("MatrixToArray", [t.value], [c], ArrayType(ArrayType(t.value)), path), each, path,
                          name)
            return
        raise self.gap(f"a loop over {print_type(t)}")

    def while_loop(self, b: Block, condition: A | bool, body: Callable[[Block, Label], None], path: str) -> None:
        """A loop while a condition holds; ``True`` for one left only by ``break``."""
        if self.ended(b):
            return
        label = Label(self.loc(path))
        inner = Block()
        body(inner, label)
        predicate = A("Value", BooleanType, UNKNOWN_LOC_ID, value=True) if condition is True else condition
        b.statements.append(A("While", NullType, label.loc_id, predicate=predicate, label=label, body=self.body(inner)))

    def once(self, b: Block, body: Callable[[Block, Label], None], path: str) -> None:
        """A block that runs once, with a label that leaves it early: how a stream stops."""
        def run(inner: Block, label: Label) -> None:
            body(inner, label)
            self.brk(inner, label)
        self.while_loop(b, True, run, path)

    def if_else(self, b: Block, condition: A, then: Callable[[Block], None],
                otherwise: Callable[[Block], None] | None, path: str) -> None:
        """``if``, with an optional ``else``."""
        if self.ended(b):
            return
        t = Block()
        then(t)
        e = Block()
        if otherwise is not None:
            otherwise(e)
        then_ast = self.body(t)
        else_ast = self.body(e)
        typ = NeverType if then_ast.type.type == "Never" and else_ast.type.type == "Never" else NullType
        b.statements.append(A("IfElse", typ, self.loc(path), ifs=[(condition, then_ast)], else_body=else_ast))

    def branch(self, b: Block, condition: A | bool, then: Callable[[Block], None], otherwise: Callable[[Block], None],
               path: str) -> None:
        """Runs ``then`` where a condition holds and ``otherwise`` where it does not; a known one runs one only."""
        if self.ended(b):
            return
        if isinstance(condition, bool):
            known: Any = condition
        else:
            c = self.constant(condition)
            known = None if c is None else c[0]
        if known is True:
            then(b)
            return
        if known is False:
            otherwise(b)
            return
        self.if_else(b, condition, then, otherwise, path)  # type: ignore[arg-type]

    def match(self, b: Block, v: A, handlers: dict[str, Callable[[Block, A], None]], path: str) -> None:
        """A statement that runs a handler for the case a variant holds; a case with no handler does nothing."""
        if self.ended(b):
            return
        opened = self.open(v)
        t = opened.type
        cases: dict[str, tuple[A, A]] = {}
        never = True
        for name, payload in cases_of_type(t).items():
            var = variable(payload, "value" if name == "some" else "payload")
            inner = Block()
            handler = handlers.get(name)
            if handler is not None:
                handler(inner, var)
            body_ast = self.body(inner)
            if body_ast.type.type != "Never":
                never = False
            cases[name] = (var, body_ast)
        b.statements.append(A("Match", NeverType if never else NullType, self.loc(path), variant=opened, cases=cases))

    def match_value(self, v: A, cases: dict[str, Callable[[Block, A], A]], t: EastType, path: str) -> A:
        """A value chosen by the case a variant holds: each case's block gives it."""
        opened = self.open(v)
        vt = opened.type
        out: dict[str, tuple[A, A]] = {}
        for name, payload in cases_of_type(vt).items():
            var = variable(payload, "value" if name == "some" else "payload")
            build = cases.get(name)
            if build is None:
                raise self.gap(f"no value for the case {name}")

            def value_of(inner: Block, build: Callable[[Block, A], A] = build, var: A = var) -> A:
                return build(inner, var)
            out[name] = (var, self.block_value(value_of, t))
        return A("Match", t, self.loc(path), variant=opened, cases=out)

    def if_value(self, condition: A, then: Callable[[Block], A], otherwise: Callable[[Block], A], t: EastType,
                 path: str) -> A:
        """A value chosen by a condition."""
        c = self.constant(condition)
        known = None if c is None else c[0]
        if known is True or known is False:
            return self.block_value(then if known else otherwise, t)
        return A("IfElse", t, self.loc(path), ifs=[(condition, self.block_value(then, t))],
                 else_body=self.block_value(otherwise, t))

    def try_catch(self, b: Block, body: Callable[[Block], None], handler: Callable[[Block, A], None], path: str) -> None:
        """``try``/``catch``: the handler receives the error's message."""
        if self.ended(b):
            return
        t = Block()
        body(t)
        message = variable(StringType, "message")
        stack = variable(ArrayType(StructType([("filename", StringType), ("line", IntegerType),
                                               ("column", IntegerType)])), "stack")
        c = Block()
        handler(c, message)
        try_ast = self.body(t)
        catch_ast = self.body(c)
        typ = NeverType if try_ast.type.type == "Never" and catch_ast.type.type == "Never" else NullType
        b.statements.append(A("TryCatch", typ, self.loc(path), try_body=try_ast, catch_body=catch_ast, message=message,
                              stack=stack))

    # ─── Collections ────────────────────────────────────────────────────────

    def empty_array(self, element: EastType) -> A:
        return self.value([], ArrayType(element))

    def push(self, b: Block, array: A, v: A, path: str) -> None:
        """Appends a value to an array variable."""
        if self.ended(b):
            return
        element = array.type.value
        self.stmt(b, self.b("ArrayPushLast", [element], [array, self.widen_to(b, v, element, path)], NullType, path))

    def put(self, b: Block, d: A, key: A, v: A, path: str) -> None:
        """Sets a key of a dict variable, inserting it or replacing its value."""
        if self.ended(b):
            return
        t = d.type
        k_type = dict_key(t)
        v_type = dict_value(t)
        k = self.bind(b, self.widen_to(b, key, k_type, path), "key")
        value = self.bind(b, self.widen_to(b, v, v_type, path), "value")
        self.if_else(b, self.b("DictHas", [k_type, v_type], [d, k], BooleanType, path),
                     lambda b2: self.stmt(b2, self.b("DictUpdate", [k_type, v_type], [d, k, value], NullType, path)),
                     lambda b2: self.stmt(b2, self.b("DictInsert", [k_type, v_type], [d, k, value], NullType, path)),
                     path)

    def as_array(self, b: Block, v: A, path: str) -> A | None:
        """An array-like value as an array: an array itself, a set's keys, a vector's elements, a matrix's rows."""
        e = self.open(v)
        t = e.type
        if t.type == "Array":
            return e
        if t.type == "Set":
            out = self.declare(b, self.empty_array(t.value), "keys")
            self.for_each(b, e, lambda b2, key, _k, _l: self.push(b2, out, key, path), path, "key")
            return out
        if t.type == "Vector":
            return self.b("VectorToArray", [t.value], [e], ArrayType(t.value), path)
        if t.type == "Matrix":
            return self.b("MatrixToArray", [t.value], [e], ArrayType(ArrayType(t.value)), path)
        return None

    def size(self, array: A, path: str) -> A:
        """The number of elements of an array."""
        return self.b("ArraySize", [array.type.value], [array], IntegerType, path)

    def lt(self, a: A, b2: A, path: str) -> A:
        return self.b("Less", [a.type], [a, b2], BooleanType, path)

    def eq(self, a: A, b2: A, path: str) -> A:
        return self.b("Equal", [a.type], [a, b2], BooleanType, path)

    def add(self, a: A, b2: A, path: str) -> A:
        return self.b("IntegerAdd", [], [a, b2], IntegerType, path)

    def not_(self, a: A, path: str) -> A:
        return self.b("BooleanNot", [], [a], BooleanType, path)

    # ─── Literals and the checker's types ───────────────────────────────────

    def literal(self, n: JqNode) -> tuple[EastType, Any]:
        """A literal node's type and value."""
        blob = bytes(n.value)
        known = self._literals.get(blob)
        if known is None:
            known = literal_value(blob)  # type: ignore[assignment]
            self._literals[blob] = known  # type: ignore[assignment]
        return known  # type: ignore[return-value]

    def literal_of(self, n: JqNode | None) -> tuple[EastType, Any] | None:
        """A node's value when it is a literal, as the query wrote it or the checker rewrote it."""
        return self.literal(n) if n is not None and n.type == "literal" else None

    def constant(self, e: A) -> tuple[Any] | None:
        """An expression's value when it is a constant, in a 1-tuple."""
        return (e.value,) if e.ast_type == "Value" else None

    def result(self, path: str, env: Env) -> Result | None:
        """What checking a node gave in an instance."""
        return self.checked.result_at(path, env.instance)

    def type_at(self, path: str, env: Env) -> EastType:
        """The one type a node's outputs share, as the checker collects them."""
        r = self.result(path, env)
        t = None if r is None else unify_shape(r.shape)
        if t is None:
            raise self.gap(f"no one type for {self.text(path) or 'the program'}")
        return t

    def text(self, path: str) -> str:
        """A node's text."""
        span = self.checked.source.spans.get(path)
        return "" if span is None else from_utf16(self.checked.source.units[span.from_:span.to])

    def facts_in(self, shape: Shape | None, t: EastType) -> Facts | None:
        """What narrowing proved about a value of a type in a shape."""
        if shape is None:
            return None
        member = next((m for m in members_of(shape) if type_equal(m.shape.type, t)), None)
        return None if member is None else member.shape.facts

    def env_for(self, path: str, env: Env, x: Value) -> Env:
        """The instance a node's records are in for an input: its own, or one checked again for this input's type."""
        if is_root(x):
            return env
        input_shape = self.checked.input_at(path, env.instance)
        if input_shape is None or _fits(x.type, input_shape):  # type: ignore[union-attr]
            return env
        key = f"{env.instance}|{path}|{print_type(x.type)}"  # type: ignore[union-attr]
        if key in self._retyped:
            instance = self._retyped[key]
        else:
            instance = self.checked.retype(path, env.instance, x.type)  # type: ignore[union-attr]
            self._retyped[key] = instance
        if instance is None:
            raise self.gap(f"{self.text(path) or 'the program'} on {print_type(x.type)}")  # type: ignore[union-attr]
        return replace(env, instance=instance)

    # ─── Converting to the checker's types ──────────────────────────────────

    def widen_to(self, b: Block, e: A, to: EastType, path: str) -> A:  # noqa: C901
        """A value as a type the checker widened it to: Integer as Float, ``T`` or ``null`` as ``Option<T>``, …

        Raises:
            TranslationError: When the type is not wider.
        """
        source = e.type
        if type_equal(source, to):
            return self.as_(e, to)
        if source.type == "Never":
            return self.as_(e, to)
        # An option of Never is always none: as Null, it is null.
        source_payload = nullable_payload(source)
        if to.type == "Null" and source_payload is not None and source_payload.type == "Never":
            self.bind(b, e, "none")
            return self.null(path)
        to_payload = nullable_payload(to)
        if to_payload is not None:
            if source.type == "Null":
                return self.none(to)
            if source_payload is not None:
                # An option of Never is always none; East's casts do not take a Never inside a type.
                if source_payload.type == "Never":
                    self.bind(b, e, "none")
                    return self.none(to)
                if is_subtype(source, to) and not _holds_never(source):
                    return self.as_(e, to)
                return self.match_value(e, {
                    "none": lambda _b2, _p: self.none(to),
                    "some": lambda b2, p: self.some(self.widen_to(b2, p, to_payload, path), to),
                }, to, path)
            return self.some(self.widen_to(b, e, to_payload, path), to)
        if source.type == "Integer" and to.type == "Float":
            c = self.constant(e)
            if c is not None:
                return self.float_(float(c[0]), path)
            return self.b("IntegerToFloat", [], [e], FloatType, path)
        # A literal the checker rewrote to a Float, where this instance of it has an Integer.
        if source.type == "Float" and to.type == "Integer":
            c = self.constant(e)
            if c is not None and isinstance(c[0], float) and math.isfinite(c[0]) and c[0].is_integer():
                return self.int_(int(c[0]), path)
        if is_subtype(source, to) and not _holds_never(source):
            return self.as_(e, to)
        f = self.open(e).type
        t = _node_type(to)

        # A collection of Never is always empty: it is an empty one of the wider type.
        def empty(v: Any) -> A:
            self.bind(b, e, "empty")
            return self.as_(self.value(v, t), to)

        if f.type == "Array" and t.type == "Array" and f.value.type == "Never":
            return empty([])
        if f.type == "Dict" and t.type == "Dict" and dict_value(f).type == "Never":
            return empty({})
        if f.type == "Set" and t.type == "Set" and f.value.type == "Never":
            return empty([])
        if f.type == "Array" and t.type == "Array":
            out = self.declare(b, self.empty_array(t.value), "array")
            self.for_each(b, e, lambda b2, item, _k, _l: self.push(b2, out, item, path), path)
            return out
        if f.type == "Dict" and t.type == "Dict" and type_equal(dict_key(f), dict_key(t)):
            out = self.declare(b, self.value({}, t), "dict")
            self.for_each(b, e, lambda b2, item, key, _l: self.stmt(b2, self.b(
                "DictInsert", [dict_key(t), dict_value(t)],
                [out, key, self.widen_to(b2, item, dict_value(t), path)], NullType, path)), path)  # type: ignore[list-item]
            return out
        if f.type == "Struct" and t.type == "Dict" and len(f.value) == 0:
            return self.value({}, t)
        if f.type == "Struct" and t.type == "Struct":
            bound = self.bind(b, self.open(e), "struct")
            values: dict[str, A] = {}
            for name, field_type in fields_of(t).items():
                values[name] = self.widen_to(b, self.field(bound, name), field_type, path)
            return self.struct(to, values)
        if f.type == "Variant" and t.type == "Variant":
            target_cases = cases_of_type(t)
            cases: dict[str, Callable[[Block, A], A]] = {}
            for name in cases_of_type(f):
                if name not in target_cases:
                    raise self.gap(f"the case {name} as {print_type(to)}")
                cases[name] = (lambda n: lambda b2, p: self.variant_of(to, n, self.widen_to(b2, p, target_cases[n],
                                                                                              path)))(name)
            return self.match_value(e, cases, to, path)
        raise self.gap(f"{print_type(source)} as {print_type(to)}")

    def emit_as(self, b: Block, e: A, to: EastType, path: str, emit: Emit) -> None:
        """Gives a value to ``emit`` as the checker's type for it: widened, or narrowed as narrowing proved."""
        if self.ended(b):
            return
        source = e.type
        if type_equal(source, to):
            emit(b, self.as_(e, to))
            return
        # An option of Never is always none: null, where null can go.
        payload = nullable_payload(source)
        if payload is not None and payload.type == "Never":
            self.bind(b, e, "none")
            if to.type == "Null" or nullable_payload(to) is not None:
                emit(b, self.bind(b, self.widen_to(b, self.null(path), to, path), "value"))
            return
        if nullable_payload(to) is None:
            if source.type == "Null":
                return
            if payload is not None:
                # Proved null, an option gives its none; proved present, its value.
                if to.type == "Null":
                    self.match(b, e, {"none": lambda b2, _p: emit(b2, self.null(path))}, path)
                else:
                    self.match(b, e, {"some": lambda b2, p: self.emit_as(b2, p, to, path, emit)}, path)
                return
        emit(b, self.bind(b, self.widen_to(b, e, to, path), "value"))

    # ─── Truthiness ─────────────────────────────────────────────────────────

    def truthy(self, e: A, path: str) -> A | bool:
        """Whether a value is true to jq, not ``false`` or ``null``: a constant when its type decides it."""
        v = self.open(e)
        t = v.type
        if t.type == "Boolean":
            c = self.constant(v)
            return v if c is None else bool(c[0])
        if t.type in ("Null", "Never"):
            return False
        if nullable_payload(t) is not None:
            return self.match_value(v, {
                "none": lambda _b2, _p: self.bool_(False),
                "some": lambda _b2, p: self.as_expr(self.truthy(p, path)),
            }, BooleanType, path)
        return True

    def as_expr(self, v: A | bool) -> A:
        return self.bool_(v) if isinstance(v, bool) else v

    # ─── The walk ───────────────────────────────────────────────────────────

    def gen(self, n: JqNode, path: str, b: Block, x: Value, env: Env, emit: Emit) -> None:
        """Generates a node: code in ``b`` that gives each of its outputs to ``emit``, as the checker's type for them."""
        if self.ended(b):
            return
        # A literal is its own value, as the checker rewrote it.
        if n.type == "literal":
            self.gen_node(n, path, b, x, env, emit)
            return
        input_shape = self.checked.input_at(path, env.instance)
        # A node the checker never reached, or reached with no input, never runs.
        if input_shape is None or (isinstance(input_shape, TypeShape) and input_shape.type.type == "Never"):
            return
        e = self.env_for(path, env, x)
        r = self.result(path, e)
        if r is None or (r.mult.lo == 1 and r.mult.hi == 0):
            return
        target = r.shape.type if isinstance(r.shape, TypeShape) and r.shape.type.type != "Never" else None
        out: Emit = emit if target is None else (lambda b2, v: self.emit_as(b2, v, target, path, emit))
        self.gen_node(n, path, b, x, e, out)

    def collected(self, n: JqNode, path: str, b: Block, x: Value, env: Env, emit: Emit) -> None:
        """Generates a node, each output as the one type its outputs share."""
        if n.type == "literal":
            self.gen_node(n, path, b, x, env, emit)
            return
        holder: list[EastType] = []

        def each(b2: Block, v: A) -> None:
            if not holder:
                holder.append(self.type_at(path, self.env_for(path, env, x)))
            emit(b2, self.bind(b2, self.widen_to(b2, v, holder[0], path), "value"))
        self.gen(n, path, b, x, env, each)

    def one(self, n: JqNode, path: str, b: Block, x: Value, env: Env, t: EastType) -> A:
        """The one output of a node that gives exactly one, as an expression of a type."""
        mark = len(b.statements)
        state: dict[str, Any] = {"direct": None, "cell": None}

        def declare_cell() -> A:
            if state["cell"] is not None:
                return state["cell"]
            cell = variable(t, "one", True)
            state["cell"] = cell
            b.statements.insert(mark, A("Let", NullType, UNKNOWN_LOC_ID, variable=cell, value=self.placeholder(t)))
            direct = state["direct"]
            if direct is not None:
                # The first output was taken as it was given; it assigns the variable there instead.
                b.statements.insert(direct[1] + 1, A("Assign", NullType, UNKNOWN_LOC_ID, variable=cell, value=direct[0]))
                state["direct"] = None
            return cell

        def each(b2: Block, v: A) -> None:
            if self.ended(b2):
                return
            w = self.widen_to(b2, v, t, path)
            if b2 is b and state["cell"] is None and state["direct"] is None:
                bound = self.bind(b, w, "one")
                state["direct"] = (bound, len(b.statements))
                return
            var = declare_cell()
            b2.statements.append(A("Assign", NullType, UNKNOWN_LOC_ID, variable=var, value=w))

        self.gen(n, path, b, x, env, each)
        if state["direct"] is not None:
            return state["direct"][0]
        if state["cell"] is not None:
            return state["cell"]
        return self.placeholder(t)

    def placeholder(self, t: EastType) -> A:
        """A value of a type to start a variable with, assigned before it is read."""
        zero = self.zero_of(t, [])
        if zero is not None:
            return zero
        # A type with no plain value: an expression that raises, never evaluated.
        return A("As", t, UNKNOWN_LOC_ID, value=A(
            "Error", NeverType, UNKNOWN_LOC_ID,
            message=A("Value", StringType, UNKNOWN_LOC_ID, value="unreachable: a query value read before it was given")))

    def zero_of(self, t: EastType, seen: list[EastType]) -> A | None:
        """A plain value of a type, when there is one."""
        if any(s is t for s in seen):
            return None
        u = _node_type(t)
        kind = u.type
        if kind == "Null":
            return self.null()
        if kind == "Boolean":
            return self.bool_(False)
        if kind == "Integer":
            return self.int_(0)
        if kind == "Float":
            return self.float_(0.0)
        if kind == "String":
            return self.str_("")
        if kind == "DateTime":
            return self.value(datetime(1970, 1, 1, tzinfo=UTC), u)
        if kind == "Blob":
            return self.value(b"", u)
        if kind == "Array":
            return self.value([], u)
        if kind == "Set":
            return self.value([], u)
        if kind == "Dict":
            return self.value({}, u)
        if kind == "Struct":
            inner = [*seen, t]
            values: dict[str, A] = {}
            for name, f in fields_of(u).items():
                z = self.zero_of(f, inner)
                if z is None:
                    return None
                values[name] = z
            return self.struct(t, values)
        if kind == "Variant":
            inner = [*seen, t]
            for name, payload in cases_of_type(u).items():
                z = self.zero_of(payload, inner)
                if z is not None:
                    return self.variant_of(t, name, z)
            return None
        return None

    def gen_node(self, n: JqNode, path: str, b: Block, x: Value, env: Env, emit: Emit) -> None:  # noqa: C901
        def at(step: str) -> str:
            return child_path(path, step)

        kind = n.type
        v = n.value
        if kind == "identity":
            emit(b, self.expr(x, path))
            return
        if kind == "literal":
            t, value = self.literal(n)
            emit(b, self.value(value, t, path))
            return
        if kind == "variable":
            if v == "__loc__":
                emit(b, self.location(path))
                return
            bound = env.vars.get(v)
            if bound is None:
                raise self.gap(f"${v} is not bound")
            emit(b, self.expr(bound, path))
            return
        if kind == "pipe":
            # `. | f` is f on the input itself, the root included.
            if v["left"].type == "identity":
                self.gen(v["right"], at("pipe.right"), b, x, env, emit)
                return
            self.gen(v["left"], at("pipe.left"), b, x, env,
                     lambda b2, lv: self.gen(v["right"], at("pipe.right"), b2, lv, env, emit))
            return
        if kind == "comma":
            self.gen(v["left"], at("comma.left"), b, x, env, emit)
            self.gen(v["right"], at("comma.right"), b, x, env, emit)
            return
        if kind == "field":
            name = v["name"]
            optional = v["optional"]
            target = v["target"]
            target_path = at("field.target")
            # `.name` reads the input itself: a root's field is the input of that name.
            if target.type == "identity" and is_root(x):
                self.read_field(b, x, name, optional, path, None, emit)
                return

            def read(b2: Block, tv: Value) -> None:
                if is_root(tv):
                    facts = None
                else:
                    r = self.result(target_path, self.env_for(target_path, env, x))
                    facts = self.facts_in(None if r is None else r.shape, tv.type)  # type: ignore[union-attr]
                self.read_field(b2, tv, name, optional, path, facts, emit)
            self.gen(target, target_path, b, x, env, read)
            return
        if kind == "index":
            self.gen_index(n, path, b, x, env, emit)
            return
        if kind == "slice":
            self.gen_slice(n, path, b, x, env, emit)
            return
        if kind == "iterate":
            self.gen(v["target"], at("iterate.target"), b, x, env,
                     lambda b2, tv: self.iterate(b2, self.expr(tv, path), v["optional"], path, emit))
            return
        if kind == "descend":
            self.descend(b, self.expr(x, path), path, emit)
            return
        if kind == "array":
            element = self.type_at(path, env).value
            if v.type == "none":
                emit(b, self.empty_array(element))
                return
            out = self.declare(b, self.empty_array(element), "array")
            self.gen(v.value, at("array.some"), b, x, env, lambda b2, item: self.push(b2, out, item, path))
            emit(b, out)
            return
        if kind == "object":
            self.gen_object(n, path, b, x, env, emit)
            return
        if kind == "string":
            self.gen_string(v, path, b, x, env, emit, lambda b2, sv: self.tostring(b2, sv, path), path)
            return
        if kind == "format":
            from east.query.jq.translate_builtins import FORMATS

            fmt = FORMATS.get(v["name"])
            if fmt is None:
                raise self.gap(f"no translation for the format @{v['name']}")
            inner = v["string"]
            if inner.type == "some" and inner.value.type == "string":
                # `@base64 "…\(f)…"`: each interpolated value through the format, the text as it is.
                string_path = at("format.string.some")
                self.gen_string(inner.value.value, path, b, x, env, emit, lambda b2, sv: fmt(self, b2, sv, path),
                                string_path)
                return
            emit(b, fmt(self, b, self.expr(x, path), path))
            return
        if kind == "negate":
            self.gen(v, at("negate"), b, x, env, lambda b2, nv: self.negate(b2, nv, path, emit))
            return
        if kind == "binary":
            self.gen_binary(n, path, b, x, env, emit)
            return
        if kind == "alternative":
            self.gen_alternative(n, path, b, x, env, emit)
            return
        if kind == "if":
            self.gen_if(n, path, b, x, env, emit, 0)
            return
        if kind == "try":
            self.gen_try(n, path, b, x, env, emit)
            return
        if kind in ("reduce", "foreach"):
            self.gen_fold(n, path, b, x, env, emit)
            return
        if kind == "bind":
            self.gen_bind(n, path, b, x, env, emit)
            return
        if kind == "label":
            def labelled(b2: Block, label: Label) -> None:
                labels = {**env.labels, v["name"]: label}
                self.gen(v["body"], at("label.body"), b2, x, replace(env, labels=labels), emit)
            self.once(b, labelled, path)
            return
        if kind == "break":
            label = env.labels.get(v)
            if label is None:
                raise self.gap(f"break ${v} outside its label, or across a function")
            self.brk(b, label)
            return
        if kind == "def":
            defs = dict(env.defs)
            closure: list[Env] = []
            defs[f"{v['name']}/{len(v['params'])}"] = _Binding("def", path, node=n, env_thunk=lambda: closure[0])
            closure.append(replace(env, defs=defs))
            self.gen(v["rest"], at("def.rest"), b, x, closure[0], emit)
            return
        if kind == "call":
            self.gen_call(n, path, b, x, env, emit)
            return
        if kind == "update":
            self.gen_update(n, path, b, x, env, emit)
            return
        raise self.gap(f"a {kind} node")

    def negate(self, b: Block, v: A, path: str, emit: Emit) -> None:
        """``-v``: a number negated; any other value raises jq's error, naming its kind."""
        o = self.open(v)
        t = o.type
        if t.type == "Integer":
            emit(b, self.b("IntegerNegate", [], [o], IntegerType, path))
        elif t.type == "Float":
            emit(b, self.b("FloatNegate", [], [o], FloatType, path))
        elif nullable_payload(t) is not None:
            self.match(b, o, {
                "none": lambda b2, _p: self.raise_(b2, "null cannot be negated", path),
                "some": lambda b2, p: self.negate(b2, p, path, emit),
            }, path)
        else:
            self.raise_(b, f"{jq_kind(t)} cannot be negated", path)

    def location(self, path: str) -> A:
        """``$__loc__``: where a node is, as jq gives it."""
        span = self.checked.source.spans.get(path)
        line = 1 if span is None else to_query_span(self.checked.source.units, span.from_, span.to)["line"]
        return self.value({"file": "<top-level>", "line": line}, StructType([("file", StringType), ("line", IntegerType)]),
                          path)

    def expr(self, v: Value, path: str) -> A:
        """A value that must be an expression: the root is only ever read a field at a time."""
        if is_root(v):
            raise self.gap(f"the whole root as a value at {self.text(path) or 'the program'}")
        return v  # type: ignore[return-value]

    # ─── Paths ──────────────────────────────────────────────────────────────

    def read_field(self, b: Block, v: Value, name: str, optional: bool, path: str, facts: Facts | None,
                   emit: Emit) -> None:
        """``.name`` on a value, as jq reads it: ``facts`` say which cases a variant can hold."""
        if is_root(v):
            input_expr = v.fields.get(name)  # type: ignore[union-attr]
            if input_expr is None:
                raise self.gap(f".{name} is not an input")
            emit(b, input_expr)
            return
        e = self.open(v)  # type: ignore[arg-type]
        t = e.type
        if t.type == "Null":
            emit(b, self.null(path))
            return
        if nullable_payload(t) is not None:
            inner = facts.payload if facts is not None and facts.kind == "present" else None
            self.match(b, e, {
                "none": lambda b2, _p: emit(b2, self.null(path)),
                "some": lambda b2, p: self.read_field(b2, p, name, optional, path, inner, emit),
            }, path)
            return
        if t.type == "Struct":
            emit(b, self.field(e, name) if name in fields_of(t) else self.null(path))
            return
        if t.type == "Dict":
            if unwrap(dict_key(t)).type != "String":
                if not optional:
                    self.raise_(b, f'Cannot index object with "{name}"', path)
                return
            self.dict_get(b, e, self.str_(name, path), path, emit)
            return
        if t.type == "Variant":
            cases = cases_of(t, facts)
            if name == "type":
                if len(cases) == 1:
                    emit(b, self.str_(cases[0], path))
                    return
                def named(case: str) -> Callable[[Block, A], None]:
                    return lambda b2, _p: emit(b2, self.str_(case, path))
                self.match(b, e, {c: named(c) for c in cases}, path)
                return
            if name == "value":
                self.match(b, e, {c: (lambda b2, payload: emit(b2, payload)) for c in cases}, path)
                return
            if optional:
                emit(b, self.null(path))
                return
            self.raise_(b, f'Cannot index object with "{name}"', path)
            return
        if not optional:
            self.raise_(b, f'Cannot index {jq_kind(t)} with "{name}"', path)

    def dict_get(self, b: Block, d: A, key: A, path: str, emit: Emit) -> None:
        """A dict's value at a key: ``null`` when it lacks the key."""
        o = self.open(d)
        t = o.type
        k_type = dict_key(t)
        v_type = dict_value(t)
        found = self.b("DictTryGet", [k_type, v_type], [o, self.widen_to(b, key, k_type, path)], OptionType(v_type), path)
        # A value that can be null already is the lookup's value, or null.
        if nullable_payload(OptionType(v_type)) is None:
            self.match(b, found, {
                "none": lambda b2, _p: emit(b2, self.null(path)),
                "some": lambda b2, value: emit(b2, value),
            }, path)
            return
        emit(b, found)

    def gen_index(self, n: JqNode, path: str, b: Block, x: Value, env: Env, emit: Emit) -> None:
        index = n.value["index"]
        optional = n.value["optional"]
        target = n.value["target"]
        target_path = child_path(path, "index.target")
        key_path = child_path(path, "index.index")
        literal = self.literal_of(index)
        if literal is not None and literal[0].type == "String":
            name = literal[1]
            if target.type == "identity" and is_root(x):
                self.read_field(b, x, name, optional, path, None, emit)
                return

            # A literal string reads a field, unless the value is a dict.
            def read(b2: Block, tv: Value) -> None:
                if not is_root(tv) and self.open(tv).type.type == "Dict":  # type: ignore[arg-type]
                    self.dict_get(b2, tv, self.str_(name, path), path, emit)  # type: ignore[arg-type]
                    return
                if is_root(tv):
                    facts = None
                else:
                    r = self.result(target_path, self.env_for(target_path, env, x))
                    facts = self.facts_in(None if r is None else r.shape, tv.type)  # type: ignore[union-attr]
                self.read_field(b2, tv, name, optional, path, facts, emit)
            self.gen(target, target_path, b, x, env, read)
            return
        # jq takes each key, then each value it indexes: `(a, b)[0, 1]` is a[0], b[0], a[1], b[1].
        self.collected(index, key_path, b, x, env, lambda b2, k: self.gen(
            target, target_path, b2, x, env, lambda b3, tv: self.index_of(b3, self.expr(tv, path), k, optional, path,
                                                                          emit)))

    def index_of(self, b: Block, v: A, k: A, optional: bool, path: str, emit: Emit) -> None:
        """``.[k]`` on a value."""
        e = self.open(v)
        t = e.type
        if t.type == "Null":
            emit(b, self.null(path))
            return
        if nullable_payload(t) is not None:
            self.match(b, e, {
                "none": lambda b2, _p: emit(b2, self.null(path)),
                "some": lambda b2, p: self.index_of(b2, p, k, optional, path, emit),
            }, path)
            return
        if t.type == "Dict":
            self.dict_get(b, e, k, path, emit)
            return
        array = self.as_array(b, e, path)
        if array is None or k.type.type != "Integer":
            if not optional:
                self.raise_(b, f"Cannot index {jq_kind(t)} with {jq_kind(k.type)}", path)
            return
        element = array.type.value
        bound = self.bind(b, array, "array")
        i = self.declare(b, k, "index")
        self.if_else(b, self.lt(i, self.int_(0), path),
                     lambda b2: self.assign(b2, i, self.add(i, self.size(bound, path), path)), None, path)
        found = self.b("ArrayTryGet", [element], [bound, i], OptionType(element), path)
        if nullable_payload(OptionType(element)) is None:
            self.match(b, found, {
                "none": lambda b2, _p: emit(b2, self.null(path)),
                "some": lambda b2, value: emit(b2, value),
            }, path)
            return
        emit(b, found)

    def gen_slice(self, n: JqNode, path: str, b: Block, x: Value, env: Env, emit: Emit) -> None:
        v = n.value
        optional = v["optional"]

        def bound(b2: Block, option: Any, step: str, then: Callable[[Block, A | None], None]) -> None:
            if option.type == "none":
                then(b2, None)
                return
            self.collected(option.value, child_path(path, step), b2, x, env, then)

        bound(b, v["from"], "slice.from.some", lambda b2, a: bound(b2, v["to"], "slice.to.some", lambda b3, c: self.gen(
            v["target"], child_path(path, "slice.target"), b3, x, env,
            lambda b4, tv: self.slice_of(b4, self.expr(tv, path), a, c, optional, path, emit))))

    def slice_of(self, b: Block, v: A, lo: A | None, hi: A | None, optional: bool, path: str, emit: Emit) -> None:
        """``.[a:b]`` on a value: half-open, negative bounds counted from the end, clamped."""
        e = self.open(v)
        t = e.type
        if t.type == "Null":
            emit(b, self.null(path))
            return
        if nullable_payload(t) is not None:
            self.match(b, e, {
                "none": lambda b2, _p: emit(b2, self.null(path)),
                "some": lambda b2, p: self.slice_of(b2, p, lo, hi, optional, path, emit),
            }, path)
            return
        if t.type in ("Vector", "String", "Array", "Set"):
            s = self.as_array(b, e, path) if t.type == "Set" else self.bind(b, e, "sliced")
            assert s is not None
            st = s.type
            if st.type == "String":
                length_expr = self.b("StringLength", [], [s], IntegerType, path)
            elif st.type == "Vector":
                length_expr = self.b("VectorLength", [st.value], [s], IntegerType, path)
            else:
                length_expr = self.size(s, path)
            length = self.declare(b, length_expr, "length", False)
            start = self.bound_of(b, lo, self.int_(0), length, path)
            end = self.bound_of(b, hi, length, length, path)
            self.if_else(b, self.lt(end, start, path), lambda b2: self.assign(b2, end, start), None, path)
            if st.type == "String":
                emit(b, self.b("StringSubstring", [], [s, start, end], StringType, path))
            elif st.type == "Vector":
                emit(b, self.b("VectorSlice", [st.value], [s, start, end], st, path))
            else:
                emit(b, self.b("ArraySlice", [st.value], [s, start, end], st, path))
            return
        if not optional:
            self.raise_(b, f"Cannot index {jq_kind(t)} with object", path)

    def bound_of(self, b: Block, bound: A | None, fallback: A, length: A, path: str) -> A:
        """A slice bound as an index: absent or null for its default, negative from the end, clamped."""
        i = self.declare(b, fallback, "bound", True, IntegerType)
        if bound is not None:
            t = bound.type
            if t.type == "Integer":
                self.assign(b, i, bound)
            elif nullable_payload(t) is not None:
                self.match(b, bound, {"some": lambda b2, p: self.assign(b2, i, self.widen_to(b2, p, IntegerType, path))},
                           path)
            elif t.type != "Null":
                raise self.gap(f"a slice bound of {print_type(t)}")
        self.if_else(b, self.lt(i, self.int_(0), path), lambda b2: self.assign(b2, i, self.add(i, length, path)), None, path)
        self.if_else(b, self.lt(i, self.int_(0), path), lambda b2: self.assign(b2, i, self.int_(0)), None, path)
        self.if_else(b, self.lt(length, i, path), lambda b2: self.assign(b2, i, length), None, path)
        return i

    def iterate(self, b: Block, v: A, optional: bool, path: str, emit: Emit) -> None:
        """``.[]`` on a value: an array's elements, a set's, a dict's values in key order, a struct's fields in order."""
        e = self.open(v)
        t = e.type
        if nullable_payload(t) is not None:
            def on_none(b2: Block, _p: A) -> None:
                if not optional:
                    self.raise_(b2, "Cannot iterate over null", path)
            self.match(b, e, {"none": on_none, "some": lambda b2, p: self.iterate(b2, p, optional, path, emit)}, path)
            return
        if t.type in ("Array", "Set", "Dict", "Vector", "Matrix"):
            self.for_each(b, e, lambda b2, value, _k, _l: emit(b2, value), path)
            return
        if t.type == "Struct":
            s = self.bind(b, e, "struct")
            for name in fields_of(t):
                emit(b, self.field(s, name))
            return
        if not optional:
            self.raise_(b, f"Cannot iterate over {jq_kind(t)}", path)

    def child_kinds(self, t0: EastType) -> list[EastType]:
        """The kinds of value ``..`` finds directly inside a value of a type, as the checker walks them."""
        t = unwrap(t0)
        payload = nullable_payload(t)
        if payload is not None:
            return self.child_kinds(payload)
        if t.type in ("Array", "Set", "Vector"):
            return [t.value]
        if t.type == "Dict":
            return [dict_value(t)]
        if t.type == "Struct":
            return list(fields_of(t).values())
        if t.type == "Variant":
            return [StringType, *cases_of_type(t).values()]
        return []

    def children(self, b: Block, v: A, path: str, emit: Emit) -> None:
        """Gives each value ``..`` finds directly inside a value to ``emit``, in order."""
        e = self.open(v)
        t = e.type
        if nullable_payload(t) is not None:
            self.match(b, e, {"some": lambda b2, p: self.children(b2, p, path, emit)}, path)
            return
        if t.type in ("Array", "Set", "Dict", "Vector"):
            self.for_each(b, e, lambda b2, value, _k, _l: emit(b2, value), path)
            return
        if t.type == "Struct":
            s = self.bind(b, e, "struct")
            for name in fields_of(t):
                emit(b, self.field(s, name))
            return
        if t.type == "Variant":
            # A variant is jq's {type, value}: the case's name, then its payload.
            def handler(c: str) -> Callable[[Block, A], None]:
                def run(b2: Block, payload: A) -> None:
                    emit(b2, self.str_(c, path))
                    emit(b2, payload)
                return run
            self.match(b, e, {c: handler(c) for c in cases_of_type(t)}, path)

    def descend(self, b: Block, v: A, path: str, emit: Emit) -> None:
        """``..``: a value and every value inside it, in pre-order; a recursive type by an explicit stack."""
        kinds: list[EastType] = []
        recursive = [False]

        def visit(t: EastType) -> None:
            # A recursive type equals its node, so a value typed as the node
            # meets the recursive type as a kind already seen: it recurses all the same.
            if t.type == "Recursive":
                recursive[0] = True
            if any(type_equal(k, t) for k in kinds):
                return
            kinds.append(t)
            for k in self.child_kinds(t):
                visit(k)

        visit(v.type)
        if not recursive[0]:
            def walk(b2: Block, value: A) -> None:
                emit(b2, value)
                self.children(b2, value, path, walk)
            walk(b, v)
            return

        def each(b2: Block, value: A, push: Emit) -> None:
            emit(b2, value)
            self.children(b2, value, path, push)
        self.walk_stack(b, v, kinds, path, each)

    def walk_stack(self, b: Block, start: A, kinds: list[EastType], path: str,
                   visit: Callable[[Block, A, Emit], None]) -> None:
        """A depth-first walk with an explicit stack of values of several kinds."""
        cases = {f"k{i:03d}": k for i, k in enumerate(kinds)}
        item_type = VariantType(list(cases.items()))

        def case_of(t: EastType) -> str:
            i = next((j for j, k in enumerate(kinds) if type_equal(k, t)), -1)
            if i < 0:
                raise self.gap(f"{print_type(t)} in a walk of {', '.join(print_type(k) for k in kinds)}")
            return f"k{i:03d}"

        stack = self.declare(b, self.empty_array(item_type), "stack")
        self.push(b, stack, self.variant_of(item_type, case_of(start.type), start), path)

        def loop(b2: Block, _label: Label) -> None:
            item = self.declare(b2, self.b("ArrayPopLast", [item_type], [stack], item_type, path), "item", False)

            def handler(b3: Block, value: A) -> None:
                # The values found are pushed last first, so the first is walked next.
                found = self.declare(b3, self.empty_array(item_type), "found")
                visit(b3, value, lambda b4, child: self.push(
                    b4, found, self.variant_of(item_type, case_of(child.type), child), path))
                self.for_each(b3, self.b("ArrayReverse", [item_type], [found], ArrayType(item_type), path),
                              lambda b4, child, _k, _l: self.push(b4, stack, child, path), path)
            self.match(b2, item, dict.fromkeys(cases, handler), path)
        self.while_loop(b, self.lt(self.int_(0), self.size(stack, path), path), loop, path)

    # ─── Construction ───────────────────────────────────────────────────────

    def gen_object(self, n: JqNode, path: str, b: Block, x: Value, env: Env, emit: Emit) -> None:
        typ = self.type_at(path, env)
        t = unwrap(typ)
        entries = n.value
        if t.type == "Struct":
            input_facts = None if is_root(x) else self.facts_in(self.checked.input_at(path, env.instance), x.type)  # type: ignore[union-attr]

            # Each combination of the values' outputs, the first entry's slowest.
            def step(b2: Block, i: int, values: dict[str, A]) -> None:
                if i == len(entries):
                    fields = {name: self.widen_to(b2, values[name], ft, path) for name, ft in fields_of(t).items()}
                    emit(b2, self.struct(typ, fields))
                    return
                entry = entries[i]
                name = entry["key"].value

                def nxt(b3: Block, v: A) -> None:
                    step(b3, i + 1, {**values, name: self.bind(b3, v, "field")})
                if entry["value"].type == "some":
                    self.gen(entry["value"].value, child_path(path, f"object[{i}].value.some"), b2, x, env, nxt)
                elif entry["key"].type == "variable":
                    if name == "__loc__":
                        nxt(b2, self.location(path))
                        return
                    bound = env.vars.get(name)
                    if bound is None:
                        raise self.gap(f"${name} is not bound")
                    nxt(b2, self.expr(bound, path))
                else:
                    self.read_field(b2, x, name, False, path, input_facts, nxt)
            step(b, 0, {})
            return
        if t.type == "Dict":
            def dict_step(b2: Block, i: int, pairs: list[tuple[A, A]]) -> None:
                if i == len(entries):
                    d = self.declare(b2, self.value({}, t), "object")
                    for k, v in pairs:
                        self.put(b2, d, k, v, path)
                    emit(b2, d)
                    return
                entry = entries[i]
                if entry["key"].type != "computed":
                    raise self.gap("a dict entry without a computed key")
                value = entry["value"]

                def keyed(b3: Block, k: A) -> None:
                    key = self.bind(b3, k, "key")

                    def nxt(b4: Block, v: A) -> None:
                        dict_step(b4, i + 1, [*pairs, (key, self.bind(b4, v, "value"))])
                    # `{"\(f)"}` holds the input's value at the key, `.[key]`.
                    if value.type == "none":
                        self.index_of(b3, self.expr(x, path), key, False, path, nxt)
                    else:
                        self.gen(value.value, child_path(path, f"object[{i}].value.some"), b3, x, env, nxt)
                self.gen(entry["key"].value, child_path(path, f"object[{i}].key.computed"), b2, x, env, keyed)
            dict_step(b, 0, [])
            return
        raise self.gap(f"an object of {print_type(typ)}")

    def gen_string(self, parts: Any, path: str, b: Block, x: Value, env: Env, emit: Emit,
                   text: Callable[[Block, A], A], parts_path: str) -> None:
        """A string with interpolations: each combination of the interpolated values, each written by ``text``."""
        def step(b2: Block, i: int, acc: A) -> None:
            if i == len(parts):
                emit(b2, acc)
                return
            part = parts[i]
            if part.type == "text":
                step(b2, i + 1, self.concat(acc, self.str_(part.value, path), path))
                return
            self.gen(part.value, child_path(parts_path, f"string[{i}].interpolate"), b2, x, env,
                     lambda b3, v: step(b3, i + 1, self.bind(b3, self.concat(acc, text(b3, v), path), "text")))
        step(b, 0, self.str_("", path))

    def concat(self, a: A, b2: A, path: str) -> A:
        """Two strings joined."""
        ca = self.constant(a)
        if ca is not None and ca[0] == "":
            return b2
        cb = self.constant(b2)
        if cb is not None and cb[0] == "":
            return a
        return self.b("StringConcat", [], [a, b2], StringType, path)

    def tostring(self, _b: Block, v: A, path: str) -> A:
        """jq's ``tostring``: a string as it is, ``null`` as ``null``, anything else as its East text."""
        e = self.open(v)
        t = e.type
        if t.type == "String":
            return e
        if t.type == "Null":
            return self.str_("null", path)
        if nullable_payload(t) is not None:
            return self.match_value(e, {
                "none": lambda _b2, _p: self.str_("null", path),
                "some": lambda b2, p: self.tostring(b2, p, path),
            }, StringType, path)
        return self.b("Print", [t], [e], StringType, path)

    # ─── Operators ──────────────────────────────────────────────────────────

    def gen_binary(self, n: JqNode, path: str, b: Block, x: Value, env: Env, emit: Emit) -> None:
        left = n.value["left"]
        op = n.value["op"]
        right = n.value["right"]
        left_path = child_path(path, "binary.left")
        right_path = child_path(path, "binary.right")
        if op in ("and", "or"):
            # The right side runs only when the left does not decide.
            def on_left(b2: Block, a: A) -> None:
                def decided(b3: Block) -> None:
                    emit(b3, self.bool_(op == "or", path))

                def undecided(b3: Block) -> None:
                    self.gen(right, right_path, b3, x, env, lambda b4, rv: emit(b4, self.as_expr(self.truthy(rv, path))))
                truth = self.truthy(a, path)
                if op == "and":
                    self.branch(b2, truth, undecided, decided, path)
                else:
                    self.branch(b2, truth, decided, undecided, path)
            self.gen(left, left_path, b, x, env, on_left)
            return
        # A literal the checker made a Float, for an instance of this node whose
        # other operand is a Float, stays one in every instance; where this
        # instance's result is an Integer, it is its whole number.
        integral = self.result(path, env)
        shared = None if integral is None else unify_shape(integral.shape)
        whole = shared is not None and shared.type == "Integer"

        # jq takes the right side's outputs first, and the left side's for each.
        def on_right(b2: Block, rv: A) -> None:
            def on_left(b3: Block, lv: A) -> None:
                if op in _COMPARISONS:
                    emit(b3, self.compare(b3, op, lv, rv, path))
                else:
                    self.give(b3, self.arith(b3, op, self.integer(lv, path) if whole else lv,
                                             self.integer(rv, path) if whole else rv, path), emit)
            self.collected(left, left_path, b2, x, env, on_left)
        self.collected(right, right_path, b, x, env, on_right)

    def integer(self, e: A, path: str) -> A:
        """A Float constant with a whole value, as an Integer; anything else as it is."""
        if e.type.type != "Float":
            return e
        c = self.constant(e)
        if c is not None and isinstance(c[0], float) and math.isfinite(c[0]) and c[0].is_integer():
            return self.int_(int(c[0]), path)
        return e

    def compare(self, b: Block, op: str, a: A, b2: A, path: str) -> A:
        """A comparison: East's order within a kind, jq's order across kinds."""
        va = self.open(a)
        vb = self.open(b2)
        ta = va.type
        tb = vb.type
        oa = nullable_payload(ta) is not None
        ob = nullable_payload(tb) is not None
        if oa or ob:
            # An option compares as null, or as its payload.
            def side(v: A, is_open: bool, then: Callable[[Block, A], A]) -> A:
                if not is_open:
                    return then(b, v)
                return self.match_value(v, {
                    "none": lambda b3, _p: then(b3, self.null(path)),
                    "some": lambda b3, p: then(b3, p),
                }, BooleanType, path)
            return side(va, oa, lambda _b3, a2: side(vb, ob, lambda b4, bb: self.compare(b4, op, a2, bb, path)))
        ra = _jq_rank(ta)
        rb = _jq_rank(tb)
        if ra != rb or ta.type == "Null":
            return self.bool_(_ORDERINGS[op](-1 if ra < rb else 1 if ra > rb else 0), path)
        lhs = va
        rhs = vb
        if not type_equal(ta, tb):
            common = unify(ta, tb)
            if common is None:
                raise self.gap(f"{print_type(ta)} {op} {print_type(tb)}")
            lhs = self.widen_to(b, va, common, path)
            rhs = self.widen_to(b, vb, common, path)
        cl = self.constant(lhs)
        cr = self.constant(rhs)
        if cl is not None and cr is not None and isinstance(cl[0], (bool, int, float, str)):
            order = _js_order(cl[0], cr[0])
            return self.bool_(_ORDERINGS[op](order), path)
        return self.b(_COMPARISON_BUILTINS[op], [lhs.type], [lhs, rhs], BooleanType, path)

    def arith(self, b: Block, op: str, a: A, b2: A, path: str) -> A:  # noqa: C901
        """An arithmetic operator on two values, as jq defines it for their kinds, or an error expression."""
        va = self.open(a)
        vb = self.open(b2)
        ta = va.type
        tb = vb.type
        if op == "+":
            # `null` is the identity of `+`.
            if ta.type == "Null":
                return vb
            if tb.type == "Null":
                return va
            if nullable_payload(ta) is not None:
                return self.match_auto(va, {"none": lambda _b3, _p: vb,
                                            "some": lambda b3, p: self.arith(b3, op, p, vb, path)}, path)
            if nullable_payload(tb) is not None:
                return self.match_auto(vb, {"none": lambda _b3, _p: va,
                                            "some": lambda b3, p: self.arith(b3, op, va, p, path)}, path)
        elif nullable_payload(ta) is not None or nullable_payload(tb) is not None:
            # An option is null or its value: null raises, and a value is combined.
            if nullable_payload(ta) is not None:
                return self.match_auto(va, {
                    "none": lambda b3, _p: self.arith(b3, op, self.null(path), vb, path),
                    "some": lambda b3, p: self.arith(b3, op, p, vb, path),
                }, path)
            return self.match_auto(vb, {
                "none": lambda b3, _p: self.arith(b3, op, va, self.null(path), path),
                "some": lambda b3, p: self.arith(b3, op, va, p, path),
            }, path)

        def number(t: EastType) -> bool:
            return t.type in ("Integer", "Float")

        if number(ta) and number(tb):
            if op == "/":
                divisor = self.bind(b, self.widen_to(b, vb, FloatType, path), "divisor")
                self.if_else(b, self.b("Equal", [FloatType], [divisor, self.float_(0.0)], BooleanType, path),
                             lambda b3: self.raise_(b3, "Division by zero", path), None, path)
                return self.b("FloatDivide", [], [self.widen_to(b, va, FloatType, path), divisor], FloatType, path)
            if op == "%":
                return self.remainder(b, va, vb, path)
            name = _ARITHMETIC_BUILTINS[op]
            if ta.type == "Integer" and tb.type == "Integer":
                return self.b(f"Integer{name}", [], [va, vb], IntegerType, path)
            return self.b(f"Float{name}", [], [self.widen_to(b, va, FloatType, path), self.widen_to(b, vb, FloatType, path)],
                          FloatType, path)
        if op == "+" and ta.type == "String" and tb.type == "String":
            return self.concat(va, vb, path)
        if op == "+" and ta.type == "Array" and tb.type == "Array":
            element = unify(ta.value, tb.value)
            if element is None:
                raise self.gap(f"{print_type(ta)} + {print_type(tb)}")
            return self.b("ArrayConcat", [element], [self.widen_to(b, va, ArrayType(element), path),
                                                     self.widen_to(b, vb, ArrayType(element), path)],
                          ArrayType(element), path)
        if op == "-" and ta.type == "Array" and tb.type == "Array":
            others = self.bind(b, vb, "others")
            out = self.declare(b, self.empty_array(ta.value), "difference")

            def each(b3: Block, item: A, _k: A | None, _l: Label) -> None:
                found = self.declare(b3, self.bool_(False), "found")

                def inner(b4: Block, other: A, _key: A | None, label: Label) -> None:
                    def hit(b5: Block) -> None:
                        self.assign(b5, found, self.bool_(True))
                        self.brk(b5, label)
                    self.if_else(b4, self.compare(b4, "==", item, other, path), hit, None, path)
                self.for_each(b3, others, inner, path, "other")
                self.if_else(b3, self.not_(found, path), lambda b4: self.push(b4, out, item, path), None, path)
            self.for_each(b, va, each, path)
            return out
        if op in ("+", "*") and ta.type == "Struct" and tb.type == "Struct":
            return self.merge_structs(b, va, vb, op == "*")
        if op == "+" and ta.type == "Dict" and tb.type == "Dict":
            merged = unify(ta, tb)
            if merged is None:
                raise self.gap(f"{print_type(ta)} + {print_type(tb)}")
            out = self.declare(b, self.b("DictCopy", [dict_key(merged), dict_value(merged)],
                                         [self.widen_to(b, va, merged, path)], merged, path), "merged")
            self.for_each(b, self.widen_to(b, vb, merged, path),
                          lambda b3, value, key, _l: self.put(b3, out, key, value, path), path)  # type: ignore[arg-type]
            return out
        if op == "+" and (ta.type == "Dict" or tb.type == "Dict") and (ta.type == "Struct" or tb.type == "Struct"):
            return va if ta.type == "Dict" else vb
        # A string repeated, the count a number on either side.
        if op == "*" and ta.type == "String" and number(tb):
            return self.repeat(b, va, vb, path)
        if op == "*" and number(ta) and tb.type == "String":
            return self.repeat(b, vb, va, path)
        if op == "/" and ta.type == "String" and tb.type == "String":
            return self.b("StringSplit", [], [va, vb], ArrayType(StringType), path)
        return self.failure(f"{jq_kind(ta)} and {jq_kind(tb)} cannot be combined with {op}", path)

    def remainder(self, b: Block, a: A, b2: A, path: str) -> A:
        """jq's ``%``: the remainder of the numbers truncated to 64-bit integers."""
        if a.type.type == "Integer" and b2.type.type == "Integer":
            return self.b("IntegerRemainder", [], [a, b2], IntegerType, path)
        x = self.bind(b, self.widen_to(b, a, FloatType, path), "dividend")
        y = self.bind(b, self.widen_to(b, b2, FloatType, path), "divisor")
        nan = self.b("BooleanOr", [], [self.is_nan(x, path), self.is_nan(y, path)], BooleanType, path)

        def otherwise(b3: Block) -> A:
            r = self.b("IntegerRemainder", [], [self.truncated(b3, x, path), self.truncated(b3, y, path)], IntegerType,
                       path)
            return self.b("IntegerToFloat", [], [r], FloatType, path)
        return self.if_value(nan, lambda _b3: self.float_(math.nan, path), otherwise, FloatType, path)

    def truncated(self, b: Block, f: A, path: str) -> A:
        """A Float truncated to an Integer as jq's ``dtoi`` takes it: clamped to the range."""
        return self.bind(b, self.if_value(
            self.lt(f, self.float_(-(2.0 ** 63)), path), lambda _b2: self.int_(-(2 ** 63)),
            lambda _b2: self.if_value(
                self.b("GreaterEqual", [FloatType], [f, self.float_(2.0 ** 63)], BooleanType, path),
                lambda _b3: self.int_(2 ** 63 - 1),
                lambda b3: self.round("roundTrunc", f, b3, path), IntegerType, path),
            IntegerType, path), "whole")

    def repeat(self, b: Block, s: A, n: A, path: str) -> A:
        """jq's string repetition: ``n`` copies, a Float count truncated; a negative count, or NaN, gives null."""
        option = OptionType(StringType)
        count = self.bind(b, n, "count")
        if count.type.type == "Integer":
            return self.if_value(self.lt(count, self.int_(0), path), lambda _b2: self.none(option),
                                 lambda _b2: self.some(self.b("StringRepeat", [], [s, count], StringType, path), option),
                                 option, path)
        invalid = self.b("BooleanOr", [], [self.lt(count, self.float_(0.0), path), self.is_nan(count, path)], BooleanType,
                         path)

        def valid(b2: Block) -> A:
            capped = self.if_value(self.lt(count, self.float_(2.0 ** 31 - 1), path), lambda _b3: count,
                                   lambda _b3: self.float_(2.0 ** 31 - 1), FloatType, path)
            return self.some(self.b("StringRepeat", [], [s, self.round("roundTrunc", capped, b2, path)], StringType, path),
                             option)
        return self.if_value(invalid, lambda _b2: self.none(option), valid, option, path)

    def is_nan(self, f: A, path: str) -> A:
        """Whether a Float is NaN: East's order puts it above +Infinity."""
        return self.lt(self.float_(math.inf), f, path)

    def failure(self, message: str, path: str) -> A:
        """An expression that raises an error: of type Never, so it stands for a value of any type."""
        return A("Error", NeverType, self.loc(path), message=self.str_(message, path))

    def give(self, b: Block, v: A, emit: Emit) -> None:
        """Gives a value to ``emit``, unless it is an error expression, which runs as a statement instead."""
        if self.ended(b):
            return
        if v.type.type == "Never":
            self.stmt(b, v)
            return
        emit(b, v)

    def match_auto(self, v: A, cases: dict[str, Callable[[Block, A], A]], path: str) -> A:
        """A value chosen by the case a variant holds, of the one type the cases' values share."""
        opened = self.open(v)
        built: list[tuple[str, A, Block, A]] = []
        typ: EastType = NeverType
        for name, payload in cases_of_type(opened.type).items():
            var = variable(payload, "value" if name == "some" else "payload")
            blk = Block()
            build = cases.get(name)
            if build is None:
                raise self.gap(f"no value for the case {name}")
            value = build(blk, var)
            built.append((name, var, blk, value))
            if self.ended(blk) or value.type.type == "Never":
                continue
            nxt = unify(typ, value.type)
            if nxt is None:
                raise self.gap(f"{print_type(typ)} and {print_type(value.type)} as one value")
            typ = nxt
        out: dict[str, tuple[A, A]] = {}
        for name, var, blk, value in built:
            # A case that raises: its statements, the error last.
            if self.ended(blk) or value.type.type == "Never":
                statements = blk.statements if self.ended(blk) else [*blk.statements, value]
                out[name] = (var, A("Block", NeverType, UNKNOWN_LOC_ID, statements=statements))
                continue
            w = self.widen_to(blk, value, typ, path)
            out[name] = (var, w if not blk.statements else A("Block", typ, UNKNOWN_LOC_ID,
                                                              statements=[*blk.statements, w]))
        return A("Match", typ, self.loc(path), variant=opened, cases=out)

    def merge_structs(self, b: Block, a: A, b2: A, deep: bool) -> A:
        """``a + b`` on structs: ``b``'s fields win, and new ones follow; ``a * b`` merges struct fields too."""
        left = self.bind(b, self.open(a), "left")
        right = self.bind(b, self.open(b2), "right")
        af = fields_of(left.type)
        bf = fields_of(right.type)
        values: dict[str, A] = {}
        types: dict[str, EastType] = {}
        for name in af:
            values[name] = self.field(left, name)
            types[name] = af[name]
        for name, t in bf.items():
            if deep and name in af and unwrap(af[name]).type == "Struct" and unwrap(t).type == "Struct":
                values[name] = self.merge_structs(b, self.field(left, name), self.field(right, name), True)
            else:
                values[name] = self.field(right, name)
            types[name] = values[name].type
        return self.struct(StructType(list(types.items())), values)

    def gen_alternative(self, n: JqNode, path: str, b: Block, x: Value, env: Env, emit: Emit) -> None:
        # `a // b`: a's outputs that are neither false nor null, its errors
        # suppressed; or else b's. They are kept, then given on after the try.
        left_path = child_path(path, "alternative.left")
        kept = self.declare(b, self.empty_array(self.type_at(path, env)), "kept")
        self.try_catch(b, lambda b2: self.gen(n.value["left"], left_path, b2, x, env, lambda b3, v: self.present(
            b3, v, path, lambda b4, w: self.push(b4, kept, w, path))), lambda _b2, _m: None, path)
        self.if_else(b, self.lt(self.int_(0), self.size(kept, path), path),
                     lambda b2: self.for_each(b2, kept, lambda b3, v, _k, _l: emit(b3, v), path),
                     lambda b2: self.gen(n.value["right"], child_path(path, "alternative.right"), b2, x, env, emit), path)

    def present(self, b: Block, v: A, path: str, emit: Emit) -> None:
        """Gives a value to ``emit`` when it is neither false nor null, out of its option."""
        e = self.open(v)
        t = e.type
        if t.type == "Null":
            return
        if nullable_payload(t) is not None:
            self.match(b, e, {"some": lambda b2, p: self.present(b2, p, path, emit)}, path)
            return
        if t.type == "Boolean":
            c = self.constant(e)
            if c is not None and c[0] is False:
                return
            if c is not None and c[0] is True:
                emit(b, e)
                return
            self.if_else(b, e, lambda b2: emit(b2, e), None, path)
            return
        emit(b, e)

    # ─── Control ────────────────────────────────────────────────────────────

    def gen_if(self, n: JqNode, path: str, b: Block, x: Value, env: Env, emit: Emit, index: int) -> None:
        branches = n.value["branches"]
        otherwise = n.value["otherwise"]
        if index == len(branches):
            if otherwise.type == "some":
                self.gen(otherwise.value, child_path(path, "if.otherwise.some"), b, x, env, emit)
            else:
                emit(b, self.expr(x, path))
            return
        branch = branches[index]
        condition_path = child_path(path, f"if.branches[{index}].condition")

        def with_value(b2: Block, value: Value) -> None:
            def on_condition(b3: Block, c: A) -> None:
                self.branch(b3, self.truthy(c, path),
                            lambda b4: self.gen(branch["then"], child_path(path, f"if.branches[{index}].then"), b4, value,
                                                env, emit),
                            lambda b4: self.gen_if(n, path, b4, value, env, emit, index + 1), path)
            self.gen(branch["condition"], condition_path, b2, value, env, on_condition)
        self.narrowed(b, x, condition_path, env, with_value)

    def narrowed(self, b: Block, x: Value, condition_path: str, env: Env, then: Callable[[Block, Value], None]) -> None:
        """Runs a condition's continuation with its input opened when the condition tests its type."""
        r = self.result(condition_path, self.env_for(condition_path, env, x))
        proves = None if r is None else r.proves
        type_test = proves is not None and any(p.kind == "type" and len(p.path) == 0 for p in proves)
        if not type_test or is_root(x) or nullable_payload(self.open(x).type) is None:  # type: ignore[arg-type]
            then(b, x)
            return
        self.match(b, self.open(x), {  # type: ignore[arg-type]
            "none": lambda b2, _p: then(b2, self.null(condition_path)),
            "some": lambda b2, p: then(b2, p),
        }, condition_path)

    def gen_try(self, n: JqNode, path: str, b: Block, x: Value, env: Env, emit: Emit) -> None:
        # The body's outputs are kept, then given on after the try, so an error
        # their consumer raises is not the body's to catch.
        body_path = child_path(path, "try.body")
        body = self.result(body_path, self.env_for(body_path, env, x))
        typ = None if body is None else unify_shape(body.shape)
        kept = None if typ is None or typ.type == "Never" else self.declare(b, self.empty_array(typ), "kept")
        handler = n.value["catch"].value if n.value["catch"].type == "some" else None
        caught = None if handler is None else self.declare(b, self.none(OptionType(StringType)), "caught")

        def run(b2: Block) -> None:
            def each(b3: Block, v: A) -> None:
                # An output after an error the body always raises never comes.
                if self.ended(b3):
                    return
                if kept is None:
                    raise self.gap("a try whose outputs have no one type")
                self.push(b3, kept, v, path)
            self.gen(n.value["body"], body_path, b2, x, env, each)

        def on_error(b2: Block, message: A) -> None:
            if caught is not None:
                self.assign(b2, caught, self.some(message, OptionType(StringType)))
        self.try_catch(b, run, on_error, path)
        if kept is not None:
            self.for_each(b, kept, lambda b2, v, _k, _l: emit(b2, v), path)
        if handler is not None and caught is not None:
            self.match(b, caught, {"some": lambda b2, message: self.gen(handler, child_path(path, "try.catch.some"), b2,
                                                                        message, env, emit)}, path)

    def gen_fold(self, n: JqNode, path: str, b: Block, x: Value, env: Env, emit: Emit) -> None:
        kind = n.type
        v = n.value
        acc_node = self.checked.type_at(f"{path}#acc", env.instance)
        if acc_node is None:
            raise self.gap(f"no accumulator type for {kind}")
        acc_type = acc_node.type
        update_path = child_path(path, f"{kind}.update")

        # For each value `init` gives, a fold over the source's values.
        def on_init(b2: Block, init: A) -> None:
            acc = self.declare(b2, self.widen_to(b2, init, acc_type, path), "acc")

            def on_item(b3: Block, item: A) -> None:
                def on_vars(b4: Block, variables: dict[str, Value]) -> None:
                    inner = replace(env, vars=variables)
                    # The update runs on the state as it was; each output becomes the state, the last staying.
                    state = self.declare(b4, acc, "state", False)

                    def on_next(b5: Block, nxt: A) -> None:
                        value = self.bind(b5, self.widen_to(b5, nxt, acc_type, path), "next")
                        self.assign(b5, acc, value)
                        if kind == "foreach":
                            extract = v["extract"]
                            if extract.type == "none":
                                emit(b5, value)
                            else:
                                self.gen(extract.value, child_path(path, "foreach.extract.some"), b5, value, inner, emit)
                    self.gen(v["update"], update_path, b4, state, inner, on_next)
                self.destructure(b3, v["pattern"], child_path(path, f"{kind}.pattern"), item, env, update_path, on_vars)
            self.collected(v["source"], child_path(path, f"{kind}.source"), b2, x, env, on_item)
            if kind == "reduce":
                emit(b2, acc)
        self.gen(v["init"], child_path(path, f"{kind}.init"), b, x, env, on_init)

    def gen_bind(self, n: JqNode, path: str, b: Block, x: Value, env: Env, emit: Emit) -> None:
        body = n.value["body"]
        patterns = n.value["patterns"]
        source = n.value["source"]
        body_path = child_path(path, "bind.body")

        def on_source(b2: Block, s: A) -> None:
            if len(patterns) == 1:
                self.destructure(b2, patterns[0], child_path(path, "bind.patterns[0]"), s, env, body_path,
                                 lambda b3, variables: self.gen(body, body_path, b3, x, replace(env, vars=variables),
                                                                emit))
                return
            # `?//`: the first pattern that binds and whose body raises no error;
            # the body's outputs are kept, then given on. A variable only another
            # pattern binds is null, as jq binds it.
            typ = self.type_at(body_path, env)
            kept = self.declare(b2, self.empty_array(typ), "kept")
            names = list(dict.fromkeys(name for p in patterns for name in _pattern_names(p)))
            scope = self.checked.scope_at(body_path, env.instance)

            def attempt(b3: Block, i: int) -> None:
                def run(b4: Block) -> None:
                    def on_vars(b5: Block, variables: dict[str, Value]) -> None:
                        own = set(_pattern_names(patterns[i]))
                        everything = dict(variables)
                        for name in names:
                            if name in own:
                                continue
                            checked = None if scope is None else scope.vars.get(name)
                            null_type = None if checked is None else unify_shape(checked.shape)
                            everything[name] = self.bind(b5, self.null(path) if null_type is None
                                                         else self.widen_to(b5, self.null(path), null_type, path), name)
                        self.gen(body, body_path, b5, x, replace(env, vars=everything),
                                 lambda b6, v: self.push(b6, kept, v, path))
                    self.destructure(b4, patterns[i], child_path(path, f"bind.patterns[{i}]"), s, env, body_path,
                                     on_vars)
                if i == len(patterns) - 1:
                    run(b3)
                    return

                def retry(b4: Block, _message: A) -> None:
                    self.stmt(b4, self.b("ArrayClear", [typ], [kept], NullType, path))
                    attempt(b4, i + 1)
                self.try_catch(b3, run, retry, path)
            attempt(b2, 0)
            self.for_each(b2, kept, lambda b3, v, _k, _l: emit(b3, v), path)
        self.gen(source, child_path(path, "bind.source"), b, x, env, on_source)

    def destructure(self, b: Block, pattern: JqPattern, path: str, value: Value, env: Env, body_path: str,
                    then: Callable[[Block, dict[str, Value]], None]) -> None:
        """Binds a pattern's variables to the parts of a value, each as the type the checker gave it."""
        scope = self.checked.scope_at(body_path, env.instance)

        def bind(b2: Block, name: str, v: Value) -> Value:
            if is_root(v):
                return v
            checked = None if scope is None else scope.vars.get(name)
            t = None if checked is None else unify_shape(checked.shape)
            return self.bind(b2, v if t is None else self.widen_to(b2, v, t, path), name)  # type: ignore[arg-type]

        def visit(b2: Block, p: JqPattern, v: Value, variables: dict[str, Value],
                  done: Callable[[Block, dict[str, Value]], None]) -> None:
            if p.type == "variable":
                done(b2, {**variables, p.value: bind(b2, p.value, v)})
                return
            if p.type == "array":
                items = p.value
                e = self.expr(v, path)
                opened = self.open(e).type
                if opened.type not in ("Null", "Array", "Vector"):
                    self.raise_(b2, f"Cannot index {jq_kind(opened)} with number", path)
                    return

                def step(b3: Block, i: int, acc: dict[str, Value]) -> None:
                    if i == len(items):
                        done(b3, acc)
                        return
                    self.index_of(b3, e, self.int_(i), False, path, lambda b4, element: visit(
                        b4, items[i], element, acc, lambda b5, nxt: step(b5, i + 1, nxt)))
                step(b2, 0, variables)
                return
            entries = p.value

            def object_step(b3: Block, i: int, acc: dict[str, Value]) -> None:
                if i == len(entries):
                    done(b3, acc)
                    return
                entry = entries[i]

                def on_part(b4: Block, part: A) -> None:
                    if entry["value"].type == "none":
                        object_step(b4, i + 1, {**acc, entry["key"]: bind(b4, entry["key"], part)})
                    else:
                        visit(b4, entry["value"].value, part, acc, lambda b5, nxt: object_step(b5, i + 1, nxt))
                self.read_field(b3, v, entry["key"], False, path, None, on_part)
            object_step(b2, 0, variables)

        visit(b, pattern, value, dict(env.vars), then)

    # ─── Calls ──────────────────────────────────────────────────────────────

    def gen_call(self, n: JqNode, path: str, b: Block, x: Value, env: Env, emit: Emit) -> None:
        args = list(n.value["args"])
        name = n.value["name"]
        binding = env.defs.get(f"{name}/{len(args)}")
        arg_paths = [child_path(path, f"call.args[{i}]") for i in range(len(args))]
        if binding is None:
            self.gen_builtin(name, args, arg_paths, path, b, x, env, emit)
            return
        instance = f"{env.instance}>{path}"
        if binding.kind == "param":
            assert binding.arg is not None and binding.env is not None
            self.gen(binding.arg, binding.path, b, x, replace(binding.env, instance=instance), emit)
            return
        assert binding.node is not None and binding.env_thunk is not None
        definition = binding.node.value
        closure = binding.env_thunk()
        body_path = child_path(binding.path, "def.body")
        params = list(definition["params"])

        # Each combination of the value parameters' outputs, the first slowest.
        def bind_params(b2: Block, i: int, variables: dict[str, Value], defs: dict[str, _Binding],
                        types: list[str]) -> None:
            if i == len(params):
                signature = "|".join([binding.path, "root" if is_root(x) else print_type(x.type), *types])  # type: ignore[union-attr]
                values = [self.expr(variables[p[1:]], path) for p in params if p.startswith("$")]
                recursion = env.recursion.get(signature)
                if recursion is not None:
                    self.call_recursive(b2, recursion, x, values, path, emit)
                    return
                body_env = Env(variables, defs, closure.labels, instance, env.recursion)
                if _calls_itself(definition["body"], f"{definition['name']}/{len(params)}"):
                    self.gen_recursive(b2, definition, body_path, signature, x, values, body_env, path, env, emit)
                else:
                    self.gen(definition["body"], body_path, b2, x, body_env, emit)
                return
            param = params[i]
            arg_path = child_path(path, f"call.args[{i}]")
            if not param.startswith("$"):
                bind_params(b2, i + 1, variables, {**defs, f"{param}/0": _Binding("param", arg_path, arg=args[i], env=env)},
                            types)
                return

            def on_value(b3: Block, v: A) -> None:
                name2 = param[1:]
                bound = self.bind(b3, v, name2)
                next_vars = {**variables, name2: bound}
                next_defs = {**defs, f"{name2}/0": _Binding("param", arg_path, arg=_variable_node(name2),
                                                          env=replace(closure, vars=next_vars))}
                bind_params(b3, i + 1, next_vars, next_defs, [*types, print_type(bound.type)])
            self.collected(args[i], arg_path, b2, x, env, on_value)
        bind_params(b, 0, dict(closure.vars), dict(closure.defs), [])

    def gen_recursive(self, b: Block, definition: Any, body_path: str, signature: str, x: Value, values: list[A],
                      body_env: Env, call_path: str, caller_env: Env, emit: Emit) -> None:
        """A recursive def with value parameters: an East function held in a reference, its body calling it."""
        output = self.type_at(call_path, caller_env)
        input_type = self.expr(x, call_path).type
        params = [p[1:] for p in definition["params"] if p.startswith("$")]
        inputs = [input_type, *(v.type for v in values)]
        fn_type = FunctionType(inputs, ArrayType(output))
        placeholder = self.lambda_(inputs, ArrayType(output), [], lambda _b2, *_a: self.empty_array(output), call_path)
        cell = self.declare(b, A("NewRef", RefType(fn_type), UNKNOWN_LOC_ID, value=placeholder), definition["name"], False)
        recursion = {**body_env.recursion, signature: cell}

        def fn_body(bf: Block, this_input: A, *fn_args: A) -> A:
            variables = dict(body_env.vars)
            for i, p in enumerate(params):
                variables[p] = fn_args[i]
            out = self.declare(bf, self.empty_array(output), "outputs")
            # A function body cannot break to a label outside it.
            self.gen(definition["body"], body_path, bf, this_input,
                     replace(body_env, vars=variables, labels={}, recursion=recursion),
                     lambda bg, v: self.push(bg, out, v, call_path))
            return out
        fn = self.lambda_(inputs, ArrayType(output), ["input", *params], fn_body, call_path)
        self.stmt(b, self.b("RefUpdate", [fn_type], [cell, fn], NullType, call_path))
        self.call_recursive(b, cell, x, values, call_path, emit)

    def call_recursive(self, b: Block, cell: A, x: Value, values: list[A], path: str, emit: Emit) -> None:
        """A call of a recursive def through its reference: its stream, in order."""
        fn_type = cell.type.value
        fn = self.b("RefGet", [fn_type], [cell], fn_type, path)
        results = self.bind(b, self.call_fn(fn, [self.expr(x, path), *values], path), "outputs")
        self.for_each(b, results, lambda b2, v, _k, _l: emit(b2, v), path)

    def gen_builtin(self, name: str, args: list[JqNode], arg_paths: list[str], path: str, b: Block, x: Value, env: Env,
                    emit: Emit) -> None:
        """A builtin, by its rule."""
        from east.query.jq.translate_builtins import BUILTIN_RULES

        rule = BUILTIN_RULES.get(name)
        if rule is None:
            raise self.gap(f"no translation for the builtin {name}/{len(args)}")
        # Checked in a lenient place with its input's options opened: the builtin
        # is given the value, and null, or where it cannot take null, jq's error for it.
        opened = None if is_root(x) else self.checked.opened(path, env.instance)
        if opened is not None:
            o = self.open(x)  # type: ignore[arg-type]
            if nullable_payload(o.type) is not None:
                def on_none(b2: Block, _p: A) -> None:
                    if opened:
                        self.raise_(b2, f"null cannot be used with {name}", path)
                    else:
                        rule(self, CallSite(name, path, args, arg_paths, b2, self.null(path), env, emit))
                self.match(b, o, {
                    "none": on_none,
                    "some": lambda b2, p: rule(self, CallSite(name, path, args, arg_paths, b2, p, env, emit)),
                }, path)
                return
        rule(self, CallSite(name, path, args, arg_paths, b, x, env, emit))

    # ─── Assignment ─────────────────────────────────────────────────────────

    def gen_update(self, n: JqNode, path: str, b: Block, x: Value, env: Env, emit: Emit) -> None:
        op = n.value["op"]
        target = n.value["path"]
        value = n.value["value"]
        target_path = child_path(path, "update.path")
        value_path = child_path(path, "update.value")
        input_expr = self.expr(x, path)
        if op == "|=":
            # Each position's new value is the update's first output on the old one; none deletes it.
            emit(b, self.whole(self.modify(b, input_expr, target, target_path, env,
                                           lambda b2, old: self.first_of(value, value_path, b2, old, env)), path))
            return

        # `=` and the arithmetic updates take their value on `.`, once for each of its outputs.
        def on_value(b2: Block, v: A) -> None:
            bound = self.bind(b2, v, "update")

            def f(b3: Block, old: A) -> Update | None:
                if op == "=":
                    return Update(bound, False)
                operator = op[:-1]
                if operator == "//":
                    # The old value where it is neither false nor null, else the update.
                    old_type = self.open(old).type
                    payload = nullable_payload(old_type)
                    kept_type = old_type if payload is None else payload
                    unified = unify(kept_type, bound.type)
                    typ = bound.type if kept_type.type == "Null" else (bound.type if unified is None else unified)
                    cell = self.declare(b3, self.widen_to(b3, bound, typ, path), "value")
                    self.present(b3, old, path, lambda b4, w: self.assign(b4, cell, self.widen_to(b4, w, typ, path)))
                    return Update(cell, False)
                return Update(self.arith(b3, operator, old, bound, path), False)
            emit(b2, self.whole(self.modify(b2, input_expr, target, target_path, env, f), path))
        self.collected(value, value_path, b, x, env, on_value)

    def whole(self, update: Update | None, path: str) -> A:
        """What an update gives: the value, ``null`` where it deleted ``.`` itself."""
        return self.null(path) if update is None else update.value

    def update_type(self, update: Update) -> EastType:
        """The type of an update's new value: an optional one's payload."""
        t = update.value.type
        return cases_of_type(t)["some"] if update.optional else t

    def first_of(self, n: JqNode, path: str, b: Block, x: A, env: Env) -> Update | None:
        """The first output of a filter: exactly it when there is always one, else an option."""
        e = self.env_for(path, env, x)
        r = self.result(path, e)
        typ = None if r is None else unify_shape(r.shape)
        if r is None or typ is None or typ.type == "Never":
            return None
        if r.mult.lo == 1 and r.mult.hi == 1:
            return Update(self.one(n, path, b, x, env, typ), False)
        option = OptionType(typ)
        found = self.declare(b, self.none(option), "first")

        def run(b2: Block, label: Label) -> None:
            def each(b3: Block, v: A) -> None:
                self.assign(b3, found, self.some(self.widen_to(b3, v, typ, path), option))
                self.brk(b3, label)
            self.gen(n, path, b2, x, env, each)
        self.once(b, run, path)
        return Update(found, True)

    def modify(self, b: Block, v: A, target: JqNode, path: str, env: Env, f: UpdateFn) -> Update | None:  # noqa: C901
        """A value with the positions a path names updated: ``f`` gives each position's new value, or none."""
        def at(step: str) -> str:
            return child_path(path, step)

        def present(value: A) -> Update:
            return Update(value, False)

        kind = target.type
        tv = target.value
        if kind == "identity":
            return f(b, v)
        if kind == "pipe":
            return self.modify(b, v, tv["left"], at("pipe.left"), env,
                               lambda b2, inner: self.modify(b2, inner, tv["right"], at("pipe.right"), env, f))
        if kind == "field":
            return self.modify(b, v, tv["target"], at("field.target"), env, lambda b2, inner: present(
                self.set_field(b2, inner, tv["name"], tv["optional"], path, env, f)))
        if kind == "index":
            index = tv["index"]
            optional = tv["optional"]
            literal = self.literal_of(index)
            key_path = at("index.index")
            # The key is taken on the index's own input, as jq takes it.
            key = None if literal is not None and literal[0].type == "String" \
                else self.one(index, key_path, b, v, env, self.type_at(key_path, self.env_for(key_path, env, v)))

            def on_target(b2: Block, inner: A) -> Update:
                if key is not None:
                    return present(self.set_index(b2, inner, key, optional, path, f))
                name = literal[1]  # type: ignore[index]
                if self.open(inner).type.type == "Dict":
                    return present(self.set_index(b2, inner, self.str_(name, path), optional, path, f))
                return present(self.set_field(b2, inner, name, optional, path, env, f))
            return self.modify(b, v, tv["target"], at("index.target"), env, on_target)
        if kind == "slice":
            # The bounds are taken on the slice's own input, as jq takes them.
            def bound(option: Any, step: str) -> A | None:
                if option.type == "none":
                    return None
                return self.one(option.value, at(step), b, v, env, self.type_at(at(step), self.env_for(at(step), env, v)))
            lo = bound(tv["from"], "slice.from.some")
            hi = bound(tv["to"], "slice.to.some")
            return self.modify(b, v, tv["target"], at("slice.target"), env, lambda b2, inner: present(
                self.set_slice(b2, inner, lo, hi, tv["optional"], path, f)))
        if kind == "iterate":
            return self.modify(b, v, tv["target"], at("iterate.target"), env, lambda b2, inner: present(
                self.set_each(b2, inner, tv["optional"], path, f)))
        if kind == "descend":
            return self.walk_update(b, v, None, path, f)
        if kind == "call":
            args = tv["args"]
            name = tv["name"]
            if name == "select" and len(args) == 1:
                condition_path = at("call.args[0]")

                def each(b2: Block, value: A, then: Emit) -> None:
                    def with_opened(b3: Block, opened: Value) -> None:
                        self.gen(args[0], condition_path, b3, opened, env, lambda b4, c: self.branch(
                            b4, self.truthy(c, path), lambda b5: then(b5, self.expr(opened, path)), lambda _b5: None,
                            path))
                    self.narrowed(b2, value, condition_path, env, with_opened)
                return self.selected(b, v, path, f, each)
            from east.query.jq.check import UPDATE_SELECTORS

            if name in UPDATE_SELECTORS and len(args) == 0:
                return self.selected(b, v, path, f, lambda b2, value, then: self.gen_builtin(name, [], [], path, b2, value,
                                                                                           env, then))
            if name == "empty" and len(args) == 0:
                return present(v)
            if name == "recurse" and len(args) <= 1:
                return self.walk_update(b, v, args[0] if args else None, path, f)
            raise self.gap(f"assigning to {name}(…)")
        raise self.gap(f"assigning to {self.text(path)}")

    def selected(self, b: Block, v: A, path: str, f: UpdateFn, each: Callable[[Block, A, Emit], None]) -> Update:
        """An update where a filter keeps the value: updated each time it is kept, else as it was."""
        old = self.bind(b, v, "selected")
        t = old.type
        mark = len(b.statements)
        state: dict[str, Any] = {}

        def on_kept(b2: Block, kept: A) -> None:
            nxt = f(b2, kept)
            if not state:
                # The updated value's type, known from the update's, declared before the filter runs.
                given = NeverType if nxt is None else self.update_type(nxt)
                unified = unify(t, given)
                value = t if _same_type(t, given) else (t if unified is None else unified)
                optional = nxt is None or nxt.optional
                typ = OptionType(value) if optional else value
                init = Block()
                start = self.widen_to(init, old, value, path)
                var = variable(typ, "selected", True)
                b.statements[mark:mark] = [*init.statements, A(
                    "Let", NullType, UNKNOWN_LOC_ID, variable=var, value=self.some(start, typ) if optional else start)]
                state.update(variable=var, type=typ, value=value, optional=optional)
            c = state

            def set_(b3: Block, w: A) -> None:
                widened = self.widen_to(b3, w, c["value"], path)
                self.assign(b3, c["variable"], self.some(widened, c["type"]) if c["optional"] else widened)
            if nxt is None:
                if c["optional"]:
                    self.assign(b2, c["variable"], self.none(c["type"]))
                else:
                    self.raise_(b2, _UNDELETABLE, path)
                return
            if not nxt.optional or not c["optional"]:
                set_(b2, self.required(b2, nxt, path))
                return
            self.match(b2, nxt.value, {"some": set_, "none": lambda b3, _p: self.assign(b3, c["variable"],
                                                                                        self.none(c["type"]))}, path)
        each(b, old, on_kept)
        if not state:
            return Update(old, False)
        return Update(state["variable"], state["optional"])

    def required(self, _b: Block, update: Update, path: str) -> A:
        """An update's value where the position cannot be deleted: an error where it has none."""
        if not update.optional:
            return update.value
        payload = self.update_type(update)

        def on_none(b2: Block, _p: A) -> A:
            self.raise_(b2, _UNDELETABLE, path)
            return self.placeholder(payload)
        return self.match_value(update.value, {"none": on_none, "some": lambda _b2, p: p}, payload, path)

    def kept(self, b: Block, update: Update | None, t: EastType, path: str) -> A:
        """A position that cannot be deleted: its new value, or an error raised where there is none."""
        if update is not None:
            return self.required(b, update, path)
        self.raise_(b, _UNDELETABLE, path)
        return self.placeholder(t)

    def rebuilt(self, original: A, types: dict[str, EastType], values: dict[str, A]) -> A:
        """A struct of some fields' values: of the original's type, recursive wrapper and all, when it matches."""
        typ = StructType(list(types.items()))
        t = original.type
        return self.struct(t if t.type == "Recursive" and type_equal(node_of(t), typ) else typ, values)

    def set_field(self, b: Block, v: A, name: str, optional: bool, path: str, env: Env, f: UpdateFn) -> A:
        """A struct with one field replaced, added or deleted; a dict's key; a variant's payload; ``null`` made a struct."""
        e = self.open(v)
        t = e.type
        if t.type == "Variant" and nullable_payload(t) is None and name == "value":
            return self.set_payload(e, path, env, f)
        if nullable_payload(t) is not None:
            # An option: `null` is updated as null is, and a value as it is; the checker gave the two one type.
            return self.match_auto(e, {
                "none": lambda b2, _p: self.set_field(b2, self.null(path), name, optional, path, env, f),
                "some": lambda b2, p: self.set_field(b2, p, name, optional, path, env, f),
            }, path)
        if t.type == "Null":
            nxt = f(b, self.null(path))
            if nxt is None:
                return e
            value = self.required(b, nxt, path)
            return self.struct(StructType([(name, value.type)]), {name: value})
        if t.type == "Struct":
            fields = fields_of(t)
            s = self.bind(b, e, "struct")
            nxt = f(b, self.field(s, name) if name in fields else self.null(path))
            values: dict[str, A] = {}
            types: dict[str, EastType] = {}

            def put(field_name: str, value: A) -> None:
                values[field_name] = value
                types[field_name] = value.type
            for field_name in fields:
                if field_name != name:
                    put(field_name, self.field(s, field_name))
                elif nxt is not None:
                    put(field_name, self.required(b, nxt, path))
            if name not in fields and nxt is not None:
                put(name, self.required(b, nxt, path))
            return self.rebuilt(v, types, values)
        if t.type == "Dict":
            return self.set_index(b, e, self.str_(name, path), optional, path, f)
        if optional:
            return v
        raise self.gap(f".{name} = … on {print_type(t)}")

    def set_payload(self, v: A, path: str, env: Env, f: UpdateFn) -> A:
        """A variant with its payload updated, in each case the checker found it can hold there."""
        t = v.type
        payloads = cases_of_type(t)
        updated = self.checked.updated_cases(path, env.instance, t)
        if updated is None:
            updated = list(payloads)
        built: list[tuple[str, EastType, A, Block, A]] = []
        for name, typ in payloads.items():
            var = variable(typ, "payload")
            blk = Block()
            value = self.kept(blk, f(blk, var), typ, path) if name in updated else var
            built.append((name, typ, var, blk, value))
        # The variant's new type, from its payloads' new types.
        new_type = VariantType([(name, typ if self.ended(blk) else value.type) for name, typ, _v, blk, value in built])
        out: dict[str, tuple[A, A]] = {}
        for name, _typ, var, blk, value in built:
            if self.ended(blk):
                out[name] = (var, A("Block", NeverType, UNKNOWN_LOC_ID, statements=blk.statements))
                continue
            wrapped = self.variant_of(new_type, name, value)
            out[name] = (var, wrapped if not blk.statements else A("Block", new_type, UNKNOWN_LOC_ID,
                                                                    statements=[*blk.statements, wrapped]))
        return A("Match", new_type, self.loc(path), variant=v, cases=out)

    def without(self, b: Block, array: A, i: A, path: str) -> A:
        """An array without the element at an index."""
        kept = self.declare(b, self.empty_array(array.type.value), "array")
        self.for_each(b, array, lambda b2, item, index, _l: self.if_else(
            b2, self.not_(self.eq(index, i, path), path), lambda b3: self.push(b3, kept, item, path), None, path), path)  # type: ignore[arg-type]
        return kept

    def set_index(self, b: Block, v: A, key: A, optional: bool, path: str, f: UpdateFn) -> A:  # noqa: C901
        """An array or dict with one element replaced, or deleted where the update gives none."""
        e = self.open(v)
        t = e.type
        if t.type == "Array":
            # A key that is not an Integer raises, as jq does.
            if key.type.type != "Integer":
                self.raise_(b, f"Cannot update an array at a {jq_kind(key.type)} index", path)
                return v
            element = t.value
            source = self.bind(b, e, "array")
            i = self.declare(b, key, "index")
            self.if_else(b, self.lt(i, self.int_(0), path),
                         lambda b2: self.assign(b2, i, self.add(i, self.size(source, path), path)), None, path)
            nxt = f(b, self.b("ArrayGet", [element], [source, i], element, path))
            if nxt is None:
                return self.without(b, source, i, path)
            unified = unify(element, self.update_type(nxt))
            elem = element if unified is None else unified
            out = self.declare(b, self.b("ArrayCopy", [element], [source], t, path) if type_equal(elem, element)
                               else self.widen_to(b, source, ArrayType(elem), path), "array")

            def set_(b2: Block, w: A) -> None:
                self.stmt(b2, self.b("ArrayUpdate", [elem], [out, i, self.widen_to(b2, w, elem, path)], NullType, path))
            if not nxt.optional:
                set_(b, nxt.value)
                return out
            result = self.declare(b, out, "array")
            self.match(b, nxt.value, {"some": set_, "none": lambda b2, _p: self.assign(
                b2, result, self.without(b2, out, i, path))}, path)
            return result
        if t.type in ("Dict", "Null") or (t.type == "Struct" and len(t.value) == 0):
            k_type = dict_key(t) if t.type == "Dict" else key.type
            v0 = dict_value(t) if t.type == "Dict" else NeverType
            k = self.bind(b, self.widen_to(b, key, k_type, path), "key")
            if t.type == "Dict":
                found = self.b("DictTryGet", [k_type, v0], [e, k], OptionType(v0), path)
                if nullable_payload(OptionType(v0)) is None:
                    old = self.match_value(found, {"none": lambda _b2, _p: self.null(path), "some": lambda _b2, p: p}, v0,
                                           path)
                else:
                    old = found
            else:
                old = self.null(path)
            nxt = f(b, old)
            if nxt is None:
                if t.type != "Dict":
                    return self.value({}, DictType(k_type, NeverType))
                out = self.declare(b, self.b("DictCopy", [k_type, v0], [e], t, path), "dict")
                self.stmt(b, self.b("DictTryDelete", [k_type, v0], [out, k], BooleanType, path))
                return out
            next_type = self.update_type(nxt)
            unified = unify(v0, next_type)
            value_type = next_type if v0.type == "Never" else (v0 if unified is None else unified)
            d_type = DictType(k_type, value_type)
            out = self.declare(b, self.b("DictCopy", [k_type, value_type], [self.widen_to(b, e, d_type, path)], d_type, path)
                               if t.type == "Dict" else self.value({}, d_type), "dict")
            if nxt.optional:
                self.match(b, nxt.value, {
                    "some": lambda b2, w: self.put(b2, out, k, w, path),
                    "none": lambda b2, _p: self.stmt(b2, self.b("DictTryDelete", [k_type, value_type], [out, k],
                                                                BooleanType, path)),
                }, path)
            else:
                self.put(b, out, k, nxt.value, path)
            return out
        if optional:
            return v
        raise self.gap(f".[k] = … on {print_type(t)}")

    def set_slice(self, b: Block, v: A, lo: A | None, hi: A | None, optional: bool, path: str, f: UpdateFn) -> A:
        """An array with a slice replaced by the array the update gives, or deleted where it gives none."""
        e = self.open(v)
        t = e.type
        if t.type == "Null":
            nxt = f(b, self.null(path))
            return e if nxt is None else nxt.value
        if t.type == "Array":
            element = t.value
            source = self.bind(b, e, "array")
            length = self.declare(b, self.size(source, path), "length", False)
            start = self.bound_of(b, lo, self.int_(0), length, path)
            end = self.bound_of(b, hi, length, length, path)
            self.if_else(b, self.lt(end, start, path), lambda b2: self.assign(b2, end, start), None, path)
            before = self.bind(b, self.b("ArraySlice", [element], [source, self.int_(0), start], t, path), "before")
            after = self.bind(b, self.b("ArraySlice", [element], [source, end, length], t, path), "after")
            nxt = f(b, self.b("ArraySlice", [element], [source, start, end], t, path))

            def removed() -> A:
                return self.b("ArrayConcat", [element], [before, after], t, path)
            if nxt is None:
                return removed()
            unified = unify(element, self.update_type(nxt).value)
            elem = element if unified is None else unified
            array_type = ArrayType(elem)

            def spliced(b2: Block, middle: A) -> A:
                return self.b("ArrayConcat", [elem], [
                    self.b("ArrayConcat", [elem], [self.widen_to(b2, before, array_type, path),
                                                   self.widen_to(b2, middle, array_type, path)], array_type, path),
                    self.widen_to(b2, after, array_type, path),
                ], array_type, path)
            if not nxt.optional:
                return self.bind(b, spliced(b, nxt.value), "array")
            return self.bind(b, self.match_value(nxt.value, {
                "some": lambda b2, middle: spliced(b2, middle),
                "none": lambda b2, _p: self.widen_to(b2, removed(), array_type, path),
            }, array_type, path), "array")
        if optional:
            return v
        raise self.gap(f".[a:b] = … on {print_type(t)}")

    def set_each(self, b: Block, v: A, optional: bool, path: str, f: UpdateFn) -> A:
        """Every element, dict value or struct field replaced; one with no new value deleted."""
        e = self.open(v)
        t = e.type
        if t.type in ("Array", "Dict"):
            state: dict[str, Any] = {}

            def each(b2: Block, item: A, insert: Callable[[Block, A], None]) -> None:
                nxt = f(b2, item)
                if nxt is None:
                    return
                if nxt.optional:
                    self.match(b2, nxt.value, {"some": insert}, path)
                else:
                    insert(b2, nxt.value)
            out_decl = Block()
            if t.type == "Array":
                def insert_element(b3: Block, w: A) -> None:
                    if "element" not in state:
                        state["element"] = w.type
                    if "out" not in state:
                        state["out"] = self.declare(out_decl, self.empty_array(state["element"]), "array")
                    self.push(b3, state["out"], w, path)
                self.for_each(b, e, lambda b2, item, _k, _l: each(b2, item, insert_element), path)
                # The array is declared before the loop, once the element type is known from the update.
                b.statements[len(b.statements) - 1:len(b.statements) - 1] = out_decl.statements
                # An update that never gives a value deletes every element.
                return state.get("out") or self.value([], ArrayType(NeverType))

            def for_key(b2: Block, item: A, key: A | None, _l: Label) -> None:
                assert key is not None  # a dict's loop gives each value its key
                dict_value_key = key

                def insert_value(b3: Block, w: A) -> None:
                    if "element" not in state:
                        state["element"] = w.type
                    d_type = DictType(dict_key(t), state["element"])
                    if "out" not in state:
                        state["out"] = self.declare(out_decl, self.value({}, d_type), "dict")
                    self.stmt(b3, self.b("DictInsert", [dict_key(t), state["element"]],
                                         [state["out"], dict_value_key, self.widen_to(b3, w, state["element"], path)],
                                         NullType, path))
                each(b2, item, insert_value)
            self.for_each(b, e, for_key, path)
            b.statements[len(b.statements) - 1:len(b.statements) - 1] = out_decl.statements
            return state.get("out") or self.value({}, DictType(dict_key(t), NeverType))
        if t.type == "Struct":
            s = self.bind(b, e, "struct")
            values: dict[str, A] = {}
            types: dict[str, EastType] = {}
            for name in fields_of(t):
                nxt = f(b, self.field(s, name))
                if nxt is None:
                    continue
                values[name] = self.required(b, nxt, path)
                types[name] = values[name].type
            return self.rebuilt(v, types, values)
        if optional:
            return v
        raise self.gap(f".[] |= … on {print_type(t)}")

    def walk_update(self, b: Block, v: A, child: JqNode | None, path: str, f: UpdateFn) -> Update | None:
        """``..``, ``recurse`` or ``recurse(.a[])`` in an update's path: each position visited is updated."""
        from east.query.jq.check import walk_steps

        steps = None if child is None else walk_steps(child)
        if child is not None and steps is None:
            raise self.gap(f"assigning through {self.text(path)}")
        mark = len(b.statements)
        declarations = Block()
        definitions = Block()
        cells: list[tuple[EastType, A, EastType]] = []

        # A position: updated, then the positions inside it.
        def visit(b2: Block, current: A, old: A) -> Update | None:
            k_type = current.type
            nxt = f(b2, current)
            if nxt is None:
                return None

            def inside(b3: Block, w: A) -> A:
                widened = self.widen_to(b3, w, k_type, path)
                if steps is None:
                    return self.walk_inside(b3, widened, old, path, node)
                return self.walk_along(b3, widened, old, steps, path, node)
            if not nxt.optional:
                return Update(self.bind(b2, inside(b2, nxt.value), "walked"), False)
            option = OptionType(k_type)
            value = self.match_value(nxt.value, {"none": lambda _b3, _p: self.none(option),
                                                 "some": lambda b3, w: self.some(inside(b3, w), option)}, option, path)
            return Update(self.bind(b2, value, "walked"), True)

        # A recursive position, walked by its kind's function.
        def call(b2: Block, current: A, old: A) -> Update:
            r_type = current.type
            option = OptionType(r_type)
            entry = next((c for c in cells if type_equal(c[0], r_type)), None)
            if entry is None:
                fn_type = FunctionType([r_type, r_type], option)
                placeholder = self.lambda_([r_type, r_type], option, [], lambda _bf, *_a: self.none(option), path)
                cell = self.declare(declarations, A("NewRef", RefType(fn_type), UNKNOWN_LOC_ID, value=placeholder),
                                    "walk", False)
                entry = (r_type, cell, fn_type)
                cells.append(entry)

                def fn_body(bf: Block, value: A, previous: A) -> A:
                    u = visit(bf, value, previous)
                    if u is None:
                        return self.none(option)
                    return u.value if u.optional else self.some(u.value, option)
                fn = self.lambda_([r_type, r_type], option, ["value", "old"], fn_body, path)
                self.stmt(definitions, self.b("RefUpdate", [fn_type], [cell, fn], NullType, path))
            fn = self.b("RefGet", [entry[2]], [entry[1]], entry[2], path)
            return Update(self.bind(b2, self.call_fn(fn, [current, old], path), "walked"), True)

        def node(b2: Block, current: A, old: A) -> Update | None:
            return call(b2, current, old) if current.type.type == "Recursive" else visit(b2, current, old)

        result = node(b, v, v)
        # The functions, declared before the walk that calls them, and each given its body once every one is declared.
        b.statements[mark:mark] = [*declarations.statements, *definitions.statements]
        return result

    def walk_inside(self, b: Block, w: A, old: A, path: str, node: Callable[[Block, A, A], Update | None]) -> A:
        """A value with the positions ``..`` finds inside it walked, only those ``old`` had."""
        e = self.open(w)
        t = e.type
        if nullable_payload(t) is not None:
            return self.match_value(e, {
                "none": lambda _b2, _p: e,
                "some": lambda _b2, p: self.match_value(self.open(old), {
                    "none": lambda _b3, _q: self.some(p, t),
                    "some": lambda b3, q: self.some(self.walk_inside(b3, p, q, path, node), t),
                }, t, path),
            }, t, path)
        if t.type == "Variant":
            whole_type = w.type
            names = list(cases_of_type(t))

            def case(name: str) -> Callable[[Block, A], A]:
                def build(_b2: Block, p: A) -> A:
                    # The payload is walked where the value had this case before.
                    before = {other: (lambda b3, q: self.kept(b3, node(b3, p, q), p.type, path)) if other == name
                              else (lambda _b3, _q: p) for other in names}
                    return self.variant_of(whole_type, name, self.match_value(self.open(old), before, p.type, path))
                return build
            return self.match_value(e, {name: case(name) for name in names}, whole_type, path)
        return self.walk_elements(b, w, old, path, node)

    def walk_along(self, b: Block, w: A, old: A, fields: list[str], path: str,
                   node: Callable[[Block, A, A], Update | None]) -> A:
        """``recurse(.a.b[])``'s positions inside a value, walked: along the fields, then each element there."""
        if not fields:
            return self.walk_elements(b, w, old, path, node)
        e = self.open(w)
        t = e.type
        if t.type != "Struct":
            raise self.gap(f"recurse(.{'.'.join(fields)}[]) on {print_type(t)}")
        s = self.bind(b, e, "struct")
        o = self.bind(b, self.open(old), "old")
        values: dict[str, A] = {}
        types: dict[str, EastType] = {}
        for name in fields_of(t):
            if name == fields[0]:
                values[name] = self.bind(b, self.walk_along(b, self.field(s, name), self.field(o, name), fields[1:], path,
                                                            node), name)
            else:
                values[name] = self.field(s, name)
            types[name] = values[name].type
        return self.rebuilt(w, types, values)

    def walk_elements(self, b: Block, w: A, old: A, path: str, node: Callable[[Block, A, A], Update | None]) -> A:
        """The positions ``.[]`` names inside a value, each walked by ``node``, only those ``old`` had."""
        e = self.open(w)
        o = self.open(old)
        t = e.type

        # An element the walk updated, or none to drop it.
        def each(b2: Block, update: Update | None, insert: Callable[[Block, A], None]) -> None:
            if update is None:
                return
            if update.optional:
                self.match(b2, update.value, {"some": insert}, path)
            else:
                insert(b2, update.value)

        if nullable_payload(t) is not None:
            return self.match_value(e, {
                "none": lambda _b2, _p: e,
                "some": lambda _b2, p: self.match_value(o, {
                    "none": lambda _b3, _q: self.some(p, t),
                    "some": lambda b3, q: self.some(self.walk_elements(b3, p, q, path, node), t),
                }, t, path),
            }, t, path)
        if t.type == "Array":
            elem = t.value
            out = self.declare(b, self.empty_array(elem), "array")
            count = self.declare(b, self.size(o, path), "count", False)
            self.for_each(b, e, lambda b2, item, index, _l: self.if_else(
                b2, self.lt(index, count, path),  # type: ignore[arg-type]
                lambda b3: each(b3, node(b3, item, self.b("ArrayGet", [elem], [o, index], elem, path)),  # type: ignore[list-item]
                                lambda b4, value: self.push(b4, out, value, path)),
                lambda b3: self.push(b3, out, item, path), path), path)
            return out
        if t.type == "Set":
            k_type = t.value
            out = self.declare(b, self.value([], t), "set")
            self.for_each(b, e, lambda b2, item, _k, _l: self.if_else(
                b2, self.b("SetHas", [k_type], [o, item], BooleanType, path),
                lambda b3: each(b3, node(b3, item, item), lambda b4, value: self.stmt(
                    b4, self.b("SetTryInsert", [k_type], [out, value], BooleanType, path))),
                lambda b3: self.stmt(b3, self.b("SetTryInsert", [k_type], [out, item], BooleanType, path)), path),
                path, "key")
            return out
        if t.type == "Dict":
            k_type = dict_key(t)
            v_type = dict_value(t)
            out = self.declare(b, self.value({}, t), "dict")

            def insert(b2: Block, key: A, value: A) -> None:
                self.stmt(b2, self.b("DictInsert", [k_type, v_type], [out, key, self.widen_to(b2, value, v_type, path)],
                                     NullType, path))
            self.for_each(b, e, lambda b2, item, key, _l: self.match(
                b2, self.b("DictTryGet", [k_type, v_type], [o, key], OptionType(v_type), path), {  # type: ignore[list-item]
                    "none": lambda b3, _p: insert(b3, key, item),  # type: ignore[arg-type]
                    "some": lambda b3, previous: each(b3, node(b3, item, previous),
                                                      lambda b4, value: insert(b4, key, value)),  # type: ignore[arg-type]
                }, path), path)
            return out
        if t.type == "Struct":
            s = self.bind(b, e, "struct")
            before = self.bind(b, o, "old")
            values: dict[str, A] = {}
            types: dict[str, EastType] = {}
            for name, field_type in fields_of(t).items():
                values[name] = self.bind(b, self.kept(b, node(b, self.field(s, name), self.field(before, name)), field_type,
                                                      path), name)
                types[name] = values[name].type
            return self.rebuilt(w, types, values)
        return w


# ─── Module helpers ─────────────────────────────────────────────────────────

_LIBRARY: dict[str, A] = {}


def _library_function(name: str) -> A:
    """A float library function, its locations dropped, as the translation embeds it."""
    fn = _LIBRARY.get(name)
    if fn is None:
        from east.expression.finalize import _rehome_ir
        from east.expression.libs import float as float_lib

        lib = {"roundFloor": float_lib.round_floor, "roundCeil": float_lib.round_ceil,
               "roundHalf": float_lib.round_half, "roundTrunc": float_lib.round_trunc}[name]
        ir = lib.resolve()._east_ir
        fn = external(_rehome_ir(ir, None, None), ir.value["type"])
        _LIBRARY[name] = fn
    return fn


#: The error an update raises where it gives no value for a position that cannot be deleted.
_UNDELETABLE = "an update gave no value for a struct field, which cannot be deleted"


def _variable_node(name: str) -> JqNode:
    from east.query.jq.parse import node

    return node("variable", name)


def jq_kind(t0: EastType) -> str:
    """How jq names a value's kind in its error messages."""
    t = unwrap(t0)
    if nullable_payload(t) is not None:
        return "null"
    kind = t.type
    if kind == "Null":
        return "null"
    if kind == "Boolean":
        return "boolean"
    if kind in ("Integer", "Float"):
        return "number"
    if kind == "String":
        return "string"
    if kind in ("Array", "Set", "Vector", "Matrix"):
        return "array"
    if kind == "DateTime":
        return "datetime"
    if kind == "Blob":
        return "blob"
    if kind in ("Function", "AsyncFunction"):
        return "function"
    return "object"


def _jq_rank(t: EastType) -> int:
    """A kind's place in jq's order across kinds."""
    kind = t.type
    if kind == "Null":
        return 0
    if kind == "Boolean":
        return 1
    if kind in ("Integer", "Float"):
        return 2
    if kind == "String":
        return 3
    if kind in ("Array", "Set", "Vector", "Matrix"):
        return 4
    if kind == "DateTime":
        return 6
    if kind == "Blob":
        return 7
    return 5


def _js_order(a: Any, b: Any) -> int:
    """``a === b ? 0 : a < b ? -1 : 1``, as JavaScript orders two constants of one kind."""
    if isinstance(a, str) and isinstance(b, str):
        from east.query.jq.spans import to_utf16

        a, b = to_utf16(a), to_utf16(b)
    if a == b and not (isinstance(a, float) and math.isnan(a)):
        return 0
    return -1 if a < b else 1


_COMPARISONS = frozenset({"==", "!=", "<", "<=", ">", ">="})
_COMPARISON_BUILTINS = {"==": "Equal", "!=": "NotEqual", "<": "Less", "<=": "LessEqual", ">": "Greater",
                        ">=": "GreaterEqual"}
_ORDERINGS: dict[str, Callable[[int], bool]] = {
    "==": lambda o: o == 0, "!=": lambda o: o != 0, "<": lambda o: o < 0, "<=": lambda o: o <= 0,
    ">": lambda o: o > 0, ">=": lambda o: o >= 0,
}
_ARITHMETIC_BUILTINS = {"+": "Add", "-": "Subtract", "*": "Multiply"}


def _pattern_names(pattern: JqPattern) -> list[str]:
    """The variables a pattern binds."""
    if pattern.type == "variable":
        return [pattern.value]
    if pattern.type == "array":
        return [name for item in pattern.value for name in _pattern_names(item)]
    return [name for entry in pattern.value
            for name in ([entry["key"]] if entry["value"].type == "none" else _pattern_names(entry["value"].value))]


def _calls_itself(n: JqNode, key: str) -> bool:
    """Whether a node calls a def by ``name/arity``, outside any def of the same name inside it."""
    if n.type == "call" and f"{n.value['name']}/{len(n.value['args'])}" == key:
        return True
    if n.type == "def" and f"{n.value['name']}/{len(n.value['params'])}" == key:
        return _calls_itself(n.value["rest"], key)
    return any(child.node is not None and _calls_itself(child.node, key) for child in jq_children(n))


# ─── The translation ────────────────────────────────────────────────────────


@dataclass(frozen=True)
class JqInput:
    """One parameter of a translation: a field of an e3 root the program reads (``name`` it), or the one input."""

    name: str | None
    type: EastType


class JqTranslation:
    """A checked program as East IR: its inputs, its result type, and builders for the IR."""

    def __init__(self, checked: Any, inputs: list[JqInput], result_type: EastType, max_outputs: int | None,
                 tooling: bool) -> None:
        #: The translation's parameters, in order.
        self.inputs = inputs
        #: The result's type: ``T`` for ``one``, ``Option<T>`` for ``maybe``, ``Array<T>`` for ``many``.
        self.result_type = result_type
        self._checked = checked
        self._max_outputs = max_outputs
        self._tooling = tooling

    def _into(self, b: Block, values: list[A]) -> A:
        """The translation written into a block over its inputs: its statements there, its result returned."""
        checked = self._checked
        query = checked.query.value
        element = checked.element_type
        multiplicity = checked.multiplicity
        t = Translator(checked, self._max_outputs, self._tooling)
        root = checked.source.root
        x: Value = RootValue({i.name: values[k] for k, i in enumerate(self.inputs)}) if root else values[0]  # type: ignore[misc]
        env = Env({}, {}, {}, "", {})
        program = query["program"]
        if multiplicity == "one":
            return t.one(program, "", b, x, env, element)
        if multiplicity == "maybe":
            out = t.declare(b, t.none(self.result_type), "result")

            def run(b2: Block, label: Label) -> None:
                def each(b3: Block, v: A) -> None:
                    t.assign(b3, out, t.some(t.widen_to(b3, v, element, ""), self.result_type))
                    t.brk(b3, label)
                t.gen(program, "", b2, x, env, each)
            t.once(b, run, "")
            return out
        out = t.declare(b, t.empty_array(element), "results")
        limit = self._max_outputs
        if limit is None:
            t.gen(program, "", b, x, env, lambda b2, v: t.push(b2, out, v, ""))
            return out

        # One output past the limit is kept, so the caller can tell the result was cut short.
        def limited(b2: Block, label: Label) -> None:
            def each(b3: Block, v: A) -> None:
                t.push(b3, out, v, "")
                t.if_else(b3, t.b("GreaterEqual", [IntegerType], [t.size(out, ""), t.int_(limit + 1)], BooleanType, ""),
                          lambda b4: t.brk(b4, label), None, "")
            t.gen(program, "", b2, x, env, each)
        t.once(b, limited, "")
        return out

    def build_ast(self, *values: A) -> A:
        """The translation over given inputs, as a block of East's AST (TypeScript's ``build``)."""
        b = Block()
        result = self._into(b, list(values))
        ended = _block_type(b).type == "Never"
        statements = b.statements if ended else [*b.statements, result]
        return A("Block", NeverType if ended else self.result_type, UNKNOWN_LOC_ID, statements=statements)

    def build(self, *inputs: Any) -> Any:
        """The translation over given inputs, as an expression of the python build it is spelled in.

        Args:
            inputs: One expression per :attr:`inputs`, in order.

        Returns:
            The result, an expression of :attr:`result_type`.
        """
        from east.expression import _lift
        from east.expression.expr import Expression
        from east.query.jq.lower import lower

        values = []
        for value, declared in zip(inputs, self.inputs, strict=True):
            e = value if isinstance(value, Expression) else _lift(value, hint=declared.type)
            values.append(external(e.ir, e.east_type))
        block = self.build_ast(*values)
        return Expression(lower(block), block.type)

    def function_ir(self) -> Any:
        """The translation as an East function's IR, in the open source map (TypeScript's ``fn().toIR()``)."""
        from east.expression.location import location_id
        from east.query.jq.lower import finalize_ir, lower

        parameters = [variable(i.type) for i in self.inputs]
        b = Block()
        ret = self._into(b, parameters)
        if not is_subtype(ret.type, self.result_type):
            raise TranslationError(f"the result is {print_type(ret.type)}, not {print_type(self.result_type)}")
        statements = b.statements
        # `func`: the returned value is the last statement unless it is already.
        if not statements or statements[-1] is not ret:
            statements.append(ret)
        if len(statements) == 1:
            body_ast = statements[0]
        else:
            body_ast = A("Block", statements[-1].type, location_id(), statements=statements)
        fn_ast = A("Function", FunctionType([i.type for i in self.inputs], self.result_type), location_id(),
                   parameters=parameters, body=body_ast)
        return finalize_ir(lower(fn_ast))

    def fn(self) -> Any:
        """The translation as an East function: compiled, and spliced when called inside another build.

        Returns:
            The function, as ``East.function`` builds one: called on values it
            runs in east-c; its IR is ``_east_ir`` and its source map, whose
            locations are the jq text's, ``_east_source_map``.
        """
        from east.expression.function import _assemble
        from east.expression.location import source_map_scope
        from east.ir.analyze import analyze_ir

        with source_map_scope() as source_map:
            ir = self.function_ir()
        analyze_ir(ir, source_map=source_map)
        param_types = [i.type for i in self.inputs]

        def body(_b: Any, *values: Any) -> Any:
            return self.build(*values)
        return _assemble(body, ir, self.result_type, param_types, [], False, source_map)


def translate_jq(checked: Any, *, max_outputs: int | None = None, tooling: bool = False) -> JqTranslation:
    """Translates a checked jq program to East IR.

    Streams become loops that give each output to what consumes it, and the
    program's result is its sink: the value for ``one``, an ``Option`` for
    ``maybe``, an ``Array`` for ``many``. Checked as an e3 root, each root
    field the program reads is an input of its own, so a lazy dataset is read
    only where the query reads it (``QUERY.md`` §15).

    Args:
        checked: What ``check_jq`` made of the program; it must have no error.
        max_outputs: Stop after this many outputs of a ``many`` query, and one
            more, so a caller can tell the result was cut short.
        tooling: Translate the tooling-only builtins to host platform calls.

    Returns:
        The translation: its inputs, its result type, and builders for the IR.

    Raises:
        TranslationError: When the program does not check, or holds something
            the translator cannot express.
    """
    if checked.query is None or checked.element_type is None or checked.multiplicity is None:
        errors = [d["message"] for d in checked.diagnostics if d["severity"].type == "error"]
        raise TranslationError(f"the program does not check: {' '.join(errors)}")
    element = checked.element_type
    multiplicity = checked.multiplicity
    # The type as it was given: python's canonical copy numbers its wrappers
    # from 0, as every other canonical type does.
    input_type = checked.input_type
    if checked.source.root:
        root_fields = fields_of(unwrap(input_type))
        inputs = [JqInput(name, root_fields[name]) for name in checked.reads]
    else:
        inputs = [JqInput(None, input_type)]
    if multiplicity == "one":
        result_type = element
    elif multiplicity == "maybe":
        result_type = OptionType(element)
    else:
        result_type = ArrayType(element)
    return JqTranslation(checked, inputs, result_type, max_outputs, tooling)


__all__ = [
    "Block", "BuiltinRule", "CallSite", "Emit", "Env", "JqInput", "JqTranslation", "RootValue", "TranslationError",
    "Translator", "Update", "is_root", "jq_kind", "translate_jq",
]
