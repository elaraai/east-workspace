/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Runtime implementation for the unified `Data.bind` platform function.
 *
 * Replaces three older runtimes (direct / staged / overlay) with one
 * mode-dispatched implementation. The (mode, patch?) combination resolved
 * at call time selects which closures to install for `read` / `write` /
 * `commit` / `discard`.
 *
 * State (queue, registry, cache singleton, tracking context) is
 * encapsulated in the {@link BindRuntime} class. A process-global
 * {@link defaultBindRuntime} powers the `BindPlatform` export and the
 * free-function helpers; tests construct their own `BindRuntime` for
 * isolation.
 *
 * @packageDocumentation
 */

import {
    type EastTypeValue,
    encodeBeast2For,
    decodeBeast2For,
    EastError,
    ConflictError,
    diffFor,
    applyFor,
    PatchType,
    BlobType,
    toEastTypeValue,
    variant,
    compareFor,
    equalFor,
    SortedMap,
    type ValueTypeOf,
    OptionType,
} from "@elaraai/east";
import { type PlatformFunction, EastTypeType } from "@elaraai/east/internal";
import {
    bindPlatformFn,
    type DataManifest,
    type DataBindModeLiteral,
    DataBindModeType,
} from "@elaraai/e3-ui/internal";
import {
    registerReactiveTracker,
    registerPlatformImplementation,
} from "@elaraai/east-ui-components/platform";
import type { TreePath } from "@elaraai/e3-types";

import {
    type ReactiveDatasetCacheInterface,
    datasetCacheKey,
    datasetPathToString,
} from "./dataset-store.js";
import {
    getStagedStore,
    type StagedStoreInterface,
} from "./staged-store.js";

// =============================================================================
// Module-level constants — these never depend on a specific runtime
// instance, so they live at module scope.
// =============================================================================

/** Reusable `unchanged` variant for patch datasets. */
const UNCHANGED_VARIANT = variant("unchanged", null);

/** Bytewise equality for the cache's encoded BLOB representation. Used
 *  to detect concurrent writes during a commit's network round-trip so
 *  the post-commit `discard()` doesn't drop in-flight edits. */
const blobEqual = equalFor(BlobType) as (a: Uint8Array, b: Uint8Array) => boolean;

/** Structural equality for East types — used to detect that two
 *  bindings against the same source path agree on the value type.
 *  Mismatch means one binding's decoder will misread the other's bytes. */
const eastTypeEqual = equalFor(EastTypeType) as (a: EastTypeValue, b: EastTypeValue) => boolean;

// =============================================================================
// Per-binding helpers cache.
//
// The platform impl runs on every reactive re-render of every binding;
// for a Table with N row-cell bindings that's 6×N type-derived
// closures per render — so we memoize them by sourceType.
//
// Keyed by *structural* equality (via `compareFor(EastTypeType)`):
// each `Data.bind([T], ...)` evaluation builds a fresh `EastTypeValue`
// from the IR, so a WeakMap-by-identity cache would miss every render.
// Module-level (not per-runtime) because it's a pure function-of-type;
// no semantic state belongs to a particular runtime instance.
// =============================================================================

interface BindingHelpers {
    readonly patchType:   EastTypeValue;
    readonly decodeT:     (bytes: Uint8Array) => unknown;
    readonly encodeT:     (value: unknown) => Uint8Array;
    readonly decodePatch: (bytes: Uint8Array) => unknown;
    readonly encodePatch: (value: unknown) => Uint8Array;
    readonly apply:       (base: unknown, patch: unknown) => unknown;
    readonly diff:        (before: unknown, after: unknown) => unknown;
}

const helpersCache = new SortedMap<EastTypeValue, BindingHelpers>(
    undefined,
    compareFor(EastTypeType),
);

function getBindingHelpers(sourceType: EastTypeValue): BindingHelpers {
    let cached = helpersCache.get(sourceType);
    if (!cached) {
        const patchType = toEastTypeValue(PatchType(sourceType));
        cached = {
            patchType,
            decodeT:     decodeBeast2For(sourceType) as (b: Uint8Array) => unknown,
            encodeT:     encodeBeast2For(sourceType) as (v: unknown) => Uint8Array,
            decodePatch: decodeBeast2For(patchType)  as (b: Uint8Array) => unknown,
            encodePatch: encodeBeast2For(patchType)  as (v: unknown) => Uint8Array,
            apply:       applyFor(sourceType) as (b: unknown, p: unknown) => unknown,
            diff:        diffFor(sourceType)  as (b: unknown, a: unknown) => unknown,
        };
        helpersCache.set(sourceType, cached);
    }
    return cached;
}

