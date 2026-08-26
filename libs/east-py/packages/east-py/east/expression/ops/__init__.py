#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The ``Expression`` method surface, one module per domain.

Each module defines a mixin that ``east.expression.expr`` folds into the concrete
class. A mixin never NAMES ``Expression``: ``expr.py`` imports these modules in
order to build that class, so the name is unbound while they load. They build
their results through :meth:`_ExprBase._expr` instead.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from east.types.types import EastType

if TYPE_CHECKING:
    from east.expression.expr import Expression


class _ExprBase:
    """The state and the constructor every op mixin may assume."""

    __slots__ = ()

    ir: Any
    east_type: EastType

    def _expr(self, ir: Any, east_type: EastType) -> Expression:
        """A sibling expression — same concrete proxy class, new node/type."""
        return type(self)(ir, east_type)  # type: ignore[call-arg,return-value]
