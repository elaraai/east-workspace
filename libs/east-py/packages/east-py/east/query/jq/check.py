#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The jq checker: types a program against the East type of its input. The twin of ``check.ts``.

It gives the program and its types, which every surface translates, or the
problems that stop it (``libs/east/devdocs/QUERY.md`` §2–§13), with the same
diagnostics as TypeScript's: every offset is in UTF-16 code units of the
program's text. It only checks: it rewrites nothing.
"""

from __future__ import annotations

import math
import re
from collections.abc import Callable
from dataclasses import dataclass, field, replace
from typing import Any

from east.query.jq.catalog import BUILTINS, Builtin, is_jq_builtin
from east.query.jq.literals import JqLiteral, iso_date_time, literal_value
from east.query.jq.messages import MESSAGES, closest, edit, report
from east.query.jq.parse import ParsedJq, node, parse_jq
from east.query.jq.print import json_string
from east.query.jq.shapes import (
    ERROR,
    JQ_TYPE_NAMES,
    MANY,
    MAYBE,
    ONE,
    SOME,
    ZERO,
    CaseOf,
    Facts,
    Member,
    Mult,
    Partial,
    Proof,
    Result,
    Shape,
    TypeShape,
    also,
    can_be_null,
    cases_of,
    cases_of_type,
    descend_types,
    describe_type,
    dict_key,
    dict_value,
    either,
    fields_of,
    members_of,
    narrow_types,
    node_of,
    nullable_payload,
    or_null,
    piped,
    refine,
    type_equal,
    typed,
    unify,
    unify_shape,
    union,
    unwrap,
    wire_multiplicity,
)
from east.query.jq.spans import (
    JqNode,
    JqPattern,
    JqRange,
    JqSpans,
    child_path,
    from_utf16,
    jq_children,
)
from east.serialization.east_printer import print_type
from east.types.types import (
    ArrayType,
    BooleanType,
    DateTimeType,
    DictType,
    EastType,
    FloatType,
    IntegerType,
    NeverType,
    NullType,
    StringType,
    StructType,
    VariantType,
    is_immutable_type,
)
from east.types.values import EastStruct


@dataclass(frozen=True)
class CheckedNode:
    """The type and multiplicity of a node: the outputs it gives for one input."""

    #: The type of each output.
    type: EastType
    #: How many outputs it gives for one input: ``one``, ``maybe`` or ``many``.
    multiplicity: str


@dataclass(frozen=True)
class CheckedStage:
    """The outputs after one stage of the top-level pipeline, and where the stage is."""

    #: The stage's node's path.
    path: str
    #: The stage's first offset in the text, in UTF-16 code units.
    from_: int
    #: The offset after its last.
    to: int
    #: The type of each output after the stage.
    type: EastType
    #: How many outputs the program has given by the end of the stage.
    multiplicity: str


@dataclass(frozen=True)
class CheckedSource:
    """The program's text and the spans of its nodes, for the translator's locations."""

    #: The text, as written.
    text: str
    #: Its UTF-16 view, which the spans index.
    units: str
    #: Where each node is, by path.
    spans: JqSpans
    #: Whether it was checked as an e3 root.
    root: bool


@dataclass(frozen=True)
class Scope:
    """The variables and defs in scope at a node."""

    vars: dict[str, Result]
    defs: list[str]


@dataclass
class CheckJqResult:
    """What :func:`check_jq` makes of a program."""

    #: The program as written (a ``JqType`` value): present exactly when no diagnostic is an error.
    #: The translator and every host read it, with the types beside it.
    program: JqNode | None
    #: The type the program was checked against, as it was given: a root's struct of datasets, with ``root``.
    input_type: EastType
    #: The type of each output, when the program checks.
    element_type: EastType | None
    #: How many outputs the program gives, when it checks: ``one``, ``maybe`` or ``many``.
    multiplicity: str | None
    #: With ``root``, the fields of the root the program reads, in the order it first reads them.
    reads: list[str]
    #: The outputs after each stage of the top-level pipeline.
    stages: list[CheckedStage]
    #: The problems found, lints included, in the order found (``QueryErrorType`` values).
    diagnostics: list[EastStruct]
    #: The program's text and spans, and whether it was checked as an e3 root.
    source: CheckedSource
    _checker: _Checker | None = field(default=None, repr=False)

    def type_at(self, path: str, instance: str = "") -> CheckedNode | None:
        """A node's type and multiplicity, or ``None`` when the node was not checked."""
        if self._checker is None:
            return None
        record = self._checker.records.get(f"{instance}|{path}")
        if record is None:
            return None
        t = unify_shape(record.shape)
        return None if t is None else CheckedNode(t, wire_multiplicity(record.mult))

    def result_at(self, path: str, instance: str | None = None) -> Result | None:
        """What checking a node gave, in an instance; with none, outside every def or the first checked."""
        if self._checker is None:
            return None
        return _any_instance(self._checker.records, path, instance)

    def scope_at(self, path: str, instance: str | None = None) -> Scope | None:
        """The variables and defs in scope at a node, by name (``name/arity`` for a def)."""
        if self._checker is None:
            return None
        env = _any_instance(self._checker.scopes, path, instance)
        return None if env is None else Scope(env.vars, list(env.defs))

    def input_at(self, path: str, instance: str) -> Shape | None:
        """What a node's input was when it was checked, in an instance."""
        if self._checker is None:
            return None
        return self._checker.inputs.get(f"{instance}|{path}")

    def retype(self, path: str, instance: str, input_: EastType) -> str | None:
        """Checks a node again on an input of another type, in a new instance; ``None`` when it does not check."""
        if self._checker is None:
            return None
        return self._checker.retype(path, instance, input_)

    def updated_cases(self, path: str, instance: str, variant: EastType) -> list[str] | None:
        """The cases of a variant whose payload an update's ``.value`` step updates."""
        if self._checker is None:
            return None
        return self._checker.updated_cases.get(f"{instance}|{path}|{print_type(variant)}")

    def opened(self, path: str, instance: str) -> bool | None:
        """For a builtin call checked with its input's options opened, whether it raises for ``null``."""
        if self._checker is None:
            return None
        return self._checker.opened.get(f"{instance}|{path}")


@dataclass(frozen=True)
class _Binding:
    """A ``def``, or a filter parameter, in scope."""

    kind: str
    path: str
    #: The ``def`` node, for a def.
    node: JqNode | None = None
    #: The def's closure, for a def.
    env_thunk: Callable[[], Env] | None = None
    #: The argument, for a parameter.
    arg: JqNode | None = None
    #: The scope it runs in, for a parameter.
    env: Env | None = None


@dataclass(frozen=True)
class Env:
    """What is in scope where a node is checked."""

    #: ``$name`` → what it holds.
    vars: dict[str, Result]
    #: ``name/arity`` → the def or filter parameter it calls.
    defs: dict[str, _Binding]
    #: Labels a ``break`` can name.
    labels: frozenset[str]
    #: Which instance of a def's body this is: ``""`` outside every def.
    instance: str
    #: Inside ``try`` or after ``?``: a type error jq would raise at run time gives no output instead.
    lenient: bool


@dataclass(frozen=True)
class LiteralValue:
    """A literal's value, with its type."""

    type: EastType
    value: Any


@dataclass(frozen=True)
class _Operands:
    """Where the operands of an arithmetic operator are, and the text it covers."""

    left_path: str
    right_path: str
    range: JqRange | None


#: What a node that never runs gives.
_DEAD = Result(typed(NeverType), Mult(1, 0))
#: The input of a node that never runs: no value reaches it.
_NOTHING = Result(typed(NeverType), ONE)

_ARITHMETIC = frozenset({"+", "-", "*", "/", "%"})
_COMPARISON = frozenset({"==", "!=", "<", "<=", ">", ">="})


def _is_number(t: EastType) -> bool:
    return t.type in ("Integer", "Float")


@dataclass(frozen=True)
class _Assigned:
    """A position an update reaches: its new shape, and how many values it has."""

    shape: TypeShape
    mult: Mult


#: `.`, as a path node.
_IDENTITY = node("identity")

#: What an update's path is made of, for the diagnostic that refuses another.
_UPDATE_PATHS = ("an update's path is made of field reads, indexes, slices, .[], select, the type selectors, "
                 "empty, .., recurse and |")

#: The type selectors an update's path may hold, each a ``select`` of a type test.
UPDATE_SELECTORS = frozenset({
    "arrays", "objects", "iterables", "booleans", "numbers", "strings", "nulls", "values", "scalars", "normals",
    "finites",
})


def walk_steps(n: JqNode) -> list[str] | None:
    """The path ``recurse(f)`` walks in an update: field reads, then ``.[]``.

    Returns:
        The names of the fields read before the ``.[]``, or ``None`` for another path.
    """
    if n.type != "iterate":
        return None
    fields: list[str] = []
    target = n.value["target"]
    while target.type == "field" and not target.value["optional"]:
        fields.insert(0, target.value["name"])
        target = target.value["target"]
    return fields if target.type == "identity" else None


def _same_type(a: EastType, b: EastType) -> bool:
    """Whether values of type ``b`` are values of type ``a``: equal, or ``a`` recursive with ``b`` its node."""
    return type_equal(a, b) or (a.type == "Recursive" and type_equal(node_of(a), b))


def _rewrap(original: EastType, rebuilt: EastType) -> EastType:
    """A rebuilt value's type: the original, recursive wrapper and all, when what was rebuilt is its node."""
    return original if original.type == "Recursive" and type_equal(node_of(original), rebuilt) else rebuilt


def _open_options(shape: Shape) -> Shape | None:
    """A shape with each option that may be null opened: ``null``, and its value, as members of their own."""
    if shape.kind == "error":
        return None
    opened = False
    members: list[Member] = []
    for member in members_of(shape):
        payload = nullable_payload(unwrap(member.shape.type))
        if payload is None or (member.shape.facts is not None and member.shape.facts.kind == "present"):
            members.append(member)
            continue
        opened = True
        members.append(Member(typed(NullType), member.case))
        members.append(Member(typed(payload), member.case))
    return union(members) if opened else None


class CallContext:
    """What a builtin's typing rule works with: the call, its input, and ways to check and report."""

    def __init__(self, checker: _Checker, builtin: Builtin, name: str, path: str, input_: Result, env: Env,
                 args: list[JqNode], arg_paths: list[str]) -> None:
        self._checker = checker
        self._env = env
        #: The builtin being typed.
        self.builtin = builtin
        #: The builtin's name as called (``@base64`` for a format).
        self.name = name
        #: The call node's path.
        self.path = path
        #: The call's input.
        self.input = input_
        #: The arguments, as written.
        self.args = args
        #: Each argument's path.
        self.arg_paths = arg_paths
        #: The call's range.
        self.range = checker.range(path)
        #: The program's UTF-16 view.
        self.text = checker.text

    def arg_range(self, i: int) -> JqRange | None:
        """An argument's range."""
        return self._checker.range(self.arg_paths[i])

    def arg(self, i: int, arg_input: Result | None = None) -> Result:
        """Checks argument ``i`` on an input: the call's input when none is given."""
        given = arg_input if arg_input is not None else replace(self.input, access=None, stream=None)
        return self._checker.check(self.args[i], self.arg_paths[i], given, self._env)

    def literal(self, i: int) -> LiteralValue | None:
        """Argument ``i``'s value when it is written as a literal."""
        if i >= len(self.args):
            return None
        a = self.args[i]
        return self._checker.literal(a.value) if a.type == "literal" else None

    def literal_of(self, n: JqNode) -> LiteralValue:
        """A literal node's value."""
        return self._checker.literal(n.value)

    def coerce_arg(self, i: int, wanted: EastType) -> EastType | None:
        """Reads argument ``i``, a literal, as ``wanted`` is written; the type it is read as, or ``None``."""
        if i >= len(self.args):
            return None
        a = self.args[i]
        return self._checker.coerce_literal(a, self.arg_paths[i], unwrap(wanted), self._env) \
            if a.type == "literal" else None

    def coerce_arg_elements(self, i: int, wanted: EastType) -> EastType | None:
        """Reads argument ``i``, an array literal of literals, as an array of ``wanted``; its new type, or ``None``."""
        if i >= len(self.args):
            return None
        return self._checker.coerce_array_literal(self.args[i], self.arg_paths[i], unwrap(wanted), self._env)

    def problems(self) -> int:
        """How many problems have been reported so far: a rule's own tells it whether a coercion said why it failed."""
        return len(self._checker.diagnostics)

    def fail(self, code: str, message: str, *, arg: int | None = None, suggestions: list[str] | None = None,
             fixes: list[EastStruct] | None = None) -> Result:
        """Reports a problem at the call, or at argument ``arg``."""
        r = self._checker.range(self.arg_paths[arg]) if arg is not None else self._checker.range(self.path)
        return self._checker.fail(r, code, message, suggestions=suggestions, fixes=fixes)

    def mismatch(self, code: str, message: str, arg: int | None = None,
                 fixes: list[EastStruct] | None = None) -> Result:
        """Reports a type error jq raises at run time; in a lenient place, no output instead."""
        r = self._checker.range(self.arg_paths[arg]) if arg is not None else self._checker.range(self.path)
        return self._checker.mismatch(self._env, r, code, message, fixes=fixes or [])

    def skip_nulls(self) -> EastStruct | None:
        """The fix that skips null inputs, ``values | ``, when the call can have a pipe put before it."""
        r = self._checker.range(self.path)
        return edit("Skip nulls", r.from_, r.from_, "values | ") if r is not None and _is_pipe_position(self.path) \
            else None

    def warn(self, code: str, message: str, fixes: list[EastStruct] | None = None) -> None:
        """Reports a lint at the call."""
        self._checker.warn(self._checker.range(self.path), code, message, fixes or [])

    def source(self, i: int | None = None) -> str:
        """The call's text, or argument ``i``'s."""
        return self._checker.source(self.path if i is None else self.arg_paths[i])

    def slice(self, start: int, end: int) -> str:
        """The program's text between two UTF-16 offsets."""
        return from_utf16(self.text[start:end])

    def collect(self, result: Result, arg: int | None = None) -> EastType | None:
        """The one type a result's outputs share, or a reported ``ambiguous_output``."""
        r = self._checker.range(self.arg_paths[arg]) if arg is not None else self._checker.range(self.path)
        return self._checker.collect(result, r)

    def refuse_root(self) -> bool:
        """Refuses the call when its input is the whole root."""
        return self._checker.refuse_root(self.input, self.path, self._env)

    def narrow(self, result: Result, proves: tuple[Proof, ...]) -> Result:
        """Adds what a condition proves to a result's shape."""
        return self._checker.narrow(result, proves)

    def narrow_first(self, type_: EastType) -> Result:
        """Reports reading, un-narrowed, a payload field the call needs a value of, with the "Narrow first" fix."""
        assert self.input.partial is not None
        return self._checker.narrow_first(self._env, self._checker.range(self.path), type_, self.input.partial)

    def on_element(self, type_: EastType) -> Result:
        """Reports an array builtin run on each element of a stream, with the fix that collects it."""
        assert self.input.stream is not None
        return self._checker.array_on_element(self._env, self.path, self.name, self.input.stream, type_)

    def range_at(self, at: str) -> JqRange | None:
        """Any node's range, by its path."""
        return self._checker.range(at)

    def result_at(self, at: str) -> Result | None:
        """What checking a node gave, by its path, in this instance."""
        return self._checker.records.get(f"{self._env.instance}|{at}")