// =============================================================================
// Public types
// =============================================================================

/**
 * Per-binding metadata the Diff renderer needs to materialize a
 * binding's tree. Keyed by `datasetCacheKey(workspace, sourcePath)`.
 */
export interface BindingTypes {
    readonly workspace:  string;
    readonly sourceType: EastTypeValue;
    readonly patchType:  EastTypeValue;
    readonly mode:       DataBindModeLiteral;
    readonly hasPatchDataset: boolean;
}

/** The struct returned by `Data.bind` — an East-side handle on a
 *  dataset binding. JS-side test callers use the same shape. */
export interface BindHandle {
    read:          () => unknown;
    write:         (value: unknown) => null;
    writeAndStart: (value: unknown) => null;
    source:        () => unknown;
    pending:       () => boolean;
    commit:        () => null;
    discard:       () => null;
    has:           () => boolean;
    status:        () => unknown;
    binding:       {
        source: TreePath;
        patch:  ValueTypeOf<OptionType<TreePath>>;
        mode:   ValueTypeOf<DataBindModeType>;
    };
}

// =============================================================================
// BindRuntime
// =============================================================================

/**
 * A `BindRuntime` owns one set of bind-runtime state: pending writes
 * queue, error listeners, cache singleton, tracking context, and
 * binding-types registry. Exists as an instantiable class so tests can
 * construct an isolated runtime per `describe` rather than wrestling
 * with shared module state. The default process-global runtime is
 * {@link defaultBindRuntime}; production callers continue to use the
 * free-function exports.
 */
export class BindRuntime {
    private cache: ReactiveDatasetCacheInterface | null = null;
    private readonly staged: StagedStoreInterface;

    // Pending-writes queue.
    private readonly pendingWrites: Array<() => Promise<void>> = [];
    private isProcessingWrites = false;
    private drainPromise: Promise<void> | null = null;
    private resolveDrain: (() => void) | null = null;
    private readonly writeErrorListeners = new Set<(error: unknown) => void>();

    // Reactive tracking — single combined tracker for both dataset
    // reads and staged-buffer reads. The renderer's reactive context
    // picks up keys from either source uniformly.
    private trackingContext: Set<string> | null = null;

    // Binding types registry — populated on every `Data.bind` call so
    // the Diff renderer can decode source/patch bytes and pick the
    // right commit code path for each binding.
    private readonly bindingRegistry = new Map<string, BindingTypes>();

    // Suppress-set for the stale-patch fallback warning. Module
    // closures rebuild on every East-side `Data.bind` evaluation
    // (i.e., every `Reactive.Root` re-render), so a closure-local
    // "logged once" flag would reset every render and the warning
    // would spam the console.
    private readonly fallbackWarningEmitted = new Set<string>();

    // List cache helpers.
    private readonly listCache = new Map<string, string[]>();

    /**
     * @param staged - The staged store this runtime uses for
     *  staged-mode buffers. Defaults to the package singleton.
     */
    constructor(staged: StagedStoreInterface = getStagedStore()) {
        this.staged = staged;
    }

    // ----- cache singleton ------------------------------------------------

    /** Read the active cache. Throws if none has been initialized. */
    requireCache(): ReactiveDatasetCacheInterface {
        if (!this.cache) {
            throw new Error(
                "ReactiveDatasetCache not initialized. " +
                "Use ReactiveDatasetProvider in React or call initializeCache() directly.",
            );
        }
        return this.cache;
    }

    /** Read the active cache, returning null if not yet initialized. */
    getCache(): ReactiveDatasetCacheInterface | null {
        return this.cache;
    }

