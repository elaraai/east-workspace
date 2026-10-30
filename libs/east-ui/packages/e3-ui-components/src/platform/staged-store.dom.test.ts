/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 */

/** The staged writes' store, cleared with the kept state: a sign-out drops what was staged, in every scope. */

import { describe, test, expect } from "vitest";
import { variant } from "@elaraai/east";
import type { TreePath } from "@elaraai/e3-types";
import { clearKept } from "@elaraai/east-ui-components";
import { MemoryStagedAdapter, StagedStore, getStagedStore, initializeStagedStore } from "./staged-store.js";

const bytes = (n: number) => new Uint8Array([n]);
const path: TreePath = [variant("field", "inputs"), variant("field", "hours")];

describe("staged store", () => {
    test("a sign-out drops every staged entry, in every scope, persisted ones included", async () => {
        const adapter = new MemoryStagedAdapter();
        initializeStagedStore(new StagedStore(adapter));
        const store = getStagedStore();
        await store.ready();
        const unset = store.setScope("server-a/repo-1");
        store.write("ws", path, bytes(1), bytes(2));
        unset();
        store.setScope("server-a/repo-2");
        store.write("ws", path, bytes(1), bytes(3));
        await store.flushPending();
        expect((await adapter.loadAll()).size).toBe(2);

        clearKept();
        await store.flushPending();

        expect(store.hasPending("ws", path)).toBe(false);
        store.setScope("server-a/repo-1");
        expect(store.hasPending("ws", path)).toBe(false);
        expect((await adapter.loadAll()).size).toBe(0);
    });
});
