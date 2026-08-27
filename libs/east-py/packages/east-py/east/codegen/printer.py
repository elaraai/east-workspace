#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The IR → python printer (#627): ``to_python_source``.

The printer walks an IR value and writes a python module whose
``East.function(...)`` rebuilds the same IR. Its spellings are the
statement surface's (``east.expression.statements``) and the builtin
table's (``east.codegen.spellings``):

- a Function/AsyncFunction is a ``def _fN(params)`` handed to
  ``East.function([types], out, _fN, cse=False)`` (nested functions are
  expressions of the enclosing body, as in TypeScript);
- a Block is that def's statements; the block's last node prints as
  ``return <expr>`` when it is an expression, or as the statement it is;
- Let/Assign/Return/Break/Continue, a Null-typed IfElse/Match/While/For/
  TryCatch, print as statements (``East.let``, ``East.if_(...).else_if(...)
  .else_(...)``, …) whose bodies are ``def _bN(...)`` helpers defined just
  before the statement that uses them;
- every other node prints as an expression: literals as python literals,
  Struct/Variant/NewArray/… through ``East.value(..., T)`` and the
  ``East.new_*`` constructors, an expression IfElse/Match/TryCatch through
  ``East.if_else`` / ``.match({...})`` / ``East.try_catch``, a Builtin
  through its spelling row (callbacks as lambdas, or defs when they hold
  statements) or the raw ``East.builtin(name, [T...], [args], out)``.