    /** Set the active cache. When the reference changes, drops any
     *  leftover queued writes that captured the old cache. Same-cache
     *  re-init (Strict Mode double-invoke; HMR) preserves the queue. */
    initializeCache(cache: ReactiveDatasetCacheInterface): void {
        if (this.cache !== cache) {
            this.clearPendingWrites();
        }
        this.cache = cache;
    }

    /** Clear the active cache and drop any queued writes. */
    clearCache(): void {
        this.cache = null;
        this.clearPendingWrites();
    }

    // ----- pending writes queue -------------------------------------------

    /** Subscribe to write-queue errors. Returns an unsubscribe fn. */
    onWriteError(cb: (error: unknown) => void): () => void {
        this.writeErrorListeners.add(cb);
        return () => { this.writeErrorListeners.delete(cb); };
    }

    /** Resolve once every currently-queued write has finished
     *  (success or failure). Errors are NOT thrown — subscribe via
     *  {@link onWriteError} for those. */
    awaitPendingWrites(): Promise<void> {
        if (!this.isProcessingWrites && this.pendingWrites.length === 0) {
            return Promise.resolve();
        }
        if (!this.drainPromise) {
            this.drainPromise = new Promise(res => { this.resolveDrain = res; });
        }
        return this.drainPromise;
    }

    /** Drop every queued write without running it. */
    clearPendingWrites(): void {
        this.pendingWrites.length = 0;
        if (this.resolveDrain) {
            this.resolveDrain();
            this.drainPromise = null;
            this.resolveDrain = null;
        }
    }

    /** Queue a write — internal API used by the bind-handle closures. */
    private queueWrite(writeFn: () => Promise<void>): void {
        this.pendingWrites.push(writeFn);
        void this.processWriteQueue();
    }

    private async processWriteQueue(): Promise<void> {
        if (this.isProcessingWrites) return;
        this.isProcessingWrites = true;
        while (this.pendingWrites.length > 0) {
            const writeFn = this.pendingWrites.shift()!;
            try {
                await writeFn();
            } catch (error) {
                console.error("Data.bind write failed:", error);
                for (const cb of this.writeErrorListeners) {
                    try { cb(error); } catch (cbErr) {
                        console.error("Data.bind write-error listener threw:", cbErr);
                    }
                }
            }
        }
        this.isProcessingWrites = false;
        if (this.resolveDrain) {
            this.resolveDrain();
            this.drainPromise = null;
            this.resolveDrain = null;
        }
    }

    // ----- reactive tracking ---------------------------------------------

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

    trackPath(workspace: string, path: TreePath): void {
        if (this.trackingContext) {
            this.trackingContext.add(datasetCacheKey(workspace, path));
        }
    }

    // ----- binding registry ----------------------------------------------

    getBindingTypes(workspace: string, sourcePath: TreePath): BindingTypes | undefined {
        return this.bindingRegistry.get(datasetCacheKey(workspace, sourcePath));
    }

    /** Clear binding-registry entries. Pass a workspace to clear only
     *  that workspace's entries. Match is by stored field, not key
     *  prefix — workspace names that share a textual prefix never
     *  collide. */
    clearBindingRegistry(workspace?: string): void {
        if (workspace === undefined) {
            this.bindingRegistry.clear();
            this.fallbackWarningEmitted.clear();
            return;
        }
        for (const [key, info] of [...this.bindingRegistry.entries()]) {
            if (info.workspace === workspace) {
                this.bindingRegistry.delete(key);
                this.fallbackWarningEmitted.delete(key);
            }
        }
    }

    private registerBindingTypes(workspace: string, sourcePath: TreePath, info: BindingTypes): void {
        const key = datasetCacheKey(workspace, sourcePath);
        const existing = this.bindingRegistry.get(key);
        if (existing) {
            // Hot path — runs once per binding per `Reactive.Root`
            // re-render. Identity-equal mode/patch/sourceType means
            // there's nothing to update OR warn about, so bail before
            // the structural type-equality check, which can be O(type
            // tree size) for nested struct/variant trees.
            if (existing.mode === info.mode
                && existing.hasPatchDataset === info.hasPatchDataset
                && existing.sourceType === info.sourceType) {
                return;
            }
            const shapeChanged = existing.mode !== info.mode
                || existing.hasPatchDataset !== info.hasPatchDataset;
            const typeChanged = !eastTypeEqual(existing.sourceType, info.sourceType);
            if (!shapeChanged && !typeChanged) {
                this.bindingRegistry.set(key, info);
                return;
            }
            console.warn(
                `[Data.bind] source path "${key}" bound twice with different `
                + `${typeChanged ? "value types" : "(mode, patch) shapes"}: `
                + `existing { mode: "${existing.mode}", hasPatch: ${existing.hasPatchDataset} } vs `
                + `new { mode: "${info.mode}", hasPatch: ${info.hasPatchDataset} }. `
                + `Diff renderer uses the most-recent metadata; one of the two bindings may render incorrectly.`,
            );
        }
        this.bindingRegistry.set(key, info);
    }

