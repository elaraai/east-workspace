/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Reactive record binding for e3 UI tasks — read an `e3.record`'s current
 * state and apply its typed mutations from East UI code.
 *
 * `Record.bind` is the record-shaped sibling of `Data.bind` / `Func.bind`,
 * adapting the TanStack query/mutation split to East's reactive,
 * fire-and-forget model: `read` / `status` / `history` observe the record (the
 * read side, served from the shared dataset cache), while `mutate.<name>(…)`
 * launches a typed mutation fire-and-forget (the write side), with
 * `mutate.pending` / `status` / `error` / `cancel` tracking the shared,
 * latest-wins mutation lifecycle. A record's mutations serialize server-side
 * under compare-and-swap, so one shared channel per record is the honest model.
 *
 * @packageDocumentation
 */

import {
    East,
    ArrayType,
    BooleanType,
    FunctionType,
    IntegerType,
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
    type EastType,
    type ExprType,
} from '@elaraai/east';
import { DatasetStatusType, RecordCommitInfoType } from '@elaraai/e3-types';
import type { RecordDef, MutationDef } from '@elaraai/e3';

// ============================================================================
// Status + error + descriptor types
// ============================================================================

/**
 * Shared mutate-lifecycle tag for a bound record. One launch channel per
 * record (mutations serialize via CAS), latest-wins.
 *
 * @remarks
 * Client-defined. `idle` means no mutation has been launched through this
 * binding; `cancelled` means the client stopped waiting (via `cancel()` or a
 * superseding mutation) — the server's CAS reducer still ran to completion.
 *
 * @property idle - No mutation launched
 * @property running - A mutation is in flight
 * @property committed - The most recent mutation committed a new commit
 * @property failed - The most recent mutation failed (see `error`)
 * @property cancelled - The client stopped waiting for the most recent mutation
 */
export const RecordMutateStatusType = VariantType({
    idle:      NullType,
    running:   NullType,
    committed: NullType,
    failed:    NullType,
    cancelled: NullType,
});

/** Type representing the {@link RecordMutateStatusType} structure. */
export type RecordMutateStatusType = typeof RecordMutateStatusType;

/**
 * Failure detail for a bound mutation, mirroring the server's
 * `MutationResult` non-committed outcome arms plus client-side transport
 * errors — the record-side analogue of `FuncError`.
 *
 * @property kind - Which way the mutation failed:
 *   `invalid` (lookup/arity/signature), `failed` (reducer exited non-zero),
 *   `too_large` (new state exceeded the server limit), `timed_out` (reducer
 *   deadline hit), `conflict` (the compare-and-swap lost the race), `transport`
 *   (HTTP/decode failure — never reached the server).
 * @property message - One-line human-readable summary, always present
 * @property stderr - Captured reducer stderr (empty unless the reducer ran)
 */
export const RecordErrorType = StructType({
    kind: VariantType({
        invalid:   StructType({ message: StringType }),
        failed:    StructType({ exitCode: IntegerType }),
        too_large: StructType({ bytes: IntegerType, limit: IntegerType }),
        timed_out: StructType({ ms: IntegerType }),
        conflict:  StructType({ attempts: IntegerType }),
        transport: StructType({ message: StringType }),
    }),
    message: StringType,
    stderr:  StringType,
});

/** Type representing the {@link RecordErrorType} structure. */
export type RecordErrorType = typeof RecordErrorType;

/**
 * Descriptor for a record binding — carried on the handle's `binding` field
 * for inspector surfaces.
 *
 * @property name - The bound record's name in the deployed package
 * @property mutations - The mutation names this binding exposes
 */
export const RecordBindingType = StructType({
    name:      StringType,
    mutations: ArrayType(StringType),
});

/** Type representing the {@link RecordBindingType} structure. */
export type RecordBindingType = typeof RecordBindingType;

// ============================================================================
// Bind handle — return type of `Record.bind`.
// ============================================================================

