#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""A query's rows narrowed to the fields its later steps read (#1141). The twin of ``narrow.ts``.

A stage that builds each row, ``map(. + {region: …})``, gives it every field
of the row it came from, and one that keeps each row, ``map(select(…))``, keeps
the dataset's row whole, though the steps after either may read two fields.
The translator runs the program :func:`narrow_rows` gives it: the checked
program, with each such row built of the fields read after it, checked again.

- An object a step builds, ``{a: f, b: g}`` or ``. + {c: h}``, keeps the
  fields the steps after it read. A field none reads is left out where making
  it can neither raise nor give other than one value, so no answer changes:
  ``{a: .x, b: (.y / .z)} | .a`` keeps ``b``, whose division may raise.
- A stage over a dataset's rows that passes them on, ``map(select(p))``, ends
  by building each row of the fields read after it: ``map(select(p) | {id,
  total})``. A row built of what it reads is what the paged loops of #1112
  decode a dataset's rows to.
- A value read whole — reaching the output, ``keys``, ``tojson``, ``length``
  of an object, ``==``, a variable bound to it, anything not understood here —
  is built whole, and so is every value in a ``try``'s body, where the checker
  lets a value of the wrong kind by, to raise; a program with a ``def`` is
  left as written.

The narrowed program is checked again over the program's text, each node at
the range of the text it came from, so a runtime error names the query as
written; where it does not check to the same output type, multiplicity and
reads, the program runs as written. The rewrite is TypeScript's, node for
node, so the two translations stay the same IR.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from east.query.jq.check import CheckJqResult, check_jq
from east.query.jq.parse import ParsedJq, node
from east.query.jq.shapes import TypeShape, fields_of, type_equal, unwrap
from east.query.jq.spans import (
    JqNode,
    JqPattern,
    JqRange,
    child_path,
    jq_children,
    jq_pattern_children,
)
from east.types.construct import none, some
from east.types.types import EastType
from east.types.values import EastStruct

# ─── What a step leaves unmade ─────────────────────────────────────────────

#: Builtins that raise for nothing the checker lets reach them, by name and arity: given arguments that never raise,
#: they never raise. The checker refuses a value of a kind a builtin cannot take, outside a lenient place, so what is
#: left to raise at run time is a value's own: a zero divisor, a string that is no number, a count below zero,
#: ``error``.
_NEVER_RAISE = frozenset({
    "select/1", "not/0", "length/0", "utf8bytelength/0", "type/0", "tostring/0", "tojson/0", "empty/0", "keys/0",
    "keys_unsorted/0", "has/1", "in/1", "contains/1", "inside/1", "startswith/1", "endswith/1", "ltrimstr/1",
    "rtrimstr/1", "ascii_downcase/0", "ascii_upcase/0", "floor/0", "ceil/0", "round/0", "fabs/0", "sqrt/0", "abs/0",
    "values/0", "nulls/0", "numbers/0", "strings/0", "booleans/0", "arrays/0", "objects/0", "iterables/0",
    "scalars/0", "map/1", "add/0", "any/0", "all/0", "min/0", "max/0",
})


