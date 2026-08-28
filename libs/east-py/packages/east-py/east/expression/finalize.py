#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Turning the lazy traced tree into the final homoiconic IR value.

Three concerns, in dependency order: computing a nested function's ``captures``
(``_free_vars``), the trace-time common-subexpression pass that binds a shared
subtree to one ``Let`` (``_finalize_ir``, which also converts every plain-list
child into its proper ``EastArray``), and the top-level assembly of a kernel's
Function node (``_function_ir``).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from east.expression.nodes import (
    _MUTATING_BUILTINS,
    _fresh_name,
    _k_block,
    _k_function,
    _root_var_name,
    _var,
)
from east.ir.builders import ir_let
from east.types.types import EastType, FunctionType, NullType
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


def _with_recomputed_captures(fn_node: Any) -> Any:
    """``fn_node`` (a finalized Function/AsyncFunction) with its ``captures``
    recomputed from its body: every outer variable the body reads, minus
    its own parameters, in first-use order."""
    from east.types.type_of_type import IRType

    payload = fn_node.value
    free: dict[str, Any] = {}
    _free_vars(payload["body"], frozenset(p.value["name"] for p in payload["parameters"]), free)
    old = [c.value["name"] for c in payload["captures"]]
    if old == list(free):
        return fn_node
    fields = {k: payload[k] for k in payload}
    fields["captures"] = EastArray(IRType, list(free.values()))
    return EastVariant(fn_node.type, EastStruct(fields))


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

# ─── Trace-time CSE + finalize: shared subexpressions bind once (#411) ──────
#
# Reusing one Expression object at N sites makes the traced (lazy) tree a
# DAG. The finalize pass walks it once: every non-trivial node referenced
# more than once — whose free variables are the kernel's own parameters or
# hoisted constants — binds to a Let at the top of the kernel body (this
# includes loop-invariant hoisting out of nested lambdas); everything else
# re-emits inline. The SAME rebuild converts every plain-list child into its
# proper EastArray, producing the final homoiconic value.

_CSE_SKIP_KINDS = frozenset({"Value", "Variable"})

#: Kinds never hoisted on a SINGLE occurrence (#602). Function values stay
#: where the trace created them, Error must keep firing exactly where (and as
#: often as) it was written, Let/Break/Continue are statements not values, and
#: a Platform call is an EFFECT — hoisting one out of a callback would change
#: how many times the host function runs.
_SOLO_SKIP_KINDS = frozenset({
    "Function", "AsyncFunction", "Error", "Let", "Break", "Continue", "Platform",
})

#: Statement kinds whose effect reaches OUTSIDE the subtree they sit in: a
#: subtree holding one is never bound once by the CSE, however often it is
#: referenced — a hoisted Let evaluates it elsewhere (and once), which is not
#: what a return, an assignment to an outer variable, or a jump to an outer
#: loop means (#627, the statement surface). A jump to a loop the subtree
#: itself contains, or an assignment to a variable it binds, is self-contained
#: (the state-threading sugar's loops are exactly that) and hoists as before.
_ESCAPING_KINDS = frozenset({"Assign", "Return", "Break", "Continue"})


def _reaches_mutable(t) -> bool:
    """True when a value of type ``t`` can contain a mutable East value
    (Array, Set, Dict, Ref). Hoisting shares ONE evaluation where the trace
    had one per element, so a per-element result that reaches mutable state
    would alias across elements."""
    kind = t.type
    if kind in ("Array", "Set", "Dict", "Ref"):
        return True
    if kind in ("Null", "Boolean", "Integer", "Float", "String", "DateTime",
                "Blob", "Never", "Vector", "Matrix"):
        return False
    if kind in ("Struct", "Variant"):
        return any(_reaches_mutable(f["type"]) for f in t.value)
    return True

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
    """The no-CSE finalize: convert every lazy list child in the tree into its
    ``EastArray`` and return the final homoiconic value. Shared subtrees stay
    shared (one rebuild per node); nothing is hoisted or re-typed — the IR is
    exactly what the body spelled, which is what ``East.function(...,
    cse=False)`` promises and what the IR→python printer relies on."""
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


