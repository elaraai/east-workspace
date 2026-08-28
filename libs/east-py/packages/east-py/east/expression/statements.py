#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Statement blocks — python's twin of the TypeScript ``BlockBuilder`` (``$``).

A TypeScript body receives ``$`` and appends STATEMENTS to it. A python body
receives ``b`` — a :class:`Block` — as its FIRST parameter and appends
statements the same way: ``b.let`` / ``b.const``, ``b.assign``,
``b.if_(...).else_if(...).else_(...)``, ``b.match_``, ``b.while_``,
``b.for_``, ``b.try_(...).catch(...).finally_(...)``, ``b.return_``,
``b.break_`` / ``b.continue_``, ``b.error``, and ``b.do(expr)`` for an
expression evaluated for its effect (TS ``$(expr)``). Every branch, loop
and handler body receives ITS OWN block first, then whatever the construct
hands it (an element, an index, a loop label, a case payload, an error
message) — so which block a statement belongs to is always written down,
and a statement issued on any other block is a build-time error.

EVERY body takes the block first — exactly as every TypeScript callback is
``($, …) => …``. An ``East.function`` body is ``lambda b, x: …``; a
builtin's callback is ``xs.map(lambda b, el: …)`` (trailing parameters of
the builtin's signature may be omitted, the block cannot); a statement
construct's body is ``b.if_(c, lambda b: …)``; an expression form's handler
is ``v.match({"some": lambda b, x: …})``; ``East.block(lambda b: …)``. A
callable declaring no first parameter for the block is refused with the
fix-it, and a body that uses the block as if it were the element (``lambda
x: x + 1``) fails on the block's first use. The same rule holds on the eager
value surface (``EastArray.map`` and friends capture their callback as a
body); a body a dual-mode construct runs eagerly receives an
:class:`EagerBlock`, whose statement methods refuse.

What is NOT a body takes no block: a compiled ``East.function``, a bound
function, a Function-typed expression, a platform declaration. Every slot
invokes what it holds body-style — ``fn(b, *values)`` — so such a callable
drops a leading block (:func:`_drop_block`) and serves any slot, exactly
as a TypeScript ``Expr<FunctionType>`` does where a ``($, …) => …`` is
accepted.

Bodies are assembled by the SAME rules the TypeScript builder applies, so a
program spelled statement-for-statement in both languages builds identical
IR (the contract the IR→python printer and the conformance round-trip rely
on):

- the value a body returns is appended as its final statement unless it IS
  the last statement already (``return`` after ``b.do`` of the same
  expression);
- a function body (``East.function``, a callback) with no statements is
  ``Value null``, one statement is that statement, more is a ``Block``
  typed by its last statement;
- a branch / loop / catch / finally body is padded with ``Value null`` when
  its last statement is not Null-typed, so every such body is Null (or
  Never, when it always leaves);
- ``East.block(fn)`` is the expression form: the value is the last
  statement's, and a block with no returned value must diverge.

Python ``None`` returned from a body is TypeScript ``undefined`` — nothing
appended; the ``east_null`` sentinel is TypeScript ``null`` — an explicit
``Value null`` statement.

