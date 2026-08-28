#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Block-level control flow: loops, scopes, jumps and error handling (#578).

east-c has always compiled and executed ``While``, the ``For*`` family,
``Block``, ``Let``, ``NewRef``, ``TryCatch``, ``Break`` and ``Continue``. The
tracer emitted none of them, so a traced kernel could only ever be one pure
expression: a worklist, a BFS, a topological replay — anything whose next step
depends on the last — had no traced form and ran per element in python.

Python cannot spell these the way TypeScript does, because ``=`` is not
overloadable and ``while``/``if`` collapse to a ``bool`` before any tracer
sees them. The STATEMENT twin of the TypeScript ``$`` lives on the block a
body receives (``b.let`` / ``b.while_`` / ``b.for_`` / … —
``east.expression.statements``); what lives here is the EXPRESSION-level
sugar: **``while_`` is to ``while`` what ``if_else`` is to ``if``**.
The body is a pure function of the state that RETURNS the next state; like
every body it takes the block first::

    East.while_({"i": 0, "acc": 0},
                cond=lambda b, s: s.i < n,
                body=lambda b, s: {"acc": s.acc + s.i, "i": s.i + 1})

which lowers to a ``Ref`` holding the state struct, a ``While`` whose predicate
reads it and whose body does one ``RefUpdate``, and a final read. The state IS
the loop's local variables; ``if_else`` is the ``if``; a field left unchanged is
the empty else. Branching therefore composes for free::

    body=lambda b, s: {"i":     s.i + 1,
                       "total": if_else(items[s.i].qty > 0,
                                        s.total + items[s.i].qty,
                                        s.total)}

Everything here is dual-mode, exactly like ``if_else``: handed a trace it emits
IR, and outside one it runs the ordinary python loop (the body then receives
an ``EagerBlock``) — so one body serves both a captured callback and a direct
call on plain East values.

The python names are the IR node names, so an error message, an IR dump and
the docs all say the same word. The trailing underscore on ``while_`` /
``for_`` / ``break_`` / ``continue_`` follows ``East.Boolean.not_`` / ``and_``
/ ``or_``.
"""

from __future__ import annotations

from typing import Any

from east.expression.errors import ExpressionError
from east.expression.expr import Expression
from east.expression.lift import (
    _NO_STATE,
    _Jump,
    _lift,
    _pop_loop_frame,
    _push_loop_frame,
    _resume_hoisting,
    _suspend_hoisting,
    _tracing,
)
from east.expression.location import location_id as _loc_id
from east.expression.nodes import (
    _builtin,
    _fresh_name,
    _k_block,
    _k_new_array,
    _k_new_dict,
    _k_new_set,
    _literal,
    _var,
)
from east.ir.builders import (
    ir_for_array,
    ir_for_dict,
    ir_for_set,
    ir_label,
    ir_let,
    ir_new_ref,
    ir_trycatch,
    ir_while,
)
from east.types.types import (
    ArrayType,
    DictType,
    EastType,
    IntegerType,
    NullType,
    RefType,
    SetType,
    StringType,
)

__all__ = [
    "Label",
    "label",
    "while_",
    "for_",
    "block",
    "let",
    "ref",
    "break_",
    "continue_",
    "try_catch",
    "new_array",
    "new_set",
    "new_dict",
    "new_vector",
    "new_matrix",
]


# ─── Labels and jumps ───────────────────────────────────────────────────────


class Label:
    """A loop label — name a loop so a nested one can leave it.

    A single loop needs no label: drive its condition false to stop, and take
    the branch that only advances the cursor to skip. Labels are for the case
    with no such spelling — breaking out of an OUTER loop from an inner one.
    """

    __slots__ = ("name",)

    def __init__(self, name: str | None = None) -> None:
        self.name = name if name is not None else _fresh_name()

    def __repr__(self) -> str:
        return f"Label({self.name!r})"


def label(name: str | None = None) -> Label:
    """Create a loop label.

    Args:
        name: An explicit name, useful in an IR dump. Defaults to a
            trace-unique one.

    Returns:
        A :class:`Label` to pass as ``while_(..., label=…)`` and then to
        ``break_`` / ``continue_``.
    """
    return Label(name)


def _label_name(lbl: Any) -> str:
    """The IR name for a loop's label; ``""`` is the innermost loop."""
    if lbl is None:
        return ""
    if isinstance(lbl, Label):
        return lbl.name
    if isinstance(lbl, str):
        return lbl
    raise ExpressionError(
        "label must be a Label from East.label(...) or a plain string")


