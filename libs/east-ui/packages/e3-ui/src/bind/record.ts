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
 * `commit.<name>(…)` is the same write awaited: an async closure that resolves
 * to the server's terminal outcome. `Record.onApply` builds on it — an
 * editable collection's `onApply` that commits each batch to the record
 * through its patch door, as one commit.
 *
 * @packageDocumentation
 */

import {
    East,
    ArrayType,
    AsyncFunctionType,
    BooleanType,
    DictType,
    Expr,
    FunctionType,
    IntegerType,
    NullType,
    OptionType,
    PatchType,
    StringType,
    StructType,
    VariantType,
    dictPatchOpsType,
    isTypeEqual,
    none,
    printType,
    some,
    variant,
    type EastType,
    type ExprType,
    type SubtypeExprOrValue,
} from '@elaraai/east';
import { DatasetStatusType, MutationResultType, RecordCommitInfoType } from '@elaraai/e3-types';
import { Editing } from '@elaraai/east-ui';
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
 *   `invalid` (lookup/arity/signature), `failed` (the mutation's program
 *   failed), `timed_out` (its deadline hit), `conflict` (the compare-and-swap
 *   lost the race, or the write no longer matched the record), `transport`
 *   (HTTP/decode failure — never reached the server).
 * @property message - One-line human-readable summary, always present
 * @property stderr - Captured reducer stderr (empty unless the reducer ran)
 */