def cannot_raise(n: JqNode, defs: Any, labels: frozenset[str] = frozenset()) -> bool:  # noqa: C901
    """Whether a filter never raises, whatever its input: what a step may leave unmade.

    A stage's rows past the ones a step needs (#1140), or a field no step
    reads (#1141), since a value that raises makes the whole query raise.
    Conservative: paths, literals, comparisons, ``and``, ``or``, ``+``, ``-``
    and ``*``, objects, arrays, strings, ``if``, ``//``, ``try``, a ``label``
    and a ``break`` to it, and the builtins in :data:`_NEVER_RAISE`, of parts
    that never raise. ``/`` and ``%`` (a zero divisor), a ``def`` or a call of
    one, a function value, any other builtin, and a ``break`` out of the
    filter, which leaves it as a raise does, may raise.

    Args:
        n: The filter.
        defs: The defs in scope, by ``name/arity``: a call of one may raise.
        labels: The labels the filter is inside, which a ``break`` may leave.

    Returns:
        Whether it never raises.
    """
    def every(nodes: list[JqNode]) -> bool:
        return all(cannot_raise(m, defs, labels) for m in nodes)
    kind = n.type
    v = n.value
    if kind in ("identity", "literal", "variable", "descend"):
        return True
    if kind == "break":
        return v in labels
    if kind == "field":
        return every([v["target"]])
    # An index or a bound jq may refuse for its value (`null`, a key of another kind) only when computed: a literal
    # never is.
    if kind == "index":
        return v["index"].type == "literal" and every([v["target"]])
    if kind == "slice":
        return ((v["from"].type == "none" or v["from"].value.type == "literal")
                and (v["to"].type == "none" or v["to"].value.type == "literal") and every([v["target"]]))
    if kind == "iterate":
        return every([v["target"]])
    if kind in ("pipe", "comma", "alternative"):
        return every([v["left"], v["right"]])
    if kind == "binary":
        return v["op"] not in ("/", "%") and every([v["left"], v["right"]])
    if kind == "negate":
        return every([v])
    if kind == "array":
        return v.type == "none" or every([v.value])
    # A computed key that is no string raises.
    if kind == "object":
        return all(entry["key"].type != "computed" and (entry["value"].type == "none" or every([entry["value"].value]))
                   for entry in v)
    if kind == "string":
        return all(part.type == "text" or every([part.value]) for part in v)
    if kind == "if":
        return (all(every([branch["condition"], branch["then"]]) for branch in v["branches"])
                and (v["otherwise"].type == "none" or every([v["otherwise"].value])))
    # What `try` runs raises into its handler, which may raise; a `break` leaves it.
    if kind == "try":
        return not _breaks_out(v["body"], labels) and (v["catch"].type == "none" or every([v["catch"].value]))
    if kind == "label":
        return cannot_raise(v["body"], defs, labels | {v["name"]})
    # A pattern that destructures may not match its value.
    if kind == "bind":
        return all(pattern.type == "variable" for pattern in v["patterns"]) and every([v["source"], v["body"]])
    if kind == "call":
        key = f"{v['name']}/{len(v['args'])}"
        return key in _NEVER_RAISE and key not in defs and every(list(v["args"]))
    return False


def _breaks_out(n: JqNode, labels: frozenset[str]) -> bool:
    """Whether a filter may ``break`` to a label it is not inside: leave itself, as a raise does."""
    if n.type == "break":
        return n.value not in labels
    inner = labels | {n.value["name"]} if n.type == "label" else labels
    return any(child.node is not None and _breaks_out(child.node, inner) for child in jq_children(n))


# ─── What later steps read ─────────────────────────────────────────────────

@dataclass(frozen=True)
class _Demand:
    """What the steps after a filter read of each of its outputs.

    All of it (``whole``), nothing (``none``), some fields of a struct, each
    whole (``fields``), or each element of an array, its length and order with
    them (``elements``).
    """

    kind: str
    fields: frozenset[str] = frozenset()
    element: _Demand | None = None


_WHOLE = _Demand("whole")
_NONE = _Demand("none")


def _fields_of(*names: str) -> _Demand:
    return _Demand("fields", frozenset(names))


def _elements_of(element: _Demand) -> _Demand:
    return _Demand("elements", element=element)


def _both(a: _Demand, b: _Demand) -> _Demand:
    """What two readers of one value read between them."""
    if a.kind == "none":
        return b
    if b.kind == "none":
        return a
    if a.kind == "fields" and b.kind == "fields":
        return _Demand("fields", a.fields | b.fields)
    if a.kind == "elements" and b.kind == "elements":
        assert a.element is not None and b.element is not None
        return _elements_of(_both(a.element, b.element))
    return _WHOLE


def _element_of(d: _Demand) -> _Demand:
    """What is read of each element of an array read as ``d`` reads it."""
    if d.kind == "elements":
        assert d.element is not None
        return d.element
    return _NONE if d.kind == "none" else _WHOLE