def _jump(kind: str, state: Any, lbl: Any) -> _Jump:
    if isinstance(state, Label):
        raise ExpressionError(
            f"{kind.lower()}_() takes the final state first — name the loop "
            f"with {kind.lower()}_(label=…)")
    return _Jump(kind, None if lbl is None else _label_name(lbl), state)


def break_(state: Any = _NO_STATE, *, label: Any = None) -> Any:
    """Leave the loop now — the state-threading sugar's jump value,
    optionally committing one last state. (The STATEMENT, TS
    ``$.break(label)``, is ``b.break_(label)`` on the block a loop body
    received.)

    Use it as an ``if_else`` arm inside a loop body — that is what types it::

        body=lambda b, s: if_else(s.queue.size() == 0, East.break_(), step(b, s))

    Without ``state`` the loop keeps what the iteration started with, so
    record the answer by passing the state you want::

        body=lambda b, s: if_else(rows[s.i].sku == target,
                                  East.break_({**s, "found": s.i}),
                                  {**s, "i": s.i + 1})

    Args:
        state: The state to commit before leaving, in the loop's own shape.
            Omit it to leave the state as the iteration found it.
        label: The loop to leave — a :class:`Label` or its name. Defaults to
            the innermost enclosing loop; naming an OUTER one is what labels
            are for, and the state then belongs to that outer loop.

    Returns:
        A jump value for an ``if_else`` arm.
    """
    _not_the_statement(state, "break_")
    return _jump("Break", state, label)


def _not_the_statement(state: Any, op: str) -> None:
    from east.expression.statements import LoopLabel

    if isinstance(state, LoopLabel):
        raise ExpressionError(
            f"East.{op}(label) is the statement — spell it b.{op}(label) on the "
            f"block the loop body received; East.{op}(state) is the "
            "state-threading sugar's jump value")


def continue_(state: Any = _NO_STATE, *, label: Any = None) -> Any:
    """Start the next iteration now, skipping the rest of the body — the
    state-threading sugar's jump value. (The STATEMENT, TS
    ``$.continue(label)``, is ``b.continue_(label)``.)

    Args:
        state: The state to commit before continuing. Omitting it in a
            ``while_`` re-tests the SAME state, which loops forever — so a
            bare ``continue_`` belongs in a ``for_``, whose cursor advances on
            its own.
        label: The loop to continue — defaults to the innermost.

    Returns:
        A jump value for an ``if_else`` arm.
    """
    _not_the_statement(state, "continue_")
    return _jump("Continue", state, label)


class _LoopFrame:
    """A loop, while its callbacks are being traced.

    ``break_``/``continue_`` find their loop through this: the ``name`` east-c
    matches jumps by, and ``commit`` to build that loop's state update — which
    is what lets a jump hand back a final state, including across a label to
    an outer loop whose ref an inner body could not otherwise reach.
    """

    __slots__ = ("name", "commit")

    def __init__(self, name: str, commit: Any) -> None:
        self.name = name
        self.commit = commit


class _JumpSignal(Exception):
    """A labelled jump travelling out to the eager loop it names."""

    def __init__(self, jump: _Jump) -> None:
        super().__init__(jump.kind)
        self.jump = jump


# ─── State threading ────────────────────────────────────────────────────────


