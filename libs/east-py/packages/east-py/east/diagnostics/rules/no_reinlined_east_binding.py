#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``no-reinlined-east-binding``: a python local holding an East EXPRESSION
names a tree, not a binding — the builder re-emits it, and the compiled
program re-evaluates it, at every read. Read twice in one body it runs twice;
read inside a per-element callback, a loop body or a nested function it runs
per element, per iteration, per call. ``b.const`` / ``b.let`` bind it once
(TypeScript's ``$.const``). The TypeScript rule of the same name — its python
twin since #1312 removed the trace-time pass that bound a reused local to one
``Let`` (it moved reads across mutations it could not see).

What is flagged, exactly, so a correct program is never asked to change:

- the local's value must COMPUTE something — a call, an operator, an index,
  a fresh collection; a bare alias (``a = xs``) or a field read (``q = r.qty``)
  re-emits a variable or a ``GetField`` and is left alone;
- reads are counted per body: two reads in the body that bound the local, or
  two reads inside one nested once-only body (a ``b.if_`` arm, a ``.match``
  arm, a handler) are two evaluations; one read in each of two EXCLUSIVE arms
  — the arms of ``East.if_else``, ``b.if_ … .else_`` — is at most one, and is
  not flagged (binding a guarded partial read above its guard would raise on
  the path the guard excludes);
- one read inside a body that RUNS REPEATEDLY — a per-element callback, a
  ``b.for_`` / ``b.while_`` / ``East.for_`` / ``East.while_`` body, a nested
  ``East.function`` — is an evaluation per run and is flagged; a body the
  rule cannot classify counts as once-only and stays silent.
"""

from __future__ import annotations

import ast

from east.diagnostics.scope import CALLBACK_METHODS, _is_east_ctor_call, is_east_ref, rooted_at_east
from east.diagnostics.types import Body, Context, body_nodes

#: Callback-taking methods whose body runs ONCE per call: a default producer,
#: a single-key upsert or merge. Every other name in ``CALLBACK_METHODS`` runs
#: its body per element; ``tests/diagnostics/test_rules.py`` pins the partition.
ONCE_CALLBACK_METHODS = frozenset({"get", "get_or_insert", "insert_or_update", "merge"})

#: Composed methods of the expression classes that run a body per element but
#: are not builtin rows of their own (they compose the builtins).
COMPOSED_REPEATING_METHODS = frozenset({
    "some", "every", "sum", "mean", "maximum", "minimum", "find_all", "find_maximum", "find_minimum",
    "group_by", "group_size", "group_sum", "group_every", "group_some", "group_maximum",
    "group_minimum", "group_mean", "group_to_arrays", "group_to_sets", "group_to_dicts",
    "group_find_all", "group_find_first", "group_find_maximum", "group_find_minimum",
    "group_fold", "fold", "sorted", "generate", "map_elements", "map_batches", "update_many",
})

#: The methods whose body runs per element, per key or per iteration.
REPEATING_METHODS = (CALLBACK_METHODS - ONCE_CALLBACK_METHODS) | COMPOSED_REPEATING_METHODS
#: The loop forms, as statements on the block and as ``East.`` expression forms.
LOOP_METHODS = frozenset({"for_", "while_"})
#: The East constructors whose every evaluation is a FRESH mutable value: two
#: reads are two values.
FRESH_CONSTRUCTORS = frozenset({"new_array", "new_set", "new_dict", "ref", "new_vector", "new_matrix"})


def read_times_message(name: str, times: int) -> str:
    return (f"`{name}` holds an East expression and is read {times} times in this body — each read "
            f"re-emits it, so it runs {times} times. Bind it once, `{name} = b.const(...)` (or b.let), "
            "where it is needed, and read the binding")


def repeated_body_message(name: str, what: str) -> str:
    return (f"`{name}` holds an East expression built outside this {what} and is read inside it — the "
            f"{what} re-evaluates it every time it runs. Bind it once, `{name} = b.const(...)` (or "
            "b.let), before the call, and read the binding")


class NoReinlinedEastBinding:
    name = "no-reinlined-east-binding"
    code = 26
    category = "warning"
    description = ("A python local holding an East expression is re-emitted at every read — bind it "
                   "once with b.const / b.let.")

    def check(self, body: Body, ctx: Context) -> None:
        bindings = _computed_bindings(body, ctx)
        if not bindings:
            return
        arms = _if_else_arms(body, ctx)
        for name, assign in bindings.items():
            same: dict[tuple, int] = {}
            repeated: str | None = None
            for read, inner in _reads(body, name):
                what = _repeating_host_between(inner, body, ctx)
                if what is not None:
                    repeated = repeated or what
                    continue
                key = (id(inner), arms.get(id(read)) if inner is body else None)
                same[key] = same.get(key, 0) + 1
            worst = max(same.values(), default=0)
            if worst >= 2:
                ctx.report(assign, self, read_times_message(name, worst))
            elif repeated is not None:
                ctx.report(assign, self, repeated_body_message(name, repeated))


# ── what a local holds ───────────────────────────────────────────────────────


def _computed_bindings(body: Body, ctx: Context) -> dict[str, ast.Assign]:
    """The body's own ``name = <expression that computes>`` statements, by
    name — one assignment per name (a rebound name is left alone: which tree
    a read names depends on where it sits)."""
    found: dict[str, ast.Assign] = {}
    assigned: dict[str, int] = {}
    for node in body_nodes(body):
        if not (isinstance(node, ast.Assign) and len(node.targets) == 1
                and isinstance(node.targets[0], ast.Name)):
            continue
        target = node.targets[0].id
        assigned[target] = assigned.get(target, 0) + 1
        if _is_block_binding(node.value, body) or not _computes(node.value):
            continue
        if _is_expression_value(node.value, body, ctx):
            found[target] = node
    return {name: node for name, node in found.items() if assigned[name] == 1}


def _is_block_binding(value: ast.AST, body: Body) -> bool:
    return (body.block is not None and isinstance(value, ast.Call) and isinstance(value.func, ast.Attribute)
            and value.func.attr in ("let", "const") and isinstance(value.func.value, ast.Name)
            and value.func.value.id == body.block)


def _computes(value: ast.AST) -> bool:
    """Whether the value is more than a name or a field read: a call, an
    operator, an index — something a read re-RUNS."""
    return any(isinstance(n, (ast.Call, ast.BinOp, ast.UnaryOp, ast.Compare, ast.BoolOp, ast.Subscript))
               for n in ast.walk(value))


def _is_expression_value(value: ast.AST, body: Body, ctx: Context) -> bool:
    """Whether the value is an East expression: rooted at a name the body
    holds an expression under, a call of an ``East.function`` artifact or of
    the ``East`` namespace over an expression, or a fresh East collection."""
    if body.is_expression(value):
        return True
    if not isinstance(value, ast.Call):
        return False
    args = [*value.args, *(k.value for k in value.keywords)]
    func = value.func
    if isinstance(func, ast.Name) and func.id in ctx.east_artifacts:
        return any(body.is_expression(a) for a in args)
    if isinstance(func, ast.Attribute) and func.attr in FRESH_CONSTRUCTORS and is_east_ref(func.value, ctx):
        return True
    if rooted_at_east(value, ctx):
        callee = func.attr if isinstance(func, ast.Attribute) else getattr(func, "id", "")
        if callee.endswith("Type") or callee == "recursive_type":
            return False  # a type, not an expression
        return any(body.is_expression(a) for a in args)
    return False


# ── where it is read ─────────────────────────────────────────────────────────


def _reads(body: Body, name: str):
    """``(read, innermost body)`` for every load of ``name`` under ``body``."""
    for node in ast.walk(body.node):
        if isinstance(node, ast.Name) and node.id == name and isinstance(node.ctx, ast.Load):
            yield node, _innermost(body, node)


def _innermost(body: Body, node: ast.AST) -> Body:
    for child in body.children:
        if any(n is node for n in ast.walk(child.node)):
            return _innermost(child, node)
    return body


def _if_else_arms(body: Body, ctx: Context) -> dict[int, int]:
    """node id -> the id of the ``East.if_else`` ARM it sits in, for the body's
    own nodes: the value arms and the else arm are exclusive, the predicates
    are not. An inner conditional's arm wins over an outer one's."""
    arms: dict[int, int] = {}
    for node in body_nodes(body):
        if not (isinstance(node, ast.Call) and _is_if_else(node, ctx)):
            continue
        args = node.args
        for i, arg in enumerate(args):
            if i % 2 == 1 or i == len(args) - 1:
                for inner in ast.walk(arg):
                    arms[id(inner)] = id(arg)
    return arms


def _is_if_else(call: ast.Call, ctx: Context) -> bool:
    func = call.func
    if isinstance(func, ast.Attribute):
        return func.attr == "if_else" and is_east_ref(func.value, ctx)
    return isinstance(func, ast.Name) and ctx.from_imports.get(func.id) == ("east", "if_else")


def _repeating_host_between(inner: Body, outer: Body, ctx: Context) -> str | None:
    """The kind of the outermost body between ``outer`` (exclusive) and
    ``inner`` (inclusive) that runs more than once per run of ``outer`` —
    ``"callback"``, ``"loop body"`` or ``"nested function"`` — or ``None``."""
    chain: list[Body] = []
    cursor: Body | None = inner
    while cursor is not None and cursor is not outer:
        chain.append(cursor)
        cursor = cursor.parent
    for child in reversed(chain):
        what = _host_kind(child, ctx)
        if what is not None:
            return what
    return None


def _host_kind(child: Body, ctx: Context) -> str | None:
    """How often ``child`` runs per run of its parent, from the call it is
    handed to: a per-element method's callback, a loop body, a nested
    ``East.function``; ``None`` for a once-only or unclassified host."""
    parent = child.parent
    if parent is None:
        return None
    node = child.node
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and \
            any(_is_east_ctor_call(d, ctx) for d in node.decorator_list):
        return "nested function"
    call = _handed_to(node, parent)
    if call is None:
        return None
    if _is_east_ctor_call(call, ctx):
        return "nested function"
    func = call.func
    if not isinstance(func, ast.Attribute):
        return None
    method = func.attr
    receiver = func.value
    if method in LOOP_METHODS:
        blocks = parent.outer_blocks() | ({parent.block} if parent.block else set())
        if (isinstance(receiver, ast.Name) and receiver.id in blocks) or is_east_ref(receiver, ctx):
            return "loop body"
        return None
    if method in REPEATING_METHODS:
        return "callback"
    return None


def _handed_to(node: ast.AST, parent: Body) -> ast.Call | None:
    """The call ``node`` (a lambda, or a def by its name) is an argument of."""
    name = node.name if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) else None
    for n in ast.walk(parent.node):
        if not isinstance(n, ast.Call):
            continue
        for arg in [*n.args, *(k.value for k in n.keywords)]:
            if arg is node or (name is not None and isinstance(arg, ast.Name) and arg.id == name):
                return n
    return None
