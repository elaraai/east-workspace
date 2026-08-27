#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Statement frames — python's twin of the TypeScript ``BlockBuilder`` (``$``).

A TypeScript body receives ``$`` and appends STATEMENTS to it: ``$.let``,
``$.assign``, ``$.if(...).elseIf(...).else(...)``, ``$.while``, ``$.for``,
``$.match``, ``$.try(...).catch(...).finally(...)``, ``$.return``,
``$.break`` / ``$.continue``, and ``$(expr)`` for an expression evaluated for
its effect. Python cannot hand a body a ``$`` without changing the arity of
every lambda, so the twin is AMBIENT: every ``East.function`` /
``East.asyncFunction`` body, every callback, and every branch or loop body
runs inside an open *frame*, and the statement constructors — ``East.let``,
``East.const``, ``East.assign``, ``East.if_``, ``East.while_``,
``East.for_``, ``East.match_``, ``East.try_``, ``East.return_``,
``East.break_`` / ``East.continue_``, ``East.do`` — append to the innermost
one. A body that never uses them is exactly the lambda body it always was.

Bodies are assembled by the SAME rules the TypeScript builder applies, so a
program spelled statement-for-statement in both languages builds identical
IR (the contract the IR→python printer and the conformance round-trip rely
on):

- the value a body returns is appended as its final statement unless it IS
  the last statement already (``return`` after ``East.do`` of the same
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
    "LoopLabel",
    "IfBuilder",
    "TryBuilder",
    "do",
    "const",
    "let_statement",
    "assign",
    "return_",
    "if_",
    "match_",
    "while_statement",
    "for_statement",
    "break_statement",
    "continue_statement",
    "error",
    "try_",
    "block_expression",
]


# ─── Frames ─────────────────────────────────────────────────────────────────


class _Frame:
    """One open statement block: the statements appended so far and the
    enclosing function's declared return type (what ``East.return_`` checks
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


def _current_frame(op: str) -> _Frame:
    if not _tracing() or not _frames:
        raise ExpressionError(
            f"East.{op}() is a statement — it belongs inside an East.function / "
            "East.asyncFunction body, a callback, or a branch/loop body"
        )
    return _frames[-1]


def _node_type(node: Any) -> EastType:
    return node.value["type"]


def _is_never(t: EastType) -> bool:
    return t.type == "Never"


def _check_reachable(frame: _Frame, op: str) -> None:
    """The TypeScript builder's "Unreachable statement detected"."""
    if frame.statements and _is_never(_node_type(frame.statements[-1])):
        raise ExpressionError(
            f"Unreachable statement detected: East.{op}() follows a statement that "
            "never completes (return_/break_/continue_/error)"
        )


def _null_value():
    return _literal(None, NullType)


def _arity(fn: Any) -> int | None:
    """Positional parameters ``fn`` declares; ``None`` for ``*args``."""
    try:
        params = inspect.signature(fn).parameters.values()
    except (TypeError, ValueError):
        return None
    n = 0
    for p in params:
        if p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD):
            n += 1
        elif p.kind is p.VAR_POSITIONAL:
            return None
    return n