class _EagerState:
    """The eager twin of a traced state struct.

    Attribute access, item access and ``keys()`` — so ``s.i``, ``s["i"]`` and
    ``{**s, "i": s.i + 1}`` mean the same thing whether the loop is tracing or
    running in python.
    """

    __slots__ = ("_fields",)

    def __init__(self, fields: dict) -> None:
        self._fields = fields

    def __getattr__(self, name: str) -> Any:
        try:
            return self._fields[name]
        except KeyError:
            raise AttributeError(
                f"loop state has no field '{name}' "
                f"(available: {', '.join(self._fields)})") from None

    def __getitem__(self, name: str) -> Any:
        return self._fields[name]

    def keys(self):
        return self._fields.keys()

    def __repr__(self) -> str:
        return f"<state {self._fields!r}>"


def _state_view(state: Any) -> Any:
    """What the eager cond/body sees: a field view for a dict state."""
    return _EagerState(state) if isinstance(state, dict) else state


def _fields_of(result: Any) -> dict | None:
    """The body's named fields, if it wrote any — a dict or the state view."""
    if isinstance(result, _EagerState):
        return dict(result._fields)
    return result if isinstance(result, dict) else None


def _check_state_fields(fields: dict, names: list[str]) -> dict:
    """Reorder a body's dict to the state's field order, or say what is wrong.

    The state's field ORDER is its East struct type, and a dict literal's
    order is whatever the body happened to write — the issue's own example
    seeds ``{"i", "acc"}`` and returns ``{"acc", "i"}``. Reordering here is
    what makes the natural spelling type-check.
    """
    missing = [n for n in names if n not in fields]
    extra = [k for k in fields if k not in names]
    if missing or extra:
        raise ExpressionError(
            f"loop body must return exactly the state fields {names} — "
            f"missing {missing}, unknown {extra}")
    return {n: fields[n] for n in names}


def _next_state(result: Any, state_t: EastType) -> Expression:
    """Lift a traced body result into the state's exact East type.

    A body may hand back the state EXPRESSION untouched — an iteration that
    only had side effects — so only a body that wrote a dict of fields is
    checked and reordered against the declared shape.
    """
    fields = _fields_of(result)
    if state_t.type == "Struct" and fields is not None:
        result = _check_state_fields(fields, [f["name"] for f in state_t.value])
    e = _lift(result, hint=state_t)
    if e.east_type != state_t:
        raise ExpressionError(_state_drift(state_t, e.east_type))
    return e


def _state_drift(state_t: EastType, got: EastType) -> str:
    """Name the field whose type moved, not just the two struct types."""
    if state_t.type == "Struct" and got.type == "Struct":
        before = {f["name"]: f["type"] for f in state_t.value}
        after = {f["name"]: f["type"] for f in got.value}
        missing = [n for n in before if n not in after]
        unknown = [n for n in after if n not in before]
        if missing or unknown:
            return (
                f"loop body returns a state with different fields than "
                f"{list(before)} — missing {missing}, unknown {unknown}. A "
                "nested loop's own state is separate: map its result back to "
                "this loop's shape."
            )
        moved = [f"{n}: {before[n].type} -> {after[n].type}"
                 for n in before if n in after and before[n] != after[n]]
        if moved:
            return (
                "loop body changed the state's type (" + "; ".join(moved) + "). "
                "Every iteration must produce the East types the initial state "
                "declares — seed an accumulator with 0.0, not 0, to keep it Float."
            )
    return f"loop body returns {got.type}, the loop state is {state_t.type}"


def _next_state_eager(result: Any, state: Any) -> Any:
    """The eager twin of :func:`_next_state` — same field checking, no types."""
    if not isinstance(state, dict):
        return result
    fields = _fields_of(result)
    if fields is None:
        raise ExpressionError(
            f"loop body must return the state as a dict of {list(state)}, "
            f"got {type(result).__name__}")
    return _check_state_fields(fields, list(state))


def _here(jump: _Jump, name: str) -> bool:
    """Whether an eager jump targets THIS loop (``None`` = the innermost)."""
    return jump.label is None or jump.label == name


def _jumped(result: Any, current: Any, name: str) -> tuple:
    """Resolve an eager iteration: ``(next state, whether the loop stops)``.

    A jump for an OUTER loop travels there as an exception, which is how the
    labelled form reaches a loop whose state this frame cannot see.
    """
    if not isinstance(result, _Jump):
        return _next_state_eager(result, current), False
    if not _here(result, name):
        raise _JumpSignal(result)
    if result.state is not _NO_STATE:
        current = _next_state_eager(result.state, current)
    return current, result.kind == "Break"


