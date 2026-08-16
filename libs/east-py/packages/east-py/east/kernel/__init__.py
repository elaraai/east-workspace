#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Trace python lambdas into compiled East kernels (IR push-down).

This is the python twin of the TypeScript expression builders: calling a
lambda once with typed expression proxies records East IR, which east-c
compiles to a native function. Eager collection methods (``map``/``filter``/
``fold``/…) use this automatically — a pure lambda like
``lambda r: r.price * r.qty`` becomes a native kernel and the whole loop
executes inside east-c with no per-element python callback; a lambda that
does real python work simply falls back to the per-element callback path.

Explicit API:

- ``kernel(param_types, fn)`` — trace ``fn`` now and return the compiled
  kernel (raises ``KernelTraceError`` if the lambda is not traceable). The
  result is an ordinary python callable, and every eager method accepts it.
- ``East.if_else(cond, value, …, otherwise)`` — the traced conditional
  (python ``if``/``and``/``or`` cannot be overloaded; inside kernels the
  boolean algebra is ``&``, ``|``, ``~``). It takes cond/value pairs then
  the else, so an if/elif/else chain is ONE IfElse node; exactly one arm
  evaluates at run time, so a guarded partial op is safe.

What traces (#393 expanded this to the whole builtin surface):

- Struct field access, arithmetic, comparison, boolean algebra, ``if_else`` /
  ``greatest`` / ``least``, and the expression methods on ``KernelExpr``
  (string ops, datetime ops, float/integer math — see the class).
- Every ``East.<Type>.*`` namespace builtin (``East.String.substring``,
  ``East.Float.sqrt``, …): the eager funnel emits IR when any argument is a
  traced expression.
- Collection transforms with nested lambdas, one level or deeper — the
  authoritative per-container enumeration is ``_TRACED_SURFACE`` (also the
  error message on an unsupported method, and pinned by the surface test):
  Array: ``map`` / ``filter`` / ``filter_map`` / ``fold`` / ``scan`` /
  ``map_reduce`` / ``flatten_to_array`` / ``flatten_to_set`` /
  ``flatten_to_dict`` / ``to_dict`` / ``to_set`` / ``unique`` / ``group_by`` / ``sorted`` / ``is_sorted`` /
  ``some`` / ``every`` / ``first_map`` / ``string_join`` / ``concat`` /
  ``slice`` / ``reversed`` / ``copy`` / ``get_keys`` / ``get`` /
  ``get_or_default`` / ``try_get`` / ``size`` / ``has`` / ``sum`` /
  ``mean`` / ``maximum`` / ``minimum`` / ``find_first`` / ``find_all`` /
  ``find_maximum`` / ``find_minimum`` / ``find_sorted_first`` /
  ``find_sorted_last`` / ``find_sorted_range`` / ``group_reduce`` /
  ``group_size`` / ``group_sum`` / ``group_mean`` / ``group_every`` /
  ``group_some`` / ``group_maximum`` / ``group_minimum`` /
  ``group_to_arrays`` / ``group_to_sets`` / ``group_to_dicts`` /
  ``group_find_all`` / ``group_find_first`` / ``group_find_maximum`` /
  ``group_find_minimum`` / ``[index_expr]``;
  Set: ``map`` / ``filter`` / ``filter_map`` / ``first_map`` /
  ``map_reduce`` / ``scan`` / ``flatten_to_array`` / ``flatten_to_set`` /
  ``flatten_to_dict`` / ``to_array`` / ``to_dict`` / ``to_set`` /
  the set algebra (``union`` / ``intersect`` /
  ``diff`` / ``sym_diff`` / ``is_subset`` / ``is_superset_of`` /
  ``is_disjoint``) / ``copy`` /
  ``size`` / ``has`` / ``reduce`` / ``sum`` / ``mean`` / ``every`` / ``some`` /
  ``group_reduce`` (``group_fold`` = deprecated alias, #535) /
  ``group_size`` / ``group_sum`` / ``group_mean`` /
  ``group_every`` / ``group_some`` / ``group_to_arrays`` /
  ``group_to_sets`` / ``group_to_dicts``;
  Dict: ``map`` / ``filter`` / ``filter_map`` / ``first_map`` /
  ``map_reduce`` / ``scan`` / ``flatten_to_array`` / ``flatten_to_set`` /
  ``flatten_to_dict`` / ``to_array`` / ``to_set`` / ``to_dict`` /
  ``union`` / ``keys_set`` / ``get_keys`` /
  ``copy`` / ``get`` / ``get_or_default`` / ``try_get`` / ``size`` /
  ``has`` / ``reduce`` / ``sum`` / ``mean`` / ``every`` / ``some`` /
  ``group_reduce`` (``group_fold`` = deprecated alias, #535) /
  ``group_size`` / ``group_sum`` / ``group_mean`` /
  ``group_every`` / ``group_some`` / ``group_to_arrays`` /
  ``group_to_sets`` / ``group_to_dicts``.
  The reductions (``sum`` / ``mean`` / ``maximum`` / ``minimum`` /
  ``reduce``) run the same builtin the eager methods do, so traced and eager
  agree including float accumulation order (#525).
  Inner lambdas may reference outer parameters.
  ``some``/``every``/``first_map`` compile to the native short-circuiting
  FirstMap scans (#403), so traced and eager forms have identical
  early-exit execution. Mutators and side-effecting methods are
  deliberately absent: the kernel language is pure.
- Captured East constants: ``EastArray`` / ``EastSet`` / ``EastDict`` /
  ``EastStruct`` values closed over by the lambda become build-time
  constants — a SNAPSHOT taken at trace time, constructed once when the
  kernel compiles (hoisted + identity-deduped, so a side-table referenced
  from many sites or inside a ``.map`` lambda never rebuilds per element).
  A multi-million-entry table belongs in a trailing parameter instead,
  pre-bound by reference with ``kernel(...).bind(table)`` (#399): zero-copy
  at any size, and the kernel observes later mutations — the explicit
  opt-in to live semantics, unlike the capture snapshot. Access methods on
  an eager collection accept traced keys and re-route through the tracer
  automatically.
- Options: construct with ``some(expr)`` / ``none`` (typed from an
  ``if_else`` arm), consume with ``.is_some()`` / ``.is_none()`` / ``.unwrap_or()`` /
  ``.match()`` / ``.unwrap()``; ``.try_parse(T)`` parses a String strictly
  to ``Option<T>`` (``none`` on any parse failure).
- General variants: construct with ``variant(case, payload)`` typed from
  context — the kernel's declared ``out=`` types the whole traced result
  (including an ``if_else`` over variant arms, which defers until the
  context arrives), an ``if_else()`` sibling types its variant arm, and a
  declared struct field types a variant built inside a struct literal.
  Consume with ``.get_tag()`` / ``.has_tag(tag)`` / ``.match()`` /
  ``.unwrap(tag)``.
- Struct results: return a dict literal — ``lambda r: {"a": …, "b": …}`` —
  so one kernel can emit every computed column in a single pass.
- Calls on compiled East function VALUES lower to the IR ``Call`` node
  (#561): a lambda that calls a ``kernel(...).bind(...)`` result, a
  ``compile_from_*`` function, or a runner-supplied ``FunctionType`` input
  (a streamTask ``emit``) compiles whole — the callee is hoisted as a
  hidden trailing parameter, bound by reference after compilation, and
  invoked natively per element. ``FunctionType`` kernel PARAMETERS are
  callable the same way (and bindable with function values), so
  ``kernel([T, FunctionType([T], U)], lambda x, f: f(x))`` is first-class.
  An ``AsyncFunctionType`` value called in a sync trace raises a named
  ``KernelTraceError``.
- Block-level control flow (#578, ``east.kernel.control``) — the loops,
  scopes, jumps and error handling east-c has always executed:
  ``East.while_(state, cond, body)`` and its sugar
  ``East.for_(collection, state, body)`` thread a state through a ``Ref``
  and a ``While``/``For*`` node, so a worklist, a BFS or a topological
  replay is ONE compiled kernel; ``East.block`` / ``East.let`` / ``East.ref``
  / ``East.label`` / ``East.break_`` / ``East.continue_`` /
  ``East.try_catch`` spell the remaining nodes; ``East.new_array`` /
  ``new_set`` / ``new_dict`` build a loop-local collection, which the
  in-place mutators (``append`` / ``insert`` / ``insert_or_update`` /
  ``delete`` / ``clear`` / …) extend in O(1) instead of copying.

Hand-built IR (``east.ir.builders`` values) compiles through
``compile_from_value``, re-exported from ``east`` alongside
``compile_from_beast2``/``_json``/``_east``. The builtin NAMES and their
signatures are the registry in ``east/runtime/builtin_signatures.py`` — the
ref setter is ``RefUpdate`` (not ``RefSet``) and comparison is a
type-parameterised ``Less`` (not ``IntegerLess``), which is not guessable
from the python surface.

Traced kernels must be pure: the lambda runs ONCE at trace time (exactly
like a TypeScript ``East.function`` builder), so side effects do not repeat
per element. Each ``kernel()`` call compiles a fresh function; reuse the
returned kernel when calling in a loop. Shared python subexpressions are
re-emitted per use site (duplicated subtrees are semantically sound for
pure kernels; bind repeated work inside the traced expression itself where
size matters).
"""

from east.kernel.control import (
    Label,
    block,
    break_,
    continue_,
    for_,
    label,
    let,
    new_array,
    new_dict,
    new_set,
    ref,
    try_catch,
    while_,
)
from east.kernel.errors import KernelTraceError, _trace_bail
from east.kernel.expr import _SHADOWABLE, _TRACED_SURFACE, KernelExpr, _shadowable_names
from east.kernel.finalize import _capturing_fn, _finalize_ir, _free_vars, _function_ir
from east.kernel.helpers import (
    _append_field_kernel,
    _append_kernel,
    _dict_insert_fields_kernel,
    _empty_array_kernel,
    _empty_dict_kernel,
    _empty_set_kernel,
    _identity_kernel,
    _none_init_kernel,
    _second_kernel,
    _set_insert_field_kernel,
)
from east.kernel.lift import (
    _lift,
    _lower_compiled_call,
    _sequence_effect,
    _trace_inner_fn,
    _tracing,
    greatest,
    if_else,
    least,
)
from east.kernel.nodes import (
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
from east.kernel.pushdown import _eligible, _trace_out_type, _type_traceable, try_push_down
from east.kernel.trace import kernel, trace, trace_builtin_call

__all__ = [
    "kernel",
    "if_else",
    "greatest",
    "least",
    "KernelTraceError",
    "KernelExpr",
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
]
