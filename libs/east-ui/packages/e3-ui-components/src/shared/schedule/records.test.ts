/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A new row's key (`mintKey`, `records.ts`): a UUID, retried while it is
 * taken — the page's `crypto.randomUUID`'s, else, on a page served over plain
 * HTTP, which has none, one drawn from the page's random bytes (#1536).
 */
import { afterEach, expect, test, vi } from "vitest";
import { mintKey } from "./records.js";

/** A version 4 UUID, as `crypto.randomUUID` prints one. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test("a key the page's randomUUID gives, the next one while it is taken", () => {
    const offered = ["5d2a1c3e-0b4f-4a6d-8e7c-9f1b2a3c4d5e", "8f7e6d5c-4b3a-4291-a8b7-c6d5e4f3a2b1"];
    vi.spyOn(crypto, "randomUUID").mockImplementation(() => offered.shift() as ReturnType<typeof crypto.randomUUID>);
    expect(mintKey((key) => key === "5d2a1c3e-0b4f-4a6d-8e7c-9f1b2a3c4d5e")).toBe("8f7e6d5c-4b3a-4291-a8b7-c6d5e4f3a2b1");
});

test("a page with no randomUUID: a version 4 UUID from its random bytes, never one taken", () => {
    const page = globalThis.crypto;
    vi.stubGlobal("crypto", { getRandomValues: <T extends ArrayBufferView>(bytes: T): T => page.getRandomValues(bytes as never) as T });
    const taken = new Set<string>();
    for (let i = 0; i < 64; i++) {
        const key = mintKey((k) => taken.has(k));
        expect(key).toMatch(UUID);
        expect(taken.has(key)).toBe(false);
        taken.add(key);
    }
});