# ─── while_ ─────────────────────────────────────────────────────────────────


def while_(state: Any, cond: Any, body: Any = None, *, label: Any = None) -> Any:
    """Loop while a condition holds, threading a state — the EXPRESSION
    form. (The STATEMENT, TS ``$.while(pred, body)``, is
    ``b.while_(predicate, body)`` on the block the enclosing body received.)

    The traced form lowers to a ``Ref`` holding ``state``, a ``While`` whose
    predicate is ``cond(state)`` and whose body is one ``RefUpdate`` to
    ``body(state)``, then a final read — so the whole loop runs inside
    east-c with no per-iteration python. Outside a trace it runs the plain
    python loop, so the same lambda works on both paths.

    Args:
        state: The initial state — a dict of named fields (read as ``s.name``
            in the callbacks, and the usual shape) or a single value. Its East
            types are fixed for the whole loop.
        cond: ``cond(b, state) -> Boolean expression``. Evaluated before
            every iteration, so a zero-iteration loop returns ``state``
            unchanged.
        body: ``body(b, state) -> next state``, with the same fields and
            types. Branch with ``if_else``; a field left as ``s.field`` is
            unchanged.
        label: An optional :class:`Label` so a nested loop can ``break_`` out
            of this one.

    Returns:
        The state after the last iteration (a traced expression when tracing,
        a plain dict/value otherwise).

    Raises:
        ExpressionError: If ``cond`` does not return a Boolean, or ``body``
            returns different fields or different East types than ``state``.
    """
    if body is None:
        raise ExpressionError(
            "East.while_(predicate, body) is the statement — spell it "
            "b.while_(predicate, body) on the block the enclosing body received; "
            "East.while_(state, cond, body) is the state-threading expression")
    name = _label_name(label)
    if not _tracing():
        return _while_eager(state, cond, body, name)

    init = _lift_initial(state)
    state_t = init.east_type
    cell, ref_t, read, commit = _state_cell(state_t)

    def test_of(raw: Any) -> Any:
        test = _lift(raw)
        if test.east_type.type != "Boolean":
            raise ExpressionError(
                f"while_ cond must return a Boolean, got {test.east_type.type}")
        return test.ir

    _push_loop_frame(_LoopFrame(name, commit))
    try:
        test = _sugar_body(cond, (read,), test_of)
        step = _sugar_body(body, (read,), commit)
    finally:
        _pop_loop_frame()

    loop = ir_while(NullType, test, ir_label(name, _loc_id()), step, loc_id=_loc_id())
    return _loop_block(cell, ref_t, state_t, init, loop)


def _sugar_body(fn: Any, args: tuple, finish: Any) -> Any:
    """Run a state-threading body in its own frame, block first, and lower
    what it returns with ``finish`` (which yields the node's IR); statements
    the body appended precede that node in a Block."""
    from east.expression.lift import _check_effects
    from east.expression.statements import _open_run

    run = _open_run(fn, args, return_type=None)
    node = finish(run.result)
    if run.frame.statements:
        node = _k_block(node.value["type"], [*run.frame.statements, node])
    _check_effects(run.noted, node)
    return node


def _call_eager(fn: Any, args: tuple) -> Any:
    """Run a body eagerly: an ``EagerBlock`` first, then as many of ``args``
    as it declares."""
    from east.expression.statements import EagerBlock, _call_trimmed

    return _call_trimmed(fn, (EagerBlock(), *args))


def _lift_initial(state: Any) -> Expression:
    """Lift a loop's initial state, building captured constants INLINE.

    The state is the loop's mutable working set. A captured East collection
    normally hoists to a build-time constant the compiled function closes over
    — one value shared by every call — so seeding an accumulator with a
    captured ``EastArray(T)`` would have every call append to the same array.
    Inline, it is rebuilt per call. Constants the body or condition READ still
    hoist; only the seed is exempt.
    """
    previous = _suspend_hoisting()
    try:
        return _lift(state)
    finally:
        _resume_hoisting(previous)