/**
 * The struct returned by every {@link Record.bind} call. The read side
 * (`read` / `status` / `history`) is served reactively from the shared dataset
 * cache; the write side lives under `mutate` — one closure per mutation plus
 * the shared lifecycle accessors.
 *
 * @remarks
 * The handle's shape IS the signature: the runtime recovers the state type
 * from `read`'s output and each mutation's name + arg types from the `mutate`
 * sub-struct's fields, so there are no duplicate signature arguments to drift.
 *
 * @typeParam T - The record's East state type.
 * @typeParam M - Map of mutation name to its extra positional arg types.
 * @param stateType - The record's state East type.
 * @param mutations - Map of mutation name to its arg types.
 * @returns The handle StructType for that record + mutation set.
 *
 * @property read - The record's current committed state. Reactive — re-fires
 *   when a mutation commits (the dataset cache refreshes the record's bytes).
 * @property status - Per-dataset freshness signal — see {@link DatasetStatusType}.
 * @property history - The commit chain, newest first; `none` until the first
 *   load completes, then the cached chain (refreshed after each commit).
 * @property mutate - The write surface: one fire-and-forget closure per
 *   mutation (typed from its def), plus the shared `pending` / `status` /
 *   `error` / `cancel`.
 * @property start - Launch the workspace dataflow without mutating, so tasks
 *   that consume this record recompute against its latest committed state.
 *   The standalone "Run" affordance — a mutation refreshes the record's own
 *   bytes but does not propagate downstream until a dataflow run; call this
 *   (e.g. from a Run button) to drive that run. Always returns null.
 * @property binding - Descriptor for this binding — see {@link RecordBindingType}.
 */
export const RecordBindHandleType = <T extends EastType, M extends Record<string, EastType[]>>(
    stateType: T,
    mutations: M,
) => {
    const mutateFields: Record<string, EastType> = {
        pending: FunctionType([], BooleanType),
        status:  FunctionType([], RecordMutateStatusType),
        error:   FunctionType([], OptionType(RecordErrorType)),
        cancel:  FunctionType([], NullType),
    };
    for (const [name, argTypes] of Object.entries(mutations)) {
        if (name in mutateFields) {
            throw new Error(
                `Record.bind: mutation name "${name}" collides with a reserved mutate ` +
                `field (pending/status/error/cancel). Rename the mutation.`,
            );
        }
        mutateFields[name] = FunctionType(argTypes, NullType);
    }
    return StructType({
        read:    FunctionType([], stateType),
        status:  FunctionType([], DatasetStatusType),
        history: FunctionType([], OptionType(ArrayType(RecordCommitInfoType))),
        mutate:  StructType(mutateFields),
        start:   FunctionType([], NullType),
        binding: RecordBindingType,
    });
};

/**
 * Map of each mutation's name (literal) to its extra positional arg types,
 * recovered structurally from a tuple of {@link MutationDef}s.
 */
type MutationsArgMap<Muts extends readonly MutationDef<string, EastType, EastType[]>[]> = {
    [M in Muts[number] as M['name']]: M extends MutationDef<string, EastType, infer A> ? [...A] : never;
};

/**
 * The precise East struct type of a record handle — written as a mapped type
 * (rather than inferred from {@link RecordBindHandleType}'s runtime loop, which
 * TS widens) so each `mutate.<name>` closure keeps its arg types.
 */
type RecordHandle<T extends EastType, M extends Record<string, EastType[]>> = StructType<{
    read:    FunctionType<[], T>;
    status:  FunctionType<[], typeof DatasetStatusType>;
    history: FunctionType<[], OptionType<ArrayType<typeof RecordCommitInfoType>>>;
    mutate:  StructType<
        {
            pending: FunctionType<[], typeof BooleanType>;
            status:  FunctionType<[], RecordMutateStatusType>;
            error:   FunctionType<[], OptionType<RecordErrorType>>;
            cancel:  FunctionType<[], typeof NullType>;
        } & { [K in keyof M]: FunctionType<M[K], typeof NullType> }
    >;
    start:   FunctionType<[], typeof NullType>;
    binding: RecordBindingType;
}>;

