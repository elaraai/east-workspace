/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Runtime implementation for the `Record.bind` platform function — reading an
 * `e3.record`'s current state and applying its typed mutations from East UI.
 *
 * Hybrid of the two existing patterns: the READ side (`read`/`status`) is
 * served from the shared dataset cache (a record IS a dataset at
 * `.records.<name>`, preloaded + polled by the manifest like any dataset), so
 * there is no parallel fetcher; the WRITE side (`mutate.<name>`) is a
 * Func-style launch/latest-wins channel. On a committed mutation the runtime
 * fires one `cache.refresh(ws)` so the record's bytes are re-fetched and
 * `read()` re-renders, and drops the history cache so the next `history()`
 * refetches.
 *
 * All handles bound to the same record in the same workspace share one mutation
 * channel (mutations serialize server-side under compare-and-swap). Mutation
 * signatures are validated against the deployed record's describe output.
 *
 * @packageDocumentation
 */

import {
    variant,
    some,
    none,
    encodeBeast2For,
    decodeBeast2For,
    equalFor,
    toEastTypeValue,
    type EastType,
    type EastTypeValue,
    type ValueTypeOf,
} from "@elaraai/east";
import { type PlatformFunction, EastTypeType } from "@elaraai/east/internal";
import { recordBindPlatformFn, type RecordErrorType } from "@elaraai/e3-ui/internal";
import {
    workspaceRecordDescribe,
    workspaceRecordMutate,
    workspaceRecordHistory,
    type RecordSignature,
    type MutationResult,
    type RecordHistoryResult,
    type RecordCommitInfo,
} from "@elaraai/e3-api-client";
import {
    registerReactiveTracker,
    registerPlatformImplementation,
} from "@elaraai/east-ui-components/platform";
import { trackDatasetPath } from "./bind-runtime.js";
import { datasetCacheKey, type ReactiveDatasetCacheInterface } from "./dataset-store.js";
import type { TreePath } from "@elaraai/e3-types";

// =============================================================================
// API seam — the narrow surface the runtime talks through for the WRITE side.
// (The read side goes through the dataset cache, not this.) Tests stub it; the
// showcase harness swaps in an in-memory implementation.
// =============================================================================

/** Request shape for {@link RecordApi.mutate} — beast2-encoded positional
 *  args (the extra reducer parameters, after the implicit state). */
export interface RecordMutateArgs {
    args: Uint8Array[];
}

/**
 * Adapter for the workspace record endpoints. The default wraps
 * `@elaraai/e3-api-client`'s `workspaceRecordDescribe` /
 * `workspaceRecordMutate` / `workspaceRecordHistory`. `read()` does NOT go
 * through here — it reads the record's dataset bytes from the shared cache.
 */
export interface RecordApi {
    /** Describe a record's mutations (name + extra arg types), for validation. */
    describe(workspace: string, record: string): Promise<RecordSignature>;
    /** Apply a mutation synchronously, returning its terminal MutationResult. */
    mutate(workspace: string, record: string, mutation: string, req: RecordMutateArgs): Promise<MutationResult>;
    /** Read a record's commit chain (newest first). */
    history(workspace: string, record: string, limit: number | undefined, from?: string): Promise<RecordHistoryResult>;
}

/**
 * Build the default {@link RecordApi} that talks to a real e3 server via
 * `@elaraai/e3-api-client`.
 */
export function createDefaultRecordApi(
    apiUrl: string,
    repo: string,
    getToken: () => string | null,
): RecordApi {
    const opts = (): { token: string | null } => ({ token: getToken() });
    return {
        async describe(workspace, record) {
            return workspaceRecordDescribe(apiUrl, repo, workspace, record, opts());
        },
        async mutate(workspace, record, mutation, req) {
            return workspaceRecordMutate(apiUrl, repo, workspace, record, mutation, {
                args: req.args,
                actor: none,
                limits: none,
            }, opts());
        },
        async history(workspace, record, limit, from) {
            return workspaceRecordHistory(apiUrl, repo, workspace, record, limit, opts(), from);
        },
    };
}