def _state_cell(state_t: EastType):
    """The Ref a loop threads its state through.

    Returns the cell's name and type, the expression the callbacks read the
    state through, and ``commit`` — the update a body (or a jump carrying a
    final state) turns into.
    """
    cell = _fresh_name()
    ref_t = RefType(state_t)
    read = Expression(
        _builtin("RefGet", state_t, [state_t], [_var(cell, ref_t)]), state_t)

    def commit(value: Any):
        return _builtin("RefUpdate", NullType, [state_t],
                        [_var(cell, ref_t), _next_state(value, state_t).ir])

    return cell, ref_t, read, commit


def _loop_block(cell: str, ref_t: EastType, state_t: EastType,
                init: Expression, loop: Any) -> Expression:
    """Seed the state cell, run the loop, read the state back out."""
    loc = _loc_id()
    return Expression(
        _k_block(state_t, [
            ir_let(NullType, _var(cell, ref_t), ir_new_ref(ref_t, init.ir, loc), loc),
            loop,
            _builtin("RefGet", state_t, [state_t], [_var(cell, ref_t)]),
        ]),
        state_t,
    )


def _while_eager(state: Any, cond: Any, body: Any, name: str) -> Any:
    current = state
    while True:
        view = _state_view(current)
        if not _call_eager(cond, (view,)):
            return current
        try:
            result = _call_eager(body, (view,))
        except _JumpSignal as signal:
            if not _here(signal.jump, name):
                raise
            result = signal.jump
        current, stop = _jumped(result, current, name)
        if stop:
            return current


# ─── for_ ───────────────────────────────────────────────────────────────────


def for_(collection: Any, state: Any, body: Any = None, *, label: Any = None) -> Any:
    """Iterate a collection, threading a state — the EXPRESSION form. (The
    STATEMENT, TS ``$.for(coll, body)``, is ``b.for_(collection, body)`` on
    the block the enclosing body received.)

    Sugar over the same state threading as :func:`while_`, lowered to the
    ``ForArray`` / ``ForSet`` / ``ForDict`` node for the container's kind —
    the nodes TypeScript's ``$.for`` emits, and the only way to walk a Set or
    a Dict, which have no positional access to index with.

    Args:
        collection: An Array, Set or Dict expression (or an eager one).
        state: The initial state, exactly as :func:`while_` takes it.
        body: The step, in the container's own callback shape, the block
            first — Array ``body(b, state, element)`` (a fourth parameter
            receives the index), Set ``body(b, state, element)``, Dict
            ``body(b, state, key, value)``. It returns the next state.
        label: An optional :class:`Label` for ``break_`` / ``continue_``.

    Returns:
        The state after the last element; ``state`` unchanged when the
        collection is empty.

    Raises:
        ExpressionError: If ``collection`` is not a container, or ``body``
            returns a state of a different shape.
    """
    if body is None:
        raise ExpressionError(
            "East.for_(collection, body) is the statement — spell it "
            "b.for_(collection, body) on the block the enclosing body received; "
            "East.for_(collection, state, body) is the state-threading expression")
    name = _label_name(label)
    if not _tracing():
        return _for_eager(collection, state, body, name)

    source = _lift(collection)
    tag = source.east_type.type
    if tag not in ("Array", "Set", "Dict"):
        raise ExpressionError(f"for_ over {tag} — needs an Array, Set or Dict")

    init = _lift_initial(state)
    state_t = init.east_type
    cell, ref_t, read, commit = _state_cell(state_t)

    _push_loop_frame(_LoopFrame(name, commit))
    try:
        if tag == "Array":
            elem_t = source.east_type.value
            key = _var(_fresh_name(), IntegerType)
            value = _var(_fresh_name(), elem_t)
            step = _sugar_body(
                body, (read, Expression(value, elem_t), Expression(key, IntegerType)), commit)
        elif tag == "Set":
            elem_t = source.east_type.value
            key = _var(_fresh_name(), elem_t)
            value = None
            step = _sugar_body(body, (read, Expression(key, elem_t)), commit)
        else:
            kv = source.east_type.value
            key = _var(_fresh_name(), kv["key"])
            value = _var(_fresh_name(), kv["value"])
            step = _sugar_body(
                body, (read, Expression(key, kv["key"]), Expression(value, kv["value"])), commit)
    finally:
        _pop_loop_frame()

    loc = _loc_id()
    lbl = ir_label(name, loc)
    if tag == "Array":
        loop = ir_for_array(NullType, source.ir, lbl, key, value, step, loc)
    elif tag == "Set":
        loop = ir_for_set(NullType, source.ir, lbl, key, step, loc)
    else:
        loop = ir_for_dict(NullType, source.ir, lbl, key, value, step, loc)
    return _loop_block(cell, ref_t, state_t, init, loop)


