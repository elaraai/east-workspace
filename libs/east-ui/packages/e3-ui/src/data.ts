/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Reactive dataset binding for e3 UI tasks.
 *
 * @packageDocumentation
 */

import {
    East,
    NullType,
    BooleanType,
    FunctionType,
    StructType,
    VariantType,
    OptionType,
    none,
    some,
    variant,
    type EastType,
    type ExprType,
} from '@elaraai/east';
import { TreePathType, DatasetStatusType, type TreePath } from '@elaraai/e3-types';

// ============================================================================
// Mode + binding descriptor types — shared with the Diff component.
// ============================================================================

/**
 * The two operating modes for {@link Data.bind}.
 *
 * @property staged - Edits are buffered locally (in-memory + IndexedDB) and
 *   only flushed on `commit()`. Use for editor flows where the user reviews
 *   pending changes before publishing.
 * @property direct - Every `write()` immediately mutates the destination
 *   (the source dataset, or the patch dataset when `patch` is set). Use for
 *   live shared cursors and other no-staging surfaces.
 */
export const DataBindModeType = VariantType({
    staged: NullType,
    direct: NullType,
});
/** Type alias for {@link DataBindModeType}. */
export type DataBindModeType = typeof DataBindModeType;

/** String literal form of {@link DataBindModeType}. */
export type DataBindModeLiteral = "staged" | "direct";

/**
 * Descriptor for a single binding the {@link Diff.Root} component displays.
 *
 * Every {@link Data.bind} call exposes this descriptor as its `binding`
 * field, so callers can wire a Diff card via `Diff.Root({ bindings:
 * [view.binding, ...] })` without re-spelling the source / patch paths.
 *
 * @property source - The dataset path of the source value the binding
 *   reads from.
 * @property patch - When the binding writes through a separate patch
 *   dataset, this is its path. `none` means the binding writes directly to
 *   the source on commit (or to the staging buffer in staged mode).
 * @property mode - The binding's operating mode — see {@link DataBindModeType}.
 */
export const DiffBindingType = StructType({
    source: TreePathType,
    patch:  OptionType(TreePathType),
    mode:   DataBindModeType,
});
/** Type alias for {@link DiffBindingType}. */
export type DiffBindingType = typeof DiffBindingType;

// ============================================================================
// Bind handle — return type of `Data.bind`.
// ============================================================================

/**
 * The struct returned by every {@link Data.bind} call. Every field is
 * present regardless of `mode` / `patch` — the per-mode semantics are
 * captured in the property docs of {@link Data.bind}.
 *
 * @property read - Reactive accessor for the binding's view of the source.
 * @property write - Update the binding (buffer in staged mode, dataset in
 *   direct mode). Always returns null.
 * @property writeAndStart - Like `write`, but kicks the workspace dataflow
 *   so downstream tasks recompute. Only meaningful when `mode = "direct"`
 *   and `patch` is absent — in other modes it falls back to `write`.
 * @property source - Read the raw source value with no overlay applied.
 * @property pending - True when there is an in-flight change waiting to be
 *   committed. Always false in `mode = "direct"` without a `patch` dataset.
 * @property commit - Resolve the in-flight change. The destination depends
 *   on `mode` / `patch` — see {@link Data.bind} for the full matrix.
 * @property discard - Drop the in-flight change.
 * @property has - True iff the source dataset has a value.
 * @property status - Per-dataset freshness signal — see
 *   {@link DatasetStatusType}.
 * @property binding - Descriptor for this binding — pass directly to
 *   {@link Diff.Root}'s `bindings` array.
 */
export const DataBindHandleType = <T extends EastType | string>(t: T) => StructType({
    read:          FunctionType([], t),
    write:         FunctionType([t], NullType),
    writeAndStart: FunctionType([t], NullType),
    source:        FunctionType([], t),
    pending:       FunctionType([], BooleanType),
    commit:        FunctionType([], NullType),
    discard:       FunctionType([], NullType),
    has:           FunctionType([], BooleanType),
    status:        FunctionType([], DatasetStatusType),
    binding:       DiffBindingType,
});

/**
 * The TypeScript type of a {@link Data.bind} handle bound to source type `T`
 * — i.e. the return of `Data.bind([T], …)`.
 *
 * @remarks
 * Unlike the bare `binding` field (a {@link DiffBindingType} descriptor that is
 * type-erased at the IR level — `{ source, patch, mode }` paths only), this
 * carries `T` **structurally**, in the signatures of its `read` / `write` /
 * `source` fields. Because the type information lives in the East type — not a
 * phantom TS brand — it survives `$.let` / `$.const` and ordinary expression
 * plumbing, so a component that requires `BoundValue<SomeType>` gives the
 * developer a compile error when handed a handle bound to any other type.
 *
 * Type-specific components take a `BoundValue<…>` (e.g. `Ontology` requires
 * `BoundValue<OntologyType>`); the type-agnostic {@link Diff} keeps taking the
 * bare `binding` descriptors, since it displays pending changes for a
 * heterogeneous set of bindings.
 *
 * @typeParam T - The East type of the bound dataset value.
 */
export type BoundValue<T extends EastType> = ExprType<ReturnType<typeof DataBindHandleType<T>>>;

// ============================================================================
// Platform function — single unified definition.
// ============================================================================

/**
 * The underlying `Data.bind` platform-function definition. End-users
 * should call {@link Data.bind} (the typed factory in this module);
 * runtime implementations register against this raw definition via
 * `bindPlatformFn.implement(...)`.
 */