Variables keep their IR names when they are python identifiers (the
TypeScript ``_N``s are); anything else is renamed ``v_N``. Types are
hoisted to module constants ``_tN`` (deduplicated structurally), platform
declarations to ``_pN`` (one per distinct signature). Deep expression
nesting is broken with ``_eN = <expr>`` temporaries, so any IR width or
depth prints to parseable python.
"""

from __future__ import annotations

import keyword
import math
from datetime import datetime
from typing import Any

from east.codegen.spellings import spelling_for
from east.codegen.types import TYPE_IMPORTS, type_key, type_source
from east.types.types import EastType
from east.types.values import EastVariant

__all__ = ["to_python_source", "Unprintable"]


class Unprintable(ValueError):
    """The IR holds a shape the python surface cannot spell; the message
    names the node kind (and builtin) and where it sits."""


_STATEMENT_KINDS = frozenset({
    "Let", "Assign", "Return", "Break", "Continue", "While", "ForArray", "ForSet", "ForDict",
})
_MAX_DEPTH = 24


def _ident(name: str) -> bool:
    return name.isidentifier() and not keyword.iskeyword(name)


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
        self.used: set[str] = set(parent.used) if parent else set()

    def lookup(self, ir_name: str) -> str | None:
        scope: _Scope | None = self
        while scope is not None:
            hit = scope.names.get(ir_name)
            if hit is not None:
                return hit
            scope = scope.parent
        return None


class _Printer:
    def __init__(self, root_name: str) -> None:
        self.root_name = root_name
        self.types: dict[str, tuple[str, str]] = {}      # type key -> (const name, source)
        self.platforms: dict[tuple, str] = {}             # signature -> const name
        self.platform_decls: list[str] = []
        self.helper_counter = 0
        self.temp_counter = 0
        self.raw_builtins: set[str] = set()
        self.uses_datetime = False
        self.uses_variant = False

    # ── module-level pieces ──────────────────────────────────────────────

    def type_ref(self, t: EastType) -> str:
        """A type as source: a primitive name inline, anything else hoisted."""
        if t.type in ("Null", "Never", "Boolean", "Integer", "Float", "String", "DateTime", "Blob"):
            return type_source(t)
        key = type_key(t)
        hit = self.types.get(key)
        if hit is None:
            name = f"_t{len(self.types)}"
            self.types[key] = (name, type_source(t))
            return name
        return hit[0]

    def platform_ref(self, p: Any) -> str:
        inputs = tuple(type_key(a.value["type"]) for a in p["arguments"])
        tps = tuple(type_key(t) for t in p["type_parameters"])
        sig = (p["name"], inputs, type_key(p["type"]), bool(p["async"]), bool(p["optional"]), tps)
        hit = self.platforms.get(sig)
        if hit is not None:
            return hit
        name = f"_p{len(self.platforms)}"
        self.platforms[sig] = name
        if tps:
            # A generic call: the concrete type arguments are all the node
            # records, so the declaration is spelled with placeholders for
            # them in order and the inputs/output as the call has them.
            params = [f"T{i}" for i in range(len(tps))]
            decl = "East.asyncGenericPlatform" if p["async"] else "East.genericPlatform"
            args = ", ".join(self.type_ref(a.value["type"]) for a in p["arguments"])
            self.platform_decls.append(
                f"{name} = {decl}({p['name']!r}, {params!r}, [{args}], "
                f"{self.type_ref(p['type'])}{', optional=True' if p['optional'] else ''})")
        else:
            decl = "East.asyncPlatform" if p["async"] else "East.platform"
            args = ", ".join(self.type_ref(a.value["type"]) for a in p["arguments"])
            self.platform_decls.append(
                f"{name} = {decl}({p['name']!r}, [{args}], {self.type_ref(p['type'])}"
                f"{', optional=True' if p['optional'] else ''})")
        return name

    def fresh_helper(self, prefix: str) -> str:
        self.helper_counter += 1
        return f"_{prefix}{self.helper_counter}"

    # ── functions ────────────────────────────────────────────────────────

    def bind(self, scope: _Scope, var: Any) -> str:
        """Bind an IR Variable node in ``scope`` and return its python name."""
        ir_name = var.value["name"]
        py = ir_name if _ident(ir_name) and not ir_name.startswith("__") else None
        if py is None or py in scope.used:
            base = "v"
            n = 0
            while f"{base}_{n}" in scope.used:
                n += 1
            py = f"{base}_{n}"
        scope.names[ir_name] = py
        scope.used.add(py)
        return py

    def function_def(self, node: Any, scope: _Scope, name: str) -> list[str]:
        """The ``def`` lines of a Function/AsyncFunction node."""
        p = node.value
        inner = _Scope(scope)
        params = [self.bind(inner, v) for v in p["parameters"]]
        body = self.body_lines(p["body"], inner)
        return [f"def {name}({', '.join(params)}):", *["    " + ln for ln in body]]

    def function_expr(self, node: Any, scope: _Scope, pre: list[str]) -> str:
        """A nested Function as an expression: its def goes to ``pre``."""
        name = self.fresh_helper("f")
        pre.extend(self.function_def(node, scope, name))
        p = node.value
        fn_t = p["type"]
        inputs = ", ".join(self.type_ref(t) for t in fn_t.value["inputs"])
        ctor = "East.asyncFunction" if node.type == "AsyncFunction" else "East.function"
        return f"{ctor}([{inputs}], {self.type_ref(fn_t.value['output'])}, {name})"

    def body_lines(self, body: Any, scope: _Scope) -> list[str]:
        """The statements of a function body (a Block, or one node)."""
        nodes = list(body.value["statements"]) if body.type == "Block" else [body]
        lines: list[str] = []
        for i, node in enumerate(nodes):
            last = i == len(nodes) - 1
            lines.extend(self.statement_lines(node, scope, last))
        if not lines:
            lines.append("pass")
        return lines

    def block_helper(self, body: Any, scope: _Scope, params: list[Any], pre: list[str],
                     label: str | None = None, extra: tuple[str, ...] = ()) -> str:
        """A branch/loop/handler body as ``def _bN(...)``; returns its name."""
        name = self.fresh_helper("b")
        inner = _Scope(scope)
        names = [self.bind(inner, v) for v in params]
        if label is not None:
            lbl = self.fresh_label(inner, label)
            names.append(lbl)
        names.extend(extra)
        lines = self.body_lines(body, inner)
        pre.append(f"def {name}({', '.join(names)}):")
        pre.extend("    " + ln for ln in lines)
        return name

    def fresh_label(self, scope: _Scope, ir_label: str) -> str:
        py = f"lbl_{ir_label}" if _ident(f"lbl_{ir_label}") else "lbl"
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

    def statement_lines(self, node: Any, scope: _Scope, last: bool) -> list[str]:
        kind = node.type
        p = node.value
        pre: list[str] = []
        if kind == "Let":
            value = self.expr(p["value"], scope, pre)
            var_t = p["variable"].value["type"]
            py = self.bind(scope, p["variable"])
            ctor = "East.let" if p["variable"].value["mutable"] else "East.const"
            typed = "" if type_key(var_t) == type_key(p["value"].value["type"]) \
                else f", {self.type_ref(var_t)}"
            return [*pre, f"{py} = {ctor}({value}{typed})"]
        if kind == "Assign":
            value = self.expr(p["value"], scope, pre)
            return [*pre, f"East.assign({self.var_ref(p['variable'], scope)}, {value})"]
        if kind == "Return":
            value = self.expr(p["value"], scope, pre)
            return [*pre, f"East.return_({value})"]
        if kind in ("Break", "Continue"):
            fn = "East.break_" if kind == "Break" else "East.continue_"
            return [f"{fn}({self.label_ref(scope, p['label']['name'])})"]
        if kind == "While":
            pred = self.expr(p["predicate"], scope, pre)
            helper = self.block_helper(p["body"], scope, [], pre, label=p["label"]["name"])
            return [*pre, f"East.while_({pred}, {helper})"]
        if kind in ("ForArray", "ForSet", "ForDict"):
            src = {"ForArray": "array", "ForSet": "set", "ForDict": "dict"}[kind]
            coll = self.expr(p[src], scope, pre)
            params = [p["key"]] if kind == "ForSet" else [p["value"], p["key"]]
            helper = self.block_helper(p["body"], scope, params, pre, label=p["label"]["name"])
            return [*pre, f"East.for_({coll}, {helper})"]
        if kind == "IfElse" and p["type"].type in ("Null", "Never"):
            lines = self.if_statement(node, scope, pre)
            return [*pre, *lines]
        if kind == "Match" and p["type"].type in ("Null", "Never"):
            lines = self.match_statement(node, scope, pre)
            return [*pre, *lines]
        if kind == "TryCatch" and p["type"].type in ("Null", "Never"):
            lines = self.try_statement(node, scope, pre)
            return [*pre, *lines]
        # an expression in statement position
        if last:
            if kind == "Value" and p["type"].type == "Null":
                return ["return east_null"]
            value = self.expr(node, scope, pre)
            return [*pre, f"return {value}"]
        value = self.expr(node, scope, pre)
        return [*pre, f"East.do({value})"]

    def if_statement(self, node: Any, scope: _Scope, pre: list[str]) -> list[str]:
        p = node.value
        parts: list[str] = []
        for i, case in enumerate(p["ifs"]):
            pred = self.expr(case["predicate"], scope, pre)
            helper = self.block_helper(case["body"], scope, [], pre)
            parts.append(f"{'East.if_' if i == 0 else '.else_if'}({pred}, {helper})")
        else_body = p["else_body"]
        if not (else_body.type == "Value" and else_body.value["type"].type == "Null"):
            helper = self.block_helper(else_body, scope, [], pre)
            parts.append(f".else_({helper})")
        return ["".join(parts)]

    def match_statement(self, node: Any, scope: _Scope, pre: list[str]) -> list[str]:
        p = node.value
        subject = self.expr(p["variant"], scope, pre)
        arms = []
        for case in p["cases"]:
            body = case["body"]
            if body.type == "Value" and body.value["type"].type == "Null":
                continue
            helper = self.block_helper(body, scope, [case["variable"]], pre)
            arms.append(f"{case['case']!r}: {helper}")
        return [f"East.match_({subject}, {{{', '.join(arms)}}})"]

    def try_statement(self, node: Any, scope: _Scope, pre: list[str]) -> list[str]:
        p = node.value
        text = f"East.try_({self.block_helper(p['try_body'], scope, [], pre)})"
        catch = p["catch_body"]
        if not (catch.type == "Value" and catch.value["type"].type == "Null"):
            helper = self.block_helper(catch, scope, [p["message"], p["stack"]], pre)
            text += f".catch({helper})"
        fin = p["finally_body"]
        if not (fin.type == "Value" and fin.value["type"].type == "Null"):
            text += f".finally_({self.block_helper(fin, scope, [], pre)})"
        return [text]

    # ── expressions ──────────────────────────────────────────────────────

    def var_ref(self, node: Any, scope: _Scope) -> str:
        hit = scope.lookup(node.value["name"])
        if hit is None:
            raise Unprintable(f"variable {node.value['name']!r} is not bound")
        return hit

    def expr(self, node: Any, scope: _Scope, pre: list[str], depth: int = 0) -> str:
        """The python source of an expression node; helper defs and
        temporaries go to ``pre`` (statements to emit before the user)."""
        if depth > _MAX_DEPTH:
            text = self.expr(node, scope, pre, 0)
            self.temp_counter += 1
            name = f"_e{self.temp_counter}"
            pre.append(f"{name} = {text}")
            return name
        d = depth + 1
        kind = node.type
        p = node.value
        if kind == "Value":
            lit = p["value"]
            if lit.type == "Null":
                return "east_null"
            if lit.type == "DateTime":
                self.uses_datetime = True
            return _pyliteral(lit.value)
        if kind == "Variable":
            return self.var_ref(node, scope)
        if kind == "Builtin":
            return self.builtin_expr(node, scope, pre, d)
        if kind == "Platform":
            args = ", ".join(self.expr(a, scope, pre, d) for a in p["arguments"])
            ref = self.platform_ref(p)
            if p["type_parameters"]:
                tps = ", ".join(self.type_ref(t) for t in p["type_parameters"])
                return f"{ref}([{tps}]{', ' if args else ''}{args})"
            return f"{ref}({args})"
        if kind in ("Function", "AsyncFunction"):
            return self.function_expr(node, scope, pre)
        if kind in ("Call", "CallAsync"):
            fn = self.expr(p["function"], scope, pre, d)
            args = ", ".join(self.expr(a, scope, pre, d) for a in p["arguments"])
            if p["function"].type not in ("Variable", "GetField", "Call", "CallAsync"):
                fn = f"({fn})"
            return f"{fn}({args})"
        if kind == "GetField":
            base = self.expr(p["struct"], scope, pre, d)
            name = p["field"]
            if _ident(name) and not name.startswith("_"):
                return f"{base}.{name}"
            return f"{base}.field({name!r})"
        if kind == "Struct":
            fields = ", ".join(f"{f['name']!r}: {self.expr(f['value'], scope, pre, d)}"
                               for f in p["fields"])
            return f"East.value({{{fields}}}, {self.type_ref(p['type'])})"
        if kind == "Variant":
            self.uses_variant = True
            value = self.expr(p["value"], scope, pre, d)
            return f"East.value(variant({p['case']!r}, {value}), {self.type_ref(p['type'])})"
        if kind in ("NewArray", "NewSet", "NewVector"):
            values = ", ".join(self.expr(v, scope, pre, d) for v in p["values"])
            ctor = {"NewArray": "new_array", "NewSet": "new_set", "NewVector": "new_vector"}[kind]
            return f"East.{ctor}({self.type_ref(p['type'].value)}, [{values}])"
        if kind == "NewMatrix":
            values = ", ".join(self.expr(v, scope, pre, d) for v in p["values"])
            return (f"East.new_matrix({self.type_ref(p['type'].value)}, {p['rows']}, "
                    f"{p['cols']}, [{values}])")
        if kind == "NewDict":
            entries = ", ".join(
                f"({self.expr(e['key'], scope, pre, d)}, {self.expr(e['value'], scope, pre, d)})"
                for e in p["values"])
            t = p["type"]
            return (f"East.new_dict({self.type_ref(t.value['key'])}, "
                    f"{self.type_ref(t.value['value'])}, [{entries}])")
        if kind == "NewRef":
            return f"East.ref({self.expr(p['value'], scope, pre, d)})"
        if kind == "As":
            return f"East.as_({self.expr(p['value'], scope, pre, d)}, {self.type_ref(p['type'])})"
        if kind == "WrapRecursive":
            return (f"East.wrap_recursive({self.expr(p['value'], scope, pre, d)}, "
                    f"{self.type_ref(p['type'])})")
        if kind == "UnwrapRecursive":
            return f"{self.expr(p['value'], scope, pre, d)}.unwrap()"
        if kind == "Error":
            return f"East.error({self.expr(p['message'], scope, pre, d)})"
        if kind == "IfElse":
            parts = []
            for case in p["ifs"]:
                parts.append(self.traced_expr(case["predicate"], scope, pre, d))
                parts.append(self.arm_expr(case["body"], scope, pre, d))
            parts.append(self.arm_expr(p["else_body"], scope, pre, d))
            return f"East.if_else({', '.join(parts)})"
        if kind == "Match":
            subject = self.expr(p["variant"], scope, pre, d)
            arms = []
            for case in p["cases"]:
                arms.append(f"{case['case']!r}: {self.callback_expr(case['body'], [case['variable']], scope, pre)}")
            return f"{subject}.match({{{', '.join(arms)}}})"
        if kind == "TryCatch":
            body = self.callback_expr(p["try_body"], [], scope, pre)
            handler = self.callback_expr(p["catch_body"], [p["message"], p["stack"]], scope, pre)
            fin = p["finally_body"]
            text = f"East.try_catch({body}, {handler}"
            if not (fin.type == "Value" and fin.value["type"].type == "Null"):
                text += f", {self.callback_expr(fin, [], scope, pre)}"
            return text + ")"
        if kind == "Block":
            return f"East.block({self.callback_expr(node, [], scope, pre)})"
        if kind in _STATEMENT_KINDS:
            raise Unprintable(f"{kind} node in expression position")
        raise Unprintable(f"unknown node kind {kind}")

    def traced_expr(self, node: Any, scope: _Scope, pre: list[str], depth: int) -> str:
        """An expression that must be a traced Expression, not a python
        literal (an ``if_else`` predicate): literals go through East.value."""
        if node.type == "Value":
            lit = node.value["value"]
            if lit.type == "Null":
                return "East.value(east_null, NullType)"
            if lit.type == "DateTime":
                self.uses_datetime = True
            return f"East.value({_pyliteral(lit.value)}, {self.type_ref(node.value['type'])})"
        return self.expr(node, scope, pre, depth)

    def arm_expr(self, body: Any, scope: _Scope, pre: list[str], depth: int) -> str:
        """An if_else arm: an expression, or a Block as ``East.block(def)``."""
        if body.type == "Block":
            return f"East.block({self.callback_expr(body, [], scope, pre)})"
        return self.expr(body, scope, pre, depth)

    def callback_expr(self, body: Any, params: list[Any], scope: _Scope, pre: list[str],
                      order: list[int] | None = None) -> str:
        """A callback: ``lambda params: expr`` when the body is one
        expression, else a ``def`` helper. ``order`` permutes the declared
        parameters into the python surface's order (a ``dict_kv`` slot)."""
        inner = _Scope(scope)
        names = [self.bind(inner, v) for v in params]
        if order is not None:
            names = [names[i] for i in order]
        # Trailing parameters default to None: a python method may call the
        # callback with fewer arguments than the builtin declares (an index
        # it does not pass), and the traced Function node still declares the
        # builtin's full signature.
        names = [n if i == 0 else f"{n}=None" for i, n in enumerate(names)]
        if body.type != "Block" and body.type not in _STATEMENT_KINDS and not (
            body.type in ("IfElse", "Match", "TryCatch") and body.value["type"].type in ("Null", "Never")
        ):
            sub: list[str] = []
            text = self.expr(body, inner, sub)
            if not sub:
                return f"lambda {', '.join(names)}: {text}"
            # the expression needed helpers: a def carries them
            name = self.fresh_helper("b")
            pre.append(f"def {name}({', '.join(names)}):")
            pre.extend("    " + ln for ln in sub)
            pre.append(f"    return {text}")
            return name
        name = self.fresh_helper("b")
        lines = self.body_lines(body, inner)
        pre.append(f"def {name}({', '.join(names)}):")
        pre.extend("    " + ln for ln in lines)
        return name

    # ── builtins ─────────────────────────────────────────────────────────

    def builtin_expr(self, node: Any, scope: _Scope, pre: list[str], depth: int) -> str:
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
                   pre: list[str], depth: int) -> str | None:
        texts: list[str] = []
        for i, arg in enumerate(args):
            adapter = row.callbacks.get(i)
            if adapter is None:
                # The first operand is always a traced Expression: python
                # would otherwise fold two literals itself ('a' + 'b') or
                # run a namespace call eagerly (East.Integer.divide(1, 0)).
                texts.append(self.traced_expr(arg, scope, pre, depth) if i == 0
                             else self.expr(arg, scope, pre, depth))
                continue
            if arg.type != "Function":
                # a function VALUE in a callback slot (a variable, a call)
                texts.append(self.expr(arg, scope, pre, depth))
                continue
            rendered = self.callback_for(adapter, arg, scope, pre)
            if rendered is None:
                return None
            texts.append(rendered)
        tps = {f"T{i}": self.type_ref(t) for i, t in enumerate(p["type_parameters"])}
        try:
            return row.template.format(*texts, **tps)
        except (IndexError, KeyError):
            return None

    def callback_for(self, adapter: str, fn: Any, scope: _Scope, pre: list[str]) -> str | None:
        fp = fn.value
        params = list(fp["parameters"])
        if adapter == "cb":
            return self.callback_expr(fp["body"], params, scope, pre)
        if adapter == "dict_kv":
            if len(params) != 2:
                return None
            return self.callback_expr(fp["body"], params, scope, pre, order=[1, 0])
        if adapter == "acc_kv":
            if len(params) != 3:
                return None
            return self.callback_expr(fp["body"], params, scope, pre, order=[0, 2, 1])
        if adapter == "kv1":
            if len(params) < 1 or self.mentions(fp["body"], [v.value["name"] for v in params[1:]]):
                return None
            return self.callback_expr(fp["body"], params[:1], scope, pre)
        if adapter in ("trim", "value"):
            if self.mentions(fp["body"], [v.value["name"] for v in params]):
                return None
            if adapter == "value":
                return self.expr(fp["body"], scope, pre) if fp["body"].type != "Block" else None
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

    def raw_builtin(self, node: Any, scope: _Scope, pre: list[str], depth: int) -> str:
        p = node.value
        self.raw_builtins.add(p["builtin"])
        args = ", ".join(self.traced_expr(a, scope, pre, depth) if i == 0
                         else self.expr(a, scope, pre, depth)
                         for i, a in enumerate(p["arguments"]))
        tps = ", ".join(self.type_ref(t) for t in p["type_parameters"])
        return (f"East.builtin({p['builtin']!r}, [{tps}], [{args}], "
                f"{self.type_ref(p['type'])})")

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
        scope = _Scope(None)
        p = root.value
        fn_t = p["type"]
        inner = _Scope(scope)
        params = [self.bind(inner, v) for v in p["parameters"]]
        body: list[str] = []
        for let in consts:
            # A python artifact's hoisted constants become the body's consts.
            if let.type != "Let":
                raise Unprintable(f"{let.type} before the root function")
            body.extend(self.statement_lines(let, inner, False))
        body.extend(self.body_lines(p["body"], inner))
        ctor = "East.asyncFunction" if root.type == "AsyncFunction" else "East.function"
        inputs = ", ".join(self.type_ref(t) for t in fn_t.value["inputs"])
        out = self.type_ref(fn_t.value["output"])
        fn_name = f"_{self.root_name}"
        lines = [
            "# Generated by east-py transpile — East IR printed as the East.function",
            "# builder surface. Rebuilding this module yields the same IR (normalized).",
            "from east import (  # noqa: F401",
            "    East, variant, some, none, east_null,",
            "    " + ", ".join(TYPE_IMPORTS) + ",",
            ")",
            "from east.types.types import recursive_type  # noqa: F401",
        ]
        if self.uses_datetime:
            lines.append("from datetime import datetime, timezone")
        lines.append("")
        for _key, (name, src) in self.types.items():
            lines.append(f"{name} = {src}")
        if self.types:
            lines.append("")
        lines.extend(self.platform_decls)
        if self.platform_decls:
            lines.append("")
        lines.append(f"def {fn_name}({', '.join(params)}):")
        lines.extend("    " + ln for ln in body)
        lines.append("")
        lines.append(f"{self.root_name} = {ctor}([{inputs}], {out}, {fn_name}, cse=False)")
        lines.append("")
        return "\n".join(lines)