    // ----- bind-handle construction --------------------------------------

    /**
     * Build a bind handle for a single `(sourcePath, mode, patch?)`
     * triple. Public so tests can call this directly without going
     * through East's compile/dispatch pipeline.
     *
     * @throws `EastError` if the cache is uninitialized, the
     *  workspace is not configured, or `allowed` is non-null and any
     *  referenced path is not in it.
     */
    buildBindHandle(
        sourceType: EastTypeValue,
        sourcePath: TreePath,
        patchPath: TreePath | undefined,
        mode: DataBindModeLiteral,
        allowed?: ReadonlySet<string>,
    ): BindHandle {
        const cache = this.requireCache();
        const ws = cache.getConfig().workspace;
        if (!ws) throw new Error("ReactiveDatasetCache workspace not configured");

        if (allowed) {
            const sStr = datasetPathToString(sourcePath);
            if (!allowed.has(sStr)) {
                throw new EastError(
                    `Data.bind: source path "${sStr}" not declared in manifest`,
                    { location: [{ filename: "Data.bind", line: 0n, column: 0n }] },
                );
            }
            if (patchPath) {
                const pStr = datasetPathToString(patchPath);
                if (!allowed.has(pStr)) {
                    throw new EastError(
                        `Data.bind: patch path "${pStr}" not declared in manifest`,
                        { location: [{ filename: "Data.bind", line: 0n, column: 0n }] },
                    );
                }
            }
        }

        const { patchType, decodeT, encodeT, decodePatch, encodePatch, apply, diff }
            = getBindingHelpers(sourceType);

        this.registerBindingTypes(ws, sourcePath, {
            workspace: ws,
            sourceType,
            patchType,
            mode,
            hasPatchDataset: patchPath !== undefined,
        });

        const staged = this.staged;
        const fallbackKey = datasetCacheKey(ws, sourcePath);
        const fallbackWarningEmitted = this.fallbackWarningEmitted;

        const readSourceBytes = (): Uint8Array => {
            const bytes = cache.read(ws, sourcePath);
            if (!bytes) {
                throw new EastError(
                    `Source dataset not loaded: ${datasetCacheKey(ws, sourcePath)}`,
                    { location: [{ filename: "Data.bind", line: 0n, column: 0n }] },
                );
            }
            return bytes;
        };
        const readSourceValue = (): unknown => decodeT(readSourceBytes());
        const readPatchValue = (): unknown => {
            if (!patchPath) return UNCHANGED_VARIANT;
            const bytes = cache.read(ws, patchPath);
            if (!bytes) return UNCHANGED_VARIANT;
            return decodePatch(bytes);
        };
        const overlaidSource = (): unknown => {
            // `apply` throws ConflictError on stale ops — fall back to
            // source so transient drift never crashes form components.
            // Any non-ConflictError is re-thrown: those would indicate
            // a bug in `applyFor` itself, not user-visible drift.
            const sourceVal = readSourceValue();
            try {
                return apply(sourceVal, readPatchValue());
            } catch (err) {
                if (!(err instanceof ConflictError)) throw err;
                if (!fallbackWarningEmitted.has(fallbackKey)) {
                    fallbackWarningEmitted.add(fallbackKey);
                    console.warn(
                        `[Data.bind] read fell back to source for "${fallbackKey}" — `
                        + `patch is stale relative to source. Diff card will surface drift as orange badges.`,
                        err,
                    );
                }
                return sourceVal;
            }
        };

        const bindingDescriptor = {
            source: sourcePath,
            patch:  patchPath ? variant("some", patchPath) : variant("none", null),
            mode:   variant(mode, null),
        };

        const writeStaged = (value: unknown): null => {
            this.trackPath(ws, sourcePath);
            const buffered = encodeT(value);
            if (staged.hasPending(ws, sourcePath)) {
                // `snapshotIfNew` is ignored when an entry exists; pass
                // the buffered bytes to avoid a redundant cache read.
                staged.write(ws, sourcePath, buffered, buffered);
            } else {
                const snapshot = readSourceBytes();
                staged.write(ws, sourcePath, snapshot, buffered);
            }
            return null;
        };

        // ----- direct, no patch — writes go to source ------------------
        if (mode === "direct" && !patchPath) {
            return {
                read: () => {
                    this.trackPath(ws, sourcePath);
                    return readSourceValue();
                },
                write: (value: unknown) => {
                    this.queueWrite(() => cache.write(ws, sourcePath, encodeT(value)));
                    return null;
                },
                writeAndStart: (value: unknown) => {
                    this.queueWrite(() => cache.writeAndStart(ws, sourcePath, encodeT(value)));
                    return null;
                },
                source: () => {
                    this.trackPath(ws, sourcePath);
                    return readSourceValue();
                },
                pending: () => false,
                commit: () => null,
                discard: () => null,
                has: () => cache.has(ws, sourcePath),
                status: () => {
                    this.trackPath(ws, sourcePath);
                    return cache.getStatus(ws, sourcePath);
                },
                binding: bindingDescriptor,
            };
        }

        // ----- direct, with patch — writes go to the patch dataset -----
        if (mode === "direct" && patchPath) {
            const pPath = patchPath;
            return {
                read: () => {
                    this.trackPath(ws, sourcePath);
                    this.trackPath(ws, pPath);
                    return overlaidSource();
                },
                write: (value: unknown) => {
                    const next = diff(readSourceValue(), value);
                    this.queueWrite(() => cache.write(ws, pPath, encodePatch(next)));
                    return null;
                },
                writeAndStart: (value: unknown) => {
                    const next = diff(readSourceValue(), value);
                    this.queueWrite(() => cache.writeAndStart(ws, pPath, encodePatch(next)));
                    return null;
                },
                source: () => {
                    this.trackPath(ws, sourcePath);
                    return readSourceValue();
                },
                pending: () => {
                    this.trackPath(ws, pPath);
                    return (readPatchValue() as { type: string }).type !== "unchanged";
                },
                commit: () => {
                    // Snapshot inputs synchronously so re-renders during
                    // the await don't change what we apply. Run the
                    // apply inside `queueWrite` so a stale-patch
                    // ConflictError is routed through the same error
                    // pipeline as network failures.
                    const sourceVal = readSourceValue();
                    const patchVal  = readPatchValue();
                    this.queueWrite(async () => {
                        const next = apply(sourceVal, patchVal);
                        const writes: Promise<void>[] = [];
                        cache.batch(() => {
                            writes.push(cache.write(ws, sourcePath, encodeT(next)));
                            writes.push(cache.write(ws, pPath, encodePatch(UNCHANGED_VARIANT)));
                        });
                        await Promise.all(writes);
                    });
                    return null;
                },
                discard: () => {
                    this.queueWrite(() => cache.write(ws, pPath, encodePatch(UNCHANGED_VARIANT)));
                    return null;
                },
                has: () => cache.has(ws, sourcePath),
                status: () => {
                    this.trackPath(ws, sourcePath);
                    return cache.getStatus(ws, sourcePath);
                },
                binding: bindingDescriptor,
            };
        }

        // ----- staged, no patch — IDB buffer + commit-to-source --------
        if (mode === "staged" && !patchPath) {
            return {
                read: () => {
                    this.trackPath(ws, sourcePath);
                    const buffered = staged.getBuffered(ws, sourcePath);
                    if (buffered !== undefined) return decodeT(buffered);
                    return readSourceValue();
                },
                write: writeStaged,
                writeAndStart: writeStaged,
                source: () => {
                    this.trackPath(ws, sourcePath);
                    return readSourceValue();
                },
                pending: () => {
                    this.trackPath(ws, sourcePath);
                    return staged.hasPending(ws, sourcePath);
                },
                commit: () => {
                    const entry = staged.getEntry(ws, sourcePath);
                    if (!entry) return null;
                    const buffered = entry.buffered;
                    // Drop the buffer ONLY after the server write
                    // succeeds — and only if the user hasn't edited
                    // during the round-trip.
                    this.queueWrite(async () => {
                        await cache.writeAndStart(ws, sourcePath, buffered);
                        const current = staged.getBuffered(ws, sourcePath);
                        if (current !== undefined && blobEqual(current, buffered)) {
                            staged.discard(ws, sourcePath);
                        }
                    });
                    return null;
                },
                discard: () => {
                    staged.discard(ws, sourcePath);
                    return null;
                },
                has: () => cache.has(ws, sourcePath),
                status: () => {
                    this.trackPath(ws, sourcePath);
                    return cache.getStatus(ws, sourcePath);
                },
                binding: bindingDescriptor,
            };
        }

        // ----- staged, with patch — IDB buffer + publish-to-patch ------
        const pPath = patchPath!;
        return {
            read: () => {
                this.trackPath(ws, sourcePath);
                this.trackPath(ws, pPath);
                const buffered = staged.getBuffered(ws, sourcePath);
                if (buffered !== undefined) return decodeT(buffered);
                return overlaidSource();
            },
            write: writeStaged,
            writeAndStart: writeStaged,
            source: () => {
                this.trackPath(ws, sourcePath);
                return readSourceValue();
            },
            pending: () => {
                this.trackPath(ws, sourcePath);
                return staged.hasPending(ws, sourcePath);
            },
            commit: () => {
                const entry = staged.getEntry(ws, sourcePath);
                if (!entry) return null;
                const bufferedSnapshot = entry.buffered;
                const bufferedValue = decodeT(bufferedSnapshot);
                const newPatch = diff(readSourceValue(), bufferedValue);
                this.queueWrite(async () => {
                    await cache.writeAndStart(ws, pPath, encodePatch(newPatch));
                    const current = staged.getBuffered(ws, sourcePath);
                    if (current !== undefined && blobEqual(current, bufferedSnapshot)) {
                        staged.discard(ws, sourcePath);
                    }
                });
                return null;
            },
            discard: () => {
                staged.discard(ws, sourcePath);
                return null;
            },
            has: () => cache.has(ws, sourcePath),
            status: () => {
                this.trackPath(ws, sourcePath);
                return cache.getStatus(ws, sourcePath);
            },
            binding: bindingDescriptor,
        };
    }