export const bindPlatformFn = East.genericPlatform(
    "data_bind",
    ["T"],
    [TreePathType, OptionType(TreePathType), DataBindModeType],
    StructType({
        read:          FunctionType([], "T"),
        write:         FunctionType(["T"], NullType),
        writeAndStart: FunctionType(["T"], NullType),
        source:        FunctionType([], "T"),
        pending:       FunctionType([], BooleanType),
        commit:        FunctionType([], NullType),
        discard:       FunctionType([], NullType),
        has:           FunctionType([], BooleanType),
        status:        FunctionType([], DatasetStatusType),
        binding:       DiffBindingType,
    }),
    { optional: true },
);

// ============================================================================
// User-facing factory.
// ============================================================================

/**
 * Options for {@link Data.bind}.
 *
 * @property mode - Operating mode. `"staged"` (default) buffers edits
 *   locally and commits on demand; `"direct"` writes through immediately.
 * @property patch - When supplied, the binding's commit / live writes
 *   target this patch dataset (typed `PatchType(T)`). Must be a static
 *   {@link TreePath} so manifest derivation can preload it; computed
 *   East-side path expressions are not supported. When omitted, writes
 *   target the source itself.
 */
export interface DataBindOptions {
    /** Operating mode — `"staged"` (default) or `"direct"`. */
    mode?:  DataBindModeLiteral;
    /** Optional separate patch dataset path. Must be statically known. */
    patch?: TreePath;
}

/**
 * The Data namespace — reactive dataset binding for e3 UI tasks.
 *
 * @remarks
 * `Data.bind` exposes a single binding handle that adapts to four
 * combinations of `mode` (staged | direct) and `patch` (absent | present).
 * The full per-mode semantics matrix is documented on {@link Data.bind}.
 *
 * Use inside `Reactive.Root` for reactive re-rendering when the underlying
 * datasets change.
 */
export const Data = {
    /**
     * Bind a dataset path to a reactive view of its current value, with
     * optional local staging or a separate server-backed patch dataset.
     *
     * @typeParam T - The East type of the source dataset value.
     * @param types - Single-element type-args tuple `[T]`.
     * @param source - The source dataset path.
     * @param options - {@link DataBindOptions}. When omitted, defaults to
     *   `{ mode: "staged" }` (no separate patch dataset, edits buffered
     *   locally until commit).
     * @returns A handle struct described by {@link DataBindHandleType} —
     *   `read` / `write` / `writeAndStart` / `source` / `pending` /
     *   `commit` / `discard` / `has` / `status` / `binding`.
     *
     * @remarks
     * Per-mode semantics matrix (rows are `mode × patch`, columns are
     * methods):
     *
     * | mode    | patch   | `read()`                            | `write(v)`                              | `commit()`                                          | `discard()`                  | `pending()`         |
     * |---------|---------|-------------------------------------|-----------------------------------------|-----------------------------------------------------|------------------------------|---------------------|
     * | direct  | absent  | source                              | dataset write                           | no-op                                               | no-op                        | always false        |
     * | direct  | present | apply(source, patch dataset)        | write diff(source, v) → patch dataset   | apply patch → source; clear patch dataset           | clear patch dataset          | patch non-trivial   |
     * | staged  | absent  | buffered ?? source                  | update buffer (pin snapshot first time) | apply buffer → source; drop buffer                  | drop buffer                  | buffer non-empty    |
     * | staged  | present | buffered ?? apply(source, patch)    | update buffer                           | write diff(source, buffer) → patch dataset; drop buffer | drop buffer (patch intact) | buffer non-empty  |
     *
     * `writeAndStart(v)` kicks the workspace dataflow after the write — only
     * meaningful for `mode = "direct"` without a `patch` dataset; in other
     * modes it falls back to `write(v)` (the workspace dataflow is triggered
     * on `commit` instead).
     *
     * The `binding` field surfaces this binding's descriptor as a
     * {@link DiffBindingType} value — pass it directly to
     * {@link Diff.Root}'s `bindings` array to surface the in-flight change
     * in a Diff card.
     *
     * Use inside `Reactive.Root` so `read` / `pending` / `status` re-fire
     * on every dataset or staging-buffer change.
     *
     * @example
     * ```ts
     * import { East, FloatType, NullType } from "@elaraai/east";
     * import { Reactive, Slider, UIComponentType } from "@elaraai/east-ui";
     * import { Data, Diff } from "@elaraai/e3-ui";
     * import * as e3 from "@elaraai/e3";
     *
     * const thresholdInput = e3.input("threshold", FloatType, 38.0);
     *
     * // Mirrors `dataBindStaged` in test/data.examples.ts.
     * const dataBindStaged = East.function([], UIComponentType, _$ => {
     *     return Reactive.Root(East.function([], UIComponentType, $ => {
     *         const view = $.let(Data.bind([FloatType], thresholdInput.path));
     *         const value = $.let(view.read(), FloatType);
     *         return Slider.Root(value, {
     *             min: 30.0, max: 60.0, step: 1.0,
     *             onChangeEnd: East.function([FloatType], NullType, ($, v) => { 
     *                  $(view.write(v)); 
     *             }),
     *         });
     *     }));
     * });
     * ```
     */
    bind<T extends EastType>(
        types: [T],
        source: TreePath,
        options?: DataBindOptions,
    ): BoundValue<T> {
        // Source / patch paths must be statically known so manifest
        // derivation (`deriveManifest`) can preload them. We wrap each
        // explicitly via `East.value(...)` to force a single literal
        // `Value` IR node — the only IR shape `derive.ts` needs to
        // handle.
        const sourceValue = East.value(source, TreePathType);
        const modeValue = East.value(variant(options?.mode ?? "staged", null), DataBindModeType);
        const patchValue = options?.patch === undefined
            ? East.value(none, OptionType(TreePathType))
            : East.value(some(options.patch), OptionType(TreePathType));
        return bindPlatformFn(types, sourceValue, patchValue, modeValue) as BoundValue<T>;
    },
} as const;