Every node is typed the way the TypeScript builder types it: ``Let`` and
``Assign`` are ``Null``; ``Return``, ``Break``, ``Continue`` and ``Error``
are ``Never``; a statement ``IfElse``/``Match``/``While``/``For*``/``TryCatch``
is ``Null`` (``Never`` when every arm diverges); a ``Block`` takes its last
statement's type. Appending after a diverging statement raises, as the
TypeScript builder's "Unreachable statement detected" does.
"""

from __future__ import annotations

import inspect
from typing import Any

from east.expression.errors import ExpressionError
from east.expression.lift import (
    _check_effects,
    _coerce,
    _effect_frames,
    _lift,
    _note_effect,
    _pop_loop_frame,
    _push_effects,
    _push_loop_frame,
    _take_effects,
    _tracing,
)
from east.expression.location import location_id as _loc_id
from east.expression.nodes import _fresh_name, _k_block, _k_ifelse, _k_match, _literal, _var
from east.ir.builders import (
    ir_assign,
    ir_break,
    ir_continue,
    ir_error,
    ir_for_array,
    ir_for_dict,
    ir_for_set,
    ir_label,
    ir_let,
    ir_return,
    ir_trycatch,
    ir_variable,
    ir_while,
)
from east.types.types import (
    ArrayType,
    BooleanType,
    EastType,
    NeverType,
    NullType,
    StringType,
    is_subtype,
)
from east.types.values import EastStruct, EastVariant

__all__ = [
    "Block",
    "EagerBlock",
    "LoopLabel",
    "IfBuilder",
    "TryBuilder",
    "error",
    "block_expression",
]

#: The fix-it every "no block" refusal carries.
_BLOCK_FIRST = "a body takes the block first (TS `($, …) => …`): lambda b, …: …"


# ─── Frames ─────────────────────────────────────────────────────────────────


class _Frame:
    """One open statement block: the statements appended so far and the
    enclosing function's declared return type (what ``b.return_`` checks
    against; ``None`` inside a callback whose output is inferred)."""

    __slots__ = ("statements", "return_type")

    def __init__(self, return_type: EastType | None) -> None:
        self.statements: list = []
        self.return_type = return_type


#: The open frames, innermost last. Opened by every build (``trace``), every
#: callback capture and every branch/loop body; closed when the body returns.
_frames: list[_Frame] = []


def _open_frame(return_type: EastType | None) -> _Frame:
    frame = _Frame(return_type)
    _frames.append(frame)
    return frame


def _close_frame(frame: _Frame) -> None:
    assert _frames and _frames[-1] is frame, "statement frames closed out of order"
    _frames.pop()


def _check_open(frame: _Frame, op: str) -> None:
    """``frame`` must be the innermost OPEN frame: a statement belongs to the
    block the body it sits in received (TypeScript's no-cross-block-builder
    rule, a build-time error here), and is recorded while that body runs."""
    if _tracing() and _frames and _frames[-1] is frame:
        return
    if any(f is frame for f in _frames):
        raise ExpressionError(
            f"b.{op}() was called on an OUTER block while a nested body is open — "
            "a statement belongs to the block the body it sits in received (the "
            "first parameter of every branch, loop and handler body)"
        )
    raise ExpressionError(
        f"b.{op}() was called on a block whose body has already returned — "
        "statements are recorded while the body that received the block runs"
    )


def _node_type(node: Any) -> EastType:
    return node.value["type"]


def _is_never(t: EastType) -> bool:
    return t.type == "Never"


def _check_reachable(frame: _Frame, op: str) -> None:
    """The TypeScript builder's "Unreachable statement detected"."""
    if frame.statements and _is_never(_node_type(frame.statements[-1])):
        raise ExpressionError(
            f"Unreachable statement detected: b.{op}() follows a statement that "
            "never completes (return_/break_/continue_/error)"
        )


def _null_value():
    return _literal(None, NullType)


def _positional(fn: Any) -> tuple[int, int] | None:
    """``(required, total)`` positional parameters ``fn`` declares; ``None``
    for ``*args`` or an uninspectable callable."""
    try:
        params = inspect.signature(fn).parameters.values()
    except (TypeError, ValueError):
        return None
    required = total = 0
    for p in params:
        if p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD):
            total += 1
            if p.default is p.empty:
                required += 1
        elif p.kind is p.VAR_POSITIONAL:
            return None
    return required, total


def _arity(fn: Any) -> int | None:
    """Positional parameters ``fn`` declares (defaulted ones included);
    ``None`` for ``*args`` or an uninspectable callable."""
    counts = _positional(fn)
    return None if counts is None else counts[1]


def _body_arity(fn: Any) -> int | None:
    """How many PAYLOAD parameters a body declares after the block — the
    count the constructs trim their arguments to; ``None`` for ``*args``.
    A callable with no parameter at all has no room for the block and is
    refused."""
    counts = _positional(fn)
    if counts is None:
        return None
    if counts[1] == 0:
        raise ExpressionError(f"a body with no parameters cannot receive the block — {_BLOCK_FIRST}")
    return counts[1] - 1


def _call_trimmed(fn: Any, args: tuple) -> Any:
    """Call a body with the block first and as many of the payload ``args``
    as it declares (TypeScript passes every argument and JavaScript ignores
    the extras; python must not). ``args[0]`` is the block."""
    n = _body_arity(fn)
    return fn(*args) if n is None else fn(*args[: n + 1])


def _call_function_body(fn: Any, frame: _Frame, proxies: list, what: str) -> Any:
    """Run an ``East.function`` body over its parameter proxies, the frame's
    :class:`Block` first (``lambda b, x: …``): the body must declare the
    block plus exactly the function's parameters."""
    n = len(proxies)
    counts = _positional(fn)
    if counts is not None and not (counts[0] <= n + 1 <= counts[1]):
        raise ExpressionError(
            f"{what} body declares {counts[1]} parameter(s) for a {n}-parameter "
            f"function — {_BLOCK_FIRST}"
        )
    return fn(Block(frame), *proxies)