// =============================================================================
// Value-level helpers
// =============================================================================

type RecordError = ValueTypeOf<RecordErrorType>;
type RecordMutateTag = "idle" | "running" | "committed" | "failed" | "cancelled";
type CommitInfo = RecordCommitInfo;

const eastTypeEqual = equalFor(EastTypeType) as (a: EastTypeValue, b: EastTypeValue) => boolean;

/** A handle's signature, recovered from the instantiated handle type. */
interface HandleSignature {
    readonly stateType: EastTypeValue;
    readonly mutations: ReadonlyMap<string, EastTypeValue[]>;
}

/** Reserved (non-mutation) field names inside the handle's `mutate` struct. */
const RESERVED_MUTATE_FIELDS = new Set(["pending", "status", "error", "cancel"]);

/**
 * Introspect the instantiated handle struct type `H`: the state type comes
 * from the `read` field's FunctionType output, and the mutation names + arg
 * types come from the `mutate` sub-struct's non-reserved FunctionType fields.
 * The handle's shape IS the signature — there are no duplicate signature
 * arguments to drift out of sync.
 */
export function signatureOfHandleType(handleType: EastTypeValue): HandleSignature {
    if (handleType.type !== "Struct") {
        throw new Error(`Record.bind: handle type must be a Struct; got ${handleType.type}`);
    }
    const fields = handleType.value as { name: string; type: EastTypeValue }[];
    const read = fields.find(f => f.name === "read")?.type;
    const mutate = fields.find(f => f.name === "mutate")?.type;
    if (read?.type !== "Function") {
        throw new Error("Record.bind: handle type is missing its read closure");
    }
    if (mutate?.type !== "Struct") {
        throw new Error("Record.bind: handle type is missing its mutate struct");
    }
    const stateType = (read.value as { output: EastTypeValue }).output;
    const mutations = new Map<string, EastTypeValue[]>();
    for (const field of mutate.value as { name: string; type: EastTypeValue }[]) {
        if (RESERVED_MUTATE_FIELDS.has(field.name)) continue;
        if (field.type.type !== "Function") {
            throw new Error(`Record.bind: mutate field "${field.name}" must be a closure`);
        }
        mutations.set(field.name, (field.type.value as { inputs: EastTypeValue[] }).inputs);
    }
    return { stateType, mutations };
}

/** Map a MutationResult's non-committed outcome onto a RecordError value. */
function errorOfMutationResult(result: MutationResult): RecordError {
    const outcome = result.outcome;
    switch (outcome.type) {
        case "invalid":
            return { kind: variant("invalid", { message: outcome.value.message }), message: outcome.value.message, stderr: "" };
        case "failed":
            return {
                kind: variant("failed", { exitCode: outcome.value.exitCode }),
                message: `reducer exited with code ${outcome.value.exitCode}`,
                stderr: outcome.value.stderr,
            };
        case "too_large":
            return {
                kind: variant("too_large", { bytes: outcome.value.bytes, limit: outcome.value.limit }),
                message: `new state too large (${outcome.value.bytes} bytes, limit ${outcome.value.limit})`,
                stderr: outcome.value.stderr,
            };
        case "timed_out":
            return {
                kind: variant("timed_out", { ms: outcome.value.ms }),
                message: `mutation timed out after ${outcome.value.ms}ms (server deadline)`,
                stderr: outcome.value.stderr,
            };
        case "conflict":
            return {
                kind: variant("conflict", { attempts: outcome.value.attempts }),
                message: `compare-and-swap conflicted after ${outcome.value.attempts} attempts; try again`,
                stderr: "",
            };
        default:
            return transportError(`unexpected outcome "${(outcome as { type: string }).type}"`);
    }
}

function transportError(message: string): RecordError {
    return { kind: variant("transport", { message }), message, stderr: "" };
}

