/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * StagedStore — local transactional buffer for staged `Data.bind` writes.
 *
 * @remarks
 * Edits made through staged-mode bindings accumulate here as a per-path
 * entry of `{ snapshot, buffered }`, where:
 *   - `snapshot` is the server value at first-write time (pinned),
 *   - `buffered` is the user's current locally-edited value.
 *
 * The runtime value type for each path lives in the
 * {@link bindingRegistry} maintained by `bind-runtime.ts` — this store
 * holds bytes only and intentionally has no opinion about how to decode
 * them. Decoders look up `getBindingTypes(workspace, path).sourceType`.
 *
 * Persistence is via IndexedDB so values can be MB-scale (well past the
 * ~5–10MB localStorage cap). The store maintains a synchronous in-memory
 * cache mirrored from IndexedDB on hydrate, so reactive reads
 * (`hasPending` / `getBuffered`) stay synchronous. Writes update the
 * in-memory cache synchronously and persist to IndexedDB write-through.
 *
 * Subscribers are notified per-key on writes / discards / hydrate.
 *
 * Hydration is async (one IndexedDB load on first construction). Until
 * `await store.ready()` resolves, the in-memory cache is empty and reads
 * return undefined. Reactive subscribers fire after hydrate completes, so
 * UI components written against the standard `Reactive.Root` machinery
 * pick up hydrated entries automatically without explicit awaiting.
 *
 * @packageDocumentation
 */

import type { TreePath } from "@elaraai/e3-types";
import { datasetCacheKey } from "./dataset-store.js";

// ============================================================================
// Public types
// ============================================================================

/** A staged entry as held in the in-memory cache. */
export interface StagedEntry {
    /** Server value at the moment staging began. Pinned across writes;
     *  used as the snapshot side of the eventual 3-way merge at commit. */
    snapshot: Uint8Array;
    /** Current locally-edited value. Updates on every `write`. */
    buffered: Uint8Array;
}

/** Persisted form. Identical to {@link StagedEntry} — kept distinct so
 *  future persistence-layer fields (e.g. compression metadata) don't
 *  leak into the in-memory shape. */
export interface PersistedStagedEntry {
    snapshot: Uint8Array;
    buffered: Uint8Array;
}

/** Pluggable persistence adapter. Production uses IndexedDB; tests / SSR
 *  use the in-memory adapter. */
export interface StagedPersistenceAdapter {
    /** Load every persisted entry. Called once when the store is constructed. */
    loadAll(): Promise<Map<string, PersistedStagedEntry>>;
    /** Persist (or replace) an entry by key. */
    save(key: string, entry: PersistedStagedEntry): Promise<void>;
    /** Remove a single persisted entry by key. */
    remove(key: string): Promise<void>;
    /** Remove all persisted entries. */
    clear(): Promise<void>;
}

export interface StagedStoreInterface {
    /** Resolves when the initial hydrate from persistence has completed.
     *  Reactive subscribers are notified per-key as entries hydrate. */
    ready(): Promise<void>;

    /** Resolves when every in-flight persistence write has completed.
     *  Used by tests and by host code that needs to ensure durability
     *  before a navigation / unload event. */
    flushPending(): Promise<void>;

    /** True iff this path has a pending staged change. */
    hasPending(workspace: string, path: TreePath): boolean;
    /** Get the buffered (locally-edited) value, or undefined if not staged. */
    getBuffered(workspace: string, path: TreePath): Uint8Array | undefined;
    /** Get the pinned snapshot value, or undefined if not staged. */
    getSnapshot(workspace: string, path: TreePath): Uint8Array | undefined;
    /** Get the full staged entry, or undefined if not staged. */
    getEntry(workspace: string, path: TreePath): StagedEntry | undefined;

    /** Write a buffered value. Snapshot is pinned on the first call for a
     *  given path; subsequent writes update only the buffered value. */
    write(
        workspace: string,
        path: TreePath,
        snapshotIfNew: Uint8Array,
        buffered: Uint8Array,
    ): void;

    /** Drop the staged entry for a path. Returns true if there was one. */
    discard(workspace: string, path: TreePath): boolean;

    /** All currently-staged keys (workspace+path combinations). */
    listKeys(): string[];