/**
 * The TypeScript type of a {@link Record.bind} handle bound to a record of
 * state type `T` with mutations `Muts` — i.e. the return of
 * `Record.bind(record, [...mutations])`.
 *
 * @remarks
 * The mutation names + arg types live structurally in the `mutate` field's
 * closure signatures (recovered from the {@link MutationDef} tuple), not a
 * phantom TS brand, so they survive `$.let` / `$.const` and ordinary
 * expression plumbing.
 *
 * @typeParam T - The record's East state type.
 * @typeParam Muts - The bound mutation defs (their names + arg types).
 */
export type BoundRecord<
    T extends EastType,
    Muts extends readonly MutationDef<string, T, EastType[]>[],
> = ExprType<RecordHandle<T, MutationsArgMap<Muts>>>;

// ============================================================================
// Platform function — single generic over the instantiated handle type.
// ============================================================================

/**
 * The underlying `Record.bind` platform-function definition. End-users should
 * call {@link Record.bind} (the typed factory in this module); runtime
 * implementations register against this raw definition via
 * `recordBindPlatformFn.implement(...)`.
 *
 * @remarks
 * Generic over `H`, the fully-instantiated handle struct — its shape IS the
 * signature (the runtime recovers the state type from `read` and the mutation
 * names + arg types from `mutate`). The single literal argument is the record
 * name; the record's dataset path is reconstructed runtime-side, and mutation
 * names are validated against the deployed record signature.
 */
export const recordBindPlatformFn = East.genericPlatform(
    "record_bind",
    ["H"],
    [StringType],
    "H",
    { optional: true },
);

// Low-level primitives backing a `Record.bind` handle's methods (issue #106).
//
// The handle's read/status/history/start and the nested mutate.* methods are
// thin `East.function`s over these primitives, capturing only the plain-data
// record name (+ per-mutation name; the state type rides as a type-arg on
// `record_read`). So a `Record.bind` handle — including its nested mutate
// struct — is ordinary serializable East data and re-binds to the decoder's
// runtime. Implemented by `RecordRuntime` in `@elaraai/e3-ui-components`.
//
// `record_mutate` is generic over the per-mutation `ArgsStruct` `A` (the N args
// bundled into one struct, since platform fns are fixed-arity): the impl recovers
// the per-arg types from `A`'s fields and the values from the passed struct.
const record_read = East.genericPlatform("record_read", ["T"], [StringType], "T", { optional: true });
const record_status = East.platform("record_status", [StringType], DatasetStatusType, { optional: true });
const record_history = East.platform("record_history", [StringType], OptionType(ArrayType(RecordCommitInfoType)), { optional: true });
const record_start = East.platform("record_start", [StringType], NullType, { optional: true });
const record_mutate_pending = East.platform("record_mutate_pending", [StringType], BooleanType, { optional: true });
const record_mutate_status = East.platform("record_mutate_status", [StringType], RecordMutateStatusType, { optional: true });
const record_mutate_error = East.platform("record_mutate_error", [StringType], OptionType(RecordErrorType), { optional: true });
const record_mutate_cancel = East.platform("record_mutate_cancel", [StringType], NullType, { optional: true });
const record_mutate = East.genericPlatform("record_mutate", ["A"], [StringType, StringType, "A"], NullType, { optional: true });

/**
 * Low-level platform primitives that back {@link Record.bind}'s handle methods.
 *
 * @internal Not for direct use — author against {@link Record.bind}. These exist
 * so the handle's methods (incl. the nested `mutate.*`) can be IR-bearing
 * `East.function`s (serializable) rather than raw host closures.
 */
export const RecordBindPrimitives = {
    /** `record_read([T], name) -> T` — reactive dataset-cache read. */
    read: record_read,
    /** `record_status(name) -> DatasetStatus`. */
    status: record_status,
    /** `record_history(name) -> Option(Array(RecordCommitInfo))`. */
    history: record_history,
    /** `record_start(name) -> Null` — drain inflight, then launch dataflow. */
    start: record_start,
    /** `record_mutate_pending(name) -> Bool`. */
    mutatePending: record_mutate_pending,
    /** `record_mutate_status(name) -> RecordMutateStatus`. */
    mutateStatus: record_mutate_status,
    /** `record_mutate_error(name) -> Option(RecordError)`. */
    mutateError: record_mutate_error,
    /** `record_mutate_cancel(name) -> Null`. */
    mutateCancel: record_mutate_cancel,
    /** `record_mutate([ArgsStruct], recordName, mutationName, argsStruct) -> Null`. */
    mutate: record_mutate,
} as const;

