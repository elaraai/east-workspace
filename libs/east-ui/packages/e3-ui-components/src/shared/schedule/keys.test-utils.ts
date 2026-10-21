/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The keys a builder over the app's own records mints for its new rows
 * (`mintKey`, `records.ts`, B15), as a test offers them: the Roster's duties'
 * and the Allocation's bins'.
 *
 * @packageDocumentation
 */
import { vi } from "vitest";

/** `crypto.randomUUID` as the page has it, before any test stubs it. */
const realUUID = crypto.randomUUID.bind(crypto);

/**
 * Stubs `crypto.randomUUID` to offer these keys first, as a new row's key is
 * minted from it (B15): each call takes the next, and once they are all taken
 * the real one answers. e3-web runs in the test's thread and mints its own ids
 * with it — a call's, a commit's — so a test offers a key just before the
 * gesture that mints it. Offered again, the stub offers the new keys alone;
 * the harness puts the real one back as the test ends.
 *
 * @param keys - The keys, in the order the gestures mint them
 */
export function offering(keys: readonly string[]): void {
    const offered = [...keys];
    vi.spyOn(crypto, "randomUUID").mockImplementation(() => (offered.shift() ?? realUUID()) as ReturnType<typeof crypto.randomUUID>);
}