def _finalize_ir(top, param_names: set, kernel_fn=None, cse: bool = True):
    """CSE + arrayify the whole lazy tree; returns the final homoiconic node.

    ``top`` is the (lazy) top-level Function node — or a Block wrapping it
    when constants hoisted; the CSE lets land inside ``kernel_fn``'s body
    (the FIRST Function node encountered from the top). With ``cse=False``
    the pass only converts lazy lists (``_arrayify_tree``): no shared
    subtree binds to a Let and no callback invariant hoists.
    """
    if not cse:
        return _arrayify_tree(top)
    counts: dict[int, int] = {}
    keep: dict[int, Any] = {}
    visited: set[int] = set()
    #: names bound MUTABLE (``East.let`` statements) anywhere in the tree. A
    #: node reading one must never hoist or bind once: an ``Assign`` between
    #: two of its occurrences means the two reads see different values.
    mutable_names: set[str] = set()
    #: node id -> every parent reference is a non-mutating Builtin (a READ).
    #: A single-occurrence mutable-typed node may only hoist when its one
    #: consumer reads it — anywhere else (a Struct field, a callback's result
    #: position) the container itself escapes per element and one shared
    #: instance would alias (#602).
    pure_parent: dict[int, bool] = {}

    def count(node):
        i = id(node)
        if node.type not in _CSE_SKIP_KINDS:
            counts[i] = counts.get(i, 0) + 1
            keep[i] = node
        elif node.type == "Variable" and node.value["mutable"]:
            mutable_names.add(node.value["name"])
        if i in visited:
            return
        visited.add(i)
        reads_only = (node.type == "Builtin"
                      and node.value["builtin"] not in _MUTATING_BUILTINS)
        for child in _node_children(node):
            ci = id(child)
            pure_parent[ci] = pure_parent.get(ci, True) and reads_only
            count(child)

    count(top)

    # Occurrences inside a CALLBACK body — any Function that is not the
    # kernel itself. The collection builtins apply these per element, so a
    # subtree in one runs n times; that is the only place a single-occurrence
    # hoist buys anything (#602).
    in_callback: set[int] = set()
    cb_walked: set[tuple] = set()

    def callback_walk(node, inside):
        key = (id(node), inside)
        if key in cb_walked:
            return
        cb_walked.add(key)
        if inside:
            in_callback.add(id(node))
        enter = inside or (kernel_fn is not None
                           and node.type in ("Function", "AsyncFunction")
                           and node is not kernel_fn)
        for child in _node_children(node):
            callback_walk(child, enter)

    callback_walk(top, False)

    # A name that is REBOUND between the kernel body and a node's occurrence
    # (an inner-lambda param or match/catch variable shadowing a top param)
    # must block the hoist — at the top the name resolves to the wrong
    # binder. scope[i] accumulates every such rebound name over all of the
    # node's occurrences.
    scope: dict[int, set] = {}

    def binder_names(node):
        if node.type in ("Function", "AsyncFunction") and node is not kernel_fn:
            return {p.value["name"] for p in node.value["parameters"]}
        if node.type == "Match":
            return {c["variable"].value["name"] for c in node.value["cases"]}
        if node.type == "TryCatch":
            return {node.value["message"].value["name"], node.value["stack"].value["name"]}
        if node.type in ("ForArray", "ForSet", "ForDict"):
            names = {node.value["key"].value["name"]}
            if node.type != "ForSet":
                names.add(node.value["value"].value["name"])
            return names
        return None

    def scope_walk(node, inner):
        i = id(node)
        prev = scope.get(i)
        if prev is None:
            scope[i] = set(inner)
        elif inner <= prev:
            return
        else:
            prev |= inner
        bound = binder_names(node)
        if bound:
            inner = inner | bound
        for child in _node_children(node):
            scope_walk(child, inner)

    scope_walk(top, set())

    # A node whose EVERY occurrence sits inside a conditional arm (an IfElse
    # case body / else body, a Match case body, a catch/finally) must NOT
    # hoist to the top of the kernel: the hoisted Let evaluates it
    # unconditionally, so a guarded PARTIAL operation — `d[k]` under
    # `if_else(d.has(k), …)` — raises on the very path the guard excludes
    # (#558 A). Sharing the value through one python variable is what makes
    # the node multiply-referenced, so the natural guarded-build spelling
    # was precisely the one that crashed. An occurrence on any
    # unconditional path keeps the hoist (predicates themselves, and the
    # #525 loop-invariant receivers, are unaffected).
    uncond_seen: set[int] = set()
    cond_seen: set[int] = set()

    def cond_walk(node, conditional):
        i = id(node)
        seen = cond_seen if conditional else uncond_seen
        if i in seen or (conditional and i in uncond_seen):
            return
        seen.add(i)
        if node.type == "IfElse":
            payload = node.value
            for n, case in enumerate(payload["ifs"]):
                # the first predicate always evaluates; later predicates only
                # when every earlier one was false, and every body only when
                # its predicate held
                cond_walk(case["predicate"], conditional or n > 0)
                cond_walk(case["body"], True)
            cond_walk(payload["else_body"], True)
            return
        if node.type == "Match":
            payload = node.value
            cond_walk(payload["variant"], conditional)
            for case in payload["cases"]:
                cond_walk(case["variable"], True)
                cond_walk(case["body"], True)
            return
        if node.type == "TryCatch":
            payload = node.value
            cond_walk(payload["try_body"], conditional)
            for f in ("catch_body", "message", "stack", "finally_body"):
                cond_walk(payload[f], True)
            return
        if node.type == "While":
            payload = node.value
            # the predicate always runs at least once; the body may run zero
            # times, so a partial operation inside it is guarded exactly the
            # way an IfElse arm is
            cond_walk(payload["predicate"], conditional)
            cond_walk(payload["body"], True)
            return
        if node.type in ("ForArray", "ForSet", "ForDict"):
            payload = node.value
            source = {"ForArray": "array", "ForSet": "set", "ForDict": "dict"}[node.type]
            cond_walk(payload[source], conditional)
            cond_walk(payload["body"], True)  # empty collection: never
            return
        for child in _node_children(node):
            cond_walk(child, conditional)

    cond_walk(top, False)

    # ── Where a hoisted Let may LAND (issue #595) ───────────────────────────
    #
    # A Let at the head of the kernel body is a valid site only for a node
    # whose free variables are the kernel's own parameters. But the natural
    # way to write a traced algorithm binds its derived inputs first —
    # `East.let(derive(p), lambda a: <loop over a, read more than once>)` —
    # and that loop's free `a` is bound by an enclosing Block, not by a
    # parameter. The top-of-body site cannot see it, so the node re-emitted,
    # and re-RAN, at every reference exactly as before #594.
    #
    # So each hoistable node gets its OWN site: the innermost enclosing Block
    # binding every name it needs, at the first index where all of them are
    # in scope. Two facts make that placement safe without tracking each
    # occurrence separately. Every occurrence already sits inside that Block
    # — it references the name the Block binds. And the walk RESETS its path
    # at every BARRIER (a nested function, a loop body or predicate, a
    # conditional arm, a guarded body), so a Block seen across one is never
    # offered as a site: hoisting out of a loop would change how many times
    # the node runs, and out of a branch whether it runs at all. A node
    # needing nothing but parameters keeps the kernel-body site, so the #525
    # loop-invariant hoisting out of nested lambdas is unchanged.

    #: Block id -> {name it binds: the statement index that binds it}
    block_binds: dict[int, dict[str, int]] = {}
    #: Block id -> the Block node itself
    block_node: dict[int, Any] = {}
    #: node id -> the Block-id path (outermost first) shared by EVERY occurrence
    region: dict[int, tuple] = {}
    walked: set[tuple] = set()

    def region_walk(node, path):
        key = (id(node), path)
        if key in walked:
            return
        walked.add(key)
        i = id(node)
        prev = region.get(i)
        if prev is None:
            region[i] = path
        elif prev != path:
            n = 0
            while n < len(prev) and n < len(path) and prev[n] == path[n]:
                n += 1
            region[i] = prev[:n]
        inner = path
        if node.type == "Block":
            block_node[i] = node
            binds = block_binds.setdefault(i, {})
            for n, stmt in enumerate(node.value["statements"]):
                if getattr(stmt, "type", None) == "Let":
                    binds[stmt.value["variable"].value["name"]] = n
            inner = path + (i,)
        for child in _node_children(node):
            region_walk(child, inner)

    region_walk(top, ())

    mut_memo: dict[int, set] = {}

    def mutates_within(node):
        """Every name mutated anywhere inside ``node``, binding IGNORED.

        An anchor must not be one of these. The hoisted Let evaluates just
        past the anchor's binding, so if the anchor is mutated later in the
        block — `East.block(a.append(x), <reads of a>)`, or a loop updating
        the Ref cell its own Block binds — the Let would capture the value
        from BEFORE the mutation the occurrences see after it.
        """
        i = id(node)
        hit = mut_memo.get(i)
        if hit is not None:
            return hit
        out: set = set()
        if node.type == "Builtin" and node.value["builtin"] in _MUTATING_BUILTINS:
            target = _root_var_name(node.value["arguments"][0])
            if target is not None:
                out.add(target)
        mut_memo[i] = out          # cycle-safe placeholder; refined below
        for child in _node_children(node):
            out = out | mutates_within(child)
        mut_memo[i] = out
        return out

    def binding_site(need, path):
        """``(block id, index)`` for the innermost Block on ``path`` binding
        every name in ``need``, just past the last of those bindings — or
        ``(None, 0)`` when a name is bound nowhere on the path, or is mutated
        inside the Block that binds it (see :func:`mutates_within`)."""
        depth = -1
        at = 0
        for name in need:
            found = None
            for d, bid in enumerate(path):
                idx = block_binds.get(bid, {}).get(name)
                if idx is not None:
                    found = (d, idx)       # names are fresh: at most one
                    if name in mutates_within(block_node[bid]):
                        return None, 0
            if found is None:
                return None, 0
            if found[0] > depth:
                depth, at = found[0], found[1] + 1
            elif found[0] == depth:
                at = max(at, found[1] + 1)
        return path[depth], at

    def free_vars(node, bound):
        if node.type == "Variable":
            name = node.value["name"]
            return set() if name in bound else {name}
        if node.type == "Block":
            # A Let scopes over the statements that FOLLOW it, so walk in order
            # and widen as we go — the same rule the module-level `_free_vars`
            # already applies. Without this a Block's OWN binding is reported
            # free, `fv <= param_names` fails, and every composed expression
            # that binds its receiver (mean, find_maximum, find_minimum,
            # find_all) becomes un-hoistable: reusing one such expression
            # re-emits and RE-EXECUTES it per use site (#525).
            scope = set(bound)
            block_out: set = set()
            for stmt in node.value["statements"]:
                if getattr(stmt, "type", None) == "Let":
                    block_out |= free_vars(stmt.value["value"], scope)
                    scope.add(stmt.value["variable"].value["name"])
                else:
                    block_out |= free_vars(stmt, scope)
            return block_out
        # The remaining BINDER forms — the same four ``binder_names`` above
        # already knows about. A node that binds names over part of itself
        # must say so, or the generic walk reports those names FREE,
        # ``fv <= param_names`` fails, and the node never hoists: it
        # re-emits — and re-RUNS — at every use site. For a loop that is k
        # full executions for k reads, and O(n x loop) once a read sits
        # inside a map/filter, with no counter moving because every run is
        # native (#593). Each sub-expression is walked in exactly the scope
        # it runs in, and the binder DECLARATIONS are not walked at all.
        payload = node.value
        if node.type == "Let":
            # a Let outside a Block: its variable binds, only the value reads
            return free_vars(payload["value"], bound)
        if node.type in ("ForArray", "ForSet", "ForDict"):
            # The source is evaluated OUTSIDE the loop; only the body sees
            # the loop variables (the module-level `_free_vars` agrees).
            src = {"ForArray": "array", "ForSet": "set", "ForDict": "dict"}[node.type]
            loop_vars = {payload["key"].value["name"]}
            if node.type != "ForSet":
                loop_vars.add(payload["value"].value["name"])
            return free_vars(payload[src], bound) | free_vars(payload["body"],
                                                              bound | loop_vars)
        if node.type == "Match":
            # Each case binds its own payload variable over its own body.
            out_m = free_vars(payload["variant"], bound)
            for case in payload["cases"]:
                out_m |= free_vars(case["body"],
                                   bound | {case["variable"].value["name"]})
            return out_m
        if node.type == "TryCatch":
            # `message`/`stack` scope over the CATCH arm alone — the guarded
            # body and the finally clause never see them.
            caught = bound | {payload["message"].value["name"],
                              payload["stack"].value["name"]}
            return (free_vars(payload["try_body"], bound)
                    | free_vars(payload["catch_body"], caught)
                    | free_vars(payload["finally_body"], bound))
        inner = bound
        if node.type in ("Function", "AsyncFunction"):
            inner = bound | {p.value["name"] for p in node.value["parameters"]}
        out: set = set()
        for child in _node_children(node):
            out |= free_vars(child, inner)
        return out

    def mutated_free(node, bound):
        """Names a subtree MUTATES without itself binding them.

        Hoisting evaluates a node ONCE at the top of the kernel, so a node
        that mutates something it did not create must never hoist: the effect
        would leave its loop or its conditional and happen a different number
        of times. A self-contained mutation — the ``Let``-bound copy inside a
        traced ``union``, the fresh accumulator inside a grouped fold — binds
        its own target and stays hoistable.
        """
        if node.type == "Block":
            scope_ = set(bound)
            block_out: set = set()
            for stmt in node.value["statements"]:
                if getattr(stmt, "type", None) == "Let":
                    block_out |= mutated_free(stmt.value["value"], scope_)
                    scope_.add(stmt.value["variable"].value["name"])
                else:
                    block_out |= mutated_free(stmt, scope_)
            return block_out
        inner = bound
        if node.type in ("Function", "AsyncFunction"):
            inner = bound | {p.value["name"] for p in node.value["parameters"]}
        out: set = set()
        if node.type == "Builtin" and node.value["builtin"] in _MUTATING_BUILTINS:
            target = _root_var_name(node.value["arguments"][0])
            if target is not None and target not in inner:
                out.add(target)
        for child in _node_children(node):
            out |= mutated_free(child, inner)
        return out

    anon_memo: dict[int, bool] = {}

    def anonymous_mutation(node) -> bool:
        """A mutating builtin in the subtree whose receiver has NO root
        variable — mutating a builtin result or fresh container directly.
        ``mutated_free`` cannot name such a target, so a single-occurrence
        hoist (which cannot rely on shared-object intent the way a reused
        Expression can) must refuse the subtree outright (#602)."""
        i = id(node)
        hit = anon_memo.get(i)
        if hit is not None:
            return hit
        anon_memo[i] = False       # cycle-safe placeholder
        out = (node.type == "Builtin"
               and node.value["builtin"] in _MUTATING_BUILTINS
               and _root_var_name(node.value["arguments"][0]) is None)
        if not out:
            for child in _node_children(node):
                if anonymous_mutation(child):
                    out = True
                    break
        anon_memo[i] = out
        return out

    # ── What may hoist (#411 shared subtrees; #602 callback invariants) ─────
    #
    # A node referenced twice hoists as before. A node referenced ONCE hoists
    # only when that occurrence sits inside a callback body — where the
    # collection builtins run it per element — and it provably cannot tell
    # the difference: no rebound name (invariant), no effect, no mutable
    # value escaping anywhere but a read.
    def escapes(node, labels=frozenset(), bound=frozenset(), in_fn=False) -> bool:
        """Whether a statement inside ``node`` acts OUTSIDE it: a Return not
        enclosed by a nested function, a Break/Continue naming a loop the
        subtree does not contain, an Assign to a variable it does not bind."""
        kind = node.type
        payload = node.value
        if kind == "Return":
            return not in_fn
        if kind in ("Break", "Continue"):
            return payload["label"]["name"] not in labels
        if kind == "Assign":
            return payload["variable"].value["name"] not in bound
        if kind in ("Function", "AsyncFunction"):
            return any(escapes(c, labels, bound, True) for c in _node_children(node))
        if kind in ("While", "ForArray", "ForSet", "ForDict"):
            inner = labels | {payload["label"]["name"]}
            return any(escapes(c, inner, bound, in_fn) for c in _node_children(node))
        if kind == "Block":
            scope = set(bound)
            for stmt in payload["statements"]:
                if escapes(stmt, labels, frozenset(scope), in_fn):
                    return True
                if getattr(stmt, "type", None) == "Let":
                    scope.add(stmt.value["variable"].value["name"])
            return False
        return any(escapes(c, labels, bound, in_fn) for c in _node_children(node))

    hoistable: dict[int, str] = {}
    #: node id -> (Block id, statement index), or (None, 0) for the kernel body
    site: dict[int, tuple] = {}
    for i, n in counts.items():
        node = keep[i]
        solo = n < 2
        if solo and (i not in in_callback or node.type in _SOLO_SKIP_KINDS):
            continue
        if escapes(node):
            continue          # a statement acting outside the subtree stays put
        if i not in uncond_seen:
            continue          # every occurrence is branch-guarded — see above
        fv = free_vars(node, set())
        if fv & scope[i]:
            continue
        if fv & mutable_names:
            continue          # a reassignable binding: each read must stay put
        if mutated_free(node, set()):
            continue          # the effect must stay where the trace put it
        if solo:
            if anonymous_mutation(node):
                continue
            if _reaches_mutable(node.value["type"]) and not pure_parent.get(i, False):
                continue
        need = fv - param_names
        if need:
            home, at = binding_site(need, region.get(i, ()))
            if home is None:
                continue      # a name no enclosing Block on this path binds
        else:
            home, at = None, 0            # the kernel body, as before #595
        site[i] = (home, at)
        hoistable[i] = _fresh_name()

    lets: list = []                       # the kernel-body site
    block_lets: dict[int, list] = {}      # Block id -> [(index, order, let)]
    emitted: set[int] = set()
    memo: dict[int, Any] = {}
    kernel_fn_seen = False
    emit_order = 0

    arrayify = _arrayify

    def emit_let(i):
        nonlocal emit_order
        if i in emitted:
            return
        emitted.add(i)
        node = keep[i]
        value = rewrite(node, binding=i)
        # The hoisted Let stands in for the node it binds: it reports that
        # node's authoring location, not the finalize pass's.
        let = ir_let(NullType, _var(hoistable[i], node.value["type"]), value,
                     node.value["loc_id"])
        home, at = site[i]
        if home is None:
            lets.append(let)
            return
        # Emission is post-order, so a hoisted node nested inside another is
        # appended first; a container's site is never SHALLOWER than what it
        # contains (its needs are a superset), so ordering by (index, order)
        # keeps every dependency ahead of its user.
        emit_order += 1
        block_lets.setdefault(home, []).append((at, emit_order, let))

    def rewrite(node, binding=None):
        nonlocal kernel_fn_seen
        i = id(node)
        if i in hoistable and i != binding:
            emit_let(i)
            return _var(hoistable[i], node.value["type"])
        if binding is None and i in memo:
            return memo[i]
        is_kernel_fn = node is kernel_fn or (
            kernel_fn is None and node.type == "Function" and not kernel_fn_seen
        )
        if is_kernel_fn:
            kernel_fn_seen = True
        children = [rewrite(c) for c in _node_children(node)]
        if is_kernel_fn and (lets or hoistable):
            # splice the collected lets at the head of the kernel body —
            # rewriting the body above already emitted every needed let
            body = children[-1]
            if lets:
                from east.types.type_of_type import IRType

                # A Block takes its last statement's type — the body's,
                # which is Never for a body that always returns.
                body_type = body.value["type"]
                block: Any = EastVariant("Block", EastStruct({
                    "type": body_type, "loc_id": node.value["loc_id"],
                    "statements": EastArray(IRType, [*lets, body]),
                }))
                children[-1] = block
        result = arrayify(node, children)
        if node.type in ("Function", "AsyncFunction"):
            # The hoisting above may have replaced a subtree inside this
            # function's body with a reference to a Let bound OUTSIDE it
            # (a callback invariant, a shared node): its captures must list
            # that variable, or the IR is invalid — a nested function names
            # every outer variable it reads (the TS analyzer's rule).
            result = _with_recomputed_captures(result)
        own = block_lets.get(i) if node.type == "Block" else None
        if own:
            # Splice this Block's own lets in AFTER the rebuild: arrayify
            # sizes the statements array from the ORIGINAL node, so inserting
            # into `children` first would desynchronise it.
            from east.types.type_of_type import IRType

            stmts = list(result.value["statements"])
            for at, _order, let in sorted(own, reverse=True):
                stmts.insert(at, let)
            fields = {k: result.value[k] for k in result.value}
            fields["statements"] = EastArray(IRType, stmts)
            result = EastVariant("Block", EastStruct(fields))
        if binding is None:
            memo[i] = result
        return result

    return rewrite(top)