    // ----- platform building ---------------------------------------------

    /** Build a `Data.bind` PlatformFunction bound to this runtime.
     *  Pass `allowed=null` for an unscoped impl (the global
     *  `BindPlatform`); pass a Set for manifest scoping. */
    buildPlatform(allowed: ReadonlySet<string> | null): PlatformFunction {
        return bindPlatformFn.implement((sourceType: EastTypeValue) =>
            (sourcePathArg: unknown, patchOpt: unknown, modeVariant: unknown) => {
                const sourcePath = sourcePathArg as TreePath;
                const { patchPath, mode } = resolveOptions(patchOpt, modeVariant);
                return this.buildBindHandle(
                    sourceType,
                    sourcePath,
                    patchPath,
                    mode,
                    allowed ?? undefined,
                );
            },
        );
    }

    // ----- list cache helpers --------------------------------------------

    async preloadList(workspace: string, path: TreePath): Promise<string[]> {
        const cache = this.requireCache();
        const key = datasetCacheKey(workspace, path);
        const cached = this.listCache.get(key);
        if (cached) return cached;
        const result = await cache.list(workspace, path);
        this.listCache.set(key, result);
        return result;
    }

    clearListCache(): void {
        this.listCache.clear();
    }
}

// =============================================================================
// Argument resolution — pure, used by both buildPlatform and tests.
// =============================================================================