export const RecordErrorType = StructType({
    kind: VariantType({
        invalid:   StructType({ message: StringType }),
        failed:    StructType({ exitCode: IntegerType }),
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

/**
 * The outcome of an awaited write (`commit.<name>`): the server's terminal
 * `MutationResult`, passed on as it came, and `transport` for a call that got
 * no answer.
 *
 * @remarks
 * Only `committed` wrote anything. `transport` is the one outcome that leaves
 * it unknown whether the write committed — it may have reached the server
 * before its answer was lost — which is what the write's request id is for: a
 * retry with the same id resolves to that commit instead of writing twice.
 *
 * @property committed - The new commit, and the record state it wrote
 * @property invalid - A lookup, arity or signature error; nothing ran
 * @property failed - The mutation's program failed; see its stderr
 * @property timed_out - The program ran out of time; nothing was written
 * @property conflict - The compare-and-swap lost the race `attempts` times, or
 *   the write no longer matched the record — then `detail` names the key
 * @property transport - The call got no answer, so whether it committed is unknown
 */
export const RecordOutcomeType = VariantType({
    ...MutationResultType.fields.outcome.cases,
    transport: StructType({ message: StringType }),
});

/** Type representing the {@link RecordOutcomeType} structure. */
export type RecordOutcomeType = typeof RecordOutcomeType;

// ============================================================================
// Bind handle — return type of `Record.bind`.
// ============================================================================

/**
 * The struct returned by every {@link Record.bind} call. The read side
 * (`read` / `status` / `history`) is served reactively from the shared dataset
 * cache; the write side lives under `mutate` — one closure per mutation plus
 * the shared lifecycle accessors — and under `commit`, the same writes awaited.
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
 * @property history - The commit chain, newest first, as far as one request is
 *   answered: all of it, unless the server's host pages a record's history
 *   (e3-api-server's `historyLimit`), when it is the newest page; `none` until
 *   the first load completes, then the cached chain (refreshed after each
 *   commit).
 * @property mutate - The write surface: one fire-and-forget closure per
 *   mutation (typed from its def), plus the shared `pending` / `status` /
 *   `error` / `cancel`.
 * @property commit - The writes awaited: one async closure per mutation,
 *   taking a request id before the mutation's own arguments and resolving to
 *   its {@link RecordOutcomeType}. The id makes a retry after an unanswered
 *   call resolve to the first call's commit rather than writing twice; `""`
 *   is a write without one. It runs on `mutate`'s channel, so `pending` /
 *   `status` / `error` show it too, and a conflict reads the record and its
 *   history again before the outcome settles — `read` and `history` then show
 *   what the write lost to.
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
    const commitFields: Record<string, EastType> = {};
    for (const [name, argTypes] of Object.entries(mutations)) {
        if (name in mutateFields) {
            throw new Error(
                `Record.bind: mutation name "${name}" collides with a reserved mutate ` +
                `field (pending/status/error/cancel). Rename the mutation.`,
            );
        }
        mutateFields[name] = FunctionType(argTypes, NullType);
        commitFields[name] = AsyncFunctionType([StringType, ...argTypes], RecordOutcomeType);
    }
    return StructType({
        read:    FunctionType([], stateType),
        status:  FunctionType([], DatasetStatusType),
        history: FunctionType([], OptionType(ArrayType(RecordCommitInfoType))),
        mutate:  StructType(mutateFields),
        commit:  StructType(commitFields),
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
    commit:  StructType<{ [K in keyof M]: AsyncFunctionType<[typeof StringType, ...M[K]], RecordOutcomeType> }>;
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
// `record_commit` is its awaited sibling, which takes the write's request id too.
const record_read = East.genericPlatform("record_read", ["T"], [StringType], "T", { optional: true });
const record_status = East.platform("record_status", [StringType], DatasetStatusType, { optional: true });
const record_history = East.platform("record_history", [StringType], OptionType(ArrayType(RecordCommitInfoType)), { optional: true });
const record_start = East.platform("record_start", [StringType], NullType, { optional: true });
const record_mutate_pending = East.platform("record_mutate_pending", [StringType], BooleanType, { optional: true });
const record_mutate_status = East.platform("record_mutate_status", [StringType], RecordMutateStatusType, { optional: true });
const record_mutate_error = East.platform("record_mutate_error", [StringType], OptionType(RecordErrorType), { optional: true });
const record_mutate_cancel = East.platform("record_mutate_cancel", [StringType], NullType, { optional: true });
const record_mutate = East.genericPlatform("record_mutate", ["A"], [StringType, StringType, "A"], NullType, { optional: true });
const record_commit = East.asyncGenericPlatform("record_commit", ["A"], [StringType, StringType, StringType, "A"], RecordOutcomeType, { optional: true });

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
    /** `record_commit([ArgsStruct], recordName, mutationName, requestId, argsStruct) ~> RecordOutcome` — the awaited write. */
    commit: record_commit,
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
 * const increment = e3.mutation.reduce("increment", counter,
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

// ============================================================================
// Apply — an editable collection's batches, committed to the record.
// ============================================================================

/**
 * Options for {@link Record.onApply} over the record's own entries — a Sheet or
 * a Plan whose entries are the record's, each named by its key's text.
 */
export interface RecordApplyOptions {
    /** The patch mutation each Apply commits through — the name
     *  `e3.mutation.patch(record)` was given; `patch` when omitted. */
    mutation?: string;
    /** The collection hands keyed batches, `ChangeSet(V, K)`, as the Plan does;
     *  a Sheet hands `ChangeSet(V)`, the default. */
    keyed?: boolean;
}

/**
 * Options for {@link Record.onApply} over a collection inside one entry — the
 * rows of one Array field of one entry, which each Apply's patch reaches and
 * nothing else.
 *
 * @typeParam K - The record's key type
 * @typeParam V - The record's entry type
 * @typeParam C - The collection's row type: a row struct, or the entries of
 *   groups and loose rows a Sheet edits (`Editing.Types.Entry(G, "lines")`),
 *   every arm carrying `idField`
 */
export interface RecordApplyInsideOptions<K extends EastType, V extends EastType, C extends EastType> {
    /** The key of the entry the collection lives in. */
    entry: SubtypeExprOrValue<K>;
    /** The collection, read out of the entry. */
    get: SubtypeExprOrValue<FunctionType<[V], ArrayType<C>>>;
    /** The entry with its collection replaced, and nothing else changed. */
    set: SubtypeExprOrValue<FunctionType<[V, ArrayType<C>], V>>;
    /** The rows' String identity field. */
    idField: string;
    /** The patch mutation each Apply commits through; `patch` when omitted. */
    mutation?: string;
}

/** A bound record whose state is keyed, `Dict<K, V>` — what an Apply writes by key. */
type KeyedRecordHandle<K extends EastType, V extends EastType> =
    ExprType<StructType<{ read: FunctionType<[], DictType<K, V>> }>>;

/** An editable collection's async `onApply`, over the batch type it hands. */
type RecordApplyFunction<B extends EastType> =
    ExprType<AsyncFunctionType<[B], typeof Editing.Types.ApplyResult>>;

/**
 * An awaited write's outcome as the editing session's answer. A commit is
 * applied at the record state it wrote, which a pinned source installs; a
 * conflict carries the issues naming what went stale; anything else refused
 * the write. A call that got no answer may have committed, so it throws: the
 * session keeps the request, and its retry sends the same request id, which
 * resolves to that commit rather than writing twice.
 */
const settleWrite = East.function(
    [RecordOutcomeType, ArrayType(Editing.Types.Issue)], Editing.Types.ApplyResult,
    ($, outcome, conflicts) => {
        const result = $.let(variant("conflict", conflicts), Editing.Types.ApplyResult);
        $.match(outcome, {
            committed: ($, done) => { $.assign(result, variant("applied", { revision: some(done.stateHash) })); },
            invalid: ($, refused) => {
                $.assign(result, variant("rejected", [{ entry: "", row: none, field: none, message: refused.message }]));
            },
            failed: ($, refused) => {
                $.assign(result, variant("rejected", [{ entry: "", row: none, field: none, message: East.str`The write failed: ${refused.stderr}` }]));
            },
            timed_out: ($, refused) => {
                $.assign(result, variant("rejected", [{ entry: "", row: none, field: none, message: East.str`The write ran out of time after ${refused.ms} ms and wrote nothing` }]));
            },
            transport: ($, lost) => {
                $.error(East.str`The write got no answer, so it may have committed — retry to find out: ${lost.message}`);
            },
        });
        return result;
    },
);

/**
 * Commit an editable collection's batches to an `e3.record` — the `onApply` a
 * Sheet, a Plan or a SnapGrid takes, each Apply one commit through the record's
 * patch door (`e3.mutation.patch`).
 *
 * @remarks
 * Two forms:
 * - **Over the record's own entries** (`Record.onApply(handle)`): the
 *   collection's entries are the record's, each change naming its entry by
 *   the key's text — a String key as it is, any other its `.east` printing.
 *   Each change is its entry's insert, update or delete: the batch's own
 *   entry patches, restated by key.
 * - **Over a collection inside one entry** (`{ entry, get, set, idField }`):
 *   the rows of one entry's Array field — row structs, or a Sheet's entries of
 *   groups and loose rows, as `Editing.apply` takes them. The batch is applied
 *   to the rows it began from, and the patch is the diff of that entry before
 *   and after — it reaches the rows and nothing else.
 *
 * Every patch carries what the entries were when the edit began, and the
 * record checks it: an entry another write moved is a `conflict` naming it
 * and who changed the record last, and nothing is overwritten. A commit is
 * `applied` at the state it wrote; an invalid, failed or timed-out write is
 * `rejected`. A write that got no answer throws, and the session's retry
 * resolves to its commit, if it made one, through the batch's request id.
 *
 * The handle must be bound with the patch mutation — `Record.bind(record,
 * [e3.mutation.patch(record)])` — and the record must be a `Dict`.
 *
 * @typeParam K - The record's key type
 * @typeParam V - The record's entry type
 * @param handle - The record, bound with its patch mutation
 * @param options - {@link RecordApplyOptions} for the entries form, or
 *   {@link RecordApplyInsideOptions} for a collection inside one entry
 * @returns An async East function over the collection's batch, answering with
 *   `Editing.Types.ApplyResult`
 * @throws {Error} When the record is not a Dict, the mutation is not bound as
 *   its patch door, or `get` / `set` do not fit the entry
 *
 * @example
 * ```tsx
 * import { DictType, East, IntegerType, StringType, StructType } from "@elaraai/east";
 * import { Box, Reactive, UIComponentType } from "@elaraai/east-ui";
 * import { Data, Record, Sheet } from "@elaraai/e3-ui";
 * import e3 from "@elaraai/e3";
 *
 * const JobType = StructType({ task: StringType, qty: IntegerType });
 * const jobs = e3.record("jobs", DictType(StringType, JobType), new Map());
 * const jobsPatch = e3.mutation.patch(jobs);
 *
 * // Mirrors `recordSheetApply` in test/bind/record/record.examples.tsx.
 * const jobSheet = East.function([], UIComponentType, (_$) => (
 *     <Reactive>{$ => {
 *         const rows = $.let(Data.bindPaged(jobs));
 *         const record = $.let(Record.bind(jobs, [jobsPatch]));
 *         return (
 *             <Box height="360px">
 *                 <Sheet
 *                     data={rows}
 *                     columns={{
 *                         task: Sheet.column.text(JobType, { header: "Task", width: "220px" }),
 *                         qty:  Sheet.column.integer(JobType, { header: "Qty", width: "96px" }),
 *                     }}
 *                     onApply={Record.onApply(record)}
 *                 />
 *             </Box>
 *         );
 *     }}</Reactive>
 * ));
 * ```
 */
function applyToRecord<K extends EastType, V extends EastType>(
    handle: KeyedRecordHandle<K, V>,
    options?: RecordApplyOptions & { keyed?: false },
): RecordApplyFunction<ReturnType<typeof Editing.Types.ChangeSet<V>>>;
/**
 * The entries form for a collection that hands keyed batches — the Plan.
 *
 * @typeParam K - The record's key type
 * @typeParam V - The record's entry type
 * @param handle - The record, bound with its patch mutation
 * @param options - `{ keyed: true }`, and the patch mutation's name when it has one
 * @returns An async East function over `Editing.Types.ChangeSet(V, K)`
 */
function applyToRecord<K extends EastType, V extends EastType>(
    handle: KeyedRecordHandle<K, V>,
    options: RecordApplyOptions & { keyed: true },
): RecordApplyFunction<ReturnType<typeof Editing.Types.ChangeSet<V, K>>>;
/**
 * The form over a collection inside one entry.
 *
 * @typeParam K - The record's key type
 * @typeParam V - The record's entry type
 * @typeParam C - The collection's row type: a row struct, or entries of groups and loose rows
 * @param handle - The record, bound with its patch mutation
 * @param options - The entry, how its rows are read and replaced, and their identity field
 * @returns An async East function over `Editing.Types.ChangeSet(C)`
 */
function applyToRecord<K extends EastType, V extends EastType, C extends EastType>(
    handle: KeyedRecordHandle<K, V>,
    options: RecordApplyInsideOptions<K, V, C>,
): RecordApplyFunction<ReturnType<typeof Editing.Types.ChangeSet<C>>>;
function applyToRecord(
    handle: KeyedRecordHandle<EastType, EastType>,
    options: RecordApplyOptions | RecordApplyInsideOptions<EastType, EastType, EastType> = {},
): ExprType<AsyncFunctionType> {
    const fields = (Expr.type(handle as unknown as Expr) as StructType).fields;
    const recordType = (fields["read"] as FunctionType).output as EastType;
    if (recordType.type !== "Dict") {
        throw new Error(
            `Record.onApply: an Apply writes a record's entries by key, so the record must be a Dict — ` +
            `this one holds ${printType(recordType)}`);
    }
    const mutation = options.mutation ?? "patch";
    const commits = fields["commit"];
    const door = commits?.type === "Struct" ? commits.fields[mutation] : undefined;
    if (door === undefined || !isTypeEqual(door, AsyncFunctionType([StringType, PatchType(recordType)], RecordOutcomeType))) {
        throw new Error(
            `Record.onApply: "${mutation}" is not bound as this record's patch door — bind the record with ` +
            `e3.mutation.patch(record${mutation === "patch" ? "" : `, "${mutation}"`}) among its mutations`);
    }
    // The handle's fields as the Apply reads them; entries are opaque here, as
    // in Editing.apply, and their runtime types are exact.
    const bound = handle as unknown as {
        read: ExprType<FunctionType<[], DictType<EastType, StructType<Record<never, never>>>>>;
        history: ExprType<FunctionType<[], OptionType<ArrayType<typeof RecordCommitInfoType>>>>;
        commit: Record<string, ExprType<AsyncFunctionType<[StringType, EastType], RecordOutcomeType>>>;
    };
    const write = bound.commit[mutation]!;
    // Who changed the record last, for a conflict's words. A conflict reads the
    // history again before the write settles, so it is current.
    const lastChange = East.function([], StringType, (_$) => bound.history().match({
        some: (_$2, commits) => commits.tryGet(0n).match({
            some: (_$3, head) => East.str` — last changed by ${head.actor}`,
            none: (_$3) => East.str``,
        }),
        none: (_$2) => East.str``,
    }));

    if ("entry" in options) {
        const entryType = recordType.value;
        const get = East.value(options.get as SubtypeExprOrValue<EastType>) as ExprType<EastType>;
        const read = Expr.type(get as unknown as Expr) as EastType;
        // The rows are structs, or entries whose every arm is one — a Sheet's
        // groups and loose rows — as `Editing.apply` addresses them.
        const element = read.type === "Function" && read.output.type === "Array" ? read.output.value as EastType : undefined;
        if (read.type !== "Function" || read.inputs.length !== 1 || !isTypeEqual(read.inputs[0]!, entryType) || element === undefined
            || !(element.type === "Struct" || (element.type === "Variant"
                && Object.values(element.cases as Record<string, EastType>).every((arm) => arm.type === "Struct")))) {
            throw new Error("Record.onApply: `get` must be an East function from the record's entry to an Array of rows — row structs, or entries of groups and loose rows");
        }
        const rowType = element;
        const rowsType = ArrayType(rowType);
        const set = East.value(options.set as SubtypeExprOrValue<EastType>) as ExprType<EastType>;
        const replace = Expr.type(set as unknown as Expr) as EastType;
        if (replace.type !== "Function" || replace.inputs.length !== 2 || !isTypeEqual(replace.inputs[0]!, entryType)
            || !isTypeEqual(replace.inputs[1]!, rowsType) || !isTypeEqual(replace.output, entryType)) {
            throw new Error("Record.onApply: `set` must be an East function from the record's entry and its new rows to the entry");
        }
        const entryKey = East.value(options.entry as SubtypeExprOrValue<EastType>, recordType.key);
        const apply = Editing.apply(rowType, options.idField);
        return East.asyncFunction([Editing.Types.ChangeSet(rowType)], Editing.Types.ApplyResult, ($, batch) => {
            const rowsOf = $.const(get as ExprType<FunctionType<[EastType], typeof rowsType>>);
            const withRows = $.const(set as ExprType<FunctionType<[EastType, typeof rowsType], EastType>>);
            const applyRows = $.const(apply);
            const commit = $.const(write);
            const settle = $.const(settleWrite);
            const changedBy = $.const(lastChange);
            const key = $.const(entryKey);
            const result = $.let(variant("conflict", []), Editing.Types.ApplyResult);
            $.match(batch.base, {
                revision: ($) => {
                    $.assign(result, variant("rejected", [{ entry: "", row: none, field: none,
                        message: "Rows inside a record entry are checked against the rows the edit began from — a snapshot, never a revision" }]));
                },
                snapshot: ($, rows) => {
                    $.match(bound.read().tryGet(key), {
                        none: ($) => {
                            $.assign(result, variant("conflict", [{ entry: "", row: none, field: none,
                                message: East.str`The entry was removed since this edit began${changedBy()}` }]));
                        },
                        some: ($, current) => {
                            $.match(applyRows(rows, batch, none), {
                                conflict: ($, issues) => { $.assign(result, variant("conflict", issues)); },
                                applied: ($, next) => {
                                    const now = $.const(rowsOf(current));
                                    // Moved since the edit began — unless to this very edit's
                                    // rows, which a retry after an unanswered write finds.
                                    $.if(East.notEqual(now, rows).and(() => East.notEqual(now, next)), ($) => {
                                        $.assign(result, variant("conflict", [{ entry: "", row: none, field: none,
                                            message: East.str`The entry changed since this edit began${changedBy()}` }]));
                                    }).else(($) => {
                                        // The entry before and after the edit, each alone in a record:
                                        // their diff reaches the entry's rows and nothing else.
                                        const before = $.let(new Map(), recordType);
                                        $(before.insert(key, withRows(current, rows)));
                                        const after = $.let(new Map(), recordType);
                                        $(after.insert(key, withRows(current, next)));
                                        const outcome = $.const(commit(batch.requestId, East.diff(before, after)));
                                        const conflicts = $.let([], ArrayType(Editing.Types.Issue));
                                        $.match(outcome, {
                                            conflict: ($) => {
                                                $(conflicts.pushLast({ entry: "", row: none, field: none,
                                                    message: East.str`The entry changed since this edit began${changedBy()}` }));
                                            },
                                        });
                                        $.assign(result, settle(outcome, conflicts));
                                    });
                                },
                            });
                        },
                    });
                },
            });
            return result;
        });
    }

    const keyType = recordType.key;
    const entryType = recordType.value as StructType<Record<never, never>>;
    const batchType = "keyed" in options && options.keyed === true
        ? Editing.Types.ChangeSet(entryType, keyType)
        : Editing.Types.ChangeSet(entryType);
    // A change names its entry by the key's text: a String key is its own
    // text, any other key its `.east` printing, read back here.
    const keyOf = keyType.type === "String"
        ? East.function([StringType], StringType, (_$, id) => id)
        : East.function([StringType], keyType, (_$, id) => id.parse(keyType));
    return East.asyncFunction([batchType], Editing.Types.ApplyResult, ($, batch) => {
        const keyFrom = $.const(keyOf as ExprType<FunctionType<[StringType], EastType>>);
        const commit = $.const(write);
        const settle = $.const(settleWrite);
        const changedBy = $.const(lastChange);
        // Each change is its entry's insert, update or delete, restated by key.
        // The values and entry patches are the batch's own, carrying what each
        // entry was when the edit began, which the record checks.
        const ops = $.let(new Map(), DictType(keyType, dictPatchOpsType(entryType)));
        $.for(batch.changes, ($, change) => {
            const key = $.const(keyFrom(change.id));
            $.match(change.patch, {
                replace: ($, swap) => {
                    $.match(swap.after, {
                        some: ($, after) => {
                            $.match(swap.before, {
                                none: ($) => { $(ops.insert(key, variant("insert", after))); },
                                some: ($, before) => { $(ops.insert(key, variant("update", East.diff(before, after)))); },
                            });
                        },
                        none: ($) => {
                            $.match(swap.before, { some: ($, before) => { $(ops.insert(key, variant("delete", before))); } });
                        },
                    });
                },
                patch: ($, entry) => {
                    $.match(entry, { some: ($, update) => { $(ops.insert(key, variant("update", update))); } });
                },
            });
        });
        const outcome = $.const(commit(batch.requestId, variant("patch", ops)));
        const conflicts = $.let([], ArrayType(Editing.Types.Issue));
        $.match(outcome, {
            conflict: ($) => {
                // The entries whose change no longer applies to the record as it
                // stands are the ones another write moved.
                const current = $.const(bound.read());
                const by = $.const(changedBy());
                $.for(batch.changes, ($, change) => {
                    const key = $.const(keyFrom(change.id));
                    $.try(($) => {
                        $(East.applyPatch(current.tryGet(key), change.patch));
                    }).catch(($) => {
                        $(conflicts.pushLast({ entry: change.id, row: none, field: none, message: East.str`Changed since this edit began${by}` }));
                    });
                });
                $.if(conflicts.size().equal(0n), ($) => {
                    $(conflicts.pushLast({ entry: "", row: none, field: none, message: East.str`The record changed since this edit began${by}` }));
                });
            },
        });
        return settle(outcome, conflicts);
    });
}

/**
 * The Record namespace — reactive record (read + mutate + history) binding for
 * e3 UI tasks, and the Apply that commits an editable collection to a record.
 *
 * @remarks
 * `Record.bind` binds an `e3.record` and its mutations to a handle: `read` /
 * `status` / `history` observe the record's current state (served from the
 * shared dataset cache), and `mutate.<name>` applies a typed mutation
 * fire-and-forget under compare-and-swap, refreshing `read()` on commit;
 * `commit.<name>` is the same write awaited. `Record.onApply` commits a
 * Sheet's, a Plan's or a SnapGrid's batches to the record, each Apply one commit
 * through its patch door.
 *
 * Use inside `Reactive.Root` for reactive re-rendering as the record and the
 * mutation lifecycle change.
 */
export const Record = {
    bind: bindRecord,
    onApply: applyToRecord,
} as const;