class _Checker:
    """Checks one program."""

    def __init__(self, text: str, spans: JqSpans, root: bool, tooling: bool, input_: EastType) -> None:
        #: The program's UTF-16 view.
        self.text = text
        self.spans = spans
        self.root = root
        self.tooling = tooling
        self.input = input_
        self.diagnostics: list[EastStruct] = []
        self.records: dict[str, Result] = {}
        #: The nodes checked, by path.
        self.nodes: dict[str, JqNode] = {}
        #: What is in scope at each node checked, by instance and path.
        self.scopes: dict[str, Env] = {}
        #: Each node's input when it was checked, by instance and path.
        self.inputs: dict[str, Shape] = {}
        self._retypes = 0
        #: The cases each update's `.value` step updates, by instance, path and variant type.
        self.updated_cases: dict[str, list[str]] = {}
        #: The builtin calls checked with their input's options opened: whether each raises for null.
        self.opened: dict[str, bool] = {}
        #: How many type errors a lenient place has let by, to run as errors.
        self._refused = 0
        self.reads: list[str] = []
        #: Defs being instantiated, by instance signature: their output so far, for recursion.
        self._active: dict[str, dict[str, Any]] = {}
        t = unwrap(input_)
        #: The root's field names, with `root`.
        self.root_names: list[str] = list(fields_of(t)) if root and t.type == "Struct" else []

    # ─── Recording and reporting ───────────────────────────────────────────

    def range(self, path: str) -> JqRange | None:
        return self.spans.get(path)

    def record(self, path: str, env: Env, result: Result) -> Result:
        self.records[f"{env.instance}|{path}"] = result
        return result

    def fail(self, span: JqRange | None, code: str, message: str, *, suggestions: list[str] | None = None,
             fixes: list[EastStruct] | None = None) -> Result:
        """Reports a problem and gives the error shape."""
        self.diagnostics.append(report(self.text, code, span, message, suggestions=suggestions, fixes=fixes))
        return Result(ERROR, ONE)

    def mismatch(self, env: Env, span: JqRange | None, code: str, message: str, *,
                 suggestions: list[str] | None = None, fixes: list[EastStruct] | None = None) -> Result:
        """A type error jq raises at run time: reported, or in a lenient place no output."""
        if env.lenient:
            self._refused += 1
            return Result(typed(NeverType), ZERO)
        return self.fail(span, code, message, suggestions=suggestions, fixes=fixes)

    def warn(self, span: JqRange | None, code: str, message: str, fixes: list[EastStruct] | None = None) -> None:
        self.diagnostics.append(report(self.text, code, span, message, fixes=fixes or [], warning=True))

    def source(self, path: str) -> str:
        """The text of a node, as written."""
        r = self.range(path)
        return "" if r is None else from_utf16(self.text[r.from_:r.to])

    def slice(self, start: int, end: int) -> str:
        return from_utf16(self.text[start:end])

    def accessor_range(self, n: JqNode, path: str) -> JqRange | None:
        """The range of a field read's ``.name`` (or ``."name"``), without its target."""
        whole = self.range(path)
        target = self.range(child_path(path, "field.target"))
        if whole is None or target is None:
            return whole
        start = target.from_ if n.value["target"].type == "identity" else target.to
        return JqRange(start, whole.to - 1 if n.value["optional"] else whole.to)

    # ─── The walk ──────────────────────────────────────────────────────────

    def check(self, n: JqNode, path: str, input_: Result, env: Env) -> Result:
        self.nodes[path] = n
        key = f"{env.instance}|{path}"
        self.scopes[key] = env
        self.inputs[key] = input_.shape
        # A node whose input has no values never runs: it gives nothing, and
        # `lo: 1, hi: 0` is the identity of `either`.
        if isinstance(input_.shape, TypeShape) and input_.shape.type.type == "Never":
            return self.record(path, env, _DEAD)
        return self.record(path, env, self.check_node(n, path, input_, env))

    def check_node(self, n: JqNode, path: str, input_: Result, env: Env) -> Result:  # noqa: C901
        def at(step: str) -> str:
            return child_path(path, step)

        kind = n.type
        v = n.value
        if kind == "identity":
            return Result(input_.shape, ONE, access=(), stream=input_.stream)
        if kind == "descend":
            return self.descend(input_, path, env)
        if kind == "literal":
            return Result(typed(self.literal(v).type), ONE)
        if kind == "variable":
            return self.variable(v, path, env)
        if kind == "break":
            if v not in env.labels:
                return self.fail(self.range(path), "unknown_function", MESSAGES.unknown_label(v))
            return Result(typed(NeverType), ZERO)
        if kind == "field":
            return self.field(n, path, input_, env)
        if kind == "index":
            return self.index(n, path, input_, env)
        if kind == "slice":
            return self.slice_node(n, path, input_, env)
        if kind == "iterate":
            return self.iterate(n, path, input_, env)
        if kind == "pipe":
            left = self.check(v["left"], at("pipe.left"), input_, env)
            right = self.check(v["right"], at("pipe.right"), left, env)
            return self.compose(left, right)
        if kind == "comma":
            left = self.check(v["left"], at("comma.left"), input_, env)
            right = self.check(v["right"], at("comma.right"), input_, env)
            return Result(union([*members_of(left.shape), *members_of(right.shape)]), also(left.mult, right.mult))
        if kind == "alternative":
            return self.alternative(n, path, input_, env)
        if kind == "negate":
            operand = self.check(v, at("negate"), input_, env)

            def negated(member: TypeShape, _case: str | None) -> Result:
                t = unwrap(member.type)
                if _is_number(t):
                    return Result(typed(t), ONE)
                # In a lenient place, an option is null, which raises, or a number, negated.
                payload = nullable_payload(t)
                if env.lenient and payload is not None and _is_number(unwrap(payload)):
                    return Result(typed(unwrap(payload)), MAYBE)
                return self.mismatch(env, self.range(path), "type_mismatch", MESSAGES.negate(describe_type(member.type)))
            return self.map_members(operand, negated)
        if kind == "binary":
            return self.binary(n, path, input_, env)
        if kind == "array":
            if v.type == "none":
                return Result(typed(ArrayType(NeverType)), ONE)
            body = self.check(v.value, at("array.some"), input_, env)
            element = self.collect(body, self.range(path), at("array.some"))
            if element is None:
                return Result(ERROR, ONE)
            facts = Facts("elements", element=body.shape.facts) \
                if isinstance(body.shape, TypeShape) and body.shape.facts is not None else None
            return Result(typed(ArrayType(element), facts), ONE)
        if kind == "object":
            return self.object(n, path, input_, env)
        if kind == "string":
            mult = ONE
            for i, part in enumerate(v):
                if part.type == "interpolate":
                    mult = piped(mult, self.check(part.value, at(f"string[{i}].interpolate"), input_, env).mult)
            return Result(typed(StringType), mult)
        if kind == "format":
            return self.format(n, path, input_, env)
        if kind == "if":
            return self.conditional(n, path, input_, env)
        if kind == "try":
            return self.try_catch(n, path, input_, env)
        if kind in ("reduce", "foreach"):
            return self.fold(n, path, input_, env)
        if kind == "bind":
            return self.bind(n, path, input_, env)
        if kind == "label":
            labels = env.labels | {v["name"]}
            body = self.check(v["body"], at("label.body"), input_, replace(env, labels=labels))
            # A break stops the stream wherever it runs, so outputs the body would give after it may not come.
            mult = Mult(0, body.mult.hi) if _breaks_to(v["body"], v["name"]) else body.mult
            return Result(body.shape, mult)
        if kind == "def":
            defs = dict(env.defs)
            params = v["params"]
            key = f"{v['name']}/{len(params)}"
            closure: list[Env] = []
            binding = _Binding("def", path, node=n, env_thunk=lambda: closure[0])
            defs[key] = binding
            closure.append(replace(env, defs=defs))
            return self.check(v["rest"], at("def.rest"), input_, closure[0])
        if kind == "call":
            return self.call(n, path, input_, env)
        if kind == "update":
            return self.update(n, path, input_, env)
        raise ValueError(f"checkJq: a {kind} node")

    def compose(self, left: Result, right: Result) -> Result:
        """``a | b``: ``b`` runs on each output of ``a``."""
        prefix = left.access
        return Result(
            shape=right.shape,
            mult=piped(left.mult, right.mult),
            access=(*prefix, *right.access) if prefix is not None and right.access is not None else None,
            case_of=replace(right.case_of, path=(*prefix, *right.case_of.path))
            if prefix is not None and right.case_of is not None else None,
            proves=tuple(replace(p, path=(*prefix, *p.path)) for p in right.proves)
            if prefix is not None and right.proves is not None else None,
            type_of=(*prefix, *right.type_of) if prefix is not None and right.type_of is not None else None,
            partial=right.partial,
            stream=right.stream,
        )

    def map_members(self, input_: Result, each: Callable[[TypeShape, str | None], Result]) -> Result:
        """Applies a typing to each member of a result's shape, and unions the outcomes."""
        if input_.shape.kind == "error":
            return Result(ERROR, input_.mult)
        members: list[Member] = []
        mult: Mult | None = None
        error = False
        for member in members_of(input_.shape):
            out = each(member.shape, member.case)
            if out.shape.kind == "error":
                error = True
            else:
                for m in members_of(out.shape):
                    members.append(Member(m.shape, m.case if m.case is not None else member.case))
            mult = out.mult if mult is None else either(mult, out.mult)
        if error:
            return Result(ERROR, mult if mult is not None else ONE)
        return Result(union(members), mult if mult is not None else ZERO)

    def collect(self, result: Result, span: JqRange | None, at: str | None = None) -> EastType | None:
        """The one type a stream's outputs share, or a reported ``ambiguous_output``."""
        if result.shape.kind == "error":
            return None
        t = unify_shape(result.shape)
        if t is not None:
            return t
        acc: EastType = NeverType
        for member in members_of(result.shape):
            nxt = unify(acc, member.shape.type)
            if nxt is None:
                message = MESSAGES.no_common_type(describe_type(acc), describe_type(member.shape.type))
                outputs = None if at is None else self.last_stage(at)
                names = None if outputs is None else _fields_side_by_side(outputs[0])
                where = None if outputs is None else self.range(outputs[1])
                if names is None or where is None:
                    self.fail(span, "ambiguous_output", message)
                else:
                    suggestion = f"{{{', '.join(names)}}}"
                    self.fail(where, "ambiguous_output", message, suggestions=[suggestion],
                              fixes=[edit(f"Use {suggestion}", where.from_, where.to, suggestion)])
                return None
            acc = nxt
        return acc

    def last_stage(self, path: str) -> tuple[JqNode, str] | None:
        """The node that gives a node's outputs: the last segment of its pipes, through ``as`` bodies."""
        n = self.nodes.get(path)
        at = path
        while n is not None:
            if n.type == "pipe":
                at = child_path(at, "pipe.right")
                n = n.value["right"]
                continue
            if n.type == "bind":
                at = child_path(at, "bind.body")
                n = n.value["body"]
                continue
            return n, at
        return None

    # ─── Leaves ────────────────────────────────────────────────────────────

    def literal(self, value: JqLiteral) -> LiteralValue:
        """A literal's value and type, as the program writes it."""
        t, v = literal_value(value)
        return LiteralValue(t, v)

    def variable(self, name: str, path: str, env: Env) -> Result:
        if name == "__loc__":
            return Result(typed(StructType([("file", StringType), ("line", IntegerType)])), ONE)
        if name in ("ENV", "__prog_args"):
            return self.fail(self.range(path), "unsupported", MESSAGES.excluded(f"${name}"))
        bound = env.vars.get(name)
        if bound is None:
            return self.fail(self.range(path), "unknown_function", MESSAGES.unknown_variable(name))
        return Result(bound.shape, ONE)

    def descend(self, input_: Result, path: str, env: Env) -> Result:
        """``..``: the value and every value nested in it, depth first."""
        if self.refuse_root(input_, path, env):
            return Result(ERROR, ONE)
        if input_.shape.kind == "error":
            return Result(ERROR, SOME)
        types = descend_types([member.shape.type for member in members_of(input_.shape)])
        return Result(union([Member(typed(t), None) for t in types]), SOME)

    # ─── Paths ─────────────────────────────────────────────────────────────

    def field(self, n: JqNode, path: str, input_: Result, env: Env) -> Result:
        name = n.value["name"]
        optional = n.value["optional"]
        base = self.check(n.value["target"], child_path(path, "field.target"), input_, env)
        span = self.accessor_range(n, path)
        lenient = replace(env, lenient=True) if optional else env
        read = self.read_field(base, name, span, lenient, optional, path)
        composed = self.compose(base, read)
        return replace(
            composed,
            access=(*base.access, *read.access) if base.access is not None and read.access is not None else None,
            case_of=replace(read.case_of, path=base.access)
            if read.case_of is not None and base.access is not None else None,
            partial=read.partial,
            stream=base.stream,
        )

    def read_field(self, base: Result, name: str, span: JqRange | None, env: Env, optional: bool,
                   path: str) -> Result:
        """``.name`` on each member of a shape."""
        if base.shape.kind == "error":
            return Result(ERROR, ONE)
        is_root = isinstance(base.shape, TypeShape) and self.is_root_shape(base.shape)
        all_members = members_of(base.shape)
        # The payloads of an un-narrowed variant: a case whose payload lacks the
        # field gives null, as jq's `.value.f` does, unless no case has it.
        payloads = any(m.case is not None for m in all_members)
        with_field = [m for m in all_members if m.case is not None and name in self.fields_seen(m.shape.type)]
        if payloads and len(with_field) == 0 and not optional and not env.lenient:
            names = list(dict.fromkeys(n for m in all_members for n in self.fields_seen(m.shape.type)))
            suggestions = [f".{c}" for c in closest(name, names)]
            fixes = [edit(f"Use {suggestions[0]}", span.from_, span.to, suggestions[0])] \
                if suggestions and span is not None else []
            return self.fail(span, "unknown_field",
                             MESSAGES.unknown_payload_field(f".{name}", suggestions[0] if suggestions else None),
                             suggestions=suggestions, fixes=fixes)
        members: list[Member] = []
        mult: Mult | None = None
        case_of: CaseOf | None = None
        missing = False
        error = False
        for member in all_members:
            payload_type = nullable_payload(unwrap(member.shape.type))
            payload = unwrap(member.shape.type if payload_type is None else payload_type).type
            lacks = member.case is not None and payload in ("Struct", "Null") \
                and name not in self.fields_seen(member.shape.type)
            out = self.field_of_type(member.shape, name, span, env, optional or lacks, is_root, path)
            if out.case_of is not None:
                case_of = out.case_of
            if out.shape.kind == "error":
                error = True
                continue
            if lacks:
                missing = True
            members.extend(members_of(out.shape))
            mult = out.mult if mult is None else either(mult, out.mult)
        if error:
            return Result(ERROR, ONE)
        partial = Partial(with_field[0].case, name, path) if missing and len(with_field) == 1 else None  # type: ignore[arg-type]
        # A field of the payloads is one field to jq: its values share a type when they can.
        merged = unify_shape(union(members)) if payloads else None
        shape = typed(merged) if merged is not None else union(members)
        return Result(shape, mult if mult is not None else ONE, access=(name,), case_of=case_of, partial=partial)

    def fields_seen(self, type_: EastType) -> dict[str, EastType]:
        """The fields jq sees on a type: a struct's, through an option."""
        payload = nullable_payload(unwrap(type_))
        t = unwrap(type_ if payload is None else payload)
        return fields_of(t) if t.type == "Struct" else {}

    def is_root_shape(self, shape: TypeShape) -> bool:
        return self.root and shape.type is self.input

    def field_of_type(self, member: TypeShape, name: str, span: JqRange | None, env: Env, optional: bool,
                      is_root: bool, path: str) -> Result:
        type_ = member.type
        t = unwrap(type_)
        if t.type == "Null":
            return Result(typed(NullType), ONE)
        payload = nullable_payload(t)
        if payload is not None:
            present = member.facts is not None and member.facts.kind == "present"
            inner = self.field_of_type(typed(payload, member.facts.payload if present else None),  # type: ignore[union-attr]
                                       name, span, env, optional, False, path)
            if inner.shape.kind == "error" or present:
                return inner

            # `.type` of an optional variant still tests its case: a true test proves the value is there.
            def wrap(m: TypeShape, _case: str | None) -> Result:
                t2 = or_null(m.type)
                if t2 is None:
                    return self.mismatch(env, span, "ambiguous_output",
                                         MESSAGES.no_common_type(describe_type(m.type), "Null"))
                return Result(typed(t2, m.facts), ONE)
            wrapped = self.map_members(inner, wrap)
            return replace(wrapped, case_of=inner.case_of)
        if t.type == "Struct":
            fields = fields_of(t)
            if name in fields:
                if is_root and name not in self.reads:
                    self.reads.append(name)
                facts = member.facts.fields.get(name) if member.facts is not None and member.facts.kind == "fields" \
                    else None
                return Result(typed(fields[name], facts), ONE)
            if optional or env.lenient:
                return Result(typed(NullType), ONE)
            suggestions = [f".{s}" for s in closest(name, list(fields))]
            fixes = [edit(f"Use {suggestions[0]}", span.from_, span.to, suggestions[0])] \
                if suggestions and span is not None else []
            first = suggestions[0] if suggestions else None
            message = MESSAGES.unknown_dataset(f".{name}", first) if is_root \
                else MESSAGES.unknown_field(f".{name}", describe_type(type_), first)
            return self.fail(span, "unknown_field", message, suggestions=suggestions, fixes=fixes)
        if t.type == "Dict":
            if unwrap(dict_key(t)).type != "String":
                return self.mismatch(env, span, "type_mismatch", MESSAGES.key_type(
                    f".{name}", describe_type(dict_key(t)), json_string(name), "String"))
            value = or_null(dict_value(t))
            if value is None:
                return self.mismatch(env, span, "ambiguous_output",
                                     MESSAGES.no_common_type(describe_type(dict_value(t)), "Null"))
            return Result(typed(value), ONE)
        if t.type == "Variant":
            cases = cases_of(t, member.facts)
            if name == "type":
                return Result(typed(StringType), ONE, case_of=CaseOf((), t, tuple(cases)))
            if name == "value":
                payload_facts = member.facts.payload if member.facts is not None and member.facts.kind == "cases" \
                    else None
                all_cases = cases_of_type(t)
                return Result(
                    union([Member(typed(all_cases[c], payload_facts if len(cases) == 1 else None), c) for c in cases]),
                    ZERO if len(cases) == 0 else ONE,
                )
            if optional or env.lenient:
                return Result(typed(NullType), ONE)
            target_text = self.source(child_path(path, "field.target")) or "."
            return self.fail(span, "unknown_field", MESSAGES.unknown_variant_field(f".{name}", target_text),
                             suggestions=[".type", ".value"])
        if optional:
            return Result(typed(NeverType), ZERO)
        return self.mismatch(env, span, "type_mismatch", MESSAGES.not_a_field(f".{name}", describe_type(type_)))

    def index(self, n: JqNode, path: str, input_: Result, env: Env) -> Result:
        index = n.value["index"]
        optional = n.value["optional"]
        base = self.check(n.value["target"], child_path(path, "index.target"), input_, env)
        key_path = child_path(path, "index.index")
        key = self.check(index, key_path, input_, env)
        span = self.range(path)
        lenient = replace(env, lenient=True) if optional else env
        # A literal string on a struct reads a field.
        if index.type == "literal":
            literal = self.literal(index.value)
            if literal.type.type == "String" and all(unwrap(m.shape.type).type != "Dict"
                                                     for m in members_of(base.shape)):
                read = self.read_field(base, literal.value, span, lenient, optional, path)
                return replace(self.compose(base, read),
                               access=(*base.access, literal.value) if base.access is not None else None,
                               stream=base.stream)
        if key.shape.kind == "error":
            return Result(ERROR, ONE)
        key_type = self.collect(key, self.range(key_path))
        if key_type is None:
            return Result(ERROR, ONE)
        form = f"{self.source(child_path(path, 'index.target')) or '.'}[…]"

        def each(member: TypeShape, _case: str | None) -> Result:
            t = unwrap(member.type)
            if t.type == "Null":
                return Result(typed(NullType), ONE)
            payload = nullable_payload(t)
            container = unwrap(payload) if payload is not None else t
            element: tuple[EastType, EastType, Facts | None] | None
            if container.type in ("Array", "Set"):
                element = (IntegerType, container.value,
                           member.facts.element if member.facts is not None and member.facts.kind == "elements"
                           else None)
            elif container.type == "Vector":
                element = (IntegerType, container.value, None)
            elif container.type == "Matrix":
                element = (IntegerType, ArrayType(container.value), None)
            elif container.type == "Dict":
                element = (dict_key(container), dict_value(container),
                           member.facts.value if member.facts is not None and member.facts.kind == "values" else None)
            else:
                element = None
            if element is None:
                if container.type == "Struct":
                    return self.mismatch(lenient, self.range(key_path), "type_mismatch", MESSAGES.struct_key(form))
                if optional:
                    return Result(typed(NeverType), ZERO)
                return self.mismatch(lenient, span, "not_indexable", MESSAGES.not_indexable(
                    self.source(child_path(path, "index.target")) or ".", describe_type(member.type)))
            element_key, element_value, element_facts = element
            if not self.key_fits(key_type, element_key, index, key_path, env):
                return self.mismatch(lenient, self.range(key_path), "type_mismatch", MESSAGES.key_type(
                    form, describe_type(element_key), self.source(key_path), describe_type(key_type)))
            value = or_null(element_value)
            if value is None:
                return self.mismatch(lenient, span, "ambiguous_output",
                                     MESSAGES.no_common_type(describe_type(element_value), "Null"))
            return Result(typed(value, element_facts), ONE)

        out = self.map_members(base, each)
        return Result(out.shape, piped(key.mult, piped(base.mult, out.mult)))

    def key_fits(self, given: EastType, wanted: EastType, n: JqNode, path: str, env: Env) -> bool:
        """Whether a key of ``given`` type indexes by ``wanted``, reading a literal as its operand's type."""
        w = unwrap(wanted)
        if type_equal(given, w):
            return True
        if n.type == "literal":
            return self.coerce_literal(n, path, w, env) is not None
        return False

    def coerce_literal(self, n: JqNode, path: str, wanted: EastType, env: Env) -> EastType | None:
        """A literal used where ``wanted`` is: an Integer where a Float is, an ISO string where a DateTime is.

        A string that is not an ISO-8601 date is reported. The program keeps
        the literal as written (``QUERY.md`` §7). An Integer needs nothing
        more: its translation widens it wherever it meets a Float. A string
        read as a DateTime is recorded as one in this instance, and its
        translation gives the DateTime it writes.

        Returns:
            The type the literal is read as, or ``None`` when it does not fit.
        """
        literal = self.literal(n.value)
        if type_equal(literal.type, wanted):
            return wanted
        if wanted.type == "Float" and literal.type.type == "Integer":
            return FloatType
        if wanted.type == "DateTime" and literal.type.type == "String":
            if iso_date_time(literal.value) is None:
                self.fail(self.range(path), "type_mismatch", MESSAGES.iso_date(self.source(path)))
                return None
            self.records[f"{env.instance}|{path}"] = Result(typed(DateTimeType), ONE)
            return DateTimeType
        return None

    def coerce_array_literal(self, n: JqNode, path: str, wanted: EastType, env: Env) -> EastType | None:
        """An array literal of literals (``["2026-01-01", "2026-02-01"]``) used where an array of ``wanted`` is.

        Each element is read as :meth:`coerce_literal` reads it, and what
        checking the array recorded is retyped to match.

        Returns:
            The array's new type, or ``None`` when it is not such an array, or
            an element does not fit.
        """
        if n.type != "array" or n.value.type != "some":
            return None
        literals: list[tuple[JqNode, str]] = []
        commas: list[str] = []

        def collect(c: JqNode, at: str) -> bool:
            if c.type == "literal":
                literals.append((c, at))
                return True
            if c.type != "comma":
                return False
            commas.append(at)
            return collect(c.value["left"], child_path(at, "comma.left")) \
                and collect(c.value["right"], child_path(at, "comma.right"))

        if not collect(n.value.value, child_path(path, "array.some")):
            return None
        for literal_node, literal_path in literals:
            if self.coerce_literal(literal_node, literal_path, wanted, env) is None:
                return None

        def retype(at: str, type_: EastType) -> None:
            key = f"{env.instance}|{at}"
            r = self.records.get(key)
            if r is not None:
                self.records[key] = replace(r, shape=typed(type_))

        for at in [*commas, *(literal_path for _, literal_path in literals)]:
            retype(at, wanted)
        retype(path, ArrayType(wanted))
        return ArrayType(wanted)

    def slice_node(self, n: JqNode, path: str, input_: Result, env: Env) -> Result:
        v = n.value
        optional = v["optional"]
        base = self.check(v["target"], child_path(path, "slice.target"), input_, env)
        mult = base.mult
        for bound, step in ((v["from"], "slice.from.some"), (v["to"], "slice.to.some")):
            if bound.type != "some":
                continue
            bound_path = child_path(path, step)
            r = self.check(bound.value, bound_path, input_, env)
            mult = piped(mult, r.mult)
            t = self.collect(r, self.range(bound_path))
            if t is not None and not self.key_fits(t, IntegerType, bound.value, bound_path, env) and not can_be_null(t):
                self.mismatch(env, self.range(bound_path), "type_mismatch", MESSAGES.slice_bound(describe_type(t)))
        lenient = replace(env, lenient=True) if optional else env

        def each(member: TypeShape, _case: str | None) -> Result:
            u = unwrap(member.type)
            # `null` slices to null, as jq slices it: an option's value is sliced, and its null stays null.
            payload = nullable_payload(u)
            present = member.facts is not None and member.facts.kind == "present"
            t = u if payload is None else unwrap(payload)
            facts = member.facts if payload is None else (member.facts.payload if present else None)  # type: ignore[union-attr]

            def sliced(type_: EastType, f: Facts | None = None) -> Result:
                if payload is None or present:
                    return Result(typed(type_, f), ONE)
                option = or_null(type_)
                if option is None:
                    return self.mismatch(lenient, self.range(path), "ambiguous_output",
                                         MESSAGES.no_common_type(describe_type(type_), "Null"))
                return Result(typed(option), ONE)

            if t.type == "Null":
                return Result(typed(NullType), ONE)
            if t.type in ("Array", "String", "Vector"):
                return sliced(t, facts)
            if t.type == "Set":
                return sliced(ArrayType(t.value))
            if optional:
                return Result(typed(NeverType), ZERO)
            return self.mismatch(lenient, self.range(path), "not_indexable", MESSAGES.not_indexable(
                self.source(child_path(path, "slice.target")) or ".", describe_type(member.type)))

        out = self.map_members(base, each)
        return Result(out.shape, piped(mult, out.mult))

    def iterate(self, n: JqNode, path: str, input_: Result, env: Env) -> Result:
        optional = n.value["optional"]
        base = self.check(n.value["target"], child_path(path, "iterate.target"), input_, env)
        if self.refuse_root(base, path, env):
            return Result(ERROR, ONE)
        target_text = self.source(child_path(path, "iterate.target"))
        form = f"{'.' if target_text == '.' else target_text}[]"
        inner_env = replace(env, lenient=True) if optional else env
        out = self.map_members(base, lambda member, _c: self.elements_of(member, optional, inner_env, form,
                                                                          self.range(path)))
        return Result(out.shape, piped(base.mult, out.mult), stream=path)

    def elements_of(self, member: TypeShape, optional: bool, env: Env, form: str, span: JqRange | None) -> Result:
        """The elements ``.[]`` gives on one member."""
        t = unwrap(member.type)
        payload = nullable_payload(t)
        present = member.facts is not None and member.facts.kind == "present"
        if payload is not None:
            # Null raises; in a lenient place that gives no output, and a value's elements are given.
            if not optional and not env.lenient and not present:
                fixes = [] if span is None else [edit(f"Use {form}?", span.to, span.to, "?")]
                return self.mismatch(env, span, "not_iterable", MESSAGES.not_iterable_null(form, describe_type(member.type)),
                                     fixes=fixes)
            inner = self.elements_of(typed(payload, member.facts.payload if present else None),  # type: ignore[union-attr]
                                     optional, env, form, span)
            return Result(inner.shape, Mult(0, inner.mult.hi))
        facts = member.facts
        if t.type == "Array":
            return Result(typed(t.value, facts.element if facts is not None and facts.kind == "elements" else None),
                          MANY)
        if t.type == "Set":
            return Result(typed(t.value), MANY)
        if t.type == "Vector":
            return Result(typed(t.value), MANY)
        if t.type == "Matrix":
            return Result(typed(ArrayType(t.value)), MANY)
        if t.type == "Dict":
            return Result(typed(dict_value(t), facts.value if facts is not None and facts.kind == "values" else None),
                          MANY)
        if t.type == "Struct":
            fields = fields_of(t)
            known = facts.fields if facts is not None and facts.kind == "fields" else None
            return Result(
                union([Member(typed(f, None if known is None else known.get(name)), None)
                       for name, f in fields.items()]),
                ZERO if len(fields) == 0 else SOME,
            )
        if optional:
            return Result(typed(NeverType), ZERO)
        return self.mismatch(env, span, "not_iterable", MESSAGES.not_iterable(form, describe_type(member.type)))

    def refuse_root(self, input_: Result, path: str, _env: Env) -> bool:
        """With ``root``, a filter that would read every dataset of the root is refused."""
        if not self.root or not isinstance(input_.shape, TypeShape) or not self.is_root_shape(input_.shape):
            return False
        self.fail(self.range(path), "unsupported", MESSAGES.whole_root(self.root_names))
        return True

    def narrow_first(self, env: Env, span: JqRange | None, type_: EastType, partial: Partial) -> Result:
        """"Narrow first": a payload field only one case has, read where its value is needed."""
        # The read is `<base>.F.value.leaf`, where <base> is `.` or the node the field reads start from.
        leaf = self.nodes.get(partial.at)

        def step(n: JqNode | None, path: str) -> tuple[JqNode, str] | None:
            if n is not None and n.type in ("field", "index"):
                return n.value["target"], child_path(path, f"{n.type}.target")
            return None

        value = step(leaf, partial.at)
        variant = None if value is None else step(value[0], value[1])
        if variant is None:
            return self.mismatch(env, span, "type_mismatch",
                                 MESSAGES.input(self.source(partial.at), "a value", describe_type(type_)))
        base = variant
        while base[0].type in ("field", "index"):
            nxt = step(base[0], base[1])
            assert nxt is not None
            base = nxt
        chain = self.range(partial.at)
        assert chain is not None
        base_range = self.range(base[1])
        start = chain.from_ if base[0].type == "identity" else base_range.to  # type: ignore[union-attr]
        variant_range = self.range(variant[1])
        assert variant_range is not None
        variant_text = self.slice(start, variant_range.to)
        leaf_text = self.slice(start, chain.to)
        select = f"select({variant_text}.type == {json_string(partial.case_name)})"
        message = MESSAGES.narrow_first(leaf_text, describe_type(type_), partial.case_name, variant_text, partial.leaf)
        label = "Narrow first"
        if base[0].type == "identity":
            the_fix = edit(label, chain.from_, chain.from_, f"{select} | ") if _is_pipe_position(partial.at) \
                else _fix([(f"({select} | ", 0, chain.from_), (")", 0, chain.to)], label)
        else:
            inner = f" | {select} | {leaf_text}"
            the_fix = edit(label, start, chain.to, inner) if _is_pipe_position(partial.at) \
                else _fix([("(", 0, chain.from_), (f"{inner})", chain.to - start, start)], label)
        return self.mismatch(env, span, "type_mismatch", message, fixes=[the_fix])

    def array_on_element(self, env: Env, call_path: str, name: str, stream: str, type_: EastType) -> Result:
        """An array builtin run on each element of a stream, with the fix that collects the stream."""
        stream_text = self.source(stream)
        # The segments before the call in its pipe chain, first to last.
        segments: list[str] = []
        base = call_path
        while base == "pipe.right" or base.endswith(".pipe.right"):
            base = "" if base == "pipe.right" else base[:-len(".pipe.right")]
            segments.insert(0, child_path(base, "pipe.left"))
        first = next((s for s in segments if stream == s or stream.startswith(f"{s}.")), None)
        start = None if first is None else self.range(first)
        end = None if len(segments) == 0 else self.range(segments[-1])
        if start is None or end is None:
            return self.mismatch(env, self.range(call_path), "array_builtin_on_element", MESSAGES.array_on_element(
                name, stream_text, describe_type(type_), f"[{stream_text}]"))
        collected = f"[{self.slice(start.from_, end.to)}]"
        the_fix = _fix([("[", 0, start.from_), ("]", 0, end.to)], f"Collect {stream_text} first")
        return self.mismatch(env, self.range(call_path), "array_builtin_on_element",
                             MESSAGES.array_on_element(name, stream_text, describe_type(type_), collected),
                             fixes=[the_fix])

    # ─── Operators ─────────────────────────────────────────────────────────

    def alternative(self, n: JqNode, path: str, input_: Result, env: Env) -> Result:
        left = self.check(n.value["left"], child_path(path, "alternative.left"), input_, env)
        right = self.check(n.value["right"], child_path(path, "alternative.right"), input_, env)
        if left.shape.kind == "error" or right.shape.kind == "error":
            return Result(ERROR, ONE)
        kept: list[Member] = []
        always_truthy = True
        for member in members_of(left.shape):
            t = unwrap(member.shape.type)
            if t.type == "Null":
                always_truthy = False
                continue
            payload = nullable_payload(t)
            if payload is not None:
                always_truthy = False
                kept.append(Member(typed(payload), member.case))
                continue
            if t.type == "Boolean":
                always_truthy = False
            kept.append(member)
        shape = union([*kept, *members_of(right.shape)])
        lo = 1 if right.mult.lo == 1 or (always_truthy and left.mult.lo == 1) else 0
        return Result(shape, Mult(lo, max(left.mult.hi, right.mult.hi)))

    def binary(self, n: JqNode, path: str, input_: Result, env: Env) -> Result:
        op = n.value["op"]
        left_path = child_path(path, "binary.left")
        right_path = child_path(path, "binary.right")
        if op in ("and", "or"):
            left = self.check(n.value["left"], left_path, input_, env)
            # The right side of `and` runs only when the left is true, so it sees the left's facts.
            right_input = self.narrow(input_, left.proves) if op == "and" and left.proves is not None else input_
            right = self.check(n.value["right"], right_path, right_input, env)
            if left.shape.kind == "error" or right.shape.kind == "error":
                return Result(ERROR, ONE)
            proves = (*(left.proves or ()), *(right.proves or ())) if op == "and" else None
            return Result(typed(BooleanType), piped(left.mult, right.mult), proves=proves if proves else None)
        left = self.check(n.value["left"], left_path, input_, env)
        right = self.check(n.value["right"], right_path, input_, env)
        if left.shape.kind == "error" or right.shape.kind == "error":
            return Result(ERROR, piped(left.mult, right.mult))
        mult = piped(left.mult, right.mult)
        if op in _COMPARISON:
            return replace(self.comparison(op, n, path, left, right, env), mult=mult)
        if op in _ARITHMETIC:
            out = self.arithmetic(op, left, right, _Operands(left_path, right_path, self.range(path)), env)
            return Result(out.shape, piped(mult, out.mult), partial=out.partial)
        raise ValueError(f"checkJq: {json_string(op)} is not a jq binary operator")

    def comparison(self, op: str, n: JqNode, path: str, left: Result, right: Result, env: Env) -> Result:  # noqa: C901
        left_path = child_path(path, "binary.left")
        right_path = child_path(path, "binary.right")
        # `type == "number"`: a type test, which narrows.
        for type_side, other_node, other_path in ((left, n.value["right"], right_path),
                                                  (right, n.value["left"], left_path)):
            if type_side.type_of is None or other_node.type != "literal" or op not in ("==", "!="):
                continue
            literal = self.literal(other_node.value)
            if literal.type.type != "String":
                continue
            name = literal.value
            if name not in JQ_TYPE_NAMES:
                suggestions = [json_string(c) for c in closest(name, JQ_TYPE_NAMES)]
                r = self.range(other_path)
                fixes = [edit(f"Use {suggestions[0]}", r.from_, r.to, suggestions[0])] \
                    if suggestions and r is not None else []
                return self.fail(r, "unknown_case", MESSAGES.unknown_type(
                    json_string(name), JQ_TYPE_NAMES, suggestions[0] if suggestions else None),
                    suggestions=suggestions, fixes=fixes)
            types = (name,) if op == "==" else tuple(t for t in JQ_TYPE_NAMES if t != name)
            return Result(typed(BooleanType), ONE, proves=(Proof("type", type_side.type_of, types=types),))
        # `.F.type == "case"`: a case test, which narrows.
        for case_side, case_path, other_node, other_path in ((left, left_path, n.value["right"], right_path),
                                                             (right, right_path, n.value["left"], left_path)):
            if case_side.case_of is None or other_node.type != "literal":
                continue
            literal = self.literal(other_node.value)
            if literal.type.type != "String":
                continue
            name = literal.value
            variant_type = unwrap(case_side.case_of.variant)
            all_cases = list(cases_of_type(variant_type)) if variant_type.type == "Variant" else []
            if name not in all_cases:
                suggestions = [json_string(c) for c in closest(name, all_cases)]
                r = self.range(other_path)
                fixes = [edit(f"Use {suggestions[0]}", r.from_, r.to, suggestions[0])] \
                    if suggestions and r is not None else []
                variant_path = re.sub(r"\s*\.\s*type\Z", "", self.source(case_path))
                return self.fail(r, "unknown_case", MESSAGES.unknown_case(
                    variant_path, json_string(name), all_cases, suggestions[0] if suggestions else None),
                    suggestions=suggestions, fixes=fixes)
            if op in ("==", "!="):
                cases = (name,) if op == "==" else tuple(c for c in case_side.case_of.cases if c != name)
                return Result(typed(BooleanType), ONE, proves=(Proof("case", case_side.case_of.path, cases=cases),))
        lt = self.collect(left, self.range(left_path))
        rt = self.collect(right, self.range(right_path))
        if lt is None or rt is None:
            return Result(ERROR, ONE)
        if lt.type == "Never" or rt.type == "Never":
            return Result(typed(BooleanType), ONE)
        # A whole variant compared with a string.
        for side, side_path, other in ((lt, left_path, rt), (rt, right_path, lt)):
            payload = nullable_payload(unwrap(side))
            s = unwrap(side if payload is None else payload)
            if s.type == "Variant" and nullable_payload(s) is None and unwrap(other).type == "String":
                text = self.source(side_path)
                r = self.range(side_path)
                fixes = [edit("Use .type", r.to, r.to, ".type")] if r is not None else []
                return self.fail(r, "type_mismatch", MESSAGES.whole_variant(text, describe_type(side)), fixes=fixes)
        reported = len(self.diagnostics)
        fits = self.comparable(lt, rt, n, path, env)
        # A literal that failed to parse as the other side's type has said so.
        if len(self.diagnostics) > reported:
            return Result(ERROR, ONE)
        if fits:
            # An Integer never equals a Float with a fraction.
            lt_payload = nullable_payload(unwrap(lt))
            if op in ("==", "!=") and unwrap(lt if lt_payload is None else lt_payload).type == "Integer" \
                    and n.value["right"].type == "literal":
                literal = self.literal(n.value["right"].value)
                if literal.type.type == "Float" and not (math.isfinite(literal.value) and literal.value.is_integer()):
                    return self.fail(self.range(path), "type_mismatch", MESSAGES.never_equal(op))
            return Result(typed(BooleanType), ONE)
        return self.mismatch(env, self.range(path), "type_mismatch",
                             MESSAGES.compares(op, describe_type(lt), describe_type(rt)))

    def comparable(self, a: EastType, b: EastType, n: JqNode, path: str, env: Env) -> bool:
        """Whether two types compare: equal, numbers, a value and its option, or a literal read as the other's type."""
        ua = unwrap(a)
        ub = unwrap(b)
        right = n.value["right"]
        left = n.value["left"]
        if type_equal(ua, ub):
            return True
        # Numbers compare: the translation widens an Integer it compares with a Float.
        if _is_number(ua) and _is_number(ub):
            return True
        if ua.type == "Null" and can_be_null(ub):
            return True
        if ub.type == "Null" and can_be_null(ua):
            return True
        pa = nullable_payload(ua)
        pb = nullable_payload(ub)
        if pa is not None or pb is not None:
            return self.comparable(pa if pa is not None else ua, pb if pb is not None else ub, n, path, env)
        if ua.type == "DateTime" and right.type == "literal":
            return self.coerce_literal(right, child_path(path, "binary.right"), DateTimeType, env) is not None
        if ub.type == "DateTime" and left.type == "literal":
            return self.coerce_literal(left, child_path(path, "binary.left"), DateTimeType, env) is not None
        return unify(ua, ub) is not None and ua.type == ub.type

    def arithmetic(self, op: str, left: Result, right: Result, operands: _Operands, env: Env) -> Result:  # noqa: C901
        lt = self.collect(left, self.range(operands.left_path))
        rt = self.collect(right, self.range(operands.right_path))
        if lt is None or rt is None:
            return Result(ERROR, ONE)
        # An operand with no value (a recursion not yet known, `empty`) gives none.
        if lt.type == "Never" or rt.type == "Never":
            return Result(typed(NeverType), ONE)

        def fail() -> Result:
            return self.mismatch(env, operands.range, "type_mismatch",
                                 MESSAGES.arithmetic(op, describe_type(lt), describe_type(rt)))

        a = unwrap(lt)
        b = unwrap(rt)
        # `null` is the identity for `+`.
        if op == "+":
            if a.type == "Null":
                return Result(typed(b), ONE)
            if b.type == "Null":
                return Result(typed(a), ONE)
            pa = nullable_payload(a)
            pb = nullable_payload(b)
            if pa is not None and pb is not None:
                inner = self.arithmetic(op, Result(typed(pa), ONE), Result(typed(pb), ONE), operands, env)
                t = or_null(inner.shape.type) if isinstance(inner.shape, TypeShape) else None
                return inner if t is None else Result(typed(t), ONE)
            if pa is not None:
                a = unwrap(pa)
            if pb is not None:
                b = unwrap(pb)
        elif nullable_payload(a) is not None or nullable_payload(b) is not None:
            if not env.lenient:
                return fail()
            # In a lenient place, an option is null, which raises, or its value, combined as a value is.
            pa = nullable_payload(a)
            pb = nullable_payload(b)
            inner = self.arithmetic(op, Result(typed(pa if pa is not None else a), ONE),
                                    Result(typed(pb if pb is not None else b), ONE), operands, env)
            return inner if inner.shape.kind == "error" else replace(inner, mult=Mult(0, inner.mult.hi))
        if _is_number(a) and _is_number(b):
            if op == "/":
                return Result(typed(FloatType), ONE)
            # jq's remainder of the numbers truncated to integers: a Float operand, which can be NaN, gives a Float.
            if op == "%":
                return Result(typed(IntegerType if a.type == "Integer" and b.type == "Integer" else FloatType), ONE)
            # An Integer with a Float is a Float: the translation widens the Integer.
            return Result(typed(FloatType if a.type == "Float" or b.type == "Float" else IntegerType), ONE)
        if op == "+":
            if a.type == "String" and b.type == "String":
                return Result(typed(StringType), ONE)
            if a.type == "Array" and b.type == "Array":
                element = unify(a.value, b.value)
                return fail() if element is None else Result(typed(ArrayType(element)), ONE)
            if a.type == "Struct" and b.type == "Struct":
                return Result(self.merge_structs(left, right, False, operands.range), ONE)
            if a.type == "Dict" and b.type == "Dict":
                merged = unify(a, b)
                return fail() if merged is None else Result(typed(merged), ONE)
            if (a.type == "Struct" and len(a.value) == 0 and b.type == "Dict") \
                    or (b.type == "Struct" and len(b.value) == 0 and a.type == "Dict"):
                return Result(typed(a if a.type == "Dict" else b), ONE)
            return fail()
        if op == "-":
            if a.type == "Array" and b.type == "Array" and unify(a.value, b.value) is not None:
                return Result(typed(a), ONE)
            return fail()
        if op == "*":
            if a.type == "Struct" and b.type == "Struct":
                return Result(self.merge_structs(left, right, True, operands.range), ONE)
            # Dicts merge deeply, as jq merges objects: a key both hold has their values merged when both are objects.
            if a.type == "Dict" and b.type == "Dict":
                merged = unify(a, b)
                return fail() if merged is None else Result(typed(merged), ONE)
            if (a.type == "Struct" and len(a.value) == 0 and b.type == "Dict") \
                    or (b.type == "Struct" and len(b.value) == 0 and a.type == "Dict"):
                return Result(typed(a if a.type == "Dict" else b), ONE)
            # A string repeated, the count a number on either side: a negative count gives null.
            if (a.type == "String" and _is_number(b)) or (_is_number(a) and b.type == "String"):
                return Result(typed(or_null(StringType)), ONE)  # type: ignore[arg-type]
            return fail()
        if op == "/":
            if a.type == "String" and b.type == "String":
                return Result(typed(ArrayType(StringType)), ONE)
            return fail()
        return fail()

    def merge_structs(self, left: Result, right: Result, deep: bool, span: JqRange | None) -> Shape:
        """``a + b`` or ``a * b`` on structs.

        The fields of ``a``, then the new fields of ``b``; ``b``'s value wins,
        and ``*`` merges fields that are structs, or dicts, in both deeply.
        """
        problem = [False]

        def merge(a: EastType, b: EastType, a_facts: Facts | None, b_facts: Facts | None) -> tuple[EastType, Facts | None]:
            ua = unwrap(a)
            ub = unwrap(b)
            af = fields_of(ua) if ua.type == "Struct" else {}
            bf = fields_of(ub) if ub.type == "Struct" else {}
            fields: dict[str, EastType] = {}
            facts: dict[str, Facts] = {}
            a_known = a_facts.fields if a_facts is not None and a_facts.kind == "fields" else None
            b_known = b_facts.fields if b_facts is not None and b_facts.kind == "fields" else None
            for name, t in af.items():
                fields[name] = t
                f = None if a_known is None else a_known.get(name)
                if f is not None:
                    facts[name] = f
            for name, t in bf.items():
                if deep and name in af and unwrap(af[name]).type == "Struct" and unwrap(t).type == "Struct":
                    inner_type, inner_facts = merge(af[name], t, None if a_known is None else a_known.get(name),
                                                    None if b_known is None else b_known.get(name))
                    fields[name] = inner_type
                    if inner_facts is not None:
                        facts[name] = inner_facts
                    else:
                        facts.pop(name, None)
                elif deep and name in af and unwrap(af[name]).type == "Dict" and unwrap(t).type == "Dict":
                    # Two dicts merge into one holding both's keys: their types must unify.
                    merged_dict = unify(unwrap(af[name]), unwrap(t))
                    if merged_dict is None:
                        if not problem[0]:
                            self.fail(span, "type_mismatch",
                                      MESSAGES.arithmetic("*", describe_type(af[name]), describe_type(t)))
                        problem[0] = True
                    fields[name] = t if merged_dict is None else merged_dict
                    facts.pop(name, None)
                else:
                    fields[name] = t
                    f = None if b_known is None else b_known.get(name)
                    if f is not None:
                        facts[name] = f
                    else:
                        facts.pop(name, None)
            return StructType(list(fields.items())), Facts("fields", fields=facts) if facts else None

        lshape = left.shape
        rshape = right.shape
        assert isinstance(lshape, TypeShape) and isinstance(rshape, TypeShape)
        merged_type, merged_facts = merge(lshape.type, rshape.type, lshape.facts, rshape.facts)
        return ERROR if problem[0] else typed(merged_type, merged_facts)

    # ─── Construction ──────────────────────────────────────────────────────

    def object(self, n: JqNode, path: str, input_: Result, env: Env) -> Result:  # noqa: C901
        entries = n.value
        # Names build a struct and computed keys a dict: an object has one kind of key.
        computed_keys = sum(1 for entry in entries if entry["key"].type == "computed")
        if 0 < computed_keys < len(entries):
            return self.fail(self.range(path), "type_mismatch", MESSAGES.mixed_keys())
        mult = ONE
        literal: list[tuple[str, Result]] = []
        computed: list[tuple[Result, Result, str]] = []
        error = False
        for i, entry in enumerate(entries):
            value_path = child_path(path, f"object[{i}].value.some")
            key = entry["key"]
            name: str | None = None
            value: Result | None = None
            if key.type == "name":
                name = key.value
            elif key.type == "variable":
                name = key.value
                if entry["value"].type == "none":
                    value = self.variable(key.value, path, env)
            else:
                key_path = child_path(path, f"object[{i}].key.computed")
                k = self.check(key.value, key_path, input_, env)
                # `{"\(f)"}` holds the input's value at the key, `.[key]`.
                v = self.check(entry["value"].value, value_path, input_, env) if entry["value"].type == "some" \
                    else self.entry_at(input_, k, key_path, env)
                mult = piped(mult, piped(k.mult, v.mult))
                if k.shape.kind == "error" or v.shape.kind == "error":
                    error = True
                computed.append((k, v, key_path))
                continue
            if value is None:
                value = self.check(entry["value"].value, value_path, input_, env) if entry["value"].type == "some" \
                    else self.read_field(input_, name, self.range(path), env, False, path)
            if value.shape.kind == "error":
                error = True
            mult = piped(mult, value.mult)
            earlier = next((j for j, (lname, _r) in enumerate(literal) if lname == name), -1)
            if earlier != -1:
                self.warn(self.range(path), "duplicate_key", MESSAGES.duplicate_key(json_string(name)))
                literal[earlier] = (name, value)
            else:
                literal.append((name, value))
        if error:
            return Result(ERROR, mult)
        if computed:
            key_type: EastType = NeverType
            value_type: EastType = NeverType
            for ck, cv, ck_path in computed:
                k_type = self.collect(ck, self.range(ck_path))
                v_type = self.collect(cv, self.range(path))
                if k_type is None or v_type is None:
                    return Result(ERROR, mult)
                nk = unify(key_type, k_type)
                nv = unify(value_type, v_type)
                if nk is None:
                    return self.fail(self.range(ck_path), "ambiguous_output",
                                     MESSAGES.no_common_type(describe_type(key_type), describe_type(k_type)))
                if nv is None:
                    return self.fail(self.range(path), "ambiguous_output",
                                     MESSAGES.no_common_type(describe_type(value_type), describe_type(v_type)))
                key_type = nk
                value_type = nv
            if not is_immutable_type(key_type):
                return self.fail(self.range(computed[0][2]), "type_mismatch",
                                 MESSAGES.mutable_key(self.source(computed[0][2]), describe_type(key_type)))
            return Result(typed(DictType(key_type, value_type)), mult)
        fields: list[tuple[str, EastType]] = []
        facts: dict[str, Facts] = {}
        for lname, lresult in literal:
            t = self.collect(lresult, self.range(path))
            if t is None:
                return Result(ERROR, mult)
            fields.append((lname, t))
            if isinstance(lresult.shape, TypeShape) and lresult.shape.facts is not None:
                facts[lname] = lresult.shape.facts
        return Result(typed(StructType(fields), Facts("fields", fields=facts) if facts else None), mult)

    def entry_at(self, input_: Result, key: Result, key_path: str, env: Env) -> Result:
        """The value at a computed key of the input, as ``.[key]`` reads it."""
        if key.shape.kind == "error":
            return Result(ERROR, ONE)
        key_type = self.collect(key, self.range(key_path))
        if key_type is None:
            return Result(ERROR, ONE)
        span = self.range(key_path)

        def each(member: TypeShape, _case: str | None) -> Result:
            u = unwrap(member.type)
            if u.type == "Null":
                return Result(typed(NullType), ONE)
            payload = nullable_payload(u)
            t = unwrap(u if payload is None else payload)
            if t.type == "Dict":
                if not type_equal(unwrap(key_type), unwrap(dict_key(t))):
                    return self.mismatch(env, span, "type_mismatch", MESSAGES.key_type(
                        f"{{{self.source(key_path)}}}", describe_type(dict_key(t)), self.source(key_path),
                        describe_type(key_type)))
                value = or_null(dict_value(t))
                if value is None:
                    return self.mismatch(env, span, "ambiguous_output",
                                         MESSAGES.no_common_type(describe_type(dict_value(t)), "Null"))
                return Result(typed(value), ONE)
            if t.type == "Struct":
                return self.mismatch(env, span, "type_mismatch", MESSAGES.struct_key(f"{{{self.source(key_path)}}}"))
            return self.mismatch(env, span, "not_indexable", MESSAGES.not_indexable(".", describe_type(member.type)))
        return self.map_members(input_, each)

    def format(self, n: JqNode, path: str, input_: Result, env: Env) -> Result:
        name = n.value["name"]
        string = n.value["string"]
        builtin = BUILTINS.get(f"@{name}")
        if builtin is None:
            formats = [k for k in BUILTINS if k.startswith("@")]
            suggestions = closest(f"@{name}", formats)
            return self.fail(self.range(path), "unknown_function",
                             MESSAGES.unknown_function(f"@{name}", 0, suggestions[0] if suggestions else None),
                             suggestions=suggestions)
        status = self.availability(builtin, f"@{name}", path)
        if status is not None:
            return status
        assert builtin.typing is not None
        if string.type == "some":
            mult = ONE
            inner = string.value
            if inner.type == "string":
                for i, part in enumerate(inner.value):
                    if part.type == "interpolate":
                        part_path = child_path(child_path(path, "format.string.some"), f"string[{i}].interpolate")
                        r = self.check(part.value, part_path, input_, env)
                        mult = piped(mult, r.mult)
                        # Each interpolated value is formatted, so it must be one the format takes.
                        if r.shape.kind != "error":
                            builtin.typing(self.context(builtin, f"@{name}", part_path, r, env, [], []))
            self.record(child_path(path, "format.string.some"), env, Result(typed(StringType), mult))
            return Result(typed(StringType), mult)
        return builtin.typing(self.context(builtin, f"@{name}", path, input_, env, [], []))

    # ─── Control ───────────────────────────────────────────────────────────

    def narrow(self, input_: Result, proves: tuple[Proof, ...]) -> Result:
        """Adds facts to a result's shape."""
        shape = input_.shape
        for proof in proves:
            if proof.kind == "case":
                shape = refine(shape, proof.path, proof.cases)
            elif len(proof.path) == 0:
                shape = narrow_types(shape, proof.types)
        return replace(input_, shape=shape)

    def conditional(self, n: JqNode, path: str, input_: Result, env: Env) -> Result:
        branches = n.value["branches"]
        otherwise = n.value["otherwise"]
        members: list[Member] = []
        mult: Mult | None = None
        error = False
        rest = input_
        cond_mult = ONE
        for i, branch in enumerate(branches):
            condition = self.check(branch["condition"], child_path(path, f"if.branches[{i}].condition"), rest, env)
            # A condition after one that is always true never runs.
            if rest is not _NOTHING:
                cond_mult = piped(cond_mult, condition.mult)
            # A literal condition decides the branch, as the translation does.
            truth = self.truth_of(branch["condition"])
            if truth is False:
                then_input = _NOTHING
            elif condition.proves is not None:
                then_input = self.narrow(rest, condition.proves)
            else:
                then_input = rest
            result = self.check(branch["then"], child_path(path, f"if.branches[{i}].then"), then_input, env)
            if condition.shape.kind == "error" or result.shape.kind == "error":
                error = True
            members.extend(members_of(result.shape))
            mult = result.mult if mult is None else either(mult, result.mult)
            # The next branch runs when this condition is false.
            if condition.proves is not None and len(condition.proves) == 1:
                proof = condition.proves[0]
                if proof.kind == "case":
                    variant_shape = self.shape_at(rest.shape, proof.path)
                    if variant_shape is not None:
                        others = tuple(c for c in cases_of(variant_shape.type, variant_shape.facts)
                                       if c not in proof.cases)
                        rest = self.narrow(rest, (Proof("case", proof.path, cases=others),))
                else:
                    rest = self.narrow(rest, (Proof("type", proof.path,
                                                    types=tuple(t for t in JQ_TYPE_NAMES if t not in proof.types)),))
            if truth is True:
                rest = _NOTHING
        if otherwise.type == "some":
            other = self.check(otherwise.value, child_path(path, "if.otherwise.some"), rest, env)
        else:
            other = _DEAD if rest is _NOTHING else Result(rest.shape, ONE)
        if other.shape.kind == "error" or error:
            return Result(ERROR, ONE)
        members.extend(members_of(other.shape))
        return Result(union(members), piped(cond_mult, either(mult if mult is not None else ONE, other.mult)))

    def truth_of(self, n: JqNode) -> bool | None:
        """A literal's truth to jq: ``false`` and ``null`` are false, any other literal true."""
        if n.type != "literal":
            return None
        literal = self.literal(n.value)
        if literal.type.type == "Boolean":
            return bool(literal.value)
        return literal.type.type != "Null"

    def shape_at(self, shape: Shape, path: tuple[str, ...]) -> TypeShape | None:
        """The shape at a field path, for narrowing's else branch."""
        if not isinstance(shape, TypeShape):
            return None
        current = shape
        for name in path:
            t = unwrap(current.type)
            if t.type != "Struct":
                return None
            fields = fields_of(t)
            if name not in fields:
                return None
            facts = current.facts.fields.get(name) if current.facts is not None and current.facts.kind == "fields" \
                else None
            current = typed(fields[name], facts)
        return current

    def try_catch(self, n: JqNode, path: str, input_: Result, env: Env) -> Result:
        body = self.check(n.value["body"], child_path(path, "try.body"), input_, replace(env, lenient=True))
        if n.value["catch"].type == "none":
            return Result(body.shape, Mult(0, body.mult.hi))
        # Error values are strings: `error(v)` raises `v`'s East text.
        handler = self.check(n.value["catch"].value, child_path(path, "try.catch.some"),
                             Result(typed(StringType), ONE), env)
        if body.shape.kind == "error" or handler.shape.kind == "error":
            return Result(ERROR, ONE)
        return Result(union([*members_of(body.shape), *members_of(handler.shape)]),
                      Mult(0, max(body.mult.hi, handler.mult.hi)))

    def fold(self, n: JqNode, path: str, input_: Result, env: Env) -> Result:
        kind = n.type
        v = n.value
        source = self.check(v["source"], child_path(path, f"{kind}.source"), input_, env)
        init = self.check(v["init"], child_path(path, f"{kind}.init"), input_, env)
        if source.shape.kind == "error" or init.shape.kind == "error":
            return Result(ERROR, ONE)
        element = self.collect(source, self.range(child_path(path, f"{kind}.source")))
        acc = self.collect(init, self.range(child_path(path, f"{kind}.init")))
        if element is None or acc is None:
            return Result(ERROR, ONE)
        bound = self.destructure(v["pattern"], child_path(path, f"{kind}.pattern"), Result(typed(element), ONE), env)
        if bound is None:
            return Result(ERROR, ONE)
        inner = replace(env, vars={**env.vars, **bound})
        first = acc
        for round_ in range(8):
            errors = len(self.diagnostics)
            update = self.check(v["update"], child_path(path, f"{kind}.update"), Result(typed(acc), ONE), inner)
            if update.shape.kind == "error":
                return Result(ERROR, ONE)
            nxt = self.collect(update, self.range(child_path(path, f"{kind}.update")))
            if nxt is None:
                return Result(ERROR, ONE)
            merged = unify(acc, nxt)
            if merged is None:
                return self.fail(self.range(path), "cannot_infer",
                                 MESSAGES.accumulator(kind, describe_type(first), describe_type(nxt)))
            if type_equal(merged, acc):
                break
            # A round that changed the accumulator's type is checked again; drop its problems.
            del self.diagnostics[errors:]
            acc = merged
            if round_ == 7:
                return self.fail(self.range(path), "cannot_infer",
                                 MESSAGES.accumulator(kind, describe_type(first), describe_type(merged)))
        # The accumulator's settled type, for the translator.
        self.record(f"{path}#acc", env, Result(typed(acc), ONE))
        if kind == "reduce":
            return Result(typed(acc), ONE)
        extract = v["extract"]
        if extract.type == "none":
            return Result(typed(acc), MANY)
        out = self.check(extract.value, child_path(path, "foreach.extract.some"), Result(typed(acc), ONE), inner)
        return Result(out.shape, MANY)

    def bind(self, n: JqNode, path: str, input_: Result, env: Env) -> Result:
        source = self.check(n.value["source"], child_path(path, "bind.source"), input_, env)
        if source.shape.kind == "error":
            return Result(ERROR, ONE)
        alternatives = n.value["patterns"]
        bindings: list[dict[str, Result]] = []
        for i, pattern in enumerate(alternatives):
            errors = len(self.diagnostics)
            bound = self.destructure(pattern, child_path(path, f"bind.patterns[{i}]"), source, env)
            # With ?//, a pattern that cannot match is skipped at run time.
            if bound is None and len(alternatives) > 1 and i < len(alternatives) - 1:
                del self.diagnostics[errors:]
            if bound is not None:
                bindings.append(bound)
        if not bindings:
            return Result(ERROR, ONE)
        names = list(dict.fromkeys(name for b in bindings for name in b))
        variables = dict(env.vars)
        for name in names:
            t: EastType = NeverType
            facts: Facts | None = None
            for b in bindings:
                r = b.get(name)
                if r is None:
                    bt = NullType
                elif isinstance(r.shape, TypeShape):
                    bt = r.shape.type
                else:
                    shared = unify_shape(r.shape)
                    bt = NeverType if shared is None else shared
                unified = unify(t, bt)
                t = t if unified is None else unified
                if len(bindings) == 1 and r is not None and isinstance(r.shape, TypeShape):
                    facts = r.shape.facts
            variables[name] = Result(typed(t, facts), ONE)
        body = self.check(n.value["body"], child_path(path, "bind.body"), input_, replace(env, vars=variables))
        return Result(body.shape, piped(source.mult, body.mult), stream=body.stream)

    def destructure(self, pattern: JqPattern, path: str, source: Result, env: Env) -> dict[str, Result] | None:
        """The variables a pattern binds from a source, or ``None`` after a reported problem."""
        out: dict[str, Result] = {}

        def visit(p: JqPattern, at: str, value: Result) -> bool:
            if value.shape.kind == "error":
                return False
            if p.type == "variable":
                out[p.value] = value
                return True
            if p.type == "array":
                for i, item in enumerate(p.value):
                    def each(member: TypeShape, _case: str | None) -> Result:
                        t = unwrap(member.type)
                        container = t.value if t.type in ("Array", "Vector") else None
                        if container is None:
                            if t.type == "Null":
                                return Result(typed(NullType), ONE)
                            return self.fail(self.range(at), "type_mismatch", MESSAGES.input(
                                "an array pattern", "an array", describe_type(member.type)))
                        e = or_null(container)
                        if e is None:
                            return self.fail(self.range(at), "ambiguous_output",
                                             MESSAGES.no_common_type(describe_type(container), "Null"))
                        return Result(typed(e), ONE)
                    element = self.map_members(value, each)
                    if not visit(item, child_path(at, f"array[{i}]"), element):
                        return False
                return True
            for i, entry in enumerate(p.value):
                read = self.read_field(value, entry["key"], self.range(at), env, False, at)
                if read.shape.kind == "error":
                    return False
                if entry["value"].type == "none":
                    out[entry["key"]] = read
                    continue
                if not visit(entry["value"].value, child_path(at, f"object[{i}].value.some"), read):
                    return False
            return True

        return out if visit(pattern, path, Result(source.shape, ONE)) else None

    # ─── Calls ─────────────────────────────────────────────────────────────

    def call(self, n: JqNode, path: str, input_: Result, env: Env) -> Result:
        args = list(n.value["args"])
        name = n.value["name"]
        binding = env.defs.get(f"{name}/{len(args)}")
        if binding is not None:
            if binding.kind == "param":
                instance = f"{env.instance}>{path}"
                assert binding.env is not None and binding.arg is not None
                return self.check(binding.arg, binding.path, input_,
                                  replace(binding.env, instance=instance, lenient=env.lenient))
            return self.call_def(binding, n, path, input_, env)
        builtin = BUILTINS.get(name)
        # A builtin a query may not use says so, whatever it is given.
        if builtin is not None and builtin.status not in ("supported", "tooling"):
            refused = self.availability(builtin, name, path)
            assert refused is not None
            return refused
        if builtin is None or len(args) not in builtin.arities:
            defined = [int(k[len(name) + 1:]) for k in env.defs if k.startswith(f"{name}/")]
            arities = list(builtin.arities) if builtin is not None else defined
            if arities:
                # JavaScript's sort without a comparator orders the numbers as text.
                return self.fail(self.range(path), "arity", MESSAGES.arity(name, sorted(arities, key=str), len(args)))
            candidates = list(dict.fromkeys([*(k.split("/")[0] for k in env.defs),
                                             *(k for k in BUILTINS if not k.startswith("@"))]))
            suggestions = closest(name, candidates)
            return self.fail(self.range(path), "unknown_function",
                             MESSAGES.unknown_function(name, len(args), suggestions[0] if suggestions else None),
                             suggestions=suggestions)
        unavailable = self.availability(builtin, name, path)
        if unavailable is not None:
            return unavailable
        assert builtin.typing is not None
        arg_paths = [child_path(path, f"call.args[{i}]") for i in range(len(args))]
        # In a lenient place, an option is null or its value, each checked apart.
        opened = _open_options(input_.shape) if env.lenient else None
        if opened is not None:
            # Whether the builtin takes null, from its typing on null alone; what that reports is reported again below.
            reported = len(self.diagnostics)
            refused_before = self._refused
            builtin.typing(self.context(builtin, name, path, replace(input_, shape=typed(NullType), partial=None), env,
                                        args, arg_paths))
            del self.diagnostics[reported:]
            self.opened[f"{env.instance}|{path}"] = self._refused > refused_before
        given = input_ if opened is None else replace(input_, shape=opened, partial=None)
        return builtin.typing(self.context(builtin, name, path, given, env, args, arg_paths))

    def availability(self, builtin: Builtin, name: str, path: str) -> Result | None:
        """A builtin a query may not call: its diagnostic."""
        status = builtin.status
        if status == "supported":
            return None
        if status == "excluded":
            return self.fail(self.range(path), "unsupported", MESSAGES.excluded(name))
        if status == "unavailable":
            return self.fail(self.range(path), "unsupported", MESSAGES.unavailable(name, builtin.reason or ""))
        if status == "not_yet":
            return self.fail(self.range(path), "unsupported", MESSAGES.not_yet(name))
        if status == "tooling":
            return None if self.tooling else self.fail(self.range(path), "unsupported", MESSAGES.tooling(name))
        return None

    def call_def(self, binding: _Binding, n: JqNode, path: str, input_: Result, env: Env) -> Result:
        assert binding.node is not None and binding.env_thunk is not None
        definition = binding.node.value
        closure = binding.env_thunk()
        variables = dict(closure.vars)
        defs = dict(closure.defs)
        mult = ONE
        signature: list[str] = [binding.path,
                                print_type(input_.shape.type) if isinstance(input_.shape, TypeShape) else "?"]
        filters = False
        for i, param in enumerate(definition["params"]):
            arg_path = child_path(path, f"call.args[{i}]")
            if param.startswith("$"):
                value = self.check(n.value["args"][i], arg_path, input_, env)
                mult = piped(mult, value.mult)
                t = self.collect(value, self.range(arg_path))
                shape = ERROR if t is None else typed(t)
                variables[param[1:]] = Result(shape, ONE)
                defs[f"{param[1:]}/0"] = _Binding("param", arg_path, arg=node("variable", param[1:]),
                                                  env=replace(closure, vars=variables))
                signature.append("?" if t is None else print_type(t))
            else:
                filters = True
                defs[f"{param}/0"] = _Binding("param", arg_path, arg=n.value["args"][i], env=env)
        key = "|".join(signature)
        active = self._active.get(key)
        if active is not None:
            # A recursive call: its output so far.
            if active["filters"]:
                return self.fail(self.range(path), "unsupported", MESSAGES.recursive_filter(definition["name"]))
            active["recursed"] = True
            return active["result"]
        instance = f"{env.instance}>{path}"
        body_env = Env(variables, defs, closure.labels, instance, env.lenient)
        # The recursion's outputs so far: none known yet, as `lo: 1, hi: 0` (the identity of `either`).
        state: dict[str, Any] = {"result": Result(typed(NeverType), Mult(1, 0)), "recursed": False, "filters": filters}
        self._active[key] = state
        try:
            for _round in range(8):
                errors = len(self.diagnostics)
                state["recursed"] = False
                result = self.check(definition["body"], child_path(binding.path, "def.body"), input_, body_env)
                if result.shape.kind == "error" or not state["recursed"]:
                    return replace(result, mult=piped(mult, result.mult))
                before = unify_shape(state["result"].shape)
                after = unify_shape(result.shape)
                merged = None if before is None or after is None else unify(before, after)
                if merged is None:
                    return self.fail(self.range(path), "cannot_infer", MESSAGES.recursion(definition["name"]))
                previous: Mult = state["result"].mult
                nxt = Mult(1 if previous.lo == 1 and result.mult.lo == 1 else 0, max(previous.hi, result.mult.hi))
                if type_equal(merged, before) and nxt.lo == previous.lo and nxt.hi == previous.hi:  # type: ignore[arg-type]
                    return Result(result.shape, piped(mult, result.mult))
                # A round that changed what the recursion gives is checked again; drop its problems.
                del self.diagnostics[errors:]
                state["result"] = Result(typed(merged), nxt)
            return self.fail(self.range(path), "cannot_infer", MESSAGES.recursion(definition["name"]))
        finally:
            del self._active[key]

    def context(self, builtin: Builtin, name: str, path: str, input_: Result, env: Env, args: list[JqNode],
                arg_paths: list[str]) -> CallContext:
        """The context a builtin types a call in."""
        return CallContext(self, builtin, name, path, input_, env, args, arg_paths)

    # ─── Assignment ────────────────────────────────────────────────────────

    def update(self, n: JqNode, path: str, input_: Result, env: Env) -> Result:
        op = n.value["op"]
        path_path = child_path(path, "update.path")
        value_path = child_path(path, "update.value")
        if input_.shape.kind == "error":
            return Result(ERROR, ONE)
        # An update gives the whole value it updates, which a root never is.
        if self.refuse_root(input_, path, env):
            return Result(ERROR, ONE)
        # The value of `=` and of the arithmetic updates is evaluated on `.`.
        value: Result | None = None
        if op != "|=":
            value = self.check(n.value["value"], value_path, input_, env)
            if value.shape.kind == "error":
                return Result(ERROR, ONE)

        # Each position's new value, and how many it has.
        def at(current: Result) -> Result:
            if op == "|=":
                r = self.check(n.value["value"], value_path, current, env)
                return Result(r.shape, Mult(r.mult.lo, 0 if r.mult.hi == 0 else 1))
            assert value is not None
            if op == "=":
                return Result(value.shape, ONE)
            operator = op[:-1]
            if operator == "//":
                if isinstance(current.shape, TypeShape) and not can_be_null(unwrap(current.shape.type)) \
                        and unwrap(current.shape.type).type != "Boolean":
                    self.warn(self.range(path_path), "never_missing",
                              MESSAGES.never_missing(self.source(path_path), describe_type(current.shape.type)))

                def keep(m: TypeShape, _case: str | None) -> Result:
                    t = unwrap(m.type)
                    payload = nullable_payload(t)
                    if t.type == "Null":
                        return Result(typed(NeverType), ZERO)
                    return Result(typed(m.type if payload is None else payload), ONE)
                kept = self.map_members(current, keep)
                return Result(union([*members_of(kept.shape), *members_of(value.shape)]), ONE)
            return self.arithmetic(operator, current, value, _Operands(path_path, value_path, self.range(path)), env)

        assigned = self.assign(input_.shape, n.value["path"], path_path, at, env)
        if assigned is None:
            return Result(ERROR, ONE)
        shape = self.whole_shape(assigned, path)
        return Result(shape, ONE if shape.kind == "error" or value is None else value.mult)

    def whole_shape(self, assigned: Result, path: str) -> Shape:
        """``.`` after an update: ``null`` where the update deleted it, as jq gives it."""
        if assigned.mult.hi == 0:
            return typed(NullType)
        if assigned.mult.lo == 1:
            return assigned.shape
        t = unify_shape(assigned.shape)
        option = None if t is None else or_null(t)
        if option is None:
            return self.fail(self.range(path), "ambiguous_output", MESSAGES.no_common_type(
                describe_type(NeverType if t is None else t), "Null")).shape
        return typed(option)

    def assign(self, shape: Shape, path_node: JqNode, path: str, at: Callable[[Result], Result],
               env: Env) -> Result | None:
        """The shape of ``.`` after assigning at the positions a path expression names."""
        if shape.kind == "error":
            return None
        members: list[Member] = []
        mult: Mult | None = None
        for member in members_of(shape):
            nxt = self.assign_member(member.shape, path_node, path, at, env)
            if nxt is None:
                return None
            members.append(Member(nxt.shape, member.case))
            mult = nxt.mult if mult is None else either(mult, nxt.mult)
        return Result(union(members), mult if mult is not None else ONE)

    def assign_member(self, shape: TypeShape, path_node: JqNode, path: str, at: Callable[[Result], Result],
                      env: Env) -> _Assigned | None:
        span = self.range(path)
        kind = path_node.type
        if kind == "identity":
            r = at(Result(shape, ONE))
            t = self.collect(r, span)
            return None if t is None else _Assigned(typed(t), r.mult)
        if kind == "pipe":
            left = path_node.value["left"]
            right = path_node.value["right"]

            def through(current: Result) -> Result:
                assigned = self.assign(current.shape, right, child_path(path, "pipe.right"), at, env)
                return assigned if assigned is not None else Result(ERROR, ONE)
            return self.assign_member(shape, left, child_path(path, "pipe.left"), through, env)
        if kind in ("field", "index", "iterate", "slice"):
            # An index's key and a slice's bounds are taken on the step's own input, as jq takes them.
            keys = self.step_keys(path_node, path, shape, env)
            if keys is None:
                return None

            def step(current: Result) -> Result:
                inner = self.assign_step(current, path_node, path, at, env, keys)
                return Result(ERROR, ONE) if inner is None else Result(inner, ONE)
            return self.assign_member(shape, path_node.value["target"], child_path(path, f"{kind}.target"), step, env)
        if kind == "descend":
            return self.assign_walk(shape, None, path, at, env)
        if kind == "call":
            args = path_node.value["args"]
            name = path_node.value["name"]
            if name == "select" and len(args) == 1:
                condition = self.check(args[0], child_path(path, "call.args[0]"), Result(shape, ONE), env)
                if condition.shape.kind == "error":
                    return None
                kept = self.narrow(Result(shape, ONE), condition.proves) if condition.proves is not None \
                    else Result(shape, ONE)
                return self.selected(shape, Result(kept.shape, Mult(0, 0 if condition.mult.hi == 0 else 1)), at, path)
            if name in UPDATE_SELECTORS and len(args) == 0:
                builtin = BUILTINS[name]
                assert builtin.typing is not None
                return self.selected(shape, builtin.typing(self.context(builtin, name, path, Result(shape, ONE), env,
                                                                        [], [])), at, path)
            if name == "empty" and len(args) == 0:
                return _Assigned(shape, ONE)
            if name == "recurse" and len(args) <= 1:
                child = (args[0], child_path(path, "call.args[0]")) if len(args) == 1 else None
                return self.assign_walk(shape, child, path, at, env)
            self.fail(span, "unsupported", MESSAGES.unavailable(f"assigning to {name}(…)", _UPDATE_PATHS))
            return None
        self.fail(span, "unsupported", MESSAGES.unavailable(f"assigning to {self.source(path)}", _UPDATE_PATHS))
        return None

    def selected(self, shape: TypeShape, kept: Result, at: Callable[[Result], Result], path: str) -> _Assigned | None:
        """An update of a value where a filter keeps it: updated as kept; where it is not kept, it stays."""
        if kept.shape.kind == "error":
            return None
        if kept.mult.hi == 0 or (isinstance(kept.shape, TypeShape) and kept.shape.type.type == "Never"):
            return _Assigned(shape, ONE)
        replaced = at(Result(kept.shape, ONE))
        t = self.collect(replaced, self.range(path))
        if t is None:
            return None
        merged = shape.type if _same_type(shape.type, t) else unify(shape.type, t)
        if merged is None:
            self.fail(self.range(path), "ambiguous_output",
                      MESSAGES.no_common_type(describe_type(shape.type), describe_type(t)))
            return None
        # Kept every time, it has the update's values; else it keeps its own where it is not kept.
        mult = replaced.mult if kept.mult.lo == 1 else Mult(replaced.mult.lo, 1)
        return _Assigned(typed(merged), mult)

    def step_keys(self, step: JqNode, path: str, input_: TypeShape, env: Env) -> list[EastType | None] | None:
        """An index's key type, checked on the step's own input, or a slice's bounds: each gives one value.

        Returns:
            ``[key]`` (``[None]`` for a field, ``.[]`` or a slice), or ``None`` after a reported problem.
        """
        def one(n: JqNode, at: str) -> EastType | None:
            r = self.check(n, at, Result(input_, ONE), env)
            if r.shape.kind == "error":
                return None
            if r.mult.lo != 1 or r.mult.hi != 1:
                self.fail(self.range(at), "unsupported", MESSAGES.update_key(self.source(at)))
                return None
            return self.collect(r, self.range(at))

        if step.type == "index":
            index = step.value["index"]
            if index.type == "literal" and self.literal(index.value).type.type == "String":
                return [StringType]
            key = one(index, child_path(path, "index.index"))
            return None if key is None else [key]
        if step.type == "slice":
            for bound, s in ((step.value["from"], "slice.from.some"), (step.value["to"], "slice.to.some")):
                if bound.type != "some":
                    continue
                at_path = child_path(path, s)
                t = one(bound.value, at_path)
                if t is None:
                    return None
                if not self.key_fits(t, IntegerType, bound.value, at_path, env) and not can_be_null(unwrap(t)):
                    self.fail(self.range(at_path), "type_mismatch", MESSAGES.slice_bound(describe_type(t)))
                    return None
        return [None]

    def assign_step(self, current: Result, step: JqNode, path: str, at: Callable[[Result], Result], env: Env,  # noqa: C901
                    keys: list[EastType | None]) -> Shape | None:
        """One step of an update's path on a value: ``.name``, ``.[k]``, ``.[a:b]`` or ``.[]``."""
        failed = Result(ERROR, ONE)

        def whole(whole_result: Result) -> Result:  # noqa: C901
            member = whole_result.shape
            assert isinstance(member, TypeShape)
            t = unwrap(member.type)
            unchanged = Result(member, ONE)

            def done(type_: EastType) -> Result:
                return Result(typed(_rewrap(member.type, type_)), ONE)

            # A position's new value, and how many it has.
            def replace_at(old: EastType, facts: Facts | None) -> tuple[EastType, Mult] | None:
                r = at(Result(typed(old, facts), ONE))
                new_type = self.collect(r, self.range(path))
                return None if new_type is None else (new_type, r.mult)

            v = step.value
            optional = v["optional"]
            literal_name = self.literal(v["index"].value) \
                if step.type == "index" and v["index"].type == "literal" and t.type != "Dict" else None
            if step.type == "field":
                name = v["name"]
            elif literal_name is not None and literal_name.type.type == "String":
                name = literal_name.value
            else:
                name = None
            facts_of = member.facts
            if name is not None:
                payload = nullable_payload(t)
                if payload is not None:
                    # An option: `null` is updated as null is, and a value as it is; the two must share a type.
                    present = facts_of.payload if facts_of is not None and facts_of.kind == "present" else None
                    when_null = self.assign_step(Result(typed(NullType), ONE), step, path, at, env, keys)
                    when_some = self.assign_step(Result(typed(payload, present), ONE), step, path, at, env, keys)
                    a = None if when_null is None else unify_shape(when_null)
                    b = None if when_some is None else unify_shape(when_some)
                    if a is None or b is None:
                        return failed
                    merged = unify(a, b)
                    if merged is None:
                        return self.fail(self.range(path), "ambiguous_output",
                                         MESSAGES.no_common_type(describe_type(a), describe_type(b)))
                    return done(merged)
                if t.type == "Struct":
                    fields = dict(fields_of(t))
                    facts = facts_of.fields.get(name) if facts_of is not None and facts_of.kind == "fields" else None
                    nxt = replace_at(fields.get(name, NullType), facts)
                    if nxt is None:
                        return failed
                    # An update that never gives a value deletes the field, as jq deletes the key.
                    if nxt[1].hi == 0:
                        fields.pop(name, None)
                    else:
                        fields[name] = nxt[0]
                    return done(StructType(list(fields.items())))
                if t.type == "Null":
                    nxt = replace_at(NullType, None)
                    if nxt is None:
                        return failed
                    return unchanged if nxt[1].hi == 0 else done(StructType([(name, nxt[0])]))
                if t.type == "Dict" and unwrap(dict_key(t)).type == "String":
                    old_or_null = or_null(dict_value(t))
                    nxt = replace_at(dict_value(t) if old_or_null is None else old_or_null, None)
                    if nxt is None:
                        return failed
                    merged = unify(dict_value(t), nxt[0])
                    if merged is None:
                        return self.fail(self.range(path), "ambiguous_output",
                                         MESSAGES.no_common_type(describe_type(dict_value(t)), describe_type(nxt[0])))
                    return done(DictType(dict_key(t), merged))
                # A variant's payload, in each case it can hold here; its case's name is its type.
                if t.type == "Variant" and nullable_payload(t) is None and name in ("value", "type"):
                    if name == "type":
                        return self.fail(self.range(path), "unsupported", MESSAGES.unavailable(
                            f"assigning to {self.source(path)}", "a variant's case is its type; build the new value instead"))
                    cases = cases_of(t, facts_of)
                    payloads = dict(cases_of_type(t))
                    facts = facts_of.payload if facts_of is not None and facts_of.kind == "cases" and len(cases) == 1 \
                        else None
                    for c in cases:
                        nxt = replace_at(payloads[c], facts)
                        if nxt is None:
                            return failed
                        # A payload cannot be deleted: with no value, it keeps its type, and the update raises there.
                        if nxt[1].hi != 0:
                            payloads[c] = nxt[0]
                    self.updated_cases[f"{env.instance}|{path}|{print_type(t)}"] = cases
                    return done(VariantType(list(payloads.items())))
                if optional:
                    return unchanged
                return self.mismatch(env, self.range(path), "type_mismatch",
                                     MESSAGES.not_a_field(f".{name}", describe_type(member.type)))
            if step.type == "index":
                key_path = child_path(path, "index.index")
                key_type = keys[0]
                assert key_type is not None
                if t.type == "Array":
                    if not self.key_fits(key_type, IntegerType, v["index"], key_path, env):
                        return self.mismatch(env, self.range(key_path), "type_mismatch", MESSAGES.key_type(
                            ".[…]", "Integer", self.source(key_path), describe_type(key_type)))
                    # The element itself: an index past the end is an error, where jq pads with nulls.
                    nxt = replace_at(t.value, facts_of.element if facts_of is not None and facts_of.kind == "elements"
                                     else None)
                    if nxt is None:
                        return failed
                    merged = unify(t.value, nxt[0])
                    if merged is None:
                        return self.fail(self.range(path), "ambiguous_output",
                                         MESSAGES.no_common_type(describe_type(t.value), describe_type(nxt[0])))
                    return done(ArrayType(merged))
                if t.type == "Dict" or (t.type == "Struct" and len(t.value) == 0) or t.type == "Null":
                    the_key = dict_key(t) if t.type == "Dict" else key_type
                    the_value = dict_value(t) if t.type == "Dict" else NeverType
                    if not self.key_fits(key_type, the_key, v["index"], key_path, env):
                        return self.mismatch(env, self.range(key_path), "type_mismatch", MESSAGES.key_type(
                            ".[…]", describe_type(the_key), self.source(key_path), describe_type(key_type)))
                    if not is_immutable_type(the_key):
                        return self.fail(self.range(key_path), "type_mismatch",
                                         MESSAGES.mutable_key(self.source(key_path), describe_type(the_key)))
                    value_or_null = or_null(the_value)
                    old = NullType if the_value.type == "Never" else (
                        the_value if value_or_null is None else value_or_null)
                    nxt = replace_at(old, None)
                    if nxt is None:
                        return failed
                    merged = unify(the_value, nxt[0])
                    if merged is None:
                        return self.fail(self.range(path), "ambiguous_output",
                                         MESSAGES.no_common_type(describe_type(the_value), describe_type(nxt[0])))
                    return done(DictType(the_key, merged))
                if optional:
                    return unchanged
                return self.mismatch(env, self.range(path), "not_indexable", MESSAGES.not_indexable(
                    self.source(child_path(path, "index.target")) or ".", describe_type(member.type)))
            if step.type == "slice":
                # The slice's new value is an array, spliced in its place; none deletes the slice.
                if t.type in ("Array", "Null"):
                    nxt = replace_at(t, facts_of) if t.type == "Array" else replace_at(NullType, None)
                    if nxt is None:
                        return failed
                    if nxt[1].hi == 0:
                        return unchanged
                    given = unwrap(nxt[0])
                    if given.type != "Array":
                        return self.mismatch(env, self.range(path), "type_mismatch",
                                             MESSAGES.slice_update(self.source(path), describe_type(nxt[0])))
                    # `null`'s slice is null, so the array the update gives is the value, or null where it gives none.
                    if t.type == "Null":
                        return done(nxt[0] if nxt[1].lo == 1 else or_null(nxt[0]))  # type: ignore[arg-type]
                    merged = unify(t.value, given.value)
                    if merged is None:
                        return self.fail(self.range(path), "ambiguous_output",
                                         MESSAGES.no_common_type(describe_type(t), describe_type(nxt[0])))
                    return done(ArrayType(merged))
                if optional:
                    return unchanged
                if t.type == "String":
                    return self.mismatch(env, self.range(path), "type_mismatch", MESSAGES.string_slice(self.source(path)))
                return self.mismatch(env, self.range(path), "not_indexable", MESSAGES.not_indexable(
                    self.source(child_path(path, "slice.target")) or ".", describe_type(member.type)))
            # `.[]`: every element; an element with no value is deleted.
            if t.type == "Array":
                nxt = replace_at(t.value, facts_of.element if facts_of is not None and facts_of.kind == "elements"
                                 else None)
                return failed if nxt is None else done(ArrayType(nxt[0]))
            if t.type == "Dict":
                nxt = replace_at(dict_value(t), facts_of.value if facts_of is not None and facts_of.kind == "values"
                                 else None)
                return failed if nxt is None else done(DictType(dict_key(t), nxt[0]))
            if t.type == "Struct":
                known = facts_of.fields if facts_of is not None and facts_of.kind == "fields" else None
                fields_out: list[tuple[str, EastType]] = []
                for field_name, f in fields_of(t).items():
                    nxt = replace_at(f, None if known is None else known.get(field_name))
                    if nxt is None:
                        return failed
                    if nxt[1].hi != 0:
                        fields_out.append((field_name, nxt[0]))
                return done(StructType(fields_out))
            if optional:
                return unchanged
            return self.mismatch(env, self.range(path), "not_iterable",
                                 MESSAGES.not_iterable(".[]", describe_type(member.type)))

        assigned = self.assign(current.shape, _IDENTITY, path, whole, env)
        return None if assigned is None else assigned.shape

    def assign_walk(self, shape: TypeShape, child: tuple[JqNode, str] | None, path: str,
                    at: Callable[[Result], Result], env: Env) -> _Assigned | None:
        """``..``, ``recurse`` or ``recurse(.a[])`` in an update's path: each value walked is a position."""
        span = self.range(path)
        steps = None if child is None else walk_steps(child[0])
        if child is not None and steps is None:
            self.fail(span, "unsupported", MESSAGES.unavailable(
                f"assigning through recurse({self.source(child[1])})",
                "an update's recurse walks .[], or field reads then .[], as recurse(.children[])"))
            return None
        # The kinds of position the walk visits.
        kinds: list[EastType] = []
        problem = [False]

        def visit(t: EastType) -> None:
            if problem[0] or any(type_equal(k, t) for k in kinds):
                return
            kinds.append(t)
            inner = self.walk_kinds(t, path) if child is None else self.step_kinds(t, child, env)
            if inner is None:
                problem[0] = True
                return
            for i in inner:
                visit(i)

        visit(shape.type)
        if problem[0]:
            return None
        root: Mult = ONE
        for kind in kinds:
            r = at(Result(typed(kind), ONE))
            if r.shape.kind == "error":
                return None
            t = self.collect(r, span)
            if t is None:
                return None
            if t.type != "Never" and not _same_type(kind, t):
                self.fail(span, "type_mismatch",
                          MESSAGES.walk_update(self.source(path), describe_type(kind), describe_type(t)))
                return None
            if kind is kinds[0]:
                root = r.mult
        return _Assigned(typed(shape.type), root)

    def walk_kinds(self, type_: EastType, path: str) -> list[EastType] | None:
        """The kinds of position ``..`` finds directly inside a value in an update."""
        u = unwrap(type_)
        payload = nullable_payload(u)
        t = u if payload is None else unwrap(payload)
        if t.type in ("Array", "Set"):
            return [t.value]
        if t.type == "Dict":
            return [dict_value(t)]
        if t.type == "Struct":
            return list(fields_of(t).values())
        if t.type == "Variant":
            return list(cases_of_type(t).values())
        if t.type in ("Vector", "Matrix"):
            self.fail(self.range(path), "unsupported", MESSAGES.unavailable(
                f"assigning through {self.source(path)}",
                f"it would walk {describe_type(t)}, whose elements an update does not rebuild"))
            return None
        return []

    def step_kinds(self, type_: EastType, child: tuple[JqNode, str], env: Env) -> list[EastType] | None:
        """The kinds of position ``recurse(f)`` finds from a value: ``f``'s outputs on it, checked as a read."""
        r = self.check(child[0], child[1], Result(typed(type_), ONE), env)
        if r.shape.kind == "error":
            return None
        return [m.shape.type for m in members_of(r.shape)]

    def retype(self, path: str, instance: str, input_: EastType) -> str | None:
        """Checks a node again on another input, in a new instance."""
        env = self.scopes.get(f"{instance}|{path}")
        n = self.nodes.get(path)
        if env is None or n is None:
            return None
        self._retypes += 1
        nxt = f"{instance}~{self._retypes}"
        reported = len(self.diagnostics)
        result = self.check(n, path, Result(typed(input_), ONE), replace(env, instance=nxt))
        failed = result.shape.kind == "error" or any(d["severity"].type == "error" for d in self.diagnostics[reported:])
        # The program was checked already; what this finds is the translator's to act on, not the author's.
        del self.diagnostics[reported:]
        return None if failed else nxt