def _drop_block(args: tuple) -> tuple:
    """``args`` without a leading block — for a callable that is NOT a body.

    A compiled ``East.function``, a bound function, a Function-typed
    expression and a platform declaration are values, not bodies: they take
    no block. Every slot invokes what it holds body-style, ``fn(b,
    *values)`` (the wrappers that reorder or pad a builtin's arguments do
    too), so such a callable drops the block and serves any slot. Checked
    on the TYPE: an expression proxy's ``__getattr__`` must not fire.
    """
    if args and getattr(type(args[0]), "_east_block", False):
        return tuple(args[1:])
    return args


class _Run:
    """A body that has RUN but not yet assembled: its frame, the value it
    returned, and the effects it noted — so a sibling can settle the type
    the assembly lifts the value under (a match's arms)."""

    __slots__ = ("frame", "result", "noted")

    def __init__(self, frame: _Frame, result: Any, noted: list) -> None:
        self.frame = frame
        self.result = result
        self.noted = noted


def _open_run(fn: Any, args: tuple, *, return_type: EastType | None) -> _Run:
    """Run ``fn`` in a fresh frame; assemble later with :func:`_finish_run`.
    The body receives the frame's :class:`Block` first, then ``args``
    (trimmed to what it declares)."""
    frame = _open_frame(return_type)
    _push_effects()
    try:
        try:
            result = _call_trimmed(fn, (Block(frame), *args))
        except ExpressionError:
            raise
        except Exception as e:
            raise ExpressionError(f"the body is not traceable: {e}") from e
    except BaseException:
        _effect_frames.pop()
        _close_frame(frame)
        raise
    noted = _take_effects()
    _close_frame(frame)
    return _Run(frame, result, noted)


def _finish_run(run: _Run, mode: str, out: EastType | None = None) -> Any:
    """Assemble a run body per ``mode`` (see :func:`assemble`). An effect
    noted inside the body (a mutation, an ``East.error``) that never reaches
    the assembled body raises — python evaluates a bare expression statement
    and throws its value away, and silence would drop the statement from the
    program."""
    body = assemble(run.frame, run.result, mode, out)
    _check_effects(run.noted, body.ir)
    return body


def _run_block(fn: Any, args: tuple, *, return_type: EastType | None, mode: str,
               out: EastType | None = None) -> Any:
    """Run ``fn`` in a fresh frame and assemble the body per ``mode``;
    returns the body as an ``Expression``."""
    return _finish_run(_open_run(fn, args, return_type=return_type), mode, out)


def assemble(frame: _Frame, result: Any, mode: str, out: EastType | None = None) -> Any:
    """Turn a run body into its IR, by the TypeScript builder's rules.

    ``mode``:

    - ``"function"`` — an ``East.function`` / callback body (TS ``func``):
      returned value appended unless it is the last statement; no
      statements → ``Value null``; one → itself; more → ``Block``.
    - ``"null_block"`` — a branch, loop, match-case, try, catch or finally
      body (TS ``$.if``/``$.while``/``$.for``/``$.match``/``$.try``…): as
      above, then padded with ``Value null`` when the last statement is not
      Null-typed (a diverging ``Never`` statement counts as Null).
    - ``"block_expr"`` — ``East.block(fn)`` (TS ``East.block``): the value
      is the last statement's; a body returning nothing must diverge.
    - ``"value_function"`` — ``East.value(fn, FunctionType)`` (TS
      ``from``): a Null output pads like ``null_block``; any other output
      requires at least one statement and a body of that type.
    """
    from east.expression.expr import Expression

    stmts = frame.statements
    if isinstance(result, (IfBuilder, TryBuilder)):
        # `lambda b: b.if_(c, …)` — the statement is already appended; the
        # chain builder it returned is not a value.
        result = None
    if result is not None:
        r = _lift(result, hint=out)
        if not stmts or stmts[-1] is not r.ir:
            stmts.append(r.ir)

    if mode == "null_block" or (mode == "value_function" and out is not None
                                and out.type == "Null"):
        if not stmts or not is_subtype(_node_type(stmts[-1]), NullType):
            stmts.append(_null_value())
        if len(stmts) == 1:
            body = stmts[0]
        else:
            body = _k_block(_node_type(stmts[-1]), stmts)
        return Expression(body, _node_type(body))

    if mode == "block_expr" and result is None:
        last_t = _node_type(stmts[-1]) if stmts else NullType
        if not _is_never(last_t):
            raise ExpressionError(
                f"block without return must have type Never, got {last_t.type} - "
                "try returning the final expression or adding `return east_null`"
            )

    if mode == "value_function" and not stmts:
        raise ExpressionError(
            f"Function expected output of type {out.type if out else '?'}, but "
            "no function body or statements were provided"
        )

    if not stmts:
        body = _null_value()
    elif len(stmts) == 1:
        body = stmts[0]
    else:
        body = _k_block(_node_type(stmts[-1]), stmts)
    return Expression(body, _node_type(body))


