/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A bound record's handle: `Record.bind`, the handle's type, its descriptor
 * and outcome types, and the platform functions behind its methods.
 *
 * `Record.bind` is the record-shaped sibling of `Data.bind` / `Func.bind`,
 * adapting the TanStack query/mutation split to East's reactive,
 * fire-and-forget model: `read` / `status` / `history` observe the record (the
 * read side, served from the shared dataset cache), while `mutate.<name>(…)`
 * launches a typed mutation fire-and-forget (the write side), with
 * `mutate.pending` / `status` / `error` / `cancel` tracking the shared,
 * latest-wins mutation lifecycle. `commit.<name>(…)` is the same write
 * awaited, and `draft.<name>(…)` the same write not made.
 *
 * @packageDocumentation
 */

import {
    East,
    ArrayType,
    AsyncFunctionType,
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
import { DatasetStatusType, MutationResultType, RecordCommitInfoType, type TreePath } from '@elaraai/e3-types';
import type { RecordDef, MutationDef } from '@elaraai/e3';
import { FuncDraftType } from './func.js';
import { RecordBindingSourcesType, bindingSources } from './record-composite.js';

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
 * for inspector surfaces, and for whatever must tell a composite record's
 * loaded entries from the solution's own.
 *
 * @property name - The bound record's name in the deployed package
 * @property mutations - The mutation names this binding exposes
 * @property sources - A composite record's sources, in the order of its key's
 *   cases, each with whether its load alone writes its entries
 *   ({@link RecordBindingSourcesType}); none for a plain record
 */
export const RecordBindingType = StructType({
    name:      StringType,
    mutations: ArrayType(StringType),
    sources:   RecordBindingSourcesType,
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
 * the shared lifecycle accessors — under `commit`, the same writes awaited, and
 * under `draft`, the same writes not made.
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
 *   what the write lost to. A record also bound with `Data.bindPaged` is read
 *   a window at a time and never whole (#1199): its UI task holds no value of
 *   it for `read` to serve, and its windows follow the record's revision.
 * @property draft - The writes not made: one closure per mutation, taking the
 *   arguments `mutate.<name>` takes and answering the call as a draft
 *   ({@link FuncDraftType}), its arguments encoded as a commit sends them. It
 *   commits nothing, reads nothing and changes no status of the handle: a
 *   bound function that lists the record in its `drafts` takes the draft with
 *   its call, and reads the record with it laid over.
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
    // The writes' fields as lists, in order: an object would list a mutation named like an integer first (#1574)
    const mutateFields: (readonly [string, EastType])[] = [
        ["pending", FunctionType([], BooleanType)],
        ["status",  FunctionType([], RecordMutateStatusType)],
        ["error",   FunctionType([], OptionType(RecordErrorType))],
        ["cancel",  FunctionType([], NullType)],
    ];
    const reserved = new Set(mutateFields.map(([name]) => name));
    const commitFields: (readonly [string, EastType])[] = [];
    const draftFields: (readonly [string, EastType])[] = [];
    for (const [name, argTypes] of Object.entries(mutations)) {
        if (reserved.has(name)) {
            throw new Error(
                `Record.bind: mutation name "${name}" collides with a reserved mutate ` +
                `field (pending/status/error/cancel). Rename the mutation.`,
            );
        }
        mutateFields.push([name, FunctionType(argTypes, NullType)]);
        commitFields.push([name, AsyncFunctionType([StringType, ...argTypes], RecordOutcomeType)]);
        draftFields.push([name, FunctionType(argTypes, FuncDraftType)]);
    }
    return StructType({
        read:    FunctionType([], stateType),
        status:  FunctionType([], DatasetStatusType),
        history: FunctionType([], OptionType(ArrayType(RecordCommitInfoType))),
        mutate:  StructType(mutateFields),
        commit:  StructType(commitFields),
        draft:   StructType(draftFields),
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
    draft:   StructType<{ [K in keyof M]: FunctionType<M[K], FuncDraftType> }>;
    start:   FunctionType<[], typeof NullType>;
    binding: RecordBindingType;
}>;

/**
 * The TypeScript type of a {@link Record.bind} handle bound to a record of
 * state type `T` with mutations `Muts` — i.e. the return of
 * `Record.bind(record)`, or of `Record.bind(record, [...names])`.
 *
 * @remarks
 * The mutation names + arg types live structurally in the `mutate` field's
 * closure signatures (recovered from the bound {@link MutationDef}s), not a
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
 * names + arg types from `mutate`). Its two arguments are literals: the
 * record's name — the record's dataset path is reconstructed runtime-side, and
 * mutation names are validated against the deployed record signature — and
 * the record's sources ({@link RecordBindingSourcesType}), none for a plain
 * record, which the handle carries as `binding.sources` and a host reads from
 * the UI's IR before it deploys (`deriveUiAccess`).
 */
export const recordBindPlatformFn = East.genericPlatform(
    "record_bind",
    ["H"],
    [StringType, RecordBindingSourcesType],
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
// `record_commit` is its awaited sibling, which takes the write's request id too,
// and `record_draft` the same call not made: it answers the draft, and writes nothing.
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
const record_draft = East.genericPlatform("record_draft", ["A"], [StringType, StringType, "A"], FuncDraftType, { optional: true });

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
    /** `record_draft([ArgsStruct], recordName, mutationName, argsStruct) -> FuncDraft` — the write not made: its call as a draft. */
    draft: record_draft,
} as const;

// ============================================================================
// User-facing factory.
// ============================================================================

/**
 * A record's mutation names, as its declaration carries them.
 *
 * @typeParam R - The record
 */
export type MutationNameOf<R> = R extends { readonly mutations: infer M } ? keyof M & string : never;

/**
 * The mutations a list of a record's mutation names names, in its order: each
 * the declaration the record holds under the name.
 *
 * @typeParam R - The record
 * @typeParam N - The names
 */
export type MutationsNamed<R, N extends readonly string[]> = R extends { readonly mutations: infer M }
    ? { readonly [K in keyof N]: N[K] extends keyof M ? M[N[K]] : never }
    : never;

/** Every mutation a record declares. */
type AllMutationsOf<R> = R extends { readonly mutations: infer M } ? readonly M[keyof M][] : never;

/**
 * Bind an `e3.record` and its mutations to a reactive read/mutate handle.
 *
 * Takes the {@link RecordDef} returned by `e3.record` and binds the mutations
 * it declares — every one, or those named — the state type from the record,
 * and each mutation's name and arg types from the declaration the record holds
 * under it, the same way `Func.bind` takes a function's signature from its
 * `FunctionDef`. The binding is correct by construction: it cannot drift from
 * the deployed record's mutations, and a name the record does not declare is a
 * type error.
 *
 * @typeParam R - The record (its state type and its mutations from its declaration).
 * @typeParam N - The mutations to expose, by name; every one the record declares when none are given.
 * @param record - The `e3.record` definition to bind.
 * @param mutations - The names of the mutations to expose on `handle.mutate`: every one the record declares when
 *   omitted, none for `[]`.
 * @returns A handle struct described by {@link RecordBindHandleType} —
 *   `read` / `status` / `history` / `mutate.{<name>,pending,status,error,cancel}`
 *   / `commit.<name>` / `draft.<name>` / `start` / `binding`.
 * @throws {Error} Naming the record and its mutations, for a name it does not declare
 *
 * @remarks
 * The launch/observe split is the same shape `Func.bind` uses for `call`:
 * `mutate.<name>` never blocks, and everything you'd want back arrives through
 * `read` / `mutate.status` / `mutate.error` on the next reactive render. A
 * committed mutation auto-refreshes `read()` (the record's dataset bytes are
 * re-fetched) — no manual invalidation. All handles bound to the same record
 * in the same workspace share one mutation channel.
 *
 * `draft.<name>` takes the arguments `mutate.<name>` takes and answers the
 * mutation as a draft ({@link FuncDraftType}): a call of it that is not
 * committed. It commits nothing, reads nothing and changes no status of the
 * handle. A function that lists the record in its `drafts` takes the draft
 * with its call (`Func.bind`), and reads the record with it laid over.
 *
 * A composite record (`e3.recordComposite`) is bound as any record is, and
 * its handle's `binding.sources` names its sources, each with whether its
 * load alone writes its entries: what a Save and every builder tell a loaded
 * entry from one of the solution's own by. A plain record's names none.
 *
 * @example
 * ```ts
 * import { East, IntegerType, NullType } from "@elaraai/east";
 * import { Button, Reactive, Stat, UIComponentType, VStack } from "@elaraai/east-ui";
 * import { Record } from "@elaraai/e3-ui";
 * import e3 from "@elaraai/e3";
 *
 * const counter = e3.record("counter", IntegerType, {
 *     initial: 0n,
 *     mutations: (mutation) => ({
 *         increment: mutation.reduce(East.function([IntegerType, IntegerType], IntegerType, ($, state, by) => state.add(by))),
 *     }),
 * });
 *
 * const counterUi = East.function([], UIComponentType, _$ =>
 *     Reactive.Root(East.function([], UIComponentType, $ => {
 *         const r = $.let(Record.bind(counter));
 *         const bump = $.const(East.function([], NullType, $ => { $(r.mutate.increment(1n)); }));
 *         return VStack.Root([
 *             Stat.Root({ label: "Counter", value: East.print(r.read()) }),
 *             Button.Root("Increment", { onClick: bump, loading: r.mutate.pending() }),
 *         ], { gap: "3" });
 *     })));
 * ```
 *
 * @example
 * ```ts
 * // A mutation as a draft: asked about before it is committed, over the counter above.
 * import { BooleanType, East, IntegerType, NullType } from "@elaraai/east";
 * import { Button, Reactive, Stat, UIComponentType, VStack } from "@elaraai/east-ui";
 * import { Func, Record } from "@elaraai/e3-ui";
 * import e3 from "@elaraai/e3";
 *
 * // `drafts: [counter]`: a call may lay drafts of the counter's mutations over what it reads
 * const withinLimitFn = e3.function("within_limit",
 *     { inputs: [counter], drafts: [counter], args: [IntegerType], output: BooleanType },
 *     (_$, count, limit) => East.lessEqual(count, limit));
 *
 * // Mirrors `recordBindDraft` in test/bind/record/record.examples.tsx.
 * const recordBindDraft = East.function([], UIComponentType, _$ =>
 *     Reactive.Root(East.function([], UIComponentType, $ => {
 *         const r = $.let(Record.bind(counter, ["increment"]));
 *         const within = $.let(Func.bind(withinLimitFn));
 *         const ask = $.const(East.function([], NullType, $ => {
 *             // The arguments `r.mutate.increment` takes, not committed: nobody else sees the edit
 *             $(within.call(10n, [r.draft.increment(25n)]));
 *         }));
 *         return VStack.Root([
 *             Stat.Root({ label: "Counter, as saved", value: East.print(r.read()) }),
 *             Stat.Root({ label: "Within 10 after 25 more", value: East.print(within.read()) }),
 *             Button.Root("Ask about 25 more", { onClick: ask, loading: within.pending() }),
 *         ], { gap: "3", align: "stretch" });
 *     })));
 * ```
 */
export function bindRecord<R extends RecordDef<EastType, TreePath, object, object>>(
    record: R,
): BoundRecord<R['type'], Extract<AllMutationsOf<R>, readonly MutationDef<string, R['type'], EastType[]>[]>>;
export function bindRecord<R extends RecordDef<EastType, TreePath, object, object>, const N extends readonly MutationNameOf<R>[]>(
    record: R,
    mutations: N,
): BoundRecord<R['type'], Extract<MutationsNamed<R, N>, readonly MutationDef<string, R['type'], EastType[]>[]>>;
export function bindRecord(record: RecordDef<EastType>, names?: readonly string[]): unknown {
    const declared = record.mutations as Readonly<Record<string, MutationDef | undefined>>;
    const declaredNames = Object.keys(declared);
    const listed = () => (declaredNames.length === 0 ? "it declares none" : `it declares ${declaredNames.map((name) => `'${name}'`).join(", ")}`);
    if (names !== undefined && !Array.isArray(names)) throw new Error(`Record.bind: mutations lists the names of record '${record.name}''s mutations — ${listed()}`);
    const mutations = (names ?? declaredNames).map((name) => {
        const mutation = typeof name === "string" ? declared[name] : undefined;
        if (mutation === undefined) {
            throw new Error(typeof name === "string"
                ? `Record.bind: record '${record.name}' declares no mutation '${name}' — ${listed()}`
                : `Record.bind: a mutation is given by its name, as record '${record.name}' declares it — ${listed()}`);
        }
        return mutation;
    });
    const mutMap: Record<string, EastType[]> = {};
    for (const m of mutations) mutMap[m.name] = [...m.argTypes];
    const handleType = RecordBindHandleType(record.type, mutMap);
    // The record name must be a single literal Value IR node — the only shape
    // manifest derivation (`derive.ts`) handles. `record.name` is a static JS
    // string at IR-build time, so this holds by construction.
    const nameValue = East.value(record.name, StringType);
    // The record's sources are a literal too, from its declaration: what `deriveUiAccess` reads back.
    const sourcesValue = East.value(bindingSources(record), RecordBindingSourcesType);
    return recordBindPlatformFn([handleType], nameValue, sourcesValue);
}