def _fix(edits: list[tuple[str, int, int]], label: str) -> EastStruct:
    """A fix of several edits, each ``(insert, length, offset)``."""
    return EastStruct({
        "edits": [EastStruct({"insert": insert, "length": length, "offset": offset}) for insert, length, offset in edits],
        "label": label,
    })


def _fields_side_by_side(n: JqNode) -> list[str] | None:
    """The field names of outputs that are field reads side by side, ``.a, .b``."""
    if n.type == "comma":
        left = _fields_side_by_side(n.value["left"])
        right = _fields_side_by_side(n.value["right"])
        return None if left is None or right is None else [*left, *right]
    if n.type == "field" and n.value["target"].type == "identity" and not n.value["optional"] \
            and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", n.value["name"]):
        return [n.value["name"]]
    return None


# The steps that lead to a node where a pipe can start without parentheses.
_PIPE_POSITION = re.compile(
    r"(?:^|\.)(?:pipe\.(?:left|right)|call\.args\[\d+\]|array\.some|bind\.body|label\.body|def\.(?:body|rest)"
    r"|if\.branches\[\d+\]\.(?:condition|then)|if\.otherwise\.some|object\[\d+\]\.value\.some|reduce\.update"
    r"|foreach\.update|foreach\.extract\.some|try\.catch\.some)\Z", re.ASCII)