# ─── Labels ─────────────────────────────────────────────────────────────────


class LoopLabel:
    """The label a loop body receives — what ``b.break_`` / ``b.continue_``
    name to leave or continue it (TS ``Label``)."""

    __slots__ = ("name", "loc_id")

    def __init__(self, name: str, loc_id: int) -> None:
        self.name = name
        self.loc_id = loc_id

    def __repr__(self) -> str:
        return f"LoopLabel({self.name!r})"

    def ir(self) -> EastStruct:
        return ir_label(self.name, self.loc_id)


# ─── The block ──────────────────────────────────────────────────────────────


class Block:
    """The statement block a body receives as its first parameter — python's
    ``$``. Each method appends one statement to the body and returns it
    (or, for ``let``/``const``, the variable it bound)::

        @East.function([IntegerType], StringType)
        def classify(b, n):
            acc = b.let(0)
            def loop(b, label):
                b.if_(acc >= n, lambda b: b.break_(label))
                b.assign(acc, acc + 1)
            b.while_(True, loop)
            b.if_(acc > 10, lambda b: b.return_("big")) \\
                .else_(lambda b: b.return_("small"))

    A block is live only while the body that received it runs, and only
    while no nested body is open: a statement on an outer block from inside
    a branch, or on a block whose body has returned, raises.
    """

    __slots__ = ("_frame",)
    _east_block = True  # what _drop_block recognises

    def __init__(self, frame: _Frame) -> None:
        self._frame = frame

    def __repr__(self) -> str:
        return f"<East block: {len(self._frame.statements)} statement(s)>"

    def __getattr__(self, name: str) -> Any:
        # `lambda x: x.price` — the body's first parameter IS the block, so
        # `x` is this object: say so, with the fix-it, instead of an
        # AttributeError about a Block.
        raise ExpressionError(
            f"the first parameter of a body is the block, which has no attribute "
            f"{name!r} — {_BLOCK_FIRST}"
        )

    def _use(self, op: str) -> _Frame:
        _check_open(self._frame, op)
        _check_reachable(self._frame, op)
        return self._frame

    def do(self, expr: Any) -> Any:
        """Append an expression as a statement, evaluated for its effect (TS
        ``$(expr)``): a platform call, a mutation, a call whose value is
        unused.

        Args:
            expr: The expression (or a liftable python value).

        Returns:
            The expression, typed as it was.
        """
        frame = self._use("do")
        e = _lift(expr)
        frame.statements.append(e.ir)
        return e

    def const(self, value: Any, typ: EastType | None = None) -> Any:
        """Bind a value to a new CONST variable (TS ``$.const``): the
        variable cannot be reassigned, though a mutable value it holds may
        be mutated.

        Args:
            value: The value — an expression or a liftable python value.
            typ: Optional declared East type; the value's type must be a
                subtype (a narrower struct/variant literal widens to it).

        Returns:
            The variable, as an expression of the declared (or the value's)
            type.
        """
        return _bind(self._use("const"), value, typ, mutable=False, op="const")

    def let(self, value: Any, typ: EastType | None = None) -> Any:
        """Bind a value to a new MUTABLE variable (TS ``$.let``) — reassign
        it with :meth:`assign`.

        Args:
            value: The value — an expression or a liftable python value.
            typ: Optional declared East type (as for :meth:`const`).

        Returns:
            The variable, as an expression.
        """
        return _bind(self._use("let"), value, typ, mutable=True, op="let")

    def assign(self, variable: Any, value: Any) -> Any:
        """Reassign a variable bound with :meth:`let` (TS ``$.assign``).

        Args:
            variable: The variable expression ``b.let`` returned.
            value: The new value — its type must be a subtype of the
                variable's.

        Returns:
            The Null-typed Assign statement.

        Raises:
            ExpressionError: If ``variable`` is not a variable, was bound
                with ``b.const``, or ``value`` has the wrong type.
        """
        from east.expression.expr import Expression

        frame = self._use("assign")
        if not isinstance(variable, Expression):
            raise ExpressionError("Can only assign to a variable")
        node = variable.ir
        if node.type == "UnwrapRecursive":
            node = node.value["value"]
        if node.type != "Variable":
            raise ExpressionError("Can only assign to a variable")
        if not node.value["mutable"]:
            raise ExpressionError(
                "Cannot assign to a variable defined as const — bind it with b.let "
                "to reassign it"
            )
        var_t = node.value["type"]
        e = value if isinstance(value, Expression) else _lift(value, hint=var_t)
        if not is_subtype(e.east_type, var_t):
            raise ExpressionError(
                f"b.assign() value has East type {e.east_type.type}, the variable "
                f"holds {var_t.type}"
            )
        stmt = ir_assign(NullType, node, _coerce(e, var_t).ir, _loc_id())
        frame.statements.append(stmt)
        return Expression(stmt, NullType)

    def return_(self, value: Any = None) -> Any:
        """Return from the enclosing function now (TS ``$.return``).

        Args:
            value: The value to return — an expression or a liftable
                python value; omitted for a Null-typed function.

        Returns:
            The Never-typed Return statement.

        Raises:
            ExpressionError: If the value's type is not a subtype of the
                function's declared output.
        """
        from east.expression.expr import Expression

        frame = self._use("return_")
        e = (Expression(_null_value(), NullType) if value is None
             else _lift(value, hint=frame.return_type))
        if frame.return_type is not None and not is_subtype(e.east_type, frame.return_type):
            raise ExpressionError(
                f"b.return_() value has East type {e.east_type.type}, the function "
                f"returns {frame.return_type.type}"
            )
        # The value may already be the last statement (a `b.do(x)` followed
        # by `b.return_(x)`): the TypeScript builder pops it, so do we.
        if isinstance(value, Expression) and frame.statements and frame.statements[-1] is e.ir:
            frame.statements.pop()
        stmt = ir_return(NeverType, e.ir, _loc_id())
        frame.statements.append(stmt)
        return Expression(stmt, NeverType)

    def error(self, message: Any) -> Any:
        """Raise an East runtime error now (TS ``$.error``): a Never-typed
        statement — nothing after it in the body is reachable.

        Args:
            message: The error message — a String expression or python str.

        Returns:
            The Never-typed Error statement.
        """
        from east.expression.expr import Expression

        frame = self._use("error")
        node = _error_node(message)
        frame.statements.append(node)
        return Expression(node, NeverType)

    def if_(self, predicate: Any, body: Any) -> IfBuilder:
        """Run ``body`` when ``predicate`` holds (TS ``$.if``); chain
        ``.else_if(...)`` and ``.else_(...)`` on the result.

        Args:
            predicate: A Boolean expression (or python bool).
            body: ``body(b)`` — run in its own frame with its own block;
                the value it returns (if any) is the arm's final statement.

        Returns:
            An :class:`IfBuilder` (the statement is already appended).
        """
        frame = self._use("if_")
        p = _predicate(predicate, "if")
        arm = _run_block(body, (), return_type=frame.return_type, mode="null_block")
        node = _k_ifelse(NullType, [(p.ir, arm.ir)], _null_value())
        frame.statements.append(node)
        return IfBuilder(frame, node)

    def match_(self, variant: Any, cases: dict) -> Any:
        """Branch on a variant's case for effect (TS ``$.match``): each
        handler ``handler(b, data)`` runs in its own frame with the case's
        payload; a case without a handler does nothing.

        Args:
            variant: A Variant-typed expression.
            cases: ``{case_name: handler}`` — a handler takes its block,
                then the payload expression (either may be omitted).

        Returns:
            The Null-typed Match statement.
        """
        from east.expression.expr import Expression

        frame = self._use("match_")
        v = _lift(variant)
        if v.east_type.type != "Variant":
            raise ExpressionError(f"match not defined over {v.east_type.type}")
        names = [c["name"] for c in v.east_type.value]
        unknown = [k for k in cases if k not in names]
        if unknown:
            raise ExpressionError(f"b.match_() has no case {unknown[0]!r} (cases: {', '.join(names)})")
        case_nodes = []
        for c in v.east_type.value:
            var = _var(_fresh_name(), c["type"])
            handler = cases.get(c["name"])
            if handler is None:
                body = _null_value()
            else:
                body = _run_block(handler, (Expression(var, c["type"]),),
                                  return_type=frame.return_type, mode="null_block").ir
            case_nodes.append((c["name"], var, body))
        node = _k_match(NullType, v.ir, case_nodes)
        frame.statements.append(node)
        return Expression(node, NullType)

    def while_(self, predicate: Any, body: Any) -> Any:
        """Loop while ``predicate`` holds (TS ``$.while``).

        Args:
            predicate: A Boolean expression, re-evaluated before every
                iteration.
            body: ``body(b, label)`` — run in its own frame; the
                :class:`LoopLabel` names this loop for :meth:`break_` /
                :meth:`continue_`.

        Returns:
            The Null-typed While statement.
        """
        from east.expression.expr import Expression

        frame = self._use("while_")
        p = _predicate(predicate, "while")
        lbl = LoopLabel(_fresh_name(), _loc_id())
        _push_loop_frame(_StatementLoop(lbl.name))
        try:
            arm = _run_block(body, (lbl,), return_type=frame.return_type, mode="null_block")
        finally:
            _pop_loop_frame()
        node = ir_while(NullType, p.ir, lbl.ir(), arm.ir, _loc_id())
        frame.statements.append(node)
        return Expression(node, NullType)

    def for_(self, collection: Any, body: Any) -> Any:
        """Loop over a collection's elements (TS ``$.for``).

        Args:
            collection: An Array, Set or Dict expression.
            body: The step, run in its own frame per element — Array
                ``body(b, value, index, label)``, Set ``body(b, key,
                label)``, Dict ``body(b, value, key, label)``; trailing
                parameters may be omitted.

        Returns:
            The Null-typed ForArray / ForSet / ForDict statement.
        """
        from east.expression.expr import Expression

        frame = self._use("for_")
        src = _lift(collection)
        tag = src.east_type.type
        if tag == "Array":
            elem_t = src.east_type.value
            value_var = _var(_fresh_name(), elem_t)
            key_var = _var(_fresh_name(), _integer())
            lbl = LoopLabel(_fresh_name(), _loc_id())
            args = (Expression(value_var, elem_t), Expression(key_var, _integer()), lbl)
        elif tag == "Set":
            elem_t = src.east_type.value
            key_var = _var(_fresh_name(), elem_t)
            value_var = None
            lbl = LoopLabel(_fresh_name(), _loc_id())
            args = (Expression(key_var, elem_t), lbl)
        elif tag == "Dict":
            kv = src.east_type.value
            value_var = _var(_fresh_name(), kv["value"])
            key_var = _var(_fresh_name(), kv["key"])
            lbl = LoopLabel(_fresh_name(), _loc_id())
            args = (Expression(value_var, kv["value"]), Expression(key_var, kv["key"]), lbl)
        else:
            raise ExpressionError(
                f"for not defined over {tag} - you can only loop over arrays, sets and dictionaries"
            )
        _push_loop_frame(_StatementLoop(lbl.name))
        try:
            arm = _run_block(body, args, return_type=frame.return_type, mode="null_block")
        finally:
            _pop_loop_frame()
        loc = _loc_id()
        if tag == "Array":
            node = ir_for_array(NullType, src.ir, lbl.ir(), key_var, value_var, arm.ir, loc)
        elif tag == "Set":
            node = ir_for_set(NullType, src.ir, lbl.ir(), key_var, arm.ir, loc)
        else:
            node = ir_for_dict(NullType, src.ir, lbl.ir(), key_var, value_var, arm.ir, loc)
        frame.statements.append(node)
        return Expression(node, NullType)

    def break_(self, label: LoopLabel) -> Any:
        """Leave the loop ``label`` names now (TS ``$.break``)."""
        return _jump_statement(self._use("break_"), "Break", label, "break_")

    def continue_(self, label: LoopLabel) -> Any:
        """Start the next iteration of the loop ``label`` names (TS
        ``$.continue``)."""
        return _jump_statement(self._use("continue_"), "Continue", label, "continue_")

    def try_(self, body: Any) -> TryBuilder:
        """Run ``body`` and catch any East runtime error it raises (TS
        ``$.try``); chain ``.catch(handler)`` and ``.finally_(body)``.

        Args:
            body: ``body(b)`` — run in its own frame.

        Returns:
            A :class:`TryBuilder` (the statement is already appended).
        """
        from east.types.type_of_type import LocationType

        frame = self._use("try_")
        tb = _run_block(body, (), return_type=frame.return_type, mode="null_block")
        message = _var(_fresh_name(), StringType)
        stack = _var(_fresh_name(), ArrayType(LocationType))
        node = ir_trycatch(NullType, tb.ir, _null_value(), message, stack,
                           finally_body=_null_value(), loc_id=_loc_id())
        frame.statements.append(node)
        return TryBuilder(frame, node, message, stack)


