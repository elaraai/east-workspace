#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``StructExpression`` — TS ``StructExpr`` (``libs/east/src/expr/struct.ts``)."""

from __future__ import annotations

from typing import Any

from east.expression.errors import ExpressionError, _trace_bail
from east.expression.expr.base import Expression
from east.expression.location import location_id as _loc_id
from east.ir.builders import ir_get_field

#: The public names on this class a struct FIELD may shadow.
_PUBLIC = frozenset({"field", "keys"})


class StructExpression(Expression):
    """A Struct-typed expression: its fields are attributes (``s.name``),
    items (``s["name"]``) or :meth:`field` calls, exactly as the TypeScript
    ``StructExpr`` defines one property per field. A field WINS over a
    same-named method, so ``sum``/``mean``/``keys`` are ordinary column
    names."""

    __slots__ = ()
    _kind = "Struct"

    def field(self, name: str) -> Expression:
        """Access a struct field (also available as attribute / item access)."""
        for f in self.east_type.value:
            if f["name"] == name:
                out_t = f["type"]
                return self._expr(ir_get_field(out_t, name, self.ir, _loc_id()), out_t)
        available = ", ".join(f["name"] for f in self.east_type.value)
        raise ExpressionError(f"struct has no field '{name}' (available: {available})")

    def keys(self) -> list[str]:
        """This struct's field names, so ``{**s, "i": s.i + 1}`` works.

        Python's dict unpacking asks a mapping for ``keys()`` and then indexes
        it, both of which a Struct-typed expression can answer. That makes the
        "change one field, keep the rest" spelling — the loop body's ``else``
        branch — the same on the traced and the eager paths.
        """
        return [f["name"] for f in self.east_type.value]

    def __getattribute__(self, name: str) -> Any:
        """A struct FIELD wins over a same-named method.

        Normal lookup finds the method first, so without this a field named
        ``keys`` or ``field`` would be unreachable as an attribute — and the
        failure opaque. The name-set test runs first and is a single
        frozenset hit, so the hot internal accesses (``self.ir``,
        ``self.east_type``) skip the type probe entirely.
        """
        if name in _PUBLIC:
            for f in object.__getattribute__(self, "east_type").value:
                if f["name"] == name:
                    return object.__getattribute__(self, "field")(name)
        return object.__getattribute__(self, name)

    def __getattr__(self, name: str) -> Any:
        if name.startswith("__") and name.endswith("__"):
            raise AttributeError(name)
        if name.startswith("_east"):
            # Internal capability probes (`getattr(x, "_east_c_paged", None)`
            # and friends) must see a missing attribute, not a trace error.
            raise AttributeError(name)
        return self.field(name)

    def __getitem__(self, name: Any) -> Expression:
        if not isinstance(name, str):
            raise _trace_bail(f"[{name!r}] indexing")
        return self.field(name)
