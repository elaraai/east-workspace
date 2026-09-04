#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""IR → python codegen (#627).

``to_python_source(fn_or_ir, name="main")`` renders East IR — a built
``East.function`` artifact or a homoiconic IR value (from a ``.json`` /
``.beast2`` export of any runtime) — as an idiomatic python module that
rebuilds the SAME IR with the ``East.function`` statement surface: every
node kind has a spelling (``east.expression.statements``), every builtin
with a python spelling prints through ``east.codegen.spellings`` (operators
only where the #624 exactness table permits, named builtins elsewhere),
and the rest print through the raw ``East.builtin(...)`` form. The printer
is total (any well-formed IR prints or raises ``Unprintable`` naming the
node) and deterministic (the same IR always prints the same text).

The contract the conformance suite pins: ``build(print(IR)) ≡ IR`` under
``east-c ir normalize``.
"""

from east.codegen.printer import Unprintable, to_python_source
from east.codegen.providers import Providers, providers_for
from east.codegen.spellings import RAW_ONLY, SPELLINGS, Spelling, spelling_for
from east.codegen.types import type_source

__all__ = [
    "to_python_source",
    "Unprintable",
    "Providers",
    "providers_for",
    "type_source",
    "SPELLINGS",
    "Spelling",
    "spelling_for",
    "RAW_ONLY",
]