interface ResolvedOptions {
    readonly patchPath?: TreePath;
    readonly mode:       DataBindModeLiteral;
}

function resolveOptions(patchOpt: unknown, modeVariant: unknown): ResolvedOptions {
    const opt = patchOpt as ValueTypeOf<OptionType<TreePath>>;
    const patchPath = opt.type === "some" ? (opt.value as TreePath) : undefined;
    const m = modeVariant as ValueTypeOf<DataBindModeType>;
    if (m.type !== "staged" && m.type !== "direct") {
        throw new Error(`Data.bind: unknown mode variant "${(m as any).type}" — expected "staged" or "direct"`);
    }
    const mode = m.type as DataBindModeLiteral;
    return patchPath ? { patchPath, mode } : { mode };
}

// =============================================================================
// Default process-global runtime + free-function exports for backwards
// compatibility. Tests construct their own `new BindRuntime()` instead.
// =============================================================================

/** Process-global runtime backing the `BindPlatform` export and the
 *  free-function helpers. */
export const defaultBindRuntime = new BindRuntime();

/** Read the active cache singleton. Throws if no provider has been mounted. */
export function getReactiveDatasetCache(): ReactiveDatasetCacheInterface {
    return defaultBindRuntime.requireCache();
}

/** Set the active cache singleton — called by the React provider on mount. */
export function initializeReactiveDatasetCache(cache: ReactiveDatasetCacheInterface): void {
    defaultBindRuntime.initializeCache(cache);
}