#: Builtins of no arguments that give their input or nothing: a type's ``select``.
_PASS_THROUGH = frozenset({"values", "nulls", "booleans", "numbers", "strings", "arrays", "objects", "iterables", "scalars"})


@dataclass(frozen=True)
class _Place:
    """Where a filter is: what its input is, and whether a value of the wrong kind may reach it."""

    #: In a ``try``'s body, where the checker lets a value of the wrong kind by, to raise (#1140): every value is made.
    lenient: bool
    #: The input is the root of a query checked as an e3 root.
    root: bool
    #: The input is a dataset's rows, read from the root: a stage that passes them on is narrowed.
    rows: bool


def _reads_root_field(n: JqNode) -> bool:
    """A filter's input as a step after the root reads it: a dataset's rows."""
    return n.type == "field" and n.value["target"].type == "identity" and not n.value["optional"]


def _passes_through(n: JqNode) -> bool:
    """Whether a filter's outputs are its input or none: ``select(p)``, ``.``, and pipes, commas and branches of them."""
    kind = n.type
    v = n.value
    if kind == "identity":
        return True
    if kind in ("pipe", "comma"):
        return _passes_through(v["left"]) and _passes_through(v["right"])
    if kind == "if":
        return (all(_passes_through(branch["then"]) for branch in v["branches"])
                and (v["otherwise"].type == "none" or _passes_through(v["otherwise"].value)))
    if kind == "call":
        name = v["name"]
        arity = len(v["args"])
        return (name == "select" and arity == 1) or (name == "empty" and arity == 0) or (arity == 0 and name in _PASS_THROUGH)
    return False


def _defines_any(n: JqNode) -> bool:
    """Whether a program defines a function anywhere: a call may then be of it, not of the builtin."""
    return n.type == "def" or any(child.node is not None and _defines_any(child.node) for child in jq_children(n))


def _shorthand(name: str) -> EastStruct:
    """A field ``{name}`` reads of its input, as an object's entry."""
    return EastStruct({"key": node("name", name), "value": none})


def _with(s: EastStruct, **changes: Any) -> EastStruct:
    """A struct payload with some fields replaced, in its order."""
    return EastStruct({k: changes.get(k, v) for k, v in s.items()})


@dataclass(frozen=True)
class _Narrowed:
    """A filter narrowed to what is read of its outputs, and what it reads of its input."""

    node: JqNode
    reads: _Demand


