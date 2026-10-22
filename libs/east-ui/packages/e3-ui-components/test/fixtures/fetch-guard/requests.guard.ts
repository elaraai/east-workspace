/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Two tests the fetch guard judges (`test/fetch-guard.spec.ts`): one whose
 * request reaches the global fetch, which the guard fails, and one that makes
 * no request, which it passes.
 */

import { expect, test } from "vitest";

test("a request to the global fetch", async () => {
    await expect(fetch("http://e3.invalid/api/repos/default/workspaces/w/status")).rejects.toThrow(/went to the global fetch/);
});

test("no request", () => {
    expect([1, 2].length).toBe(2);
});
