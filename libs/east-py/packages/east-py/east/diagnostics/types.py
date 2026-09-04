#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The diagnostic, the rule contract and the per-file context (#638)."""

from __future__ import annotations

import ast
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol, runtime_checkable

Category = Literal["error", "warning", "suggestion"]

#: The flake8 code prefix every rule shares: ``EAS`` + the rule's number.
CODE_PREFIX = "EAS"


@dataclass(frozen=True)
class Diagnostic:
    """One finding: where, which rule, and the build-time text."""

    rule: str
    code: int
    message: str
    line: int
    column: int
    end_line: int
    end_column: int
    category: Category = "error"

    @property
    def flake8_code(self) -> str:
        return f"{CODE_PREFIX}{self.code:03d}"

    def format(self, filename: str) -> str:
        """``file:line:col: category [rule] message`` — one line, like ruff."""
        return f"{filename}:{self.line}:{self.column}: {self.category} [{self.rule}] {self.message}"


@dataclass
class Body:
    """A callable the East builder runs over expression proxies: an
    ``East.function`` body, a builtin's callback, a statement construct's
    body, or an eager method's callback lambda.

    ``block`` is the name of its first parameter — python's ``$`` — or
    ``None`` when the body declares no parameters at all. ``params`` are the
    remaining parameters (expressions), ``expr_names`` every name the body
    holds an expression under (parameters, ``b.let`` / ``b.const`` targets,
    and names assigned from them).
    """

    node: ast.Lambda | ast.FunctionDef | ast.AsyncFunctionDef
    kind: Literal["function", "callback", "statement", "eager"]
    parent: Body | None = None
    #: the declared parameter count when the ``East.function`` call spells its
    #: parameter types as a list literal (``None`` when it cannot be read)
    declared_arity: int | None = None
    block: str | None = None
    params: list[str] = field(default_factory=list)
    expr_names: set[str] = field(default_factory=set)
    children: list[Body] = field(default_factory=list)

    @property
    def all_params(self) -> list[str]:
        return ([self.block] if self.block is not None else []) + self.params

    def owns(self, node: ast.AST) -> bool:
        """Whether ``node`` sits in this body and not in a nested one."""
        return _owner(node, self) is self

    def is_expression(self, node: ast.AST) -> bool:
        """Whether ``node`` denotes an East expression: a name the body holds
        an expression under (or one of an enclosing body), or an attribute /
        call / subscript chain rooted at one."""
        root = node
        while isinstance(root, (ast.Attribute, ast.Call, ast.Subscript)):
            root = root.func if isinstance(root, ast.Call) else root.value
        if not isinstance(root, ast.Name):
            return False
        body: Body | None = self
        while body is not None:
            if root.id in body.expr_names:
                return True
            body = body.parent
        return False

    def outer_blocks(self) -> set[str]:
        """The block names of every enclosing body."""
        names: set[str] = set()
        body = self.parent
        while body is not None:
            if body.block is not None:
                names.add(body.block)
            body = body.parent
        return names


def _owner(node: ast.AST, body: Body) -> Body | None:
    """The innermost body (among ``body`` and its descendants) holding ``node``."""
    owner = body if _contains(body.node, node) else None
    if owner is None:
        return None
    for child in body.children:
        inner = _owner(node, child)
        if inner is not None:
            return inner
    return owner


def _contains(root: ast.AST, node: ast.AST) -> bool:
    return any(n is node for n in ast.walk(root))


class Context:
    """What a rule sees for one file: the source, the East bodies, the
    module-level names, and ``report``."""

    def __init__(self, source: str, filename: str, tree: ast.Module) -> None:
        self.source = source
        self.filename = filename
        self.tree = tree
        self.lines = source.splitlines()
        self.diagnostics: list[Diagnostic] = []
        #: module-level names bound by ``import`` / ``from … import``, to their module path
        self.imports: dict[str, str] = {}
        #: the ``from M import n`` bindings among them: name -> (module, attribute)
        self.from_imports: dict[str, tuple[str, str]] = {}
        #: module-level names bound to a plain python ``def`` (not an East artifact)
        self.python_defs: set[str] = set()
        #: module-level names bound to an ``East.function`` artifact (callable in a body)
        self.east_artifacts: set[str] = set()
        #: the names the module binds to the ``East`` namespace object
        self.east_names: set[str] = set()
        self.bodies: list[Body] = []
        self._body_node_ids: set[int] | None = None

    def in_body(self, node: ast.AST) -> bool:
        """Whether ``node`` sits inside ANY East body.

        What a module-scope rule asks so it does not re-report what the
        body walk already covers. The id set is built once per file, on
        first use, after :func:`collect_bodies` has filled ``bodies``.
        """
        if self._body_node_ids is None:
            ids: set[int] = set()

            def walk(body: Body) -> None:
                ids.update(id(n) for n in ast.walk(body.node))
                for child in body.children:
                    walk(child)

            for body in self.bodies:
                walk(body)
            self._body_node_ids = ids
        return id(node) in self._body_node_ids

    def report(self, node: ast.AST, rule: Rule, message: str, category: Category | None = None) -> None:
        line = getattr(node, "lineno", 1)
        column = getattr(node, "col_offset", 0) + 1
        end_line = getattr(node, "end_lineno", line) or line
        end_column = (getattr(node, "end_col_offset", None) or column - 1) + 1
        self.diagnostics.append(Diagnostic(
            rule=rule.name, code=rule.code, message=message,
            line=line, column=column, end_line=end_line, end_column=end_column,
            category=category or rule.category))


class Rule(Protocol):
    """One rule: a name, a stable number, and ``check`` over every body.

    ``supersedes`` names the rules this one wins over where their findings
    overlap — the precedence relation :func:`east.diagnostics.run_east_rules`
    applies so that one mistake yields one finding. A rule that supersedes
    nothing declares the empty tuple; a rule never supersedes itself, and the
    relation must be acyclic (the engine pins both).
    """

    name: str
    code: int
    category: Category
    description: str
    supersedes: tuple[str, ...]

    def check(self, body: Body, ctx: Context) -> None: ...


@runtime_checkable
class ModuleRule(Protocol):
    """A rule that also reads MODULE scope — the build-time concerns that are
    not inside any body (a clock read at import, a literal credential, data
    loaded at module load, a duplicated definition name). ``check_module``
    runs once per file, before the bodies are walked."""

    def check_module(self, ctx: Context) -> None: ...


def body_nodes(body: Body) -> Iterable[ast.AST]:
    """Every node of ``body``'s own code — not the nodes of nested bodies,
    which are visited as their own bodies — excluding the callable node
    itself and its parameter list."""
    nested = {id(child.node) for child in body.children}
    stack: list[ast.AST] = [body.node.body] if isinstance(body.node, ast.Lambda) else list(body.node.body)
    while stack:
        node = stack.pop()
        if isinstance(node, list):
            stack.extend(node)
            continue
        if id(node) in nested:
            continue
        yield node
        stack.extend(ast.iter_child_nodes(node))


def call_method(node: ast.AST) -> tuple[ast.AST, str] | None:
    """``(receiver, name)`` when ``node`` is a method call ``receiver.name(...)``."""
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
        return node.func.value, node.func.attr
    return None


def is_name(node: ast.AST, name: str) -> bool:
    return isinstance(node, ast.Name) and node.id == name


RuleFactory = Callable[[], Any]