def _block_misuse(op: str) -> Any:
    def refuse(_self: Any, *_args: Any, **_kwargs: Any) -> Any:
        raise ExpressionError(
            f"the first parameter of a body is the block, which cannot be used "
            f"as a value ({op}) — {_BLOCK_FIRST}"
        )

    refuse.__name__ = op
    return refuse


# A block used as a value (`lambda x: x + 1` with x the block) fails on the
# first operator, naming the mistake instead of a TypeError about a Block.
for _op in ("__add__", "__radd__", "__sub__", "__rsub__", "__mul__", "__rmul__",
            "__truediv__", "__rtruediv__", "__neg__", "__lt__", "__le__", "__gt__",
            "__ge__", "__eq__", "__ne__", "__and__", "__or__", "__xor__", "__invert__",
            "__getitem__", "__call__", "__iter__", "__bool__", "__len__"):
    setattr(Block, _op, _block_misuse(_op))
Block.__hash__ = object.__hash__  # type: ignore[method-assign]
del _op


class EagerBlock:
    """The block a body receives when a dual-mode construct runs it EAGERLY
    on plain values (``East.while_`` outside a build, ``EastVariant.match``,
    ``EastRef.update``, …): the same first parameter as always, so one body
    serves both paths — but there is no program to append to, so every
    statement method refuses."""

    __slots__ = ()
    _east_block = True

    def __repr__(self) -> str:
        return "<East block (eager)>"

    def __getattr__(self, name: str) -> Any:
        if name in _STATEMENT_METHODS:
            raise ExpressionError(
                f"b.{name}() is a build-time statement — this body is running "
                "eagerly on plain values, where there is no program to append "
                "to; build the function with East.function to use statements"
            )
        raise ExpressionError(
            f"the first parameter of a body is the block, which has no attribute "
            f"{name!r} — {_BLOCK_FIRST}"
        )