def _is_pipe_position(path: str) -> bool:
    """Whether a node at a path can have ``f | `` put before it without parentheses."""
    return path == "" or _PIPE_POSITION.search(path) is not None


def _any_instance(records: dict[str, Any], path: str, instance: str | None) -> Any:
    """A node's record in an instance; with none given, outside every def, or else the first instance checked."""
    if instance is not None:
        return records.get(f"{instance}|{path}")
    outside = records.get(f"|{path}")
    if outside is not None:
        return outside
    suffix = f"|{path}"
    for key, value in records.items():
        if key.endswith(suffix) and key[:len(key) - len(path) - 1].startswith(">"):
            return value
    return None


def _breaks_to(n: JqNode, name: str) -> bool:
    """Whether a ``break $name`` for a label is in a node, outside any label of the same name inside it."""
    if n.type == "break":
        return n.value == name
    if n.type == "label" and n.value["name"] == name:
        return False
    return any(child.node is not None and _breaks_to(child.node, name) for child in jq_children(n))


def _spine(n: JqNode, path: str) -> list[tuple[JqNode, str]]:
    """The top-level pipeline's stages: its segments, through the bodies of the ``as`` that lead it."""
    if n.type == "pipe":
        return [(n.value["left"], child_path(path, "pipe.left")), *_spine(n.value["right"], child_path(path, "pipe.right"))]
    if n.type == "bind":
        return _spine(n.value["body"], child_path(path, "bind.body"))
    return [(n, path)]


