/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Unit tests for the StagedStore — closure-semantics + persistence +
 * reactive subscriptions. The store holds opaque bytes only; the runtime
 * value type is tracked separately by the bind-runtime binding registry.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { variant } from "@elaraai/east";
import type { TreePath } from "@elaraai/e3-types";
import { IndexedDBStagedAdapter, MemoryStagedAdapter, StagedStore } from "../src/platform/staged-store.js";
import type { PersistedStagedEntry, StagedPersistenceAdapter } from "../src/platform/staged-store.js";

// ============================================================================
// Helpers
// ============================================================================

const path = (...segs: string[]): TreePath => segs.map(s => variant("field", s));

const ws = "test-workspace";
const policyPath: TreePath = path("policy");
const schedulePath: TreePath = path("schedule");

async function newStore(): Promise<{ store: StagedStore; adapter: MemoryStagedAdapter }> {
    const adapter = new MemoryStagedAdapter();
    const store = new StagedStore(adapter);
    await store.ready();
    return { store, adapter };
}

// ============================================================================
// Closure semantics
// ============================================================================

describe("StagedStore — closure semantics", () => {
    test("hasPending false on a fresh store", async () => {
        const { store } = await newStore();
        assert.equal(store.hasPending(ws, policyPath), false);
    });

    test("write pins snapshot on first call", async () => {
        const { store } = await newStore();
        const snapshot = new Uint8Array([1, 2, 3]);
        const buffered = new Uint8Array([4, 5, 6]);
        store.write(ws, policyPath, snapshot, buffered);
        assert.equal(store.hasPending(ws, policyPath), true);
        assert.deepEqual(store.getSnapshot(ws, policyPath), snapshot);
        assert.deepEqual(store.getBuffered(ws, policyPath), buffered);
    });

    test("subsequent writes update buffered but preserve snapshot", async () => {
        const { store } = await newStore();
        const snap1 = new Uint8Array([1]);
        const buf1 = new Uint8Array([10]);
        store.write(ws, policyPath, snap1, buf1);

        // New write passes a different snapshot — ignored once an entry exists.
        const snap2_ignored = new Uint8Array([99]);
        const buf2 = new Uint8Array([20]);
        store.write(ws, policyPath, snap2_ignored, buf2);

        assert.deepEqual(store.getSnapshot(ws, policyPath), snap1);
        assert.deepEqual(store.getBuffered(ws, policyPath), buf2);
    });

    test("getEntry returns snapshot + buffered", async () => {
        const { store } = await newStore();
        const snap = new Uint8Array([7]);
        const buf = new Uint8Array([8]);
        store.write(ws, policyPath, snap, buf);
        const entry = store.getEntry(ws, policyPath);
        assert.ok(entry);
        assert.deepEqual(entry!.snapshot, snap);
        assert.deepEqual(entry!.buffered, buf);
    });

    test("discard returns true on existing entry, false on missing", async () => {
        const { store } = await newStore();
        assert.equal(store.discard(ws, policyPath), false);
        store.write(ws, policyPath, new Uint8Array([1]), new Uint8Array([2]));
        assert.equal(store.discard(ws, policyPath), true);
        assert.equal(store.hasPending(ws, policyPath), false);
        assert.equal(store.getEntry(ws, policyPath), undefined);
    });

    test("entries are isolated per workspace+path", async () => {
        const { store } = await newStore();
        store.write(ws, policyPath,   new Uint8Array([1]), new Uint8Array([10]));
        store.write(ws, schedulePath, new Uint8Array([2]), new Uint8Array([20]));
        assert.deepEqual(store.getBuffered(ws, policyPath),   new Uint8Array([10]));
        assert.deepEqual(store.getBuffered(ws, schedulePath), new Uint8Array([20]));
        assert.equal(store.listKeys().length, 2);
    });
});

// ============================================================================
// Persistence (adapter round-trip)
// ============================================================================