_STATEMENT_METHODS = frozenset({
    "do", "const", "let", "assign", "return_", "error", "if_", "match_", "while_",
    "for_", "break_", "continue_", "try_",
})


# ─── Statement internals ────────────────────────────────────────────────────


def _bind(frame: _Frame, value: Any, typ: Any, mutable: bool, op: str) -> Any:
    from east.expression.expr import Expression

    if typ is not None and not isinstance(typ, EastType):
        raise TypeError(f"b.{op}(value, type) takes an East type second, got {type(typ).__name__}")
    e = value if isinstance(value, Expression) else _lift(value, hint=typ)
    if typ is not None and not is_subtype(e.east_type, typ):
        raise ExpressionError(
            f"b.{op}() value has East type {e.east_type.type}, the declared "
            f"type is {typ.type}"
        )
    var_t = typ if typ is not None else e.east_type
    bound = _coerce(e, var_t)
    var = ir_variable(var_t, _fresh_name(), _loc_id(), mutable=mutable)
    frame.statements.append(ir_let(NullType, var, bound.ir, _loc_id()))
    return Expression(var, var_t)


def _predicate(value: Any, op: str) -> Any:
    p = _lift(value, hint=BooleanType)
    if p.east_type.type != "Boolean":
        raise ExpressionError(f"{op} predicate expected to have type Boolean, got {p.east_type.type}")
    return p