    // Reactive tracker integration
    subscribe(key: string, callback: () => void): () => void;
    getKeyVersion(key: string): number;
}

// ============================================================================
// IndexedDB adapter
// ============================================================================

const IDB_DB_NAME = "elaraai-e3-ui";
const IDB_STORE_NAME = "staged";
const IDB_VERSION = 1;

/**
 * IndexedDB-backed persistence adapter. Stores entries as native
 * structured-clone shapes; no base64 encoding — `Uint8Array` fields
 * survive structured clone losslessly.
 */
export class IndexedDBStagedAdapter implements StagedPersistenceAdapter {
    private dbPromise: Promise<IDBDatabase> | null = null;

    private getDB(): Promise<IDBDatabase> {
        if (!this.dbPromise) {
            this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
                const req = indexedDB.open(IDB_DB_NAME, IDB_VERSION);
                req.onupgradeneeded = () => {
                    const db = req.result;
                    if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
                        db.createObjectStore(IDB_STORE_NAME);
                    }
                };
                req.onsuccess = () => resolve(req.result);
                req.onerror  = () => reject(req.error);
                req.onblocked = () => reject(new Error("IndexedDB open blocked"));
            });
        }
        return this.dbPromise;
    }

    async loadAll(): Promise<Map<string, PersistedStagedEntry>> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(IDB_STORE_NAME, "readonly");
            const store = tx.objectStore(IDB_STORE_NAME);
            const valuesReq = store.getAll();
            const keysReq = store.getAllKeys();
            tx.oncomplete = () => {
                const out = new Map<string, PersistedStagedEntry>();
                const values = valuesReq.result as PersistedStagedEntry[];
                const keys = keysReq.result as IDBValidKey[];
                for (let i = 0; i < keys.length; i++) {
                    out.set(String(keys[i]), values[i]!);
                }
                resolve(out);
            };
            tx.onerror = () => reject(tx.error);
        });
    }

    async save(key: string, entry: PersistedStagedEntry): Promise<void> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(IDB_STORE_NAME, "readwrite");
            tx.objectStore(IDB_STORE_NAME).put(entry, key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    async remove(key: string): Promise<void> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(IDB_STORE_NAME, "readwrite");
            tx.objectStore(IDB_STORE_NAME).delete(key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    async clear(): Promise<void> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(IDB_STORE_NAME, "readwrite");
            tx.objectStore(IDB_STORE_NAME).clear();
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }
}

// ============================================================================
// In-memory adapter (tests / SSR / fallback when no IndexedDB available)
// ============================================================================

/**
 * Trivial in-memory implementation. Used by tests directly and as the
 * fallback when IndexedDB isn't available (e.g. SSR, very locked-down
 * iframes). The "persistence" is process-lifetime only.
 */
export class MemoryStagedAdapter implements StagedPersistenceAdapter {
    private map = new Map<string, PersistedStagedEntry>();

    async loadAll(): Promise<Map<string, PersistedStagedEntry>> {
        // Return a copy so callers mutating their map don't affect ours.
        return new Map(this.map);
    }

    async save(key: string, entry: PersistedStagedEntry): Promise<void> {
        this.map.set(key, entry);
    }

    async remove(key: string): Promise<void> {
        this.map.delete(key);
    }

    async clear(): Promise<void> {
        this.map.clear();
    }
}

// ============================================================================
// StagedStore — adapter-driven, sync in-memory cache, async write-through.
// ============================================================================

export class StagedStore implements StagedStoreInterface {
    private entries: Map<string, StagedEntry> = new Map();
    private subscribers: Map<string, Set<() => void>> = new Map();
    private versions: Map<string, number> = new Map();
    private adapter: StagedPersistenceAdapter;
    private hydrated: Promise<void>;
    private inFlight: Set<Promise<void>> = new Set();

    constructor(adapter: StagedPersistenceAdapter) {
        this.adapter = adapter;
        this.hydrated = this.hydrate();
    }

    // ----- public API ------------------------------------------------------

    ready(): Promise<void> {
        return this.hydrated;
    }

