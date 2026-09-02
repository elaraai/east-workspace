#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""East-ness (#638): which files are East, which callables are bodies the
builder runs over expression proxies, and which names hold expressions.

A file is East when it imports ``east``; the rules are inert elsewhere, as
the TypeScript rules self-gate on an ``@elaraai/*`` import. A **body** is:

- the ``body`` of ``East.function`` / ``East.asyncFunction`` (its third
  argument, a lambda or a module-level ``def``) or a ``def`` decorated with
  either;
- any callable nested in a body — a builtin's callback (``xs.map(lambda b,
  x: …)``) or a statement construct's body (``b.if_(p, lambda b: …)``);
- outside any body, a callable passed to a callback-taking expression
  method of an EAST value — an eager callback (``items.map(lambda b, row:
  …)`` inside a ``@platform_function``), which the builder builds exactly
  the same way. The receiver must be evidenced as East: a name bound by a
  call rooted at an ``east`` import (``EastArray(…)``, ``East.new_dict(…)``),
  a parameter a ``@platform_function`` declares with an East input type, or
  a name assigned from a chain on one of those. A python list's
  ``.sort(key=lambda d: …)`` shares the method name and is not a body.

The callback-taking method names come from the codegen spelling table and
the statement-construct names from the ``Block`` class itself, so this
module carries no list of its own.
"""

from __future__ import annotations

import ast
import re

from east.diagnostics.types import Body, Context

FUNCTION_CTORS = frozenset({"function", "asyncFunction", "async_function"})


def _callback_methods() -> frozenset[str]:
    """The expression methods that take a callback, read off the spelling
    table's rows (``{0}.map({1})`` with a callback in slot 1)."""
    from east.codegen.spellings import SPELLINGS

    names: set[str] = set()
    for row in SPELLINGS.values():
        if not row.callbacks:
            continue
        m = re.match(r"\{\d+\}\.(\w+)\(", row.template)
        if m:
            names.add(m.group(1))
    return frozenset(names)


def _statement_methods() -> frozenset[str]:
    """The ``b.…`` statement forms: the public methods of the block and of
    its if / try builders."""
    from east.expression.statements import Block, IfBuilder, TryBuilder

    names: set[str] = set()
    for cls in (Block, IfBuilder, TryBuilder):
        names.update(n for n in vars(cls) if not n.startswith("_") and callable(vars(cls)[n]))
    return frozenset(names)


CALLBACK_METHODS = _callback_methods()
STATEMENT_METHODS = _statement_methods()
#: the statement forms whose argument is a BODY (a lambda / def taking the block)
BODY_STATEMENTS = frozenset({"if_", "else_if", "else_", "match_", "while_", "for_", "try_", "catch", "finally_"})


def is_east_module(tree: ast.Module) -> bool:
    for node in ast.walk(tree):
        if isinstance(node, ast.Import) and any(a.name == "east" or a.name.startswith("east.") for a in node.names):
            return True
        if isinstance(node, ast.ImportFrom) and node.module and (node.module == "east" or node.module.startswith("east.")):
            return True
    return False


def collect_module_scope(ctx: Context) -> None:
    """Record what the module binds at top level: imports (with their module
    paths), plain python defs, ``East.function`` artifacts, and the names
    ``East`` goes by."""
    for node in ctx.tree.body:
        if isinstance(node, ast.Import):
            for a in node.names:
                ctx.imports[(a.asname or a.name).split(".")[0]] = a.name
                if a.name == "east":
                    ctx.east_names.add(a.asname or "east")
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            for a in node.names:
                ctx.imports[a.asname or a.name] = f"{module}.{a.name}" if module else a.name
                if module == "east" and a.name == "East":
                    ctx.east_names.add(a.asname or "East")
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            if any(_is_east_ctor_call(d, ctx) for d in node.decorator_list):
                ctx.east_artifacts.add(node.name)
            elif not any(_is_platform_decorator(d, ctx) for d in node.decorator_list):
                ctx.python_defs.add(node.name)
        elif isinstance(node, ast.Assign):
            if _is_east_ctor_call(node.value, ctx) or _is_east_import_call(node.value, ctx):
                for t in node.targets:
                    if isinstance(t, ast.Name):
                        ctx.east_artifacts.add(t.id)


def is_east_ref(node: ast.AST, ctx: Context) -> bool:
    """Whether ``node`` is the ``East`` namespace (``East`` or ``east.East``)."""
    if isinstance(node, ast.Name):
        return node.id in ctx.east_names
    return (isinstance(node, ast.Attribute) and node.attr == "East"
            and isinstance(node.value, ast.Name) and node.value.id in ctx.east_names)


def _is_east_ctor_call(node: ast.AST, ctx: Context) -> bool:
    return (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
            and node.func.attr in FUNCTION_CTORS and is_east_ref(node.func.value, ctx))


def _is_east_import_call(node: ast.AST, ctx: Context) -> bool:
    return (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
            and node.func.attr in ("import_function", "importFunction") and is_east_ref(node.func.value, ctx))


def _is_platform_decorator(node: ast.AST, ctx: Context) -> bool:
    target = node.func if isinstance(node, ast.Call) else node
    name = target.attr if isinstance(target, ast.Attribute) else getattr(target, "id", "")
    return name in ("platform_function", "generic_platform_function")


def _declared_arity(call: ast.Call) -> int | None:
    if call.args and isinstance(call.args[0], (ast.List, ast.Tuple)):
        return len(call.args[0].elts)
    return None


def _chain_root(node: ast.AST) -> ast.AST:
    """The name a call / attribute / subscript chain is rooted at."""
    while isinstance(node, (ast.Attribute, ast.Call, ast.Subscript)):
        node = node.func if isinstance(node, ast.Call) else node.value
    return node


def _rooted_at_east(node: ast.AST, ctx: Context) -> bool:
    """Whether a chain is rooted at an ``east`` import (``East.new_dict(…)``,
    ``EastArray(…)``, ``east.types.values.EastDict(…)``)."""
    root = _chain_root(node)
    if not isinstance(root, ast.Name):
        return False
    if root.id in ctx.east_names:
        return True
    module = ctx.imports.get(root.id)
    return module is not None and (module == "east" or module.startswith("east."))


def east_evidence(ctx: Context) -> set[str]:
    """The names that evidently hold East VALUES outside any body: bound by
    a call rooted at an ``east`` import, declared as a ``@platform_function``
    input with an East type, or assigned from a chain on such a name — to a
    fixpoint. What makes an eager callback's receiver an East value."""
    names: set[str] = set()
    for node in ast.walk(ctx.tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for d in node.decorator_list:
                if not (isinstance(d, ast.Call) and _is_platform_decorator(d, ctx)):
                    continue
                inputs = next((k.value for k in d.keywords if k.arg == "inputs"), None)
                if not isinstance(inputs, (ast.List, ast.Tuple)):
                    continue
                params = [a.arg for a in [*node.args.posonlyargs, *node.args.args]]
                for param, declared in zip(params, inputs.elts, strict=False):
                    if _rooted_at_east(declared, ctx):
                        names.add(param)
    changed = True
    while changed:
        changed = False
        for node in ast.walk(ctx.tree):
            if not (isinstance(node, ast.Assign) and len(node.targets) == 1
                    and isinstance(node.targets[0], ast.Name)):
                continue
            target = node.targets[0].id
            if target in names:
                continue
            root = _chain_root(node.value)
            if _rooted_at_east(node.value, ctx) or (isinstance(root, ast.Name) and root.id in names):
                names.add(target)
                changed = True
    return names


def collect_bodies(ctx: Context) -> None:
    """Find every body and its nesting; fill their parameter and expression names."""
    defs = {n.name: n for n in ctx.tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}
    roots: list[Body] = []
    seen: set[int] = set()

    def root(node: ast.Lambda | ast.FunctionDef | ast.AsyncFunctionDef, kind: str, arity: int | None) -> None:
        if id(node) in seen:
            return
        seen.add(id(node))
        body = Body(node=node, kind=kind, declared_arity=arity)  # type: ignore[arg-type]
        roots.append(body)

    for node in ast.walk(ctx.tree):
        # East.function([...], T, body) / body= keyword — a lambda or a def by name
        if _is_east_ctor_call(node, ctx):
            call = node  # type: ignore[assignment]
            target = call.args[2] if len(call.args) >= 3 else next((k.value for k in call.keywords if k.arg == "body"), None)
            if isinstance(target, ast.Lambda):
                root(target, "function", _declared_arity(call))
            elif isinstance(target, ast.Name) and target.id in defs:
                root(defs[target.id], "function", _declared_arity(call))
        # @East.function([...], T) def body(b, …)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for d in node.decorator_list:
                if _is_east_ctor_call(d, ctx):
                    root(node, "function", _declared_arity(d))  # type: ignore[arg-type]
    # eager callbacks: a lambda / def passed straight to a callback-taking
    # method of an evidenced East value
    evidence = east_evidence(ctx)
    for node in ast.walk(ctx.tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr in CALLBACK_METHODS:
            receiver = _chain_root(node.func.value)
            if not (isinstance(receiver, ast.Name) and receiver.id in evidence) \
                    and not _rooted_at_east(node.func.value, ctx):
                continue
            for arg in [*node.args, *(k.value for k in node.keywords)]:
                if isinstance(arg, ast.Lambda):
                    root(arg, "eager", None)
                elif isinstance(arg, ast.Name) and arg.id in defs:
                    root(defs[arg.id], "eager", None)

    # nested bodies: every callable inside a body is a body
    def nest(body: Body) -> None:
        stack: list[ast.AST] = [body.node.body] if isinstance(body.node, ast.Lambda) else list(body.node.body)  # type: ignore[list-item]
        while stack:
            n = stack.pop()
            if isinstance(n, list):
                stack.extend(n)
                continue
            if isinstance(n, (ast.Lambda, ast.FunctionDef, ast.AsyncFunctionDef)):
                child = Body(node=n, kind=_nested_kind(n, body), parent=body)
                body.children.append(child)
                seen.add(id(n))
                nest(child)
                continue
            stack.extend(ast.iter_child_nodes(n))

    # a root may sit inside another root's body (a def passed by name from
    # inside a body is rare; a lambda root inside a body is a callback)
    for body in roots:
        nest(body)
    top = [b for b in roots if not any(b is not o and _inside(b.node, o.node) for o in roots)]
    for body in top:
        _fill_names(body)
    ctx.bodies = top


def _inside(node: ast.AST, container: ast.AST) -> bool:
    return any(n is node for n in ast.walk(container))


def _nested_kind(node: ast.AST, parent: Body) -> str:
    """A nested callable is a statement body when it is the argument of a
    ``b.<statement>(…)`` call on the parent's block, a callback otherwise."""
    for n in ast.walk(parent.node):
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr in BODY_STATEMENTS:
            if any(a is node for a in n.args) or any(k.value is node for k in n.keywords):
                return "statement"
    return "callback"


def _fill_names(body: Body) -> None:
    node = body.node
    args = node.args
    names = [a.arg for a in [*args.posonlyargs, *args.args]]
    body.block = names[0] if names else None
    body.params = names[1:]
    body.expr_names = set(body.params)
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        # x = b.let(...) / b.const(...) and names assigned from expressions, to a fixpoint
        changed = True
        while changed:
            changed = False
            for stmt in ast.walk(node):
                if isinstance(stmt, ast.Assign) and len(stmt.targets) == 1 and isinstance(stmt.targets[0], ast.Name):
                    target = stmt.targets[0].id
                    if target in body.expr_names:
                        continue
                    value = stmt.value
                    if _is_block_binding(value, body.block) or body.is_expression(value):
                        body.expr_names.add(target)
                        changed = True
    for child in body.children:
        _fill_names(child)


def _is_block_binding(value: ast.AST, block: str | None) -> bool:
    return (block is not None and isinstance(value, ast.Call) and isinstance(value.func, ast.Attribute)
            and value.func.attr in ("let", "const") and isinstance(value.func.value, ast.Name)
            and value.func.value.id == block)
