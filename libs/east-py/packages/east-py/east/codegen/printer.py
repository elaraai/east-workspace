#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The IR → python printer (#627): ``to_python_source``.

The printer walks an IR value and writes a python module whose
``East.function(...)`` rebuilds the same IR. Its spellings are the
statement surface's (``east.expression.statements`` — the block ``b`` a
body receives, python's ``$``) and the builtin table's
(``east.codegen.spellings``):

- a Function/AsyncFunction is a decorated ``def`` taking the block first —
  ``@East.function([types], out) def _fN(b, params)`` (the root carries
  ``cse=False``); a nested function is an expression of the enclosing body,
  as in TypeScript — ``East.function([types], out, lambda b, …: expr)`` when
  its body is one expression, else a decorated ``def _fN`` defined just
  before the statement that uses it;
- a Block is that def's statements; the block's last node prints as
  ``return <expr>`` when it is an expression, or as the statement it is;
- Let/Assign/Return/Break/Continue/Error, a Null-typed IfElse/Match/While/
  For/TryCatch, print as ``b.let`` / ``b.assign`` / ``b.if_(...).else_if(...)
  .else_(...)`` / … whose bodies are ``lambda b, …: <one statement>`` when
  they hold one statement and ``def _bN(b, …)`` helpers defined just before
  the statement that uses them otherwise;