/** The dataset path a record's current value lives at. */
function recordPath(name: string): TreePath {
    return [variant("field", "records"), variant("field", name)];
}

/** Tracked mutation-channel key (one per record). */
export function recordChannelKey(workspace: string, name: string): string {
    return `record:${workspace}:${name}`;
}

// =============================================================================
// Runtime
// =============================================================================

/** One tracked mutation channel per `(workspace, record)`. */
interface RecordEntry {
    status: RecordMutateTag;
    /** Monotonic; a settling mutation whose seq is no longer current is
     *  discarded (latest-wins, and `cancel` orphans by bumping it). */
    launchSeq: number;
    /** Detail of the last `failed` mutation. */
    error?: RecordError;
    /** The settle promise of the in-flight mutation, if one is running. `start()`
     *  awaits it so a commit lands before the dataflow run reads the record. */
    inflight?: Promise<void>;
}

/**
 * Encapsulates all `Record.bind` runtime state. The module-level
 * {@link defaultRecordRuntime} instance backs the registered platform; tests
 * construct their own for isolation.
 */
export class RecordRuntime {
    private api: RecordApi | null = null;
    private cache: ReactiveDatasetCacheInterface | null = null;
    private workspace: string | null = null;

    // One mutation channel per record (shared lifecycle).
    private readonly entries = new Map<string, RecordEntry>();
    // Describe signatures, fetched once per (workspace, record), failures evicted.
    private readonly signatureCache = new Map<string, Promise<RecordSignature>>();
    // History per channel, fetched once + refreshed on commit.
    private readonly histories = new Map<string, CommitInfo[]>();
    private readonly historyInFlight = new Set<string>();
    // Channels whose last history fetch failed. Guards `history()` from
    // re-issuing the request on every render (a failing endpoint would
    // otherwise spin); cleared on the next commit / on clear() so a later
    // mutation retries.
    private readonly historyFailed = new Set<string>();

    // Subscription shim — same contract (and stale-disposer guard) as func/dataset.
    private readonly keySubscribers = new Map<string, Set<() => void>>();
    private readonly keyVersions = new Map<string, number>();

    // Reactive tracking — read closures push their channel keys here while a
    // Reactive.Root render is being tracked.
    private trackingContext: Set<string> | null = null;

    // ----- wiring ----------------------------------------------------------

    /** Install the API adapter + dataset cache + workspace — called by the
     *  React provider (or a test/showcase harness) before any handle is used. */
    initialize(api: RecordApi, cache: ReactiveDatasetCacheInterface, workspace: string): void {
        this.api = api;
        this.cache = cache;
        this.workspace = workspace;
    }

    /** Tear down the adapter and all record state. */
    clear(): void {
        this.api = null;
        this.cache = null;
        this.workspace = null;
        this.entries.clear();
        this.signatureCache.clear();
        this.histories.clear();
        this.historyInFlight.clear();
        this.historyFailed.clear();
        this.keySubscribers.clear();
        this.keyVersions.clear();
    }

    // ----- reactive tracking ----------------------------------------------

    enableTracking(): Set<string> {
        this.trackingContext = new Set();
        return this.trackingContext;
    }

    disableTracking(): string[] {
        const keys = this.trackingContext ? [...this.trackingContext] : [];
        this.trackingContext = null;
        return keys;
    }

    isTracking(): boolean {
        return this.trackingContext !== null;
    }

    private track(key: string): void {
        this.trackingContext?.add(key);
    }

    // ----- subscription shim ------------------------------------------------

    subscribe(key: string, callback: () => void): () => void {
        let subs = this.keySubscribers.get(key);
        if (!subs) {
            subs = new Set();
            this.keySubscribers.set(key, subs);
        }
        subs.add(callback);
        return () => {
            subs.delete(callback);
            if (subs.size === 0 && this.keySubscribers.get(key) === subs) {
                this.keySubscribers.delete(key);
            }
        };
    }

