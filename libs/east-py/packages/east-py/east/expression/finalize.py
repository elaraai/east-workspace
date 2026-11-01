#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Turning the lazy traced tree into the final homoiconic IR value.

Three concerns, in dependency order: computing a nested function's ``captures``
(``_free_vars``), converting every plain-list child of the traced tree into its
proper ``EastArray`` (``_arrayify_tree``), and the top-level assembly of a
function's Function node (``_function_ir``) — plus embedding a function another
build made into the open one.

A build keeps its tree as it traced it, a :class:`_Skeleton`. A call of a
function that has one does not copy it: the build records a reference to it,
with what a copy made there would have read, and ``_expand`` makes that copy
when the IR is first needed — to compile it, on a deferred function's first
read, or by the export — renamed apart and re-located exactly as it would have
been made at the call (#1279, #1459). A helper called at every level of a call
chain is then copied once per function that is finalized, not once per level.
A function with no skeleton is copied at the call, as before (``_rehome_ir``,
``_rename_apart``, #1271).

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

from east.expression import naming
from east.expression.errors import ExpressionError
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

    if not is_east_variant(node):
        # An array of nodes — a python list in the lazy tree, an EastArray in
        # the final one — or a struct holding them. Variants are asked first:
        # they are most of a tree, and EastArray's isinstance is an ABC's, a
        # python-level call per node (#1459).
        if isinstance(node, (list, EastArray)):
            for x in node:
                _free_vars(x, bound, out)
        elif is_east_struct(node):
            for _f, v in node.items():
                _free_vars(v, bound, out)
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


def _arrayify(node, children, types=None):
    """Rebuild ``node`` with ``children`` (its direct children, in
    ``_node_children`` order) as the final homoiconic value: every plain
    python list becomes the ``EastArray`` its IR field declares. With
    ``types`` (:class:`_SharedTypes`) its type and type parameters are the
    values every node of those types shares."""
    spec = _specs().get(node.type)
    if spec is None:
        raise ExpressionError(f"finalize met {node!r}, which is no IR node")
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
    if types is None:
        for fname, etype in spec[1]:
            fields[fname] = EastArray(etype, list(payload[fname]))
    else:
        fields["type"] = types.twin(payload["type"])
        for fname, etype in spec[1]:
            fields[fname] = EastArray(etype, [types.twin(t) for t in payload[fname]])
    return EastVariant(node.type, EastStruct(fields))


class _SharedTypes:
    """One value per distinct East type, for the nodes of a finalize to share.

    A type converted into an ``EastArray`` is converted again for every array
    it lands in, so every node of a struct type wrote that type's fields once
    more. A twin is the type's value already converted, whose arrays every
    node holding it passes by reference: beast2 then writes each type once
    per value. Twins are found by the type's VALUE (``_type_key``), so what
    is shared depends on the IR alone, never on which python objects a
    process happened to build. The values are unchanged."""

    __slots__ = ("_by_id", "_by_value")

    def __init__(self) -> None:
        # id -> (type, twin): the type is kept alive, so its id is not reused
        self._by_id: dict[int, tuple] = {}
        self._by_value: dict[str, Any] = {}

    def twin(self, t: Any) -> Any:
        hit = self._by_id.get(id(t))
        if hit is not None:
            return hit[1]
        from east.expression.nodes import _type_key
        from east.types.type_of_type import EastTypeType

        key = _type_key(t)
        twin = self._by_value.get(key)
        if twin is None:
            twin = self._by_value[key] = EastArray(EastTypeType, [t])[0]
        self._by_id[id(t)] = (t, twin)
        return twin


def _listify(node, children, overrides=None):
    """Rebuild ``node`` with ``children`` (in ``_node_children`` order) as a
    LAZY node — python lists where :func:`_arrayify` makes ``EastArray``s —
    the shape the trace builds and every pass here walks by object identity.
    A finalized value's array elements materialize as fresh python objects
    on every read, so an identity-keyed pass over one sees a different
    object each time; a copy made of python lists is stable. ``overrides``
    replaces other fields of the node (a ``loc_id``, a variable's ``name``)."""
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
    if overrides:
        fields.update(overrides)
    return EastVariant(node.type, EastStruct(fields))


def _arrayify_tree(top, skeleton=None, types=None):
    """The finalize: convert every lazy list child in the tree into its
    ``EastArray`` and return the final homoiconic value. Shared subtrees stay
    shared (one rebuild per node); nothing is hoisted, bound or re-typed —
    the IR is exactly what the body spelled, which is what the IR→python
    printer relies on and what the TypeScript builder emits.

    ``top`` is a skeleton's root when ``skeleton`` is given: each reference
    in it is expanded (:func:`_expand_reference`), its locations interned
    into the skeleton's map. With ``types`` (:class:`_SharedTypes`) every
    node but ``top`` holds the shared value of its type; ``top`` keeps the
    function's own."""
    # id -> (rewritten, original): the original is kept alive so a memo hit
    # is never a dead object's reused id (see _listify).
    memo: dict[int, tuple] = {}
    references = skeleton.references if skeleton is not None else None

    def rewrite(node):
        i = id(node)
        hit = memo.get(i)
        if hit is not None:
            return hit[0]
        reference = references.get(i) if references else None
        if reference is not None:
            result = rewrite(_expand_reference(reference, skeleton.source_map))
        else:
            result = _arrayify(node, [rewrite(c) for c in _node_children(node)],
                               None if node is top else types)
        memo[i] = (result, node)
        return result

    try:
        return rewrite(top)
    finally:
        # `rewrite` refers to itself, so the closure is a cycle, alive until
        # the cyclic collector's next pass — and with it the memo, every node
        # the pass saw: emptied here, they are freed now (#1459).
        memo.clear()


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

    try:
        return rewrite(node)
    finally:
        memo.clear()  # freed now, not by the cyclic collector (see _arrayify_tree)


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

    try:
        with naming.embedded_scope():
            return rename(node, {})
    finally:
        memo.clear()  # freed now, not by the cyclic collector (see _arrayify_tree)


# ─── Embedding by reference (#1459) ─────────────────────────────────────────
#
# A copy at the call walked the callee's final form, re-reading every node of
# it from east-c, and the callee's IR held its own callees' copies: a helper
# was copied again at every level of a call chain, and every pass over the
# caller walked the copies. A reference holds the callee and what the copy
# would have read where the call is made — the names in scope and the first
# generated name it would have drawn — and its build drew those names and
# interned the callee's locations then, so the names and loc_ids of everything
# the caller builds after the call are what they were. ``_expand`` makes the
# copy from the callee's skeleton, once, with the same names and locations.

#: The source field each loop evaluates outside its body.
_LOOP_SOURCES = {"ForArray": "array", "ForSet": "set", "ForDict": "dict"}


class _Callee:
    """The body of a reference: the function it calls, which is not IR.

    A pass meant for IR stops at it: its nodes are the callee's, whose
    locations index the callee's map, so a reference that reached a finalize
    which does not expand it fails there, rather than building IR that names
    the wrong lines."""

    __slots__ = ("skeleton",)
    type = "Callee"

    def __init__(self, skeleton: _Skeleton) -> None:
        self.skeleton = skeleton

    def __repr__(self) -> str:
        return "<a reference to a built function, which only the build that made it expands>"


class _Reference:
    """A call of a built function its build did not copy: the Function node
    standing where the copy goes (kept alive, as it is keyed by its id), the
    function, and what the copy would have read at the call — the names in
    scope and the number of the first generated name it would have drawn."""

    __slots__ = ("node", "callee", "scope", "first")

    def __init__(self, node: Any, callee: _Skeleton, scope: frozenset, first: int) -> None:
        self.node = node
        self.callee = callee
        self.scope = scope
        self.first = first


class _Skeleton:
    """A built function's tree as its build traced it — LAZY, every call of a
    function that has a skeleton a reference to it (``references``, by the
    id of its node) — or an IR already finalized (``final``), with the map
    its ``loc_id``s index, and what an embed of the function reads instead of
    walking its expansion:

    - ``effectful``: whether it mutates or raises, its callees included;
    - ``platforms``: the platform functions it calls, its callees' included,
      in first-use order;
    - ``unnamed``: how many generated names a copy of it draws — the binders
      of its expansion whose names cannot be hints, every repetition of one
      counted, as the copy renames each;
    - ``underscores``: its expansion's binders named ``_``, a name a copy
      keeps for the first of them where it is free and suffixes for every
      other — ``__2``, ``__3``…, which are no hints one copy further out;
    - ``stacks``: its expansion's location stacks in the order a copy
      interns them (post-order, labels after their node, as ``_rehome_ir``).

    The last three are read on the function's first embed: a function no
    build calls never walks for them."""

    __slots__ = ("root", "references", "source_map", "effectful", "platforms", "final",
                 "_names", "_stacks")

    def __init__(self, root: Any, references: dict[int, _Reference], source_map: Any,
                 effectful: bool, platforms: tuple, final: Any = None) -> None:
        self.root = root
        self.references = references
        self.source_map = source_map
        self.effectful = effectful
        self.platforms = platforms
        self.final = final
        self._names: tuple[int, int] | None = None
        self._stacks: tuple | None = None

    @property
    def unnamed(self) -> int:
        if self._names is None:
            self._names = _unnamed(self.root, self.references)
        return self._names[0]

    @property
    def underscores(self) -> int:
        if self._names is None:
            self._names = _unnamed(self.root, self.references)
        return self._names[1]

    @property
    def stacks(self) -> tuple:
        if self._stacks is None:
            self._stacks = _stacks(self.root, self.references, self.source_map)
        return self._stacks


def _binders(node: Any) -> Any:
    """The variables ``node`` binds, as ``_rename_apart`` binds them."""
    kind = node.type
    p = node.value
    if kind in ("Function", "AsyncFunction"):
        return p["parameters"]
    if kind == "Let":
        return (p["variable"],)
    if kind == "Match":
        return [case["variable"] for case in p["cases"]]
    if kind == "TryCatch":
        return (p["message"], p["stack"])
    if kind in ("ForArray", "ForDict"):
        return (p["key"], p["value"])
    if kind == "ForSet":
        return (p["key"],)
    return ()


def _unnamed(root: Any, references: dict[int, _Reference]) -> tuple[int, int]:
    """``(unnamed, underscores)`` of the function's expansion (``_Skeleton``).

    A callee's binders keep whether they can be hints through the copy of
    it — a suffix never makes a keyword, nor a ``__`` name of another — but
    for ``_``: the copy keeps it for the first of the callee's ``_``s when
    the call has no ``_`` in scope, and gives every other ``__2``, ``__3``…"""
    # id -> (counts, node): a subtree the trace shared counts at each of its
    # places, as the copy renames each; the node is kept alive (see _listify)
    memo: dict[int, tuple] = {}

    def count(node: Any) -> tuple[int, int]:
        hit = memo.get(id(node))
        if hit is not None:
            return hit[0]
        reference = references.get(id(node))
        if reference is not None:
            callee = reference.callee
            kept = 1 if callee.underscores and "_" not in reference.scope else 0
            total = (callee.unnamed + callee.underscores - kept, kept)
        else:
            unnamed = underscores = 0
            for v in _binders(node):
                name = v.value["name"]
                if name == "_":
                    underscores += 1
                elif not naming.usable(name):
                    unnamed += 1
            for child in _node_children(node):
                more, more_underscores = count(child)
                unnamed += more
                underscores += more_underscores
            total = (unnamed, underscores)
        memo[id(node)] = (total, node)
        return total

    try:
        return count(root)
    finally:
        memo.clear()  # freed now, not by the cyclic collector (see _arrayify_tree)


def _stacks(root: Any, references: dict[int, _Reference], source_map: Any) -> tuple:
    """The function's expansion's location stacks, as a copy interns them (``_Skeleton``)."""
    # id -> node: a subtree met again interns nothing new; kept alive (see _listify)
    seen: dict[int, Any] = {}
    stacks: dict[tuple, None] = {}

    def add(loc_id: int) -> None:
        if loc_id and source_map is not None:
            stack = source_map.resolve(loc_id)
            if stack:
                stacks.setdefault(stack, None)

    def visit(node: Any) -> None:
        if id(node) in seen:
            return
        seen[id(node)] = node
        reference = references.get(id(node))
        if reference is not None:
            for stack in reference.callee.stacks:
                stacks.setdefault(stack, None)
            return
        for child in _node_children(node):
            visit(child)
        payload = node.value
        add(payload["loc_id"])
        if "label" in payload:
            add(payload["label"]["loc_id"])

    try:
        visit(root)
        return tuple(stacks)
    finally:
        seen.clear()  # freed now, not by the cyclic collector (see _arrayify_tree)


class _Embed:
    """One embed, replayed: the names in scope at its call, those it has given
    so far (the scope ``naming.embedded_scope`` opened for the copy), and the
    number of the next generated name it draws."""

    __slots__ = ("scope", "given", "next")

    def __init__(self, scope: frozenset, first: int) -> None:
        self.scope = scope
        self.given: set[str] = set()
        self.next = first

    def rename(self, name: str) -> str:
        """The name the copy gave a binder named ``name`` (``naming.authored_name``)."""
        if not naming.usable(name):
            fresh = naming.generated_name(self.next)
            self.next += 1
            return fresh
        new = naming.unique_name(name, self._taken)
        self.given.add(new)
        return new

    def _taken(self, name: str) -> bool:
        return name in self.scope or name in self.given


class _Expander:
    """Makes the copies references stand for (:func:`_expand`).

    A walk of a skeleton, in the order ``_rehome_ir`` walks a node's children
    (spec order, each node's own locations after its children's) and binding
    as ``_rename_apart`` binds (a ``Let``'s value before its variable, a
    catch's variables before its bodies). Inside a reference the callee's
    skeleton is walked with the embed replayed, so each binder takes the
    name every embed above it gave it, innermost first: ``embeds`` holds
    them, and ``envs`` each one's renames in scope, old name to new. A
    subtree the trace shared is copied at each of its places, as the copies
    from a final form were."""

    __slots__ = ("target",)

    def __init__(self, target: Any) -> None:
        self.target = target

    def loc(self, old: int, source: Any) -> int:
        if not old or source is None or self.target is None:
            return 0
        if source is self.target:
            return old
        return self.target.intern_stack(source.resolve(old))

    def copy(self, node: Any, children: list, owner: _Skeleton, name: str | None = None,
             loc_id: int | None = None) -> Any:
        """``node`` rebuilt LAZY with ``children``, its location re-interned
        (``loc_id`` when it was interned earlier, where the walk met it), then
        its label's, and named ``name`` when given."""
        payload = node.value
        source = owner.source_map
        overrides: dict[str, Any] = {
            "loc_id": self.loc(payload["loc_id"], source) if loc_id is None else loc_id}
        if "label" in payload:
            label = payload["label"]
            overrides["label"] = EastStruct({"name": label["name"], "loc_id": self.loc(label["loc_id"], source)})
        if name is not None:
            overrides["name"] = name
        return _listify(node, children, overrides)

    @staticmethod
    def bind(name: str, embeds: tuple, envs: tuple) -> tuple[str, tuple]:
        """``name`` renamed by every embed, innermost first, and each embed's
        renames extended with it."""
        renamed = []
        for embed, env in zip(embeds, envs, strict=True):
            new = embed.rename(name)
            renamed.append({**env, name: new})
            name = new
        return name, tuple(renamed)

    def walk(self, node: Any, owner: _Skeleton, embeds: tuple, envs: tuple) -> Any:
        reference = owner.references.get(id(node))
        if reference is not None:
            callee = reference.callee
            return self.walk(callee.root, callee, (_Embed(reference.scope, reference.first), *embeds),
                             ({}, *envs))
        kind = node.type
        p = node.value
        if kind == "Variable":
            name = p["name"]
            for env in envs:
                name = env.get(name, name)
            return self.copy(node, [], owner, name=name)
        if kind in ("Function", "AsyncFunction"):
            captures = [self.walk(c, owner, embeds, envs) for c in p["captures"]]
            inner, params = envs, []
            for v in p["parameters"]:
                name, inner = self.bind(v.value["name"], embeds, inner)
                params.append(self.copy(v, [], owner, name=name))
            return self.copy(node, [*captures, *params, self.walk(p["body"], owner, embeds, inner)], owner)
        if kind == "Block":
            # A Let scopes over the statements that follow it.
            scope, statements = envs, []
            for stmt in p["statements"]:
                if stmt.type == "Let":
                    let, scope = self.let(stmt, owner, embeds, scope)
                    statements.append(let)
                else:
                    statements.append(self.walk(stmt, owner, embeds, scope))
            return self.copy(node, statements, owner)
        if kind == "Let":
            # A Let outside a Block binds over nothing after it.
            return self.let(node, owner, embeds, envs)[0]
        if kind == "Match":
            children = [self.walk(p["variant"], owner, embeds, envs)]
            for case in p["cases"]:
                var = case["variable"]
                name, inner = self.bind(var.value["name"], embeds, envs)
                children += [self.copy(var, [], owner, name=name), self.walk(case["body"], owner, embeds, inner)]
            return self.copy(node, children, owner)
        if kind == "TryCatch":
            # message and stack bind over the catch arm alone, before either body is renamed
            message, caught = self.bind(p["message"].value["name"], embeds, envs)
            stack, caught = self.bind(p["stack"].value["name"], embeds, caught)
            try_body = self.walk(p["try_body"], owner, embeds, envs)
            catch_body = self.walk(p["catch_body"], owner, embeds, caught)
            return self.copy(node, [try_body, catch_body,
                                    self.copy(p["message"], [], owner, name=message),
                                    self.copy(p["stack"], [], owner, name=stack),
                                    self.walk(p["finally_body"], owner, embeds, envs)], owner)
        if kind in _LOOP_SOURCES:
            # the source evaluates outside the loop; the loop variables bind in its body
            children = [self.walk(p[_LOOP_SOURCES[kind]], owner, embeds, envs)]
            key, inner = self.bind(p["key"].value["name"], embeds, envs)
            children.append(self.copy(p["key"], [], owner, name=key))
            if kind != "ForSet":
                value, inner = self.bind(p["value"].value["name"], embeds, inner)
                children.append(self.copy(p["value"], [], owner, name=value))
            children.append(self.walk(p["body"], owner, embeds, inner))
            return self.copy(node, children, owner)
        return self.copy(node, [self.walk(c, owner, embeds, envs) for c in _node_children(node)], owner)

    def let(self, node: Any, owner: _Skeleton, embeds: tuple, envs: tuple) -> tuple[Any, tuple]:
        """A ``Let`` copied: its variable's location interned first, where a
        walk of its children meets it, its value walked, then its variable
        bound; with the renames in scope after it."""
        p = node.value
        var = p["variable"]
        loc_id = self.loc(var.value["loc_id"], owner.source_map)
        value = self.walk(p["value"], owner, embeds, envs)
        name, scope = self.bind(var.value["name"], embeds, envs)
        return self.copy(node, [self.copy(var, [], owner, name=name, loc_id=loc_id), value], owner), scope


def _finalized(skeleton: _Skeleton) -> Any:
    """The final IR of the function ``skeleton`` holds: its tree finalized,
    each reference expanded where it stands, located in the build's map —
    which holds every location of the copies since their calls — and, where
    there were copies, every node of a type holding that type's shared value
    (:class:`_SharedTypes`), as the copies once shared their callee's. A
    skeleton of an IR already finalized is that IR."""
    if skeleton.final is not None:
        return skeleton.final
    return _arrayify_tree(skeleton.root, skeleton, _SharedTypes() if skeleton.references else None)


def _expand(skeleton: _Skeleton, target: Any) -> Any:
    """A LAZY copy of the function ``skeleton`` holds, every reference in it
    replaced by the copy its embed would have made, and every location
    re-interned into ``target`` as ``_rehome_ir`` re-interns one: what the
    export finalizes, into a map of the function's own."""
    return _Expander(target).walk(skeleton.root, skeleton, (), ())


def _expand_reference(reference: _Reference, target: Any) -> Any:
    """The copy ``reference`` stands for, LAZY, its locations interned into
    ``target`` — the map of the build that made the reference, which holds
    them since the call."""
    callee = reference.callee
    return _Expander(target).walk(callee.root, callee, (_Embed(reference.scope, reference.first),), ({},))


# ─── Tracing + compilation ──────────────────────────────────────────────────


def _function_node(
    param_types: list[EastType],
    params: list,
    body: Expression,
    is_async: bool = False,
    out: EastType | None = None,
) -> Any:
    """The function's top-level Function node over exactly the body the
    trace built, with no captures — a build's constants are literals in the
    body, where it reads them — still LAZY (python lists, see
    :func:`_listify`), as a build analyzes it before it finalizes it.
    ``is_async`` builds the AsyncFunction node/type instead
    (East.asyncFunction). ``out`` is the DECLARED output type — the function
    type's output even when the body diverges (a ``Never``-typed body that
    always returns); it defaults to the body's type."""
    from east.expression.nodes import _k_async_function
    from east.types.types import AsyncFunctionType

    make_type = AsyncFunctionType if is_async else FunctionType
    make_node = _k_async_function if is_async else _k_function
    fn_type = make_type(list(param_types), out if out is not None else body.east_type)
    return make_node(fn_type, [], params, body.ir)


def _function_ir(
    param_types: list[EastType],
    params: list,
    body: Expression,
    is_async: bool = False,
    out: EastType | None = None,
) -> Any:
    """The function's top-level IR value: :func:`_function_node`, finalized —
    every lazy list converted to its real East array; nothing else is
    rewritten."""
    return _arrayify_tree(_function_node(param_types, params, body, is_async=is_async, out=out))
