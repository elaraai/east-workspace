#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Turning the lazy traced tree into the final homoiconic IR value.

Three concerns, in dependency order: computing a nested function's ``captures``
(``_free_vars``), converting every plain-list child of the traced tree into its
proper ``EastArray`` (``_arrayify_tree``), and the top-level assembly of a
function's Function node (``_function_ir``) — plus the two passes that embed a
function another build made into the open one (``_rehome_ir``,
``_rename_apart``, #1271/#1279).

The builder emits exactly what the body spells, as the TypeScript builder
does: a python variable holding an expression is re-emitted — and re-evaluated
— at every read, and sharing work is spelled ``b.const`` / ``b.let`` /
``East.let``, as it is ``$.const`` in TypeScript. There is no optimisation
pass here. The trace-time CSE that bound a reused python variable to one
``Let`` and hoisted callback invariants was removed (#1312): it decided what a
hoisted read could cross by variable name, and East values alias — a ``Let``
alias, a struct field, two parameters bound to one array, a callee's
parameter — so it moved reads above mutations and answered wrong, silently.
The ``no-reinlined-east-binding`` rule (``east.diagnostics``) points at the
explicit binding at edit time instead.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from east.expression.nodes import _k_function, _var
from east.types.types import EastType, FunctionType
from east.types.values import EastArray, EastStruct, EastVariant

if TYPE_CHECKING:
    from east.expression.expr import Expression


def _free_vars(node: Any, bound: frozenset, out: dict) -> None:
    """Collect Variable nodes under ``node`` not bound within it, by name.

    A nested Function IR node must LIST outer variables it uses in its
    ``captures`` — east-c resolves captures from the enclosing scope when the
    function value is created, and an unlisted one compiles to "Undefined
    variable". The traced tree may still hold lazy python lists (#411).
    """
    from east.types.values import is_east_struct, is_east_variant

    if isinstance(node, (list, EastArray)):
        for x in node:
            _free_vars(x, bound, out)
        return
    if is_east_struct(node):
        for _f, v in node.items():
            _free_vars(v, bound, out)
        return
    if not is_east_variant(node):
        return
    kind = node.type
    p = node.value
    if kind == "Variable":
        name = p["name"]
        if name not in bound and name not in out:
            out[name] = node
        return
    if kind in ("Function", "AsyncFunction"):
        for c in p["captures"]:
            cname = c.value["name"]
            if cname not in bound and cname not in out:
                out[cname] = c
        inner = bound | {v.value["name"] for v in p["parameters"]} \
                      | {c.value["name"] for c in p["captures"]}
        _free_vars(p["body"], inner, out)
        return
    if kind == "Block":
        scope = set(bound)
        for stmt in p["statements"]:
            if is_east_variant(stmt) and stmt.type == "Let":
                _free_vars(stmt.value["value"], frozenset(scope), out)
                scope.add(stmt.value["variable"].value["name"])
            else:
                _free_vars(stmt, frozenset(scope), out)
        return
    if kind == "Match":
        _free_vars(p["variant"], bound, out)
        for case in p["cases"]:
            _free_vars(case["body"], bound | {case["variable"].value["name"]}, out)
        return
    if kind == "Let":
        # A Let outside a Block (a single-statement body): its variable is
        # a BINDING, not a reference — only its value is walked. (Inside a
        # Block the Block case scopes it over the statements that follow.)
        _free_vars(p["value"], bound, out)
        return
    if kind == "Assign":
        _free_vars(p["variable"], bound, out)
        _free_vars(p["value"], bound, out)
        return
    if kind == "TryCatch":
        # The message/stack variables BIND over the catch arm only; the
        # generic walk below would report them free (and an enclosing
        # function would list them as captures east-c cannot resolve).
        _free_vars(p["try_body"], bound, out)
        caught = bound | {p["message"].value["name"], p["stack"].value["name"]}
        _free_vars(p["catch_body"], caught, out)
        _free_vars(p["finally_body"], bound, out)
        return
    if kind in ("ForArray", "ForSet", "ForDict"):
        # The loop variables BIND in the body. Left to the generic walk below
        # they would be collected as free and land in an enclosing function's
        # captures, where east-c resolves captures from the creating scope and
        # finds nothing — "Undefined variable" at compile time.
        source = {"ForArray": "array", "ForSet": "set", "ForDict": "dict"}[kind]
        _free_vars(p[source], bound, out)
        loop_vars = {p["key"].value["name"]}
        if kind != "ForSet":
            loop_vars.add(p["value"].value["name"])
        _free_vars(p["body"], bound | loop_vars, out)
        return
    if kind == "Value":
        return  # literals only
    if not is_east_struct(p):
        return  # scalar/None payload (type atoms, raw values)
    for fname, v in p.items():
        if fname in ("type", "loc_id", "type_parameters"):
            continue
        _free_vars(v, bound, out)


def _capturing_fn(fn_t: EastType, params: list, body_ir: Any, is_async: bool = False):
    """A Function (or AsyncFunction) IR node whose ``captures`` are computed
    from the body — every outer variable the body reads, in first-use order,
    each capture node the Variable node the body reads through."""
    from east.expression.nodes import _k_async_function

    free: dict[str, Any] = {}
    _free_vars(body_ir, frozenset(p.value["name"] for p in params), free)
    make = _k_async_function if is_async else _k_function
    return make(fn_t, list(free.values()), params, body_ir)


def _const_fn_node(param_types: list, body: Expression, out_t: EastType) -> Any:
    """A Function IR node ignoring its parameters and returning `body`."""
    from east.types.types import FunctionType as _FnType

    params = [_var(f"__d{i}", t) for i, t in enumerate(param_types)]
    fn_t = _FnType(list(param_types), out_t)
    return _capturing_fn(fn_t, params, body.ir)

# ─── The lazy tree and its final form ───────────────────────────────────────
#
# EastArray is a C-backed proxy whose every read materializes a fresh python
# object, so during tracing array-bearing nodes hold their children in plain
# python lists (``east.expression.nodes``): the passes below walk the tree by
# object identity (a memo per node, so a subtree the trace shared is rebuilt
# once), and ``_arrayify_tree`` converts every list to the proper EastArray in
# one rebuild, producing the final homoiconic value.

#: node kind -> (child field specs, extra array fields converted not walked).
#: A child spec is a field name, ("field", "list", ElementTypeThunk), or
#: ("field", "structs", ElementTypeThunk, (subfields...)).
def _node_specs():
    from east.types.type_of_type import (
        DictEntryType,
        EastTypeType,
        IfCaseType,
        IRType,
        MatchCaseType,
        StructFieldIRType,
    )

    ir = lambda: IRType  # noqa: E731
    return {
        "Value": ((), ()),
        "Variable": ((), ()),
        "Builtin": ((("arguments", "list", ir),), (("type_parameters", EastTypeType),)),
        "Platform": ((("arguments", "list", ir),), (("type_parameters", EastTypeType),)),
        "GetField": (("struct",), ()),
        "Struct": ((("fields", "structs", lambda: StructFieldIRType, ("value",)),), ()),
        "Variant": (("value",), ()),
        "NewArray": ((("values", "list", ir),), ()),
        "NewVector": ((("values", "list", ir),), ()),
        "NewMatrix": ((("values", "list", ir),), ()),
        "NewSet": ((("values", "list", ir),), ()),
        "NewDict": ((("values", "structs", lambda: DictEntryType, ("key", "value")),), ()),
        "Match": (("variant", ("cases", "structs", lambda: MatchCaseType, ("variable", "body"))), ()),
        "IfElse": ((("ifs", "structs", lambda: IfCaseType, ("predicate", "body")), "else_body"), ()),
        "Call": (("function", ("arguments", "list", ir)), ()),
        "TryCatch": (("try_body", "catch_body", "message", "stack", "finally_body"), ()),
        "Function": ((("captures", "list", ir), ("parameters", "list", ir), "body"), ()),
        "AsyncFunction": ((("captures", "list", ir), ("parameters", "list", ir), "body"), ()),
        "Let": (("variable", "value"), ()),
        "Assign": (("variable", "value"), ()),
        "Return": (("value",), ()),
        "As": (("value",), ()),
        "WrapRecursive": (("value",), ()),
        "UnwrapRecursive": (("value",), ()),
        "CallAsync": (("function", ("arguments", "list", ir)), ()),
        "Block": ((("statements", "list", ir),), ()),
        "Error": (("message",), ()),
        "NewRef": (("value",), ()),
        "While": (("predicate", "body"), ()),
        "ForArray": (("array", "key", "value", "body"), ()),
        "ForSet": (("set", "key", "body"), ()),
        "ForDict": (("dict", "key", "value", "body"), ()),
        "Break": ((), ()),
        "Continue": ((), ()),
    }


_SPECS = None


def _specs():
    global _SPECS
    if _SPECS is None:
        _SPECS = _node_specs()
    return _SPECS


def _node_children(node):
    """Yield the direct child IR nodes of a (lazy or final) node."""
    spec = _specs().get(node.type)
    if spec is None:
        return
    payload = node.value
    for entry in spec[0]:
        if isinstance(entry, str):
            yield payload[entry]
        elif entry[1] == "list":
            yield from payload[entry[0]]
        else:
            for sub in payload[entry[0]]:
                for f in entry[3]:
                    yield sub[f]


def _arrayify(node, children):
    """Rebuild ``node`` with ``children`` (its direct children, in
    ``_node_children`` order) as the final homoiconic value: every plain
    python list becomes the ``EastArray`` its IR field declares."""
    spec = _specs()[node.type]
    payload = node.value
    fields = {k: payload[k] for k in payload}
    it = iter(children)
    for entry in spec[0]:
        if isinstance(entry, str):
            fields[entry] = next(it)
        elif entry[1] == "list":
            fields[entry[0]] = EastArray(entry[2](), [next(it) for _ in payload[entry[0]]])
        else:
            rebuilt: list[Any] = []
            for sub in payload[entry[0]]:
                sf = {k: sub[k] for k in sub}
                for f in entry[3]:
                    sf[f] = next(it)
                rebuilt.append(EastStruct(sf))
            fields[entry[0]] = EastArray(entry[2](), rebuilt)
    for fname, etype in spec[1]:
        fields[fname] = EastArray(etype, list(payload[fname]))
    return EastVariant(node.type, EastStruct(fields))


def _listify(node, children):
    """Rebuild ``node`` with ``children`` (in ``_node_children`` order) as a
    LAZY node — python lists where :func:`_arrayify` makes ``EastArray``s —
    the shape the trace builds and every pass here walks by object identity.
    A finalized value's array elements materialize as fresh python objects
    on every read, so an identity-keyed pass over one sees a different
    object each time; a copy made of python lists is stable."""
    spec = _specs()[node.type]
    payload = node.value
    fields = {k: payload[k] for k in payload}
    it = iter(children)
    for entry in spec[0]:
        if isinstance(entry, str):
            fields[entry] = next(it)
        elif entry[1] == "list":
            fields[entry[0]] = [next(it) for _ in payload[entry[0]]]
        else:
            rebuilt: list[Any] = []
            for sub in payload[entry[0]]:
                sf = {k: sub[k] for k in sub}
                for f in entry[3]:
                    sf[f] = next(it)
                rebuilt.append(EastStruct(sf))
            fields[entry[0]] = rebuilt
    for fname, _etype in spec[1]:
        fields[fname] = list(payload[fname])
    return EastVariant(node.type, EastStruct(fields))


def _arrayify_tree(top):
    """The finalize: convert every lazy list child in the tree into its
    ``EastArray`` and return the final homoiconic value. Shared subtrees stay
    shared (one rebuild per node); nothing is hoisted, bound or re-typed —
    the IR is exactly what the body spelled, which is what the IR→python
    printer relies on and what the TypeScript builder emits."""
    # id -> (rewritten, original): the original is kept alive so a memo hit
    # is never a dead object's reused id (see _listify).
    memo: dict[int, tuple] = {}

    def rewrite(node):
        i = id(node)
        hit = memo.get(i)
        if hit is not None:
            return hit[0]
        result = _arrayify(node, [rewrite(c) for c in _node_children(node)])
        memo[i] = (result, node)
        return result

    return rewrite(top)


def _rehome_ir(node, from_map, to_map):
    """A LAZY copy of ``node`` (python lists, see :func:`_listify` — the
    caller's finalize arrayifies it with the rest of its tree) whose
    ``loc_id``s index ``to_map`` instead of ``from_map`` (each location stack
    re-interned); a node from no map, or into no map, has its locations
    dropped (0). Labels carry a ``loc_id`` of their own and are re-homed too."""
    from east.types.values import EastStruct as _Struct

    # id -> (rewritten, original): the ORIGINAL is kept alive. Reading an
    # EastArray element materializes a fresh python object whose id is free
    # for reuse the moment it dies — a memo of bare ids handed a later
    # sibling the wrong rewrite (a Let statement swapped for an unrelated
    # node, leaving its variable unbound in the embedded body).
    memo: dict[int, tuple] = {}

    def loc(old):
        if from_map is None or to_map is None or not old:
            return 0
        if from_map is to_map:
            return old
        return to_map.intern_stack(from_map.resolve(old))

    def rewrite(n):
        i = id(n)
        hit = memo.get(i)
        if hit is not None:
            return hit[0]
        children = [rewrite(c) for c in _node_children(n)]
        result = _listify(n, children)
        payload = result.value
        fields = {k: payload[k] for k in payload}
        fields["loc_id"] = loc(payload["loc_id"])
        if "label" in fields:
            lbl = fields["label"]
            fields["label"] = _Struct({"name": lbl["name"], "loc_id": loc(lbl["loc_id"])})
        result = EastVariant(result.type, _Struct(fields))
        memo[i] = (result, n)
        return result

    return rewrite(node)


def _rename_apart(node):
    """A LAZY copy of ``node`` — a function another build made, embedded in
    the open one (see :func:`_rehome_ir`) — whose every binder takes a name
    unique in the open build's scope chain, each reference renamed with the
    binder it resolves to (#1279).

    A build keeps a name unique within its scope chain (``naming``), as a body
    built in place names its own: the embedded function's names were chosen
    by its own build, so its local ``kind`` could share the name of the
    caller's parameter ``kind``. Each binder is renamed through the chain —
    ``kind`` becomes ``kind_2``, and a name no enclosing scope binds keeps
    its spelling — so no binder shadows a name in scope and the printed
    source reads as authored."""
    from east.expression import naming
    from east.expression.nodes import _fresh_name
    from east.types.values import EastStruct as _Struct

    sources = {"ForArray": "array", "ForSet": "set", "ForDict": "dict"}
    # (id, id(env)) -> (rewritten, original, env): the original and its scope
    # are kept alive, so a memo hit is never a dead object's reused id (see
    # _rehome_ir), and a node shared between two scopes is renamed in each.
    memo: dict[tuple[int, int], tuple] = {}

    def named(var, name):
        payload = var.value
        fields = {k: payload[k] for k in payload}
        fields["name"] = name
        return EastVariant("Variable", _Struct(fields))

    def bind(var, env):
        """The binder renamed through the chain, and ``env`` extended with it."""
        old = var.value["name"]
        new = naming.authored_name(old, _fresh_name)
        return named(var, new), {**env, old: new}

    def rename(n, env):
        key = (id(n), id(env))
        hit = memo.get(key)
        if hit is not None:
            return hit[0]
        kind = n.type
        p = n.value
        if kind == "Variable":
            new = env.get(p["name"])
            result = n if new is None else named(n, new)
        elif kind in ("Function", "AsyncFunction"):
            captures = [rename(c, env) for c in p["captures"]]
            inner, params = env, []
            for v in p["parameters"]:
                param, inner = bind(v, inner)
                params.append(param)
            result = _listify(n, [*captures, *params, rename(p["body"], inner)])
        elif kind == "Block":
            # A Let scopes over the statements that follow it.
            scope, statements = env, []
            for stmt in p["statements"]:
                if stmt.type == "Let":
                    value = rename(stmt.value["value"], scope)
                    var, scope = bind(stmt.value["variable"], scope)
                    statements.append(_listify(stmt, [var, value]))
                else:
                    statements.append(rename(stmt, scope))
            result = _listify(n, statements)
        elif kind == "Let":
            # A Let outside a Block binds over nothing after it.
            value = rename(p["value"], env)
            var, _scope = bind(p["variable"], env)
            result = _listify(n, [var, value])
        elif kind == "Match":
            children = [rename(p["variant"], env)]
            for case in p["cases"]:
                var, inner = bind(case["variable"], env)
                children += [var, rename(case["body"], inner)]
            result = _listify(n, children)
        elif kind == "TryCatch":
            # message and stack bind over the catch arm alone
            message, caught = bind(p["message"], env)
            stack, caught = bind(p["stack"], caught)
            result = _listify(n, [rename(p["try_body"], env), rename(p["catch_body"], caught),
                                  message, stack, rename(p["finally_body"], env)])
        elif kind in sources:
            # the source evaluates outside the loop; the loop variables bind in its body
            children = [rename(p[sources[kind]], env)]
            key_var, inner = bind(p["key"], env)
            children.append(key_var)
            if kind != "ForSet":
                value_var, inner = bind(p["value"], inner)
                children.append(value_var)
            result = _listify(n, [*children, rename(p["body"], inner)])
        else:
            result = _listify(n, [rename(c, env) for c in _node_children(n)])
        memo[key] = (result, n, env)
        return result

    with naming.embedded_scope():
        return rename(node, {})


# ─── Tracing + compilation ──────────────────────────────────────────────────


def _function_ir(
    param_types: list[EastType],
    params: list,
    body: Expression,
    is_async: bool = False,
    out: EastType | None = None,
) -> Any:
    """The function's top-level IR value: a Function node over exactly the
    body the trace built, with no captures — a build's constants are literals
    in the body, where it reads them. Finalization converts the lazy tree to
    real East arrays; nothing else is rewritten. ``is_async`` builds the
    AsyncFunction node/type instead (East.asyncFunction). ``out`` is the
    DECLARED output type — the function type's output even when the body
    diverges (a ``Never``-typed body that always returns); it defaults to the
    body's type."""
    from east.expression.nodes import _k_async_function
    from east.types.types import AsyncFunctionType

    make_type = AsyncFunctionType if is_async else FunctionType
    make_node = _k_async_function if is_async else _k_function
    fn_type = make_type(list(param_types), out if out is not None else body.east_type)
    return _arrayify_tree(make_node(fn_type, [], params, body.ir))
