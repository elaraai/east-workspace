#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The East standard library — ``libs/east/src/expr/libs/*.ts`` ported one
file per type: ``East.Integer.*``, ``East.Float.*``, ``East.DateTime.*``,
``East.String.*`` and ``East.Blob.*`` (the container namespaces carry their
constructors in ``east.namespace``).

Every stdlib function here is an ``East.function`` artifact with the
TypeScript body, built on FIRST USE (the trace + compile is paid once, when
the function is first called or referenced — never at import). An artifact
is dual-mode: called on plain values it runs natively; referenced inside a
body it splices its expression into that build, exactly like TypeScript's
``East.Integer.printCompact(x)`` inside an ``East.function``.
"""

from __future__ import annotations

from typing import Any


class LazyFunction:
    """A stdlib ``East.function``, built on first use."""

    def __init__(self, name: str, build: Any, doc: str | None = None) -> None:
        self._build = build
        self._fn: Any = None
        self.__name__ = name
        self.__doc__ = doc

    def resolve(self) -> Any:
        """The built artifact (built now if this is the first use).

        The build is DETACHED from any body that happens to be open: inside
        one, ``East.function`` returns an inline Function expression rather
        than an artifact, and memoising that would leave every later eager
        call returning an expression too (#674). A stdlib body closes over
        nothing, so it belongs to no enclosing build.
        """
        if self._fn is None:
            from east.expression.function import detached_build

            with detached_build():
                self._fn = self._build()
        return self._fn

    def __call__(self, *args: Any, **kwargs: Any) -> Any:
        return self.resolve()(*args, **kwargs)

    def __getattr__(self, name: str) -> Any:
        # `_east_ir`, `bind`, `_eastc_handle`, … — the artifact's own surface.
        if name.startswith("__"):
            raise AttributeError(name)
        return getattr(self.resolve(), name)

    def __repr__(self) -> str:
        return f"<East stdlib function {self.__name__}>"


def lib_function(param_types: list, out: Any) -> Any:
    """Declare a stdlib function: the decorated body (the block first, like
    every body) becomes a lazily built ``East.function(param_types, out, body)``."""

    def decorate(body: Any) -> LazyFunction:
        def build() -> Any:
            from east.expression import _lift, _tracing
            from east.expression.expr import Expression
            from east.namespace import East

            def traced(b: Any, *args: Any) -> Any:
                # Spliced into another body with plain python arguments
                # (`round_down_hour(d, 1)`), the scalars lift first so the
                # TypeScript body sees expressions throughout.
                if _tracing():
                    args = tuple(a if isinstance(a, Expression) else _lift(a) for a in args)
                return body(b, *args)

            traced.__name__ = body.__name__
            traced.__doc__ = body.__doc__
            return East.function(list(param_types), out, traced)

        return LazyFunction(body.__name__.lstrip("_"), build, body.__doc__)

    return decorate


__all__ = ["LazyFunction", "lib_function"]