    getKeyVersion(key: string): number {
        return this.keyVersions.get(key) ?? 0;
    }

    private notify(key: string): void {
        this.keyVersions.set(key, (this.keyVersions.get(key) ?? 0) + 1);
        const subs = this.keySubscribers.get(key);
        if (subs) for (const cb of [...subs]) cb();
    }

    // ----- registry ----------------------------------------------------------

    private entry(key: string): RecordEntry {
        let entry = this.entries.get(key);
        if (!entry) {
            entry = { status: "idle", launchSeq: 0 };
            this.entries.set(key, entry);
        }
        return entry;
    }

    private resolveWorkspace(): string {
        if (!this.workspace) {
            throw new Error("Record.bind: no workspace configured — mount a provider (or call initializeRecordApi) first");
        }
        return this.workspace;
    }

    /** The deployed describe signature for a record (fetched once, evicted on failure). */
    private signature(workspace: string, record: string): Promise<RecordSignature> {
        const sigKey = `${workspace}:${record}`;
        let promise = this.signatureCache.get(sigKey);
        if (!promise) {
            const api = this.api;
            if (!api) return Promise.reject(new Error("Record.bind: no RecordApi installed"));
            promise = api.describe(workspace, record).catch(err => {
                this.signatureCache.delete(sigKey);
                throw err;
            });
            this.signatureCache.set(sigKey, promise);
        }
        return promise;
    }

    /** Validate a mutation's declared arg types against the deployed signature. */
    private async validate(workspace: string, record: string, mutation: string, argTypes: EastTypeValue[]): Promise<RecordError | null> {
        let sig: RecordSignature;
        try {
            sig = await this.signature(workspace, record);
        } catch (err) {
            return transportError(`failed to describe record "${record}": ${err instanceof Error ? err.message : String(err)}`);
        }
        const deployed = sig.mutations.find(m => m.name === mutation);
        if (!deployed) {
            const message = `no mutation "${mutation}" on record "${record}" in the deployed package`;
            return { kind: variant("invalid", { message }), message, stderr: "" };
        }
        const argsMatch = deployed.argTypes.length === argTypes.length
            && deployed.argTypes.every((t, i) => eastTypeEqual(t as EastTypeValue, argTypes[i]!));
        if (!argsMatch) {
            const message = `signature mismatch for mutation "${mutation}": bound (${argTypes.length} args) disagrees with the deployed package`;
            return { kind: variant("invalid", { message }), message, stderr: "" };
        }
        return null;
    }

    /** Fetch a record's history once per channel (deduped); notify on settle. */
    private fetchHistory(workspace: string, record: string, key: string): void {
        if (this.historyInFlight.has(key)) return;
        this.historyInFlight.add(key);
        void (async () => {
            const api = this.api;
            try {
                if (!api) throw new Error("no RecordApi installed");
                const result = await api.history(workspace, record, undefined);
                this.histories.set(key, result.commits);
                this.historyFailed.delete(key);
            } catch {
                // Mark failed so `history()` stops re-issuing on every render;
                // a later commit / clear() drops this and retries.
                this.historyFailed.add(key);
            } finally {
                this.historyInFlight.delete(key);
                this.notify(key);
            }
        })();
    }

    // ----- closure semantics -------------------------------------------------