def _error_node(message: Any) -> Any:
    m = _lift(message, hint=StringType)
    if m.east_type.type != "String":
        raise ExpressionError(f"Error message must be String type, got {m.east_type.type}")
    return ir_error(NeverType, m.ir, _loc_id())


class IfBuilder:
    """The ``b.if_`` chain: ``.else_if(pred, body)`` adds an arm,
    ``.else_(body)`` closes it (TS ``$.if(...).elseIf(...).else(...)``)."""

    __slots__ = ("_frame", "_node")

    def __init__(self, frame: _Frame, node: Any) -> None:
        self._frame = frame
        self._node = node

    def _replace(self, new_node: Any) -> None:
        stmts = self._frame.statements
        for i in range(len(stmts) - 1, -1, -1):
            if stmts[i] is self._node:
                stmts[i] = new_node
                break
        self._node = new_node

    def else_if(self, predicate: Any, body: Any) -> IfBuilder:
        """Add an ``else if`` arm; ``body(b)`` runs in its own frame."""
        _check_open(self._frame, "if_().else_if")
        p = _predicate(predicate, "elseIf")
        arm = _run_block(body, (), return_type=self._frame.return_type, mode="null_block")
        payload = self._node.value
        self._replace(_rebuild_ifelse(
            payload["type"], payload["loc_id"],
            [*payload["ifs"], EastStruct({"predicate": p.ir, "body": arm.ir})],
            payload["else_body"]))
        return self

    def else_(self, body: Any) -> Any:
        """Close the chain with the ``else`` arm (``body(b)``). The
        statement becomes ``Never``-typed when every arm diverges."""
        from east.expression.expr import Expression

        _check_open(self._frame, "if_().else_")
        arm = _run_block(body, (), return_type=self._frame.return_type, mode="null_block")
        payload = self._node.value
        ifs = list(payload["ifs"])
        can_terminate = True
        for case in ifs:
            if _is_never(_node_type(case["predicate"])):
                can_terminate = False
                break
            if not _is_never(_node_type(case["body"])):
                break
        else:
            if _is_never(arm.east_type):
                can_terminate = False
        out_t = payload["type"] if can_terminate else NeverType
        self._replace(_rebuild_ifelse(out_t, payload["loc_id"], ifs, arm.ir))
        return Expression(self._node, out_t)


