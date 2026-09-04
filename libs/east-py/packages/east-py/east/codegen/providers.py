#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""What a printed module may import instead of restating (#667).

A ``Platform`` node carries a name and a signature, so a printer alone can
only spell it as a hoisted declaration, ``gzip_compress =
East.asyncPlatform('gzip_compress', […], BlobType)``. A package that
implements the function exports the dual-mode object itself
(``@East.platform_function`` — callable in a body), and often the East type
its options are, under a name: ``from east_py_io import GzipOptionsType,
gzip_compress``. :func:`providers_for` collects both from the packages named,
by importing them — the python twin of the TypeScript printer's
``libraries``, which prints ``Compression.Gzip.compress`` from a library
module's declaration handles.

A package with no python implementation to export — the function is
implemented in C, or on another runtime — exports the declaration handle
itself (``East.genericPlatform(...)``, which a body calls the same way);
that is collected too.

A provider is used only where its declared signature IS the node's (the
node's argument and output types, asyncness and type arguments), so the
printed module rebuilds the same IR; any other node keeps the hoisted
declaration.
"""

from __future__ import annotations

import importlib
from collections.abc import Iterable
from typing import Any

from east.codegen.types import type_key
from east.expression.platform import PlatformDeclaration
from east.types.types import EastType

__all__ = ["Providers", "providers_for"]

#: The type kinds a package names for its callers — the shapes a body spells
#: by name. A primitive or a collection of one (``GzipLevelType =
#: IntegerType``) is not substituted: every Integer would print as it.
_NAMED_KINDS = frozenset({"Struct", "Variant", "Recursive"})


class Providers:
    """The implementations and named types the printer may import.

    ``functions`` maps a platform function's name to ``(module, attribute,
    record)`` — the module to import from, the name it exports, and the
    ``PlatformFunction`` / ``GenericPlatformFunction`` record the decorator
    attached; ``types`` maps a type's structural key to ``(module,
    attribute)``.
    """

    __slots__ = ("functions", "types")

    def __init__(self) -> None:
        self.functions: dict[str, tuple[str, str, Any]] = {}
        self.types: dict[str, tuple[str, str]] = {}

    def add_module(self, module_name: str) -> None:
        """Collect the platform implementations and named types ``module``
        exports (its ``__all__``, else its public attributes), then the
        implementations its ``platform`` list registers that the root does
        not export by name — those import from their defining module."""
        module = importlib.import_module(module_name)
        names = getattr(module, "__all__", None)
        if names is None:
            names = [n for n in dir(module) if not n.startswith("_")]
        seen: set[int] = set()
        for attr in names:
            value = getattr(module, attr, None)
            record = getattr(value, "east_platform_function", None)
            if isinstance(record, dict) and "name" in record:
                # one object under several names: the first export wins, so a
                # package lists its canonical spelling first
                if id(value) in seen:
                    continue
                seen.add(id(value))
                self.functions.setdefault(record["name"], (module_name, attr, record))
            elif isinstance(value, PlatformDeclaration):
                self.functions.setdefault(value.name, (module_name, attr, _declared(value)))
            elif isinstance(value, EastType) and value.type in _NAMED_KINDS:
                self.types.setdefault(type_key(value), (module_name, attr))
        for record in getattr(module, "platform", None) or []:
            fn = record.get("fn") if isinstance(record, dict) else None
            if fn is None or id(fn) in seen or getattr(fn, "east_platform_function", None) is not record:
                continue
            defining = getattr(fn, "__module__", None)
            if not defining:
                continue
            try:
                attr = _public_name_of(importlib.import_module(defining), fn)
            except ImportError:
                continue
            if attr is None:
                continue  # a private or nested factory has no name to import
            seen.add(id(fn))
            self.functions.setdefault(record["name"], (defining, attr, record))


def _declared(declaration: PlatformDeclaration) -> dict:
    """The record shape the printer matches, read off a declaration handle."""
    record: dict[str, Any] = {
        "name": declaration.name,
        "type": "async" if declaration.is_async else "sync",
        "inputs": list(declaration.inputs),
        "output": declaration.output,
    }
    if declaration.type_params is not None:
        record["type_parameters"] = list(declaration.type_params)
    return record


def _public_name_of(module: Any, fn: Any) -> str | None:
    """The public name ``module`` binds ``fn`` to — its ``__name__`` when that
    is the binding, else the first public attribute holding it (a factory
    built by a helper keeps the helper's inner name) — or ``None``."""
    name = getattr(fn, "__name__", None)
    if name and not name.startswith("_") and getattr(module, name, None) is fn:
        return name
    for attr in sorted(vars(module)):
        if not attr.startswith("_") and getattr(module, attr, None) is fn:
            return attr
    return None


def providers_for(packages: Iterable[str]) -> Providers:
    """The providers the given packages export.

    Args:
        packages: Module names to import (``east_py_std``; the distribution
            spelling ``east-py-std`` is accepted).

    Returns:
        The collected :class:`Providers`.

    Raises:
        ImportError: If a package cannot be imported.
    """
    providers = Providers()
    for package in packages:
        providers.add_module(package.replace("-", "_"))
    return providers