    async flushPending(): Promise<void> {
        // Snapshot the in-flight set; new writes during await are tolerated
        // by re-checking until idle.
        while (this.inFlight.size > 0) {
            await Promise.all([...this.inFlight]);
        }
    }

    hasPending(workspace: string, path: TreePath): boolean {
        return this.entries.has(datasetCacheKey(workspace, path));
    }

    getBuffered(workspace: string, path: TreePath): Uint8Array | undefined {
        return this.entries.get(datasetCacheKey(workspace, path))?.buffered;
    }

    getSnapshot(workspace: string, path: TreePath): Uint8Array | undefined {
        return this.entries.get(datasetCacheKey(workspace, path))?.snapshot;
    }

    getEntry(workspace: string, path: TreePath): StagedEntry | undefined {
        return this.entries.get(datasetCacheKey(workspace, path));
    }

    write(
        workspace: string,
        path: TreePath,
        snapshotIfNew: Uint8Array,
        buffered: Uint8Array,
    ): void {
        const key = datasetCacheKey(workspace, path);
        const existing = this.entries.get(key);
        const next: StagedEntry = existing
            ? { snapshot: existing.snapshot, buffered }
            : { snapshot: snapshotIfNew, buffered };
        this.entries.set(key, next);
        this.notify(key);

        const persisted: PersistedStagedEntry = {
            snapshot: next.snapshot,
            buffered: next.buffered,
        };
        this.track(this.adapter.save(key, persisted));
    }

    discard(workspace: string, path: TreePath): boolean {
        const key = datasetCacheKey(workspace, path);
        if (!this.entries.has(key)) return false;
        this.entries.delete(key);
        this.notify(key);
        this.track(this.adapter.remove(key));
        return true;
    }

    listKeys(): string[] {
        return [...this.entries.keys()];
    }

    subscribe(key: string, callback: () => void): () => void {
        let set = this.subscribers.get(key);
        if (!set) {
            set = new Set();
            this.subscribers.set(key, set);
        }
        set.add(callback);
        return () => {
            set!.delete(callback);
            if (set!.size === 0) this.subscribers.delete(key);
        };
    }

    getKeyVersion(key: string): number {
        return this.versions.get(key) ?? 0;
    }

    /** Test-only: clear in-memory + persisted state. */
    async clear(): Promise<void> {
        const keys = [...this.entries.keys()];
        this.entries.clear();
        for (const key of keys) this.notify(key);
        await this.adapter.clear();
    }

    // ----- internals -------------------------------------------------------

    private notify(key: string): void {
        this.versions.set(key, (this.versions.get(key) ?? 0) + 1);
        const subs = this.subscribers.get(key);
        if (subs) for (const cb of subs) cb();
    }

    private track(p: Promise<void>): void {
        const wrapped = p.catch((err: unknown) => {
            console.warn("[StagedStore] persistence operation failed:", err);
        }).then(() => {
            this.inFlight.delete(wrapped);
        });
        this.inFlight.add(wrapped);
    }

    private async hydrate(): Promise<void> {
        let persisted: Map<string, PersistedStagedEntry>;
        try {
            persisted = await this.adapter.loadAll();
        } catch (err) {
            console.warn("[StagedStore] hydrate failed:", err);
            return;
        }
        for (const [key, p] of persisted) {
            this.entries.set(key, {
                snapshot: p.snapshot,
                buffered: p.buffered,
            });
            this.notify(key);
        }
    }
}

// ============================================================================
// Default singleton + adapter detection
// ============================================================================

function detectDefaultAdapter(): StagedPersistenceAdapter {
    try {
        if (typeof globalThis !== "undefined" && typeof (globalThis as { indexedDB?: unknown }).indexedDB !== "undefined") {
            return new IndexedDBStagedAdapter();
        }
    } catch {
        // fall through
    }
    return new MemoryStagedAdapter();
}

let _stagedStore: StagedStoreInterface | null = null;

export function getStagedStore(): StagedStoreInterface {
    if (!_stagedStore) {
        _stagedStore = new StagedStore(detectDefaultAdapter());
    }
    return _stagedStore;
}

export function initializeStagedStore(store: StagedStoreInterface): void {
    _stagedStore = store;
}

export function clearStagedStoreSingleton(): void {
    _stagedStore = null;
}