- every other node prints as an expression: literals as python literals,
  Struct/Variant/NewArray/NewDict as the python literal — printed by
  ``literal_for(T)``, a factory over the type (as ``compare_for`` is) under
  which a construction nested anywhere prints bare (a dict literal only
  when python can hash its keys, i.e. they are literals; a set keeps
  ``East.new_set`` — a python set literal loses the element order), an
  Option case as ``some(v)`` / ``none`` — bare wherever the surface types
  the position (a binding, ``x = b.let({1: 'a'}, T)``; an assignment or a
  ``b.return_``; a declared return) or the literal types itself (a method's
  argument or a callback returning ``{"a": x}`` — the builder lifts it to
  that struct), and through ``East.value(..., T)`` only where the type
  would otherwise be lost (``none``, an empty collection, a general
  ``variant`` in a callback's return or a method's slot) — an expression
  IfElse/Match/TryCatch through
  ``East.if_else`` / ``.match({...})`` / ``East.try_catch``, the match
  ``unwrap`` lowers to as ``.unwrap()`` / ``.unwrap("case")``, a Builtin
  through its spelling row (callbacks as ``lambda b, …: …``, or ``def
  _bN(b, …)`` helpers when they hold statements — every body takes the
  block first) or the raw ``East.builtin(name, [T...], [args], out)``; an
  unresolved cross-language import (the ``east.importFunction`` Platform
  node, #628) through ``East.import_function(pkg, name, T)``.

Variables keep their IR names when they are python identifiers — the
authoring names both builders carry (#639) and TypeScript's ``_N`` for a
slot the body did not name; the python builder's own ``__nN`` and a name
the module already uses are renamed ``v_N``, numbered once per module
(above any ``v_N`` the IR holds) so a printed module rebuilds to itself;
``b`` is reserved for the block (a parameter the author named ``b`` prints
as ``b_``). Every type prints inline where it is used (``b.let({1: 'a'},
DictType(IntegerType, StringType))``, as an author writes it); a recursive
type is hoisted to a module constant ``_tN`` (deduplicated structurally).
A platform call hoists to a module-level declaration named after the
platform function (``tar_create = East.asyncPlatform('tar_create', …)``;
``my.log`` is ``my_log``; a second signature under one name takes a ``_2``
suffix; ``_pN`` when the name cannot be an identifier), one per distinct
signature — a body variable of that name is renamed ``v_N`` so it never
shadows the declaration. A function called where it stands — the ``Call`` of a Function literal a
TypeScript artifact leaves at its call site — prints inline,
``East.function(...)(x)``: a python artifact called inside another body
SPLICES its body into the caller (#470) rather than emitting a ``Call``, so
a module-level ``def`` would not rebuild it (the TypeScript printer hoists
one to ``_fN``). Deep expression nesting is broken with ``_eN = <expr>``
temporaries, so any IR width or depth prints to parseable python.

The source is written as a layout document (``east.codegen.doc``) and
laid out as black lays python out: a literal, an argument list or a type
breaks one entry per line when the line it sits on would pass
``LINE_WIDTH``, a call hugs a sole literal argument (``StructType([``
stays on its line, the entries break inside), and a chain of three or
more calls that does not fit prints one call per line — in parentheses
when it is what a ``return`` returns.
"""

from __future__ import annotations

import keyword
import math
import re
from datetime import datetime
from typing import Any

from east.codegen.doc import (
    LINE_WIDTH,
    Doc,
    bracket,
    call_args,
    choice,
    group,
    hardline,
    hug,
    if_break,
    indent,
    join,
    line,
    render,
    softline,
    will_break,
)
from east.codegen.spellings import spelling_for
from east.codegen.types import TYPE_IMPORTS, type_constructors, type_doc, type_key
from east.functions import IMPORT_PLATFORM
from east.types.types import EastType
from east.types.values import EastVariant

__all__ = ["to_python_source", "Unprintable"]


class Unprintable(ValueError):
    """The IR holds a shape the python surface cannot spell; the message
    names the node kind (and builtin) and where it sits."""


_STATEMENT_KINDS = frozenset({
    "Let", "Assign", "Return", "Break", "Continue", "While", "ForArray", "ForSet", "ForDict",
})
#: The node kinds a python literal spells (a Set keeps ``East.new_set``).
_CONSTRUCTIONS = frozenset({"Struct", "Variant", "NewArray", "NewDict"})
_MAX_DEPTH = 24
#: The block parameter every statement-bearing body declares first.
_BLOCK = "b"
#: The names a printed module imports or binds at module level besides the declarations — never a declaration's name.
_MODULE_NAMES = frozenset({"East", "variant", "some", "none", "east_null", "recursive_type", "datetime", "timezone",
                           *TYPE_IMPORTS})
#: The printer's own spelling for a variable it cannot name as the IR does.
_V_NAME = re.compile(r"v_(\d+)")
#: A template slot: an argument or a type parameter.
_SLOT = re.compile(r"\{(T\d+|\d+)\}")
#: A template head that is a method on a slot: ``{0}.map``.
_METHOD_HEAD = re.compile(r"^\{(\d+)\}\.([A-Za-z_]\w*)$")
#: An operator template: ``({0} + {1})`` / ``(-{0})``.
_BINARY = re.compile(r"^\(\{(\d+)\} (\S+) \{(\d+)\}\)$")
_UNARY = re.compile(r"^\((\S+?)\{(\d+)\}\)$")
#: python's operator precedence, low to high, for the operator rows: a
#: comparison (which python chains, so its operands keep their parentheses),
#: the bitwise operators, the arithmetic ones, the unary ones.
_PRECEDENCE = {
    "==": 1, "!=": 1, "<": 1, "<=": 1, ">": 1, ">=": 1,
    "|": 2, "^": 3, "&": 4, "+": 5, "-": 5, "*": 6, "/": 6,
}
_UNARY_LEVEL = 7
#: the levels whose operators are left-associative and safe to run on in one chain
_CHAINABLE = frozenset({2, 3, 4, 5, 6})


def _ident(name: str) -> bool:
    return name.isidentifier() and not keyword.iskeyword(name)


def _is_null_value(node: Any) -> bool:
    return node.type == "Value" and node.value["type"].type == "Null"


def _is_option_type(t: EastType) -> bool:
    """The exact Option shape, ``Variant{none: Null, some: T}`` — the TypeScript
    printer's ``isOptionValue``."""
    if t.type != "Variant" or len(t.value) != 2:
        return False
    cases = list(t.value)
    return (cases[0]["name"] == "none" and cases[0]["type"].type == "Null"
            and cases[1]["name"] == "some")


def _unwrap_case(p: Any) -> str | None:
    """The case an ``unwrap`` lowers to — a Match whose one arm returns its
    own variable and whose every other arm errors ``Variant does not have
    case <that case>``; both surfaces lower ``v.unwrap(tag)`` to exactly
    this — or ``None`` for any other match."""
    cases = list(p["cases"])
    returned = [c for c in cases
                if c["body"].type == "Variable" and c["body"].value["name"] == c["variable"].value["name"]]
    if len(returned) != 1:
        return None
    tag = returned[0]["case"]
    for c in cases:
        if c is returned[0]:
            continue
        body = c["body"]
        if body.type != "Error":
            return None
        message = body.value["message"]
        if message.type != "Value" or message.value["value"].type != "String":
            return None
        if message.value["value"].value != f"Variant does not have case {tag}":
            return None
    return tag


def _self_typing(node: Any) -> bool:
    """Whether a construction lifts on its own when it stands bare in a
    position the builder types from the value (a callback's return, a
    method's argument): a scalar or an expression, and a struct of such (a
    dict literal lifts to that struct). A python list or dict has no
    element type of its own (``_lift`` refuses one without a hint), and a
    variant (``some(x)`` alone is a one-case variant; ``none`` has no
    payload type) needs its cases — those print through ``East.value(v,
    T)``."""
    kind = node.type
    if kind == "Struct":
        return all(_self_typing(f["value"]) for f in node.value["fields"])
    # a literal or an expression carries its type; a variant, a collection, a ref, a function do not
    return kind not in ("Variant", "NewArray", "NewDict", "NewSet", "NewRef", "NewVector", "NewMatrix",
                        "Function", "AsyncFunction", "Error")


def _pyliteral(value: Any) -> str:
    """A python literal for an East scalar value."""
    if isinstance(value, bool):
        return "True" if value else "False"
    if isinstance(value, int):
        return repr(value)
    if isinstance(value, float):
        if math.isnan(value):
            return 'float("nan")'
        if math.isinf(value):
            return 'float("inf")' if value > 0 else '-float("inf")'
        return repr(value)
    if isinstance(value, str):
        return repr(value)
    if isinstance(value, (bytes, bytearray)):
        return repr(bytes(value))
    if isinstance(value, datetime):
        us = value.microsecond
        parts = [value.year, value.month, value.day, value.hour, value.minute, value.second]
        if us:
            parts.append(us)
        return f"datetime({', '.join(str(p) for p in parts)}, tzinfo=timezone.utc)"
    raise Unprintable(f"literal of python type {type(value).__name__}")


class _Scope:
    """Names in one python function: IR variable name → python identifier."""

    __slots__ = ("names", "parent", "used")

    def __init__(self, parent: _Scope | None) -> None:
        self.names: dict[str, str] = {}
        self.parent = parent
        self.used: set[str] = set(parent.used) if parent else {_BLOCK}

    def lookup(self, ir_name: str) -> str | None:
        scope: _Scope | None = self
        while scope is not None:
            hit = scope.names.get(ir_name)
            if hit is not None:
                return hit
            scope = scope.parent
        return None


def _has_statements(body: Any) -> bool:
    """Whether a function-mode body needs a block: a Block, a statement
    node, or a statement-typed branch/loop/try at the root."""
    return body.type == "Block" or body.type in _STATEMENT_KINDS or body.type == "Error" or (
        body.type in ("IfElse", "Match", "TryCatch") and body.value["type"].type in ("Null", "Never")
    )


def _def(name: str, names: list[str], lines: list[Doc], decorator: Doc | None = None) -> Doc:
    """A ``def name(names): lines`` — a group, so its statements lay out in
    their own right wherever the def sits."""
    head: list[Doc] = [] if decorator is None else [decorator, hardline]
    return group([*head, f"def {name}({', '.join(names)}):", indent([hardline, join(hardline, lines)])])


def _parse_call_template(template: str) -> tuple[str, list[str]] | None:
    """A spelling template split into its call shape — the head before the
    argument list and the argument templates — or ``None`` when the
    template is not ``head(args)``."""
    if not template.endswith(")"):
        return None
    depth = 0
    for i in range(len(template) - 1, -1, -1):
        ch = template[i]
        if ch == ")":
            depth += 1
        elif ch == "(":
            depth -= 1
            if depth == 0:
                head = template[:i]
                return None if head == "" else (head, _split_args(template[i + 1:-1]))
    return None


def _split_args(inner: str) -> list[str]:
    """The top-level comma-separated pieces of an argument-list template."""
    if not inner.strip():
        return []
    args: list[str] = []
    depth = 0
    start = 0
    for i, ch in enumerate(inner):
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
        elif ch == "," and depth == 0:
            args.append(inner[start:i].strip())
            start = i + 1
    args.append(inner[start:].strip())
    return args


def _fill(text: str, slot: Any) -> Doc:
    """``text`` with every slot replaced by ``slot(name)``; a lone slot is the
    slot's document itself."""
    parts: list[Doc] = []
    last = 0
    for m in _SLOT.finditer(text):
        if m.start() > last:
            parts.append(text[last:m.start()])
        parts.append(slot(m.group(1)))
        last = m.end()
    if last < len(text):
        parts.append(text[last:])
    return parts[0] if len(parts) == 1 else parts


class _Printer:
    def __init__(self, root_name: str, width: float) -> None:
        self.root_name = root_name
        self.width = width
        self.types: dict[str, tuple[str, Doc]] = {}     # type key -> (const name, source)
        self.literals: dict[str, Any] = {}               # type key -> its host-literal printer
        self.platforms: dict[tuple, str] = {}             # signature -> declaration name
        self.platform_decls: list[Doc] = []
        #: the declaration names taken, and the module-level names a body variable must not shadow
        self.platform_names: set[str] = set()
        self.reserved: set[str] = set()
        #: method-call documents (by id) -> (receiver, segments, the document itself, kept alive)
        self.chains: dict[int, tuple[Doc, list[Doc], Doc]] = {}
        #: the chain documents that may expand one call per line (need parentheses after ``return``)
        self.expandable: set[int] = set()
        #: operator documents (by id) -> (precedence level, the run of operands and operators, the
        #: run's document without its parentheses, the document itself, kept alive)
        self.operators: dict[int, tuple[int, list[Doc], Doc, Doc]] = {}
        self.helper_counter = 0
        self.temp_counter = 0
        self.var_counter = 0
        self.raw_builtins: set[str] = set()
        self.uses_datetime = False
        #: the names the printed module imports from ``east`` — exactly the ones it uses
        self.used: set[str] = {"East"}

    # ── module-level pieces ──────────────────────────────────────────────

    def type_ref(self, t: EastType) -> Doc:
        """A type as source, inline; a recursive type hoisted to a ``_tN``
        constant."""
        type_constructors(t, self.used)
        if t.type in ("Null", "Never", "Boolean", "Integer", "Float", "String", "DateTime", "Blob"):
            return type_doc(t)
        key = type_key(t)
        if "recursive_type(" not in key and "Recursive" not in key:
            return type_doc(t)
        hit = self.types.get(key)
        if hit is None:
            name = f"_t{len(self.types)}"
            self.types[key] = (name, type_doc(t))
            return name
        return hit[0]

    @staticmethod
    def platform_signature(p: Any) -> tuple:
        """The signature a hoisted declaration is deduplicated by."""
        inputs = tuple(type_key(a.value["type"]) for a in p["arguments"])
        tps = tuple(type_key(t) for t in p["type_parameters"])
        return (p["name"], inputs, type_key(p["type"]), bool(p["async"]), bool(p["optional"]), tps)

    def platform_name(self, ir_name: str) -> str:
        """The module-level name of a hoisted declaration: the platform
        function's own name as an identifier (``tar_create``; ``my.log`` is
        ``my_log``), a ``_2``, ``_3``… suffix when another signature already
        took it, ``_pN`` when the name cannot be one."""
        base = re.sub(r"\W", "_", ir_name)
        if not re.match(r"[A-Za-z_]", base):
            base = f"_{base}"
        if not _ident(base) or base in _MODULE_NAMES or base == self.root_name:
            base = f"_p{len(self.platform_names)}"
        name = base
        n = 1
        while name in self.platform_names:
            n += 1
            name = f"{base}_{n}"
        self.platform_names.add(name)
        return name

    def prepare(self, ir: Any) -> None:
        """Fix the declarations' names before any body prints (by signature,
        in IR order), so a variable a body binds never shadows one."""
        from east.expression.finalize import _node_children

        stack = [ir]
        while stack:
            n = stack.pop()
            if n.type == "Platform":
                p = n.value
                args = list(p["arguments"])
                is_import = p["name"] == IMPORT_PLATFORM and len(args) == 2 and all(a.type == "Value" for a in args)
                if not is_import:
                    sig = self.platform_signature(p)
                    if sig not in self.platforms:
                        name = self.platform_name(p["name"])
                        self.platforms[sig] = name
                        self.reserved.add(name)
            stack.extend(reversed(list(_node_children(n))))

    def platform_ref(self, p: Any) -> str:
        sig = self.platform_signature(p)
        name = self.platforms.get(sig)
        if name is None:
            name = self.platform_name(p["name"])
            self.platforms[sig] = name
        if any(isinstance(d, list) and d and d[0] == name for d in self.platform_decls):
            return name
        tps = list(p["type_parameters"])
        args = bracket("[", [self.type_ref(a.value["type"]) for a in p["arguments"]], "]")
        opt: list[Doc] = ["optional=True"] if p["optional"] else []
        if tps:
            # A generic call: the concrete type arguments are all the node
            # records, so the declaration is spelled with placeholders for
            # them in order and the inputs/output as the call has them.
            params = bracket("[", [repr(f"T{i}") for i in range(len(tps))], "]")
            decl = "East.asyncGenericPlatform" if p["async"] else "East.genericPlatform"
            self.platform_decls.append(
                [name, " = ", decl, call_args([repr(p["name"]), params, args, self.type_ref(p["type"]), *opt])])
        else:
            decl = "East.asyncPlatform" if p["async"] else "East.platform"
            self.platform_decls.append(
                [name, " = ", decl, call_args([repr(p["name"]), args, self.type_ref(p["type"]), *opt])])
        return name

    def fresh_helper(self, prefix: str) -> str:
        self.helper_counter += 1
        return f"_{prefix}{self.helper_counter}"


    def method_call(self, receiver: Doc, name: str, args: list[Doc]) -> Doc:
        """``receiver.name(args)``: a segment of the member chain ``receiver``
        ends (when it is one) or starts. Three or more calls not rooted at
        the block print one call per line when they do not fit; a chain
        holding a ``def`` never does (one is never inside an expression)."""
        segment: Doc = [".", name, call_args(args)]
        prior = None if isinstance(receiver, str) else self.chains.get(id(receiver))
        root, segments = (prior[0], [*prior[1], segment]) if prior is not None else (receiver, [segment])
        doc: Doc
        if len(segments) < 3 or root == _BLOCK:
            doc = [root, *segments]
        else:
            one_line: Doc = [root, *segments]
            expanded = group([root, *[[hardline, s] for s in segments]])
            doc = expanded if any(will_break(s) for s in segments) else choice(one_line, expanded)
            self.expandable.add(id(doc))
        self.chains[id(doc)] = (root, segments, doc)
        return doc

    def returned(self, value: Doc) -> Doc:
        """``value`` as what a ``return`` returns: a chain that may expand
        one call per line is parenthesised when it does."""
        if id(value) not in self.expandable:
            return value
        return group([if_break("("), indent([softline, value]), softline, if_break(")")])

    # ── functions ────────────────────────────────────────────────────────

    def bind(self, scope: _Scope, var: Any) -> str:
        """Bind an IR Variable node in ``scope`` and return its python name."""
        ir_name = var.value["name"]
        py = ir_name if _ident(ir_name) and not ir_name.startswith("__") else None
        if py == _BLOCK and f"{py}_" not in scope.used:
            py = f"{py}_"  # the author's `b` is the block's name here
        if py is None or py in scope.used or py in self.reserved:
            # The builder's own spelling, or a name this scope already
            # uses: ``v_N`` from one module-wide counter, so the rebuilt
            # module names the slot the same way and prints to itself.
            py = f"v_{self.var_counter}"
            self.var_counter += 1
        scope.names[ir_name] = py
        scope.used.add(py)
        return py

    def function_def(self, node: Any, scope: _Scope, name: str, *,
                     consts: list | None = None, root: bool = False) -> Doc:
        """The decorated ``def name(b, params)`` of a Function /
        AsyncFunction node; ``consts`` are hoisted Lets printed first as the
        body's own bindings (a python artifact's captured constants)."""
        p = node.value
        fn_t = p["type"]
        inner = _Scope(scope)
        params = [self.bind(inner, v) for v in p["parameters"]]
        body: list[Doc] = []
        for let in consts or []:
            if let.type != "Let":
                raise Unprintable(f"{let.type} before the root function")
            body.extend(self.statement_lines(let, inner, last=False))
        # the declared output types what the body returns: a construction prints bare
        body.extend(self.body_lines(p["body"], inner, mode="function", typed=True))
        ctor = "East.asyncFunction" if node.type == "AsyncFunction" else "East.function"
        inputs = bracket("[", [self.type_ref(t) for t in fn_t.value["inputs"]], "]")
        out = self.type_ref(fn_t.value["output"])
        decorator: Doc = ["@", ctor, call_args([inputs, out, *(["cse=False"] if root else [])])]
        return _def(name, [_BLOCK, *params], body, decorator)

    def function_expr(self, node: Any, scope: _Scope, pre: list[Doc]) -> Doc:
        """A nested Function as an expression: ``East.function([types], out,
        lambda b, params: expr)`` when its body is one expression (as a
        callback prints); otherwise its decorated ``def _fN`` goes to
        ``pre`` and the expression is its name."""
        p = node.value
        if not _has_statements(p["body"]):
            inner = _Scope(scope)
            params = [self.bind(inner, v) for v in p["parameters"]]
            sub: list[Doc] = []
            text = self.value_doc(p["body"], inner, sub, 0, typed=True)
            if not sub:
                fn_t = p["type"]
                ctor = "East.asyncFunction" if node.type == "AsyncFunction" else "East.function"
                inputs = bracket("[", [self.type_ref(t) for t in fn_t.value["inputs"]], "]")
                out = self.type_ref(fn_t.value["output"])
                return [ctor, call_args([inputs, out, [f"lambda {', '.join([_BLOCK, *params])}: ", text]])]
        name = self.fresh_helper("f")
        pre.append(self.function_def(node, scope, name))
        return name

    @staticmethod
    def body_nodes(body: Any, *, mode: str) -> list[Any]:
        """The nodes a body prints. ``mode`` is ``"function"`` (an
        ``East.function`` / callback / ``East.block`` body: the last
        expression is ``return``ed) or ``"null"`` (a branch, loop, case, try,
        catch or finally body: the assembler pads a trailing non-Null
        statement with ``null``, so a trailing ``Value null`` after one is
        not printed — rebuilding restores it)."""
        nodes = list(body.value["statements"]) if body.type == "Block" else [body]
        if mode == "null" and len(nodes) > 1 and _is_null_value(nodes[-1]) \
                and nodes[-2].value["type"].type != "Null":
            nodes.pop()
        return nodes

    def body_lines(self, body: Any, scope: _Scope, *, mode: str, typed: bool = False) -> list[Doc]:
        """The statements of a body (a Block, or one node), one document
        each — ``pass`` when there are none. ``typed`` says the body's
        output is declared (an ``East.function``), so a returned
        construction prints bare; a callback's is inferred from what it
        returns."""
        nodes = self.body_nodes(body, mode=mode)
        lines: list[Doc] = []
        for i, node in enumerate(nodes):
            lines.extend(self.statement_lines(node, scope, last=i == len(nodes) - 1, typed=typed))
        if not lines:
            lines.append("pass")
        return lines

    def body_arg(self, body: Any, scope: _Scope, params: list[Any], pre: list[Doc],
                 label: str | None = None) -> Doc:
        """A branch/loop/handler body as the argument of its statement:
        ``lambda b, …: <statement>`` when it is one statement, else the
        name of a ``def _bN(b, …)`` helper appended to ``pre``."""
        inner = _Scope(scope)
        names = [_BLOCK, *(self.bind(inner, v) for v in params)]
        if label is not None:
            names.append(self.fresh_label(inner, label))
        nodes = self.body_nodes(body, mode="null")
        if not nodes:
            return f"lambda {', '.join(names)}: None"
        if len(nodes) == 1:
            sub: list[Doc] = []
            doc, lam = self.statement(nodes[0], inner, sub, last=True)
            if lam is not None and not sub:
                # One statement call, or one expression: a lambda. (A `x =
                # b.let(...)` line is an assignment and needs the def.)
                return [f"lambda {', '.join(names)}: ", lam]
            lines = [*sub, doc]
        else:
            lines = self.body_lines(body, inner, mode="null")
        name = self.fresh_helper("b")
        pre.append(_def(name, names, lines))
        return name

    def fresh_label(self, scope: _Scope, ir_label: str) -> str:
        py = "label"
        n = 0
        base = py
        while py in scope.used:
            n += 1
            py = f"{base}_{n}"
        scope.names["label:" + ir_label] = py
        scope.used.add(py)
        return py

    def label_ref(self, scope: _Scope, ir_label: str) -> str:
        hit = scope.lookup("label:" + ir_label)
        if hit is None:
            raise Unprintable(f"jump to a label ({ir_label!r}) no enclosing loop binds")
        return hit

    # ── statements ───────────────────────────────────────────────────────

    def statement_lines(self, node: Any, scope: _Scope, *, last: bool, typed: bool = False) -> list[Doc]:
        """A node in statement position, its helpers first."""
        pre: list[Doc] = []
        doc, _ = self.statement(node, scope, pre, last=last, typed=typed)
        return [*pre, doc]

    def statement(self, node: Any, scope: _Scope, pre: list[Doc], *, last: bool,
                  typed: bool = False) -> tuple[Doc, Doc | None]:
        """A node in statement position: its document, and — when the
        statement is one expression a lambda can return (a ``b.`` form, a
        returned expression; never a binding) — that expression. ``typed``
        says a last expression is returned under a declared type."""
        kind = node.type
        p = node.value
        if kind == "Let":
            var_t = p["variable"].value["type"]
            typed: Doc | None = None if type_key(var_t) == type_key(p["value"].value["type"]) \
                else self.type_ref(var_t)
            # A bound construction is the python literal with the type on the
            # binding (`x = b.let({1: 'a'}, T)`), as the surface is written; a
            # scalar literal needs no type (`b.let(0)`) and stays an expression.
            literal = (self.literal_for(var_t)(p["value"], scope, pre, 0)
                       if typed is None and p["value"].type != "Value" else None)
            if literal is not None:
                typed = self.type_ref(var_t)
            value = literal if literal is not None else self.expr(p["value"], scope, pre)
            py = self.bind(scope, p["variable"])
            ctor = f"{_BLOCK}.let" if p["variable"].value["mutable"] else f"{_BLOCK}.const"
            return [py, " = ", ctor, call_args([value] if typed is None else [value, typed])], None
        if kind == "Assign":
            # the variable types the value, as the declared output types a `b.return_`
            value = self.value_doc(p["value"], scope, pre, 0, typed=True)
            doc = self.method_call(_BLOCK, "assign", [self.var_ref(p["variable"], scope), value])
            return doc, doc
        if kind == "Return":
            doc = self.method_call(_BLOCK, "return_", [self.value_doc(p["value"], scope, pre, 0, typed=True)])
            return doc, doc
        if kind in ("Break", "Continue"):
            doc = self.method_call(_BLOCK, "break_" if kind == "Break" else "continue_",
                                   [self.label_ref(scope, p["label"]["name"])])
            return doc, doc
        if kind == "Error":
            doc = self.method_call(_BLOCK, "error", [self.expr(p["message"], scope, pre)])
            return doc, doc
        if kind == "While":
            pred = self.expr(p["predicate"], scope, pre)
            body = self.body_arg(p["body"], scope, [], pre, label=p["label"]["name"])
            doc = self.method_call(_BLOCK, "while_", [pred, body])
            return doc, doc
        if kind in ("ForArray", "ForSet", "ForDict"):
            src = {"ForArray": "array", "ForSet": "set", "ForDict": "dict"}[kind]
            coll = self.expr(p[src], scope, pre)
            params = [p["key"]] if kind == "ForSet" else [p["value"], p["key"]]
            body = self.body_arg(p["body"], scope, params, pre, label=p["label"]["name"])
            doc = self.method_call(_BLOCK, "for_", [coll, body])
            return doc, doc
        if kind == "IfElse" and p["type"].type in ("Null", "Never"):
            doc = self.if_statement(node, scope, pre)
            return doc, doc
        if kind == "Match" and p["type"].type in ("Null", "Never"):
            doc = self.match_statement(node, scope, pre)
            return doc, doc
        if kind == "TryCatch" and p["type"].type in ("Null", "Never"):
            doc = self.try_statement(node, scope, pre)
            return doc, doc
        # an expression in statement position
        if last:
            if _is_null_value(node):
                self.used.add("east_null")
                return "return east_null", "east_null"
            value = self.value_doc(node, scope, pre, 0, typed=typed)
            return ["return ", self.returned(value)], value
        value = self.expr(node, scope, pre)
        doc = self.method_call(_BLOCK, "do", [value])
        return doc, doc

    def if_statement(self, node: Any, scope: _Scope, pre: list[Doc]) -> Doc:
        p = node.value
        doc: Doc = _BLOCK
        for i, case in enumerate(p["ifs"]):
            pred = self.expr(case["predicate"], scope, pre)
            body = self.body_arg(case["body"], scope, [], pre)
            doc = self.method_call(doc, "if_" if i == 0 else "else_if", [pred, body])
        else_body = p["else_body"]
        if not _is_null_value(else_body):
            doc = self.method_call(doc, "else_", [self.body_arg(else_body, scope, [], pre)])
        return doc

    def match_statement(self, node: Any, scope: _Scope, pre: list[Doc]) -> Doc:
        p = node.value
        subject = self.expr(p["variant"], scope, pre)
        arms: list[Doc] = []
        for case in p["cases"]:
            body = case["body"]
            if _is_null_value(body):
                continue
            arms.append([repr(case["case"]), ": ", self.body_arg(body, scope, [case["variable"]], pre)])
        return self.method_call(_BLOCK, "match_", [subject, hug(bracket("{", arms, "}"))])

    def try_statement(self, node: Any, scope: _Scope, pre: list[Doc]) -> Doc:
        p = node.value
        doc = self.method_call(_BLOCK, "try_", [self.body_arg(p["try_body"], scope, [], pre)])
        catch = p["catch_body"]
        if not _is_null_value(catch):
            doc = self.method_call(doc, "catch", [self.body_arg(catch, scope, [p["message"], p["stack"]], pre)])
        fin = p["finally_body"]
        if not _is_null_value(fin):
            doc = self.method_call(doc, "finally_", [self.body_arg(fin, scope, [], pre)])
        return doc

    # ── expressions ──────────────────────────────────────────────────────

    def var_ref(self, node: Any, scope: _Scope) -> str:
        hit = scope.lookup(node.value["name"])
        if hit is None:
            raise Unprintable(f"variable {node.value['name']!r} is not bound")
        return hit

    def expr(self, node: Any, scope: _Scope, pre: list[Doc], depth: int = 0) -> Doc:
        """The document of an expression node; helper defs and temporaries
        go to ``pre`` (statements to emit before the user)."""
        if depth > _MAX_DEPTH:
            text = self.expr(node, scope, pre, 0)
            self.temp_counter += 1
            name = f"_e{self.temp_counter}"
            pre.append([name, " = ", text])
            return name
        d = depth + 1
        kind = node.type
        p = node.value
        if kind == "Value":
            lit = p["value"]
            if lit.type == "Null":
                self.used.add("east_null")
                return "east_null"
            if lit.type == "DateTime":
                self.uses_datetime = True
            return _pyliteral(lit.value)
        if kind == "Variable":
            return self.var_ref(node, scope)
        if kind == "Builtin":
            return self.builtin_expr(node, scope, pre, d)
        if kind == "Platform":
            arg_nodes = list(p["arguments"])
            if p["name"] == IMPORT_PLATFORM and len(arg_nodes) == 2 \
                    and all(a.type == "Value" for a in arg_nodes):
                # an unresolved cross-language import: its own spelling, not
                # a platform declaration
                pkg, fn_name = (_pyliteral(a.value["value"].value) for a in arg_nodes)
                return ["East.import_function", call_args([pkg, fn_name, self.type_ref(p["type"])])]
            args = [self.value_doc(a, scope, pre, d, typed=True) for a in arg_nodes]
            ref = self.platform_ref(p)
            if p["type_parameters"]:
                tps = bracket("[", [self.type_ref(t) for t in p["type_parameters"]], "]")
                return [ref, call_args([tps, *args])]
            return [ref, call_args(args)]
        if kind in ("Function", "AsyncFunction"):
            return self.function_expr(node, scope, pre)
        if kind in ("Call", "CallAsync"):
            fn = self.expr(p["function"], scope, pre, d)
            # the callee's declared inputs type its arguments
            args = [self.value_doc(a, scope, pre, d, typed=True) for a in p["arguments"]]
            # a callee that already prints as a call, a member or a name needs no parentheses
            if p["function"].type not in ("Variable", "GetField", "Call", "CallAsync", "Function",
                                          "AsyncFunction", "Builtin", "Platform"):
                fn = ["(", fn, ")"]
            return [fn, call_args(args)]
        if kind == "GetField":
            base = self.expr(p["struct"], scope, pre, d)
            name = p["field"]
            if _ident(name) and not name.startswith("_"):
                return [base, ".", name]
            return [base, ".field(", repr(name), ")"]
        if kind in ("Struct", "Variant"):
            return ["East.value", call_args([self.literal_for(p["type"])(node, scope, pre, depth), self.type_ref(p["type"])])]
        if kind in ("NewArray", "NewSet", "NewVector"):
            # the constructor types its elements: a construction among them prints bare
            elem = self.printed(p["type"].value)
            values = bracket("[", [elem(v, scope, pre, d) for v in p["values"]], "]")
            ctor = {"NewArray": "new_array", "NewSet": "new_set", "NewVector": "new_vector"}[kind]
            return [f"East.{ctor}", call_args([self.type_ref(p["type"].value), values])]
        if kind == "NewMatrix":
            elem = self.printed(p["type"].value)
            values = bracket("[", [elem(v, scope, pre, d) for v in p["values"]], "]")
            return ["East.new_matrix", call_args([self.type_ref(p["type"].value), str(p["rows"]), str(p["cols"]), values])]
        if kind == "NewDict":
            t = p["type"]
            key, value = self.printed(t.value["key"]), self.printed(t.value["value"])
            entries = bracket("[", [
                bracket("(", [key(e["key"], scope, pre, d), value(e["value"], scope, pre, d)], ")")
                for e in p["values"]], "]")
            return ["East.new_dict", call_args([self.type_ref(t.value["key"]), self.type_ref(t.value["value"]), entries])]
        if kind == "NewRef":
            return ["East.ref", call_args([self.expr(p["value"], scope, pre, d)])]
        if kind == "As":
            return ["East.as_", call_args([self.expr(p["value"], scope, pre, d), self.type_ref(p["type"])])]
        if kind == "WrapRecursive":
            # the wrapper's inner type governs the wrapped value: a construction prints bare
            payload = p["type"].value
            inner = payload.value["inner"] if payload.type == "wrapper" else None
            literal = self.literal_for(inner)(p["value"], scope, pre, d) if inner is not None else None
            value = literal if literal is not None else self.expr(p["value"], scope, pre, d)
            return ["East.wrap_recursive", call_args([value, self.type_ref(p["type"])])]
        if kind == "UnwrapRecursive":
            return self.method_call(self.expr(p["value"], scope, pre, d), "unwrap", [])
        if kind == "Error":
            return ["East.error", call_args([self.expr(p["message"], scope, pre, d)])]
        if kind == "IfElse":
            parts: list[Doc] = []
            for case in p["ifs"]:
                parts.append(self.traced_expr(case["predicate"], scope, pre, d))
                parts.append(self.arm_expr(case["body"], scope, pre, d))
            parts.append(self.arm_expr(p["else_body"], scope, pre, d))
            return ["East.if_else", call_args(parts)]
        if kind == "Match":
            subject = self.expr(p["variant"], scope, pre, d)
            # `v.unwrap()` lowers to a match; printed back as the call
            unwrapped = _unwrap_case(p)
            if unwrapped is not None:
                return self.method_call(subject, "unwrap", [] if unwrapped == "some" else [repr(unwrapped)])
            arms: list[Doc] = []
            for case in p["cases"]:
                arms.append([repr(case["case"]), ": ", self.expr_callback(case["body"], [case["variable"]], scope, pre)])
            return self.method_call(subject, "match", [hug(bracket("{", arms, "}"))])
        if kind == "TryCatch":
            body = self.expr_callback(p["try_body"], [], scope, pre)
            handler = self.expr_callback(p["catch_body"], [p["message"], p["stack"]], scope, pre)
            fin = p["finally_body"]
            args = [body, handler]
            if not _is_null_value(fin):
                args.append(self.expr_callback(fin, [], scope, pre))
            return ["East.try_catch", call_args(args)]
        if kind == "Block":
            return self.block_expr(node, scope, pre)
        if kind in _STATEMENT_KINDS:
            raise Unprintable(f"{kind} node in expression position")
        raise Unprintable(f"unknown node kind {kind}")

    def value_doc(self, node: Any, scope: _Scope, pre: list[Doc], depth: int, *, typed: bool) -> Doc:
        """A node in a value position — a method's argument, a call
        argument, a returned value: a construction prints as the python
        literal, bare when the position is typed by the surface (``typed``:
        a declared output, an assigned variable, a callee's input) or when
        the literal types itself (``_self_typing`` — a method's argument
        or a callback's return, which the builder lifts as it stands), and
        through ``East.value(v, T)`` / its constructor otherwise; any other
        node prints as the expression it is."""
        if node.type not in _CONSTRUCTIONS or (not typed and not _self_typing(node)):
            return self.expr(node, scope, pre, depth)
        text = self.literal_for(node.value["type"])(node, scope, pre, depth)
        return text if text is not None else self.expr(node, scope, pre, depth)

    def printed(self, t: EastType) -> Any:
        """A node at a position of type ``t``: its literal when it is the
        construction the type expects, else the node as an expression."""
        literal = self.literal_for(t)

        def print_at(node: Any, scope: _Scope, pre: list[Doc], depth: int) -> Doc:
            text = literal(node, scope, pre, depth)
            return text if text is not None else self.expr(node, scope, pre, depth)
        return print_at

    def literal_for(self, t: EastType) -> Any:
        """The host-literal printer for values of type ``t`` — a factory over
        the TYPE, as ``compare_for(t)`` and ``equal_for(t)`` are: the factory
        for a Dict holds the factories for its key and value types, and so on
        down, so the one type on a binding governs every position of the
        literal and a construction nested anywhere prints bare. Applied to a
        node it returns the literal, or ``None`` when the node is not the
        construction its position's type expects (a variable, a call, a
        widening, a function) — the caller prints that as an expression. A
        Set position always yields ``None`` (a python set literal iterates in
        hash order and would lose the element order the IR carries), as does
        a Dict keyed by expressions (python cannot hash them):
        ``East.new_set`` / ``East.new_dict`` spell those."""
        key = type_key(t)
        hit = self.literals.get(key)
        if hit is None:
            hit = self.literals[key] = self._make_literal(t)
        return hit

    def _make_literal(self, t: EastType) -> Any:
        kind = t.type

        def child(u: EastType) -> Any:
            inner = self.literal_for(u)

            def print_child(node: Any, scope: _Scope, pre: list[Doc], depth: int) -> Doc:
                text = inner(node, scope, pre, depth)
                return text if text is not None else self.expr(node, scope, pre, depth)
            return print_child

        def as_expr(node: Any, scope: _Scope, pre: list[Doc], depth: int) -> Doc:
            return self.expr(node, scope, pre, depth)

        if kind in ("Null", "Boolean", "Integer", "Float", "String", "DateTime", "Blob"):
            def scalar(node: Any, scope: _Scope, pre: list[Doc], depth: int) -> Doc | None:
                return self.expr(node, scope, pre, depth) if node.type == "Value" else None
            return scalar
        if kind == "Array":
            elem = child(t.value)

            def array(node: Any, scope: _Scope, pre: list[Doc], depth: int) -> Doc | None:
                if node.type != "NewArray":
                    return None
                return hug(bracket("[", [elem(v, scope, pre, depth + 1) for v in node.value["values"]], "]"))
            return array
        if kind == "Dict":
            key_print, value = child(t.value["key"]), child(t.value["value"])

            def dict_(node: Any, scope: _Scope, pre: list[Doc], depth: int) -> Doc | None:
                if node.type != "NewDict":
                    return None
                entries = list(node.value["values"])
                if not all(e["key"].type == "Value" for e in entries):
                    return None
                items: list[Doc] = [
                    [key_print(e["key"], scope, pre, depth + 1), ": ", value(e["value"], scope, pre, depth + 1)]
                    for e in entries]
                return hug(bracket("{", items, "}"))
            return dict_
        if kind == "Struct":
            fields = {f["name"]: child(f["type"]) for f in t.value}

            def struct(node: Any, scope: _Scope, pre: list[Doc], depth: int) -> Doc | None:
                if node.type != "Struct":
                    return None
                items: list[Doc] = [
                    [repr(f["name"]), ": ", fields.get(f["name"], as_expr)(f["value"], scope, pre, depth + 1)]
                    for f in node.value["fields"]]
                return hug(bracket("{", items, "}"))
            return struct
        if kind == "Variant":
            cases = {c["name"]: child(c["type"]) for c in t.value}
            option = _is_option_type(t)

            def variant_(node: Any, scope: _Scope, pre: list[Doc], depth: int) -> Doc | None:
                if node.type != "Variant":
                    return None
                case = node.value["case"]
                if option and case == "none":
                    self.used.add("none")
                    return "none"
                payload = cases.get(case, as_expr)(node.value["value"], scope, pre, depth + 1)
                self.used.add("some" if option else "variant")
                return ["some", call_args([payload])] if option else ["variant", call_args([repr(case), payload])]
            return variant_

        # Set, Ref, Vector, Matrix, Function, AsyncFunction, Recursive, Never: no python literal here
        def none_(_node: Any, _scope: _Scope, _pre: list[Doc], _depth: int) -> Doc | None:
            return None
        return none_

    def traced_expr(self, node: Any, scope: _Scope, pre: list[Doc], depth: int) -> Doc:
        """An expression that must be a traced Expression, not a python
        literal (an ``if_else`` predicate): literals go through East.value."""
        if node.type == "Value":
            lit = node.value["value"]
            if lit.type == "Null":
                self.used.update(("east_null", "NullType"))
                return "East.value(east_null, NullType)"
            if lit.type == "DateTime":
                self.uses_datetime = True
            return ["East.value", call_args([_pyliteral(lit.value), self.type_ref(node.value["type"])])]
        return self.expr(node, scope, pre, depth)

    def arm_expr(self, body: Any, scope: _Scope, pre: list[Doc], depth: int) -> Doc:
        """An if_else arm: an expression, or a Block as ``East.block(...)``."""
        if body.type == "Block":
            return self.block_expr(body, scope, pre)
        return self.expr(body, scope, pre, depth)

    def block_expr(self, body: Any, scope: _Scope, pre: list[Doc]) -> Doc:
        """A Block in expression position: ``East.block(lambda b: …)`` /
        ``East.block(_bN)`` — the body receives the block first."""
        inner = _Scope(scope)
        nodes = self.body_nodes(body, mode="function")
        if len(nodes) == 1:
            sub: list[Doc] = []
            doc, lam = self.statement(nodes[0], inner, sub, last=True)
            if lam is not None and not sub and nodes[0].type not in _STATEMENT_KINDS:
                return ["East.block(lambda ", _BLOCK, ": ", lam, ")"]
            lines = [*sub, doc]
        else:
            lines = self.body_lines(body, inner, mode="function")
        name = self.fresh_helper("b")
        pre.append(_def(name, [_BLOCK], lines))
        return ["East.block(", name, ")"]

    def expr_callback(self, body: Any, params: list[Any], scope: _Scope, pre: list[Doc]) -> Doc:
        """A handler of an EXPRESSION form (a ``.match({...})`` arm, an
        ``East.try_catch`` body) — a body like any other, the block first."""
        return self.callback_expr(body, params, scope, pre)

    def callback_expr(self, body: Any, params: list[Any], scope: _Scope, pre: list[Doc]) -> Doc:
        """A callback body, the block first: ``lambda b, params: expr`` when
        the body is one expression, else a ``def _bN(b, params)`` helper. The
        parameters keep the builtin's own order — the python surface takes it
        on every collection (the TypeScript ``(value, key)`` Dict order)."""
        inner = _Scope(scope)
        names = [_BLOCK, *(self.bind(inner, v) for v in params)]
        if not _has_statements(body):
            sub: list[Doc] = []
            # the builder infers the callback's type from what it returns: bare only when it types itself
            text = self.value_doc(body, inner, sub, 0, typed=False)
            if not sub:
                return [f"lambda {', '.join(names)}: ", text]
            # the expression needed helpers: a def carries them
            name = self.fresh_helper("b")
            pre.append(_def(name, names, [*sub, ["return ", self.returned(text)]]))
            return name
        name = self.fresh_helper("b")
        pre.append(_def(name, names, self.body_lines(body, inner, mode="function")))
        return name

    # ── builtins ─────────────────────────────────────────────────────────

    def builtin_expr(self, node: Any, scope: _Scope, pre: list[Doc], depth: int) -> Doc:
        p = node.value
        name = p["builtin"]
        row = spelling_for(name)
        args = list(p["arguments"])
        if row is not None:
            rendered = self.render_row(row, args, p, scope, pre, depth)
            if rendered is not None:
                return rendered
        return self.raw_builtin(node, scope, pre, depth)

    def render_row(self, row: Any, args: list, p: Any, scope: _Scope,
                   pre: list[Doc], depth: int) -> Doc | None:
        texts: list[Doc] = []
        for i, arg in enumerate(args):
            adapter = row.callbacks.get(i)
            if adapter is None:
                # The first operand is always a traced Expression: python
                # would otherwise fold two literals itself ('a' + 'b') or
                # run a namespace call eagerly (East.Integer.divide(1, 0)).
                # Any other slot lifts a python literal as it stands, so a
                # construction prints bare when it types itself.
                texts.append(self.traced_expr(arg, scope, pre, depth) if i == 0
                             else self.value_doc(arg, scope, pre, depth, typed=False))
                continue
            if arg.type != "Function":
                # a function VALUE in a callback slot (a variable, a call)
                texts.append(self.expr(arg, scope, pre, depth))
                continue
            rendered = self.callback_for(adapter, arg, scope, pre)
            if rendered is None:
                return None
            texts.append(rendered)
        tps = [self.type_ref(t) for t in p["type_parameters"]]

        def slot(name: str) -> Doc:
            if name.startswith("T"):
                return tps[int(name[1:])]
            return texts[int(name)]

        try:
            return self.template_doc(row.template, slot)
        except IndexError:
            return None

    def template_doc(self, template: str, slot: Any) -> Doc:
        """A spelling template as a document: a method on a slot
        (``{0}.map({1})``) is a member-chain segment on that argument, any
        other call lays its arguments out as one, an operator row breaks
        before its operator, and a template that is not a call is filled in
        as it stands."""
        call = _parse_call_template(template)
        if call is not None:
            head, arg_templates = call
            args = [_fill(a, slot) for a in arg_templates]
            method = _METHOD_HEAD.match(head)
            if method is not None:
                return self.method_call(slot(method.group(1)), method.group(2), args)
            return [_fill(head, slot), call_args(args)]
        binary = _BINARY.match(template)
        if binary is not None:
            return self.operator_chain(slot(binary.group(1)), binary.group(2), slot(binary.group(3)))
        unary = _UNARY.match(template)
        if unary is not None:
            operand = self.operand(slot(unary.group(2)), _UNARY_LEVEL, strict=True)
            return self.operator_doc(_UNARY_LEVEL, [[unary.group(1), operand]])
        return _fill(template, slot)

    def operator_chain(self, left: Doc, op: str, right: Doc) -> Doc:
        """``(left op right)`` as black lays it out: a run of operands at one
        precedence level is one group — flat, or one operand per line
        breaking before each operator — and an operand that binds tighter
        drops its parentheses. ``((a + b) + c)`` prints ``(a + b + c)``; a
        comparison keeps its operands parenthesised (python chains them)."""
        level = _PRECEDENCE[op]
        prior = self.operators.get(id(left)) if level in _CHAINABLE else None
        if prior is not None and prior[0] == level:
            parts = [*prior[1], op, self.operand(right, level, strict=True)]
        else:
            parts = [self.operand(left, level, strict=False), op, self.operand(right, level, strict=True)]
        return self.operator_doc(level, parts)

    def operand(self, doc: Doc, level: int, *, strict: bool) -> Doc:
        """``doc`` as an operand at ``level``: an operator document binding
        tighter (or, on the left of a chainable operator, as tight) needs
        no parentheses."""
        prior = self.operators.get(id(doc))
        if prior is None:
            return doc
        own = prior[0]
        if own > level or (not strict and own == level and level in _CHAINABLE):
            return prior[2]
        return doc

    def operator_doc(self, level: int, parts: list[Doc]) -> Doc:
        """The document of an operator run ``[a, op, b, op, c]`` (a unary run
        is ``[[op, a]]``), parenthesised; registered so a parent operator can
        continue or unwrap it."""
        run: list[Doc] = [parts[0]]
        for i in range(1, len(parts), 2):
            run.append([line, parts[i], " ", parts[i + 1]])
        bare = group(run)
        doc = group(["(", indent([softline, run]), softline, ")"])
        self.operators[id(doc)] = (level, parts, bare, doc)
        return doc

    def callback_for(self, adapter: str, fn: Any, scope: _Scope, pre: list[Doc]) -> Doc | None:
        fp = fn.value
        params = list(fp["parameters"])
        if adapter == "cb":
            return self.callback_expr(fp["body"], params, scope, pre)
        if adapter == "trim":
            if self.mentions(fp["body"], [v.value["name"] for v in params]):
                return None
            return self.callback_expr(fp["body"], [], scope, pre)
        return None

    @staticmethod
    def mentions(body: Any, names: list[str]) -> bool:
        """Whether a Variable named in ``names`` occurs under ``body``."""
        from east.expression.finalize import _node_children

        if not names:
            return False
        stack = [body]
        wanted = set(names)
        while stack:
            n = stack.pop()
            if n.type == "Variable" and n.value["name"] in wanted:
                return True
            stack.extend(_node_children(n))
        return False

    def raw_builtin(self, node: Any, scope: _Scope, pre: list[Doc], depth: int) -> Doc:
        p = node.value
        self.raw_builtins.add(p["builtin"])
        args = [self.traced_expr(a, scope, pre, depth) if i == 0 else self.expr(a, scope, pre, depth)
                for i, a in enumerate(p["arguments"])]
        tps = [self.type_ref(t) for t in p["type_parameters"]]
        return ["East.builtin", call_args([repr(p["builtin"]), bracket("[", tps, "]"), bracket("[", args, "]"),
                                           self.type_ref(p["type"])])]

    # ── the module ───────────────────────────────────────────────────────

    def module(self, ir: Any) -> str:
        root = ir
        consts: list[Any] = []
        if root.type == "Block":
            stmts = list(root.value["statements"])
            consts = stmts[:-1]
            root = stmts[-1]
        if root.type not in ("Function", "AsyncFunction"):
            raise Unprintable(f"the root must be a Function or AsyncFunction, got {root.type}")
        self.var_counter = _next_v_index(ir)
        self.prepare(ir)
        # A python artifact's hoisted constants become the body's consts.
        fn_doc = self.function_def(root, _Scope(None), self.root_name, consts=consts, root=True)
        # exactly the names the module uses, in one fixed order
        names = [n for n in ("East", "variant", "some", "none", "east_null", "recursive_type", *TYPE_IMPORTS)
                 if n in self.used]
        parts: list[Doc] = [
            "# Generated by east-py transpile — East IR printed as the East.function",
            "# builder surface. Rebuilding this module yields the same IR (normalized).",
            f"from east import {', '.join(names)}",
        ]
        if self.uses_datetime:
            parts.append("from datetime import datetime, timezone")
        parts.append("")
        for _key, (name, src) in self.types.items():
            parts.append([name, " = ", src])
        if self.types:
            parts.append("")
        parts.extend(self.platform_decls)
        if self.platform_decls:
            parts.append("")
        parts.append(fn_doc)
        parts.append("")
        return render(join(hardline, parts), self.width)


def _next_v_index(ir: Any) -> int:
    """One above the highest ``v_N`` variable name in ``ir`` — a minted
    ``v_N`` never collides with one the program authored."""
    from east.expression.finalize import _node_children

    highest = -1
    stack = [ir]
    while stack:
        n = stack.pop()
        if n.type == "Variable":
            m = _V_NAME.fullmatch(n.value["name"])
            if m:
                highest = max(highest, int(m.group(1)))
        stack.extend(_node_children(n))
    return highest + 1


def _ir_of(fn_or_ir: Any) -> Any:
    ir = getattr(fn_or_ir, "_east_ir", None)
    if ir is not None:
        return ir
    if isinstance(fn_or_ir, EastVariant):
        return fn_or_ir
    raise TypeError("to_python_source takes an East.function result or an IR value")


def to_python_source(fn_or_ir: Any, *, name: str | None = None, width: float = LINE_WIDTH) -> str:
    """Print East IR as a python module that rebuilds it.

    Args:
        fn_or_ir: A built ``East.function`` / ``East.asyncFunction`` artifact,
            or a homoiconic IR value (a Function/AsyncFunction node, or the
            ``Block[Let…, Function]`` a build with hoisted constants emits —
            its constants become the body's first ``b.const``s).
        name: The module-level name bound to the rebuilt function
            (default ``"main"``).
        width: The line width the layout keeps to (default
            ``LINE_WIDTH``); ``math.inf`` prints every construct on one line.

    Returns:
        The module source. Importing it (or ``exec``-ing it) binds ``name``
        to a ``@East.function(..., cse=False)``-decorated def, whose IR
        normalizes equal to the input's (``east-c ir normalize``).

    Raises:
        Unprintable: For a shape the python surface cannot spell — a
            statement in expression position, a jump to no loop, an
            unknown node kind. Builtins without a python spelling print
            through ``East.builtin(...)`` and are never unprintable.
    """
    printer = _Printer(name or "main", width)
    return printer.module(_ir_of(fn_or_ir))
