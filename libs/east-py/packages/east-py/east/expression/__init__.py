#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The East expression builders — python's twin of the TypeScript DSL.

``East.function(param_types, out, body)`` runs ``body`` ONCE over typed
``Expression`` proxies, records East IR, and compiles it natively — the same
capture the TS builder performs, name-for-name (#623/#625). The declared
``out`` is required and enforced. Anything East cannot express raises an
``ExpressionError`` at build time; there is exactly one execution semantics.

The authoring trio:

- ``East.function(param_types, out, body)`` / ``East.asyncFunction(...)`` —
  build a function. A pure body compiles immediately into a dual-mode
  callable: native on plain values, splicing its expression into any
  enclosing build when referenced from another body (#470/#561), with
  ``.bind(*values)`` for by-reference partial application (#399).
- ``East.platform(name, inputs, output)`` / ``East.asyncPlatform(...)`` —
  declare a platform call; the handle emits the ``Platform`` IR node inside
  builder bodies. ``@platform_function`` remains the implementation side.
- ``East.compile(fn, platform=[])`` / ``East.compileAsync(...)`` — pair a
  platform-declaring function with its implementations and compile it. A
  platform-declaring function called UNCOMPILED raises
  ``Platform function '<name>' is not available`` with the compile fix-it.

The body language is the whole existing expression algebra: the operator
and method surface on ``Expression`` (operators overload only where python
and East semantics coincide — ``//``, ``%``, integer ``**`` and negative
indexing raise with named-builtin fix-its, #624), ``East.if_else`` /
``greatest`` / ``least``, every ``East.<Type>.*`` namespace builtin, captured
East constants (build-once hoisted snapshots), ``some``/``none``/``variant``
with declared-type context (#541), struct literals as dicts, and the
block-level control constructs (#578): ``East.while_`` / ``East.for_`` /
``block`` / ``let`` / ``ref`` / ``label`` / ``break_`` / ``continue_`` /
``try_catch`` / ``new_array`` / ``new_set`` / ``new_dict``.

The expression surface is one class per East type kind
(``east.expression.expr``, mirroring ``libs/east/src/expr/*.ts``): an
``ArrayExpression`` carries the Array methods, a ``DictExpression`` the
Dict ones, and a method that does not exist on the receiver's kind is a
build-time error naming the receiver's surface (#452). Eager collection
methods capture a plain callback through the same machinery
(``capture.capture_callback``), with the builtin's declared signature: one
capture, one execution semantics, and a callback that does python work
raises instead of running per element.

Every build records an authoring-frame source map (``location.py``, #626):
a runtime error inside a python-built function names the python
``file:line:column`` of the expression that raised it, on every runner the
function is exported to. ``set_location_base_path`` fixes the directory the
recorded paths are relativized against (the working directory by default).
"""

from east.expression.capture import _eligible, _trace_out_type, capture_callback
from east.expression.control import (
    Label,
    block,
    break_,
    continue_,
    for_,
    label,
    let,
    new_array,
    new_dict,
    new_matrix,
    new_set,
    new_vector,
    ref,
    try_catch,
    while_,
)
from east.expression.errors import ExpressionError, _trace_bail
from east.expression.expr import (
    ArrayExpression,
    AsyncFunctionExpression,
    BlobExpression,
    BooleanExpression,
    DateTimeExpression,
    DictExpression,
    Expression,
    FloatExpression,
    FunctionExpression,
    IntegerExpression,
    MatrixExpression,
    NeverExpression,
    NullExpression,
    RecursiveExpression,
    RefExpression,
    SetExpression,
    StringExpression,
    StructExpression,
    VariantExpression,
    VectorExpression,
)
from east.expression.finalize import _capturing_fn, _finalize_ir, _free_vars, _function_ir
from east.expression.function import (
    async_function,
    compile_,
    compile_async,
    function,
    trace,
    trace_builtin_call,
)
from east.expression.helpers import (
    _append_field_kernel,
    _append_kernel,
    _array_get_kernel,
    _dict_insert_fields_kernel,
    _empty_array_kernel,
    _empty_dict_kernel,
    _empty_set_kernel,
    _error_combine_kernel,
    _error_init_kernel,
    _identity_kernel,
    _none_init_kernel,
    _second_kernel,
    _set_insert_field_kernel,
)
from east.expression.lift import (
    _coerce,
    _lift,
    _lower_compiled_call,
    _sequence_effect,
    _trace_inner_fn,
    _tracing,
    as_,
    builtin,
    greatest,
    if_else,
    least,
    value,
    wrap_recursive,
)
from east.expression.location import (
    SourceMap,
    capture_frames,
    current_source_map,
    location_id,
    set_location_base_path,
    source_map_scope,
)
from east.expression.nodes import (
    _builtin,
    _fresh_name,
    _k_block,
    _k_new_array,
    _k_new_dict,
    _k_new_set,
    _k_struct,
    _literal,
    _var,
)
from east.expression.platform import (
    PlatformDeclaration,
    async_generic_platform,
    async_platform,
    generic_platform,
    platform,
)
from east.expression.statements import (
    Block,
    IfBuilder,
    LoopLabel,
    TryBuilder,
    error,
)

__all__ = [
    # the strict builder trio (reached as East.function / East.platform / …)
    "function",
    "async_function",
    "platform",
    "async_platform",
    "generic_platform",
    "async_generic_platform",
    "PlatformDeclaration",
    # the statement surface (the TypeScript `$` twin): the block a body
    # receives first, and the builders its if_/try_ chains return
    "Block",
    "IfBuilder",
    "TryBuilder",
    "LoopLabel",
    "error",
    # expression spellings for every IR node kind
    "value",
    "as_",
    "wrap_recursive",
    "builtin",
    "compile_",
    "compile_async",
    "Expression",
    "NullExpression",
    "NeverExpression",
    "BooleanExpression",
    "IntegerExpression",
    "FloatExpression",
    "StringExpression",
    "DateTimeExpression",
    "BlobExpression",
    "RefExpression",
    "ArrayExpression",
    "SetExpression",
    "DictExpression",
    "StructExpression",
    "VariantExpression",
    "RecursiveExpression",
    "FunctionExpression",
    "AsyncFunctionExpression",
    "VectorExpression",
    "MatrixExpression",
    "ExpressionError",
    "if_else",
    "greatest",
    "least",
    # authoring-frame source maps (#626)
    "SourceMap",
    "set_location_base_path",
    # block-level control flow (#578) — reached as East.while_ / East.for_ / …
    "Label",
    "while_",
    "for_",
    "block",
    "let",
    "ref",
    "label",
    "break_",
    "continue_",
    "try_catch",
    "new_array",
    "new_set",
    "new_dict",
    "new_vector",
    "new_matrix",
]