describe("StagedStore — persistence round-trip via adapter", () => {
    test("hydrate reads back what a previous store wrote", async () => {
        const adapter = new MemoryStagedAdapter();
        const writer = new StagedStore(adapter);
        await writer.ready();
        writer.write(ws, policyPath, new Uint8Array([1, 2]), new Uint8Array([3, 4]));
        await writer.flushPending();

        const reloaded = new StagedStore(adapter);
        await reloaded.ready();
        assert.equal(reloaded.hasPending(ws, policyPath), true);
        assert.deepEqual(reloaded.getSnapshot(ws, policyPath), new Uint8Array([1, 2]));
        assert.deepEqual(reloaded.getBuffered(ws, policyPath), new Uint8Array([3, 4]));
    });

    test("discard removes the persisted entry", async () => {
        const adapter = new MemoryStagedAdapter();
        const store = new StagedStore(adapter);
        await store.ready();
        store.write(ws, policyPath, new Uint8Array([1]), new Uint8Array([2]));
        await store.flushPending();
        store.discard(ws, policyPath);
        await store.flushPending();

        const reloaded = new StagedStore(adapter);
        await reloaded.ready();
        assert.equal(reloaded.hasPending(ws, policyPath), false);
    });

    test("preserves binary fidelity across persist/hydrate", async () => {
        // 0x00, 0xff, and other bytes that JSON would mangle without binary-safe encoding.
        const tricky = new Uint8Array([0, 1, 2, 254, 255, 128, 0, 0xff]);
        const adapter = new MemoryStagedAdapter();
        const store = new StagedStore(adapter);
        await store.ready();
        store.write(ws, policyPath, tricky, tricky);
        await store.flushPending();
        const reloaded = new StagedStore(adapter);
        await reloaded.ready();
        assert.deepEqual(reloaded.getBuffered(ws, policyPath), tricky);
    });
});

// ============================================================================
// Reactive subscriptions
// ============================================================================

describe("StagedStore — reactive subscriptions", () => {
    test("subscribe fires on write to subscribed key", async () => {
        const { store } = await newStore();
        let calls = 0;
        const key = "test-workspace.policy";
        const unsub = store.subscribe(key, () => { calls++; });
        store.write(ws, policyPath, new Uint8Array([1]), new Uint8Array([2]));
        assert.equal(calls, 1);
        unsub();
    });

    test("subscribe does NOT fire on write to a different key", async () => {
        const { store } = await newStore();
        let calls = 0;
        const policyKey = "test-workspace.policy";
        store.subscribe(policyKey, () => { calls++; });
        store.write(ws, schedulePath, new Uint8Array([1]), new Uint8Array([2]));
        assert.equal(calls, 0);
    });

    test("subscribe fires on discard", async () => {
        const { store } = await newStore();
        store.write(ws, policyPath, new Uint8Array([1]), new Uint8Array([2]));
        let calls = 0;
        const key = "test-workspace.policy";
        store.subscribe(key, () => { calls++; });
        store.discard(ws, policyPath);
        assert.equal(calls, 1);
    });

    test("getKeyVersion increments on each notification", async () => {
        const { store } = await newStore();
        const key = "test-workspace.policy";
        assert.equal(store.getKeyVersion(key), 0);
        store.write(ws, policyPath, new Uint8Array([1]), new Uint8Array([2]));
        assert.equal(store.getKeyVersion(key), 1);
        store.write(ws, policyPath, new Uint8Array([1]), new Uint8Array([3]));
        assert.equal(store.getKeyVersion(key), 2);
        store.discard(ws, policyPath);
        assert.equal(store.getKeyVersion(key), 3);
    });

    test("unsubscribe stops notifications", async () => {
        const { store } = await newStore();
        let calls = 0;
        const key = "test-workspace.policy";
        const unsub = store.subscribe(key, () => { calls++; });
        store.write(ws, policyPath, new Uint8Array([1]), new Uint8Array([2]));
        unsub();
        store.write(ws, policyPath, new Uint8Array([1]), new Uint8Array([3]));
        assert.equal(calls, 1);
    });

    test("hydration fires subscribers for keys it loads", async () => {
        const adapter = new MemoryStagedAdapter();
        const writer = new StagedStore(adapter);
        await writer.ready();
        writer.write(ws, policyPath, new Uint8Array([1]), new Uint8Array([2]));
        await writer.flushPending();

        const reloaded = new StagedStore(adapter);
        let calls = 0;
        const key = "test-workspace.policy";
        reloaded.subscribe(key, () => { calls++; });
        await reloaded.ready();
        assert.equal(calls, 1);
    });
});