def check_jq(program: str | ParsedJq, input_type: EastType, *, root: bool = False,
             tooling: bool = False) -> CheckJqResult:
    """Checks a jq program against the East type of its input.

    The checker types every node over East types as ``QUERY.md`` says: it
    narrows variants through ``select`` and ``if``, infers ``reduce`` and
    ``foreach`` accumulators and recursive ``def``s by fixpoint, and reads a
    literal as the type it is used as (an Integer where a Float is, an
    ISO-8601 string where a DateTime is), reporting a string that is not a
    date or a ``strftime`` format East has no token for. It rewrites nothing:
    the translator gives each value from the types it reads (#1138). A
    problem is a diagnostic with its span, one sentence, suggestions and
    fixes; lints are warnings. ``program`` is present exactly when no
    diagnostic is an error, and with ``input_type``, ``element_type`` and
    ``multiplicity`` it is what every reader of the query — the translator, a
    host — works from.

    Args:
        program: The program's text, or what ``parse_jq`` made of it.
        input_type: The type the program runs on.
        root: The input is an e3 root: a struct of datasets, read one field at a time.
        tooling: Allow the tooling-only builtins ``signature``, ``source``, ``calls`` and ``captures``.

    Returns:
        The program as written when there is no error, the type it was
        checked against, the element type and multiplicity, the root fields
        read, the stages, and the diagnostics.

    Example:
        >>> Order = StructType([("id", IntegerType), ("total", FloatType)])
        >>> check_jq(".orders | map(.total) | add", StructType([("orders", ArrayType(Order))])).multiplicity
        'one'
    """
    parsed = parse_jq(program) if isinstance(program, str) else program
    units = parsed.units
    source = CheckedSource(parsed.text, units, parsed.spans, root)
    if parsed.program.type == "none":
        return CheckJqResult(None, input_type, None, None, [], [], list(parsed.diagnostics), source)
    tree = parsed.program.value
    checker = _Checker(units, parsed.spans, root, tooling, input_type)
    env = Env({}, {}, frozenset(), "", False)
    start = Result(typed(input_type), ONE)
    result = checker.check(tree, "", start, env)
    if root and isinstance(result.shape, TypeShape) and checker.is_root_shape(result.shape):
        checker.refuse_root(result, "", env)
    element_type = None if result.shape.kind == "error" else checker.collect(result, parsed.spans.get(""), "")
    multiplicity = wire_multiplicity(result.mult)

    # The stages of the top-level pipeline.
    stages: list[CheckedStage] = []
    cumulative = ONE
    for stage_node, stage_path in _spine(tree, ""):
        record = checker.records.get(f"|{stage_path}")
        span = parsed.spans.get(stage_path)
        if record is None or span is None:
            break
        cumulative = piped(cumulative, record.mult)
        stage_type = unify_shape(record.shape)
        if stage_type is None:
            break
        stages.append(CheckedStage(stage_path, span.from_, span.to, stage_type, wire_multiplicity(cumulative)))
        del stage_node

    errors = any(d["severity"].type == "error" for d in checker.diagnostics)
    checks = not errors and element_type is not None
    return CheckJqResult(
        program=tree if checks else None,
        input_type=input_type,
        element_type=element_type if checks else None,
        multiplicity=multiplicity if checks else None,
        reads=checker.reads,
        stages=stages,
        diagnostics=checker.diagnostics,
        source=source,
        _checker=checker,
    )


__all__ = [
    "CallContext", "CheckJqResult", "CheckedNode", "CheckedSource", "CheckedStage", "Env", "LiteralValue", "Scope",
    "UPDATE_SELECTORS", "check_jq", "is_jq_builtin", "walk_steps",
]