def _for_eager(collection: Any, state: Any, body: Any, name: str) -> Any:
    from east.types.values import EastDict, EastSet

    step_args: list[tuple]
    if isinstance(collection, EastDict):
        step_args = [(k, v) for k, v in collection.items()]
    elif isinstance(collection, EastSet):
        step_args = [(el,) for el in collection]
    else:
        step_args = [(el, i) for i, el in enumerate(collection)]
    current = state
    for args in step_args:
        view = _state_view(current)
        try:
            result = _call_eager(body, (view, *args))
        except _JumpSignal as signal:
            if not _here(signal.jump, name):
                raise
            result = signal.jump
        current, stop = _jumped(result, current, name)
        if stop:
            return current
    return current


# ─── Scopes ─────────────────────────────────────────────────────────────────


def block(*exprs: Any) -> Any:
    """A block — two forms.

    ``East.block(fn)`` (TS ``East.block``) runs ``fn(b)`` in its own
    statement frame — ``b`` is the block, python's ``$`` — and is the
    EXPRESSION whose value is the last statement's: the statements ``fn``
    appends, then the value it returns (a block that returns nothing must
    diverge). This is how a statement is spelled inside an expression form
    (an ``if_else`` arm, a ``.match`` handler, a ``try_catch`` body)::

        East.if_else(c, East.block(lambda b: (b.do(log(x)), x + 1)[1]), x)

    ``East.block(e1, e2, …)`` evaluates each expression in order; the value
    is the last one — the sequencing point for the in-place mutators, which
    like their eager twins yield Null rather than the receiver::

        East.block(s.order.append(s.ready[0]), {**s, "i": s.i + 1})

    Args:
        exprs: One callable (the block form), or the expressions in
            evaluation order (at least one).

    Returns:
        The block's value.
    """
    if not exprs:
        raise ExpressionError("East.block() needs at least one expression")
    if len(exprs) == 1 and callable(exprs[0]) and not isinstance(exprs[0], Expression):
        from east.expression.statements import block_expression

        if not _tracing():
            return _call_eager(exprs[0], ())
        return block_expression(exprs[0])
    if not _tracing():
        return exprs[-1]
    lifted = [_lift(e) for e in exprs]
    out_t = lifted[-1].east_type
    return Expression(_k_block(out_t, [e.ir for e in lifted]), out_t)