class _Narrower:
    """The demand analysis and the rewrite over one checked program."""

    def __init__(self, checked: CheckJqResult) -> None:
        self.checked = checked
        #: Each node the rewrite made, by identity, kept alive with the path of the node whose text it stands for.
        self.made_from: dict[int, tuple[Any, str]] = {}
        #: What the steps after each node read of its outputs, by its path.
        self.demands: dict[str, _Demand] = {}
        #: Whether any node was rewritten.
        self.changed = False

    def _type_of(self, path: str) -> EastType | None:
        """The type of a node's outputs, as the checker gave it."""
        checked = self.checked.type_at(path)
        return None if checked is None else checked.type

    def _array_input(self, path: str) -> bool:
        """Whether a node's input is an array."""
        shape = self.checked.input_at(path, "")
        return isinstance(shape, TypeShape) and unwrap(shape.type).type == "Array"

    def _droppable(self, value: JqNode | None, path: str, place: _Place) -> bool:
        """Whether an entry's value may be left out: making it never raises, and gives exactly one value."""
        if place.lenient:
            return False
        if value is None:
            return True
        checked = self.checked.type_at(path)
        return cannot_raise(value, frozenset()) and checked is not None and checked.multiplicity == "one"

    def _made(self, n: JqNode, path: str) -> JqNode:
        """A node made by the rewrite, standing for the node at ``path``."""
        self.made_from[id(n)] = (n, path)
        return n

    def _remade(self, n: JqNode, path: str, value: Any, changed: bool) -> JqNode:
        """``n`` with a new payload, where any of its children changed."""
        return self._made(node(n.type, value), path) if changed else n

    def narrow(self, n: JqNode, path: str, out: _Demand, place: _Place) -> _Narrowed:  # noqa: C901
        """Narrows a filter to what the steps after it read of its outputs.

        Args:
            n: The filter.
            path: Its path.
            out: What the steps after it read of each output.
            place: Where it is.

        Returns:
            The filter, rewritten where it builds fields none reads, and what
            it reads of its input.
        """
        self.demands[path] = out

        def at(step: str) -> str:
            return child_path(path, step)

        kind = n.type
        v = n.value
        # Where a filter's input is not the root, nor a dataset's rows.
        inner = _Place(place.lenient, False, False)
        if kind == "identity":
            return _Narrowed(n, out)
        if kind in ("literal", "variable", "break"):
            return _Narrowed(n, _NONE)
        if kind == "field":
            target = self.narrow(v["target"], at("field.target"), _fields_of(v["name"]), place)
            return _Narrowed(self._remade(n, path, _with(v, target=target.node), target.node is not v["target"]),
                             target.reads)
        if kind == "index":
            index = v["index"]
            if index.type == "literal" and index.value.type == "string":
                t = self.narrow(v["target"], at("index.target"), _fields_of(index.value.value), place)
                return _Narrowed(self._remade(n, path, _with(v, target=t.node), t.node is not v["target"]), t.reads)
            t = self.narrow(v["target"], at("index.target"), _elements_of(out), place)
            i = self.narrow(index, at("index.index"), _WHOLE, place)
            changed = t.node is not v["target"] or i.node is not index
            return _Narrowed(self._remade(n, path, _with(v, index=i.node, target=t.node), changed), _both(t.reads, i.reads))
        if kind == "slice":
            t = self.narrow(v["target"], at("slice.target"), out, place)
            f = self.narrow(v["from"].value, at("slice.from.some"), _WHOLE, place) if v["from"].type == "some" else None
            e = self.narrow(v["to"].value, at("slice.to.some"), _WHOLE, place) if v["to"].type == "some" else None
            changed = (t.node is not v["target"] or (f is not None and f.node is not v["from"].value)
                       or (e is not None and e.node is not v["to"].value))
            value = _with(v, target=t.node, **{"from": v["from"] if f is None else some(f.node),
                                                "to": v["to"] if e is None else some(e.node)})
            reads = _both(t.reads, _both(_NONE if f is None else f.reads, _NONE if e is None else e.reads))
            return _Narrowed(self._remade(n, path, value, changed), reads)
        if kind == "iterate":
            typ = self._type_of(at("iterate.target"))
            array = typ is not None and unwrap(typ).type == "Array"
            t = self.narrow(v["target"], at("iterate.target"), _elements_of(out) if array else _WHOLE, place)
            return _Narrowed(self._remade(n, path, _with(v, target=t.node), t.node is not v["target"]), t.reads)
        if kind == "pipe":
            left = v["left"]
            right = v["right"]
            r = self.narrow(right, at("pipe.right"), out, _Place(place.lenient, False, place.root and _reads_root_field(left)))
            lft = self.narrow(left, at("pipe.left"), r.reads, place)
            changed = lft.node is not left or r.node is not right
            return _Narrowed(self._remade(n, path, _with(v, left=lft.node, right=r.node), changed), lft.reads)
        if kind in ("comma", "alternative"):
            left = v["left"]
            right = v["right"]
            lft = self.narrow(left, at(f"{kind}.left"), out, place)
            r = self.narrow(right, at(f"{kind}.right"), out, place)
            changed = lft.node is not left or r.node is not right
            return _Narrowed(self._remade(n, path, _with(v, left=lft.node, right=r.node), changed), _both(lft.reads, r.reads))
        if kind == "binary":
            left = v["left"]
            right = v["right"]
            if (v["op"] == "+" and left.type == "identity" and right.type == "object" and out.kind in ("fields", "none")
                    and not place.lenient):
                merged = self._merged(right, path, out, place)
                if merged is not None:
                    return merged
            lft = self.narrow(left, at("binary.left"), _WHOLE, place)
            r = self.narrow(right, at("binary.right"), _WHOLE, place)
            changed = lft.node is not left or r.node is not right
            return _Narrowed(self._remade(n, path, _with(v, left=lft.node, right=r.node), changed), _both(lft.reads, r.reads))
        if kind == "negate":
            operand = self.narrow(v, at("negate"), _WHOLE, place)
            return _Narrowed(self._remade(n, path, operand.node, operand.node is not v), operand.reads)
        if kind == "array":
            if v.type == "none":
                return _Narrowed(n, _NONE)
            body = v.value
            element = _element_of(out)
            b = self.narrow(body, at("array.some"), element, _Place(place.lenient, place.root, False))
            # `[.[] | f]` over a dataset's rows, as `map(f)` is.
            made = b.node
            if (place.rows and made.type == "pipe" and made.value["left"].type == "iterate"
                    and made.value["left"].value["target"].type == "identity"):
                f = self._project(made.value["right"], at("array.some.pipe.right"), element, place)
                if f is not None:
                    made = self._made(node("pipe", EastStruct({"left": made.value["left"], "right": f})), at("array.some"))
            return _Narrowed(self._remade(n, path, some(made), made is not body), b.reads)
        if kind == "object":
            return self._object(n, path, out, place)
        if kind == "string":
            reads = _NONE
            changed = False
            parts = []
            for i, part in enumerate(v):
                if part.type != "interpolate":
                    parts.append(part)
                    continue
                p = self.narrow(part.value, at(f"string[{i}].interpolate"), _WHOLE, place)
                reads = _both(reads, p.reads)
                if p.node is part.value:
                    parts.append(part)
                else:
                    changed = True
                    parts.append(node("interpolate", p.node))
            return _Narrowed(self._remade(n, path, parts, changed), reads)
        if kind == "format":
            # `@csv` formats its input; `@csv "\(f)"` each value it interpolates.
            if v["string"].type == "none":
                return _Narrowed(n, _WHOLE)
            s = self.narrow(v["string"].value, at("format.string.some"), _WHOLE, place)
            return _Narrowed(self._remade(n, path, _with(v, string=some(s.node)), s.node is not v["string"].value), s.reads)
        if kind == "if":
            reads = _NONE
            changed = False
            branches = []
            for i, branch in enumerate(v["branches"]):
                c = self.narrow(branch["condition"], at(f"if.branches[{i}].condition"), _WHOLE, place)
                t = self.narrow(branch["then"], at(f"if.branches[{i}].then"), out, place)
                reads = _both(reads, _both(c.reads, t.reads))
                if c.node is branch["condition"] and t.node is branch["then"]:
                    branches.append(branch)
                else:
                    changed = True
                    branches.append(EastStruct({"condition": c.node, "then": t.node}))
            otherwise = v["otherwise"]
            if otherwise.type == "some":
                o = self.narrow(otherwise.value, at("if.otherwise.some"), out, place)
                reads = _both(reads, o.reads)
                if o.node is not otherwise.value:
                    changed = True
                    otherwise = some(o.node)
            else:
                # No `else` gives the input.
                reads = _both(reads, out)
            return _Narrowed(self._remade(n, path, EastStruct({"branches": branches, "otherwise": otherwise}), changed), reads)
        if kind == "try":
            # The handler's input is the error, not the filter's.
            b = self.narrow(v["body"], at("try.body"), out, _Place(True, place.root, place.rows))
            return _Narrowed(self._remade(n, path, _with(v, body=b.node), b.node is not v["body"]), b.reads)
        if kind == "label":
            b = self.narrow(v["body"], at("label.body"), out, place)
            return _Narrowed(self._remade(n, path, _with(v, body=b.node), b.node is not v["body"]), b.reads)
        if kind == "bind":
            # What the source gives is bound, and read as the body reads its variables: whole.
            s = self.narrow(v["source"], at("bind.source"), _WHOLE, _Place(place.lenient, place.root, False))
            b = self.narrow(v["body"], at("bind.body"), out, place)
            changed = s.node is not v["source"] or b.node is not v["body"]
            return _Narrowed(self._remade(n, path, _with(v, body=b.node, source=s.node), changed), _both(s.reads, b.reads))
        if kind in ("reduce", "foreach"):
            # The update's input is the state; the source's outputs are bound, and read whole.
            where = _Place(place.lenient, place.root, False)
            s = self.narrow(v["source"], at(f"{kind}.source"), _WHOLE, where)
            i = self.narrow(v["init"], at(f"{kind}.init"), _WHOLE, where)
            changed = s.node is not v["source"] or i.node is not v["init"]
            return _Narrowed(self._remade(n, path, _with(v, init=i.node, source=s.node), changed), _both(s.reads, i.reads))
        if kind == "call":
            return self._call(n, path, out, place, inner)
        # `..`, an update, a `def`: the input whole, and nothing rewritten.
        return _Narrowed(n, _WHOLE)

    def _call(self, n: JqNode, path: str, out: _Demand, place: _Place, inner: _Place) -> _Narrowed:  # noqa: C901
        """A builtin's call: those that read their input's fields or elements apart, and any other, which reads it whole."""
        v = n.value
        args = list(v["args"])
        name = v["name"]

        def arg(i: int, demand: _Demand, where: _Place) -> _Narrowed:
            return self.narrow(args[i], child_path(path, f"call.args[{i}]"), demand, where)

        def call(made: list[_Narrowed], reads: _Demand) -> _Narrowed:
            changed = any(m.node is not args[i] for i, m in enumerate(made))
            return _Narrowed(self._remade(n, path, _with(v, args=[m.node for m in made]), changed), reads)

        # The same input as the call's, which is no dataset's rows.
        same = _Place(place.lenient, place.root, False)
        key = f"{name}/{len(args)}"
        if not args and name in _PASS_THROUGH:
            return _Narrowed(n, out)
        if key == "empty/0":
            return _Narrowed(n, _NONE)
        if key == "select/1":
            p = arg(0, _WHOLE, same)
            return call([p], _both(out, p.reads))
        if key in ("first/1", "last/1"):
            f = arg(0, out, same)
            return call([f], f.reads)
        if key == "limit/2":
            count = arg(0, _WHOLE, same)
            f = arg(1, out, same)
            return call([count, f], _both(count.reads, f.reads))
        if key in ("any/2", "all/2"):
            # The condition's input is each output of the generator.
            c = arg(1, _WHOLE, inner)
            g = arg(0, c.reads, same)
            return call([g, c], g.reads)
        if not self._array_input(path):
            return _Narrowed(n, _WHOLE)
        if key == "length/0":
            return _Narrowed(n, _elements_of(_NONE))
        if key in ("first/0", "last/0"):
            return _Narrowed(n, _elements_of(out))
        if key == "reverse/0":
            return _Narrowed(n, _elements_of(_element_of(out)))
        if key == "map/1":
            element = _element_of(out)
            f = arg(0, element, inner)
            projected = self._project(f.node, child_path(path, "call.args[0]"), element, place) if place.rows else None
            return call([f if projected is None else _Narrowed(projected, f.reads)], _elements_of(f.reads))
        if key in ("any/1", "all/1"):
            f = arg(0, _WHOLE, inner)
            return call([f], _elements_of(f.reads))
        if key == "group_by/1":
            f = arg(0, _WHOLE, inner)
            return call([f], _elements_of(_both(_element_of(_element_of(out)), f.reads)))
        if key in ("sort_by/1", "unique_by/1"):
            f = arg(0, _WHOLE, inner)
            return call([f], _elements_of(_both(_element_of(out), f.reads)))
        if key in ("min_by/1", "max_by/1"):
            f = arg(0, _WHOLE, inner)
            return call([f], _elements_of(_both(out, f.reads)))
        return _Narrowed(n, _WHOLE)

    def _entry(self, entry: EastStruct, path: str, demand: _Demand, place: _Place) -> tuple[EastStruct, _Demand]:
        """An object's entry kept, its value narrowed to what is read of it."""
        if entry["value"].type == "none":
            # `{a}` reads `.a`; `{$x}` reads `$x`.
            return entry, (_fields_of(entry["key"].value) if entry["key"].type == "name" else _NONE)
        value = entry["value"].value
        narrowed = self.narrow(value, path, demand, place)
        if narrowed.node is value:
            return entry, narrowed.reads
        return EastStruct({"key": entry["key"], "value": some(narrowed.node)}), narrowed.reads

    def _object(self, n: JqNode, path: str, out: _Demand, place: _Place) -> _Narrowed:
        """``{…}``: the fields the steps after it read, and those it cannot leave unmade."""
        entries_in = list(n.value)
        # A computed key builds a dict, read by its keys.
        if any(entry["key"].type == "computed" for entry in entries_in):
            return _Narrowed(n, _WHOLE)
        wanted = out.fields if out.kind == "fields" else frozenset() if out.kind == "none" else None
        reads = _NONE
        changed = False
        entries = []
        for i, entry in enumerate(entries_in):
            name = entry["key"].value
            value_path = child_path(path, f"object[{i}].value.some")
            value = entry["value"].value if entry["value"].type == "some" else None
            if wanted is not None and name not in wanted and self._droppable(value, value_path, place):
                changed = True
                self.changed = True
                continue
            kept, entry_reads = self._entry(entry, value_path, _WHOLE if wanted is None or name in wanted else _NONE, place)
            if kept is not entry:
                changed = True
            entries.append(kept)
            reads = _both(reads, entry_reads)
        return _Narrowed(self._remade(n, path, entries, changed), reads)

    def _merged(self, right: JqNode, path: str, out: _Demand, place: _Place) -> _Narrowed | None:
        """``. + {…}`` on a struct, as the object of the fields read after it.

        The input's that ``{…}`` does not set, then ``{…}``'s, in its order.
        """
        typ = self._type_of(child_path(path, "binary.left"))
        struct = None if typ is None else unwrap(typ)
        entries_in = list(right.value)
        if struct is None or struct.type != "Struct" or any(entry["key"].type == "computed" for entry in entries_in):
            return None
        wanted = out.fields if out.kind == "fields" else frozenset()
        given = {entry["key"].value for entry in entries_in}
        names = list(fields_of(struct))
        dropped = any(name not in wanted and name not in given for name in names)
        entries = []
        reads = _NONE
        for name in names:
            if name not in wanted or name in given:
                continue
            entries.append(_shorthand(name))
            reads = _both(reads, _fields_of(name))
        for i, entry in enumerate(entries_in):
            name = entry["key"].value
            value_path = child_path(path, f"binary.right.object[{i}].value.some")
            value = entry["value"].value if entry["value"].type == "some" else None
            if name not in wanted and self._droppable(value, value_path, place):
                dropped = True
                continue
            kept, entry_reads = self._entry(entry, value_path, _WHOLE if name in wanted else _NONE, place)
            entries.append(kept)
            reads = _both(reads, entry_reads)
        if not dropped:
            return None
        self.changed = True
        return _Narrowed(self._made(node("object", entries), path), reads)

    def _project(self, f: JqNode, path: str, element: _Demand, place: _Place) -> JqNode | None:
        """A stage's row work over a dataset's rows that passes them on, ending with each row built of the fields read.

        ``None`` when it does not pass them on, or the steps after it read
        every field, or none (``length``), and so keep no row.
        """
        if place.lenient or element.kind != "fields" or not _passes_through(f):
            return None
        typ = self._type_of(path)
        struct = None if typ is None else unwrap(typ)
        if struct is None or struct.type != "Struct":
            return None
        names = list(fields_of(struct))
        kept = [name for name in names if name in element.fields]
        if len(kept) == len(names):
            return None
        self.changed = True
        obj = self._made(node("object", [_shorthand(name) for name in kept]), path)
        return self._made(node("pipe", EastStruct({"left": f, "right": obj})), path)

    def spans_of(self, program: JqNode, original: JqNode) -> dict[str, JqRange] | None:
        """The spans of a rewritten program: each node at the range of the node it came from, or stands for.

        ``None`` when a node has no range.
        """
        spans = self.checked.source.spans
        origin: dict[int, str] = {}

        def index_pattern(pattern: JqPattern, path: str) -> None:
            origin[id(pattern)] = path
            for step, child in jq_pattern_children(pattern):
                index_pattern(child, child_path(path, step))

        def index(n: JqNode, path: str) -> None:
            origin[id(n)] = path
            for child in jq_children(n):
                if child.node is not None:
                    index(child.node, child_path(path, child.step))
                elif child.pattern is not None:
                    index_pattern(child.pattern, child_path(path, child.step))

        index(original, "")
        for key, (_n, path) in self.made_from.items():
            origin[key] = path
        out: dict[str, JqRange] = {}
        complete = True

        def put(obj: Any, path: str) -> None:
            nonlocal complete
            if path == "":
                out[path] = JqRange(0, len(self.checked.source.units))
                return
            source = origin.get(id(obj))
            r = None if source is None else spans.get(source)
            if r is None:
                complete = False
            else:
                out[path] = r

        def visit_pattern(pattern: JqPattern, path: str) -> None:
            put(pattern, path)
            for step, child in jq_pattern_children(pattern):
                visit_pattern(child, child_path(path, step))

        def visit(n: JqNode, path: str) -> None:
            put(n, path)
            for child in jq_children(n):
                if child.node is not None:
                    visit(child.node, child_path(path, child.step))
                elif child.pattern is not None:
                    visit_pattern(child.pattern, child_path(path, child.step))

        visit(program, "")
        return out if complete else None