// ============================================================================
// B.1 — hydration concurrency
// ============================================================================

describe("StagedStore — hydration concurrency", () => {
    test("write a NEW key during hydrate is not lost", async () => {
        const adapter = new MemoryStagedAdapter();
        const writer = new StagedStore(adapter);
        await writer.ready();
        writer.write(ws, policyPath, new Uint8Array([1]), new Uint8Array([2]));
        await writer.flushPending();

        const reloaded = new StagedStore(adapter);
        // Write a different key BEFORE await ready() — must not be lost
        // when hydrate finishes notifying.
        reloaded.write(ws, schedulePath, new Uint8Array([10]), new Uint8Array([11]));
        await reloaded.ready();
        assert.equal(reloaded.hasPending(ws, policyPath), true);
        assert.equal(reloaded.hasPending(ws, schedulePath), true);
    });

    test("flushPending awaits hydrate-spawned saves", async () => {
        const adapter = new MemoryStagedAdapter();
        const store = new StagedStore(adapter);
        await store.ready();
        store.write(ws, policyPath, new Uint8Array([1]), new Uint8Array([2]));
        await store.flushPending();
        // After flushPending, the persistence is durable (the adapter has it).
        const persisted = await adapter.loadAll();
        assert.ok(persisted.has("test-workspace.policy"));
    });
});

// ============================================================================
// B.2 — persistence error tolerance
// ============================================================================

describe("StagedStore — persistence error tolerance", () => {
    function captureWarn() {
        const messages: string[] = [];
        const original = console.warn;
        console.warn = (...args: unknown[]) => { messages.push(String(args[0])); };
        return { messages, restore: () => { console.warn = original; } };
    }

    test("save rejection logs but does not corrupt in-memory state", async () => {
        // Adapter that always rejects save.
        const failingAdapter: import("../src/platform/staged-store.js").StagedPersistenceAdapter = {
            async loadAll() { return new Map(); },
            async save() { throw new Error("disk full"); },
            async remove() { /* noop */ },
            async clear() { /* noop */ },
        };
        const w = captureWarn();
        try {
            const store = new StagedStore(failingAdapter);
            await store.ready();
            store.write(ws, policyPath, new Uint8Array([1]), new Uint8Array([2]));
            await store.flushPending();
            // In-memory state intact despite persistence failure.
            assert.equal(store.hasPending(ws, policyPath), true);
            assert.ok(w.messages.some(m => m.includes("persistence operation failed")));
        } finally {
            w.restore();
        }
    });

    test("loadAll rejection — store is empty; ready() still resolves", async () => {
        const failingAdapter: import("../src/platform/staged-store.js").StagedPersistenceAdapter = {
            async loadAll() { throw new Error("idb broken"); },
            async save() { /* noop */ },
            async remove() { /* noop */ },
            async clear() { /* noop */ },
        };
        const w = captureWarn();
        try {
            const store = new StagedStore(failingAdapter);
            await store.ready();
            assert.equal(store.hasPending(ws, policyPath), false);
            assert.ok(w.messages.some(m => m.includes("persistence operation failed")));
        } finally {
            w.restore();
        }
    });
});

// ============================================================================
// B.3 — flushPending semantics
// ============================================================================

describe("StagedStore — flushPending", () => {
    test("resolves immediately when no in-flight ops", async () => {
        const { store } = await newStore();
        await store.flushPending();
        assert.ok(true);
    });

    test("awaits saves AND deletes", async () => {
        const adapter = new MemoryStagedAdapter();
        const store = new StagedStore(adapter);
        await store.ready();
        store.write(ws, policyPath, new Uint8Array([1]), new Uint8Array([2]));
        store.discard(ws, policyPath);
        await store.flushPending();
        const persisted = await adapter.loadAll();
        assert.equal(persisted.size, 0);
    });
});