    private launchMutation(workspace: string, record: string, mutation: string, argTypes: EastTypeValue[], args: unknown[]): void {
        const key = recordChannelKey(workspace, record);
        const entry = this.entry(key);
        entry.launchSeq += 1;
        const mySeq = entry.launchSeq;
        entry.status = "running";
        delete entry.error;
        this.notify(key);

        const settle = (mutate: (entry: RecordEntry) => void): void => {
            const current = this.entries.get(key);
            if (!current || current.launchSeq !== mySeq) return; // superseded
            mutate(current);
            this.notify(key);
        };

        const run = (async () => {
            const invalid = await this.validate(workspace, record, mutation, argTypes);
            if (invalid) {
                settle(e => { e.status = "failed"; e.error = invalid; });
                return;
            }
            const api = this.api;
            if (!api) {
                settle(e => { e.status = "failed"; e.error = transportError("no RecordApi installed"); });
                return;
            }
            let result: MutationResult;
            try {
                const encoded = args.map((arg, i) => encodeBeast2For(argTypes[i]!)(arg));
                result = await api.mutate(workspace, record, mutation, { args: encoded });
            } catch (err) {
                settle(e => { e.status = "failed"; e.error = transportError(err instanceof Error ? err.message : String(err)); });
                return;
            }
            if (result.outcome.type === "committed") {
                settle(e => { e.status = "committed"; delete e.error; });
                // The record ref's commit hash moved — force one workspace poll so
                // the dataset cache refetches the record's bytes and read() re-renders.
                // Reuses the standing poller the manifest installed; no new poller.
                void this.cache?.refresh(workspace);
                // History grew — drop the cache (and any failed-fetch flag) so
                // the next history() refetches.
                this.histories.delete(key);
                this.historyFailed.delete(key);
                this.notify(key);
            } else {
                settle(e => { e.status = "failed"; e.error = errorOfMutationResult(result); });
            }
        })();
        entry.inflight = run;
        void run.finally(() => {
            const current = this.entries.get(key);
            if (current && current.inflight === run) delete current.inflight;
        });
    }

    /** Build the handle value for one `Record.bind` platform evaluation. */
    buildHandle(handleType: EastTypeValue, name: string): Record<string, unknown> {
        const sig = signatureOfHandleType(handleType);
        const decodeState = decodeBeast2For(sig.stateType);
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const runtime = this;
        const path = recordPath(name);

        const requireCache = (): ReactiveDatasetCacheInterface => {
            if (!runtime.cache) {
                throw new Error("Record.bind: no dataset cache configured — mount a provider first");
            }
            return runtime.cache;
        };

        const mutate: Record<string, unknown> = {
            pending: () => {
                const ws = runtime.resolveWorkspace();
                const key = recordChannelKey(ws, name);
                runtime.track(key);
                return runtime.entry(key).status === "running";
            },
            status: () => {
                const ws = runtime.resolveWorkspace();
                const key = recordChannelKey(ws, name);
                runtime.track(key);
                return variant(runtime.entry(key).status, null);
            },
            error: () => {
                const ws = runtime.resolveWorkspace();
                const key = recordChannelKey(ws, name);
                runtime.track(key);
                const entry = runtime.entry(key);
                return entry.status === "failed" && entry.error !== undefined
                    ? some(entry.error)
                    : none;
            },
            cancel: () => {
                const ws = runtime.resolveWorkspace();
                const key = recordChannelKey(ws, name);
                const entry = runtime.entry(key);
                if (entry.status === "running") {
                    entry.launchSeq += 1; // orphan the in-flight wait
                    entry.status = "cancelled";
                    delete entry.error;
                    // Drop the in-flight handle so a later start() doesn't wait
                    // on the mutation the user just cancelled.
                    delete entry.inflight;
                    runtime.notify(key);
                }
                return null;
            },
        };
        for (const [mutationName, argTypes] of sig.mutations) {
            mutate[mutationName] = (...args: unknown[]) => {
                runtime.launchMutation(runtime.resolveWorkspace(), name, mutationName, argTypes, args);
                return null;
            };
        }

        return {
            read: () => {
                const ws = runtime.resolveWorkspace();
                trackDatasetPath(ws, path);
                const bytes = requireCache().read(ws, path);
                if (bytes === undefined) {
                    throw new Error(`Record.bind: record state not loaded: ${datasetCacheKey(ws, path)} (it should be preloaded via the UI task manifest)`);
                }
                return decodeState(bytes);
            },
            status: () => {
                const ws = runtime.resolveWorkspace();
                trackDatasetPath(ws, path);
                return requireCache().getStatus(ws, path);
            },
            history: () => {
                const ws = runtime.resolveWorkspace();
                const key = recordChannelKey(ws, name);
                runtime.track(key);
                const cached = runtime.histories.get(key);
                if (cached === undefined) {
                    // Don't re-issue while a prior fetch is known to have failed
                    // (a commit / clear() clears the flag and retries).
                    if (!runtime.historyFailed.has(key)) runtime.fetchHistory(ws, name, key);
                    return none;
                }
                return some(cached);
            },
            mutate,
            start: () => {
                const ws = runtime.resolveWorkspace();
                const cache = requireCache();
                const inflight = runtime.entry(recordChannelKey(ws, name)).inflight;
                // Drain any in-flight mutation first so the run reads the committed
                // state, then launch. Launch failures surface via dataflow status.
                void Promise.resolve(inflight)
                    .catch(() => undefined)
                    .then(() => cache.launchDataflow(ws))
                    .catch(() => undefined);
                return null;
            },
            binding: { name, mutations: [...sig.mutations.keys()] },
        };
    }