// ============================================================================
// User-facing factory.
// ============================================================================

/**
 * Bind an `e3.record` and its mutations to a reactive read/mutate handle.
 *
 * Takes the {@link RecordDef} returned by `e3.record` plus the array of its
 * {@link MutationDef}s — the state type comes from the record, and each
 * mutation's name and arg types come from its def, the same way `Func.bind`
 * takes a function's signature from its `FunctionDef`. The binding is correct
 * by construction: it cannot drift from the deployed record's mutations.
 *
 * @typeParam T - The record's state East type (from the def).
 * @typeParam Muts - The mutation defs to expose (names + arg types from defs).
 * @param record - The `e3.record` definition to bind.
 * @param mutations - The mutations to expose on `handle.mutate`.
 * @returns A handle struct described by {@link RecordBindHandleType} —
 *   `read` / `status` / `history` / `mutate.{<name>,pending,status,error,cancel}`
 *   / `binding`.
 *
 * @remarks
 * The launch/observe split is the same shape `Func.bind` uses for `call`:
 * `mutate.<name>` never blocks, and everything you'd want back arrives through
 * `read` / `mutate.status` / `mutate.error` on the next reactive render. A
 * committed mutation auto-refreshes `read()` (the record's dataset bytes are
 * re-fetched) — no manual invalidation. All handles bound to the same record
 * in the same workspace share one mutation channel.
 *
 * @example
 * ```ts
 * import { East, IntegerType, NullType } from "@elaraai/east";
 * import { Button, Reactive, Stat, UIComponentType, VStack } from "@elaraai/east-ui";
 * import { Record } from "@elaraai/e3-ui";
 * import e3 from "@elaraai/e3";
 *
 * const counter = e3.record("counter", IntegerType, 0n);
 * const increment = e3.mutation("increment", counter,
 *     East.function([IntegerType, IntegerType], IntegerType, ($, state, by) => state.add(by)));
 *
 * const counterUi = East.function([], UIComponentType, _$ =>
 *     Reactive.Root(East.function([], UIComponentType, $ => {
 *         const r = $.let(Record.bind(counter, [increment]));
 *         const bump = $.const(East.function([], NullType, $ => { $(r.mutate.increment(1n)); }));
 *         return VStack.Root([
 *             Stat.Root({ label: "Counter", value: East.print(r.read()) }),
 *             Button.Root("Increment", { onClick: bump, loading: r.mutate.pending() }),
 *         ], { gap: "3" });
 *     })));
 * ```
 */
function bindRecord<
    T extends EastType,
    Muts extends readonly MutationDef<string, T, EastType[]>[],
>(
    record: RecordDef<T>,
    mutations: [...Muts],
): BoundRecord<T, Muts> {
    const mutMap: Record<string, EastType[]> = {};
    for (const m of mutations) {
        if (m.record.name !== record.name) {
            throw new Error(
                `Record.bind: mutation "${m.name}" writes record "${m.record.name}", not "${record.name}".`,
            );
        }
        mutMap[m.name] = [...m.argTypes];
    }
    const handleType = RecordBindHandleType(record.type, mutMap);
    // The record name must be a single literal Value IR node — the only shape
    // manifest derivation (`derive.ts`) handles. `record.name` is a static JS
    // string at IR-build time, so this holds by construction.
    const nameValue = East.value(record.name, StringType);
    return recordBindPlatformFn([handleType], nameValue) as BoundRecord<T, Muts>;
}

/**
 * The Record namespace — reactive record (read + mutate + history) binding for
 * e3 UI tasks.
 *
 * @remarks
 * `Record.bind` binds an `e3.record` and its mutations to a handle: `read` /
 * `status` / `history` observe the record's current state (served from the
 * shared dataset cache), and `mutate.<name>` applies a typed mutation
 * fire-and-forget under compare-and-swap, refreshing `read()` on commit.
 *
 * Use inside `Reactive.Root` for reactive re-rendering as the record and the
 * mutation lifecycle change.
 */
export const Record = {
    bind: bindRecord,
} as const;