def _ir_of(fn_or_ir: Any) -> Any:
    ir = getattr(fn_or_ir, "_east_ir", None)
    if ir is not None:
        return ir
    if isinstance(fn_or_ir, EastVariant):
        return fn_or_ir
    raise TypeError("to_python_source takes an East.function result or an IR value")


def to_python_source(fn_or_ir: Any, *, name: str | None = None) -> str:
    """Print East IR as a python module that rebuilds it.

    Args:
        fn_or_ir: A built ``East.function`` / ``East.asyncFunction`` artifact,
            or a homoiconic IR value (a Function/AsyncFunction node, or the
            ``Block[Let…, Function]`` a build with hoisted constants emits —
            its constants become the body's first ``East.const``s).
        name: The module-level name bound to the rebuilt function
            (default ``"main"``).

    Returns:
        The module source. Importing it (or ``exec``-ing it) binds ``name``
        to an ``East.function`` built with ``cse=False``, whose IR
        normalizes equal to the input's (``east-c ir normalize``).

    Raises:
        Unprintable: For a shape the python surface cannot spell — a
            statement in expression position, a jump to no loop, an
            unknown node kind. Builtins without a python spelling print
            through ``East.builtin(...)`` and are never unprintable.
    """
    printer = _Printer(name or "main")
    return printer.module(_ir_of(fn_or_ir))