def _rebuild_ifelse(t: EastType, loc_id: int, ifs: list, else_body: Any) -> Any:
    return EastVariant("IfElse", EastStruct({
        "type": t, "loc_id": loc_id, "ifs": list(ifs), "else_body": else_body,
    }))


class _StatementLoop:
    """A ``_LoopFrame`` twin for statement loops: a bare ``East.break_()``
    (the state-threading sugar's jump value) inside one resolves to this
    loop's label; it has no state to commit."""

    __slots__ = ("name", "commit")

    def __init__(self, name: str) -> None:
        self.name = name
        self.commit = _no_state


def _no_state(_value: Any) -> Any:
    raise ExpressionError(
        "a statement loop threads no state — spell the jump as "
        "b.break_(label) / b.continue_(label) with the label the body received"
    )


def _integer() -> EastType:
    from east.types.types import IntegerType

    return IntegerType


def _jump_statement(frame: _Frame, kind: str, label: Any, op: str) -> Any:
    from east.expression.expr import Expression

    if not isinstance(label, LoopLabel):
        raise ExpressionError(
            f"b.{op}() takes the label the loop body received (its last parameter), "
            f"got {type(label).__name__}"
        )
    build = ir_break if kind == "Break" else ir_continue
    node = build(NeverType, label.ir(), _loc_id())
    frame.statements.append(node)
    return Expression(node, NeverType)


def error(message: Any) -> Any:
    """Raise an East runtime error — a ``Never``-typed EXPRESSION (TS
    ``East.error``). Return it from a body, use it as an ``East.if_else``
    arm, or append it as a statement with ``b.error(...)``; a bare
    ``East.error(...)`` that reaches no body raises at build time rather
    than vanishing.

    Args:
        message: The error message — a String expression or python str.

    Returns:
        The Never-typed Error expression.
    """
    from east.expression.expr import Expression

    node = _error_node(message)
    _note_effect(node, "error")
    return Expression(node, NeverType)


class TryBuilder:
    """The ``b.try_`` chain: ``.catch(handler)`` and ``.finally_(body)``
    (TS ``$.try(...).catch(...).finally(...)``)."""

    __slots__ = ("_frame", "_node", "_message", "_stack", "_caught")

    def __init__(self, frame: _Frame, node: Any, message: Any, stack: Any) -> None:
        self._frame = frame
        self._node = node
        self._message = message
        self._stack = stack
        self._caught = False

    def _replace(self, **changes: Any) -> None:
        payload = self._node.value
        fields = {k: payload[k] for k in payload}
        fields.update(changes)
        new_node: Any = EastVariant("TryCatch", EastStruct(fields))
        stmts = self._frame.statements
        for i in range(len(stmts) - 1, -1, -1):
            if stmts[i] is self._node:
                stmts[i] = new_node
                break
        self._node = new_node

    def catch(self, handler: Any) -> TryBuilder:
        """Handle an error: ``handler(b, message, stack)`` (trailing
        parameters may be omitted) runs in its own frame."""
        from east.expression.expr import Expression

        _check_open(self._frame, "try_().catch")
        if self._caught:
            raise ExpressionError("Cannot call .catch() more than once on the same try block")
        self._caught = True
        args = (Expression(self._message, StringType),
                Expression(self._stack, self._stack.value["type"]))
        arm = _run_block(handler, args, return_type=self._frame.return_type, mode="null_block")
        payload = self._node.value
        both_never = _is_never(_node_type(payload["try_body"])) and _is_never(arm.east_type)
        self._replace(catch_body=arm.ir, type=NeverType if both_never else payload["type"])
        return self

    def finally_(self, body: Any) -> None:
        """Run ``body(b)`` whether or not an error occurred (effects only)."""
        _check_open(self._frame, "try_().finally_")
        arm = _run_block(body, (), return_type=self._frame.return_type, mode="null_block")
        self._replace(finally_body=arm.ir)


def block_expression(body: Any) -> Any:
    """A block as an EXPRESSION (TS ``East.block``): statements, then the
    value ``body`` returns. Reached as ``East.block(fn)``.

    Args:
        body: ``body(b)`` — run in its own frame with its own block; must
            return a value or diverge.

    Returns:
        The block's value (the last statement's type).
    """
    frame = _frames[-1] if _frames else None
    return _run_block(body, (), return_type=frame.return_type if frame else None,
                      mode="block_expr")