def _call_trimmed(fn: Any, args: tuple) -> Any:
    """Call ``fn`` with as many of ``args`` as it declares (TypeScript passes
    every argument and JavaScript ignores the extras; python must not)."""
    n = _arity(fn)
    return fn(*args) if n is None else fn(*args[:n])


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
    """Run ``fn(*args)`` in a fresh frame; assemble later with :func:`_finish_run`."""
    frame = _open_frame(return_type)
    _push_effects()
    try:
        try:
            result = _call_trimmed(fn, args)
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
    """Run ``fn(*args)`` in a fresh frame and assemble the body per ``mode``;
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
    """The label a statement-form loop body receives — what ``East.break_``
    / ``East.continue_`` name to leave or continue it (TS ``Label``)."""

    __slots__ = ("name", "loc_id")

    def __init__(self, name: str, loc_id: int) -> None:
        self.name = name
        self.loc_id = loc_id

    def __repr__(self) -> str:
        return f"LoopLabel({self.name!r})"

    def ir(self) -> EastStruct:
        return ir_label(self.name, self.loc_id)


# ─── Statements ─────────────────────────────────────────────────────────────


def do(expr: Any) -> Any:
    """Append an expression as a statement, evaluated for its effect (TS
    ``$(expr)``): a platform call, a mutation, a call whose value is unused.

    Args:
        expr: The expression (or a liftable python value).

    Returns:
        The expression, typed as it was.
    """
    frame = _current_frame("do")
    _check_reachable(frame, "do")
    e = _lift(expr)
    frame.statements.append(e.ir)
    return e


def _bind(value: Any, typ: Any, mutable: bool, op: str) -> Any:
    from east.expression.expr import Expression

    frame = _current_frame(op)
    _check_reachable(frame, op)
    if typ is not None and not isinstance(typ, EastType):
        raise TypeError(f"East.{op}(value, type) takes an East type second, got {type(typ).__name__}")
    e = value if isinstance(value, Expression) else _lift(value, hint=typ)
    if typ is not None and not is_subtype(e.east_type, typ):
        raise ExpressionError(
            f"East.{op}() value has East type {e.east_type.type}, the declared "
            f"type is {typ.type}"
        )
    var_t = typ if typ is not None else e.east_type
    bound = _coerce(e, var_t)
    var = ir_variable(var_t, _fresh_name(), _loc_id(), mutable=mutable)
    frame.statements.append(ir_let(NullType, var, bound.ir, _loc_id()))
    return Expression(var, var_t)


def const(value: Any, typ: EastType | None = None) -> Any:
    """Bind a value to a new CONST variable (TS ``$.const``): the variable
    cannot be reassigned, though a mutable value it holds may be mutated.

    Args:
        value: The value — an expression or a liftable python value.
        typ: Optional declared East type; the value's type must be a
            subtype (a narrower struct/variant literal widens to it).

    Returns:
        The variable, as an expression of the declared (or the value's) type.
    """
    return _bind(value, typ, mutable=False, op="const")


def let_statement(value: Any, typ: EastType | None = None) -> Any:
    """Bind a value to a new MUTABLE variable (TS ``$.let``) — reassign it
    with ``East.assign``. Reached as ``East.let(value)`` / ``East.let(value,
    type)``; see ``east.expression.control.let`` for the dispatch."""
    return _bind(value, typ, mutable=True, op="let")


def assign(variable: Any, value: Any) -> Any:
    """Reassign a variable bound with ``East.let`` (TS ``$.assign``).

    Args:
        variable: The variable expression ``East.let`` returned.
        value: The new value — its type must be a subtype of the variable's.

    Returns:
        The Null-typed Assign statement.

    Raises:
        ExpressionError: If ``variable`` is not a variable, was bound with
            ``East.const``, or ``value`` has the wrong type.
    """
    from east.expression.expr import Expression

    frame = _current_frame("assign")
    _check_reachable(frame, "assign")
    if not isinstance(variable, Expression):
        raise ExpressionError("Can only assign to a variable")
    node = variable.ir
    if node.type == "UnwrapRecursive":
        node = node.value["value"]
    if node.type != "Variable":
        raise ExpressionError("Can only assign to a variable")
    if not node.value["mutable"]:
        raise ExpressionError(
            "Cannot assign to a variable defined as const — bind it with East.let "
            "to reassign it"
        )
    var_t = node.value["type"]
    e = value if isinstance(value, Expression) else _lift(value, hint=var_t)
    if not is_subtype(e.east_type, var_t):
        raise ExpressionError(
            f"East.assign() value has East type {e.east_type.type}, the variable "
            f"holds {var_t.type}"
        )
    stmt = ir_assign(NullType, node, _coerce(e, var_t).ir, _loc_id())
    frame.statements.append(stmt)
    return Expression(stmt, NullType)


def return_(value: Any = None) -> Any:
    """Return from the enclosing function now (TS ``$.return``).

    Args:
        value: The value to return — an expression or a liftable python
            value; omitted for a Null-typed function.

    Returns:
        The Never-typed Return statement.

    Raises:
        ExpressionError: If the value's type is not a subtype of the
            function's declared output.
    """
    from east.expression.expr import Expression

    frame = _current_frame("return_")
    _check_reachable(frame, "return_")
    e = (Expression(_null_value(), NullType) if value is None
         else _lift(value, hint=frame.return_type))
    if frame.return_type is not None and not is_subtype(e.east_type, frame.return_type):
        raise ExpressionError(
            f"East.return_() value has East type {e.east_type.type}, the function "
            f"returns {frame.return_type.type}"
        )
    # The value may already be the last statement (an `East.do(x)` followed
    # by `East.return_(x)`): the TypeScript builder pops it, so do we.
    if isinstance(value, Expression) and frame.statements and frame.statements[-1] is e.ir:
        frame.statements.pop()
    stmt = ir_return(NeverType, e.ir, _loc_id())
    frame.statements.append(stmt)
    return Expression(stmt, NeverType)


def _predicate(value: Any, op: str) -> Any:
    p = _lift(value, hint=BooleanType)
    if p.east_type.type != "Boolean":
        raise ExpressionError(f"{op} predicate expected to have type Boolean, got {p.east_type.type}")
    return p


class IfBuilder:
    """The ``East.if_`` chain: ``.else_if(pred, body)`` adds an arm,
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
        """Add an ``else if`` arm; ``body`` runs in its own frame."""
        p = _predicate(predicate, "elseIf")
        b = _run_block(body, (), return_type=self._frame.return_type, mode="null_block")
        payload = self._node.value
        self._replace(_rebuild_ifelse(
            payload["type"], payload["loc_id"],
            [*payload["ifs"], EastStruct({"predicate": p.ir, "body": b.ir})],
            payload["else_body"]))
        return self

    def else_(self, body: Any) -> Any:
        """Close the chain with the ``else`` arm. The statement becomes
        ``Never``-typed when every arm diverges."""
        from east.expression.expr import Expression

        b = _run_block(body, (), return_type=self._frame.return_type, mode="null_block")
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
            if _is_never(b.east_type):
                can_terminate = False
        out_t = payload["type"] if can_terminate else NeverType
        self._replace(_rebuild_ifelse(out_t, payload["loc_id"], ifs, b.ir))
        return Expression(self._node, out_t)


def _rebuild_ifelse(t: EastType, loc_id: int, ifs: list, else_body: Any) -> Any:
    return EastVariant("IfElse", EastStruct({
        "type": t, "loc_id": loc_id, "ifs": list(ifs), "else_body": else_body,
    }))


def if_(predicate: Any, body: Any) -> IfBuilder:
    """Run ``body`` when ``predicate`` holds (TS ``$.if``); chain
    ``.else_if(...)`` and ``.else_(...)`` on the result.

    Args:
        predicate: A Boolean expression (or python bool).
        body: ``body()`` — a callable run in its own statement frame; the
            value it returns (if any) is the arm's final statement.

    Returns:
        An :class:`IfBuilder` (the statement is already appended).
    """
    frame = _current_frame("if_")
    _check_reachable(frame, "if_")
    p = _predicate(predicate, "if")
    b = _run_block(body, (), return_type=frame.return_type, mode="null_block")
    node = _k_ifelse(NullType, [(p.ir, b.ir)], _null_value())
    frame.statements.append(node)
    return IfBuilder(frame, node)


def match_(variant: Any, cases: dict) -> Any:
    """Branch on a variant's case for effect (TS ``$.match``): each handler
    ``handler(data)`` runs in its own frame with the case's payload; a case
    without a handler does nothing.

    Args:
        variant: A Variant-typed expression.
        cases: ``{case_name: handler}`` — a handler takes the payload
            expression (or nothing).

    Returns:
        The Null-typed Match statement.
    """
    from east.expression.expr import Expression

    frame = _current_frame("match_")
    _check_reachable(frame, "match_")
    v = _lift(variant)
    if v.east_type.type != "Variant":
        raise ExpressionError(f"match not defined over {v.east_type.type}")
    names = [c["name"] for c in v.east_type.value]
    unknown = [k for k in cases if k not in names]
    if unknown:
        raise ExpressionError(f"East.match_() has no case {unknown[0]!r} (cases: {', '.join(names)})")
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


class _StatementLoop:
    """A ``_LoopFrame`` twin for statement-form loops: a bare ``East.break_()``
    (the state-threading sugar's jump value) inside one resolves to this
    loop's label; it has no state to commit."""

    __slots__ = ("name", "commit")

    def __init__(self, name: str) -> None:
        self.name = name
        self.commit = _no_state


def _no_state(_value: Any) -> Any:
    raise ExpressionError(
        "a statement-form loop threads no state — spell the jump as "
        "East.break_(label) / East.continue_(label) with the label the body received"
    )


def while_statement(predicate: Any, body: Any) -> Any:
    """Loop while ``predicate`` holds (TS ``$.while``).

    Args:
        predicate: A Boolean expression, re-evaluated before every iteration.
        body: ``body(label)`` (or ``body()``) — run in its own frame; the
            :class:`LoopLabel` names this loop for ``East.break_`` /
            ``East.continue_``.

    Returns:
        The Null-typed While statement.
    """
    from east.expression.expr import Expression

    frame = _current_frame("while_")
    _check_reachable(frame, "while_")
    p = _predicate(predicate, "while")
    lbl = LoopLabel(_fresh_name(), _loc_id())
    _push_loop_frame(_StatementLoop(lbl.name))
    try:
        b = _run_block(body, (lbl,), return_type=frame.return_type, mode="null_block")
    finally:
        _pop_loop_frame()
    node = ir_while(NullType, p.ir, lbl.ir(), b.ir, _loc_id())
    frame.statements.append(node)
    return Expression(node, NullType)


def for_statement(collection: Any, body: Any) -> Any:
    """Loop over a collection's elements (TS ``$.for``).

    Args:
        collection: An Array, Set or Dict expression.
        body: The step, run in its own frame per element — Array
            ``body(value, index, label)``, Set ``body(key, label)``, Dict
            ``body(value, key, label)``; trailing parameters may be omitted.

    Returns:
        The Null-typed ForArray / ForSet / ForDict statement.
    """
    from east.expression.expr import Expression

    frame = _current_frame("for_")
    _check_reachable(frame, "for_")
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
        b = _run_block(body, args, return_type=frame.return_type, mode="null_block")
    finally:
        _pop_loop_frame()
    loc = _loc_id()
    if tag == "Array":
        node = ir_for_array(NullType, src.ir, lbl.ir(), key_var, value_var, b.ir, loc)
    elif tag == "Set":
        node = ir_for_set(NullType, src.ir, lbl.ir(), key_var, b.ir, loc)
    else:
        node = ir_for_dict(NullType, src.ir, lbl.ir(), key_var, value_var, b.ir, loc)
    frame.statements.append(node)
    return Expression(node, NullType)


def _integer() -> EastType:
    from east.types.types import IntegerType

    return IntegerType


def _jump_statement(kind: str, label: LoopLabel, op: str) -> Any:
    from east.expression.expr import Expression

    frame = _current_frame(op)
    _check_reachable(frame, op)
    build = ir_break if kind == "Break" else ir_continue
    node = build(NeverType, label.ir(), _loc_id())
    frame.statements.append(node)
    return Expression(node, NeverType)


def break_statement(label: LoopLabel) -> Any:
    """Leave the loop ``label`` names now (TS ``$.break``)."""
    return _jump_statement("Break", label, "break_")


def continue_statement(label: LoopLabel) -> Any:
    """Start the next iteration of the loop ``label`` names (TS ``$.continue``)."""
    return _jump_statement("Continue", label, "continue_")


def error(message: Any) -> Any:
    """Raise an East runtime error — a ``Never``-typed expression (TS
    ``East.error``). Return it from a body or branch, or use it as an
    ``East.if_else`` arm; a bare ``East.error(...)`` statement that reaches
    no body raises at build time rather than vanishing.

    Args:
        message: The error message — a String expression or python str.

    Returns:
        The Never-typed Error expression.
    """
    from east.expression.expr import Expression

    m = _lift(message, hint=StringType)
    if m.east_type.type != "String":
        raise ExpressionError(f"Error message must be String type, got {m.east_type.type}")
    node = ir_error(NeverType, m.ir, _loc_id())
    _note_effect(node, "error")
    return Expression(node, NeverType)


class TryBuilder:
    """The ``East.try_`` chain: ``.catch(handler)`` and ``.finally_(body)``
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
        """Handle an error: ``handler(message, stack)`` (either or both may
        be omitted) runs in its own frame."""
        from east.expression.expr import Expression

        if self._caught:
            raise ExpressionError("Cannot call .catch() more than once on the same try block")
        self._caught = True
        args = (Expression(self._message, StringType),
                Expression(self._stack, self._stack.value["type"]))
        b = _run_block(handler, args, return_type=self._frame.return_type, mode="null_block")
        payload = self._node.value
        both_never = _is_never(_node_type(payload["try_body"])) and _is_never(b.east_type)
        self._replace(catch_body=b.ir, type=NeverType if both_never else payload["type"])
        return self

    def finally_(self, body: Any) -> None:
        """Run ``body`` whether or not an error occurred (effects only)."""
        b = _run_block(body, (), return_type=self._frame.return_type, mode="null_block")
        self._replace(finally_body=b.ir)


def try_(body: Any) -> TryBuilder:
    """Run ``body`` and catch any East runtime error it raises (TS
    ``$.try``); chain ``.catch(handler)`` and ``.finally_(body)``.

    Args:
        body: ``body()`` — run in its own frame.

    Returns:
        A :class:`TryBuilder` (the statement is already appended).
    """
    from east.types.type_of_type import LocationType

    frame = _current_frame("try_")
    _check_reachable(frame, "try_")
    tb = _run_block(body, (), return_type=frame.return_type, mode="null_block")
    message = _var(_fresh_name(), StringType)
    stack = _var(_fresh_name(), ArrayType(LocationType))
    node = ir_trycatch(NullType, tb.ir, _null_value(), message, stack,
                       finally_body=_null_value(), loc_id=_loc_id())
    frame.statements.append(node)
    return TryBuilder(frame, node, message, stack)


def block_expression(body: Any) -> Any:
    """A block as an EXPRESSION (TS ``East.block``): statements, then the
    value ``body`` returns. Reached as ``East.block(fn)``.

    Args:
        body: ``body()`` — run in its own frame; must return a value or
            diverge.

    Returns:
        The block's value (the last statement's type).
    """
    frame = _frames[-1] if _frames else None
    return _run_block(body, (), return_type=frame.return_type if frame else None,
                      mode="block_expr")