    // ----- platform building -------------------------------------------------

    /** Build a `Record.bind` PlatformFunction bound to this runtime. Pass
     *  `allowed=null` for an unscoped impl; pass a Set of record names for
     *  manifest scoping. */
    buildPlatform(allowed: ReadonlySet<string> | null): PlatformFunction {
        return recordBindPlatformFn.implement((handleType: EastTypeValue) =>
            (nameArg: unknown) => {
                const name = nameArg as string;
                if (allowed && !allowed.has(name)) {
                    throw new Error(
                        `Record.bind: record "${name}" is not in this UI task's manifest — ` +
                        `bind it in the task body so derivation records it`,
                    );
                }
                return this.buildHandle(handleType, name);
            },
        );
    }
}

// =============================================================================
// Default process-global runtime + free-function exports.
// =============================================================================

/** Process-global runtime backing the `RecordPlatform` export. */
export const defaultRecordRuntime = new RecordRuntime();

/** Install the record API adapter + dataset cache + workspace — called by the
 *  React provider on mount (or by a test/showcase harness). */
export function initializeRecordApi(api: RecordApi, cache: ReactiveDatasetCacheInterface, workspace: string): void {
    defaultRecordRuntime.initialize(api, cache, workspace);
}

/** Tear down the record API adapter and all record state. */
export function clearRecordApi(): void {
    defaultRecordRuntime.clear();
}

/** Global, manifest-unscoped `Record.bind` impl. Registered on module load. */
export const RecordPlatform: PlatformFunction[] = [defaultRecordRuntime.buildPlatform(null)];

/** Build a manifest-scoped `Record.bind` implementation. */
export function createScopedRecordPlatform(records: readonly string[]): PlatformFunction[] {
    return [defaultRecordRuntime.buildPlatform(new Set(records))];
}

// =============================================================================
// In-memory RecordApi — offline harnesses (showcase, snapshots, tests) register
// deterministic implementations; `mutate` writes the new state straight into
// the dataset cache (so `read()` re-renders offline without a poller) and
// appends a synthetic commit.
// =============================================================================

/** One offline record implementation for {@link createInMemoryRecordApi}. */
export interface InMemoryRecordDef {
    /** Record name (what `Record.bind` is bound to). */
    name: string;
    /** The record's state type. */
    stateType: EastType | EastTypeValue;
    /** Initial state value (seeds the dataset cache). */
    initial: unknown;
    /** Mutations — each a reducer over the decoded state + decoded args. */
    mutations: {
        name: string;
        argTypes: (EastType | EastTypeValue)[];
        reduce: (state: unknown, ...args: unknown[]) => unknown;
    }[];
}

/**
 * Build an offline {@link RecordApi} from local implementations — the
 * showcase/snapshot harnesses' stand-in for a deployed record. Seeds each
 * record's current value into the dataset cache so `read()` works offline.
 */