def let(value: Any, fn: Any = None) -> Any:
    """Bind a value once and use it as often as you like inside
    ``fn(b, bound)``, whose value is the result — the EXPRESSION form. (The
    STATEMENT, TS ``$.let``, is ``b.let(value[, type])`` on the block the
    body received; ``b.const`` is its non-reassignable twin.)

    The tracer already binds a python-shared subexpression whose inputs are
    the kernel's own parameters; this is the explicit form, for a value that
    depends on a loop or lambda binding — where the automatic pass cannot
    hoist and the expression would otherwise be re-emitted, and re-executed,
    at every use site.

    Args:
        value: The expression to bind.
        fn: ``fn(b, bound) -> expression`` — the body.

    Returns:
        The body's value.
    """
    if fn is None or isinstance(fn, EastType):
        raise ExpressionError(
            "East.let(value[, type]) is the statement — spell it b.let(value[, type]) "
            "on the block the body received; East.let(value, fn) is the expression form")
    if not _tracing():
        return _call_eager(fn, (value,))
    from east.expression.statements import _frames, _run_block

    bound = _lift(value)
    name = _fresh_name()
    ret_t = _frames[-1].return_type if _frames else None
    body = _run_block(fn, (Expression(_var(name, bound.east_type), bound.east_type),),
                      return_type=ret_t, mode="block_expr")
    inner = list(body.ir.value["statements"]) if body.ir.type == "Block" else [body.ir]
    return Expression(
        _k_block(body.east_type, [
            ir_let(NullType, _var(name, bound.east_type), bound.ir, _loc_id()),
            *inner,
        ]),
        body.east_type,
    )


def ref(value: Any) -> Any:
    """A mutable reference cell holding ``value``.

    Read it with ``.get()``, replace it with ``.set(v)``, and read-modify-write
    with ``.update(fn)`` — the same three the eager ``EastRef`` has. A loop's
    state is threaded through a cell like this one already, so reach for an
    explicit ref only for a mutable local the state has no room for.

    Args:
        value: The cell's initial contents.

    Returns:
        A ``Ref``-typed expression when tracing, an ``EastRef`` otherwise.
    """
    if not _tracing():
        from east.types.values import EastRef

        return EastRef(value)
    inner = _lift(value)
    t = RefType(inner.east_type)
    return Expression(ir_new_ref(t, inner.ir, _loc_id()), t)


# ─── Fresh local collections ────────────────────────────────────────────────


def new_array(element_type: EastType, values: Any = ()) -> Any:
    """A FRESH Array, built each time the expression evaluates.

    This is the loop accumulator's constructor. A captured ``EastArray`` is a
    build-time snapshot the compiled kernel closes over — one value shared by
    every call — so appending to it would leak between calls; this builds a
    new one per evaluation instead.

    Args:
        element_type: The East element type.
        values: Optional initial elements.

    Returns:
        An Array expression when tracing, an ``EastArray`` otherwise.
    """
    if not _tracing():
        from east.types.values import EastArray

        return EastArray(element_type, list(values))
    t = ArrayType(element_type)
    return Expression(
        _k_new_array(t, [_lift(v, hint=element_type).ir for v in values]), t)


def new_set(element_type: EastType, values: Any = ()) -> Any:
    """A FRESH Set, built each time the expression evaluates (see
    :func:`new_array` for why a captured one will not do).

    Args:
        element_type: The East element type.
        values: Optional initial elements.

    Returns:
        A Set expression when tracing, an ``EastSet`` otherwise.
    """
    if not _tracing():
        from east.types.values import EastSet

        return EastSet(element_type, list(values))
    t = SetType(element_type)
    return Expression(
        _k_new_set(t, [_lift(v, hint=element_type).ir for v in values]), t)


def new_dict(key_type: EastType, value_type: EastType, entries: Any = ()) -> Any:
    """A FRESH Dict, built each time the expression evaluates (see
    :func:`new_array` for why a captured one will not do).

    Args:
        key_type: The East key type.
        value_type: The East value type.
        entries: Optional initial entries — a mapping or ``(key, value)`` pairs.

    Returns:
        A Dict expression when tracing, an ``EastDict`` otherwise.
    """
    pairs = list(entries.items()) if isinstance(entries, dict) else list(entries)
    if not _tracing():
        from east.types.values import EastDict

        return EastDict(key_type, value_type, dict(pairs))
    t = DictType(key_type, value_type)
    return Expression(
        _k_new_dict(t, [(_lift(k, hint=key_type).ir, _lift(v, hint=value_type).ir)
                        for k, v in pairs]),
        t,
    )