# ─── Tracing + compilation ──────────────────────────────────────────────────


def _function_ir(
    param_types: list[EastType],
    params: list,
    body: Expression,
    consts: list[tuple[str, Any, EastType]] = (),  # type: ignore[assignment]
    is_async: bool = False,
    out: EastType | None = None,
    cse: bool = True,
) -> Any:
    """The kernel's top-level IR value: a Function node, or — when constants
    hoisted — ``Block[Let …, Function(captures)]`` so each constant evaluates
    ONCE when the kernel compiles, not per call. Finalization runs the
    identity CSE (#411) and converts the lazy tree to real East arrays.
    ``is_async`` builds the AsyncFunction node/type instead (East.asyncFunction).
    ``out`` is the DECLARED output type — the function type's output even
    when the body diverges (a ``Never``-typed body that always returns);
    it defaults to the body's type. ``cse=False`` skips the CSE/hoisting
    pass entirely."""
    from east.expression.nodes import _k_async_function
    from east.types.types import AsyncFunctionType

    make_type = AsyncFunctionType if is_async else FunctionType
    make_node = _k_async_function if is_async else _k_function
    fn_type = make_type(list(param_types), out if out is not None else body.east_type)
    fn_node = make_node(
        fn_type,
        # Hoisted constants are captured so they survive the enclosing block.
        [_var(name, t) for name, _n, t in consts],
        params,
        body.ir,
    )
    top = fn_node
    if consts:
        # Each constant's Let reports the constructor node's own location —
        # the site that captured the constant.
        lets = [ir_let(NullType, _var(name, t), node, node.value["loc_id"])
                for name, node, t in consts]
        top = _k_block(fn_type, [*lets, fn_node])
    param_names = {p.value["name"] for p in params} | {name for name, _n, _t in consts}
    return _finalize_ir(top, param_names, kernel_fn=fn_node, cse=cse)