export function createInMemoryRecordApi(
    cache: ReactiveDatasetCacheInterface,
    workspace: string,
    defs: InMemoryRecordDef[],
): RecordApi {
    interface Compiled {
        stateType: EastTypeValue;
        mutations: Map<string, { argTypes: EastTypeValue[]; reduce: (state: unknown, ...args: unknown[]) => unknown }>;
        commits: CommitInfo[];
        seq: number;
    }
    const compiled = new Map<string, Compiled>();
    for (const def of defs) {
        const stateType = toEastTypeValue(def.stateType as EastType);
        const mutations = new Map<string, { argTypes: EastTypeValue[]; reduce: (state: unknown, ...args: unknown[]) => unknown }>();
        for (const m of def.mutations) {
            mutations.set(m.name, { argTypes: m.argTypes.map(t => toEastTypeValue(t as EastType)), reduce: m.reduce });
        }
        const genesis: CommitInfo = {
            hash: `${def.name}-0`.padEnd(64, "0"),
            parent: none,
            state: `${def.name}-state-0`.padEnd(64, "0"),
            mutation: "$init",
            actor: "memory",
            at: new Date(0),
        };
        compiled.set(def.name, { stateType, mutations, commits: [genesis], seq: 0 });
        // Seed the record's current value into the dataset cache.
        void cache.write(workspace, recordPath(def.name), encodeBeast2For(stateType)(def.initial));
    }

    return {
        async describe(_ws, record) {
            const c = compiled.get(record);
            if (!c) throw new Error(`no in-memory record "${record}"`);
            return {
                name: record,
                mutations: [...c.mutations].map(([name, m]) => ({ name, argTypes: m.argTypes })),
            } as unknown as RecordSignature;
        },
        async mutate(ws, record, mutation, req) {
            const c = compiled.get(record);
            if (!c) throw new Error(`no in-memory record "${record}"`);
            const m = c.mutations.get(mutation);
            if (!m) return { outcome: variant("invalid", { message: `no mutation "${mutation}"` }) } as MutationResult;
            const current = cache.read(ws, recordPath(record));
            const state = current !== undefined ? decodeBeast2For(c.stateType)(current) : undefined;
            const args = req.args.map((bytes, i) => decodeBeast2For(m.argTypes[i]!)(bytes));
            const next = m.reduce(state, ...args);
            await cache.write(ws, recordPath(record), encodeBeast2For(c.stateType)(next));
            c.seq += 1;
            const hash = `${record}-${c.seq}`.padEnd(64, "0");
            c.commits.unshift({
                hash,
                parent: some(c.commits[0]!.hash),
                state: `${record}-state-${c.seq}`.padEnd(64, "0"),
                mutation,
                actor: "memory",
                at: new Date(0),
            });
            return { outcome: variant("committed", { commitHash: hash, stateHash: `${record}-state-${c.seq}`.padEnd(64, "0") }) } as MutationResult;
        },
        async history(_ws, record, limit) {
            const c = compiled.get(record);
            if (!c) throw new Error(`no in-memory record "${record}"`);
            const commits = limit !== undefined ? c.commits.slice(0, limit) : c.commits;
            return { commits } as RecordHistoryResult;
        },
    };
}

// =============================================================================
// Module-load registrations — wire the default runtime into east-ui hooks.
// Tests with their own `RecordRuntime` don't use these.
// =============================================================================

registerReactiveTracker({
    id: "record-bind",
    enableTracking: () => defaultRecordRuntime.enableTracking(),
    disableTracking: () => defaultRecordRuntime.disableTracking(),
    getStore: () => ({
        subscribe: (key, cb) => defaultRecordRuntime.subscribe(key, cb),
        getKeyVersion: (key) => defaultRecordRuntime.getKeyVersion(key),
    }),
});

registerPlatformImplementation(RecordPlatform);