def check_again(checked: CheckJqResult, program: JqNode, spans: dict[str, JqRange], input_type: EastType) -> CheckJqResult | None:
    """Checks a program again: the same program, over the same text, against the same input or another.

    Args:
        checked: The program, checked.
        program: The program to check: ``checked``'s, or one rewritten from it.
        spans: Each node's range in ``checked``'s text.
        input_type: The input's type.

    Returns:
        The check, or ``None`` when it does not check to ``checked``'s output
        type, multiplicity and reads.
    """
    if checked.element_type is None or checked.multiplicity is None:
        return None
    source = checked.source
    parsed = ParsedJq(source.text, some(program), spans, [], source.units)
    again = check_jq(parsed, input_type, root=source.root)
    if again.program is None or again.element_type is None:
        return None
    if any(d["severity"].type == "error" for d in again.diagnostics):
        return None
    if not type_equal(again.element_type, checked.element_type) or again.multiplicity != checked.multiplicity:
        return None
    if again.reads != checked.reads:
        return None
    return again


def narrow_rows(checked: CheckJqResult) -> CheckJqResult:
    """The program a checked query runs: its rows narrowed to the fields its later steps read (#1141), checked again.

    Args:
        checked: The program as written, checked.

    Returns:
        The narrowed program, checked; or ``checked`` itself, where nothing
        narrows or the narrowed program does not check to ``checked``'s
        output type, multiplicity and reads.
    """
    program = checked.program
    if program is None or _defines_any(program):
        return checked
    n = _Narrower(checked)
    result = n.narrow(program, "", _WHOLE, _Place(False, checked.source.root, False))
    spans = n.spans_of(result.node, program) if n.changed else None
    if spans is None:
        return checked
    return check_again(checked, result.node, spans, checked.input_type) or checked


__all__ = ["cannot_raise", "check_again", "narrow_rows"]