// ============================================================================
// B.4 — clear()
// ============================================================================

describe("StagedStore — clear()", () => {
    test("clears in-memory entries and fires per-key notifications", async () => {
        const { store } = await newStore();
        store.write(ws, policyPath, new Uint8Array([1]), new Uint8Array([2]));
        store.write(ws, schedulePath, new Uint8Array([3]), new Uint8Array([4]));
        let policyCalls = 0;
        let scheduleCalls = 0;
        store.subscribe("test-workspace.policy", () => policyCalls++);
        store.subscribe("test-workspace.schedule", () => scheduleCalls++);
        await store.clear();
        assert.equal(store.hasPending(ws, policyPath), false);
        assert.equal(store.hasPending(ws, schedulePath), false);
        assert.equal(policyCalls, 1);
        assert.equal(scheduleCalls, 1);
    });

    test("clears persisted state too", async () => {
        const adapter = new MemoryStagedAdapter();
        const store = new StagedStore(adapter);
        await store.ready();
        store.write(ws, policyPath, new Uint8Array([1]), new Uint8Array([2]));
        await store.flushPending();
        await store.clear();
        const persisted = await adapter.loadAll();
        assert.equal(persisted.size, 0);
    });
});

// ============================================================================
// B.5 — singleton lifecycle
// ============================================================================

describe("StagedStore — singleton lifecycle", () => {
    test("getStagedStore returns the same instance", async () => {
        const { getStagedStore, clearStagedStoreSingleton } = await import("../src/platform/staged-store.js");
        clearStagedStoreSingleton();
        const a = getStagedStore();
        const b = getStagedStore();
        assert.equal(a, b);
        clearStagedStoreSingleton();
    });

    test("initializeStagedStore overrides; clearStagedStoreSingleton resets", async () => {
        const { initializeStagedStore, getStagedStore, clearStagedStoreSingleton } = await import("../src/platform/staged-store.js");
        clearStagedStoreSingleton();
        const adapter = new MemoryStagedAdapter();
        const custom = new StagedStore(adapter);
        await custom.ready();
        initializeStagedStore(custom);
        assert.equal(getStagedStore(), custom);
        clearStagedStoreSingleton();
        // Now getStagedStore creates a fresh one.
        const fresh = getStagedStore();
        assert.notEqual(fresh, custom);
        clearStagedStoreSingleton();
    });
});

// ============================================================================
// B.5 — per-key persistence ordering + error propagation + clear() flush
// ============================================================================

/** Adapter that yields a microtask inside save (so concurrency is observable),
 *  records completed saves in order, and tracks peak concurrency per key. */
function makeOrderedAdapter() {
    const saved = new Map<string, Uint8Array>();
    const completed: string[] = [];
    const inFlight = new Map<string, number>();
    let peakSameKey = 0;
    const adapter: StagedPersistenceAdapter = {
        async loadAll() { return new Map(); },
        async save(key: string, entry: PersistedStagedEntry) {
            const n = (inFlight.get(key) ?? 0) + 1;
            inFlight.set(key, n);
            peakSameKey = Math.max(peakSameKey, n);
            await Promise.resolve();
            inFlight.set(key, (inFlight.get(key) ?? 1) - 1);
            saved.set(key, entry.buffered);
            completed.push(key);
        },
        async remove(key: string) { saved.delete(key); completed.push(`rm:${key}`); },
        async clear() { saved.clear(); },
    };
    return { adapter, saved, completed, get peakSameKey() { return peakSameKey; } };
}

describe("StagedStore — per-key persistence ordering", () => {
    test("rapid same-key writes are serialized; last value wins", async () => {
        const h = makeOrderedAdapter();
        const store = new StagedStore(h.adapter);
        await store.ready();
        store.write(ws, policyPath, new Uint8Array([0]), new Uint8Array([1]));
        store.write(ws, policyPath, new Uint8Array([0]), new Uint8Array([2]));
        store.write(ws, policyPath, new Uint8Array([0]), new Uint8Array([3]));
        await store.flushPending();
        // Never two concurrent saves for the same key (the per-key chain).
        assert.equal(h.peakSameKey, 1);
        // The final persisted value is the last write.
        const key = [...h.saved.keys()][0]!;
        assert.deepEqual(h.saved.get(key), new Uint8Array([3]));
    });
});