/** Clear the active cache singleton — called on unmount or test teardown.
 *  Also drops any queued writes that captured the old cache. */
export function clearReactiveDatasetCache(): void {
    defaultBindRuntime.clearCache();
}

export function enableBindingTracking(): Set<string> {
    return defaultBindRuntime.enableTracking();
}
export function disableBindingTracking(): string[] {
    return defaultBindRuntime.disableTracking();
}
export function isBindingTracking(): boolean {
    return defaultBindRuntime.isTracking();
}
export function trackDatasetPath(workspace: string, path: TreePath): void {
    defaultBindRuntime.trackPath(workspace, path);
}

export function getBindingTypes(workspace: string, sourcePath: TreePath): BindingTypes | undefined {
    return defaultBindRuntime.getBindingTypes(workspace, sourcePath);
}
export function clearBindingRegistry(workspace?: string): void {
    defaultBindRuntime.clearBindingRegistry(workspace);
}

/** Subscribe to write-queue errors. Called once for every failed write. */
export function onWriteError(cb: (error: unknown) => void): () => void {
    return defaultBindRuntime.onWriteError(cb);
}
/** Resolve once every currently-queued write has finished. */
export function awaitPendingWrites(): Promise<void> {
    return defaultBindRuntime.awaitPendingWrites();
}
/** Drop every queued write without running it. */
export function clearPendingWrites(): void {
    defaultBindRuntime.clearPendingWrites();
}

/** Global, manifest-unscoped `Data.bind` impl. Registered on module load. */
export const BindPlatform: PlatformFunction[] = [defaultBindRuntime.buildPlatform(null)];

/** Build a manifest-scoped `Data.bind` implementation. */
export function createScopedBindPlatform(manifest: DataManifest): PlatformFunction[] {
    const allowed = new Set(manifest.paths.map(p => datasetPathToString(p)));
    return [defaultBindRuntime.buildPlatform(allowed)];
}

export async function preloadReactiveDatasetList(workspace: string, path: TreePath): Promise<string[]> {
    return defaultBindRuntime.preloadList(workspace, path);
}
export function clearReactiveDatasetListCache(): void {
    defaultBindRuntime.clearListCache();
}

// =============================================================================
// Module-load registrations — wire the default runtime into east-ui
// hooks. Tests with their own `BindRuntime` don't use these.
// =============================================================================

registerReactiveTracker({
    id: "data-bind",
    enableTracking: () => defaultBindRuntime.enableTracking(),
    disableTracking: () => defaultBindRuntime.disableTracking(),
    getStore: () => {
        const cache = defaultBindRuntime.getCache();
        if (!cache) return null;
        const staged = getStagedStore();
        return {
            subscribe: (key, cb) => {
                const offCache  = cache.subscribe(key, cb);
                const offStaged = staged.subscribe(key, cb);
                return () => { offCache(); offStaged(); };
            },
            getKeyVersion: (key) => cache.getKeyVersion(key) + staged.getKeyVersion(key),
        };
    },
});

registerPlatformImplementation(BindPlatform);