def new_vector(element_type: EastType, values: Any = ()) -> Any:
    """A FRESH Vector from scalar values (the ``NewVector`` node).

    Args:
        element_type: The element East type (Float, Integer or Boolean).
        values: The elements, in order.

    Returns:
        A Vector expression when tracing, an ``EastVector`` otherwise.
    """
    if not _tracing():
        from east.types.values import EastVector

        return EastVector(element_type, list(values))
    from east.expression.nodes import _k_new_vector
    from east.types.types import VectorType

    t = VectorType(element_type)
    return Expression(
        _k_new_vector(t, [_lift(v, hint=element_type).ir for v in values]), t)


def new_matrix(element_type: EastType, rows: int, cols: int, values: Any = ()) -> Any:
    """A FRESH ``rows`` × ``cols`` Matrix from row-major scalar values (the
    ``NewMatrix`` node).

    Args:
        element_type: The element East type (Float, Integer or Boolean).
        rows: The row count.
        cols: The column count.
        values: The ``rows * cols`` elements, row-major.

    Returns:
        A Matrix expression when tracing, an ``EastMatrix`` otherwise.
    """
    if not _tracing():
        from east.types.values import EastMatrix

        return EastMatrix(element_type, list(values), rows, cols)
    from east.expression.nodes import _k_new_matrix
    from east.types.types import MatrixType

    t = MatrixType(element_type)
    return Expression(
        _k_new_matrix(t, int(rows), int(cols), [_lift(v, hint=element_type).ir for v in values]), t)


# ─── try_catch ──────────────────────────────────────────────────────────────


def try_catch(body: Any, handler: Any, finally_: Any = None) -> Any:
    """Run ``body``; on an East runtime error run ``handler`` instead — the
    EXPRESSION form (TS ``East.tryCatch``). (The STATEMENT, TS ``$.try``,
    is ``b.try_(body).catch(handler).finally_(body)``.)

    Args:
        body: ``body(b) -> expression`` — the guarded computation.
        handler: ``handler(b, message)`` (a third parameter receives the
            location stack) returning a value of the SAME East type as
            ``body``'s.
        finally_: Optional ``finally_(b)``, evaluated for effect either way.

    Returns:
        The body's value, or the handler's when the body failed.

    Raises:
        ExpressionError: If the handler's East type differs from the body's.
    """
    if not _tracing():
        try:
            return _call_eager(body, ())
        except Exception as exc:  # the eager twin of "the body failed"
            return _call_eager(handler, (str(exc), []))
        finally:
            if finally_ is not None:
                _call_eager(finally_, ())

    from east.expression.lift import _coerce, _union_type
    from east.expression.statements import _frames, _run_block
    from east.types.type_of_type import LocationType

    ret_t = _frames[-1].return_type if _frames else None
    # The guarded body and the handler each run in their own statement frame
    # (TS `East.tryCatch(expr, handler)` builds the handler with `block`);
    # a body that appends no statement is exactly the expression it returns.
    guarded = _run_block(body, (), return_type=ret_t, mode="block_expr")
    message = _var(_fresh_name(), StringType)
    stack_t = ArrayType(LocationType)
    stack = _var(_fresh_name(), stack_t)
    caught = _run_block(
        handler, (Expression(message, StringType), Expression(stack, stack_t)),
        return_type=ret_t, mode="block_expr",
        out=None if guarded.east_type.type == "Never" else guarded.east_type)
    if (guarded.east_type.type != "Never" and caught.east_type.type != "Never"
            and caught.east_type != guarded.east_type):
        raise ExpressionError(
            f"try_catch handler returns {caught.east_type.type}, the body "
            f"returns {guarded.east_type.type} — both arms must agree")
    out_t = _union_type([guarded.east_type, caught.east_type], "try_catch()")
    guarded = guarded if guarded.east_type.type == "Never" else _coerce(guarded, out_t)
    caught = caught if caught.east_type.type == "Never" else _coerce(caught, out_t)
    ending = (_run_block(finally_, (), return_type=ret_t, mode="null_block")
              if finally_ is not None else None)
    return Expression(
        ir_trycatch(
            out_t,
            guarded.ir,
            caught.ir,
            message,
            stack,
            finally_body=ending.ir if ending is not None else _literal(None, NullType),
            loc_id=_loc_id(),
        ),
        out_t,
    )