describe("StagedStore — onPersistError", () => {
    function captureWarn() {
        const messages: string[] = [];
        const original = console.warn;
        console.warn = (...args: unknown[]) => { messages.push(String(args[0])); };
        return { messages, restore: () => { console.warn = original; } };
    }

    test("save failure notifies a registered listener (and skips the console fallback)", async () => {
        const failing: StagedPersistenceAdapter = {
            async loadAll() { return new Map(); },
            async save() { throw new Error("disk full"); },
            async remove() { /* noop */ },
            async clear() { /* noop */ },
        };
        const w = captureWarn();
        try {
            const store = new StagedStore(failing);
            await store.ready();
            const errors: { key: string; err: unknown }[] = [];
            const off = store.onPersistError((key, err) => errors.push({ key, err }));
            store.write(ws, policyPath, new Uint8Array([1]), new Uint8Array([2]));
            await store.flushPending();
            assert.equal(errors.length, 1);
            assert.ok(String(errors[0]!.err).includes("disk full"));
            // With a listener registered, the console fallback is not used.
            assert.equal(w.messages.some(m => m.includes("persistence operation failed")), false);
            off();
        } finally {
            w.restore();
        }
    });
});

describe("StagedStore — clear() drains in-flight writes", () => {
    test("a slow save does not resurrect a cleared entry", async () => {
        const h = makeOrderedAdapter();
        const store = new StagedStore(h.adapter);
        await store.ready();
        store.write(ws, policyPath, new Uint8Array([0]), new Uint8Array([9]));
        // clear() must flush the in-flight save before wiping persistence, so
        // the save can't land after the clear and resurrect the entry.
        await store.clear();
        assert.equal(h.saved.size, 0);
    });
});

// ============================================================================
// B.6 — IndexedDBStagedAdapter open-failure retry (no permanent brick)
// ============================================================================

function makeFakeDB() {
    return {
        objectStoreNames: { contains: () => true },
        createObjectStore: () => undefined,
        transaction: () => {
            const tx: { oncomplete: (() => void) | null; onerror: (() => void) | null; error: unknown; objectStore: () => unknown } = {
                oncomplete: null, onerror: null, error: null,
                objectStore: () => ({ getAll: () => ({ result: [] }), getAllKeys: () => ({ result: [] }) }),
            };
            queueMicrotask(() => tx.oncomplete?.());
            return tx;
        },
    };
}

function makeFakeIndexedDB(failOpens: number) {
    let opens = 0;
    return {
        get opens() { return opens; },
        open() {
            opens += 1;
            const attempt = opens;
            const req: Record<string, unknown> = {
                result: null, error: null,
                onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null,
            };
            queueMicrotask(() => {
                if (attempt <= failOpens) {
                    req.error = new Error("open failed");
                    (req.onerror as (() => void) | null)?.();
                } else {
                    req.result = makeFakeDB();
                    (req.onupgradeneeded as (() => void) | null)?.();
                    (req.onsuccess as (() => void) | null)?.();
                }
            });
            return req;
        },
    };
}

describe("IndexedDBStagedAdapter — open-failure retry", () => {
    test("a transient open failure does not brick the adapter forever", async () => {
        const fake = makeFakeIndexedDB(1); // first open fails, second succeeds
        const prev = (globalThis as { indexedDB?: unknown }).indexedDB;
        (globalThis as { indexedDB?: unknown }).indexedDB = fake;
        try {
            const adapter = new IndexedDBStagedAdapter();
            await assert.rejects(adapter.loadAll());      // first open rejects
            const result = await adapter.loadAll();        // retried open succeeds
            assert.equal(result.size, 0);
            assert.equal(fake.opens, 2);                   // re-opened (not cached-rejected)
        } finally {
            (globalThis as { indexedDB?: unknown }).indexedDB = prev;
        }
    });
});
